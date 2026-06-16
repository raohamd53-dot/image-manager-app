// app/routes/app.jsx

import { Outlet, useLoaderData, useRouteError, useLocation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData();
  const location = useLocation();

  const navItems = [
    { label: "Dashboard", href: "/app" },
    { label: "Orders",    href: "/app/orders" },
    { label: "Images",    href: "/app/images" },
    { label: "Settings",  href: "/app/settings" },
  ];

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        {navItems.map((item) => (
          <s-link
            key={item.href}
            href={item.href}
            active={location.pathname === item.href || undefined}
          >
            {item.label}
          </s-link>
        ))}
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

// Root error boundary — catches errors from any child route
export function ErrorBoundary() {
  const error = useRouteError();

  // Let Shopify handle auth errors (redirects to OAuth)
  if (boundary.error(error)) {
    return boundary.error(error);
  }

  return (
    <s-page heading="Something went wrong">
      <s-section>
        <s-banner tone="critical">
          <s-paragraph>
            <strong>Application Error</strong>
          </s-paragraph>
          <s-paragraph>
            {error?.message || "An unexpected error occurred."}
          </s-paragraph>
          <s-paragraph>
            Please refresh the page or contact support if the
            problem persists.
          </s-paragraph>
        </s-banner>
      </s-section>
      <s-section>
        <s-button
          onclick="window.location.reload()"
          variant="primary"
        >
          Refresh Page
        </s-button>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};