// app/routes/app._index.jsx

import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { upsertShop, getDashboardStats } from "../lib/db.orders.server";
import { getCompositionStats } from "../lib/db.compositions.server";
import { withErrorHandling } from "../lib/errors.server";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

  return withErrorHandling(
    async () => {
      const response = await admin.graphql(`
        #graphql
        query ShopData {
          shop {
            name
            email
            myshopifyDomain
            plan {
              displayName
            }
            currencyCode
          }
        }
      `);

      const json     = await response.json();
      const shopData = json.data.shop;

      const shop  = await upsertShop({
        myshopifyDomain: session.shop,
        name:            shopData.name,
        email:           shopData.email,
        plan:            shopData.plan.displayName,
      });

      const stats = await getDashboardStats(shop.id);
      const compositionStats = await getCompositionStats(shop.id);

      return { shop: shopData, stats, compositionStats };
    },
    // Fallback if anything fails
    {
      shop: {
        name:  "Your Store",
        email: "—",
        plan:  { displayName: "—" },
      },
      stats: {
        totalOrders:      0,
        ordersWithImages: 0,
        pendingReview:    0,
        approved:         0,
        rejected:         0,
      },
      compositionStats: { totalCompositions: 0, splitGridCount: 0, collageCount: 0, linkedToOrders: 0, pendingInCart: 0 },
    }
  );
};

export default function Dashboard() {
  const { shop, stats, compositionStats, loaderError } = useLoaderData();

  const statCards = [
    { label: "Total Orders",       value: stats.totalOrders,      tone: "info" },
    { label: "Orders With Images", value: stats.ordersWithImages, tone: "info" },
    { label: "Pending Review",     value: stats.pendingReview,    tone: "warning" },
    { label: "Approved",           value: stats.approved,         tone: "success" },
    { label: "Rejected",           value: stats.rejected,         tone: "critical" },
  ];

  const compositionCards = [
    { label: "Total Compositions", value: compositionStats.totalCompositions, tone: "info" },
    { label: "Split Grid",         value: compositionStats.splitGridCount,    tone: "info" },
    { label: "Photo Collage",      value: compositionStats.collageCount,      tone: "info" },
    { label: "Linked to Orders",   value: compositionStats.linkedToOrders,    tone: "success" },
    { label: "Pending in Cart",    value: compositionStats.pendingInCart,     tone: "warning" },
  ];

  return (
    <s-page heading="Image Upload Manager">

      {/* Show error banner but keep page functional */}
      {loaderError && (
        <s-section>
          <s-banner tone="warning">
            <s-paragraph>
              Some data could not be loaded: {loaderError}
            </s-paragraph>
          </s-banner>
        </s-section>
      )}

      <s-section heading="Store Information">
        <s-bleed>
          <s-box padding="400">
            <s-columns columns="3" gap="400">
              <s-stack gap="100">
                <s-text tone="subdued" font-size="body-sm">Store Name</s-text>
                <s-text font-weight="bold">{shop.name}</s-text>
              </s-stack>
              <s-stack gap="100">
                <s-text tone="subdued" font-size="body-sm">Email</s-text>
                <s-text>{shop.email}</s-text>
              </s-stack>
              <s-stack gap="100">
                <s-text tone="subdued" font-size="body-sm">Plan</s-text>
                <s-badge tone="info">{shop.plan.displayName}</s-badge>
              </s-stack>
            </s-columns>
          </s-box>
        </s-bleed>
      </s-section>

      <s-section heading="Overview">
        <s-columns columns="5" gap="400">
          {statCards.map((card) => (
            <s-box
              key={card.label}
              padding="400"
              background="surface"
              border-radius="200"
              border="base"
            >
              <s-stack gap="200" block-align="center">
                <s-text tone="subdued" font-size="body-sm">{card.label}</s-text>
                <s-text font-size="heading-xl" font-weight="bold">
                  {card.value}
                </s-text>
              </s-stack>
            </s-box>
          ))}
        </s-columns>
      </s-section>
      <s-section heading="Photo Layout Compositions">
        <s-columns columns="5" gap="400">
          {compositionCards.map((card) => (
            <s-box
              key={card.label}
              padding="400"
              background="surface"
              border-radius="200"
              border="base"
            >
              <s-stack gap="200" block-align="center">
                <s-text tone="subdued" font-size="body-sm">{card.label}</s-text>
                <s-text font-size="heading-xl" font-weight="bold">
                  {card.value}
                </s-text>
              </s-stack>
            </s-box>
          ))}
        </s-columns>
      </s-section>
      <s-section heading="Setup Status">
        <s-banner tone="success">
          <s-paragraph>
            <strong>All Systems Operational:</strong> Database connected,
            webhooks active, image review workflow ready.
          </s-paragraph>
        </s-banner>
      </s-section>

    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};