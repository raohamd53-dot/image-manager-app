// app/routes/app.compositions.$id.jsx

import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getCompositionById } from "../lib/db.compositions.server";
import { withErrorHandling } from "../lib/errors.server";

const layoutTypeLabel = {
  split:   "Split Photo Grid",
  collage: "Photo Collage",
};

export const loader = async ({ request, params }) => {
  await authenticate.admin(request);

  return withErrorHandling(
    async () => {
      const composition = await getCompositionById(params.id);

      if (!composition) {
        throw new Error("Composition not found");
      }

      return {
        composition: {
          id:           composition.id,
          layoutType:   layoutTypeLabel[composition.layoutType] || composition.layoutType,
          gridSize:     composition.gridSize,
          previewUrl:   composition.previewUrl,
          orderName:    composition.order?.orderName || null,
          customerName: composition.order?.customerName || null,
          createdAt:    new Date(composition.createdAt).toLocaleString("en-US"),
          images:       composition.images.map((img) => ({
            id:       img.id,
            position: img.position,
            imageUrl: img.imageUrl,
          })),
        },
      };
    },
    { composition: null }
  );
};

export default function CompositionDetail() {
  const { composition, loaderError } = useLoaderData();

  if (loaderError || !composition) {
    return (
      <s-page heading="Composition Not Found">
        <s-section>
          <s-banner tone="critical">
            <s-paragraph>{loaderError || "This composition could not be found."}</s-paragraph>
          </s-banner>
        </s-section>
      </s-page>
    );
  }

  return (
    <s-page heading={composition.layoutType} subheading={`Grid: ${composition.gridSize}`}>

      {/* Order Info */}
      <s-section heading="Order Information">
        <s-columns columns="3" gap="400">
          <s-stack gap="100">
            <s-text tone="subdued" font-size="body-sm">Order</s-text>
            <s-text font-weight="bold">{composition.orderName || "Not yet linked"}</s-text>
          </s-stack>
          <s-stack gap="100">
            <s-text tone="subdued" font-size="body-sm">Customer</s-text>
            <s-text>{composition.customerName || "—"}</s-text>
          </s-stack>
          <s-stack gap="100">
            <s-text tone="subdued" font-size="body-sm">Created</s-text>
            <s-text>{composition.createdAt}</s-text>
          </s-stack>
        </s-columns>
      </s-section>

      {/* Final Preview */}
      <s-section heading="Final Preview">
        <s-box padding="400" border="base" border-radius="200" background="surface">
          <s-stack gap="300">
            {composition.previewUrl ? (
              <img
                src={composition.previewUrl}
                alt="Final composition preview"
                style={{ maxWidth: "500px", width: "100%", borderRadius: "8px" }}
              />
            ) : (
              <s-text tone="subdued">No preview available</s-text>
            )}
            {composition.previewUrl && (
              <a href={composition.previewUrl} download target="_blank" rel="noopener noreferrer">
                <s-button variant="primary">Download Final Preview</s-button>
              </a>
            )}
          </s-stack>
        </s-box>
      </s-section>

      {/* Individual Cell Images */}
      <s-section heading={`Individual Images (${composition.images.length})`}>
        <s-columns columns="3" gap="400">
          {composition.images.map((img) => (
            <s-box key={img.id} padding="300" border="base" border-radius="200" background="surface">
              <s-stack gap="200">
                <div style={{
                  width: "100%",
                  aspectRatio: "1",
                  borderRadius: "6px",
                  overflow: "hidden",
                  background: "#f0f0f0",
                }}>
                  <img
                    src={img.imageUrl}
                    alt={`Cell ${img.position}`}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                </div>
                <s-text tone="subdued" font-size="body-sm">
                  Position: {img.position}
                </s-text>
                <a href={img.imageUrl} download target="_blank" rel="noopener noreferrer">
                  <s-button variant="plain">Download</s-button>
                </a>
              </s-stack>
            </s-box>
          ))}
        </s-columns>
      </s-section>

    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};