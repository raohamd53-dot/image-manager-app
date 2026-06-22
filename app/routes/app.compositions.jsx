// app/routes/app.compositions.jsx

import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { db } from "../db.server";
import { getCompositionsForShop } from "../lib/db.compositions.server";
import { withErrorHandling } from "../lib/errors.server";

const layoutTypeLabel = {
  split:   "Split Photo Grid",
  collage: "Photo Collage",
};

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  return withErrorHandling(
    async () => {
      const shop = await db.shop.findUnique({
        where: { myshopifyDomain: session.shop },
      });

      if (!shop) return { compositions: [] };

      const compositions = await getCompositionsForShop(shop.id);

      const formatted = compositions.map((c) => ({
        id:           c.id,
        layoutType:   layoutTypeLabel[c.layoutType] || c.layoutType,
        gridSize:     c.gridSize,
        previewUrl:   c.previewUrl,
        imageCount:   c.images.length,
        orderId:      c.orderId,
        orderName:    c.order?.orderName || null,
        customerName: c.order?.customerName || null,
        status:       c.orderId ? "Linked to Order" : "In Cart / Pending",
        createdAt:    new Date(c.createdAt).toLocaleDateString("en-US", {
          year: "numeric", month: "short", day: "numeric",
        }),
      }));

      return { compositions: formatted };
    },
    { compositions: [] }
  );
};

export default function Compositions() {
  const { compositions, loaderError } = useLoaderData();

  return (
    <s-page heading={`Compositions (${compositions.length})`}>

      {loaderError && (
        <s-section>
          <s-banner tone="critical">
            <s-paragraph>Failed to load compositions: {loaderError}</s-paragraph>
          </s-banner>
        </s-section>
      )}

      {compositions.length === 0 && !loaderError && (
        <s-section>
          <s-empty-state heading="No compositions yet">
            <s-paragraph>
              When customers build a photo layout on your product page,
              it will appear here.
            </s-paragraph>
          </s-empty-state>
        </s-section>
      )}

      {compositions.length > 0 && (
        <s-section>
          <s-columns columns="4" gap="400">
            {compositions.map((comp) => (
              <a
                key={comp.id}
                href={`/app/compositions/${comp.id}`}
                style={{ textDecoration: "none" }}
              >
                <s-box padding="300" border="base" border-radius="200" background="surface">
                  <s-stack gap="200">

                    <div style={{
                      width: "100%",
                      aspectRatio: "1",
                      borderRadius: "6px",
                      overflow: "hidden",
                      background: "#f0f0f0",
                    }}>
                      {comp.previewUrl ? (
                        <img
                          src={comp.previewUrl}
                          alt="Composition preview"
                          style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        />
                      ) : (
                        <s-text tone="subdued">No preview</s-text>
                      )}
                    </div>

                    <s-text font-weight="bold" font-size="body-sm">
                      {comp.layoutType}
                    </s-text>
                    <s-text tone="subdued" font-size="body-sm">
                      Grid: {comp.gridSize} · {comp.imageCount} images
                    </s-text>

                    <s-badge tone={comp.orderId ? "success" : "warning"}>
                      {comp.status}
                    </s-badge>

                    {comp.orderName && (
                      <s-text font-size="body-sm">
                        Order: {comp.orderName}
                      </s-text>
                    )}

                    <s-text tone="subdued" font-size="body-sm">
                      {comp.createdAt}
                    </s-text>

                  </s-stack>
                </s-box>
              </a>
            ))}
          </s-columns>
        </s-section>
      )}

    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};