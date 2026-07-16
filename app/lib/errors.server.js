/* eslint-env node */
/* eslint-disable react/prop-types */
// app/routes/app.editor.jsx
//
// NOTE: prop-types intentionally disabled — these are private, file-local
// components consumed only within this route file, not a shared library.
//
// Image Editor — three modes: Crop & Resize | Split Grid | Collage
//
// UX model ported from the storefront layout-builder extension:
//   • Tabbed crop controls: Aspect Ratios | Platform Presets
//   • Custom pixel input with Apply button
//   • onReady fires inside Cropper's `ready` event (not synchronously)
//     so setAspectRatio() always lands on a live instance
//   • Locked crop dimensions: first image in a multi-image set sets the
//     lock; every subsequent image inherits it (same as layout-builder)
//   • Split Grid: Step 1 = crop → Step 2 = pick grid size + preview
//   • Collage: sequential per-cell crop with dimension lock
//   • All object URLs are created once and revoked on cleanup
//   • Cropper.js CSS is imported from the npm package (not a CDN) so it
//     always loads — no external file to host, no tracking-prevention
//     issues from a third-party stylesheet origin inside the admin iframe.

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useLoaderData, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { join } from "path";
import { mkdir, writeFile, unlink, readFile } from "fs/promises";
import sharp from "sharp";
import {
  splitImageIntoGrid,
  composePhotoCollage,
  processSingleImage,
} from "../lib/image.processing.server";

// Cropper.js ships its own CSS in the npm package (you already depend on
// `cropperjs` via the dynamic import in CropCanvas below). Importing it
// with `?url` asks Vite to resolve/bundle the file and hand back a URL —
// no manual download, no CDN, no /public file to maintain.
//
// If your bundler isn't Vite and this import fails, the fallback is to
// copy node_modules/cropperjs/dist/cropper.css into public/vendor/ once
// and reference it as a plain string path instead.
import cropperStylesUrl from "cropperjs/dist/cropper.css?url";

export const links = () => [
  {
    rel: "stylesheet",
    href: cropperStylesUrl,
  },
];

const UPLOAD_TMP = join(process.cwd(), "public", "uploads", "_tmp");

// ─────────────────────────────────────────────────────────────────────────────
// GraphQL
// ─────────────────────────────────────────────────────────────────────────────

const FILES_QUERY = `#graphql
  query GetImages($first: Int!, $after: String, $query: String) {
    files(first: $first, after: $after, query: $query) {
      edges {
        cursor
        node {
          ... on MediaImage {
            id alt createdAt
            image { url width height altText }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const STAGED_UPLOAD_CREATE = `#graphql
  mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets {
        url resourceUrl
        parameters { name value }
      }
      userErrors { field message }
    }
  }
`;

const FILE_CREATE = `#graphql
  mutation fileCreate($files: [FileCreateInput!]!) {
    fileCreate(files: $files) {
      files {
        ... on MediaImage {
          id
          image { url width height }
        }
      }
      userErrors { field message }
    }
  }
`;

const FILE_DELETE = `#graphql
  mutation fileDelete($fileIds: [ID!]!) {
    fileDelete(fileIds: $fileIds) {
      deletedFileIds
      userErrors { field message }
    }
  }
