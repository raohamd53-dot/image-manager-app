// app/lib/webhooks.server.js

import { db } from "../db.server";

/**
 * Process an incoming order from any webhook topic.
 * Uses upsert so it's safe to call from multiple webhook types
 * for the same order without creating duplicates.
 */
export async function processOrderWebhook({ shop, orderData }) {

  // Step 1 — Find the shop in our database
  const shopRecord = await db.shop.findUnique({
    where: { myshopifyDomain: shop },
  });

  // If shop not found, the app was likely uninstalled
  // Return silently — don't throw, just log
  if (!shopRecord) {
    console.log(`Webhook received for unknown shop: ${shop}. Skipping.`);
    return null;
  }

  // Step 2 — Extract customer info safely
  // customer can be null for guest checkouts
  const customerName = orderData.customer
    ? `${orderData.customer.first_name || ""} ${orderData.customer.last_name || ""}`.trim()
    : "Guest";

  const customerEmail = orderData.customer?.email || null;

  // Step 3 — Upsert the order
  // If the order already exists (from a previous webhook), update it
  // If it doesn't exist, create it
  const order = await db.order.upsert({
    where: {
      shopId_shopifyOrderId: {
        shopId:        shopRecord.id,
        shopifyOrderId: String(orderData.id),
      },
    },
    update: {
      orderName:         orderData.name,
      financialStatus:   orderData.financial_status?.toUpperCase() || null,
      fulfillmentStatus: orderData.fulfillment_status?.toUpperCase() || "UNFULFILLED",
      totalPrice:        orderData.total_price,
      currency:          orderData.currency,
      customerName,
      customerEmail,
      updatedAt:         new Date(),
    },
    create: {
      shopId:            shopRecord.id,
      shopifyOrderId:    String(orderData.id),
      orderName:         orderData.name,
      financialStatus:   orderData.financial_status?.toUpperCase() || null,
      fulfillmentStatus: orderData.fulfillment_status?.toUpperCase() || "UNFULFILLED",
      totalPrice:        orderData.total_price,
      currency:          orderData.currency,
      customerName,
      customerEmail,
      shopifyCreatedAt:  orderData.created_at
        ? new Date(orderData.created_at)
        : null,
    },
  });

  console.log(`Order synced: ${order.orderName} for shop: ${shop}`);
  return order;
}

/**
 * Handle app uninstall — clean up shop data.
 * Deletes the shop record which cascades to all related data
 * due to onDelete: Cascade in our Prisma schema.
 */
export async function processAppUninstalled({ shop }) {
  const shopRecord = await db.shop.findUnique({
    where: { myshopifyDomain: shop },
  });

  if (!shopRecord) {
    console.log(`Uninstall webhook for unknown shop: ${shop}. Skipping.`);
    return;
  }

  // Delete sessions for this shop
  await db.session.deleteMany({
    where: { shop },
  });

  // Delete shop record (cascades to orders, images, reviews, settings)
  await db.shop.delete({
    where: { myshopifyDomain: shop },
  });

  console.log(`Shop uninstalled and data cleaned up: ${shop}`);
}