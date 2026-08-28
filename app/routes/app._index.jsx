/* eslint-disable react/prop-types */
// Prop-types intentionally disabled — these are private, file-local
// components consumed only within this route file, not a shared library
// (same convention as app.editor.jsx).

import { useNavigate, useNavigation } from "react-router";
import { useRef, useEffect } from "react";
import { authenticate } from "../shopify.server";
import { boundary }     from "@shopify/shopify-app-react-router/server";
import { db }           from "../db.server";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

  try {
    const res  = await admin.graphql(`#graphql
      query { shop { name email myshopifyDomain plan { displayName } } }
    `);
    const json = await res.json();
    const s    = json.data.shop;
    await db.shop.upsert({
      where:  { myshopifyDomain: session.shop },
      update: { name: s.name, email: s.email, plan: s.plan.displayName },
      create: { myshopifyDomain: session.shop, name: s.name, email: s.email, plan: s.plan.displayName },
    });
  } catch (err) {
    // Non-fatal — shop metadata sync is best-effort; the editor still
    // works fine even if this upsert fails (e.g. transient DB hiccup).
    console.error("Shop metadata sync failed:", err);
  }

  return {};
};

// ─────────────────────────────────────────────────────────────────────────────
// Palette (dark theme)
// ─────────────────────────────────────────────────────────────────────────────

const C = {
  bg: "#09090B",
  bgSecondary: "#111111",
  card: "#181818",
  cardElevated: "#262626",

  border: "rgba(255,255,255,0.08)",
  borderStrong: "rgba(255,255,255,0.14)",

  accent: "#A660F1",
  accentSecond: "#EFDFFF",

  gradient: "linear-gradient(135deg, #A660F1 0%, #EFDFFF 100%)",

  textPrimary: "#FFFFFF",
  textSecondary: "#D1D1D1",
  muted: "#9B9B9B",

  success: "#00C875",
  warning: "#F5A623",
  danger: "#FF5A5F",
};

// ─────────────────────────────────────────────────────────────────────────────
// SVG Icons
// ─────────────────────────────────────────────────────────────────────────────

const IP = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" };

function IconCrop(p)    { return <svg {...IP} {...p}><path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/></svg>; }
function IconSplit(p)   { return <svg {...IP} {...p}><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/></svg>; }
function IconCollage(p) { return <svg {...IP} {...p}><rect x="3" y="3" width="7" height="11" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="18" width="7" height="3" rx="1"/></svg>; }
function IconSave(p)    { return <svg {...IP} {...p}><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/></svg>; }
function IconArrow(p)   { return <svg {...IP} {...p}><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg>; }

