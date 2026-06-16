// app/routes/webhooks.orders.fulfilled.jsx

import { authenticate } from "../shopify.server";
import { processOrderWebhook } from "../lib/webhooks.server";

export const action = async ({ request }) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  console.log(`Webhook received: ${topic} from ${shop}`);

  try {
    await processOrderWebhook({ shop, orderData: payload });
    return new Response(null, { status: 200 });
  } catch (error) {
    console.error(`Error processing ${topic} webhook:`, error);
    return new Response(null, { status: 200 });
  }
};