`;

// ─────────────────────────────────────────────────────────────────────────────
// Loader
// ─────────────────────────────────────────────────────────────────────────────

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const after = url.searchParams.get("after") || null;
  const q = url.searchParams.get("q") || "";

  try {
    const queryStr = ["media_type:IMAGE status:READY", q ? `filename:*${q}*` : ""]
      .filter(Boolean).join(" ");

    const res = await admin.graphql(FILES_QUERY, {
      variables: { first: 48, after: after || undefined, query: queryStr },
    });
    const json = await res.json();
    const edges = (json.data?.files?.edges ?? []).filter((e) => e.node?.image);

    return {
      files: edges.map((e) => ({ cursor: e.cursor, ...e.node })),
      pageInfo: json.data?.files?.pageInfo ?? { hasNextPage: false, endCursor: null },
      q,
      error: null,
    };
  } catch (err) {
    console.error("Library loader error:", err);
    return { files: [], pageInfo: { hasNextPage: false, endCursor: null }, q, error: err.message };
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Shopify Files upload helper
// ─────────────────────────────────────────────────────────────────────────────

async function uploadBufferToShopifyFiles(admin, buffer, filename) {
  const stageRes = await admin.graphql(STAGED_UPLOAD_CREATE, {
    variables: {
      input: [{
        filename,
        mimeType: "image/jpeg",
        fileSize: String(buffer.length),
        resource: "IMAGE",
        httpMethod: "POST",
      }],
    },
  });
  const stageJson = await stageRes.json();
  const errs = stageJson.data?.stagedUploadsCreate?.userErrors ?? [];
  if (errs.length) throw new Error(errs.map((e) => e.message).join(", "));

  const target = stageJson.data?.stagedUploadsCreate?.stagedTargets?.[0];
  if (!target) throw new Error("Shopify did not return a staged upload target.");

  const uploadForm = new FormData();
  for (const { name, value } of target.parameters) uploadForm.append(name, value);
  uploadForm.append("file", new Blob([buffer], { type: "image/jpeg" }), filename);

  const uploadRes = await fetch(target.url, { method: "POST", body: uploadForm });
  if (!uploadRes.ok) throw new Error(`Staged upload failed with status ${uploadRes.status}`);

  const createRes = await admin.graphql(FILE_CREATE, {
    variables: {
      files: [{
        alt: filename,
        contentType: "IMAGE",
        originalSource: target.resourceUrl,
      }],
    },
  });
  const createJson = await createRes.json();
  const createErrs = createJson.data?.fileCreate?.userErrors ?? [];
  if (createErrs.length) throw new Error(createErrs.map((e) => e.message).join(", "));

  const created = createJson.data?.fileCreate?.files?.[0];
  return { id: created?.id ?? null, url: created?.image?.url ?? null };
}

// ─────────────────────────────────────────────────────────────────────────────
// Action
// ─────────────────────────────────────────────────────────────────────────────

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");
  const saveMode = formData.get("saveMode");
  const origId = formData.get("originalFileId") || null;
  const gridSize = formData.get("gridSize") || "2x2";

  await mkdir(UPLOAD_TMP, { recursive: true });

  try {
    let outputBuffers = [];

    // ── Crop ──────────────────────────────────────────────────────────────────
    if (intent === "crop") {
      const dataUrl = formData.get("imageData");
      const filename = formData.get("filename") || "edited.jpg";
      if (!dataUrl) return { success: false, error: "No image data received." };
      const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");
      const buf = await sharp(Buffer.from(base64, "base64")).jpeg({ quality: 92 }).toBuffer();
      outputBuffers = [{ buffer: buf, filename }];
    }

    // ── Split — receives the already-cropped blob from the client ─────────────
    else if (intent === "split") {
      const croppedFile = formData.get("croppedImage");
      if (!croppedFile || typeof croppedFile === "string") {
        return { success: false, error: "No cropped image provided for split." };
      }
      const tmpPath = join(UPLOAD_TMP, `split-${Date.now()}.jpg`);
      await writeFile(tmpPath, Buffer.from(await croppedFile.arrayBuffer()));

      const compositionId = `editor-${Date.now()}`;
      const [rows, cols] = gridSize.split("x").map(Number);
      const result = (rows === 1 && cols === 1)
        ? await processSingleImage({ sourcePath: tmpPath, shop, compositionId })
        : await splitImageIntoGrid({ sourcePath: tmpPath, gridSize, shop, compositionId });

      await unlink(tmpPath).catch(() => { });

      // Save ONE merged preview image
      const previewPath = join(process.cwd(), "public", result.previewUrl);
      const buf = await readFile(previewPath);
      outputBuffers = [{ buffer: buf, filename: "split-grid.jpg" }];
    }

    // ── Collage ───────────────────────────────────────────────────────────────
    else if (intent === "collage") {
      const cellsJson = formData.get("cells");
      const cells = JSON.parse(cellsJson);
      const [rows, cols] = gridSize.split("x").map(Number);
      const expectedCount = rows * cols;

      if (cells.length !== expectedCount) {
        return {
          success: false,
          error: `${gridSize} collage needs exactly ${expectedCount} images. You provided ${cells.length}.`,
        };
      }

      const tmpPaths = [];
      for (let i = 0; i < cells.length; i++) {
        const tmpPath = join(UPLOAD_TMP, `collage-${Date.now()}-${i}.jpg`);
        const uploadedFile = formData.get(`file_${i}`);
        if (uploadedFile && typeof uploadedFile !== "string") {
          await writeFile(tmpPath, Buffer.from(await uploadedFile.arrayBuffer()));
        } else if (cells[i].url) {
          const res = await fetch(cells[i].url);
          if (!res.ok) throw new Error(`Could not download image for cell ${i}.`);
          await writeFile(tmpPath, Buffer.from(await res.arrayBuffer()));
        } else {
          throw new Error(`Cell ${i} has no image.`);
        }
        tmpPaths.push(tmpPath);
      }

      const compositionId = `editor-${Date.now()}`;
      const result = (rows === 1 && cols === 1)
        ? await processSingleImage({ sourcePath: tmpPaths[0], shop, compositionId })
        : await composePhotoCollage({ sourcePaths: tmpPaths, gridSize, shop, compositionId });

      await Promise.all(tmpPaths.map((p) => unlink(p).catch(() => { })));

      const previewPath = join(process.cwd(), "public", result.previewUrl);
      const buf = await readFile(previewPath);
      outputBuffers = [{ buffer: buf, filename: "collage.jpg" }];
    }

    else {
      return { success: false, error: `Unknown intent: ${intent}` };
    }

    const savedFiles = [];
    for (const { buffer, filename } of outputBuffers) {
      savedFiles.push(await uploadBufferToShopifyFiles(admin, buffer, filename));
    }

    if (saveMode === "replace" && origId) {
      await admin.graphql(FILE_DELETE, { variables: { fileIds: [origId] } });
    }

    return { success: true, savedFiles, saveMode, count: savedFiles.length };

  } catch (err) {
    console.error("Editor action error:", err);
    return { success: false, error: err.message };
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// UI constants
// ─────────────────────────────────────────────────────────────────────────────

const RATIO_PRESETS = [
  { label: "Free", value: NaN },
  { label: "1 : 1", value: 1 },
  { label: "4 : 3", value: 4 / 3 },
  { label: "3 : 4", value: 3 / 4 },
  { label: "16 : 9", value: 16 / 9 },
  { label: "9 : 16", value: 9 / 16 },
];

const SIZE_PRESETS = [
  { label: "Shopify Product", w: 2048, h: 2048 },
  { label: "Instagram Square", w: 1080, h: 1080 },
  { label: "Instagram Portrait", w: 1080, h: 1350 },
  { label: "FB / OG Image", w: 1200, h: 628 },
  { label: "Stories / TikTok", w: 1080, h: 1920 },
  { label: "Twitter / X Banner", w: 1500, h: 500 },
];

const GRID_OPTIONS = [
  { value: "1x1", cells: 1 },
  { value: "2x2", cells: 4 },
  { value: "3x3", cells: 9 },
];

const MODE_TABS = [
  { key: "crop", icon: "✂️", label: "Crop & Resize", desc: "Crop an image to any aspect ratio or custom size." },
  { key: "split", icon: "⚡", label: "Split Grid", desc: "Crop an image then split it into equal tiles, saved as one image." },
  { key: "collage", icon: "🧩", label: "Collage", desc: "Combine multiple images into a single grid layout." },
];

// ─────────────────────────────────────────────────────────────────────────────
// Shared style constants
// ─────────────────────────────────────────────────────────────────────────────

const S = {
  sectionLabel: {
    fontSize: 11, fontWeight: 700, color: "#888",
    letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 8,
  },
  toolBtn: (active) => ({
    display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
    padding: "8px 12px",
    borderRadius: 8, border: "1px solid",
    fontSize: 12, fontWeight: 600, cursor: "pointer",
    background: active ? "#1a1a1a" : "#fff",
    color: active ? "#fff" : "#4a4a4a",
    borderColor: active ? "#1a1a1a" : "#d1d1d1",
    transition: "background 0.12s, color 0.12s, border-color 0.12s",
  }),
  presetBtn: (active) => ({
    display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 1,
    padding: "8px 12px", width: "100%", textAlign: "left",
    borderRadius: 8, border: "1px solid",
    fontSize: 13, cursor: "pointer",
    background: active ? "#1a1a1a" : "#fff",
    color: active ? "#fff" : "#1a1a1a",
    borderColor: active ? "#1a1a1a" : "#d1d1d1",
    transition: "background 0.12s, color 0.12s",
  }),
  gridBtn: (active) => ({
    flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
    padding: "12px 8px",
    borderRadius: 8, border: "2px solid",
    cursor: "pointer",
    background: active ? "#f0f0f0" : "#fff",
    borderColor: active ? "#1a1a1a" : "#e1e1e1",
    transition: "border-color 0.12s, background 0.12s",
  }),
  tab: (active) => ({
    padding: "8px 16px", border: "none", background: "none",
    fontSize: 13, fontWeight: 600, cursor: "pointer",
    color: active ? "#1a1a1a" : "#9a9a9a",
    borderBottom: active ? "2px solid #1a1a1a" : "2px solid transparent",
    marginBottom: -1,
    transition: "color 0.12s, border-color 0.12s",
  }),
};

const CROP_CANVAS_HEIGHT = 460;

// ─────────────────────────────────────────────────────────────────────────────
// useSafeObjectUrl
// Stable blob URL from a File — created AND revoked inside the SAME effect
// instance. This matters under React 18 StrictMode (dev only), which
// mounts → cleans up → re-mounts every effect once to surface unsafe side
// effects: creating the URL during render and only revoking it in a
// `[]`-effect cleanup means StrictMode's phantom unmount revokes the URL
// with nothing left to recreate it, leaving consumers pointed at a dead
// blob url (net::ERR_FILE_NOT_FOUND). Tying creation + revocation to one
// effect run fixes that.
// ─────────────────────────────────────────────────────────────────────────────

function useSafeObjectUrl(file) {
  const [url, setUrl] = useState(null);

  useEffect(() => {
    if (!file) { setUrl(null); return; }

    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);

    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  return url;
}

// ─────────────────────────────────────────────────────────────────────────────
// CropCanvas
//
// Key correctness requirements (ported from layout-builder.js):
//   1. onload is assigned BEFORE src is set — if the browser resolves the
//      object URL synchronously, the handler is already in place.
//   2. The Cropper instance is created inside the img onload callback, not
//      synchronously after setting src.
//   3. onReady fires inside Cropper's own `ready` event so setAspectRatio()
//      calls from the tool panel always land on a fully-initialised instance.
//   4. Container has a fixed pixel height so Cropper measures a stable box.
//   5. A `cancelled` flag guards against the async `import("cropperjs")`
//      resolving after imageUrl has already changed again — without it, a
//      fast image swap could attach handlers for the OLD image after the
//      new one has started loading.
//   6. The raw <img> stays hidden (opacity 0) with a loading spinner shown
//      over it until Cropper's `ready` event fires, so the person never
//      sees a flash of a tiny, unstyled image before Cropper takes over.
// ─────────────────────────────────────────────────────────────────────────────

function CropCanvas({ imageUrl = null, onReady, onReadyChange, lockedRatio }) {
  const imgRef = useRef(null);
  const cropperRef = useRef(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(false);
    onReadyChange?.(false);

    const imgEl = imgRef.current;
    if (!imgEl || !imageUrl) return;

    let cancelled = false;

    import("cropperjs").then((mod) => {
      if (cancelled) return;
      const Cropper = mod.default ?? mod.Cropper ?? mod;

      // Destroy any previous instance before touching the img element
      if (cropperRef.current) {
        cropperRef.current.destroy();
        cropperRef.current = null;
      }

      // ── FIX: assign onload BEFORE setting src ──────────────────────────────
      // Mirrors layout-builder.js "Bug 1 fix": if the browser has the object
      // URL cached, onload fires synchronously when src is set — so the
      // handler must already exist at that point.
      imgEl.onload = () => {
        // Guard: component may have unmounted, or a newer imageUrl may have
        // superseded this load, between src assignment and load firing.
        if (!imgRef.current || cancelled) return;

        const instance = new Cropper(imgEl, {
          viewMode: 1,
          autoCropArea: 0.85,
          responsive: true,
          background: false,
          aspectRatio: isNaN(lockedRatio) ? NaN : lockedRatio,
          ready() {
            if (cancelled) return;

            setReady(true);
            onReadyChange?.(true);

            // Expose the API to the parent only after Cropper is fully ready.
            // Calling setAspectRatio() before this point is a no-op.
            onReady?.({
              setAspectRatio: (r) => cropperRef.current?.setAspectRatio(isNaN(r) ? NaN : r),
              reset: () => cropperRef.current?.reset(),
              getCroppedBlob: () =>
                new Promise((resolve) => {
                  // Guard against getCroppedCanvas returning null (tainted canvas,
                  // OOM, or destroyed instance) — mirrors layout-builder "Bug 1 fix part 2"
                  const canvas = cropperRef.current?.getCroppedCanvas({
                    maxWidth: 4096, maxHeight: 4096, imageSmoothingQuality: "high",
                  });
                  if (!canvas) { resolve(null); return; }
                  canvas.toBlob(
                    (blob) => resolve(blob ?? null),
                    "image/jpeg", 0.92,
                  );
                }),
              getCropDimensions: () => {
                const d = cropperRef.current?.getData(true);
                return d ? { width: d.width, height: d.height } : null;
              },
              // Natural image dimensions — used to set the lock when "skip" is chosen
              getNaturalSize: () => ({
                width: imgEl.naturalWidth,
                height: imgEl.naturalHeight,
              }),
            });
          },
        });

        cropperRef.current = instance;
      };

      // ── Set src AFTER onload is registered ────────────────────────────────
      imgEl.src = imageUrl;
    });

    return () => {
      cancelled = true;
      if (cropperRef.current) {
        cropperRef.current.destroy();
        cropperRef.current = null;
      }
      // Clear the img so the browser doesn't keep decoding stale blobs.
      // Uses the `imgEl` captured at the top of this effect (not
      // imgRef.current) since the ref may already point elsewhere by the
      // time this cleanup runs.
      if (imgEl) {
        imgEl.onload = null;
        imgEl.src = "";
      }
    };
  }, [imageUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{
      width: "100%",
      height: CROP_CANVAS_HEIGHT,
      background: "#2b2b2b",
      borderRadius: 8,
      overflow: "hidden",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      position: "relative",
    }}>
      <style>{`@keyframes cropCanvasSpin { to { transform: rotate(360deg); } }`}</style>

      {!ready && (
        <div style={{
          position: "absolute", inset: 0,
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          gap: 10, color: "#aaa", fontSize: 13, pointerEvents: "none",
        }}>
          <div style={{
            width: 28, height: 28, borderRadius: "50%",
            border: "3px solid rgba(255,255,255,0.15)",
            borderTopColor: "#fff",
            animation: "cropCanvasSpin 0.8s linear infinite",
          }} />
          <span>Loading image editor…</span>
        </div>
      )}

      <img
        ref={imgRef}
        alt="Crop"
        crossOrigin={
          typeof imageUrl === "string" && (imageUrl.startsWith("blob:") || imageUrl.startsWith("data:"))
            ? undefined
            : "anonymous"
        }
        style={{
          display: "block", maxWidth: "100%", maxHeight: "100%", objectFit: "contain",
          opacity: ready ? 1 : 0,
          transition: "opacity 0.15s ease",
        }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CropToolPanel — tabbed controls (ported from layout-builder tab UX)
//
// Tab "ratios"  → standard aspect-ratio pill buttons
// Tab "presets" → platform preset buttons + custom W×H input
//
// Receives cropperApiRef (a ref, not state) so every button click always
// reads the live Cropper.js instance — never a stale null.
//
// `disabled` (new) dims and disables the whole panel while the underlying
// CropCanvas hasn't fired its `ready` event yet, so a person can't click a
// ratio button that would silently no-op against a not-yet-initialised
// Cropper instance.
// ─────────────────────────────────────────────────────────────────────────────

function CropToolPanel({
  cropperApiRef,
  activeTool, setActiveTool,
  customW, setCustomW,
  customH, setCustomH,
  locked,        // true for collage cells 2+ (ratio inherited from cell 1)
  lockedDims,    // { width, height } set after cell 1 crop
  showReset,
  disabled = false,
}) {
  const [cropTab, setCropTab] = useState("ratios"); // "ratios" | "presets"

  const setRatio = (r) => cropperApiRef.current?.setAspectRatio(isNaN(r) ? NaN : r);

  const applyPixelTarget = (w, h) => {
    if (!w || !h || w <= 0 || h <= 0) return;
    setActiveTool({ type: "custom", key: `${w}x${h}` });
    setCustomW(String(w));
    setCustomH(String(h));
    setRatio(w / h);
  };

  return (
    <div style={{
      display: "flex", flexDirection: "column", gap: 0,
      opacity: disabled ? 0.5 : 1,
      pointerEvents: disabled ? "none" : "auto",
      transition: "opacity 0.12s",
    }}>

      {/* ── Dimension lock notice (collage cells 2+) ── */}
      {locked && lockedDims && (
        <div style={{
          padding: "8px 12px", marginBottom: 12,
          background: "#f4f4f4", borderRadius: 6,
          fontSize: 12, color: "#4a4a4a",
          border: "1px solid #e8e8e8",
        }}>
          🔒 Locked to {lockedDims.width} × {lockedDims.height} px from cell 1
        </div>
      )}

      {/* ── Tabs ── */}
      {!locked && (
        <div style={{ display: "flex", borderBottom: "1px solid #f0f0f0", marginBottom: 12 }}>
          <button type="button" style={S.tab(cropTab === "ratios")}
            onClick={() => setCropTab("ratios")}>
            Aspect Ratios
          </button>
          <button type="button" style={S.tab(cropTab === "presets")}
            onClick={() => setCropTab("presets")}>
            Presets
          </button>
        </div>
      )}

      {/* ── Tab: Aspect Ratios ── */}
      {(!locked && cropTab === "ratios") && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
          {RATIO_PRESETS.map((p) => {
            const active = activeTool.type === "ratio" && activeTool.key === p.label;
            return (
              <button key={p.label} type="button"
                style={S.toolBtn(active)}
                onClick={() => {
                  setActiveTool({ type: "ratio", key: p.label });
                  setCustomW(""); setCustomH("");
                  setRatio(p.value);
                }}>
                {p.label}
              </button>
            );
          })}
        </div>
      )}

      {/* ── Tab: Platform Presets + Custom px ── */}
      {(!locked && cropTab === "presets") && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>

          {/* Custom pixel input row */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <input
              type="number" placeholder="W" value={customW} min={1}
              onChange={(e) => setCustomW(e.target.value)}
              style={{
                width: 64, padding: "7px 8px",
                border: "1px solid #d1d1d1", borderRadius: 6, fontSize: 13,
              }}
            />
            <span style={{ fontSize: 13, color: "#9a9a9a" }}>×</span>
            <input
              type="number" placeholder="H" value={customH} min={1}
              onChange={(e) => setCustomH(e.target.value)}
              style={{
                width: 64, padding: "7px 8px",
                border: "1px solid #d1d1d1", borderRadius: 6, fontSize: 13,
              }}
            />
            <button type="button"
              onClick={() => {
                const w = parseInt(customW, 10);
                const h = parseInt(customH, 10);
                if (w > 0 && h > 0) applyPixelTarget(w, h);
              }}
              style={{
                padding: "7px 14px", background: "#1a1a1a", color: "#fff",
                border: "none", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer",
              }}>
              Apply
            </button>
          </div>

          {/* Platform preset buttons */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {SIZE_PRESETS.map((p) => {
              const active = activeTool.type === "preset" && activeTool.key === p.label;
              return (
                <button key={p.label} type="button"
                  style={S.presetBtn(active)}
                  onClick={() => {
                    setActiveTool({ type: "preset", key: p.label });
                    applyPixelTarget(p.w, p.h);
                  }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{p.label}</span>
                  <span style={{ fontSize: 10, color: active ? "rgba(255,255,255,0.65)" : "#9a9a9a" }}>
                    {p.w} × {p.h} px
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Active selection hint ── */}
      {!locked && activeTool.type === "custom" && customW && customH && (
        <div style={{ fontSize: 11, color: "#5c6ac4", marginBottom: 8 }}>
          Ratio locked to {customW} × {customH} px
        </div>
      )}

      {/* ── Reset ── */}
      {showReset && (
        <button type="button"
          onClick={() => {
            cropperApiRef.current?.reset();
            setActiveTool({ type: "ratio", key: "Free" });
            setCustomW(""); setCustomH("");
            setCropTab("ratios");
            setRatio(NaN);
          }}
          style={{
            padding: "8px", border: "1px solid #d0d0d0",
            borderRadius: 6, fontSize: 13, cursor: "pointer",
            background: "#fff", color: "#6b6b6b", marginTop: 4,
          }}>
          ↺ Reset Crop
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SplitPreview — cropped image with grid overlay + individual tile thumbnails
// ─────────────────────────────────────────────────────────────────────────────

function SplitPreview({ croppedBlobUrl, gridSize }) {
  const [rows, cols] = gridSize.split("x").map(Number);
  const cellCount = rows * cols;
  const [naturalSize, setNaturalSize] = useState(null);

  useEffect(() => {
    if (!croppedBlobUrl) { setNaturalSize(null); return; }
    const img = new Image();
    img.onload = () => setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = croppedBlobUrl;
  }, [croppedBlobUrl]);

  const tileAspect = naturalSize
    ? `${naturalSize.w / cols} / ${naturalSize.h / rows}`
    : "1";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

      {/* Full image + grid overlay */}
      <div style={{
        position: "relative", width: "100%",
        height: CROP_CANVAS_HEIGHT,
        background: "#2b2b2b", borderRadius: 8,
        display: "flex", alignItems: "center", justifyContent: "center",
        overflow: "hidden",
      }}>
        <img
          src={croppedBlobUrl} alt="Split preview"
          style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", display: "block" }}
        />
        {/* Grid lines */}
        <div style={{
          position: "absolute", inset: 0,
          display: "grid",
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gridTemplateRows: `repeat(${rows}, 1fr)`,
          pointerEvents: "none",
        }}>
          {Array.from({ length: cellCount }).map((_, i) => (
            <div key={i} style={{ border: "1.5px solid rgba(255,255,255,0.55)" }} />
          ))}
        </div>
        {/* Badge */}
        <div style={{
          position: "absolute", bottom: 10, left: "50%", transform: "translateX(-50%)",
          background: "rgba(0,0,0,0.6)", color: "#fff",
          padding: "4px 14px", borderRadius: 20, fontSize: 12, fontWeight: 600,
          pointerEvents: "none", whiteSpace: "nowrap",
        }}>
          {cellCount} tile{cellCount > 1 ? "s" : ""} · {gridSize} grid
        </div>
      </div>

      {/* Individual tile thumbnails (background-position trick) */}
      {cellCount > 1 && (
        <div>
          <div style={{ ...S.sectionLabel, marginBottom: 6 }}>Tile preview</div>
          <div style={{
            display: "grid",
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gap: 4,
          }}>
            {Array.from({ length: cellCount }).map((_, i) => {
              const row = Math.floor(i / cols);
              const col = i % cols;
              const xPct = cols > 1 ? (col / (cols - 1)) * 100 : 50;
              const yPct = rows > 1 ? (row / (rows - 1)) * 100 : 50;
              return (
                <div key={i} style={{
                  aspectRatio: tileAspect,
                  borderRadius: 4, overflow: "hidden",
                  border: "1px solid #ddd", background: "#e8e8e8",
                }}>
                  <div style={{
                    width: "100%", height: "100%",
                    backgroundImage: `url(${croppedBlobUrl})`,
                    backgroundSize: `${cols * 100}% ${rows * 100}%`,
                    backgroundPosition: `${xPct}% ${yPct}%`,
                    backgroundRepeat: "no-repeat",
                  }} />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LibraryGrid
// ─────────────────────────────────────────────────────────────────────────────

function LibraryGrid({ files, selectedIds, onToggle, maxSelect, loading }) {
  if (loading) {
    return <div style={{ padding: "40px 0", textAlign: "center", color: "#888", fontSize: 13 }}>Loading store library…</div>;
  }
  if (!files.length) {
    return <div style={{ padding: "40px 0", textAlign: "center", color: "#aaa", fontSize: 13 }}>No images found. Upload some to your Shopify Files library first.</div>;
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))", gap: 8 }}>
      {files.map((f) => {
        const selected = selectedIds.includes(f.id);
        const atMax = !selected && selectedIds.length >= maxSelect;
        return (
          <div key={f.id}
            role="button"
            tabIndex={atMax ? -1 : 0}
            onClick={() => !atMax && onToggle(f)}
            onKeyDown={(e) => {
              if (!atMax && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault();
                onToggle(f);
              }
            }}
            aria-pressed={selected}
            aria-disabled={atMax}
            title={f.alt || f.image?.altText || ""}
            style={{
              position: "relative", aspectRatio: "1",
              borderRadius: 6, overflow: "hidden",
              border: selected ? "2px solid #1a1a1a" : "2px solid transparent",
              cursor: atMax ? "not-allowed" : "pointer",
              opacity: atMax ? 0.4 : 1,
              background: "#f0f0f0",
              transition: "border-color 0.12s, opacity 0.12s",
            }}>
            <img src={f.image.url} alt={f.alt || ""}
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            {f.image.width && (
              <div style={{
                position: "absolute", bottom: 3, left: 3,
                background: "rgba(0,0,0,0.55)", color: "#fff",
                fontSize: 9, padding: "1px 4px", borderRadius: 3,
              }}>
                {f.image.width}×{f.image.height}
              </div>
            )}
            {selected && (
              <div style={{
                position: "absolute", top: 4, right: 4,
                width: 20, height: 20, borderRadius: "50%",
                background: "#1a1a1a", color: "#fff",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 11, fontWeight: 700,
              }}>✓</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SourcePicker — Step 1
// ─────────────────────────────────────────────────────────────────────────────

function SourcePicker({ mode, loaderData, onConfirm }) {
  const fetcher = useFetcher();
  const inputRef = useRef(null);

  const [tab, setTab] = useState("library");
  const [libraryFiles, setLibraryFiles] = useState(loaderData?.files ?? []);
  const [pageInfo, setPageInfo] = useState(loaderData?.pageInfo ?? {});
  const [searchQ, setSearchQ] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedLibIds, setSelectedLibIds] = useState([]);
  const [selectedLibFiles, setSelectedLibFiles] = useState([]);
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [confirming, setConfirming] = useState(false);

  // Stable object URLs for the upload thumbnail strip.
  // Created AND revoked inside the same effect instance — see
  // useSafeObjectUrl above for why the old useMemo-at-render-time +
  // separate-effect-cleanup pattern breaks under StrictMode (dev double
  // invoke revokes the blob url with nothing to recreate it).
  const [uploadPreviews, setUploadPreviews] = useState([]);
  useEffect(() => {
    const urls = uploadedFiles.map((f) => URL.createObjectURL(f));
    setUploadPreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [uploadedFiles]);

  const maxSelect = mode === "collage" ? 9 : 1;
  const isMulti = mode === "collage";

  useEffect(() => {
    if (!fetcher.data?.files) return;
    if (fetcher.data._append) {
      setLibraryFiles((prev) => [...prev, ...fetcher.data.files]);
    } else {
      setLibraryFiles(fetcher.data.files);
    }
    setPageInfo(fetcher.data.pageInfo ?? {});
    setLoadingMore(false);
  }, [fetcher.data]);

  const toggleLibraryFile = (f) => {
    if (selectedLibIds.includes(f.id)) {
      setSelectedLibIds((p) => p.filter((id) => id !== f.id));
      setSelectedLibFiles((p) => p.filter((lf) => lf.id !== f.id));
    } else {
      setSelectedLibIds((p) => [...p, f.id]);
      setSelectedLibFiles((p) => [...p, f]);
    }
  };

  const handleUpload = (files) => {
    const valid = Array.from(files).filter((f) =>
      ["image/jpeg", "image/jpg", "image/png", "image/webp"].includes(f.type),
    );
    setUploadedFiles((prev) =>
      isMulti ? [...prev, ...valid].slice(0, maxSelect) : [valid[0]].filter(Boolean),
    );
  };

  const canConfirm = tab === "library" ? selectedLibIds.length > 0 : uploadedFiles.length > 0;

  const handleConfirm = async () => {
    setConfirming(true);
    try {
      let resolvedLibraryFiles = selectedLibFiles;
      // Fetch library images as same-origin blobs so Cropper.js canvas export
      // works without CORS taint (same pattern as layout-builder.js openCropModal)
      // NOTE: this must run for every mode — Collage cells are library images
      // too, and without this they fall back to the raw CDN url, which fails
      // to load once CropCanvas marks the <img> crossOrigin="anonymous".
      if (tab === "library") {
        resolvedLibraryFiles = await Promise.all(
          selectedLibFiles.map(async (f) => {
            try {
              const res = await fetch(f.image.url);
              const blob = await res.blob();
              return { ...f, _objectUrl: URL.createObjectURL(blob) };
            } catch (err) {
              console.error(`Could not pre-fetch image for cropping: ${f.image.url}`, err);
              return f;
            }
          }),
        );
      }

      onConfirm({
        source: tab,
        libraryFiles: resolvedLibraryFiles,
        uploadedFiles,
        originalFileId: tab === "library" && selectedLibFiles[0] ? selectedLibFiles[0].id : null,
      });
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* Mode hint */}
      <div style={{ padding: "10px 14px", background: "#f6f6f7", borderRadius: 8, fontSize: 13, color: "#4a4a4a" }}>
        {MODE_TABS.find((m) => m.key === mode)?.desc}
        {isMulti && ` Select up to ${maxSelect} images.`}
      </div>

      {/* Source tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid #e1e1e1" }}>
        {[{ key: "library", label: "🖼️  Store Library" }, { key: "upload", label: "📤  Upload from Computer" }].map(({ key, label }) => (
          <button key={key} type="button" onClick={() => setTab(key)} style={{
            padding: "9px 18px", fontSize: 13, cursor: "pointer",
            fontWeight: tab === key ? 700 : 400,
            color: tab === key ? "#1a1a1a" : "#6b6b6b",
            background: "transparent", border: "none",
            borderBottom: tab === key ? "2px solid #1a1a1a" : "2px solid transparent",
            marginBottom: -1,
          }}>
            {label}
          </button>
        ))}
      </div>

      {/* Library panel */}
      {tab === "library" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && fetcher.load(`/app/editor?q=${encodeURIComponent(searchQ)}`)}
              placeholder="Search by filename…"
              style={{ flex: 1, padding: "8px 12px", border: "1px solid #d0d0d0", borderRadius: 6, fontSize: 13 }}
            />
            <button type="button"
              onClick={() => fetcher.load(`/app/editor?q=${encodeURIComponent(searchQ)}`)}
              style={{ padding: "8px 16px", background: "#1a1a1a", color: "#fff", border: "none", borderRadius: 6, fontSize: 13, cursor: "pointer" }}>
              Search
            </button>
          </div>

          <LibraryGrid
            files={libraryFiles}
            selectedIds={selectedLibIds}
            onToggle={toggleLibraryFile}
            maxSelect={maxSelect}
            loading={fetcher.state !== "idle" && !loadingMore}
          />

          {isMulti && selectedLibIds.length > 0 && (
            <div style={{ fontSize: 12, color: "#888" }}>{selectedLibIds.length} / {maxSelect} selected</div>
          )}

          {pageInfo.hasNextPage && (
            <div style={{ textAlign: "center" }}>
              <button type="button" disabled={loadingMore}
                onClick={() => { setLoadingMore(true); fetcher.load(`/app/editor?after=${pageInfo.endCursor}&q=${searchQ}&_append=1`); }}
                style={{ padding: "7px 18px", fontSize: 13, cursor: "pointer", background: "#f0f0f0", border: "1px solid #d0d0d0", borderRadius: 6 }}>
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            </div>
          )}

          {loaderData?.error && (
            <div style={{ color: "#c0392b", fontSize: 13, padding: "8px 0" }}>
              ⚠️ {loaderData.error} — Make sure <strong>read_files</strong> scope is approved.
            </div>
          )}
        </div>
      )}

      {/* Upload panel */}
      {tab === "upload" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div
            role="button"
            tabIndex={0}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                inputRef.current?.click();
              }
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); handleUpload(e.dataTransfer.files); }}
            style={{
              border: "2px dashed #c1c1c1", borderRadius: 8,
              padding: "48px 24px", textAlign: "center",
              cursor: "pointer", background: "#fafafa",
            }}>
            <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp"
              multiple={isMulti} style={{ display: "none" }}
              onChange={(e) => handleUpload(e.target.files)} />
            <div style={{ fontSize: 32, marginBottom: 8 }}>📤</div>
            <div style={{ fontWeight: 600, fontSize: 14, color: "#333" }}>Click or drag to upload</div>
            <div style={{ fontSize: 12, color: "#888", marginTop: 4 }}>
              JPEG · PNG · WebP{isMulti ? ` · up to ${maxSelect} files` : ""}
            </div>
          </div>

          {uploadedFiles.length > 0 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {uploadedFiles.map((f, i) => (
                <div key={i} style={{
                  position: "relative", width: 72, height: 72,
                  borderRadius: 6, overflow: "hidden", border: "1px solid #e0e0e0",
                }}>
                  <img src={uploadPreviews[i]} alt=""
                    style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  <button type="button"
                    onClick={() => setUploadedFiles((p) => p.filter((_, j) => j !== i))}
                    style={{
                      position: "absolute", top: 2, right: 2,
                      background: "rgba(0,0,0,0.6)", color: "#fff", border: "none",
                      borderRadius: "50%", width: 18, height: 18, fontSize: 10,
                      cursor: "pointer", lineHeight: 1,
                    }}>✕</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button type="button" disabled={!canConfirm || confirming} onClick={handleConfirm}
          style={{
            padding: "10px 28px",
            background: canConfirm && !confirming ? "#1a1a1a" : "#ccc",
            color: "#fff", border: "none", borderRadius: 6,
            fontSize: 14, fontWeight: 600,
            cursor: canConfirm && !confirming ? "pointer" : "default",
          }}>
          {confirming ? "Preparing…" : "Continue →"}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// GridSizeSelector — visual grid buttons matching layout-builder style
// ─────────────────────────────────────────────────────────────────────────────

function GridSizeSelector({ gridSize, setGridSize, mode }) {
  return (
    <div>
      <div style={S.sectionLabel}>Grid Size</div>
      <div style={{ display: "flex", gap: 8 }}>
        {GRID_OPTIONS.map(({ value, cells }) => {
          const [r, c] = value.split("x").map(Number);
          const active = gridSize === value;
          return (
            <button key={value} type="button"
              onClick={() => setGridSize(value)}
              style={S.gridBtn(active)}>
              {/* Mini grid preview — same as layout-builder .plb-grid-preview */}
              <div style={{
                display: "grid",
                gridTemplateColumns: `repeat(${c}, 1fr)`,
                gridTemplateRows: `repeat(${r}, 1fr)`,
                width: 36, height: 36, gap: 2,
              }}>
                {Array.from({ length: cells }).map((_, i) => (
                  <div key={i} style={{ background: active ? "#1a1a1a" : "#c1c1c1", borderRadius: 2 }} />
                ))}
              </div>
              <span style={{ fontSize: 12, fontWeight: 600, color: active ? "#1a1a1a" : "#4a4a4a" }}>
                {value}
              </span>
              <span style={{ fontSize: 10, color: "#9a9a9a" }}>
                {cells} {mode === "split" ? "tile" : "cell"}{cells > 1 ? "s" : ""}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EditPanel — Step 2
// ─────────────────────────────────────────────────────────────────────────────

function EditPanel({ mode, pickedData, gridSize, setGridSize, onSave, saving }) {

  // Single ref holds the live Cropper API — avoids stale-closure issues in
  // button handlers (the core fix for ratio/reset buttons not working)
  const cropperApiRef = useRef(null);

  // Tracks whether the CURRENT CropCanvas instance has fired its `ready`
  // event yet. Gates every button that depends on a live Cropper instance
  // (Confirm Crop, Apply Crop & Next, Use Original, Save) so a person can
  // never click through to a null-ref race and see a "Cropper not ready"
  // alert — the button is simply disabled (with a loading label) until
  // Cropper is actually ready.
  const [cropperReady, setCropperReady] = useState(false);

  const [activeTool, setActiveTool] = useState({ type: "ratio", key: "Free" });
  const [customW, setCustomW] = useState("");
  const [customH, setCustomH] = useState("");

  // Split: "crop" → "preview"
  const [splitSubStep, setSplitSubStep] = useState("crop");
  const [splitCroppedBlob, setSplitCroppedBlob] = useState(null);
  const splitPreviewUrl = useSafeObjectUrl(splitCroppedBlob);

  // Collage: locked dimensions (from cell 1), current cell index, cropped blobs
  const [lockedDims, setLockedDims] = useState(null);
  const [cropIndex, setCropIndex] = useState(0);
  const [croppedPreviews, setCroppedPreviews] = useState({});

  // Revoke collage blob URLs on unmount
  useEffect(
    () => () => Object.values(croppedPreviews).forEach((u) => URL.revokeObjectURL(u)),
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const [rows, cols] = gridSize.split("x").map(Number);
  const cellCount = rows * cols;

  // ── Stable source URL (crop / split) ───────────────────────────────────────
  const uploadedFile0 = pickedData.source === "upload" ? pickedData.uploadedFiles[0] : null;
  const uploadedFileUrl = useSafeObjectUrl(uploadedFile0);
  const singleUrl = pickedData.source === "library"
    ? (pickedData.libraryFiles[0]?._objectUrl ?? pickedData.libraryFiles[0]?.image?.url ?? null)
    : uploadedFileUrl;

  // ── Stable collage image list ───────────────────────────────────────────────
  const collageImages = useMemo(
    () => [...pickedData.libraryFiles, ...pickedData.uploadedFiles].slice(0, cellCount),
    [pickedData.libraryFiles, pickedData.uploadedFiles, cellCount],
  );

  // ── Stable URL for current collage cell ────────────────────────────────────
  const currentCollageImg = collageImages[cropIndex] ?? null;
  const isCurrentCollageLib = currentCollageImg !== null && "image" in currentCollageImg;
  const collageUploadFile = (!isCurrentCollageLib && currentCollageImg) ? currentCollageImg : null;
  const collageUploadUrl = useSafeObjectUrl(collageUploadFile);
  const currentCollageSrc = currentCollageImg
    ? (currentCollageImg._objectUrl ?? (isCurrentCollageLib ? currentCollageImg.image.url : collageUploadUrl))
    : null;

  // ── Ratio for CropCanvas init ────────────────────────────────────────────────
  const currentLockedRatio = (() => {
    if (activeTool.type === "ratio") return RATIO_PRESETS.find((r) => r.label === activeTool.key)?.value ?? NaN;
    if (activeTool.type === "preset") { const p = SIZE_PRESETS.find((s) => s.label === activeTool.key); return p ? p.w / p.h : NaN; }
    if (activeTool.type === "custom") { const w = parseFloat(customW), h = parseFloat(customH); return (w > 0 && h > 0) ? w / h : NaN; }
    return NaN;
  })();

  // ── Collage: confirm crop for current cell ──────────────────────────────────
  const handleCollageCrop = useCallback(async () => {
    const api = cropperApiRef.current;
    if (!api) return;

    const blob = await api.getCroppedBlob();
    if (!blob) {
      // Mirror layout-builder "commitSkipAndContinue": lock natural dims instead
      const nat = api.getNaturalSize?.();
      if (!lockedDims && nat?.width && nat?.height) {
        setLockedDims({ width: nat.width, height: nat.height });
      }
    } else {
      // Lock dimensions from cell 1 crop (same as layout-builder cropApplyBtn)
      if (cropIndex === 0 && !lockedDims) {
        const dims = api.getCropDimensions();
        if (dims) setLockedDims(dims);
      }

      setCroppedPreviews((prev) => {
        if (prev[cropIndex]) URL.revokeObjectURL(prev[cropIndex]);
        return { ...prev, [cropIndex]: URL.createObjectURL(blob) };
      });
    }

    if (cropIndex < collageImages.length - 1) {
      setCropIndex((i) => i + 1);
      setActiveTool({ type: "ratio", key: "Free" });
      // The next cell's CropCanvas will fire its own ready event once
      // mounted; reset now so the button can't be double-clicked against
      // the previous (already-destroyed) Cropper instance in the interim.
      setCropperReady(false);
      cropperApiRef.current = null;
    }
  }, [cropIndex, collageImages.length, lockedDims]);

  // ── Split: confirm crop → move to grid-size step ────────────────────────────
  const handleSplitCropConfirm = useCallback(async () => {
    const api = cropperApiRef.current;
    if (!api) { alert("Cropper not ready — please wait a moment and try again."); return; }
    const blob = await api.getCroppedBlob();
    if (!blob) { alert("Could not read crop — please try again."); return; }
    setSplitCroppedBlob(new File([blob], "cropped.jpg", { type: "image/jpeg" }));
    setSplitSubStep("preview");
  }, []);

  // ── Save ────────────────────────────────────────────────────────────────────
  const handleSave = async (saveMode) => {
    if (mode === "crop") {
      const blob = await cropperApiRef.current?.getCroppedBlob();
      if (!blob) { alert("Could not read crop — please try again."); return; }
      const reader = new FileReader();
      reader.onload = () => onSave({
        intent: "crop", saveMode,
        imageData: reader.result,
        filename: pickedData.libraryFiles[0]?.alt || pickedData.uploadedFiles[0]?.name || "edited.jpg",
        originalFileId: pickedData.originalFileId,
      });
      reader.readAsDataURL(blob);

    } else if (mode === "split") {
      onSave({ intent: "split", saveMode, croppedFile: splitCroppedBlob, gridSize, originalFileId: pickedData.originalFileId });

    } else if (mode === "collage") {
      const cells = collageImages.slice(0, cellCount).map((img, i) => {
        const isLib = "image" in img;
        return {
          url: isLib && !croppedPreviews[i] ? img.image.url : null,
          filename: isLib ? (img.alt || "cell.jpg") : img.name,
          fromLibrary: isLib && !croppedPreviews[i],
        };
      });
      if (cells.length !== cellCount) { alert(`${gridSize} collage needs ${cellCount} images.`); return; }

      const croppedFiles = await Promise.all(
        collageImages.slice(0, cellCount).map(async (img, i) => {
          const blobUrl = croppedPreviews[i];
          if (!blobUrl) return null;
          const res = await fetch(blobUrl);
          const blob = await res.blob();
          return new File([blob], "image" in img ? (img.alt || `cell-${i}.jpg`) : img.name, { type: "image/jpeg" });
        }),
      );
      onSave({ intent: "collage", saveMode, cells, uploadedFiles: croppedFiles.filter(Boolean), gridSize, originalFileId: null });
    }
  };

  const canReplace = !!pickedData.originalFileId && mode !== "collage";
  const allCropped = mode === "collage"
    && Object.keys(croppedPreviews).length === collageImages.length
    && collageImages.length === cellCount;
  const splitReady = mode === "split" && splitSubStep === "preview" && !!splitCroppedBlob;
  // Crop mode additionally requires a live, ready Cropper instance since
  // Save reads directly from it; Split (once past step 1) and Collage
  // (once every cell is cropped) no longer need a live instance to save.
  const canSave = (mode === "crop" && cropperReady) || splitReady || allCropped;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>

      {/* ── Canvas / preview area ──────────────────────────────────────────── */}
      <div style={{ flex: 1, minWidth: 0 }}>

        {/* CROP mode */}
        {mode === "crop" && singleUrl && (
          <CropCanvas
            imageUrl={singleUrl}
            lockedRatio={currentLockedRatio}
            onReady={(api) => { cropperApiRef.current = api; }}
            onReadyChange={setCropperReady}
          />
        )}

        {/* SPLIT — sub-step: crop */}
        {mode === "split" && splitSubStep === "crop" && singleUrl && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 13, color: "#555", padding: "8px 12px", background: "#f6f6f7", borderRadius: 6 }}>
              <strong>Step 1 of 2:</strong> Adjust the crop frame, then confirm.
            </div>
            <CropCanvas
              imageUrl={singleUrl}
              lockedRatio={currentLockedRatio}
              onReady={(api) => { cropperApiRef.current = api; }}
              onReadyChange={setCropperReady}
            />
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button type="button"
                disabled={!cropperReady}
                onClick={handleSplitCropConfirm}
                style={{
                  padding: "10px 24px",
                  background: cropperReady ? "#1a1a1a" : "#ccc",
                  color: "#fff",
                  border: "none", borderRadius: 6, fontSize: 13, fontWeight: 600,
                  cursor: cropperReady ? "pointer" : "default",
                }}>
                {cropperReady ? "Confirm Crop → Choose Split" : "Loading…"}
              </button>
            </div>
          </div>
        )}

        {/* SPLIT — sub-step: preview */}
        {mode === "split" && splitSubStep === "preview" && splitPreviewUrl && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button type="button"
                onClick={() => {
                  setSplitSubStep("crop");
                  setSplitCroppedBlob(null);
                  cropperApiRef.current = null;
                  setCropperReady(false);
                }}
                style={{ padding: "6px 14px", background: "#f0f0f0", border: "1px solid #d0d0d0", borderRadius: 6, fontSize: 12, cursor: "pointer" }}>
                ← Re-crop
              </button>
              <div style={{ fontSize: 13, color: "#555" }}>
                <strong>Step 2 of 2:</strong> Choose grid size, then save.
              </div>
            </div>
            <SplitPreview croppedBlobUrl={splitPreviewUrl} gridSize={gridSize} />
          </div>
        )}

        {/* COLLAGE mode */}
        {mode === "collage" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

            {/* Active crop frame */}
            {!allCropped && currentCollageSrc && (
              <div>
                <div style={{
                  fontSize: 12, color: "#4a4a4a", marginBottom: 8,
                  padding: "7px 12px", background: "#f4f4f4",
                  borderRadius: 6, border: "1px solid #e8e8e8",
                }}>
                  {cropIndex > 0 && lockedDims
                    ? `🔒 Image ${cropIndex + 1} of ${collageImages.length} — locked to ${lockedDims.width} × ${lockedDims.height} px`
                    : `Cropping image ${cropIndex + 1} of ${collageImages.length} — set ratio below`}
                </div>
                <CropCanvas
                  imageUrl={currentCollageSrc}
                  lockedRatio={cropIndex === 0 ? currentLockedRatio : (lockedDims ? lockedDims.width / lockedDims.height : NaN)}
                  onReady={(api) => { cropperApiRef.current = api; }}
                  onReadyChange={setCropperReady}
                />
                <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end", gap: 8 }}>
                  {/* "Use Original" equivalent — skip crop, lock natural dims */}
                  {cropIndex === 0 && (
                    <button type="button"
                      disabled={!cropperReady}
                      onClick={async () => {
                        const nat = cropperApiRef.current?.getNaturalSize?.();
                        if (nat?.width && nat?.height && !lockedDims) {
                          setLockedDims({ width: nat.width, height: nat.height });
                        }
                        // Advance without storing a cropped blob for this cell
                        if (cropIndex < collageImages.length - 1) {
                          setCropIndex((i) => i + 1);
                          setActiveTool({ type: "ratio", key: "Free" });
                          setCropperReady(false);
                          cropperApiRef.current = null;
                        }
                      }}
                      style={{
                        padding: "9px 18px",
                        background: cropperReady ? "#f0f0f0" : "#f6f6f6",
                        color: cropperReady ? "#1a1a1a" : "#aaa",
                        border: "1px solid #d0d0d0", borderRadius: 6, fontSize: 13, fontWeight: 600,
                        cursor: cropperReady ? "pointer" : "default",
                      }}>
                      Use Original
                    </button>
                  )}
                  <button type="button"
                    disabled={!cropperReady}
                    onClick={handleCollageCrop}
                    style={{
                      padding: "9px 22px",
                      background: cropperReady ? "#1a1a1a" : "#ccc",
                      color: "#fff",
                      border: "none", borderRadius: 6, fontSize: 13, fontWeight: 600,
                      cursor: cropperReady ? "pointer" : "default",
                    }}>
                    {!cropperReady
                      ? "Loading…"
                      : (cropIndex < collageImages.length - 1 ? "Apply Crop & Next →" : "Apply Crop & Finish ✓")}
                  </button>
                </div>
              </div>
            )}

            {/* Thumbnail grid — shows actual cropped blobs */}
            <div style={{
              display: "grid",
              gridTemplateColumns: `repeat(${cols}, 1fr)`,
              gap: 4, borderRadius: 8, overflow: "hidden", background: "#ddd",
            }}>
              {Array.from({ length: cellCount }).map((_, i) => {
                const preview = croppedPreviews[i];
                const img = collageImages[i];
                const isLibI = img && "image" in img;
                const fallback = img ? (img._objectUrl ?? (isLibI ? img.image.url : null)) : null;
                const src = preview || fallback;
                const aspect = lockedDims ? `${lockedDims.width} / ${lockedDims.height}` : "1";
                const isReCroppable = croppedPreviews[i] !== undefined;
                const selectCell = () => {
                  if (isReCroppable) {
                    setCropIndex(i);
                    cropperApiRef.current = null;
                    setCropperReady(false);
                  }
                };

                return (
                  <div key={i}
                    role="button"
                    tabIndex={isReCroppable ? 0 : -1}
                    onClick={selectCell}
                    onKeyDown={(e) => {
                      if (isReCroppable && (e.key === "Enter" || e.key === " ")) {
                        e.preventDefault();
                        selectCell();
                      }
                    }}
                    title={croppedPreviews[i] ? "Click to re-crop" : undefined}
                    style={{
                      aspectRatio: aspect, background: "#f0f0f0", position: "relative",
                      cursor: croppedPreviews[i] !== undefined ? "pointer" : "default",
                      outline: cropIndex === i && !allCropped ? "2px solid #5c6ac4" : "none",
                    }}>
                    {src ? (
                      <>
                        <img src={src} alt=""
                          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                        {preview && (
                          <div style={{
                            position: "absolute", top: 3, right: 3,
                            background: "#1c6b3a", color: "#fff",
                            borderRadius: "50%", width: 16, height: 16,
                            fontSize: 9, display: "flex", alignItems: "center", justifyContent: "center",
                          }}>✓</div>
                        )}
                      </>
                    ) : (
                      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "#aaa" }}>
                        Cell {i + 1}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {!allCropped && collageImages.length < cellCount && (
              <div style={{ padding: "8px 12px", background: "#fff8e1", borderRadius: 6, fontSize: 13, color: "#7a5800" }}>
                ⚠️ {cellCount - collageImages.length} more image{cellCount - collageImages.length > 1 ? "s" : ""} needed. Go back and select more.
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Tool panel ─────────────────────────────────────────────────────── */}
      <div style={{
        width: 240, flexShrink: 0,
        display: "flex", flexDirection: "column", gap: 20,
        // Sticky so the panel stays visible while scrolling a tall canvas
        position: "sticky", top: 16,
      }}>

        {/* Crop controls — crop mode, split crop sub-step, collage while cropping */}
        {(mode === "crop"
          || (mode === "split" && splitSubStep === "crop")
          || (mode === "collage" && !allCropped)) && (
            <CropToolPanel
              cropperApiRef={cropperApiRef}
              activeTool={activeTool}
              setActiveTool={setActiveTool}
              customW={customW} setCustomW={setCustomW}
              customH={customH} setCustomH={setCustomH}
              locked={mode === "collage" && cropIndex > 0}
              lockedDims={lockedDims}
              showReset={mode === "crop" || (mode === "split" && splitSubStep === "crop")}
              disabled={!cropperReady}
            />
          )}

        {/* Grid size — split preview sub-step and collage */}
        {(splitReady || mode === "collage") && (
          <GridSizeSelector gridSize={gridSize} setGridSize={setGridSize} mode={mode} />
        )}

        {/* Divider */}
        <div style={{ borderTop: "1px solid #e8e8e8" }} />

        {/* Save buttons */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={S.sectionLabel}>Save to Shopify Files</div>

          <button type="button"
            disabled={saving || !canSave}
            onClick={() => handleSave("new")}
            style={{
              padding: "11px 14px", borderRadius: 6, fontSize: 13, fontWeight: 600,
              border: "none", cursor: saving || !canSave ? "default" : "pointer",
              background: saving || !canSave ? "#ccc" : "#1a1a1a",
              color: "#fff", opacity: saving ? 0.7 : 1,
            }}>
            {saving ? "Saving…" : (mode === "crop" && !cropperReady ? "Loading…" : "💾  Save as New Image")}
          </button>

          {canReplace && (
            <button type="button"
              disabled={saving || !canSave}
              onClick={() => handleSave("replace")}
              style={{
                padding: "11px 14px", borderRadius: 6, fontSize: 13, fontWeight: 600,
                border: "1px solid #1a1a1a", cursor: saving || !canSave ? "default" : "pointer",
                background: saving ? "#eee" : "#fff",
                color: "#1a1a1a", opacity: saving ? 0.7 : 1,
              }}>
              {saving ? "Saving…" : (mode === "crop" && !cropperReady ? "Loading…" : "🔄  Replace Original")}
            </button>
          )}

          {/* Context hints */}
          {!canReplace && mode !== "collage" && (
            <div style={{ fontSize: 11, color: "#aaa", lineHeight: 1.5 }}>
              Replace is available when the source came from your store library.
            </div>
          )}
          {mode === "split" && splitSubStep === "crop" && (
            <div style={{ fontSize: 11, color: "#aaa", lineHeight: 1.5 }}>
              Confirm your crop first, then choose the grid size.
            </div>
          )}
          {mode === "collage" && !allCropped && collageImages.length > 0 && (
            <div style={{ fontSize: 11, color: "#aaa", lineHeight: 1.5 }}>
              Apply crop for all {cellCount} images to enable saving.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EditorPage — root component
// ─────────────────────────────────────────────────────────────────────────────

export default function EditorPage() {
  const loaderData = useLoaderData();
  const fetcher = useFetcher();

  const [step, setStep] = useState("pick");
  const [mode, setMode] = useState("crop");
  const [gridSize, setGridSize] = useState("2x2");
  const [pickedData, setPicked] = useState(null);
  const [toast, setToast] = useState(null);

  const saving = fetcher.state !== "idle";

  useEffect(() => {
    if (!fetcher.data) return;
    if (fetcher.data.success) {
      const c = fetcher.data.count || 1;
      const verb = fetcher.data.saveMode === "replace" ? "replaced" : "saved";
      setToast({ message: `✓ ${c} image${c > 1 ? "s" : ""} ${verb} to your Shopify Files library.`, tone: "success" });
      setTimeout(() => { setStep("pick"); setPicked(null); setToast(null); }, 3000);
    } else {
      setToast({ message: `Error: ${fetcher.data.error || "Something went wrong."}`, tone: "error" });
      setTimeout(() => setToast(null), 6000);
    }
  }, [fetcher.data]);

  const handlePicked = (data) => { setPicked(data); setStep("edit"); };

  const handleSave = useCallback(async ({
    intent, saveMode, imageData, filename, originalFileId,
    croppedFile, cells, uploadedFiles: ufList, gridSize: gs,
  }) => {
    const fd = new FormData();
    fd.append("intent", intent);
    fd.append("saveMode", saveMode);
    fd.append("gridSize", gs || gridSize);
    if (originalFileId) fd.append("originalFileId", originalFileId);

    if (intent === "crop") {
      fd.append("imageData", imageData);
      fd.append("filename", filename);
    } else if (intent === "split") {
      fd.append("croppedImage", croppedFile, croppedFile.name);
    } else if (intent === "collage") {
      fd.append("cells", JSON.stringify(cells));
      if (ufList?.length) {
        let fileIdx = 0;
        cells.forEach((cell, i) => {
          if (!cell.fromLibrary) {
            const f = ufList[fileIdx++];
            if (f) fd.append(`file_${i}`, f, f.name);
          }
        });
      }
    }

    fetcher.submit(fd, { method: "post", encType: "multipart/form-data" });
  }, [fetcher, gridSize]);

  const switchMode = (m) => { setMode(m); setStep("pick"); setPicked(null); };

  return (
    <s-page heading="Image Editor">

      {toast && (
        <div style={{
          position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)",
          zIndex: 9999,
          background: toast.tone === "success" ? "#1c6b3a" : "#c0392b",
          color: "#fff", padding: "12px 28px", borderRadius: 8,
          fontSize: 14, fontWeight: 600,
          boxShadow: "0 4px 24px rgba(0,0,0,0.22)",
          maxWidth: 520, textAlign: "center",
        }}>
          {toast.message}
        </div>
      )}

      <s-section>

        {/* Mode tabs */}
        <div style={{ display: "flex", borderBottom: "1px solid #e1e1e1", marginBottom: 24 }}>
          {MODE_TABS.map(({ key, icon, label }) => (
            <button key={key} type="button" onClick={() => switchMode(key)} style={{
              padding: "10px 22px", fontSize: 13, cursor: "pointer",
              fontWeight: mode === key ? 700 : 400,
              color: mode === key ? "#1a1a1a" : "#6b6b6b",
              background: "transparent", border: "none",
              borderBottom: mode === key ? "2px solid #1a1a1a" : "2px solid transparent",
              marginBottom: -1,
            }}>
              {icon} {label}
            </button>
          ))}
        </div>

        {/* Breadcrumb */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20, fontSize: 13 }}>
          <span
            role="button" tabIndex={step === "edit" ? 0 : -1}
            onClick={() => { if (step === "edit") switchMode(mode); }}
            onKeyDown={(e) => { if (step === "edit" && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); switchMode(mode); } }}
            style={{
              cursor: step === "edit" ? "pointer" : "default",
              color: step === "edit" ? "#5c6ac4" : "#1a1a1a",
              fontWeight: step === "edit" ? 600 : 400,
            }}>
            1. Select Image{mode === "collage" ? "s" : ""}
          </span>
          <span style={{ color: "#ccc" }}>›</span>
          <span style={{ color: step === "edit" ? "#1a1a1a" : "#ccc", fontWeight: step === "edit" ? 600 : 400 }}>
            2. Edit &amp; Save
          </span>
        </div>

        {step === "pick" && (
          <SourcePicker key={mode} mode={mode} loaderData={loaderData} onConfirm={handlePicked} />
        )}

        {step === "edit" && pickedData && (
          <EditPanel
            mode={mode}
            pickedData={pickedData}
            gridSize={gridSize}
            setGridSize={setGridSize}
            onSave={handleSave}
            saving={saving}
          />
        )}

      </s-section>
    </s-page>
  );
}

export const headers = (h) => boundary.headers(h);