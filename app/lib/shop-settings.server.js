// app/lib/shop-settings.server.js
//
// Single source of truth for the merchant-configurable export settings
// (JPEG quality, max export dimension, collage gap). Used by:
//   • app/routes/app.settings.jsx — reads/writes these via the Settings UI
//   • app/routes/app.editor.jsx   — reads these to apply at export time

import { db } from "../db.server";

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

/**
 * Ensures a Shop row exists for this myshopify domain and returns it.
 */
export async function ensureShop(myshopifyDomain) {
    return db.shop.upsert({
        where: { myshopifyDomain },
        update: {},
        create: { myshopifyDomain },
    });
}

/**
 * Reads this shop's export settings, creating a row with defaults on
 * first access. Safe to call from any loader/action that needs to
 * apply the merchant's export preferences.
 */
export async function getShopSettings(myshopifyDomain) {
    const shop = await ensureShop(myshopifyDomain);

    const settings = await db.shopSettings.upsert({
        where: { shopId: shop.id },
        update: {},
        create: { shopId: shop.id, ...SETTINGS_DEFAULTS },
    });

    return {
        jpegQuality: settings.jpegQuality,
        maxExportPx: settings.maxExportPx,
        collageGapPx: settings.collageGapPx,
    };
}