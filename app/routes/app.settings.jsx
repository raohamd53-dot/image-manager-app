/* eslint-disable react/prop-types */
// app/routes/app.settings.jsx
//
// Settings page — lets the merchant tune the image-export defaults used
// across the editor (Crop & Resize, Split Grid, Collage):
//   • JPEG export quality
//   • Max export dimension (long edge, px)
//   • Collage tile gap (px)
//
// One ShopSettings row per Shop (see prisma/schema.prisma). The Shop row
// itself is upserted here too, mirroring the pattern already used in
// app._index.jsx, so visiting /app/settings directly (without having
// hit the homepage first) still works.

import { useEffect, useRef, useState } from "react";
import { useLoaderData, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary }     from "@shopify/shopify-app-react-router/server";
import { db }           from "../db.server";
import {
  SETTINGS_DEFAULTS as DEFAULTS,
  SETTINGS_BOUNDS as BOUNDS,
  clampSetting as clamp,
} from "../lib/shop-settings.shared";
import { ensureShop, getShopSettings } from "../lib/shop-settings.server";

// ─────────────────────────────────────────────────────────────────────────────
// Design tokens — same palette as app._index.jsx / app.editor.jsx
// ─────────────────────────────────────────────────────────────────────────────

const C = {
  bg: "#09090B",
  bgSecondary: "#111111",
  card: "#181818",
  cardElevated: "#262626",

  border: "rgba(255,255,255,0.08)",
  borderStrong: "rgba(255,255,255,0.14)",

  accent: "#A660F1",
  accentSecond: "#EFDFFF",

  textPrimary: "#FFFFFF",
  textSecondary: "#D1D1D1",
  muted: "#9B9B9B",

  success: "#00C875",
  warning: "#F5A623",
  danger: "#FF5A5F",
};

const IP = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" };
function Ico({ size = 16, ...rest }) { return <svg width={size} height={size} {...IP} {...rest} />; }
function IcoSave({ size, ...p })    { return <Ico size={size} {...p}><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/></Ico>; }
function IcoRefresh({ size, ...p }) { return <Ico size={size} {...p}><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></Ico>; }
function IcoCheck({ size, ...p })   { return <Ico size={size} {...p}><polyline points="20 6 9 17 4 12"/></Ico>; }
function IcoWarn({ size, ...p })    { return <Ico size={size} {...p}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></Ico>; }
function IcoImage({ size, ...p })   { return <Ico size={size} {...p}><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></Ico>; }
function IcoGrid({ size, ...p })    { return <Ico size={size} {...p}><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></Ico>; }
function IcoExpand({ size, ...p })  { return <Ico size={size} {...p}><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></Ico>; }

// ─────────────────────────────────────────────────────────────────────────────
// Loader — ensures Shop + ShopSettings rows exist, returns settings
// ─────────────────────────────────────────────────────────────────────────────

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const settings = await getShopSettings(session.shop);
  return { settings };
};

// ─────────────────────────────────────────────────────────────────────────────
// Action — validates + persists the form
// ─────────────────────────────────────────────────────────────────────────────

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") || "save";

  const shop = await ensureShop(session.shop);

  try {
    const values = intent === "reset"
      ? DEFAULTS
      : {
          jpegQuality:  clamp(formData.get("jpegQuality"),  BOUNDS.jpegQuality,  DEFAULTS.jpegQuality),
          maxExportPx:  clamp(formData.get("maxExportPx"),  BOUNDS.maxExportPx,  DEFAULTS.maxExportPx),
          collageGapPx: clamp(formData.get("collageGapPx"), BOUNDS.collageGapPx, DEFAULTS.collageGapPx),
        };

    const settings = await db.shopSettings.upsert({
      where:  { shopId: shop.id },
      update: values,
      create: { shopId: shop.id, ...values },
    });

    return {
      success: true,
      resetToDefaults: intent === "reset",
      settings: {
        jpegQuality:  settings.jpegQuality,
        maxExportPx:  settings.maxExportPx,
        collageGapPx: settings.collageGapPx,
      },
    };
  } catch (err) {
    console.error("Settings save failed:", err);
    return { success: false, error: err.message || "Could not save settings." };
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Small building blocks
// ─────────────────────────────────────────────────────────────────────────────

function SettingCard({ icon, title, description, children }) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
      padding: 20, display: "flex", flexDirection: "column", gap: 16,
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{
          width: 34, height: 34, borderRadius: 9, flexShrink: 0,
          background: C.cardElevated, display: "flex", alignItems: "center",
          justifyContent: "center", color: C.accentSecond,
        }}>
          {icon}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.textPrimary }}>{title}</div>
          <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.5 }}>{description}</div>
        </div>
      </div>
      {children}
    </div>
  );
}

