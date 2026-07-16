import { useNavigate } from "react-router";
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
  } catch (_) {}

  return {};
};

// ─────────────────────────────────────────────────────────────────────────────
// Palette (dark theme)
// ─────────────────────────────────────────────────────────────────────────────

const C = {
  bg:            "#09090B",
  bgSecondary:   "#111216",
  card:          "#181A20",
  cardElevated:  "#20242D",
  border:        "rgba(255,255,255,0.06)",
  accent:        "#00C875",
  accentSecond:  "#5AC8FA",
  gradient:      "linear-gradient(135deg, #7C4DFF 0%, #B26DFF 100%)",
  textPrimary:   "#FFFFFF",
  textSecondary: "#A9B1BC",
  muted:         "#7D8590",
  success:       "#00C875",
  warning:       "#F5A623",
  danger:        "#FF5A5F",
};

// ─────────────────────────────────────────────────────────────────────────────
// SVG Icons
// ─────────────────────────────────────────────────────────────────────────────

const IP = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" };

function IconImage(p)   { return <svg {...IP} {...p}><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>; }
function IconCrop(p)    { return <svg {...IP} {...p}><path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/></svg>; }
function IconSplit(p)   { return <svg {...IP} {...p}><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/></svg>; }
function IconCollage(p) { return <svg {...IP} {...p}><rect x="3" y="3" width="7" height="11" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="18" width="7" height="3" rx="1"/></svg>; }
function IconLibrary(p) { return <svg {...IP} {...p}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>; }
function IconSave(p)    { return <svg {...IP} {...p}><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/></svg>; }
function IconArrow(p)   { return <svg {...IP} {...p}><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg>; }

const FEATURES = [
  { label: "Crop & Resize",        Icon: IconCrop },
  { label: "Split Grid",           Icon: IconSplit },
  { label: "Collage",              Icon: IconCollage },
  { label: "Store Library",        Icon: IconLibrary },
  { label: "Save to Shopify Files", Icon: IconSave },
];

export default function Index() {
  const navigate = useNavigate();
  const editorBtnRef = useRef(null);

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
  width: 96, height: 96, borderRadius: 24,
  background: C.card,
  border: `1px solid ${C.border}`,
  display: "flex", alignItems: "center", justifyContent: "center",
  color: C.accent,
  boxShadow: `0 0 40px rgba(0,200,117,0.12)`,
}}>
  <img alt="logo" src="/logo.jpg" width={96} height={96} />
</div>

            {/* Heading */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 520 }}>
              <h1 style={{
                margin: 0, fontSize: 32, fontWeight: 700,
                color: C.textPrimary, letterSpacing: "-0.02em",
              }}>
                Welcome to <span style={{
                color: C.accent,
              }}>Image Manager</span>
              </h1>
              <p style={{
                margin: 0, fontSize: 15, lineHeight: 1.65,
                color: C.textSecondary,
              }}>
                Crop, resize, split into grids, or build collages,
                then save the result back to your library.
              </p>
            </div>

            {/* CTA */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
              {/* Native button so navigate always fires — avoids the s-button
                  custom-element onClick quirk in React 18 */}
              <button
                onClick={() => navigate("/app/editor")}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 10,
                  padding: "14px 32px",
                  background: C.accent, color: "#000",
                  border: "none", borderRadius: 10,
                  fontSize: 15, fontWeight: 700, cursor: "pointer",
                  boxShadow: `0 4px 24px rgba(0,200,117,0.28)`,
                  transition: "transform 0.12s, box-shadow 0.12s",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.boxShadow = "0 6px 32px rgba(0,200,117,0.38)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = `0 4px 24px rgba(0,200,117,0.28)`; }}
              >
                Open Editor
                <IconArrow width={16} height={16} stroke="#000" />
              </button>
            </div>

            {/* Feature pills */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center", maxWidth: 560 }}>
              {FEATURES.map(({ label, Icon }) => (
                <span key={label} style={{
                  display: "flex", alignItems: "center", gap: 7,
                  padding: "7px 16px",
                  background: C.card,
                  border: `1px solid ${C.border}`,
                  borderRadius: 24, fontSize: 13, color: C.accentSecond,
                }}>
                  <Icon width={14} height={14} style={{ color: C.textPrimary, flexShrink: 0 }} />
                  {label}
                </span>
              ))}
            </div>

          </div>
        </s-bleed>
      </s-section>
    </s-page>
  );
}

export const headers = (h) => boundary.headers(h);