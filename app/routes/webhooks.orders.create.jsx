// app/routes/webhooks.orders.create.jsx

import { authenticate } from "../shopify.server";
import { processOrderWebhook } from "../lib/webhooks.server";

export const action = async ({ request }) => {
  // authenticate.webhook verifies the HMAC signature
  // If invalid, it throws a 401 automatically
  const { topic, shop, payload } = await authenticate.webhook(request);

  console.log(`Webhook received: ${topic} from ${shop}`);

  try {
    await processOrderWebhook({ shop, orderData: payload });
    return new Response(null, { status: 200 });
  } catch (error) {
    console.error(`Error processing ${topic} webhook:`, error);
    // Still return 200 to prevent Shopify from retrying
    // Log the error for debugging but don't fail the webhook
    return new Response(null, { status: 200 });
  }
};