function SliderField({ label, value, onChange, bounds, suffix, hint }) {
  const { min, max, step } = bounds;
  const numericValue = Number.isFinite(Number(value)) ? Number(value) : min;
  const percent = ((numericValue - min) / (max - min)) * 100;
  const trackBackground = `linear-gradient(to right, ${C.accent} 0%, ${C.accent} ${percent}%, ${C.cardElevated} ${percent}%, ${C.cardElevated} 100%)`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 12.5, color: C.textSecondary, fontWeight: 600 }}>{label}</span>
        <div style={{
          display: "flex", alignItems: "center", gap: 6,
          background: C.cardElevated, border: `1px solid ${C.border}`,
          borderRadius: 7, padding: "4px 4px 4px 10px",
        }}>
          <input
            type="number"
            className="settings-number-input"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
            onBlur={(e) => onChange(clamp(e.target.value, bounds, value))}
            style={{
              width: 46, padding: "3px 0", background: "transparent",
              border: "none", fontSize: 12.5, color: C.textPrimary,
              textAlign: "right",
            }}
          />
          {suffix && (
            <span style={{
              fontSize: 11, color: C.muted, borderLeft: `1px solid ${C.border}`,
              padding: "3px 8px 3px 8px",
            }}>
              {suffix}
            </span>
          )}
        </div>
      </div>
      <input
        type="range"
        className="settings-range-input"
        min={min}
        max={max}
        step={step}
        value={numericValue}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: "100%", cursor: "pointer", background: trackBackground }}
      />
      {hint && <span style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.5 }}>{hint}</span>}
    </div>
  );
}