const FEATURES = [
  {
    label: "Crop & Resize",
    Icon: IconCrop,
    description: "Precisely crop and resize any product or store image without leaving Shopify admin.",
  },
  {
    label: "Split Grid",
    Icon: IconSplit,
    description: "Slice a single image into a clean multi-tile grid, ready for carousel posts or feeds.",
  },
  {
    label: "Collage",
    Icon: IconCollage,
    description: "Combine several images into one polished collage with locked frames and re-crop support.",
  },
  {
    label: "Save to Shopify Files",
    Icon: IconSave,
    description: "Export finished images straight back to Shopify Files, ready to use anywhere in your store.",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Reviews (customer feedback shown on the home page)
// ─────────────────────────────────────────────────────────────────────────────

const REVIEWS = [
  {
    quote: "Cut our product photo prep time in half. The collage mode alone was worth installing this app.",
    author: "Sarah M.",
    role: "Store Owner",
    rating: 5,
  },
  {
    quote: "Finally an image editor that lives inside Shopify admin. No more tab-switching to another tool.",
    author: "James T.",
    role: "Ecommerce Manager",
    rating: 5,
  },
  {
    quote: "The split grid feature made building our Instagram carousel posts effortless.",
    author: "Priya K.",
    role: "Marketing Lead",
    rating: 4,
  },
];

function IconStar({ filled }) {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill={filled ? C.accent : "none"} stroke={C.accent} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.63 22 9.24 16.8 14.14 18.18 21 12 17.4 5.82 21 7.2 14.14 2 9.24 8.91 8.63 12 2" />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LiquidSpinner — same reusable animated loader orb used in app.editor.jsx
// ─────────────────────────────────────────────────────────────────────────────

function LiquidSpinner({ size = 24, color = C.accent, label }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
      <div style={{ position: "relative", width: size, height: size }}>
        {/* Outer ring */}
        <div style={{
          position: "absolute", inset: 0, borderRadius: "50%",
          border: `2px solid rgba(255,255,255,0.08)`,
          borderTopColor: color,
          animation: "liquidSpin 0.9s cubic-bezier(0.4,0,0.2,1) infinite",
        }} />
        {/* Inner pulse */}
        <div style={{
          position: "absolute", inset: "25%", borderRadius: "50%",
          background: color,
          opacity: 0.25,
          animation: "liquidPulse 1.4s ease-in-out infinite",
        }} />
      </div>
      {label && <span style={{ fontSize: 11, color: C.muted, letterSpacing: "0.04em" }}>{label}</span>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// NavigationLoadingOverlay — full-page overlay shown while a route
// transition (e.g. the editor's loader fetching Shopify Files) is pending
// ─────────────────────────────────────────────────────────────────────────────

function NavigationLoadingOverlay({ visible }) {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 8000,
      background: "rgba(0,0,0,0.6)",
      backdropFilter: "blur(6px)",
      display: "flex", alignItems: "center", justifyContent: "center",
      flexDirection: "column", gap: 16,
      opacity: visible ? 1 : 0,
      pointerEvents: visible ? "auto" : "none",
      transition: "opacity 0.35s cubic-bezier(0.4,0,0.2,1)",
    }}>
      <div style={{
        background: C.card, border: `1px solid ${C.border}`,
        borderRadius: 16, padding: "32px 48px",
        display: "flex", flexDirection: "column", alignItems: "center", gap: 18,
        boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
        transform: visible ? "scale(1) translateY(0)" : "scale(0.94) translateY(8px)",
        transition: "transform 0.35s cubic-bezier(0.34,1.56,0.64,1)",
      }}>
        <LiquidSpinner size={40} color={C.accentSecond} />
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.textPrimary, marginBottom: 4 }}>
            Opening Editor
          </div>
          <div style={{ fontSize: 11, color: C.muted }}>Loading your image library…</div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FeaturesSection — description + featured capabilities grid
// ─────────────────────────────────────────────────────────────────────────────

function FeaturesSection() {
  return (
    <div style={{ padding: "56px 24px", background: C.bgSecondary }}>
      <div style={{ maxWidth: 960, margin: "0 auto" }}>

        {/* Description */}
        <div style={{ textAlign: "center", maxWidth: 620, margin: "0 auto 40px" }}>
          <h2 style={{
            margin: "0 0 12px", fontSize: 24, fontWeight: 700,
            color: C.textPrimary, letterSpacing: "-0.01em",
          }}>
            Everything you need to manage store media
          </h2>
          <p style={{
            margin: 0, fontSize: 14.5, lineHeight: 1.65, color: C.textSecondary,
          }}>
            PicCut brings a full image editor into Shopify admin — crop, split,
            and collage your photos, then save results straight back to your
            store library without ever downloading a file.
          </p>
        </div>

        {/* Featured grid */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: 16,
        }}>
          {FEATURES.map(({ label, Icon, description }) => (
            <div key={label} style={{
              background: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: 14,
              padding: "24px 20px",
              display: "flex", flexDirection: "column", gap: 12,
              animation: "fadeSlideUp 0.4s cubic-bezier(0.4,0,0.2,1) both",
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: 10,
                background: C.gradient,
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "#000",
              }}>
                <Icon width={18} height={18} stroke="#000" />
              </div>
              <div style={{ fontSize: 14.5, fontWeight: 700, color: C.textPrimary }}>
                {label}
              </div>
              <div style={{ fontSize: 12.5, lineHeight: 1.55, color: C.muted }}>
                {description}
              </div>
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ReviewsSection — merchant feedback shown on the home page
// ─────────────────────────────────────────────────────────────────────────────

function ReviewsSection() {
  return (
    <div style={{ padding: "56px 24px", background: C.bg }}>
      <div style={{ maxWidth: 960, margin: "0 auto" }}>

        <div style={{ textAlign: "center", maxWidth: 520, margin: "0 auto 36px" }}>
          <h2 style={{
            margin: "0 0 12px", fontSize: 24, fontWeight: 700,
            color: C.textPrimary, letterSpacing: "-0.01em",
          }}>
            Loved by merchants
          </h2>
          <p style={{ margin: 0, fontSize: 14.5, color: C.textSecondary }}>
            Hear what store owners have to say about PicCut.
          </p>
        </div>

        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: 16,
        }}>
          {REVIEWS.map((r) => (
            <div key={r.author} style={{
              background: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: 14,
              padding: "22px 20px",
              display: "flex", flexDirection: "column", gap: 14,
            }}>
              <div style={{ display: "flex", gap: 3 }}>
                {Array.from({ length: 5 }).map((_, i) => (
                  <IconStar key={i} filled={i < r.rating} />
                ))}
              </div>
              <p style={{
                margin: 0, fontSize: 13.5, lineHeight: 1.6,
                color: C.textSecondary, fontStyle: "italic",
              }}>
                “{r.quote}”
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: C.textPrimary }}>
                  {r.author}
                </span>
                <span style={{ fontSize: 11.5, color: C.muted }}>
                  {r.role}
                </span>
              </div>
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}

export default function Index() {
  const navigate    = useNavigate();
  const navigation  = useNavigation();
  const editorBtnRef = useRef(null);

  const isNavigating = navigation.state !== "idle";

  // <s-button> is a custom element — React 18 does not translate onClick
  // to a real DOM event listener for hyphenated custom elements, so we
  // bind natively via a ref + addEventListener instead.
  useEffect(() => {
    const el = editorBtnRef.current;
    if (!el) return;
    const handleClick = () => navigate("/app/editor");
    el.addEventListener("click", handleClick);
    return () => el.removeEventListener("click", handleClick);
  }, [navigate]);

  return (
    <s-page heading="Image Editor">

      <style>{`
        @keyframes liquidSpin {
          0%   { transform: rotate(0deg); }
          70%  { transform: rotate(300deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes liquidPulse {
          0%, 100% { opacity: 0.12; transform: scale(0.85); }
          50%       { opacity: 0.35; transform: scale(1.1); }
        }
        @keyframes fadeSlideUp {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0);   }
        }
      `}</style>

      {/* Full-page loading overlay while navigating to the editor
          (its loader fetches Shopify Files before the route renders) */}
      <NavigationLoadingOverlay visible={isNavigating} />

      <s-section>
        <s-bleed>
          <div style={{
            minHeight: "60vh",
            display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            padding: "72px 24px", textAlign: "center", gap: 32,
            background: C.bg,
          }}>

           {/* LOGO */}
<div style={{
  display: "flex", alignItems: "center", justifyContent: "center",
}}>
  <img alt="logo" src="/logo.png" width={286} height={106} />
</div>
            {/* Heading */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 520 }}>
              <h1 style={{
                margin: 0, fontSize: 32, fontWeight: 700,
                color: C.textPrimary, letterSpacing: "-0.02em",
              }}>
                Welcome to <span style={{
                color: C.accent,
              }}>PicCut</span>
              </h1>
              <p style={{
                margin: 0, fontSize: 15, lineHeight: 1.65,
                color: C.textSecondary,
              }}>
                Manage and transform your store media, then save
                results directly back to your library.
              </p>
            </div>

            {/* CTA */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
              {/* Native button so navigate always fires — avoids the s-button
                  custom-element onClick quirk in React 18 */}
              <button
                onClick={() => navigate("/app/editor")}
                disabled={isNavigating}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 10,
                  padding: "14px 32px",
                  background: isNavigating ? C.cardElevated : C.accent,
                  color: isNavigating ? C.muted : "#000",
                  border: "none", borderRadius: 10,
                  fontSize: 15, fontWeight: 700,
                  cursor: isNavigating ? "default" : "pointer",
                  boxShadow: isNavigating ? "none" : `0 4px 24px rgba(0,200,117,0.28)`,
                  opacity: isNavigating ? 0.85 : 1,
                  transition: "transform 0.12s, box-shadow 0.12s, background 0.2s ease, color 0.2s ease, opacity 0.2s ease",
                }}
                onMouseEnter={(e) => { if (!isNavigating) { e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.boxShadow = "0 6px 32px rgba(0,200,117,0.38)"; } }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = ""; if (!isNavigating) e.currentTarget.style.boxShadow = `0 4px 24px rgba(0,200,117,0.28)`; }}
              >
                {isNavigating
                  ? <><LiquidSpinner size={16} color={C.muted} /><span>Opening…</span></>
                  : <><span>Open </span><IconArrow width={16} height={16} stroke="#000" /></>}
              </button>
            </div>

            {/* Feature list — passive text badge, not styled as interactive
                buttons, so it doesn't compete with the "Open Editor" CTA.
                (These are non-functional; clicking anywhere here does
                nothing, so they must never look clickable.) */}
            <div style={{
              fontSize: 12.5, color: C.muted, maxWidth: 560,
              lineHeight: 1.6,
            }}>
              {/* <span style={{ color: C.textSecondary, fontWeight: 600 }}>Includes:</span>{" "} */}
              {FEATURES.map((f) => f.label).join(" • ")}
            </div>

          </div>
        </s-bleed>
      </s-section>

      <s-section>
        <s-bleed>
          <FeaturesSection />
        </s-bleed>
      </s-section>

      <s-section>
        <s-bleed>
          <ReviewsSection />
        </s-bleed>
      </s-section>
    </s-page>
  );
}

export const headers = (h) => boundary.headers(h);