import { authenticate } from "../shopify.server";
import { boundary }     from "@shopify/shopify-app-react-router/server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return {};
};

export default function Settings() {
  return (
    <s-page heading="Settings">
      <s-section>
        <s-text tone="subdued">Settings coming soon.</s-text>
      </s-section>
    </s-page>
  );
}

export const headers = (h) => boundary.headers(h);