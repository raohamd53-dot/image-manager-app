// app/routes/app.images.jsx

import { useLoaderData, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { db } from "../db.server";

// ─── Loader ──────────────────────────────────────────────────────────────────

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  const shop = await db.shop.findUnique({
    where: { myshopifyDomain: session.shop },
  });

  if (!shop) return { images: [] };

  const images = await db.imageUpload.findMany({
    where: { order: { shopId: shop.id } },
    include: {
      order: {
        select: {
          orderName:      true,
          customerName:   true,
          shopifyOrderId: true,
        },
      },
    },
    orderBy: { uploadedAt: "desc" },
  });

  return { images };
};

// ─── Action ──────────────────────────────────────────────────────────────────

export const action = async ({ request }) => {
  await authenticate.admin(request);

  const formData = await request.formData();
  const intent        = formData.get("intent");
  const imageUploadId = formData.get("imageUploadId");
  const note          = formData.get("note");

  if (intent === "approve") {
    await db.$transaction([
      db.imageUpload.update({
        where: { id: imageUploadId },
        data:  { status: "APPROVED", updatedAt: new Date() },
      }),
      db.imageReview.create({
        data: { imageUploadId, action: "APPROVED", note: note || null },
      }),
    ]);
  }

  if (intent === "reject") {
    await db.$transaction([
      db.imageUpload.update({
        where: { id: imageUploadId },
        data:  { status: "REJECTED", updatedAt: new Date() },
      }),
      db.imageReview.create({
        data: { imageUploadId, action: "REJECTED", note: note || null },
      }),
    ]);
  }

  if (intent === "note") {
    await db.$transaction([
      db.imageUpload.update({
        where: { id: imageUploadId },
        data:  { notes: note, updatedAt: new Date() },
      }),
      db.imageReview.create({
        data: { imageUploadId, action: "NOTE_ADDED", note },
      }),
    ]);
  }

  return { success: true };
};

// ─── Status Badge Tone ───────────────────────────────────────────────────────

const statusTone = {
  PENDING:        "warning",
  APPROVED:       "success",
  REJECTED:       "critical",
  NEEDS_REVISION: "attention",
};

// ─── Image Card Component ────────────────────────────────────────────────────

