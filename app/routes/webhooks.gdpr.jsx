// app/routes/webhooks.gdpr.jsx
//
// Mandatory Shopify compliance webhooks, required for public App Store
// distribution: customers/data_request, customers/redact, shop/redact.
// All three are routed to this single endpoint via `compliance_topics`
// in shopify.app.public.toml.
//
// PicCut's scopes are read_files + write_files only — the app never
// requests customer or order data, so there is no customer data to
// surface or redact. shop/redact still needs to clear out any shop-level
// record as a safety net, in case the app/uninstalled webhook was missed
// or the merchant reinstalls/uninstalls in quick succession.

import { authenticate } from "../shopify.server";
import { db } from "../db.server";

export const action = async ({ request }) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  console.log(`Compliance webhook received: ${topic} from ${shop}`);

  try {
    switch (topic) {
      case "customers/data_request": {
        // PicCut never requests customer or order scopes, so it holds no
        // customer data to return. Nothing to do beyond acknowledging.
        console.log(
          `No customer data held for shop ${shop}; nothing to return for customer ${payload?.customer?.id}.`,
        );
        break;
      }

      case "customers/redact": {
        // Same as above — no customer-level data is ever stored, so
        // there's nothing to redact.
        console.log(
          `No customer data held for shop ${shop}; nothing to redact for customer ${payload?.customer?.id}.`,
        );
        break;
      }

      case "shop/redact": {
        // Fires 48 hours after uninstall. app/uninstalled already deletes
        // the shop's Session and Shop rows immediately, but this is a
        // safety-net cleanup in case that webhook was missed.
        await db.session.deleteMany({ where: { shop } });
        await db.shop.deleteMany({ where: { myshopifyDomain: shop } });
        console.log(`shop/redact cleanup complete for ${shop}`);
        break;
      }

      default: {
        console.warn(`Unhandled compliance topic: ${topic}`);
      }
    }
  } catch (error) {
    // Log but always return 200 — Shopify retries on non-2xx responses,
    // and a retry storm on a broken handler is worse than a missed log.
    console.error(`Error handling compliance webhook ${topic} for ${shop}:`, error);
  }

  return new Response(null, { status: 200 });
};