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

  // ─── Link any compositions referenced in line item properties ──────────
  await linkCompositionsFromLineItems({ order, orderData });

  return order;
}

/**
 * Scans every line item's properties for "_composition_id" and links
 * the matching Composition record to this order.
 * This is how customer-built layouts get connected to real Shopify orders.
 */
async function linkCompositionsFromLineItems({ order, orderData }) {
  const lineItems = orderData.line_items || [];

  for (const item of lineItems) {
    const properties = item.properties;
    if (!properties) continue;

    // Shopify sends properties as an array of {name, value} OR as an object
    // depending on API version — handle both shapes defensively
    let compositionId = null;

    if (Array.isArray(properties)) {
      const match = properties.find((p) => p.name === "_composition_id");
      compositionId = match?.value || null;
    } else if (typeof properties === "object") {
      compositionId = properties["_composition_id"] || null;
    }

    if (compositionId) {
      try {
        await db.composition.update({
          where: { id: compositionId },
          data:  { orderId: order.id },
        });
        console.log(`Linked composition ${compositionId} to order ${order.orderName}`);
      } catch (error) {
        // Composition might not exist (e.g. test webhook data) — log and continue
        console.log(`Could not link composition ${compositionId}: ${error.message}`);
      }
    }
  }
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