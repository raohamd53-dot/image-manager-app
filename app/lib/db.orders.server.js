// app/lib/db.orders.server.js

import { db } from "../db.server";

// ─── Shop Operations ─────────────────────────────────────────────────────────

/**
 * Find or create a shop record.
 * Called when a merchant installs or opens the app.
 */
export async function upsertShop({ myshopifyDomain, name, email, plan }) {
  return db.shop.upsert({
    where:  { myshopifyDomain },
    update: { name, email, plan, updatedAt: new Date() },
    create: { myshopifyDomain, name, email, plan },
  });
}

// ─── Order Operations ─────────────────────────────────────────────────────────

/**
 * Sync a Shopify order into our database.
 * Uses upsert so it's safe to call multiple times for the same order.
 */
export async function upsertOrder({
  shopId,
  shopifyOrderId,
  orderName,
  financialStatus,
  fulfillmentStatus,
  totalPrice,
  currency,
  customerName,
  customerEmail,
  shopifyCreatedAt,
}) {
  return db.order.upsert({
    where: {
      shopId_shopifyOrderId: { shopId, shopifyOrderId },
    },
    update: {
      orderName,
      financialStatus,
      fulfillmentStatus,
      totalPrice,
      currency,
      customerName,
      customerEmail,
      updatedAt: new Date(),
    },
    create: {
      shopId,
      shopifyOrderId,
      orderName,
      financialStatus,
      fulfillmentStatus,
      totalPrice,
      currency,
      customerName,
      customerEmail,
      shopifyCreatedAt: shopifyCreatedAt ? new Date(shopifyCreatedAt) : null,
    },
  });
}

/**
 * Get all orders for a shop with their image counts.
 */
export async function getOrdersWithImageCounts(shopId) {
  return db.order.findMany({
    where: { shopId },
    orderBy: { shopifyCreatedAt: "desc" },
    include: {
      _count: {
        select: { imageUploads: true },
      },
    },
  });
}

// ─── Image Operations ─────────────────────────────────────────────────────────

/**
 * Get all image uploads for a shop with order info.
 */
export async function getImageUploadsForShop(shopId) {
  return db.imageUpload.findMany({
    where: {
      order: { shopId },
    },
    include: {
      order: {
        select: {
          orderName:     true,
          customerName:  true,
          shopifyOrderId: true,
        },
      },
    },
    orderBy: { uploadedAt: "desc" },
  });
}

/**
 * Update image review status and create an audit trail entry.
 */
export async function reviewImage({
  imageUploadId,
  status,
  action,
  note,
  merchantId,
}) {
  // Use a transaction — both operations must succeed or both fail
  return db.$transaction([
    db.imageUpload.update({
      where: { id: imageUploadId },
      data:  { status, notes: note, updatedAt: new Date() },
    }),
    db.imageReview.create({
      data: { imageUploadId, action, note, merchantId },
    }),
  ]);
}

// ─── Dashboard Stats ──────────────────────────────────────────────────────────

/**
 * Get all metrics needed for the dashboard in a single query.
 */
export async function getDashboardStats(shopId) {
  const [
    totalOrders,
    ordersWithImages,
    pendingImages,
    approvedImages,
    rejectedImages,
  ] = await Promise.all([
    db.order.count({ where: { shopId } }),
    db.order.count({
      where: {
        shopId,
        imageUploads: { some: {} },
      },
    }),
    db.imageUpload.count({
      where: { status: "PENDING", order: { shopId } },
    }),
    db.imageUpload.count({
      where: { status: "APPROVED", order: { shopId } },
    }),
    db.imageUpload.count({
      where: { status: "REJECTED", order: { shopId } },
    }),
  ]);

  return {
    totalOrders,
    ordersWithImages,
    pendingReview: pendingImages,
    approved:      approvedImages,
    rejected:      rejectedImages,
  };
}

// Add to app/lib/db.orders.server.js

/**
 * Get orders for a shop from our database with image counts.
 * Much faster than hitting Shopify API every time.
 */
export async function getOrdersFromDB(shopId) {
  const orders = await db.order.findMany({
    where:   { shopId },
    orderBy: { shopifyCreatedAt: "desc" },
    include: {
      _count: {
        select: { imageUploads: true },
      },
      imageUploads: {
        select: { status: true },
      },
    },
  });

  return orders.map((order) => {
    const pending  = order.imageUploads.filter((i) => i.status === "PENDING").length;
    const approved = order.imageUploads.filter((i) => i.status === "APPROVED").length;
    const rejected = order.imageUploads.filter((i) => i.status === "REJECTED").length;

    return {
      id:                order.id,
      shopifyOrderId:    order.shopifyOrderId,
      name:              order.orderName,
      createdAt:         order.shopifyCreatedAt
        ? new Date(order.shopifyCreatedAt).toLocaleDateString("en-US", {
            year: "numeric", month: "short", day: "numeric",
          })
        : "—",
      financialStatus:   order.financialStatus   || "—",
      fulfillmentStatus: order.fulfillmentStatus || "—",
      total:             order.totalPrice
        ? `${order.currency || ""} ${parseFloat(order.totalPrice).toFixed(2)}`
        : "—",
      customerName:      order.customerName  || "—",
      customerEmail:     order.customerEmail || "—",
      imageCount:        order._count.imageUploads,
      pendingImages:     pending,
      approvedImages:    approved,
      rejectedImages:    rejected,
      reviewStatus:      order._count.imageUploads === 0
        ? "NO_IMAGES"
        : pending > 0
        ? "PENDING"
        : approved > 0 && rejected === 0
        ? "APPROVED"
        : rejected > 0 && pending === 0
        ? "REJECTED"
        : "MIXED",
    };
  });
}

/**
 * Sync a batch of orders from Shopify API into our database.
 * Called when merchant clicks "Sync Orders" button.
 */
export async function syncOrdersFromShopify({ shopId, orders }) {
  const results = await Promise.allSettled(
    orders.map((order) =>
      upsertOrder({
        shopId,
        shopifyOrderId:    order.id,
        orderName:         order.name,
        financialStatus:   order.displayFinancialStatus,
        fulfillmentStatus: order.displayFulfillmentStatus,
        totalPrice:        order.totalPriceSet?.shopMoney?.amount,
        currency:          order.totalPriceSet?.shopMoney?.currencyCode,
        customerName:      null,
        customerEmail:     null,
        shopifyCreatedAt:  order.createdAt,
      })
    )
  );

  const synced = results.filter((r) => r.status === "fulfilled").length;
  const failed = results.filter((r) => r.status === "rejected").length;

  return { synced, failed };
}