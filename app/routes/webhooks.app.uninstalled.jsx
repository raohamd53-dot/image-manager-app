// app/routes/webhooks.app.uninstalled.jsx

import { authenticate } from "../shopify.server";
import { db }           from "../db.server";

export const action = async ({ request }) => {
  const { topic, shop } = await authenticate.webhook(request);

  console.log(`Webhook received: ${topic} from ${shop}`);

  try {
    // Delete the merchant's session so the access token is removed.
    // If they reinstall later, a fresh OAuth flow issues a new token.
    await db.session.deleteMany({ where: { shop } });

    // Delete the shop record (optional but keeps DB clean).
    await db.shop.deleteMany({ where: { myshopifyDomain: shop } });

    console.log(`Cleaned up data for uninstalled shop: ${shop}`);
  } catch (error) {
    // Log but always return 200 — Shopify retries on non-2xx responses
    console.error(`Error cleaning up after uninstall for ${shop}:`, error);
  }

  return new Response(null, { status: 200 });
};