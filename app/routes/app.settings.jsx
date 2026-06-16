// app/routes/app.settings.jsx

import { useLoaderData, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { db } from "../db.server";
import { getShopSettings, saveShopSettings } from "../lib/db.settings.server";

// ─── Loader ──────────────────────────────────────────────────────────────────

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  // Find the shop record
  const shop = await db.shop.findUnique({
    where: { myshopifyDomain: session.shop },
  });

  if (!shop) {
    return {
      settings: {
        maxFileSizeMb:    10,
        allowedFileTypes: "jpg,jpeg,png,webp",
        notifyOnUpload:   true,
        notifyOnReview:   false,
        storageProvider:  "local",
      },
    };
  }

  const settings = await getShopSettings(shop.id);
  return { settings };
};

// ─── Action ──────────────────────────────────────────────────────────────────

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  const shop = await db.shop.findUnique({
    where: { myshopifyDomain: session.shop },
  });

  if (!shop) {
    return { success: false, error: "Shop not found" };
  }

  const formData = await request.formData();

  await saveShopSettings({
    shopId:           shop.id,
    maxFileSizeMb:    formData.get("maxFileSizeMb"),
    allowedFileTypes: formData.get("allowedFileTypes"),
    notifyOnUpload:   formData.get("notifyOnUpload"),
    notifyOnReview:   formData.get("notifyOnReview"),
    storageProvider:  formData.get("storageProvider"),
  });

  return { success: true };
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function Settings() {
  const { settings } = useLoaderData();
  const fetcher = useFetcher();

  const isSaving   = fetcher.state !== "idle";
  const saveSuccess = fetcher.data?.success === true;
  const saveError   = fetcher.data?.error;

  return (
    <s-page heading="Settings">

      {/* Success Banner */}
      {saveSuccess && (
        <s-section>
          <s-banner tone="success">
            <s-paragraph>Settings saved successfully.</s-paragraph>
          </s-banner>
        </s-section>
      )}

      {/* Error Banner */}
      {saveError && (
        <s-section>
          <s-banner tone="critical">
            <s-paragraph>Error saving settings: {saveError}</s-paragraph>
          </s-banner>
        </s-section>
      )}

      <fetcher.Form method="post">

        {/* Upload Configuration */}
        <s-section heading="Upload Configuration">
          <s-stack gap="400">

            <s-stack gap="100">
              <s-text font-weight="bold">Maximum File Size (MB)</s-text>
              <s-text tone="subdued" font-size="body-sm">
                Maximum size allowed for customer image uploads.
              </s-text>
              <select
                name="maxFileSizeMb"
                defaultValue={String(settings.maxFileSizeMb)}
                style={{
                  padding:      "8px 12px",
                  borderRadius: "6px",
                  border:       "1px solid #c9cccf",
                  fontSize:     "14px",
                  width:        "200px",
                  background:   "#ffffff",
                }}
              >
                <option value="5">5 MB</option>
                <option value="10">10 MB</option>
                <option value="20">20 MB</option>
                <option value="50">50 MB</option>
              </select>
            </s-stack>

            <s-stack gap="100">
              <s-text font-weight="bold">Allowed File Types</s-text>
              <s-text tone="subdued" font-size="body-sm">
                Comma-separated list of allowed file extensions.
                Example: jpg,jpeg,png,webp
              </s-text>
              <input
                type="text"
                name="allowedFileTypes"
                defaultValue={settings.allowedFileTypes}
                style={{
                  padding:      "8px 12px",
                  borderRadius: "6px",
                  border:       "1px solid #c9cccf",
                  fontSize:     "14px",
                  width:        "300px",
                }}
              />
            </s-stack>

          </s-stack>
        </s-section>

        {/* Storage Configuration */}
        <s-section heading="Storage Configuration">
          <s-stack gap="400">

            <s-stack gap="100">
              <s-text font-weight="bold">Storage Provider</s-text>
              <s-text tone="subdued" font-size="body-sm">
                Where customer images are stored.
                Use Local for development, S3 or R2 for production.
              </s-text>
              <select
                name="storageProvider"
                defaultValue={settings.storageProvider}
                style={{
                  padding:      "8px 12px",
                  borderRadius: "6px",
                  border:       "1px solid #c9cccf",
                  fontSize:     "14px",
                  width:        "200px",
                  background:   "#ffffff",
                }}
              >
                <option value="local">Local (Development)</option>
                <option value="s3">Amazon S3</option>
                <option value="r2">Cloudflare R2</option>
              </select>
            </s-stack>

            {settings.storageProvider !== "local" && (
              <s-banner tone="warning">
                <s-paragraph>
                  Cloud storage configuration requires environment variables.
                  See documentation for setup instructions.
                </s-paragraph>
              </s-banner>
            )}

          </s-stack>
        </s-section>

        {/* Notification Settings */}
        <s-section heading="Notification Settings">
          <s-stack gap="400">

            <s-stack gap="200">
              <s-text font-weight="bold">Email Notifications</s-text>
              <s-text tone="subdued" font-size="body-sm">
                Choose when to receive email notifications.
              </s-text>

              <s-stack gap="200">
                <label style={{
                  display:    "flex",
                  alignItems: "center",
                  gap:        "8px",
                  cursor:     "pointer",
                }}>
                  <input
                    type="checkbox"
                    name="notifyOnUpload"
                    value="true"
                    defaultChecked={settings.notifyOnUpload}
                    style={{ width: "16px", height: "16px" }}
                  />
                  <s-stack gap="050">
                    <s-text font-weight="bold">
                      Notify when customer uploads an image
                    </s-text>
                    <s-text tone="subdued" font-size="body-sm">
                      Receive an email each time a customer uploads
                      an image during checkout.
                    </s-text>
                  </s-stack>
                </label>

                <label style={{
                  display:    "flex",
                  alignItems: "center",
                  gap:        "8px",
                  cursor:     "pointer",
                }}>
                  <input
                    type="checkbox"
                    name="notifyOnReview"
                    value="true"
                    defaultChecked={settings.notifyOnReview}
                    style={{ width: "16px", height: "16px" }}
                  />
                  <s-stack gap="050">
                    <s-text font-weight="bold">
                      Notify when image review is complete
                    </s-text>
                    <s-text tone="subdued" font-size="body-sm">
                      Receive an email when an image is approved
                      or rejected.
                    </s-text>
                  </s-stack>
                </label>
              </s-stack>
            </s-stack>

          </s-stack>
        </s-section>

        {/* Webhook Status */}
        <s-section heading="Webhook Status">
          <s-stack gap="300">
            {[
              { topic: "orders/create",    description: "Syncs new orders to database" },
              { topic: "orders/paid",      description: "Updates order payment status" },
              { topic: "orders/fulfilled", description: "Updates fulfillment status" },
              { topic: "app/uninstalled",  description: "Cleans up data on uninstall" },
            ].map((webhook) => (
              <s-box
                key={webhook.topic}
                padding="300"
                border="base"
                border-radius="200"
              >
                <s-columns columns="3" gap="400">
                  <s-text font-weight="bold" font-size="body-sm">
                    {webhook.topic}
                  </s-text>
                  <s-text tone="subdued" font-size="body-sm">
                    {webhook.description}
                  </s-text>
                  <s-badge tone="success">Active</s-badge>
                </s-columns>
              </s-box>
            ))}
          </s-stack>
        </s-section>

        {/* Save Button */}
        <s-section>
          <s-button
            variant="primary"
            type="submit"
            disabled={isSaving || undefined}
          >
            {isSaving ? "Saving..." : "Save Settings"}
          </s-button>
        </s-section>

      </fetcher.Form>

    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};