// app/routes/webhooks.app.uninstalled.jsx

import { authenticate } from "../shopify.server";
import { processAppUninstalled } from "../lib/webhooks.server";

export const action = async ({ request }) => {
  const { topic, shop } = await authenticate.webhook(request);

  console.log(`Webhook received: ${topic} from ${shop}`);

  try {
    await processAppUninstalled({ shop });
    return new Response(null, { status: 200 });
  } catch (error) {
    console.error(`Error processing ${topic} webhook:`, error);
    return new Response(null, { status: 200 });
  }
};