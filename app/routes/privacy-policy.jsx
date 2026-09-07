// app/routes/privacy-policy.jsx
//
// Public privacy policy page. Intentionally NOT under /app so it does not
// go through authenticate.admin() — Shopify (and merchants) must be able to
// load this page without installing or logging into the app.
//
// Use this URL in the Partner Dashboard under
// App setup > Privacy policy URL, e.g.
//   https://<your-app-domain>/privacy-policy

const LAST_UPDATED = "September 7, 2026";
const APP_NAME = "PicCut";
const SUPPORT_EMAIL = "support@example.com"; // TODO: replace with your real support email

export const meta = () => {
  return [{ title: `Privacy Policy — ${APP_NAME}` }];
};

export default function PrivacyPolicy() {
  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <header style={styles.header}>
          <h1 style={styles.title}>{APP_NAME} Privacy Policy</h1>
          <p style={styles.updated}>Last updated: {LAST_UPDATED}</p>
        </header>

        <Section title="Overview">
          <p style={styles.p}>
            {APP_NAME} ("the App", "we", "us") is a Shopify-embedded admin
            application that helps merchants crop, resize, split, and
            collage images already stored in their Shopify Files library.
            This policy explains what data the App collects, how it is
            used, and how merchants can request its deletion.
          </p>
        </Section>

        <Section title="Who this policy covers">
          <p style={styles.p}>
            {APP_NAME} is a merchant-facing tool used inside the Shopify
            admin. It is not installed or used by a merchant's customers,
            and it does not run on a store's public storefront. The data
            described below belongs to the merchant's Shopify account, not
            to their end customers.
          </p>
        </Section>

        <Section title="Information we collect">
          <ul style={styles.ul}>
            <li style={styles.li}>
              <strong>Store and account information.</strong> When a
              merchant installs the App, Shopify provides us with basic
              shop details (myshopify.com domain, shop name, contact
              email, and plan) and an OAuth access token that authorizes
              the App to act on the merchant's behalf.
            </li>
            <li style={styles.li}>
              <strong>App settings.</strong> We store the preferences a
              merchant configures in the App's Settings page — JPEG export
              quality, maximum export dimensions, and collage spacing.
            </li>
            <li style={styles.li}>
              <strong>Images.</strong> The App reads and writes images
              through Shopify's Files API. Images are uploaded directly to
              Shopify's file storage; we do not keep a separate copy of
              merchant images in our own database. Images may pass through
              our server in memory during processing (cropping, resizing,
              or compositing) before being sent back to Shopify.
            </li>
          </ul>
        </Section>

        <Section title="Information we do not collect">
          <p style={styles.p}>
            The App does not access, request, or store customer-facing
            data such as customer names, addresses, order history, or
            payment information. Its Shopify API access is limited to the{" "}
            <code style={styles.code}>read_files</code> and{" "}
            <code style={styles.code}>write_files</code> scopes.
          </p>
        </Section>

        <Section title="How we use information">
          <ul style={styles.ul}>
            <li style={styles.li}>To authenticate the App with a merchant's store and keep the merchant signed in.</li>
            <li style={styles.li}>To apply a merchant's saved editing preferences when processing images.</li>
            <li style={styles.li}>To perform the cropping, resizing, splitting, and collage operations the merchant requests.</li>
            <li style={styles.li}>To diagnose errors and keep the App running reliably.</li>
          </ul>
          <p style={styles.p}>
            We do not sell merchant data, and we do not use it for
            advertising or share it with third parties except the
            infrastructure providers described below.
          </p>
        </Section>

        <Section title="Data storage and third parties">
          <p style={styles.p}>
            App data (shop records, session/access tokens, and settings)
            is stored in a hosted PostgreSQL database. The App itself runs
            on Railway. These providers process data on our behalf as
            infrastructure hosts and do not use it for their own purposes.
          </p>
        </Section>

        <Section title="Data retention and deletion">
          <p style={styles.p}>
            When a merchant uninstalls {APP_NAME}, we receive Shopify's{" "}
            <code style={styles.code}>app/uninstalled</code> webhook and
            automatically delete that shop's session (access token) and
            shop record, including its saved settings.
          </p>
          <p style={styles.p}>
            Merchants can also request deletion of their data at any time
            by contacting us at the email below. We will also honor
            Shopify's mandatory GDPR webhooks (shop and customer data
            erasure requests) as required for all Shopify apps.
          </p>
        </Section>

        <Section title="Security">
          <p style={styles.p}>
            Access tokens are stored server-side and are never exposed to
            the browser. All communication between the App, Shopify, and
            our servers takes place over HTTPS.
          </p>
        </Section>

        <Section title="Changes to this policy">
          <p style={styles.p}>
            We may update this privacy policy from time to time. Changes
            will be posted on this page with an updated "Last updated"
            date.
          </p>
        </Section>

        <Section title="Contact us">
          <p style={styles.p}>
            Questions about this policy or a data request can be sent to{" "}
            <a href={`mailto:${SUPPORT_EMAIL}`} style={styles.link}>
              {SUPPORT_EMAIL}
            </a>
            .
          </p>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section style={styles.section}>
      <h2 style={styles.h2}>{title}</h2>
      {children}
    </section>
  );
}

const styles = {
  page: {
    fontFamily:
      "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    background: "#f6f6f7",
    minHeight: "100vh",
    padding: "48px 16px",
    color: "#202223",
  },
  container: {
    maxWidth: 720,
    margin: "0 auto",
    background: "#ffffff",
    borderRadius: 12,
    padding: "40px 48px",
    boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
  },
  header: {
    marginBottom: 24,
    borderBottom: "1px solid #e1e3e5",
    paddingBottom: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: 700,
    margin: 0,
  },
  updated: {
    color: "#6d7175",
    fontSize: 14,
    marginTop: 8,
  },
  section: {
    marginTop: 28,
  },
  h2: {
    fontSize: 18,
    fontWeight: 600,
    marginBottom: 10,
  },
  p: {
    fontSize: 15,
    lineHeight: 1.6,
    margin: "0 0 10px 0",
  },
  ul: {
    margin: "0 0 10px 0",
    paddingLeft: 20,
  },
  li: {
    fontSize: 15,
    lineHeight: 1.6,
    marginBottom: 8,
  },
  code: {
    background: "#f1f2f3",
    padding: "1px 6px",
    borderRadius: 4,
    fontSize: 13.5,
  },
  link: {
    color: "#2c6ecb",
    textDecoration: "underline",
  },
};