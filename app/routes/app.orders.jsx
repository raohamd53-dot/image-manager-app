// app/routes/app.orders.jsx

import { useLoaderData, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { db } from "../db.server";
import {
  getOrdersFromDB,
  syncOrdersFromShopify,
} from "../lib/db.orders.server";
import { withErrorHandling } from "../lib/errors.server";

// ─── Constants ───────────────────────────────────────────────────────────────

const financialTone = {
  PAID:               "success",
  PENDING:            "warning",
  PARTIALLY_PAID:     "warning",
  REFUNDED:           "critical",
  PARTIALLY_REFUNDED: "warning",
  VOIDED:             "critical",
};

const fulfillmentTone = {
  FULFILLED:   "success",
  UNFULFILLED: "attention",
  PARTIAL:     "warning",
  SCHEDULED:   "info",
  ON_HOLD:     "warning",
};

const reviewStatusTone = {
  NO_IMAGES: "info",
  PENDING:   "warning",
  APPROVED:  "success",
  REJECTED:  "critical",
  MIXED:     "warning",
};

const reviewStatusLabel = {
  NO_IMAGES: "No Images",
  PENDING:   "Pending Review",
  APPROVED:  "All Approved",
  REJECTED:  "Rejected",
  MIXED:     "Mixed",
};

// ─── Loader ──────────────────────────────────────────────────────────────────

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  return withErrorHandling(
    async () => {
      const shop = await db.shop.findUnique({
        where: { myshopifyDomain: session.shop },
      });

      if (!shop) {
        return {
          orders:     [],
          totalCount: 0,
          needsSync:  true,
          shop:       session.shop,
        };
      }

      const orders = await getOrdersFromDB(shop.id);

      return {
        orders,
        totalCount: orders.length,
        needsSync:  orders.length === 0,
        shop:       session.shop,
        shopId:     shop.id,
      };
    },
    {
      orders:     [],
      totalCount: 0,
      needsSync:  true,
      shop:       session.shop,
    }
  );
};

// ─── Action ──────────────────────────────────────────────────────────────────

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

  const formData = await request.formData();
  const intent   = formData.get("intent");

  if (intent === "sync") {
    try {
      // Fetch orders from Shopify API
      const response = await admin.graphql(
        `#graphql
        query SyncOrders($first: Int!) {
          orders(first: $first, sortKey: CREATED_AT, reverse: true) {
            edges {
              node {
                id
                name
                createdAt
                displayFinancialStatus
                displayFulfillmentStatus
                totalPriceSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }
              }
            }
          }
        }`,
        { variables: { first: 250 } }
      );

      const json   = await response.json();

      if (json.errors) {
        return { success: false, error: json.errors[0].message };
      }

      const shop = await db.shop.findUnique({
        where: { myshopifyDomain: session.shop },
      });

      if (!shop) {
        return { success: false, error: "Shop not found in database." };
      }

      const shopifyOrders = json.data.orders.edges.map((e) => e.node);
      const { synced, failed } = await syncOrdersFromShopify({
        shopId: shop.id,
        orders: shopifyOrders,
      });

      return { success: true, synced, failed };

    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  return { success: false, error: "Unknown intent" };
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function Orders() {
  const { orders, totalCount, needsSync, loaderError } = useLoaderData();
  const fetcher = useFetcher();

  const isSyncing    = fetcher.state !== "idle";
  const syncResult   = fetcher.data;

  return (
    <s-page heading={`Orders (${totalCount})`}>

      {/* Loader Error */}
      {loaderError && (
        <s-section>
          <s-banner tone="critical">
            <s-paragraph>Failed to load orders: {loaderError}</s-paragraph>
          </s-banner>
        </s-section>
      )}

      {/* Sync Success */}
      {syncResult?.success && (
        <s-section>
          <s-banner tone="success">
            <s-paragraph>
              Synced {syncResult.synced} orders from Shopify.
              {syncResult.failed > 0 && ` ${syncResult.failed} failed.`}
            </s-paragraph>
          </s-banner>
        </s-section>
      )}

      {/* Sync Error */}
      {syncResult?.success === false && (
        <s-section>
          <s-banner tone="critical">
            <s-paragraph>Sync failed: {syncResult.error}</s-paragraph>
          </s-banner>
        </s-section>
      )}

      {/* Sync Banner — shown when no orders in DB */}
      {needsSync && !loaderError && (
        <s-section>
          <s-banner tone="info">
            <s-paragraph>
              No orders in database yet. Click "Sync Orders" to pull
              your orders from Shopify into the local database. After
              this, webhooks will keep orders in sync automatically.
            </s-paragraph>
          </s-banner>
        </s-section>
      )}

      {/* Sync Button */}
      <s-section>
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="sync" />
          <s-button
            variant="primary"
            type="submit"
            disabled={isSyncing || undefined}
          >
            {isSyncing ? "Syncing..." : "Sync Orders from Shopify"}
          </s-button>
        </fetcher.Form>
      </s-section>

      {/* Orders Table */}
      {orders.length > 0 && (
        <s-section>
          <s-bleed>
            <s-data-table>
              <s-data-table-column>Order</s-data-table-column>
              <s-data-table-column>Customer</s-data-table-column>
              <s-data-table-column>Date</s-data-table-column>
              <s-data-table-column>Total</s-data-table-column>
              <s-data-table-column>Payment</s-data-table-column>
              <s-data-table-column>Fulfillment</s-data-table-column>
              <s-data-table-column>Images</s-data-table-column>
              <s-data-table-column>Review Status</s-data-table-column>
              <s-data-table-column>Actions</s-data-table-column>

              {orders.map((order) => (
                <s-data-table-row key={order.id}>

                  <s-data-table-cell>
                    <s-text font-weight="bold">{order.name}</s-text>
                  </s-data-table-cell>

                  <s-data-table-cell>
                    <s-text>{order.customerName}</s-text>
                  </s-data-table-cell>

                  <s-data-table-cell>
                    <s-text>{order.createdAt}</s-text>
                  </s-data-table-cell>

                  <s-data-table-cell>
                    <s-text>{order.total}</s-text>
                  </s-data-table-cell>

                  <s-data-table-cell>
                    <s-badge tone={financialTone[order.financialStatus] || "info"}>
                      {order.financialStatus}
                    </s-badge>
                  </s-data-table-cell>

                  <s-data-table-cell>
                    <s-badge tone={fulfillmentTone[order.fulfillmentStatus] || "info"}>
                      {order.fulfillmentStatus}
                    </s-badge>
                  </s-data-table-cell>

                  <s-data-table-cell>
                    {order.imageCount > 0 ? (
                      <s-badge tone="info">{order.imageCount}</s-badge>
                    ) : (
                      <s-text tone="subdued">—</s-text>
                    )}
                  </s-data-table-cell>

                  <s-data-table-cell>
                    <s-badge tone={reviewStatusTone[order.reviewStatus] || "info"}>
                      {reviewStatusLabel[order.reviewStatus] || order.reviewStatus}
                    </s-badge>
                  </s-data-table-cell>

                  <s-data-table-cell>
                    <s-button
                      tone="default"
                      variant="plain"
                      onclick={`window.open('https://${order.shopifyOrderId ? `admin.shopify.com/store/image-organizer-app/orders/${order.shopifyOrderId.split('/').pop()}` : '#'}', '_top')`}
                    >
                      View
                    </s-button>
                  </s-data-table-cell>

                </s-data-table-row>
              ))}
            </s-data-table>
          </s-bleed>
        </s-section>
      )}

    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};