function Banner({ tone, children }) {
  const colors = {
    success: { bg: "rgba(0,200,117,0.1)", border: "rgba(0,200,117,0.35)", text: C.success, Icon: IcoCheck },
    danger:  { bg: "rgba(255,90,95,0.1)", border: "rgba(255,90,95,0.35)", text: C.danger,  Icon: IcoWarn },
  }[tone];
  const { bg, border, text, Icon } = colors;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
      background: bg, border: `1px solid ${border}`, borderRadius: 9,
      color: text, fontSize: 12.5, fontWeight: 600,
    }}>
      <Icon size={15} />
      <span>{children}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default function Settings() {
  const { settings } = useLoaderData();
  const fetcher = useFetcher();

  const [form, setForm] = useState(settings);
  const [banner, setBanner] = useState(null); // { tone, text } | null
  const bannerTimeout = useRef(null);

  const isSaving = fetcher.state !== "idle";
  const isDirty =
    Number(form.jpegQuality)  !== settings.jpegQuality  ||
    Number(form.maxExportPx)  !== settings.maxExportPx  ||
    Number(form.collageGapPx) !== settings.collageGapPx;

  // React to the fetcher's result — update local baseline + show a banner.
  useEffect(() => {
    if (!fetcher.data || fetcher.state !== "idle") return;

    if (fetcher.data.success) {
      setForm(fetcher.data.settings);
      setBanner({
        tone: "success",
        text: fetcher.data.resetToDefaults
          ? "Settings reset to defaults."
          : "Settings saved.",
      });
    } else {
      setBanner({ tone: "danger", text: fetcher.data.error || "Could not save settings." });
    }

    clearTimeout(bannerTimeout.current);
    bannerTimeout.current = setTimeout(() => setBanner(null), 4000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data, fetcher.state]);

  useEffect(() => () => clearTimeout(bannerTimeout.current), []);

  const setField = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));

  const handleSave = () => {
    const fd = new FormData();
    fd.set("intent", "save");
    fd.set("jpegQuality",  String(clamp(form.jpegQuality,  BOUNDS.jpegQuality,  settings.jpegQuality)));
    fd.set("maxExportPx",  String(clamp(form.maxExportPx,  BOUNDS.maxExportPx,  settings.maxExportPx)));
    fd.set("collageGapPx", String(clamp(form.collageGapPx, BOUNDS.collageGapPx, settings.collageGapPx)));
    fetcher.submit(fd, { method: "post" });
  };

  const handleReset = () => {
    const fd = new FormData();
    fd.set("intent", "reset");
    fetcher.submit(fd, { method: "post" });
  };

  return (
    <s-page heading="Settings">
      <style>{`
        .settings-range-input {
          -webkit-appearance: none;
          appearance: none;
          height: 4px;
          border-radius: 999px;
          outline: none;
        }
        .settings-range-input::-webkit-slider-runnable-track {
          height: 4px;
          border-radius: 999px;
          background: transparent;
        }
        .settings-range-input::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 15px; height: 15px; border-radius: 50%;
          background: ${C.accentSecond};
          border: 2px solid ${C.accent};
          cursor: pointer;
          margin-top: -5.5px;
          box-shadow: 0 1px 4px rgba(0,0,0,0.4);
        }
        .settings-range-input::-moz-range-track {
          height: 4px;
          border-radius: 999px;
          background: ${C.cardElevated};
        }
        .settings-range-input::-moz-range-progress {
          height: 4px;
          border-radius: 999px;
          background: ${C.accent};
        }
        .settings-range-input::-moz-range-thumb {
          width: 15px; height: 15px; border-radius: 50%;
          background: ${C.accentSecond};
          border: 2px solid ${C.accent};
          cursor: pointer;
          box-shadow: 0 1px 4px rgba(0,0,0,0.4);
        }
        .settings-number-input {
          -moz-appearance: textfield;
        }
        .settings-number-input::-webkit-outer-spin-button,
        .settings-number-input::-webkit-inner-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
        .settings-number-input:focus {
          outline: none;
        }
      `}</style>

      <s-section>
        <s-bleed>
          <div style={{ background: C.bg, padding: "24px 20px 40px" }}>
            <div style={{ maxWidth: 640, margin: "0 auto", display: "flex", flexDirection: "column", gap: 20 }}>

              <div>
                <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: C.textPrimary }}>
                  Settings
                </h1>
                <p style={{ margin: "4px 0 0", fontSize: 13, color: C.muted, lineHeight: 1.5 }}>
                  These settings apply across Crop &amp; Resize, Split Grid, and Collage
                  whenever the editor saves a result back to your store&apos;s files.
                </p>
              </div>

              {banner && <Banner tone={banner.tone}>{banner.text}</Banner>}

              <SettingCard
                icon={<IcoImage size={17} />}
                title="JPEG export quality"
                description="Higher quality keeps more detail but produces larger files. 90–95 is a good default for product photography."
              >
                <SliderField
                  label="Quality"
                  value={form.jpegQuality}
                  onChange={setField("jpegQuality")}
                  bounds={BOUNDS.jpegQuality}
                  suffix="%"
                />
              </SettingCard>

              <SettingCard
                icon={<IcoExpand size={17} />}
                title="Max export dimension"
                description="Caps the longest edge of any exported image, in pixels. Files are automatically kept under Shopify's 25-megapixel upload limit regardless of this setting."
              >
                <SliderField
                  label="Max long edge"
                  value={form.maxExportPx}
                  onChange={setField("maxExportPx")}
                  bounds={BOUNDS.maxExportPx}
                  suffix="px"
                />
              </SettingCard>

              <SettingCard
                icon={<IcoGrid size={17} />}
                title="Collage tile gap"
                description="Space between tiles in Split Grid and Collage preview compositions, in pixels. Set to 0 for tiles that touch edge-to-edge."
              >
                <SliderField
                  label="Gap"
                  value={form.collageGapPx}
                  onChange={setField("collageGapPx")}
                  bounds={BOUNDS.collageGapPx}
                  suffix="px"
                />
              </SettingCard>

              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                paddingTop: 4,
              }}>
                <button
                  type="button"
                  onClick={handleReset}
                  disabled={isSaving}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 7,
                    padding: "10px 16px", background: "transparent",
                    color: isSaving ? C.muted : C.textSecondary,
                    border: `1px solid ${C.border}`, borderRadius: 9,
                    fontSize: 13, fontWeight: 600,
                    cursor: isSaving ? "default" : "pointer",
                  }}
                >
                  <IcoRefresh size={14} />
                  Reset to defaults
                </button>

                <button
                  type="button"
                  onClick={handleSave}
                  disabled={isSaving || !isDirty}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 8,
                    padding: "10px 20px",
                    background: (!isDirty || isSaving) ? C.cardElevated : C.accent,
                    color: (!isDirty || isSaving) ? C.muted : "#000",
                    border: "none", borderRadius: 9,
                    fontSize: 13, fontWeight: 700,
                    cursor: (!isDirty || isSaving) ? "default" : "pointer",
                    boxShadow: (!isDirty || isSaving) ? "none" : "0 4px 20px rgba(166,96,241,0.28)",
                    transition: "background 0.2s ease, color 0.2s ease, box-shadow 0.2s ease",
                  }}
                >
                  <IcoSave size={14} />
                  {isSaving ? "Saving…" : "Save"}
                </button>
              </div>

            </div>
          </div>
        </s-bleed>
      </s-section>
    </s-page>
  );
}

export const headers = (h) => boundary.headers(h);