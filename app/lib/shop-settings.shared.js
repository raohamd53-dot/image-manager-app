// app/lib/shop-settings.shared.js
//
// Client-safe constants + pure helpers for the merchant-configurable
// export settings (JPEG quality, max export dimension, collage gap).
// No server-only imports here (no db.server) — this file is bundled
// into the client as well as the server, unlike shop-settings.server.js.

export const SETTINGS_DEFAULTS = { jpegQuality: 92, maxExportPx: 4096, collageGapPx: 4 };

export const SETTINGS_BOUNDS = {
    jpegQuality: { min: 1, max: 100, step: 1 },
    maxExportPx: { min: 512, max: 8000, step: 1 },
    collageGapPx: { min: 0, max: 100, step: 1 },
};

export function clampSetting(value, bounds, fallback) {
    const { min, max } = bounds;
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
}