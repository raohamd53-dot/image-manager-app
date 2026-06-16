// app/routes/webhooks.app.scopes_update.jsx

import { authenticate } from "../shopify.server";

export const action = async ({ request }) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  console.log(`Webhook received: ${topic} from ${shop}`);
  console.log("Scopes updated:", payload);

  // In Phase 6 we handle scope changes properly
  // For now just acknowledge receipt
  return new Response(null, { status: 200 });
};