
import { redirect } from "react-router";
export const loader = async ({ request }) => {
  const url = new URL(request.url);

  // Forward the full querystring (shop, host, embedded, hmac, etc.)
  // so Shopify's embedded auth can validate the session correctly.
  throw redirect(`/app${url.search}`);
};