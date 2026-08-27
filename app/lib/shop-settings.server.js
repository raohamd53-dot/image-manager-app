/* eslint-env node */
// app/lib/shop-settings.server.js
//
// Server-only DB access for the merchant-configurable export settings.
// Constants/bounds live in shop-settings.shared.js (client-safe) —
// keep DB-touching code out of that file, or the client bundle build
// fails with a "server-only module referenced by client" error.
//
// Used by:
//   • app/routes/app.settings.jsx — reads/writes these via the Settings UI
//   • app/routes/app.editor.jsx   — reads these to apply at export time

import { db } from "../db.server";
import { SETTINGS_DEFAULTS } from "./shop-settings.shared";

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