/* eslint-env node */
/* eslint-disable react/prop-types */
// app/routes/app.editor.jsx

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useLoaderData, useFetcher } from "react-router";
import { authenticate }  from "../shopify.server";
import { boundary }      from "@shopify/shopify-app-react-router/server";
import { join }          from "path";
import { mkdir, writeFile, unlink, readFile } from "fs/promises";
import sharp             from "sharp";
import {
  splitImageIntoGrid,
  composePhotoCollage,
  processSingleImage,
} from "../lib/image.processing.server";

import "cropperjs/dist/cropper.css";

const UPLOAD_TMP = join(process.cwd(), "public", "uploads", "_tmp");

// ─────────────────────────────────────────────────────────────────────────────
// Design tokens
// ─────────────────────────────────────────────────────────────────────────────

const C = {
  bg:            "#ffffffff",
  bgSecondary:   "#181818ec",
  card:          "#181a20ff",
  cardElevated:  "#20242D",
  border:        "rgba(255, 255, 255, 0.43)",
  borderStrong:  "rgba(255,255,255,0.12)",
  accent:        "#00C875",
  accentSecond:  "#5AC8FA",
  gradient:      "linear-gradient(135deg, #7C4DFF 0%, #B26DFF 100%)",
  textPrimary:   "#FFFFFF",
  textSecondary: "#d1d7dfff",
  muted:         "#b1b7c0ff",
  success:       "#00C875",
  warning:       "#F5A623",
  danger:        "#FF5A5F",
};

// ─────────────────────────────────────────────────────────────────────────────
// SVG Icons (inline, no external package)
// ─────────────────────────────────────────────────────────────────────────────

const IP = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" };

function Ico({ size = 16, ...rest }) {
  return <svg width={size} height={size} {...IP} {...rest} />;
}