function ImageCard({ image }) {
  const fetcher = useFetcher();
  const isSubmitting = fetcher.state !== "idle";

  // Optimistic status update
  const currentStatus = fetcher.formData
    ? fetcher.formData.get("intent") === "approve"
      ? "APPROVED"
      : fetcher.formData.get("intent") === "reject"
      ? "REJECTED"
      : image.status
    : image.status;

  return (
    <s-box padding="400" border="base" border-radius="200" background="surface">
      <s-stack gap="300">

        {/* Image Preview */}
        <div style={{
          width: "100%",
          aspectRatio: "4/3",
          overflow: "hidden",
          borderRadius: "8px",
          background: "#f6f6f7",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}>
          <img
            src={image.imageUrl}
            alt={image.originalName || "Customer upload"}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
            onError={(e) => {
              e.target.style.display = "none";
              e.target.parentNode.innerHTML = "<s-text tone='subdued'>Preview unavailable</s-text>";
            }}
          />
        </div>

        {/* Image Info */}
        <s-stack gap="100">
          <s-text font-weight="bold">
            {image.order.orderName}
          </s-text>
          <s-text tone="subdued" font-size="body-sm">
            {image.originalName || "Unnamed file"}
          </s-text>
          <s-text tone="subdued" font-size="body-sm">
            Uploaded: {new Date(image.uploadedAt).toLocaleDateString("en-US", {
              year: "numeric", month: "short", day: "numeric"
            })}
          </s-text>
          {image.fileSize && (
            <s-text tone="subdued" font-size="body-sm">
              Size: {(image.fileSize / 1024).toFixed(1)} KB
            </s-text>
          )}
        </s-stack>

        {/* Status Badge */}
        <s-badge tone={statusTone[currentStatus] || "info"}>
          {currentStatus}
        </s-badge>

        {/* Review Actions */}
        {currentStatus === "PENDING" && (
          <s-stack gap="200">
            <s-columns columns="2" gap="200">
              <fetcher.Form method="post">
                <input type="hidden" name="intent"        value="approve" />
                <input type="hidden" name="imageUploadId" value={image.id} />
                <s-button
                  tone="success"
                  variant="primary"
                  type="submit"
                  disabled={isSubmitting || undefined}
                  style={{ width: "100%" }}
                >
                  Approve
                </s-button>
              </fetcher.Form>

              <fetcher.Form method="post">
                <input type="hidden" name="intent"        value="reject" />
                <input type="hidden" name="imageUploadId" value={image.id} />
                <s-button
                  tone="critical"
                  variant="primary"
                  type="submit"
                  disabled={isSubmitting || undefined}
                  style={{ width: "100%" }}
                >
                  Reject
                </s-button>
              </fetcher.Form>
            </s-columns>
          </s-stack>
        )}

        {/* Add Note */}
        <fetcher.Form method="post">
          <input type="hidden" name="intent"        value="note" />
          <input type="hidden" name="imageUploadId" value={image.id} />
          <s-stack gap="200">
            <s-text-field
              name="note"
              label="Internal Note"
              placeholder="Add a note for this image..."
              multiline="2"
            />
            <s-button type="submit" disabled={isSubmitting || undefined}>
              Save Note
            </s-button>
          </s-stack>
        </fetcher.Form>

      </s-stack>
    </s-box>
  );
}

// ─── Page Component ───────────────────────────────────────────────────────────

export default function Images() {
  const { images } = useLoaderData();

  if (images.length === 0) {
    return (
      <s-page heading="Images">
        <s-section>
          <s-empty-state heading="No images uploaded yet">
            <s-paragraph>
              When customers upload images during checkout, they will appear
              here for your review. Use the upload widget on your product pages
              to get started.
            </s-paragraph>
          </s-empty-state>
        </s-section>
      </s-page>
    );
  }

  const pending  = images.filter((i) => i.status === "PENDING");
  const approved = images.filter((i) => i.status === "APPROVED");
  const rejected = images.filter((i) => i.status === "REJECTED");

  return (
    <s-page heading={`Images (${images.length})`}>

      {/* Summary Bar */}
      <s-section>
        <s-columns columns="3" gap="400">
          <s-box padding="300" border="base" border-radius="200">
            <s-stack gap="100" block-align="center">
              <s-text tone="subdued" font-size="body-sm">Pending Review</s-text>
              <s-badge tone="warning">{pending.length}</s-badge>
            </s-stack>
          </s-box>
          <s-box padding="300" border="base" border-radius="200">
            <s-stack gap="100" block-align="center">
              <s-text tone="subdued" font-size="body-sm">Approved</s-text>
              <s-badge tone="success">{approved.length}</s-badge>
            </s-stack>
          </s-box>
          <s-box padding="300" border="base" border-radius="200">
            <s-stack gap="100" block-align="center">
              <s-text tone="subdued" font-size="body-sm">Rejected</s-text>
              <s-badge tone="critical">{rejected.length}</s-badge>
            </s-stack>
          </s-box>
        </s-columns>
      </s-section>

      {/* Pending Images First */}
      {pending.length > 0 && (
        <s-section heading={`Pending Review (${pending.length})`}>
          <s-columns columns="3" gap="400">
            {pending.map((image) => (
              <ImageCard key={image.id} image={image} />
            ))}
          </s-columns>
        </s-section>
      )}

      {/* Approved Images */}
      {approved.length > 0 && (
        <s-section heading={`Approved (${approved.length})`}>
          <s-columns columns="3" gap="400">
            {approved.map((image) => (
              <ImageCard key={image.id} image={image} />
            ))}
          </s-columns>
        </s-section>
      )}

      {/* Rejected Images */}
      {rejected.length > 0 && (
        <s-section heading={`Rejected (${rejected.length})`}>
          <s-columns columns="3" gap="400">
            {rejected.map((image) => (
              <ImageCard key={image.id} image={image} />
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