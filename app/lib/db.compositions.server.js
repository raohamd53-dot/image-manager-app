// app/lib/db.compositions.server.js

import { db } from "../db.server";

/**
 * Create an Upload record for a file that was just saved to disk.
 */
export async function createUpload({ shopId, originalUrl, width, height, fileSize, mimeType }) {
  return db.upload.create({
    data: { shopId, originalUrl, width, height, fileSize, mimeType },
  });
}

/**
 * Create a new Composition record in a pending state, before processing.
 */
export async function createComposition({ shopId, layoutType, gridSize, productId, variantId, cartToken }) {
  return db.composition.create({
    data: { shopId, layoutType, gridSize, productId, variantId, cartToken },
  });
}

/**
 * After Sharp processing completes, save the preview URL and all cell images.
 */
export async function saveCompositionResult({ compositionId, previewUrl, cells, uploadIdByCell }) {
  return db.$transaction([
    db.composition.update({
      where: { id: compositionId },
      data: { previewUrl, updatedAt: new Date() },
    }),
    db.compositionImage.createMany({
      data: cells.map((cell) => ({
        compositionId,
        position: cell.position,
        imageUrl: cell.imageUrl,
        uploadId: uploadIdByCell?.[cell.position] || null,
      })),
    }),
  ]);
}

/**
 * Get a full composition with all its cell images — used by the
 * merchant-facing composition detail page.
 */
export async function getCompositionById(compositionId) {
  return db.composition.findUnique({
    where: { id: compositionId },
    include: {
      images: { orderBy: { position: "asc" } },
      order: true,
    },
  });
}

/**
 * Link a composition to a real Shopify order.
 * Called from the orders/create webhook when it finds matching
 * cartToken or line item properties.
 */
export async function linkCompositionToOrder({ compositionId, orderId }) {
  return db.composition.update({
    where: { id: compositionId },
    data: { orderId },
  });
}

/**
 * Get all compositions for a shop — used for dashboard stats and
 * the compositions list page.
 */
export async function getCompositionsForShop(shopId) {
  return db.composition.findMany({
    where: { shopId },
    orderBy: { createdAt: "desc" },
    include: {
      images: true,
      order: {
        select: { orderName: true, customerName: true },
      },
    },
  });
}

/**
 * Composition stats for the dashboard.
 */
export async function getCompositionStats(shopId) {
  const [total, splitCount, collageCount, linkedCount] = await Promise.all([
    db.composition.count({ where: { shopId } }),
    db.composition.count({ where: { shopId, layoutType: "split" } }),
    db.composition.count({ where: { shopId, layoutType: "collage" } }),
    db.composition.count({ where: { shopId, orderId: { not: null } } }),
  ]);

  return {
    totalCompositions: total,
    splitGridCount: splitCount,
    collageCount: collageCount,
    linkedToOrders: linkedCount,
    pendingInCart: total - linkedCount,
  };
}