function IcoCrop({ size, ...p })       { return <Ico size={size} {...p}><path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/></Ico>; }
function IcoSplit({ size, ...p })      { return <Ico size={size} {...p}><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/></Ico>; }
function IcoCollage({ size, ...p })    { return <Ico size={size} {...p}><rect x="3" y="3" width="7" height="11" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="18" width="7" height="3" rx="1"/></Ico>; }
function IcoImage({ size, ...p })      { return <Ico size={size} {...p}><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></Ico>; }
function IcoUpload({ size, ...p })     { return <Ico size={size} {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></Ico>; }
function IcoSave({ size, ...p })       { return <Ico size={size} {...p}><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/></Ico>; }
function IcoRefresh({ size, ...p })    { return <Ico size={size} {...p}><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></Ico>; }
function IcoSearch({ size, ...p })     { return <Ico size={size} {...p}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></Ico>; }
function IcoCheck({ size, ...p })      { return <Ico size={size} {...p}><polyline points="20 6 9 17 4 12"/></Ico>; }
function IcoArrowRight({ size, ...p }) { return <Ico size={size} {...p}><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></Ico>; }
function IcoArrowLeft({ size, ...p })  { return <Ico size={size} {...p}><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></Ico>; }
function IcoSkip({ size, ...p })       { return <Ico size={size} {...p}><path d="M5 4l10 8-10 8V4z"/><line x1="19" y1="5" x2="19" y2="19"/></Ico>; }
function IcoX({ size, ...p })          { return <Ico size={size} {...p}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></Ico>; }
function IcoLock({ size, ...p })       { return <Ico size={size} {...p}><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></Ico>; }
function IcoWarn({ size, ...p })       { return <Ico size={size} {...p}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></Ico>; }
function IcoGrid({ size, ...p })       { return <Ico size={size} {...p}><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></Ico>; }

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
  const url   = new URL(request.url);
  const after = url.searchParams.get("after") || null;
  const q     = url.searchParams.get("q")     || "";

  try {
    const queryStr = ["media_type:IMAGE status:READY", q ? `filename:*${q}*` : ""]
      .filter(Boolean).join(" ");

    const res  = await admin.graphql(FILES_QUERY, {
      variables: { first: 48, after: after || undefined, query: queryStr },
    });
    const json = await res.json();
    const edges = (json.data?.files?.edges ?? []).filter((e) => e.node?.image);

    return {
      files:    edges.map((e) => ({ cursor: e.cursor, ...e.node })),
      pageInfo: json.data?.files?.pageInfo ?? { hasNextPage: false, endCursor: null },
      q,
      error:    null,
    };
  } catch (err) {
    console.error("Library loader error:", err);
    return { files: [], pageInfo: { hasNextPage: false, endCursor: null }, q, error: err.message };
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Shopify Files upload helper
// ─────────────────────────────────────────────────────────────────────────────

// Shopify Admin Files hard-rejects any image whose width × height exceeds this.
// We defensively downscale (preserving aspect ratio) right before upload so
// large collage / split composites never get bounced by Shopify's API.
const MAX_MEGAPIXELS = 25_000_000; // 25 MP, matches Shopify's stated limit

async function ensureUnderMegapixelLimit(buffer) {
  const meta = await sharp(buffer).metadata();
  const { width, height } = meta;
  if (!width || !height) return buffer;

  const pixels = width * height;
  if (pixels <= MAX_MEGAPIXELS) return buffer;

  const scale     = Math.sqrt(MAX_MEGAPIXELS / pixels);
  const newWidth  = Math.max(1, Math.floor(width  * scale));
  const newHeight = Math.max(1, Math.floor(height * scale));

  console.warn(
    `Output ${width}x${height} (${(pixels / 1_000_000).toFixed(1)}MP) exceeds Shopify's ` +
    `25MP limit — resizing to ${newWidth}x${newHeight} before upload.`,
  );

  return sharp(buffer)
    .resize(newWidth, newHeight, { fit: "inside" })
    .jpeg({ quality: 92 })
    .toBuffer();
}

async function uploadBufferToShopifyFiles(admin, buffer, filename) {
  const stageRes  = await admin.graphql(STAGED_UPLOAD_CREATE, {
    variables: {
      input: [{
        filename,
        mimeType:   "image/jpeg",
        fileSize:   String(buffer.length),
        resource:   "IMAGE",
        httpMethod: "POST",
      }],
    },
  });
  const stageJson = await stageRes.json();
  const errs      = stageJson.data?.stagedUploadsCreate?.userErrors ?? [];
  if (errs.length) throw new Error(errs.map((e) => e.message).join(", "));

  const target = stageJson.data?.stagedUploadsCreate?.stagedTargets?.[0];
  if (!target) throw new Error("Shopify did not return a staged upload target.");

  const uploadForm = new FormData();
  for (const { name, value } of target.parameters) uploadForm.append(name, value);
  uploadForm.append("file", new Blob([buffer], { type: "image/jpeg" }), filename);

  const uploadRes = await fetch(target.url, { method: "POST", body: uploadForm });
  if (!uploadRes.ok) throw new Error(`Staged upload failed with status ${uploadRes.status}`);

  const createRes  = await admin.graphql(FILE_CREATE, {
    variables: {
      files: [{
        alt:            filename,
        contentType:    "IMAGE",
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
  const shop     = session.shop;
  const formData = await request.formData();
  const intent   = formData.get("intent");
  const saveMode = formData.get("saveMode");
  const origId   = formData.get("originalFileId") || null;
  const gridSize = formData.get("gridSize") || "2x2";

  await mkdir(UPLOAD_TMP, { recursive: true });

  try {
    let outputBuffers = [];

    if (intent === "crop") {
      const dataUrl  = formData.get("imageData");
      const filename = formData.get("filename") || "edited.jpg";
      if (!dataUrl) return { success: false, error: "No image data received." };
      const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");
      const buf    = await sharp(Buffer.from(base64, "base64")).jpeg({ quality: 92 }).toBuffer();
      outputBuffers = [{ buffer: buf, filename }];
    }

    else if (intent === "split") {
      const croppedFile = formData.get("croppedImage");
      const tileMode    = formData.get("tileMode") || "single";
      const baseFilename = (formData.get("filename") || "image").replace(/\.[^./]+$/, "");

      if (!croppedFile || typeof croppedFile === "string") {
        return { success: false, error: "No cropped image provided for split." };
      }
      const tmpPath = join(UPLOAD_TMP, `split-${Date.now()}.jpg`);
      await writeFile(tmpPath, Buffer.from(await croppedFile.arrayBuffer()));

      const compositionId = `editor-${Date.now()}`;
      const [rows, cols]  = gridSize.split("x").map(Number);

      if (tileMode === "tiles" && rows * cols > 1) {
        const meta  = await sharp(tmpPath).metadata();
        const fullW = meta.width  ?? 0;
        const fullH = meta.height ?? 0;
        const tileW = Math.floor(fullW / cols);
        const tileH = Math.floor(fullH / rows);

        outputBuffers = [];
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const left   = c * tileW;
            const top    = r * tileH;
            const width  = c === cols - 1 ? fullW - left : tileW;
            const height = r === rows - 1 ? fullH - top  : tileH;
            const tileBuf = await sharp(tmpPath)
              .extract({ left, top, width, height })
              .jpeg({ quality: 92 })
              .toBuffer();
            const tileIndex = r * cols + c + 1;
            outputBuffers.push({ buffer: tileBuf, filename: `${baseFilename}-tile-${tileIndex}.jpg` });
          }
        }
        await unlink(tmpPath).catch(() => {});
      } else {
        const result = (rows === 1 && cols === 1)
          ? await processSingleImage({ sourcePath: tmpPath, shop, compositionId })
          : await splitImageIntoGrid({ sourcePath: tmpPath, gridSize, shop, compositionId });

        await unlink(tmpPath).catch(() => {});

        const previewPath = join(process.cwd(), "public", result.previewUrl);
        const buf         = await readFile(previewPath);
        outputBuffers     = [{ buffer: buf, filename: "split-grid.jpg" }];
      }
    }

    else if (intent === "collage") {
      const cellsJson     = formData.get("cells");
      const cells         = JSON.parse(cellsJson);
      const [rows, cols]  = gridSize.split("x").map(Number);
      const expectedCount = rows * cols;

      if (cells.length !== expectedCount) {
        return {
          success: false,
          error: `${gridSize} collage needs exactly ${expectedCount} images. You provided ${cells.length}.`,
        };
      }

      const tmpPaths = [];
      for (let i = 0; i < cells.length; i++) {
        const tmpPath      = join(UPLOAD_TMP, `collage-${Date.now()}-${i}.jpg`);
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

      await Promise.all(tmpPaths.map((p) => unlink(p).catch(() => {})));

      const previewPath = join(process.cwd(), "public", result.previewUrl);
      const buf         = await readFile(previewPath);
      outputBuffers     = [{ buffer: buf, filename: "collage.jpg" }];
    }

    else {
      return { success: false, error: `Unknown intent: ${intent}` };
    }

    const savedFiles = [];
    for (const { buffer, filename } of outputBuffers) {
      // Guard against Shopify's 25MP-per-file limit before every upload —
      // applies uniformly to crop, split, and collage outputs.
      const safeBuffer = await ensureUnderMegapixelLimit(buffer);
      savedFiles.push(await uploadBufferToShopifyFiles(admin, safeBuffer, filename));
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
  { label: "Free",    value: NaN },
  { label: "1:1",     value: 1 },
  { label: "4:3",     value: 4 / 3 },
  { label: "3:4",     value: 3 / 4 },
  { label: "16:9",    value: 16 / 9 },
  { label: "9:16",    value: 9 / 16 },
];

const SIZE_PRESETS = [
  { label: "Shopify Product",    w: 2048, h: 2048 },
  { label: "Instagram Square",   w: 1080, h: 1080 },
  { label: "Instagram Portrait", w: 1080, h: 1350 },
  { label: "FB / OG Image",      w: 1200, h:  628 },
  { label: "Stories / TikTok",   w: 1080, h: 1920 },
  { label: "Twitter / X Banner", w: 1500, h:  500 },
];

const GRID_OPTIONS = [
  { value: "1x1", cells: 1 },
  { value: "2x2", cells: 4 },
  { value: "3x3", cells: 9 },
];

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_UPLOAD_LABEL = "10 MB";

// Gap between tiles in the split preview — white stripe = visual divider
const TILE_GAP = 10; // px

const SPLIT_TILE_MODE_OPTIONS = [
  { key: "single", label: "Single Image",   desc: "One merged image" },
  { key: "tiles",  label: "Separate Tiles", desc: "Each tile as its own file" },
];

const MODE_TABS = [
  { key: "crop",    Icon: IcoCrop,    label: "Crop & Resize", desc: "Crop an image to any aspect ratio or custom size." },
  { key: "split",   Icon: IcoSplit,   label: "Split Grid",    desc: "Crop an image then split it into equal tiles." },
  { key: "collage", Icon: IcoCollage, label: "Collage",       desc: "Combine multiple images into a single grid layout." },
];

const CROP_CANVAS_HEIGHT = 440;

// ─────────────────────────────────────────────────────────────────────────────
// Shared style helpers
// ─────────────────────────────────────────────────────────────────────────────

const pill = (active) => ({
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  padding: "6px 14px",
  borderRadius: 6, border: "1px solid",
  fontSize: 12, fontWeight: 600, cursor: "pointer",
  background:  active ? C.accent      : C.cardElevated,
  color:       active ? "#000"        : C.textSecondary,
  borderColor: active ? C.accent      : C.border,
  transition:  "background 0.12s, color 0.12s, border-color 0.12s",
});

const panelLabel = {
  fontSize: 10, fontWeight: 700, color: C.muted,
  letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8,
};

const divider = { borderTop: `1px solid ${C.border}`, margin: "16px 0" };

// ─────────────────────────────────────────────────────────────────────────────
// useSafeObjectUrl
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
// ─────────────────────────────────────────────────────────────────────────────

function CropCanvas({ imageUrl = null, onReady, onReadyChange, lockedRatio, onError }) {
  const imgRef     = useRef(null);
  const cropperRef = useRef(null);
  const [ready, setReady]         = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    setReady(false);
    setLoadError(false);
    onReadyChange?.(false);

    const imgEl = imgRef.current;
    if (!imgEl || !imageUrl) return;

    let cancelled = false;

    import("cropperjs").then((mod) => {
      if (cancelled) return;
      const Cropper = mod.default ?? mod.Cropper ?? mod;

      if (cropperRef.current) {
        cropperRef.current.destroy();
        cropperRef.current = null;
      }

      imgEl.onerror = () => {
        if (!imgRef.current || cancelled) return;
        setLoadError(true);
        onReadyChange?.(false);
        onError?.();
      };

      imgEl.onload = () => {
        if (!imgRef.current || cancelled) return;
        const instance = new Cropper(imgEl, {
          viewMode:     1,
          autoCropArea: 0.85,
          responsive:   true,
          background:   false,
          aspectRatio:  isNaN(lockedRatio) ? NaN : lockedRatio,
          ready() {
            if (cancelled) return;
            setReady(true);
            onReadyChange?.(true);
            onReady?.({
              setAspectRatio: (r) => cropperRef.current?.setAspectRatio(isNaN(r) ? NaN : r),
              reset:          ()  => cropperRef.current?.reset(),
              getCroppedBlob: ()  =>
                new Promise((resolve) => {
                  const canvas = cropperRef.current?.getCroppedCanvas({
                    maxWidth: 4096, maxHeight: 4096, imageSmoothingQuality: "high",
                  });
                  if (!canvas) { resolve(null); return; }
                  canvas.toBlob((blob) => resolve(blob ?? null), "image/jpeg", 0.92);
                }),
              getCropDimensions: () => {
                const d = cropperRef.current?.getData(true);
                return d ? { width: d.width, height: d.height } : null;
              },
              getNaturalSize: () => ({
                width:  imgEl.naturalWidth,
                height: imgEl.naturalHeight,
              }),
            });
          },
        });
        cropperRef.current = instance;
      };

      imgEl.src = imageUrl;
    });

    return () => {
      cancelled = true;
      if (cropperRef.current) { cropperRef.current.destroy(); cropperRef.current = null; }
      if (imgEl) { imgEl.onload = null; imgEl.onerror = null; imgEl.src = ""; }
    };
  }, [imageUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{
      width: "100%", height: CROP_CANVAS_HEIGHT,
      background: "#0d0d0f", borderRadius: 8,
      overflow: "hidden", display: "flex",
      alignItems: "center", justifyContent: "center",
      position: "relative", border: `1px solid ${C.border}`,
    }}>
      {!ready && !loadError && (
        <div style={{
          position: "absolute", inset: 0,
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          gap: 10, color: C.muted, fontSize: 12, pointerEvents: "none",
        }}>
          <div style={{
            width: 26, height: 26, borderRadius: "50%",
            border: `2px solid ${C.border}`, borderTopColor: C.accent,
            animation: "editorSpin 0.8s linear infinite",
          }} />
          <span>Loading editor…</span>
        </div>
      )}

      {loadError && (
        <div style={{
          position: "absolute", inset: 0,
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          gap: 8, color: C.danger, fontSize: 13, padding: "0 24px", textAlign: "center",
        }}>
          <IcoWarn size={28} stroke={C.danger} />
          <span style={{ color: C.textSecondary }}>Couldn&rsquo;t load this image.</span>
        </div>
      )}

      <img
        ref={imgRef}
        alt="Crop"
        crossOrigin={
          typeof imageUrl === "string" && (imageUrl.startsWith("blob:") || imageUrl.startsWith("data:"))
            ? undefined : "anonymous"
        }
        style={{
          display: "block", maxWidth: "100%", maxHeight: "100%", objectFit: "contain",
          opacity: ready ? 1 : 0, transition: "opacity 0.15s ease",
        }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CropToolPanel
// ─────────────────────────────────────────────────────────────────────────────

function CropToolPanel({
  cropperApiRef, activeTool, setActiveTool,
  customW, setCustomW, customH, setCustomH,
  locked, lockedDims, showReset, disabled = false,
}) {
  const [cropTab, setCropTab] = useState("ratios");

  const setRatio = (r) => cropperApiRef.current?.setAspectRatio(isNaN(r) ? NaN : r);

 const applyPixelTarget = (w, h, toolType = "custom", toolKey = `${w}x${h}`) => {
    if (!w || !h || w <= 0 || h <= 0) return;
    setActiveTool({ type: toolType, key: toolKey });
    setCustomW(String(w)); setCustomH(String(h));
    setRatio(w / h);
  };

  return (
    <div style={{
      opacity: disabled ? 0.45 : 1,
      pointerEvents: disabled ? "none" : "auto",
      transition: "opacity 0.12s",
    }}>

      {locked && lockedDims && (
        <div style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "8px 10px", marginBottom: 12,
          background: C.cardElevated, borderRadius: 6,
          fontSize: 11, color: C.textSecondary, border: `1px solid ${C.border}`,
        }}>
          <IcoLock size={12} stroke={C.accentSecond} />
          Locked {lockedDims.width} × {lockedDims.height} px
        </div>
      )}

      {!locked && (
        <div style={{ display: "flex", gap: 2, marginBottom: 12, background: C.cardElevated, borderRadius: 6, padding: 3 }}>
          {["ratios", "presets"].map((t) => (
            <button key={t} type="button" onClick={() => setCropTab(t)} style={{
              flex: 1, padding: "6px", borderRadius: 4, border: "none",
              fontSize: 11, fontWeight: 600, cursor: "pointer",
              background: cropTab === t ? C.accent : "transparent",
              color:      cropTab === t ? C.textPrimary : C.muted,
              transition: "background 0.12s, color 0.12s",
            }}>
              {t === "ratios" ? "Aspect Ratios" : "Presets"}
            </button>
          ))}
        </div>
      )}

      {!locked && cropTab === "ratios" && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 12 }}>
          {RATIO_PRESETS.map((p) => {
            const active = activeTool.type === "ratio" && activeTool.key === p.label;
            return (
              <button key={p.label} type="button" style={pill(active)}
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

      {!locked && cropTab === "presets" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <input type="number" placeholder="W" value={customW} min={1}
              onChange={(e) => setCustomW(e.target.value)}
              style={{ width: 56, padding: "6px 8px", background: C.cardElevated, border: `1px solid ${C.border}`, borderRadius: 5, fontSize: 12, color: C.textPrimary }} />
            <span style={{ color: C.muted, fontSize: 12 }}>×</span>
            <input type="number" placeholder="H" value={customH} min={1}
              onChange={(e) => setCustomH(e.target.value)}
              style={{ width: 56, padding: "6px 8px", background: C.cardElevated, border: `1px solid ${C.border}`, borderRadius: 5, fontSize: 12, color: C.textPrimary }} />
            <button type="button"
              onClick={() => { const w = parseInt(customW, 10); const h = parseInt(customH, 10); if (w > 0 && h > 0) applyPixelTarget(w, h); }}
              style={{ padding: "6px 10px", background: C.accent, color: "#000", border: "none", borderRadius: 5, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
              Apply
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {SIZE_PRESETS.map((p) => {
              const active = activeTool.type === "preset" && activeTool.key === p.label;
              return (
                <button key={p.label} type="button"
                  onClick={() => applyPixelTarget(p.w, p.h, "preset", p.label)}
                  style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "7px 10px", borderRadius: 6, border: `1px solid ${active ? C.accent : C.border}`,
                    background: active ? C.accent : C.cardElevated,
                    cursor: "pointer",
                  }}>
                  <span style={{ fontSize: 12, fontWeight: 500, color: active ? "#000" : C.textSecondary }}>{p.label}</span>
                  <span style={{ fontSize: 10, color: active ? "#000" : C.muted }}>{p.w}×{p.h}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

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
            display: "flex", alignItems: "center", gap: 6, width: "100%",
            padding: "8px 10px", border: `1px solid ${C.border}`,
            borderRadius: 6, fontSize: 12, cursor: "pointer",
            background: C.cardElevated, color: C.textSecondary,
          }}>
          <IcoRefresh size={12} />
          Reset Crop
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SplitTilePreview
// Gap background = white → white divider lines between tiles
// ─────────────────────────────────────────────────────────────────────────────

function SplitTilePreview({ croppedBlobUrl, gridSize }) {
  const [rows, cols] = gridSize.split("x").map(Number);
  const cellCount    = rows * cols;
  const [naturalSize, setNaturalSize] = useState(null);

  useEffect(() => {
    if (!croppedBlobUrl) { setNaturalSize(null); return; }
    const img  = new Image();
    img.onload = () => setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
    img.src    = croppedBlobUrl;
  }, [croppedBlobUrl]);

  const tileAspect = naturalSize
    ? `${naturalSize.w / cols} / ${naturalSize.h / rows}`
    : "1";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/*
        White divider lines = white gap background between tiles.
        gap: TILE_GAP gives the 18 px white stripe between each cell.
        background: "#ffffff" is what shows through the gap.
      */}
      <div style={{
        display: "grid",
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gap: TILE_GAP,
        borderRadius: 8, overflow: "hidden",
        background: "#ffffff",          // ← white gap = white divider lines
        padding: 0,
      }}>
        {Array.from({ length: cellCount }).map((_, i) => {
          const row  = Math.floor(i / cols);
          const col  = i % cols;
          const xPct = cols > 1 ? (col / (cols - 1)) * 100 : 50;
          const yPct = rows > 1 ? (row / (rows - 1)) * 100 : 50;
          return (
            <div key={i} style={{ aspectRatio: tileAspect, overflow: "hidden" }}>
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

      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
        <IcoGrid size={12} stroke={C.muted} />
        <span style={{ fontSize: 11, color: C.muted }}>
          {cellCount} tile{cellCount > 1 ? "s" : ""} · {gridSize} grid
        </span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LibraryGrid
// ─────────────────────────────────────────────────────────────────────────────

function LibraryGrid({ files, selectedIds, onToggle, maxSelect, loading }) {
  if (loading) {
    return (
      <div style={{ padding: "40px 0", textAlign: "center", color: C.muted, fontSize: 13 }}>
        <div style={{ width: 20, height: 20, margin: "0 auto 8px", borderRadius: "50%", border: `2px solid ${C.border}`, borderTopColor: C.accent, animation: "editorSpin 0.8s linear infinite" }} />
        Loading library…
      </div>
    );
  }
  if (!files.length) {
    return (
      <div style={{ padding: "40px 0", textAlign: "center", color: C.muted, fontSize: 13 }}>
        <div style={{ marginBottom: 8 }}><IcoImage size={32} stroke={C.border} /></div>
        <div>No images found. Upload some to your Shopify Files library first.</div>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(90px, 1fr))", gap: 6 }}>
      {files.map((f) => {
        const selected = selectedIds.includes(f.id);
        const atMax    = !selected && selectedIds.length >= maxSelect;
        return (
          <div key={f.id}
            role="button" tabIndex={atMax ? -1 : 0}
            onClick={() => !atMax && onToggle(f)}
            onKeyDown={(e) => { if (!atMax && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onToggle(f); } }}
            aria-pressed={selected} aria-disabled={atMax}
            title={f.alt || f.image?.altText || ""}
            style={{
              position: "relative", aspectRatio: "1",
              borderRadius: 6, overflow: "hidden",
              border: selected ? `2px solid ${C.accent}` : `2px solid ${C.border}`,
              cursor: atMax ? "not-allowed" : "pointer",
              opacity: atMax ? 0.35 : 1,
              background: C.cardElevated,
              transition: "border-color 0.12s, opacity 0.12s",
            }}>
            <img src={f.image.url} alt={f.alt || ""}
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            {f.image.width && (
              <div style={{
                position: "absolute", bottom: 3, left: 3,
                background: "rgba(0,0,0,0.7)", color: "#fff",
                fontSize: 8, padding: "1px 4px", borderRadius: 3,
              }}>
                {f.image.width}×{f.image.height}
              </div>
            )}
            {selected && (
              <div style={{
                position: "absolute", top: 4, right: 4,
                width: 18, height: 18, borderRadius: "50%",
                background: C.accent, display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <IcoCheck size={10} stroke="#000" strokeWidth={3} />
              </div>
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

function SourcePicker({ mode, loaderData, onConfirm, onWarning }) {
  const fetcher  = useFetcher();
  const inputRef = useRef(null);

  const [tab,              setTab]              = useState("library");
  const [libraryFiles,     setLibraryFiles]     = useState(loaderData?.files ?? []);
  const [pageInfo,         setPageInfo]         = useState(loaderData?.pageInfo ?? {});
  const [searchQ,          setSearchQ]          = useState("");
  const [loadingMore,      setLoadingMore]      = useState(false);
  const [selectedLibIds,   setSelectedLibIds]   = useState([]);
  const [selectedLibFiles, setSelectedLibFiles] = useState([]);
  const [uploadedFiles,    setUploadedFiles]    = useState([]);
  const [confirming,       setConfirming]       = useState(false);

  const [uploadPreviews, setUploadPreviews] = useState([]);
  useEffect(() => {
    const urls = uploadedFiles.map((f) => URL.createObjectURL(f));
    setUploadPreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [uploadedFiles]);

  const maxSelect = mode === "collage" ? 9 : 1;
  const isMulti   = mode === "collage";

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
      setSelectedLibIds((p)   => p.filter((id) => id !== f.id));
      setSelectedLibFiles((p) => p.filter((lf) => lf.id !== f.id));
    } else {
      setSelectedLibIds((p)   => [...p, f.id]);
      setSelectedLibFiles((p) => [...p, f]);
    }
  };

  const handleUpload = (files) => {
    const incoming    = Array.from(files);
    const isImageType = (f) => ["image/jpeg", "image/jpg", "image/png", "image/webp"].includes(f.type);
    const tooLarge    = incoming.filter((f) => isImageType(f) && f.size > MAX_UPLOAD_BYTES);
    const valid       = incoming.filter((f) => isImageType(f) && f.size <= MAX_UPLOAD_BYTES);
    if (tooLarge.length) {
      onWarning?.(
        tooLarge.length === 1
          ? `"${tooLarge[0].name}" exceeds the ${MAX_UPLOAD_LABEL} limit and was skipped.`
          : `${tooLarge.length} files exceed the ${MAX_UPLOAD_LABEL} limit and were skipped.`,
      );
    }
    setUploadedFiles((prev) =>
      isMulti ? [...prev, ...valid].slice(0, maxSelect) : [valid[0]].filter(Boolean),
    );
  };

  const canConfirm = tab === "library" ? selectedLibIds.length > 0 : uploadedFiles.length > 0;

  const handleConfirm = async () => {
    setConfirming(true);
    try {
      let resolvedLibraryFiles = selectedLibFiles;
      if (tab === "library") {
        resolvedLibraryFiles = await Promise.all(
          selectedLibFiles.map(async (f) => {
            try {
              const res  = await fetch(f.image.url);
              const blob = await res.blob();
              return { ...f, _objectUrl: URL.createObjectURL(blob) };
            } catch (err) {
              console.error(`Could not pre-fetch image: ${f.image.url}`, err);
              return f;
            }
          }),
        );
      }
      onConfirm({
        source:         tab,
        libraryFiles:   resolvedLibraryFiles,
        uploadedFiles,
        originalFileId: tab === "library" && selectedLibFiles[0] ? selectedLibFiles[0].id : null,
      });
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      <div style={{
        padding: "10px 14px", background: C.cardElevated,
        borderRadius: 8, fontSize: 13, color: C.textSecondary,
        border: `1px solid ${C.border}`,
      }}>
        {MODE_TABS.find((m) => m.key === mode)?.desc}
        {isMulti && ` Select 1–${maxSelect} images. Add images to individual cells in the next step.`}
      </div>

      <div style={{ display: "flex", gap: 2, background: C.cardElevated, borderRadius: 8, padding: 3 }}>
        {[
          { key: "library", label: "Store Library",        Icon: IcoImage },
          { key: "upload",  label: "Upload from Computer", Icon: IcoUpload },
        ].map(({ key, label, Icon }) => (
          <button key={key} type="button" onClick={() => setTab(key)} style={{
            flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            padding: "8px 12px", fontSize: 12, cursor: "pointer",
            fontWeight: tab === key ? 700 : 400,
            color:      tab === key ? C.textPrimary : C.muted,
            background: tab === key ? C.accent : "transparent",
            border: `1px solid ${C.border}`, borderRadius: 6,
            transition: "background 0.12s, color 0.12s",
          }}>
            <Icon size={13} />
            {label}
          </button>
        ))}
      </div>

      {tab === "library" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", gap: 6 }}>
            <div style={{ flex: 1, position: "relative" }}>
              <IcoSearch size={13} stroke={C.muted} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
              <input
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && fetcher.load(`/app/editor?q=${encodeURIComponent(searchQ)}`)}
                placeholder="Search by filename…"
                style={{
                  width: "100%", padding: "8px 10px 8px 32px", boxSizing: "border-box",
                  background: C.cardElevated, border: `1px solid ${C.border}`,
                  borderRadius: 6, fontSize: 12, color: C.textPrimary,
                }}
              />
            </div>
            <button type="button"
              onClick={() => fetcher.load(`/app/editor?q=${encodeURIComponent(searchQ)}`)}
              style={{ padding: "8px 14px", background: C.cardElevated, border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12, cursor: "pointer", color: C.textPrimary, display: "flex", alignItems: "center", gap: 5 }}>
              <IcoSearch size={12} />
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
            <div style={{ fontSize: 11, color: C.muted }}>{selectedLibIds.length} / {maxSelect} selected</div>
          )}

          {pageInfo.hasNextPage && (
            <div style={{ textAlign: "center" }}>
              <button type="button" disabled={loadingMore}
                onClick={() => { setLoadingMore(true); fetcher.load(`/app/editor?after=${pageInfo.endCursor}&q=${searchQ}&_append=1`); }}
                style={{ padding: "7px 18px", fontSize: 12, cursor: "pointer", background: C.cardElevated, border: `1px solid ${C.border}`, borderRadius: 6, color: C.textPrimary }}>
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            </div>
          )}

          {loaderData?.error && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, color: C.danger, fontSize: 12, padding: "8px 0" }}>
              <IcoWarn size={14} stroke={C.danger} />
              {loaderData.error} — Make sure <strong>read_files</strong> scope is approved.
            </div>
          )}
        </div>
      )}

      {tab === "upload" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div
            role="button" tabIndex={0}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); inputRef.current?.click(); } }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); handleUpload(e.dataTransfer.files); }}
            style={{
              border: `2px dashed ${C.border}`, borderRadius: 8,
              padding: "40px 24px", textAlign: "center",
              cursor: "pointer", background: C.cardElevated,
              transition: "border-color 0.12s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.accent; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.border; }}
          >
            <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp"
              multiple={isMulti} style={{ display: "none" }}
              onChange={(e) => handleUpload(e.target.files)} />
            <div style={{ marginBottom: 10 }}><IcoUpload size={28} stroke={C.muted} /></div>
            <div style={{ fontWeight: 600, fontSize: 13, color: C.textPrimary }}>Click or drag to upload</div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>
              JPEG · PNG · WebP · up to {MAX_UPLOAD_LABEL} each{isMulti ? ` · up to ${maxSelect} files` : ""}
            </div>
          </div>

          {uploadedFiles.length > 0 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {uploadedFiles.map((f, i) => (
                <div key={i} style={{
                  position: "relative", width: 64, height: 64,
                  borderRadius: 6, overflow: "hidden", border: `1px solid ${C.border}`,
                }}>
                  <img src={uploadPreviews[i]} alt=""
                    style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  <button type="button"
                    onClick={() => setUploadedFiles((p) => p.filter((_, j) => j !== i))}
                    style={{
                      position: "absolute", top: 2, right: 2,
                      background: "rgba(0,0,0,0.75)", color: "#fff", border: "none",
                      borderRadius: "50%", width: 16, height: 16, fontSize: 9,
                      cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                    <IcoX size={8} stroke="#fff" strokeWidth={2.5} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button type="button" disabled={!canConfirm || confirming} onClick={handleConfirm}
          style={{
            display: "flex", alignItems: "center", gap: 7,
            padding: "10px 24px",
            background: canConfirm && !confirming ? C.accent : C.cardElevated,
            color: canConfirm && !confirming ? "#000" : C.muted,
            border: "none", borderRadius: 7,
            fontSize: 13, fontWeight: 700,
            cursor: canConfirm && !confirming ? "pointer" : "default",
          }}>
          {confirming ? "Preparing…" : <><span>Continue</span><IcoArrowRight size={14} stroke={canConfirm ? "#000" : C.muted} /></>}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// GridSizeSelector
// ─────────────────────────────────────────────────────────────────────────────

function GridSizeSelector({ gridSize, setGridSize, mode }) {
  return (
    <div>
      <div style={panelLabel}>Grid Size</div>
      <div style={{ display: "flex", gap: 6 }}>
        {GRID_OPTIONS.map(({ value, cells }) => {
          const [r, c] = value.split("x").map(Number);
          const active = gridSize === value;
          return (
            <button key={value} type="button"
              onClick={() => setGridSize(value)}
              style={{
                flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 5,
                padding: "10px 6px", borderRadius: 7,
                border: `1px solid ${active ? C.accent : C.border}`,
                cursor: "pointer",
                background: active ? "rgba(0,200,117,0.08)" : C.cardElevated,
                transition: "border-color 0.12s, background 0.12s",
              }}>
              <div style={{
                display: "grid",
                gridTemplateColumns: `repeat(${c}, 1fr)`,
                gridTemplateRows:    `repeat(${r}, 1fr)`,
                width: 30, height: 30, gap: 2,
              }}>
                {Array.from({ length: cells }).map((_, i) => (
                  <div key={i} style={{ background: active ? C.accent : C.muted, borderRadius: 1.5 }} />
                ))}
              </div>
              <span style={{ fontSize: 11, fontWeight: 600, color: active ? C.accent : C.textSecondary }}>{value}</span>
              <span style={{ fontSize: 10, color: C.muted }}>{cells} {mode === "split" ? "tile" : "cell"}{cells > 1 ? "s" : ""}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SplitTileModeToggle
// ─────────────────────────────────────────────────────────────────────────────

function SplitTileModeToggle({ value, onChange }) {
  return (
    <div>
      <div style={panelLabel}>Save Output As</div>
      <div style={{ display: "flex", gap: 6 }}>
        {SPLIT_TILE_MODE_OPTIONS.map(({ key, label, desc }) => {
          const active = value === key;
          return (
            <button key={key} type="button" onClick={() => onChange(key)}
              style={{
                flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
                padding: "9px 6px", textAlign: "center",
                borderRadius: 7, border: `1px solid ${active ? C.accent : C.border}`,
                cursor: "pointer",
                background: active ? "rgba(0,200,117,0.08)" : C.cardElevated,
                transition: "border-color 0.12s, background 0.12s",
              }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: active ? C.accent : C.textSecondary }}>{label}</span>
              <span style={{ fontSize: 9, color: C.muted }}>{desc}</span>
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
  const cropperApiRef   = useRef(null);
  const cellFileInputRef = useRef(null);  // ← per-cell file picker

  const [cropperReady,    setCropperReady]    = useState(false);
  const [activeTool,      setActiveTool]      = useState({ type: "ratio", key: "Free" });
  const [customW,         setCustomW]         = useState("");
  const [customH,         setCustomH]         = useState("");

  const [splitSubStep,     setSplitSubStep]     = useState("crop");
  const [splitCroppedBlob, setSplitCroppedBlob] = useState(null);
  const splitPreviewUrl = useSafeObjectUrl(splitCroppedBlob);

  const [splitTileMode,    setSplitTileMode]    = useState("single");
  const [lockedDims,       setLockedDims]       = useState(null);
  const [cropIndex,        setCropIndex]        = useState(0);
  const [croppedPreviews,  setCroppedPreviews]  = useState({});
  const [skippedCells,     setSkippedCells]     = useState({});
  const [recropIndex,      setRecropIndex]      = useState(null);
  const [loadError,        setLoadError]        = useState(false);

  // Extra uploaded files added per-cell during the edit step.
  // Keyed by cell index so each cell can independently hold its own File.
  const [extraCellFiles,   setExtraCellFiles]   = useState({});
  // Which cell index the hidden file input is currently targeting.
  const [cellPickTarget,   setCellPickTarget]   = useState(null);
  useEffect(
    () => () => Object.values(croppedPreviews).forEach((u) => URL.revokeObjectURL(u)),
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const [rows, cols] = gridSize.split("x").map(Number);
  const cellCount    = rows * cols;

  const uploadedFile0   = pickedData.source === "upload" ? pickedData.uploadedFiles[0] : null;
  const uploadedFileUrl = useSafeObjectUrl(uploadedFile0);
  const singleUrl = pickedData.source === "library"
    ? (pickedData.libraryFiles[0]?._objectUrl ?? pickedData.libraryFiles[0]?.image?.url ?? null)
    : uploadedFileUrl;

  // Base images from the picker step (library or upload), padded to cellCount
  // slots with nulls so per-cell extras can fill any gap by index.
  const baseImages = useMemo(() => {
    const picked = [...pickedData.libraryFiles, ...pickedData.uploadedFiles];
    const slots  = Array.from({ length: cellCount }, (_, i) => picked[i] ?? null);
    return slots;
  }, [pickedData.libraryFiles, pickedData.uploadedFiles, cellCount]);

  // Merge per-cell extras: if a slot was null or the user re-picked for that
  // cell, the extraCellFiles entry wins.
  const collageImages = useMemo(
    () => baseImages.map((base, i) => extraCellFiles[i] ?? base),
    [baseImages, extraCellFiles],
  );

  const currentCollageImg   = collageImages[cropIndex] ?? null;
  const isCurrentCollageLib = currentCollageImg !== null && "image" in currentCollageImg;
  const collageUploadFile   = (!isCurrentCollageLib && currentCollageImg) ? currentCollageImg : null;
  const collageUploadUrl    = useSafeObjectUrl(collageUploadFile);
  const currentCollageSrc   = currentCollageImg
    ? (currentCollageImg._objectUrl ?? (isCurrentCollageLib ? currentCollageImg.image.url : collageUploadUrl))
    : null;

  useEffect(() => { setLoadError(false); }, [singleUrl, currentCollageSrc, splitSubStep]);

  const currentLockedRatio = (() => {
    if (activeTool.type === "ratio")  return RATIO_PRESETS.find((r) => r.label === activeTool.key)?.value ?? NaN;
    if (activeTool.type === "preset") { const p = SIZE_PRESETS.find((s) => s.label === activeTool.key); return p ? p.w / p.h : NaN; }
    if (activeTool.type === "custom") { const w = parseFloat(customW), h = parseFloat(customH); return (w > 0 && h > 0) ? w / h : NaN; }
    return NaN;
  })();

  const advanceCollageCursor = useCallback((wasRecrop) => {
    setRecropIndex(null);
    if (!wasRecrop && cropIndex < collageImages.length - 1) {
      setCropIndex((i) => i + 1);
      setActiveTool({ type: "ratio", key: "Free" });
      setCropperReady(false);
      cropperApiRef.current = null;
    }
  }, [cropIndex, collageImages.length]);

  const handleCollageCrop = useCallback(async () => {
    const api = cropperApiRef.current;
    if (!api) return;
    const blob = await api.getCroppedBlob();
    if (!blob) {
      const nat = api.getNaturalSize?.();
      if (!lockedDims && nat?.width && nat?.height) setLockedDims({ width: nat.width, height: nat.height });
      setSkippedCells((prev) => (prev[cropIndex] ? prev : { ...prev, [cropIndex]: true }));
    } else {
      if (cropIndex === 0 && !lockedDims) { const dims = api.getCropDimensions(); if (dims) setLockedDims(dims); }
      setCroppedPreviews((prev) => {
        if (prev[cropIndex]) URL.revokeObjectURL(prev[cropIndex]);
        return { ...prev, [cropIndex]: URL.createObjectURL(blob) };
      });
      setSkippedCells((prev) => { if (!prev[cropIndex]) return prev; const next = { ...prev }; delete next[cropIndex]; return next; });
    }
    advanceCollageCursor(recropIndex !== null);
  }, [cropIndex, lockedDims, recropIndex, advanceCollageCursor]);

  const handleUseOriginal = useCallback(() => {
    const nat = cropperApiRef.current?.getNaturalSize?.();
    if (nat?.width && nat?.height && !lockedDims) setLockedDims({ width: nat.width, height: nat.height });
    setSkippedCells((prev) => (prev[cropIndex] ? prev : { ...prev, [cropIndex]: true }));
    advanceCollageCursor(recropIndex !== null);
  }, [cropIndex, lockedDims, recropIndex, advanceCollageCursor]);

  const handleSkipCell = useCallback(() => {
    setLoadError(false);
    setSkippedCells((prev) => (prev[cropIndex] ? prev : { ...prev, [cropIndex]: true }));
    advanceCollageCursor(recropIndex !== null);
  }, [cropIndex, recropIndex, advanceCollageCursor]);

  const handleSelectCollageCell = useCallback((i, isReCroppable) => {
    if (!isReCroppable) return;
    setRecropIndex(i); setCropIndex(i);
    cropperApiRef.current = null; setCropperReady(false);
    setActiveTool({ type: "ratio", key: "Free" }); setLoadError(false);
  }, []);

  // Open the hidden file input targeting a specific cell index.
  const handlePickForCell = useCallback((i) => {
    setCellPickTarget(i);
    // Small timeout lets state settle before the dialog opens.
    setTimeout(() => cellFileInputRef.current?.click(), 0);
  }, []);

  // Called when the user selects a file via the per-cell input.
  //
  // FIX: previously this only stored the new File in extraCellFiles and reset
  // recropIndex to null. That left any *existing* croppedPreviews/skippedCells
  // entry for this cell in place — so the thumbnail grid (which prefers
  // `preview` over `fallback`) kept showing the OLD cropped image, and because
  // the cell still counted as "resolved" (`allCropped` stayed true), the crop
  // canvas section — gated on `!allCropped || recropIndex !== null` — never
  // rendered, so there was no way to crop the newly-picked file either.
  //
  // Fix: clear this cell's stale crop/skip state so it's treated as unresolved,
  // and set recropIndex so the crop canvas opens immediately on the new image.
  const handleCellFileChange = useCallback((e) => {
    const file = e.target.files?.[0];
    // Reset so the same file can be re-selected later if needed.
    e.target.value = "";
    if (!file || cellPickTarget === null) return;
    const idx = cellPickTarget;
    setCellPickTarget(null);
    setExtraCellFiles((prev) => ({ ...prev, [idx]: file }));

    // The image source for this cell changed — any previous crop result or
    // "skip/use original" flag no longer applies to the new file.
    setCroppedPreviews((prev) => {
      if (!(idx in prev)) return prev;
      URL.revokeObjectURL(prev[idx]);
      const next = { ...prev };
      delete next[idx];
      return next;
    });
    setSkippedCells((prev) => {
      if (!(idx in prev)) return prev;
      const next = { ...prev };
      delete next[idx];
      return next;
    });

    // Jump cropper to this cell immediately and force the crop UI open.
    setCropIndex(idx);
    setRecropIndex(idx);
    cropperApiRef.current = null;
    setCropperReady(false);
    setActiveTool({ type: "ratio", key: "Free" });
    setLoadError(false);
  }, [cellPickTarget]);

  const handleSplitCropConfirm = useCallback(async () => {
    const api = cropperApiRef.current;
    if (!api) { alert("Cropper not ready — please wait a moment and try again."); return; }
    const blob = await api.getCroppedBlob();
    if (!blob) { alert("Could not read crop — please try again."); return; }
    setSplitCroppedBlob(new File([blob], "cropped.jpg", { type: "image/jpeg" }));
    setSplitSubStep("preview");
  }, []);

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
      onSave({
        intent: "split", saveMode, croppedFile: splitCroppedBlob, gridSize,
        originalFileId: pickedData.originalFileId,
        tileMode: splitTileMode,
        filename: pickedData.libraryFiles[0]?.alt || pickedData.uploadedFiles[0]?.name || "split-image.jpg",
      });
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
          const isLib   = "image" in img;
          const blobUrl = croppedPreviews[i];
          if (blobUrl) {
            const res  = await fetch(blobUrl);
            const blob = await res.blob();
            return new File([blob], isLib ? (img.alt || `cell-${i}.jpg`) : img.name, { type: "image/jpeg" });
          }
          return isLib ? null : img;
        }),
      );
      onSave({ intent: "collage", saveMode, cells, uploadedFiles: croppedFiles, gridSize, originalFileId: null });
    }
  };

  const canReplace = !!pickedData.originalFileId && mode !== "collage";

  const resolvedCollageCount = mode === "collage"
    ? new Set([...Object.keys(croppedPreviews), ...Object.keys(skippedCells)]).size
    : 0;
  const filledCellCount = collageImages.filter((img) => img !== null).length;
  const allCropped = mode === "collage"
    && filledCellCount === cellCount
    && resolvedCollageCount === cellCount;
  const splitReady = mode === "split" && splitSubStep === "preview" && !!splitCroppedBlob;
  const canSave    = (mode === "crop" && cropperReady) || splitReady || allCropped;

  return (
    <div style={{ display: "flex", gap: 0, alignItems: "flex-start" }}>

      {/* ── Canvas area ── */}
      <div style={{ flex: 1, minWidth: 0, paddingRight: 20 }}>

        {mode === "crop" && singleUrl && (
          <>
            <CropCanvas imageUrl={singleUrl} lockedRatio={currentLockedRatio}
              onReady={(api) => { cropperApiRef.current = api; }}
              onReadyChange={setCropperReady} onError={() => setLoadError(true)} />
            {loadError && <ErrorBanner msg="This image couldn't be loaded. Go back and choose a different one." />}
          </>
        )}

        {mode === "split" && splitSubStep === "crop" && singleUrl && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <StepBadge step="1" label="Adjust the crop frame, then confirm." />
            <CropCanvas imageUrl={singleUrl} lockedRatio={currentLockedRatio}
              onReady={(api) => { cropperApiRef.current = api; }}
              onReadyChange={setCropperReady} onError={() => setLoadError(true)} />
            {loadError && <ErrorBanner msg="This image couldn't be loaded. Go back and choose a different one." />}
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <DarkBtn disabled={!cropperReady} onClick={handleSplitCropConfirm} accent>
                {cropperReady ? <><span>Confirm Crop</span><IcoArrowRight size={13} stroke="#000" /></> : "Loading…"}
              </DarkBtn>
            </div>
          </div>
        )}

        {mode === "split" && splitSubStep === "preview" && splitPreviewUrl && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <DarkBtn onClick={() => { setSplitSubStep("crop"); setSplitCroppedBlob(null); cropperApiRef.current = null; setCropperReady(false); }}>
                <IcoArrowLeft size={13} /><span>Re-crop</span>
              </DarkBtn>
              <StepBadge step="2" label="Choose grid size, then save." />
            </div>
            <SplitTilePreview croppedBlobUrl={splitPreviewUrl} gridSize={gridSize} />
          </div>
        )}

        {mode === "collage" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {(!allCropped || recropIndex !== null) && currentCollageSrc && (
              <div>
                <div style={{
                  display: "flex", alignItems: "center", gap: 6,
                  fontSize: 12, color: C.textSecondary, marginBottom: 8,
                  padding: "7px 12px", background: C.cardElevated,
                  borderRadius: 6, border: `1px solid ${C.border}`,
                }}>
                  {recropIndex !== null
                    ? <><IcoRefresh size={12} stroke={C.accentSecond} /><span>Re-cropping image {cropIndex + 1} of {collageImages.length}</span></>
                    : cropIndex > 0 && lockedDims
                      ? <><IcoLock size={12} stroke={C.accentSecond} /><span>Image {cropIndex + 1} of {collageImages.length} — locked to {lockedDims.width} × {lockedDims.height} px</span></>
                      : <><IcoCrop size={12} stroke={C.accent} /><span>Cropping image {cropIndex + 1} of {collageImages.length} — set ratio in the panel</span></>}
                </div>
                <CropCanvas imageUrl={currentCollageSrc}
                  lockedRatio={cropIndex === 0 ? currentLockedRatio : (lockedDims ? lockedDims.width / lockedDims.height : NaN)}
                  onReady={(api) => { cropperApiRef.current = api; }}
                  onReadyChange={setCropperReady} onError={() => setLoadError(true)} />

                {loadError ? (
                  <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                    <ErrorBanner msg="This image couldn't be loaded. You can skip it — the original will be used for this cell." />
                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                      <DarkBtn accent onClick={handleSkipCell}>
                        <IcoSkip size={13} stroke="#000" /><span>Skip &amp; Use Original</span>
                      </DarkBtn>
                    </div>
                  </div>
                ) : (
                  <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end", gap: 8 }}>
                    {cropIndex === 0 && <DarkBtn disabled={!cropperReady} onClick={handleUseOriginal}>Use Original</DarkBtn>}
                    <DarkBtn accent disabled={!cropperReady} onClick={handleCollageCrop}>
                      {!cropperReady ? "Loading…"
                        : recropIndex !== null ? <><IcoCheck size={13} stroke="#000" /><span>Apply Crop</span></>
                        : cropIndex < collageImages.length - 1 ? <><span>Apply Crop &amp; Next</span><IcoArrowRight size={13} stroke="#000" /></>
                        : <><IcoCheck size={13} stroke="#000" /><span>Apply Crop &amp; Finish</span></>}
                    </DarkBtn>
                  </div>
                )}
              </div>
            )}

           {/* Hidden per-cell file input — max 9 total cells */}
            <input
              ref={cellFileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              style={{ display: "none" }}
              onChange={handleCellFileChange}
            />

            {/* Collage thumbnail grid — white gap = white divider */}
            <div style={{
              display: "grid",
              gridTemplateColumns: `repeat(${cols}, 1fr)`,
              gap: TILE_GAP,
              borderRadius: 8, overflow: "hidden",
              background: "#ffffff",
            }}>
              {Array.from({ length: cellCount }).map((_, i) => {
                const preview    = croppedPreviews[i];
                const img        = collageImages[i];
                const isLibI     = img && ("image" in img);
                const fallback   = img
                  ? (img instanceof File
                      ? null                          // uploaded File — no stable URL here
                      : (img._objectUrl ?? (isLibI ? img.image.url : null)))
                  : null;
                const src        = preview || fallback;
                const hasImage   = !!img;
                const aspect     = lockedDims ? `${lockedDims.width} / ${lockedDims.height}` : "1";
                const isReCrop   = croppedPreviews[i] !== undefined || !!skippedCells[i];
                const isActive   = cropIndex === i && (!allCropped || recropIndex !== null);

                return (
                  <div key={i}
                    style={{
                      aspectRatio: aspect, background: C.cardElevated,
                      position: "relative",
                      outline: isActive ? `2px solid ${C.accentSecond}` : "none",
                    }}>

                    {src ? (
                      /* ── Cell has a preview or library thumbnail ── */
                      <>
                        <img src={src} alt=""
                          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />

                        {/* Status badge */}
                        {preview && (
                          <div style={{ position: "absolute", top: 3, right: 3, background: C.success, borderRadius: "50%", width: 16, height: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <IcoCheck size={8} stroke="#000" strokeWidth={3} />
                          </div>
                        )}
                        {!preview && skippedCells[i] && (
                          <div title="Using original image" style={{ position: "absolute", top: 3, right: 3, background: C.muted, borderRadius: "50%", width: 16, height: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <IcoRefresh size={8} stroke="#fff" />
                          </div>
                        )}

                        {/* Re-crop / re-pick overlay on hover */}
                        <div
                          role="button" tabIndex={0}
                          onClick={() => isReCrop ? handleSelectCollageCell(i, true) : undefined}
                          onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && isReCrop) { e.preventDefault(); handleSelectCollageCell(i, true); } }}
                          title={isReCrop ? "Click to re-crop" : undefined}
                          style={{
                            position: "absolute", inset: 0,
                            display: "flex", alignItems: "flex-end", justifyContent: "flex-start",
                            padding: 4, gap: 3,
                            background: "rgba(0,0,0,0)",
                            cursor: isReCrop ? "pointer" : "default",
                            transition: "background 0.15s",
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(0,0,0,0.45)"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(0,0,0,0)"; }}
                        >
                          {/* Re-pick button shown on hover */}
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handlePickForCell(i); }}
                            title="Replace image"
                            style={{
                              display: "none",   // shown via parent hover via CSS below
                              padding: "3px 6px", borderRadius: 4,
                              background: "rgba(0,0,0,0.7)", border: "none",
                              color: "#fff", fontSize: 9, cursor: "pointer",
                            }}
                            className="cell-repick-btn"
                          >
                            <IcoUpload size={9} stroke="#fff" />
                          </button>
                        </div>
                      </>
                    ) : hasImage && img instanceof File ? (
                      /* ── Uploaded File with no preview yet — show filename ── */
                      <div style={{
                        width: "100%", height: "100%",
                        display: "flex", flexDirection: "column",
                        alignItems: "center", justifyContent: "center",
                        gap: 4, padding: 4,
                        fontSize: 9, color: C.textSecondary, textAlign: "center",
                        cursor: "pointer",
                      }}
                        role="button" tabIndex={0}
                        onClick={() => handlePickForCell(i)}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handlePickForCell(i); } }}
                        title="Click to change image"
                      >
                        <IcoImage size={18} stroke={C.accent} />
                        <span style={{ wordBreak: "break-all", lineHeight: 1.3 }}>{img.name}</span>
                      </div>
                    ) : (
                      /* ── Empty cell — show Add Image button ── */
                      <button
                        type="button"
                        onClick={() => handlePickForCell(i)}
                        style={{
                          width: "100%", height: "100%", minHeight: 64,
                          display: "flex", flexDirection: "column",
                          alignItems: "center", justifyContent: "center", gap: 5,
                          background: "transparent", border: "none", cursor: "pointer",
                          color: C.muted,
                        }}
                        title={`Add image for cell ${i + 1}`}
                      >
                        <IcoUpload size={18} stroke={C.accentSecond} />
                        <span style={{ fontSize: 9, color: C.accentSecond, fontWeight: 600 }}>
                          Add Image
                        </span>
                        <span style={{ fontSize: 8, color: C.muted }}>Cell {i + 1}</span>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            {/* Inline CSS to show the repick button on cell hover */}
            <style>{`
              div:hover > .cell-repick-btn { display: inline-flex !important; }
            `}</style>
           {(() => {
              const missingCount = collageImages.filter((img) => img === null).length;
              return missingCount > 0 ? (
                <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", background: "rgba(245,166,35,0.08)", borderRadius: 6, fontSize: 12, color: C.warning, border: `1px solid rgba(245,166,35,0.2)` }}>
                  <IcoWarn size={14} stroke={C.warning} />
                  {missingCount} cell{missingCount > 1 ? "s" : ""} still need an image — click <strong>Add Image</strong> on each empty cell.
                </div>
              ) : null;
            })()}
          </div>
        )}
      </div>

      {/* ── Inspector panel ── */}
      <div style={{
        width: 220, flexShrink: 0,
        background: C.card, borderRadius: 10,
        border: `1px solid ${C.border}`,
        display: "flex", flexDirection: "column",
        position: "sticky", top: 16, overflow: "hidden",
      }}>
        <div style={{ padding: "10px 14px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 6 }}>
          <IcoGrid size={12} stroke={C.muted} />
          <span style={{ fontSize: 10, fontWeight: 700, color: C.muted, letterSpacing: "0.08em", textTransform: "uppercase" }}>Inspector</span>
        </div>

        <div style={{ padding: "14px", display: "flex", flexDirection: "column", gap: 16 }}>
          {(mode === "crop"
            || (mode === "split" && splitSubStep === "crop")
            || (mode === "collage" && (!allCropped || recropIndex !== null))) && (
            <CropToolPanel
              cropperApiRef={cropperApiRef}
              activeTool={activeTool} setActiveTool={setActiveTool}
              customW={customW} setCustomW={setCustomW}
              customH={customH} setCustomH={setCustomH}
              locked={mode === "collage" && cropIndex > 0}
              lockedDims={lockedDims}
              showReset={mode === "crop" || (mode === "split" && splitSubStep === "crop")}
              disabled={!cropperReady}
            />
          )}

          {(splitReady || mode === "collage") && (
            <GridSizeSelector gridSize={gridSize} setGridSize={setGridSize} mode={mode} />
          )}

          {mode === "split" && splitReady && (
            <SplitTileModeToggle value={splitTileMode} onChange={setSplitTileMode} />
          )}

          <div style={divider} />

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={panelLabel}>Save to Shopify Files</div>

            <button type="button" disabled={saving || !canSave} onClick={() => handleSave("new")}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                padding: "10px 12px", borderRadius: 7, fontSize: 12, fontWeight: 700,
                border: "none", cursor: saving || !canSave ? "default" : "pointer",
                background: saving || !canSave ? C.cardElevated : C.accent,
                color: saving || !canSave ? C.muted : "#000",
                opacity: saving ? 0.7 : 1,
              }}>
              <IcoSave size={13} stroke={saving || !canSave ? C.muted : "#000"} />
              {saving ? "Saving…" : mode === "crop" && !cropperReady ? "Loading…" : "Save as New Image"}
            </button>

            {canReplace && (
              <button type="button" disabled={saving || !canSave} onClick={() => handleSave("replace")}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  padding: "10px 12px", borderRadius: 7, fontSize: 12, fontWeight: 700,
                  border: `1px solid ${saving || !canSave ? C.border : C.borderStrong}`,
                  cursor: saving || !canSave ? "default" : "pointer",
                  background: "transparent",
                  color: saving || !canSave ? C.muted : C.textPrimary,
                  opacity: saving ? 0.7 : 1,
                }}>
                <IcoRefresh size={13} />
                {saving ? "Saving…" : "Replace Original"}
              </button>
            )}

            {!canReplace && mode !== "collage" && (
              <p style={{ fontSize: 10, color: C.muted, margin: 0, lineHeight: 1.5 }}>
                Replace is available when the source is from your store library.
              </p>
            )}
            {mode === "split" && splitSubStep === "crop" && (
              <p style={{ fontSize: 10, color: C.muted, margin: 0, lineHeight: 1.5 }}>
                Confirm your crop first, then choose the grid size.
              </p>
            )}
            {mode === "collage" && !allCropped && collageImages.length > 0 && (
              <p style={{ fontSize: 10, color: C.muted, margin: 0, lineHeight: 1.5 }}>
                Apply crop for all {cellCount} images to enable saving.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tiny shared components
// ─────────────────────────────────────────────────────────────────────────────

function DarkBtn({ children, onClick, disabled, accent }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick}
      style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        padding: "9px 16px", borderRadius: 7,
        fontSize: 12, fontWeight: 700, cursor: disabled ? "default" : "pointer",
        border: accent ? "none" : `1px solid ${C.border}`,
        background: disabled ? C.cardElevated : accent ? C.accent : C.cardElevated,
        color: disabled ? C.muted : accent ? "#000" : C.textPrimary,
        opacity: disabled ? 0.6 : 1,
      }}>
      {children}
    </button>
  );
}

function StepBadge({ step, label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: C.textSecondary }}>
      <span style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 18, height: 18, borderRadius: "50%",
        background: C.accent, color: "#000", fontSize: 9, fontWeight: 800,
      }}>{step}</span>
      <span>{label}</span>
    </div>
  );
}

function ErrorBanner({ msg }) {
  return (
    <div style={{
      display: "flex", alignItems: "flex-start", gap: 8,
      padding: "10px 12px", marginTop: 8,
      background: "rgba(255,90,95,0.08)", border: `1px solid rgba(255,90,95,0.25)`,
      borderRadius: 6, fontSize: 12,
    }}>
      <IcoWarn size={14} stroke={C.danger} style={{ flexShrink: 0, marginTop: 1 }} />
      <span style={{ color: C.textSecondary }}>{msg}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EditorPage — root component
// The white background comes from Shopify's s-section Shadow DOM which CSS
// selectors on the host element cannot pierce. We solve it by:
//   1. Rendering s-page / s-section with no padding/margin/bg of their own
//   2. Immediately inside s-section, placing a full-bleed dark <div> that
//      uses negative margins to neutralise whatever padding s-section injects,
//      then re-applies our own padding inside it.
// ─────────────────────────────────────────────────────────────────────────────

export default function EditorPage() {
  const loaderData = useLoaderData();
  const fetcher    = useFetcher();

  const [step,       setStep]     = useState("pick");
  const [mode,       setMode]     = useState("crop");
  const [gridSize,   setGridSize] = useState("2x2");
  const [pickedData, setPicked]   = useState(null);
  const [toast,      setToast]    = useState(null);

  const saving = fetcher.state !== "idle";

  useEffect(() => {
    if (!fetcher.data) return;
    if (fetcher.data.success) {
      const c    = fetcher.data.count || 1;
      const verb = fetcher.data.saveMode === "replace" ? "replaced" : "saved";
      setToast({ message: `${c} image${c > 1 ? "s" : ""} ${verb} to your Shopify Files library.`, tone: "success" });
      setTimeout(() => { setStep("pick"); setPicked(null); setToast(null); }, 3000);
    } else {
      setToast({ message: fetcher.data.error || "Something went wrong.", tone: "error" });
      setTimeout(() => setToast(null), 6000);
    }
  }, [fetcher.data]);

  const handlePicked      = (data)    => { setPicked(data); setStep("edit"); };
  const showWarningToast  = useCallback((message) => {
    setToast({ message, tone: "warning" });
    setTimeout(() => setToast(null), 5000);
  }, []);

  const handleSave = useCallback(async ({
    intent, saveMode, imageData, filename, originalFileId,
    croppedFile, cells, uploadedFiles: ufList, gridSize: gs, tileMode,
  }) => {
    const fd = new FormData();
    fd.append("intent",   intent);
    fd.append("saveMode", saveMode);
    fd.append("gridSize", gs || gridSize);
    if (originalFileId) fd.append("originalFileId", originalFileId);

    if (intent === "crop") {
      fd.append("imageData", imageData);
      fd.append("filename",  filename);
    } else if (intent === "split") {
      fd.append("croppedImage", croppedFile, croppedFile.name);
      if (filename) fd.append("filename", filename);
      fd.append("tileMode", tileMode || "single");
    } else if (intent === "collage") {
      fd.append("cells", JSON.stringify(cells));
      if (ufList?.length) {
        cells.forEach((cell, i) => {
          const f = ufList[i];
          if (!cell.fromLibrary && f) fd.append(`file_${i}`, f, f.name);
        });
      }
    }
    fetcher.submit(fd, { method: "post", encType: "multipart/form-data" });
  }, [fetcher, gridSize]);

  const switchMode = (m) => { setMode(m); setStep("pick"); setPicked(null); };

  const toastBg = { success: "rgba(0,200,117,0.12)", error: "rgba(255,90,95,0.12)", warning: "rgba(245,166,35,0.12)" };
  const toastBd = { success: "rgba(0,200,117,0.3)",  error: "rgba(255,90,95,0.3)",  warning: "rgba(245,166,35,0.3)"  };
  const toastCl = { success: C.success,               error: C.danger,               warning: C.warning               };

  return (
    <s-page heading="Image Editor">

      {/*
        Global style block:
        • Dark spin keyframe
        • Force dark bg on every ancestor we can reach from here
        • Cropper.js dark theme — white divider lines inside the crop box
      */}
      <style>{`
        @keyframes editorSpin { to { transform: rotate(360deg); } }
        * { box-sizing: border-box; }
        input[type=number] { -moz-appearance: textfield; }
        input[type=number]::-webkit-outer-spin-button,
        input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none; }

        /* Best-effort dark bg on outer Shopify chrome */
        html, body { background: ${C.bg} !important; }
        s-page, s-section { color-scheme: dark; }

        /* ── Cropper.js: dark surround + white crop-box lines ── */
        .cropper-bg    { background-image: none !important; background-color: #0d0d0f !important; }
        .cropper-modal { opacity: 0.78 !important; background: #000 !important; }
        .cropper-line  { background-color: rgba(255,255,255,0.9) !important; }
        .cropper-point { background-color: #ffffff !important; }
        .cropper-view-box {
          outline: 1.5px solid rgba(255,255,255,0.85) !important;
          outline-color: rgba(255,255,255,0.85) !important;
        }
        .cropper-dashed { border-color: rgba(255,255,255,0.28) !important; }
        .cropper-face   { background-color: rgba(255,255,255,0.015) !important; }
      `}</style>

      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)",
          zIndex: 9999,
          background: toastBg[toast.tone], border: `1px solid ${toastBd[toast.tone]}`,
          color: toastCl[toast.tone], padding: "12px 24px", borderRadius: 8,
          fontSize: 13, fontWeight: 600, boxShadow: "0 4px 24px rgba(0,0,0,0.5)",
          maxWidth: 480, textAlign: "center", display: "flex", alignItems: "center", gap: 8,
        }}>
          {toast.tone === "success" && <IcoCheck size={16} stroke={C.success} strokeWidth={2.5} />}
          {toast.tone === "error"   && <IcoWarn  size={16} stroke={C.danger} />}
          {toast.tone === "warning" && <IcoWarn  size={16} stroke={C.warning} />}
          {toast.message}
        </div>
      )}

      {/*
        The s-section shell can't be made dark via CSS on the host.
        We therefore render it as a thin wrapper and place a full-bleed
        dark container INSIDE it. The negative margin trick (-20px on all
        sides, matching Shopify's typical section padding) bleeds the dark
        div to the edges of the white card, then re-pads inside.
        Adjust the -20px values if your theme uses a different padding.
      */}
      <s-section>
        <div style={{
          margin: "-20px -20px -20px -20px",   // bleed over s-section white padding
          padding: "24px 20px",
          background: C.bgSecondary,
          minHeight: "calc(100vh - 60px)",
          color: C.textPrimary,
        }}>

          {/* Mode tabs */}
          <div style={{
            display: "flex", gap: 2,
            background: C.card, borderRadius: 10, padding: 4,
            marginBottom: 20, border: `1px solid ${C.border}`,
            width: "fit-content",
          }}>
            {MODE_TABS.map(({ key, Icon, label }) => {
              const active = mode === key;
              return (
                <button key={key} type="button" onClick={() => switchMode(key)} style={{
                  display: "flex", alignItems: "center", gap: 7,
                  padding: "8px 18px", fontSize: 12, cursor: "pointer",
                  fontWeight: active ? 700 : 400,
                  color:      active ? "#ffffffff" : C.textSecondary,
                  background: active ? C.accent : "transparent",
                  border: "none", borderRadius: 7,
                  transition: "background 0.15s, color 0.15s",
                }}>
                  <Icon size={13} stroke={active ? "#ffffffff" : C.textSecondary} />
                  {label}
                </button>
              );
            })}
          </div>

          {/* Breadcrumb */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 20, fontSize: 12 }}>
            <span
              role="button" tabIndex={step === "edit" ? 0 : -1}
              onClick={() => { if (step === "edit") switchMode(mode); }}
              onKeyDown={(e) => { if (step === "edit" && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); switchMode(mode); } }}
              style={{
                cursor: step === "edit" ? "pointer" : "default",
                color:  step === "edit" ? C.accentSecond : C.textPrimary,
                fontWeight: 600,
                textDecoration: step === "edit" ? "underline" : "none",
              }}>
              1. Select Image{mode === "collage" ? "s" : ""}
            </span>
            <IcoArrowRight size={11} stroke={C.muted} />
            <span style={{ color: step === "edit" ? C.textPrimary : C.muted, fontWeight: step === "edit" ? 600 : 400 }}>
              2. Edit &amp; Save
            </span>
          </div>

          {step === "pick" && (
            <SourcePicker key={mode} mode={mode} loaderData={loaderData} onConfirm={handlePicked} onWarning={showWarningToast} />
          )}

          {step === "edit" && pickedData && (
            <EditPanel
              mode={mode} pickedData={pickedData}
              gridSize={gridSize} setGridSize={setGridSize}
              onSave={handleSave} saving={saving}
            />
          )}

        </div>
      </s-section>
    </s-page>
  );
}

export const headers = (h) => boundary.headers(h);