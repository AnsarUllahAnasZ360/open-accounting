/* @ds-bundle: {"format":3,"namespace":"OpenBooksDesignSystem_8d97bf","components":[{"name":"AskAI","sourcePath":"components/ai/AskAI.jsx"},{"name":"ReviewItem","sourcePath":"components/ai/ReviewItem.jsx"},{"name":"Badge","sourcePath":"components/core/Badge.jsx"},{"name":"Button","sourcePath":"components/core/Button.jsx"},{"name":"Card","sourcePath":"components/core/Card.jsx"},{"name":"CardHeader","sourcePath":"components/core/Card.jsx"},{"name":"CardTitle","sourcePath":"components/core/Card.jsx"},{"name":"CardDescription","sourcePath":"components/core/Card.jsx"},{"name":"CardAction","sourcePath":"components/core/Card.jsx"},{"name":"CardContent","sourcePath":"components/core/Card.jsx"},{"name":"CardFooter","sourcePath":"components/core/Card.jsx"},{"name":"ICON_NAMES","sourcePath":"components/core/Icon.jsx"},{"name":"Icon","sourcePath":"components/core/Icon.jsx"},{"name":"Tabs","sourcePath":"components/core/Tabs.jsx"},{"name":"TabsList","sourcePath":"components/core/Tabs.jsx"},{"name":"TabsTrigger","sourcePath":"components/core/Tabs.jsx"},{"name":"TabsContent","sourcePath":"components/core/Tabs.jsx"},{"name":"Amount","sourcePath":"components/data/Amount.jsx"},{"name":"BarChart","sourcePath":"components/data/BarChart.jsx"},{"name":"EmptyState","sourcePath":"components/data/EmptyState.jsx"},{"name":"Sparkline","sourcePath":"components/data/Sparkline.jsx"},{"name":"StatCard","sourcePath":"components/data/StatCard.jsx"},{"name":"Table","sourcePath":"components/data/Table.jsx"},{"name":"TableHeader","sourcePath":"components/data/Table.jsx"},{"name":"TableBody","sourcePath":"components/data/Table.jsx"},{"name":"TableFooter","sourcePath":"components/data/Table.jsx"},{"name":"TableRow","sourcePath":"components/data/Table.jsx"},{"name":"TableHead","sourcePath":"components/data/Table.jsx"},{"name":"TableCell","sourcePath":"components/data/Table.jsx"},{"name":"Input","sourcePath":"components/forms/Input.jsx"},{"name":"Select","sourcePath":"components/forms/Select.jsx"},{"name":"Switch","sourcePath":"components/forms/Switch.jsx"},{"name":"PageHeader","sourcePath":"components/navigation/PageHeader.jsx"},{"name":"SideNav","sourcePath":"components/navigation/SideNav.jsx"}],"sourceHashes":{"components/ai/AskAI.jsx":"816f1cccec17","components/ai/ReviewItem.jsx":"0c0e572eb86a","components/core/Badge.jsx":"85dbbf59d0d2","components/core/Button.jsx":"44577142940b","components/core/Card.jsx":"4a92686eb228","components/core/Icon.jsx":"0a5266f83afd","components/core/Tabs.jsx":"b9a19dbe0b31","components/data/Amount.jsx":"99247111512b","components/data/BarChart.jsx":"83b1333b4d7f","components/data/EmptyState.jsx":"03b94b7abf05","components/data/Sparkline.jsx":"ec91507f1524","components/data/StatCard.jsx":"5557b505a7aa","components/data/Table.jsx":"6ea19b4219a2","components/forms/Input.jsx":"d160cdb88550","components/forms/Select.jsx":"2f5961a678ab","components/forms/Switch.jsx":"010d5e6837eb","components/navigation/PageHeader.jsx":"3ffea2b02b80","components/navigation/SideNav.jsx":"34761a2cd50e","ui_kits/openbooks/CashFlow.jsx":"e21a4384ebe5","ui_kits/openbooks/Dashboard.jsx":"280396c51535","ui_kits/openbooks/Inbox.jsx":"9eeb7a015f32","ui_kits/openbooks/Reports.jsx":"6180f563e0ea","ui_kits/openbooks/Transactions.jsx":"7a3348816cda"},"inlinedExternals":[],"unexposedExports":[{"name":"formatMoney","sourcePath":"components/data/Amount.jsx"}]} */

(() => {

const __ds_ns = (window.OpenBooksDesignSystem_8d97bf = window.OpenBooksDesignSystem_8d97bf || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/core/Card.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* OpenBooks Card — from the codebase's shadcn card.tsx:
   rounded-xl, ring-1 ring-foreground/10, 16px spacing, optional sm size. */

const cardCss = `
.obds-card {
  display: flex; flex-direction: column; gap: var(--card-pad, 16px);
  padding: var(--card-pad, 16px) 0; overflow: hidden;
  background: var(--surface-card); color: var(--card-foreground);
  border-radius: var(--radius-card);
  box-shadow: var(--card-ring), var(--shadow-xs);
  font-size: var(--text-sm);
}
.obds-card--sm { --card-pad: 12px; }
.obds-card__header {
  display: grid; grid-auto-rows: min-content; align-items: start; gap: 2px;
  grid-template-columns: 1fr auto; padding: 0 var(--card-pad, 16px);
}
.obds-card__title {
  font-family: var(--font-heading); font-size: var(--text-base);
  font-weight: var(--weight-semibold); line-height: 1.375;
}
.obds-card--sm .obds-card__title { font-size: var(--text-sm); }
.obds-card__description { grid-column: 1; font-size: var(--text-sm); color: var(--text-muted); }
.obds-card__action { grid-column: 2; grid-row: 1 / span 2; align-self: start; justify-self: end; }
.obds-card__content { padding: 0 var(--card-pad, 16px); }
.obds-card__footer {
  display: flex; align-items: center; gap: 8px;
  margin-top: auto; margin-bottom: calc(-1 * var(--card-pad, 16px));
  padding: var(--card-pad, 16px);
  border-top: var(--border-default);
  background: color-mix(in oklab, var(--muted) 50%, transparent);
}
`;
if (typeof document !== "undefined" && !document.getElementById("obds-card-css")) {
  const s = document.createElement("style");
  s.id = "obds-card-css";
  s.textContent = cardCss;
  document.head.appendChild(s);
}
function Card({
  size = "default",
  children,
  className = "",
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    className: `obds-card ${size === "sm" ? "obds-card--sm" : ""} ${className}`,
    style: style
  }, rest), children);
}
function CardHeader({
  children,
  className = "",
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    className: `obds-card__header ${className}`
  }, rest), children);
}
function CardTitle({
  children,
  className = "",
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    className: `obds-card__title ${className}`,
    style: style
  }, rest), children);
}
function CardDescription({
  children,
  className = "",
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    className: `obds-card__description ${className}`
  }, rest), children);
}
function CardAction({
  children,
  className = "",
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    className: `obds-card__action ${className}`
  }, rest), children);
}
function CardContent({
  children,
  className = "",
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    className: `obds-card__content ${className}`,
    style: style
  }, rest), children);
}
function CardFooter({
  children,
  className = "",
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    className: `obds-card__footer ${className}`
  }, rest), children);
}
Object.assign(__ds_scope, { Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent, CardFooter });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Card.jsx", error: String((e && e.message) || e) }); }

// components/core/Icon.jsx
try { (() => {
/* OpenBooks Icon — lucide path data imported verbatim from lucide-icons/lucide.
   Same icon system the codebase uses (lucide-react). Original SVGs: assets/icons/. */

const ICON_PATHS = {
  "arrow-down-right": "<path d=\"m7 7 10 10\"></path><path d=\"M17 7v10H7\"></path>",
  "arrow-right": "<path d=\"M5 12h14\"></path><path d=\"m12 5 7 7-7 7\"></path>",
  "arrow-up-right": "<path d=\"M7 7h10v10\"></path><path d=\"M7 17 17 7\"></path>",
  "banknote": "<rect width=\"20\" height=\"12\" x=\"2\" y=\"6\" rx=\"2\"></rect><circle cx=\"12\" cy=\"12\" r=\"2\"></circle><path d=\"M6 12h.01M18 12h.01\"></path>",
  "book-open": "<path d=\"M12 7v14\"></path><path d=\"M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z\"></path>",
  "bot": "<path d=\"M12 8V4H8\"></path><rect width=\"16\" height=\"12\" x=\"4\" y=\"8\" rx=\"2\"></rect><path d=\"M2 14h2\"></path><path d=\"M20 14h2\"></path><path d=\"M15 13v2\"></path><path d=\"M9 13v2\"></path>",
  "building-2": "<path d=\"M10 12h4\"></path><path d=\"M10 8h4\"></path><path d=\"M14 21v-3a2 2 0 0 0-4 0v3\"></path><path d=\"M6 10H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2\"></path><path d=\"M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16\"></path>",
  "calendar": "<path d=\"M8 2v4\"></path><path d=\"M16 2v4\"></path><rect width=\"18\" height=\"18\" x=\"3\" y=\"4\" rx=\"2\"></rect><path d=\"M3 10h18\"></path>",
  "chart-column": "<path d=\"M3 3v16a2 2 0 0 0 2 2h16\"></path><path d=\"M18 17V9\"></path><path d=\"M13 17V5\"></path><path d=\"M8 17v-3\"></path>",
  "chart-line": "<path d=\"M3 3v16a2 2 0 0 0 2 2h16\"></path><path d=\"m19 9-5 5-4-4-3 3\"></path>",
  "chart-pie": "<path d=\"M21 12c.552 0 1.005-.449.95-.998a10 10 0 0 0-8.953-8.951c-.55-.055-.998.398-.998.95v8a1 1 0 0 0 1 1z\"></path><path d=\"M21.21 15.89A10 10 0 1 1 8 2.83\"></path>",
  "check": "<path d=\"M20 6 9 17l-5-5\"></path>",
  "chevron-down": "<path d=\"m6 9 6 6 6-6\"></path>",
  "chevron-left": "<path d=\"m15 18-6-6 6-6\"></path>",
  "chevron-right": "<path d=\"m9 18 6-6-6-6\"></path>",
  "chevron-up": "<path d=\"m18 15-6-6-6 6\"></path>",
  "circle-alert": "<circle cx=\"12\" cy=\"12\" r=\"10\"></circle><line x1=\"12\" x2=\"12\" y1=\"8\" y2=\"12\"></line><line x1=\"12\" x2=\"12.01\" y1=\"16\" y2=\"16\"></line>",
  "circle-check": "<circle cx=\"12\" cy=\"12\" r=\"10\"></circle><path d=\"m9 12 2 2 4-4\"></path>",
  "clock-3": "<circle cx=\"12\" cy=\"12\" r=\"10\"></circle><path d=\"M12 6v6h4\"></path>",
  "credit-card": "<rect width=\"20\" height=\"14\" x=\"2\" y=\"5\" rx=\"2\"></rect><line x1=\"2\" x2=\"22\" y1=\"10\" y2=\"10\"></line>",
  "dollar-sign": "<line x1=\"12\" x2=\"12\" y1=\"2\" y2=\"22\"></line><path d=\"M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6\"></path>",
  "download": "<path d=\"M12 15V3\"></path><path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4\"></path><path d=\"m7 10 5 5 5-5\"></path>",
  "ellipsis": "<circle cx=\"12\" cy=\"12\" r=\"1\"></circle><circle cx=\"19\" cy=\"12\" r=\"1\"></circle><circle cx=\"5\" cy=\"12\" r=\"1\"></circle>",
  "eye": "<path d=\"M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0\"></path><circle cx=\"12\" cy=\"12\" r=\"3\"></circle>",
  "file-text": "<path d=\"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z\"></path><path d=\"M14 2v5a1 1 0 0 0 1 1h5\"></path><path d=\"M10 9H8\"></path><path d=\"M16 13H8\"></path><path d=\"M16 17H8\"></path>",
  "funnel": "<path d=\"M10 20a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341L21.74 4.67A1 1 0 0 0 21 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14z\"></path>",
  "inbox": "<polyline points=\"22 12 16 12 14 15 10 15 8 12 2 12\"></polyline><path d=\"M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z\"></path>",
  "info": "<circle cx=\"12\" cy=\"12\" r=\"10\"></circle><path d=\"M12 16v-4\"></path><path d=\"M12 8h.01\"></path>",
  "landmark": "<path d=\"M10 18v-7\"></path><path d=\"M11.119 2.205a2 2 0 0 1 1.762 0l7.84 3.846A.5.5 0 0 1 20.5 7h-17a.5.5 0 0 1-.22-.949z\"></path><path d=\"M14 18v-7\"></path><path d=\"M18 18v-7\"></path><path d=\"M3 22h18\"></path><path d=\"M6 18v-7\"></path>",
  "layout-dashboard": "<rect width=\"7\" height=\"9\" x=\"3\" y=\"3\" rx=\"1\"></rect><rect width=\"7\" height=\"5\" x=\"14\" y=\"3\" rx=\"1\"></rect><rect width=\"7\" height=\"9\" x=\"14\" y=\"12\" rx=\"1\"></rect><rect width=\"7\" height=\"5\" x=\"3\" y=\"16\" rx=\"1\"></rect>",
  "link-2": "<path d=\"M9 17H7A5 5 0 0 1 7 7h2\"></path><path d=\"M15 7h2a5 5 0 1 1 0 10h-2\"></path><line x1=\"8\" x2=\"16\" y1=\"12\" y2=\"12\"></line>",
  "list-filter": "<path d=\"M2 5h20\"></path><path d=\"M6 12h12\"></path><path d=\"M9 19h6\"></path>",
  "mail": "<path d=\"m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7\"></path><rect x=\"2\" y=\"4\" width=\"20\" height=\"16\" rx=\"2\"></rect>",
  "pencil": "<path d=\"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z\"></path><path d=\"m15 5 4 4\"></path>",
  "plus": "<path d=\"M5 12h14\"></path><path d=\"M12 5v14\"></path>",
  "receipt": "<path d=\"M12 17V7\"></path><path d=\"M16 8h-6a2 2 0 0 0 0 4h4a2 2 0 0 1 0 4H8\"></path><path d=\"M4 3a1 1 0 0 1 1-1 1.3 1.3 0 0 1 .7.2l.933.6a1.3 1.3 0 0 0 1.4 0l.934-.6a1.3 1.3 0 0 1 1.4 0l.933.6a1.3 1.3 0 0 0 1.4 0l.933-.6a1.3 1.3 0 0 1 1.4 0l.934.6a1.3 1.3 0 0 0 1.4 0l.933-.6A1.3 1.3 0 0 1 19 2a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1 1.3 1.3 0 0 1-.7-.2l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.934.6a1.3 1.3 0 0 1-1.4 0l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-1.4 0l-.934-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-.7.2 1 1 0 0 1-1-1z\"></path>",
  "refresh-cw": "<path d=\"M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8\"></path><path d=\"M21 3v5h-5\"></path><path d=\"M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16\"></path><path d=\"M8 16H3v5\"></path>",
  "scale": "<path d=\"M12 3v18\"></path><path d=\"m19 8 3 8a5 5 0 0 1-6 0zV7\"></path><path d=\"M3 7h1a17 17 0 0 0 8-2 17 17 0 0 0 8 2h1\"></path><path d=\"m5 8 3 8a5 5 0 0 1-6 0zV7\"></path><path d=\"M7 21h10\"></path>",
  "search": "<path d=\"m21 21-4.34-4.34\"></path><circle cx=\"11\" cy=\"11\" r=\"8\"></circle>",
  "settings": "<path d=\"M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915\"></path><circle cx=\"12\" cy=\"12\" r=\"3\"></circle>",
  "shield-check": "<path d=\"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z\"></path><path d=\"m9 12 2 2 4-4\"></path>",
  "sparkles": "<path d=\"M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z\"></path><path d=\"M20 2v4\"></path><path d=\"M22 4h-4\"></path><circle cx=\"4\" cy=\"20\" r=\"2\"></circle>",
  "tag": "<path d=\"M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z\"></path><circle cx=\"7.5\" cy=\"7.5\" r=\".5\" fill=\"currentColor\"></circle>",
  "trash-2": "<path d=\"M10 11v6\"></path><path d=\"M14 11v6\"></path><path d=\"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6\"></path><path d=\"M3 6h18\"></path><path d=\"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2\"></path>",
  "trending-down": "<path d=\"M16 17h6v-6\"></path><path d=\"m22 17-8.5-8.5-5 5L2 7\"></path>",
  "trending-up": "<path d=\"M16 7h6v6\"></path><path d=\"m22 7-8.5 8.5-5-5L2 17\"></path>",
  "upload": "<path d=\"M12 3v12\"></path><path d=\"m17 8-5-5-5 5\"></path><path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4\"></path>",
  "wallet": "<path d=\"M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1\"></path><path d=\"M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4\"></path>",
  "x": "<path d=\"M18 6 6 18\"></path><path d=\"m6 6 12 12\"></path>",
  "zap": "<path d=\"M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z\"></path>"
};
const ICON_NAMES = Object.keys(ICON_PATHS);
function Icon({
  name,
  size = 16,
  strokeWidth = 2,
  color = "currentColor",
  style,
  className,
  ...rest
}) {
  const inner = ICON_PATHS[name];
  if (!inner) {
    console.warn("[obds] Unknown icon: " + name + ". Available: " + ICON_NAMES.join(", "));
    return null;
  }
  return /*#__PURE__*/React.createElement("svg", {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: color,
    strokeWidth: strokeWidth,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": "true",
    focusable: "false",
    className: className,
    style: {
      flexShrink: 0,
      ...style
    },
    dangerouslySetInnerHTML: {
      __html: inner
    }
  });
}
Object.assign(__ds_scope, { ICON_NAMES, Icon });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Icon.jsx", error: String((e && e.message) || e) }); }

// components/ai/AskAI.jsx
try { (() => {
const {
  useState
} = React;
/* OpenBooks AskAI — the dashboard's question bar. Green sparkles, calm copy,
   suggestion chips below. AI affordances are always brand green, never purple. */

const askAiCss = `
.obds-askai { display: flex; flex-direction: column; gap: 8px; width: 100%; }
.obds-askai__bar {
  display: flex; align-items: center; gap: 10px;
  height: 44px; padding: 0 12px;
  background: var(--surface-card);
  border: 1px solid var(--border); border-radius: var(--radius-card);
  box-shadow: var(--shadow-xs);
  transition: border-color 120ms ease-out, box-shadow 120ms ease-out;
}
.obds-askai__bar:focus-within { border-color: var(--ring); box-shadow: var(--ring-shadow); }
.obds-askai__bar > svg { color: var(--ai); }
.obds-askai__input {
  flex: 1; border: none; outline: none; background: transparent;
  font-family: var(--font-sans); font-size: var(--text-sm); color: var(--foreground);
}
.obds-askai__input::placeholder { color: var(--text-muted); }
.obds-askai__send {
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; border: none; border-radius: var(--radius-md);
  background: var(--primary); color: var(--primary-foreground); cursor: pointer;
  transition: background-color 120ms ease-out;
}
.obds-askai__send:hover { background: color-mix(in oklab, var(--primary) 80%, var(--background)); }
.obds-askai__send:disabled { opacity: 0.5; pointer-events: none; }
.obds-askai__chips { display: flex; flex-wrap: wrap; gap: 6px; }
.obds-askai__chip {
  display: inline-flex; align-items: center; gap: 4px;
  height: 26px; padding: 0 10px; cursor: pointer;
  background: transparent; border: 1px solid var(--border); border-radius: var(--radius-full);
  font-family: var(--font-sans); font-size: var(--text-xs); font-weight: var(--weight-medium);
  color: var(--text-secondary);
  transition: background-color 120ms ease-out, color 120ms ease-out;
}
.obds-askai__chip:hover { background: var(--ai-surface); color: var(--ai); border-color: color-mix(in oklab, var(--ai) 30%, var(--border)); }
`;
if (typeof document !== "undefined" && !document.getElementById("obds-askai-css")) {
  const s = document.createElement("style");
  s.id = "obds-askai-css";
  s.textContent = askAiCss;
  document.head.appendChild(s);
}
function AskAI({
  placeholder = "Ask anything about your books",
  suggestions = [],
  onSubmit,
  style
}) {
  const [value, setValue] = useState("");
  const submit = text => {
    if (!text.trim()) return;
    if (onSubmit) onSubmit(text.trim());
    setValue("");
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "obds-askai",
    style: style
  }, /*#__PURE__*/React.createElement("div", {
    className: "obds-askai__bar"
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "sparkles",
    size: 18
  }), /*#__PURE__*/React.createElement("input", {
    className: "obds-askai__input",
    value: value,
    placeholder: placeholder,
    onChange: e => setValue(e.target.value),
    onKeyDown: e => {
      if (e.key === "Enter") submit(value);
    }
  }), /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "obds-askai__send",
    "aria-label": "Ask",
    disabled: !value.trim(),
    onClick: () => submit(value)
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "arrow-right",
    size: 16
  }))), suggestions.length ? /*#__PURE__*/React.createElement("div", {
    className: "obds-askai__chips"
  }, suggestions.map(s => /*#__PURE__*/React.createElement("button", {
    key: s,
    type: "button",
    className: "obds-askai__chip",
    onClick: () => submit(s)
  }, s))) : null);
}
Object.assign(__ds_scope, { AskAI });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/ai/AskAI.jsx", error: String((e && e.message) || e) }); }

// components/core/Badge.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* OpenBooks Badge — pill, h-20px, from the codebase's shadcn badge.tsx,
   extended with money/AI status variants used across the product. */

const badgeCss = `
.obds-badge {
  display: inline-flex; align-items: center; justify-content: center; gap: 4px;
  height: 20px; width: fit-content; padding: 0 8px; flex-shrink: 0;
  border: 1px solid transparent; border-radius: var(--radius-full);
  font-family: var(--font-sans); font-size: var(--text-xs); font-weight: var(--weight-medium);
  white-space: nowrap; line-height: 1;
}
.obds-badge--default { background: var(--primary); color: var(--primary-foreground); }
.obds-badge--secondary { background: var(--secondary); color: var(--secondary-foreground); }
.obds-badge--outline { background: transparent; color: var(--foreground); border-color: var(--border); }
.obds-badge--destructive { background: color-mix(in oklab, var(--destructive) 10%, transparent); color: var(--destructive); }
.obds-badge--positive { background: var(--positive-surface); color: var(--positive); }
.obds-badge--negative { background: var(--negative-surface); color: var(--negative); }
.obds-badge--warning { background: var(--warning-surface); color: var(--warning); }
.obds-badge--info { background: var(--info-surface); color: var(--info); }
.obds-badge--ai { background: var(--ai-surface); color: var(--ai); }
`;
if (typeof document !== "undefined" && !document.getElementById("obds-badge-css")) {
  const s = document.createElement("style");
  s.id = "obds-badge-css";
  s.textContent = badgeCss;
  document.head.appendChild(s);
}
function Badge({
  variant = "secondary",
  icon,
  children,
  className = "",
  ...rest
}) {
  return /*#__PURE__*/React.createElement("span", _extends({
    className: `obds-badge obds-badge--${variant} ${className}`
  }, rest), icon ? /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: 12
  }) : null, children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Badge.jsx", error: String((e && e.message) || e) }); }

// components/core/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* OpenBooks Button — port of the codebase's shadcn button.tsx (variants + sizes preserved). */

const buttonCss = `
.obds-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  flex-shrink: 0; white-space: nowrap; user-select: none; cursor: pointer;
  border: 1px solid transparent; border-radius: var(--radius-control);
  font-family: var(--font-sans); font-size: var(--text-sm); font-weight: var(--weight-medium);
  line-height: 1; outline: none;
  transition: background-color 120ms ease-out, color 120ms ease-out, border-color 120ms ease-out, transform 80ms ease-out;
}
.obds-btn:active:not(:disabled) { transform: translateY(1px); }
.obds-btn:focus-visible { border-color: var(--ring); box-shadow: var(--ring-shadow); }
.obds-btn:disabled { pointer-events: none; opacity: 0.5; }

.obds-btn--default { background: var(--primary); color: var(--primary-foreground); }
.obds-btn--default:hover { background: color-mix(in oklab, var(--primary) 80%, var(--background)); }
.obds-btn--outline { background: var(--background); color: var(--foreground); border-color: var(--border); }
.obds-btn--outline:hover { background: var(--muted); }
.obds-btn--secondary { background: var(--secondary); color: var(--secondary-foreground); }
.obds-btn--secondary:hover { background: color-mix(in oklch, var(--secondary), var(--foreground) 5%); }
.obds-btn--ghost { background: transparent; color: var(--foreground); }
.obds-btn--ghost:hover { background: var(--muted); }
.obds-btn--destructive { background: color-mix(in oklab, var(--destructive) 10%, transparent); color: var(--destructive); }
.obds-btn--destructive:hover { background: color-mix(in oklab, var(--destructive) 20%, transparent); }
.obds-btn--link { background: transparent; color: var(--primary); text-underline-offset: 4px; padding: 0; height: auto; }
.obds-btn--link:hover { text-decoration: underline; }

.obds-btn--size-default { height: 32px; padding: 0 10px; }
.obds-btn--size-sm { height: 28px; padding: 0 10px; font-size: 0.8rem; gap: 4px; }
.obds-btn--size-lg { height: 36px; padding: 0 12px; }
.obds-btn--size-icon { height: 32px; width: 32px; padding: 0; }
.obds-btn--size-icon-sm { height: 28px; width: 28px; padding: 0; }
`;
if (typeof document !== "undefined" && !document.getElementById("obds-button-css")) {
  const s = document.createElement("style");
  s.id = "obds-button-css";
  s.textContent = buttonCss;
  document.head.appendChild(s);
}
function Button({
  variant = "default",
  size = "default",
  icon,
  iconEnd,
  children,
  className = "",
  ...rest
}) {
  const iconSize = size === "sm" || size === "icon-sm" ? 14 : 16;
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    className: `obds-btn obds-btn--${variant} obds-btn--size-${size} ${className}`
  }, rest), icon ? /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: iconSize
  }) : null, children, iconEnd ? /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: iconEnd,
    size: iconSize
  }) : null);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

// components/core/Tabs.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const {
  createContext,
  useContext,
  useState
} = React;
/* OpenBooks Tabs — from the codebase's shadcn tabs.tsx.
   default variant: muted pill list with white active trigger + shadow-sm.
   line variant: transparent list with 2px foreground underline. */
const tabsCss = `
.obds-tabs { display: flex; flex-direction: column; gap: 8px; }
.obds-tabs__list {
  display: inline-flex; width: fit-content; align-items: center; justify-content: center;
  height: 32px; padding: 3px; border-radius: var(--radius-control);
  color: var(--text-muted);
}
.obds-tabs__list--default { background: var(--muted); }
.obds-tabs__list--line { background: transparent; gap: 4px; border-radius: 0; }
.obds-tabs__trigger {
  position: relative; display: inline-flex; flex: 1; align-items: center; justify-content: center;
  gap: 6px; height: calc(100% - 1px); padding: 2px 10px;
  border: 1px solid transparent; border-radius: var(--radius-md); cursor: pointer;
  background: transparent; font-family: var(--font-sans);
  font-size: var(--text-sm); font-weight: var(--weight-medium);
  color: color-mix(in oklab, var(--foreground) 60%, transparent);
  white-space: nowrap; transition: color 120ms ease-out, background-color 120ms ease-out;
  outline: none;
}
.obds-tabs__trigger:hover { color: var(--foreground); }
.obds-tabs__trigger:focus-visible { border-color: var(--ring); box-shadow: var(--ring-shadow); }
.obds-tabs__trigger[data-active="true"] { color: var(--foreground); }
.obds-tabs__list--default .obds-tabs__trigger[data-active="true"] { background: var(--background); box-shadow: var(--shadow-sm); }
.obds-tabs__trigger::after {
  content: ""; position: absolute; left: 0; right: 0; bottom: -5px; height: 2px;
  background: var(--foreground); opacity: 0; transition: opacity 120ms ease-out;
}
.obds-tabs__list--line .obds-tabs__trigger[data-active="true"]::after { opacity: 1; }
.obds-tabs__content { flex: 1; font-size: var(--text-sm); outline: none; }
`;
if (typeof document !== "undefined" && !document.getElementById("obds-tabs-css")) {
  const s = document.createElement("style");
  s.id = "obds-tabs-css";
  s.textContent = tabsCss;
  document.head.appendChild(s);
}
const TabsContext = createContext(null);
function Tabs({
  defaultValue,
  value,
  onValueChange,
  children,
  className = "",
  ...rest
}) {
  const [internal, setInternal] = useState(defaultValue);
  const active = value !== undefined ? value : internal;
  const setActive = v => {
    if (value === undefined) setInternal(v);
    if (onValueChange) onValueChange(v);
  };
  return /*#__PURE__*/React.createElement(TabsContext.Provider, {
    value: {
      active,
      setActive
    }
  }, /*#__PURE__*/React.createElement("div", _extends({
    className: `obds-tabs ${className}`
  }, rest), children));
}
function TabsList({
  variant = "default",
  children,
  className = "",
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    role: "tablist",
    className: `obds-tabs__list obds-tabs__list--${variant} ${className}`
  }, rest), children);
}
function TabsTrigger({
  value,
  children,
  className = "",
  ...rest
}) {
  const ctx = useContext(TabsContext);
  const isActive = ctx && ctx.active === value;
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    role: "tab",
    "aria-selected": isActive,
    "data-active": isActive ? "true" : "false",
    className: `obds-tabs__trigger ${className}`,
    onClick: () => ctx && ctx.setActive(value)
  }, rest), children);
}
function TabsContent({
  value,
  children,
  className = "",
  ...rest
}) {
  const ctx = useContext(TabsContext);
  if (!ctx || ctx.active !== value) return null;
  return /*#__PURE__*/React.createElement("div", _extends({
    role: "tabpanel",
    className: `obds-tabs__content ${className}`
  }, rest), children);
}
Object.assign(__ds_scope, { Tabs, TabsList, TabsTrigger, TabsContent });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Tabs.jsx", error: String((e && e.message) || e) }); }

// components/data/Amount.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* OpenBooks Amount — every money figure in the product renders through this.
   Geist Mono, tabular numerals, semantic sign coloring. */

function formatMoney(value, {
  currency = "$",
  decimals = 2,
  abbreviate = false
} = {}) {
  const abs = Math.abs(value);
  if (abbreviate && abs >= 1000) {
    const k = abs >= 1e6 ? abs / 1e6 : abs / 1e3;
    const suffix = abs >= 1e6 ? "M" : "K";
    return currency + k.toFixed(1) + suffix;
  }
  return currency + abs.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}
function Amount({
  value,
  colored = false,
  signed = false,
  abbreviate = false,
  decimals = 2,
  currency = "$",
  size,
  weight,
  style,
  className = "",
  ...rest
}) {
  const negative = value < 0;
  const body = formatMoney(value, {
    currency,
    decimals,
    abbreviate
  });
  const sign = negative ? "−" : signed ? "+" : "";
  const color = colored ? negative ? "var(--negative)" : "var(--positive)" : undefined;
  return /*#__PURE__*/React.createElement("span", _extends({
    className: className,
    style: {
      fontFamily: "var(--font-figures)",
      fontFeatureSettings: '"tnum" 1, "lnum" 1',
      fontSize: size,
      fontWeight: weight,
      color,
      whiteSpace: "nowrap",
      ...style
    }
  }, rest), sign, body);
}
Object.assign(__ds_scope, { formatMoney, Amount });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/Amount.jsx", error: String((e && e.message) || e) }); }

// components/ai/ReviewItem.jsx
try { (() => {
/* OpenBooks ReviewItem — one Inbox entry: the AI explains its uncertainty about a
   transaction and offers category choices. AI speaks in first person here only. */

const reviewCss = `
.obds-review {
  display: flex; flex-direction: column; gap: 10px;
  padding: 14px 16px;
  background: var(--surface-card);
  border: 1px solid var(--border); border-radius: var(--radius-card);
  box-shadow: var(--shadow-xs);
}
.obds-review__top { display: flex; align-items: center; gap: 10px; }
.obds-review__txn { display: flex; align-items: baseline; gap: 8px; flex: 1; min-width: 0; }
.obds-review__counterparty { font-weight: var(--weight-medium); font-size: var(--text-sm); }
.obds-review__date { font-size: var(--text-xs); color: var(--text-muted); font-family: var(--font-figures); }
.obds-review__question {
  display: flex; gap: 8px; align-items: flex-start;
  font-size: var(--text-sm); color: var(--text-secondary); line-height: var(--leading-normal);
}
.obds-review__question > svg { color: var(--ai); margin-top: 2px; }
.obds-review__options { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.obds-review__option {
  display: inline-flex; align-items: center; gap: 6px;
  height: 28px; padding: 0 10px; cursor: pointer;
  background: transparent; border: 1px solid var(--border); border-radius: var(--radius-control);
  font-family: var(--font-sans); font-size: var(--text-xs); font-weight: var(--weight-medium);
  color: var(--foreground);
  transition: background-color 120ms ease-out, border-color 120ms ease-out, color 120ms ease-out;
}
.obds-review__option:hover { background: var(--positive-surface); border-color: var(--ob-green-300); color: var(--ob-green-800); }
`;
if (typeof document !== "undefined" && !document.getElementById("obds-review-css")) {
  const s = document.createElement("style");
  s.id = "obds-review-css";
  s.textContent = reviewCss;
  document.head.appendChild(s);
}
function ReviewItem({
  counterparty,
  date,
  amount,
  account,
  question,
  options = [],
  onChoose,
  onSkip,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "obds-review",
    style: style
  }, /*#__PURE__*/React.createElement("div", {
    className: "obds-review__top"
  }, /*#__PURE__*/React.createElement("div", {
    className: "obds-review__txn"
  }, /*#__PURE__*/React.createElement("span", {
    className: "obds-review__counterparty"
  }, counterparty), /*#__PURE__*/React.createElement("span", {
    className: "obds-review__date"
  }, date, account ? ` · ${account}` : "")), /*#__PURE__*/React.createElement(__ds_scope.Amount, {
    value: amount,
    colored: true,
    weight: 500
  }), /*#__PURE__*/React.createElement(__ds_scope.Badge, {
    variant: "warning",
    icon: "circle-alert"
  }, "Needs your input")), /*#__PURE__*/React.createElement("div", {
    className: "obds-review__question"
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "sparkles",
    size: 14
  }), /*#__PURE__*/React.createElement("span", null, question)), /*#__PURE__*/React.createElement("div", {
    className: "obds-review__options"
  }, options.map(opt => /*#__PURE__*/React.createElement("button", {
    key: opt,
    type: "button",
    className: "obds-review__option",
    onClick: () => onChoose && onChoose(opt)
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "check",
    size: 12
  }), opt)), /*#__PURE__*/React.createElement(__ds_scope.Button, {
    variant: "ghost",
    size: "sm",
    onClick: onSkip
  }, "Skip for now")));
}
Object.assign(__ds_scope, { ReviewItem });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/ai/ReviewItem.jsx", error: String((e && e.message) || e) }); }

// components/data/BarChart.jsx
try { (() => {
/* OpenBooks BarChart — minimal SVG column chart for cash-flow style widgets.
   Positive bars green, negative red; 4px top radius; thin baseline grid. */

function BarChart({
  data = [],
  height = 160,
  positiveColor = "var(--chart-1)",
  negativeColor = "var(--chart-5)",
  showLabels = true,
  formatValue
}) {
  const values = data.map(d => d.value);
  const max = Math.max(...values.map(v => Math.max(v, 0)), 1);
  const min = Math.min(...values.map(v => Math.min(v, 0)), 0);
  const range = max - min;
  const labelH = showLabels ? 18 : 0;
  const chartH = height - labelH;
  const zeroY = chartH * (max / range);
  const n = data.length;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      width: "100%"
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "100%",
    height: height,
    preserveAspectRatio: "none",
    style: {
      display: "block"
    },
    viewBox: `0 0 100 ${height}`
  }, /*#__PURE__*/React.createElement("line", {
    x1: "0",
    y1: zeroY,
    x2: "100",
    y2: zeroY,
    stroke: "var(--chart-grid)",
    strokeWidth: "1",
    vectorEffect: "non-scaling-stroke"
  }), data.map((d, i) => {
    const slot = 100 / n;
    const barW = slot * 0.55;
    const x = i * slot + (slot - barW) / 2;
    const h = Math.max(Math.abs(d.value) / range * chartH, 1.5);
    const y = d.value >= 0 ? zeroY - h : zeroY;
    const fill = d.color || (d.value >= 0 ? positiveColor : negativeColor);
    return /*#__PURE__*/React.createElement("rect", {
      key: i,
      x: x,
      y: y,
      width: barW,
      height: h,
      rx: "1.5",
      fill: fill
    }, formatValue ? /*#__PURE__*/React.createElement("title", null, `${d.label}: ${formatValue(d.value)}`) : null);
  })), showLabels ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: `repeat(${n}, 1fr)`,
      marginTop: 4
    }
  }, data.map((d, i) => /*#__PURE__*/React.createElement("span", {
    key: i,
    style: {
      textAlign: "center",
      fontSize: "var(--text-xs)",
      color: "var(--text-muted)"
    }
  }, d.label))) : null);
}
Object.assign(__ds_scope, { BarChart });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/BarChart.jsx", error: String((e && e.message) || e) }); }

// components/data/EmptyState.jsx
try { (() => {
/* OpenBooks EmptyState — quiet bordered well with a 40px muted icon. */

function EmptyState({
  icon = "inbox",
  title,
  description,
  action
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      padding: "40px 24px",
      textAlign: "center",
      border: "1px dashed var(--border)",
      borderRadius: "var(--radius-lg)",
      color: "var(--text-muted)"
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: 40,
    strokeWidth: 1.5
  }), title ? /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: "var(--text-sm)",
      fontWeight: "var(--weight-medium)",
      color: "var(--foreground)",
      marginTop: 4
    }
  }, title) : null, description ? /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: "var(--text-sm)",
      color: "var(--text-muted)",
      maxWidth: 360
    }
  }, description) : null, action ? /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 8
    }
  }, action) : null);
}
Object.assign(__ds_scope, { EmptyState });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/EmptyState.jsx", error: String((e && e.message) || e) }); }

// components/data/Sparkline.jsx
try { (() => {
/* OpenBooks Sparkline — 2px line, optional ≤8% area tint, for trend hints in metric cards. */

function Sparkline({
  data = [],
  width = 120,
  height = 36,
  color = "var(--chart-1)",
  fill = true
}) {
  if (data.length < 2) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const pad = 2;
  const pts = data.map((v, i) => {
    const x = pad + i / (data.length - 1) * (width - pad * 2);
    const y = pad + (1 - (v - min) / range) * (height - pad * 2);
    return [x, y];
  });
  const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${height} L${pts[0][0].toFixed(1)},${height} Z`;
  return /*#__PURE__*/React.createElement("svg", {
    width: width,
    height: height,
    viewBox: `0 0 ${width} ${height}`,
    style: {
      display: "block",
      overflow: "visible"
    }
  }, fill ? /*#__PURE__*/React.createElement("path", {
    d: area,
    fill: color,
    opacity: "0.08"
  }) : null, /*#__PURE__*/React.createElement("path", {
    d: line,
    fill: "none",
    stroke: color,
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }));
}
Object.assign(__ds_scope, { Sparkline });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/Sparkline.jsx", error: String((e && e.message) || e) }); }

// components/data/StatCard.jsx
try { (() => {
/* OpenBooks StatCard — dashboard metric card, layout from the codebase's page.tsx:
   muted label + icon action, 30px semibold value, detail + trend badge row. */

function StatCard({
  label,
  value,
  detail,
  icon,
  trend,
  trendVariant = "outline",
  children
}) {
  return /*#__PURE__*/React.createElement(__ds_scope.Card, null, /*#__PURE__*/React.createElement(__ds_scope.CardHeader, null, /*#__PURE__*/React.createElement(__ds_scope.CardTitle, {
    style: {
      fontSize: "var(--text-sm)",
      fontWeight: "var(--weight-medium)",
      color: "var(--text-muted)"
    }
  }, label), icon ? /*#__PURE__*/React.createElement(__ds_scope.CardAction, null, /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--text-muted)",
      display: "flex"
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: 16
  }))) : null), /*#__PURE__*/React.createElement(__ds_scope.CardContent, {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: "var(--text-metric-size)",
      fontWeight: "var(--weight-semibold)",
      letterSpacing: "var(--text-metric-tracking)",
      lineHeight: "var(--leading-tight)"
    }
  }, value), detail || trend ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: "var(--text-sm)",
      color: "var(--text-muted)"
    }
  }, detail), trend ? /*#__PURE__*/React.createElement(__ds_scope.Badge, {
    variant: trendVariant
  }, trend) : null) : null, children));
}
Object.assign(__ds_scope, { StatCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/StatCard.jsx", error: String((e && e.message) || e) }); }

// components/data/Table.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* OpenBooks Table — from the codebase's shadcn table.tsx:
   40px header row, hairline row borders, muted row hover, last row borderless. */

const tableCss = `
.obds-table-container { position: relative; width: 100%; overflow-x: auto; }
.obds-table { width: 100%; border-collapse: collapse; font-size: var(--text-sm); }
.obds-table thead tr { border-bottom: var(--border-default); }
.obds-table tbody tr { border-bottom: var(--border-default); transition: background-color 120ms ease-out; }
.obds-table tbody tr:last-child { border-bottom: 0; }
.obds-table tbody tr:hover { background: color-mix(in oklab, var(--muted) 50%, transparent); }
.obds-table th {
  height: 40px; padding: 0 8px; text-align: left; vertical-align: middle;
  font-weight: var(--weight-medium); color: var(--foreground); white-space: nowrap;
}
.obds-table td { padding: 8px; vertical-align: middle; white-space: nowrap; }
.obds-table th.obds-num, .obds-table td.obds-num {
  text-align: right;
  font-family: var(--font-figures); font-feature-settings: "tnum" 1, "lnum" 1;
}
.obds-table tfoot { border-top: var(--border-default); font-weight: var(--weight-medium); }
.obds-table tfoot td { background: color-mix(in oklab, var(--muted) 50%, transparent); }
`;
if (typeof document !== "undefined" && !document.getElementById("obds-table-css")) {
  const s = document.createElement("style");
  s.id = "obds-table-css";
  s.textContent = tableCss;
  document.head.appendChild(s);
}
function Table({
  children,
  className = "",
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "obds-table-container"
  }, /*#__PURE__*/React.createElement("table", _extends({
    className: `obds-table ${className}`
  }, rest), children));
}
function TableHeader({
  children,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("thead", rest, children);
}
function TableBody({
  children,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("tbody", rest, children);
}
function TableFooter({
  children,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("tfoot", rest, children);
}
function TableRow({
  children,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("tr", rest, children);
}
function TableHead({
  numeric = false,
  children,
  className = "",
  ...rest
}) {
  return /*#__PURE__*/React.createElement("th", _extends({
    className: `${numeric ? "obds-num" : ""} ${className}`
  }, rest), children);
}
function TableCell({
  numeric = false,
  children,
  className = "",
  ...rest
}) {
  return /*#__PURE__*/React.createElement("td", _extends({
    className: `${numeric ? "obds-num" : ""} ${className}`
  }, rest), children);
}
Object.assign(__ds_scope, { Table, TableHeader, TableBody, TableFooter, TableRow, TableHead, TableCell });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/Table.jsx", error: String((e && e.message) || e) }); }

// components/forms/Input.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* OpenBooks Input — from the codebase's shadcn input.tsx (h-8, rounded-lg, ring focus). */

const inputCss = `
.obds-input-wrap { position: relative; display: flex; align-items: center; width: 100%; }
.obds-input-wrap__icon {
  position: absolute; left: 10px; display: flex; align-items: center;
  color: var(--text-muted); pointer-events: none;
}
.obds-input {
  height: 32px; width: 100%; min-width: 0; padding: 4px 10px;
  background: transparent; border: 1px solid var(--input);
  border-radius: var(--radius-control); outline: none;
  font-family: var(--font-sans); font-size: var(--text-sm); color: var(--foreground);
  transition: border-color 120ms ease-out, box-shadow 120ms ease-out;
}
.obds-input--with-icon { padding-left: 32px; }
.obds-input::placeholder { color: var(--text-muted); }
.obds-input:focus-visible { border-color: var(--ring); box-shadow: var(--ring-shadow); }
.obds-input:disabled { pointer-events: none; cursor: not-allowed; opacity: 0.5; background: color-mix(in oklab, var(--input) 50%, transparent); }
.obds-input[aria-invalid="true"] { border-color: var(--destructive); }
`;
if (typeof document !== "undefined" && !document.getElementById("obds-input-css")) {
  const s = document.createElement("style");
  s.id = "obds-input-css";
  s.textContent = inputCss;
  document.head.appendChild(s);
}
function Input({
  icon,
  className = "",
  style,
  ...rest
}) {
  const input = /*#__PURE__*/React.createElement("input", _extends({
    className: `obds-input ${icon ? "obds-input--with-icon" : ""} ${className}`,
    style: icon ? undefined : style
  }, rest));
  if (!icon) return input;
  return /*#__PURE__*/React.createElement("div", {
    className: "obds-input-wrap",
    style: style
  }, /*#__PURE__*/React.createElement("span", {
    className: "obds-input-wrap__icon"
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: 16
  })), input);
}
Object.assign(__ds_scope, { Input });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Input.jsx", error: String((e && e.message) || e) }); }

// components/forms/Select.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* OpenBooks Select — styled native select matching Input metrics (h-32, rounded-lg). */

const selectCss = `
.obds-select-wrap { position: relative; display: inline-flex; align-items: center; }
.obds-select {
  appearance: none; height: 32px; min-width: 0; padding: 4px 30px 4px 10px;
  background: var(--background); border: 1px solid var(--input);
  border-radius: var(--radius-control); outline: none; cursor: pointer;
  font-family: var(--font-sans); font-size: var(--text-sm); color: var(--foreground);
  transition: border-color 120ms ease-out, box-shadow 120ms ease-out, background-color 120ms ease-out;
}
.obds-select:hover { background: var(--muted); }
.obds-select:focus-visible { border-color: var(--ring); box-shadow: var(--ring-shadow); }
.obds-select:disabled { pointer-events: none; opacity: 0.5; }
.obds-select-wrap__chevron {
  position: absolute; right: 10px; display: flex; align-items: center;
  color: var(--text-muted); pointer-events: none;
}
`;
if (typeof document !== "undefined" && !document.getElementById("obds-select-css")) {
  const s = document.createElement("style");
  s.id = "obds-select-css";
  s.textContent = selectCss;
  document.head.appendChild(s);
}
function Select({
  options = [],
  value,
  defaultValue,
  onChange,
  placeholder,
  className = "",
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("span", {
    className: `obds-select-wrap ${className}`,
    style: style
  }, /*#__PURE__*/React.createElement("select", _extends({
    className: "obds-select",
    value: value,
    defaultValue: value === undefined ? defaultValue !== undefined ? defaultValue : placeholder ? "" : undefined : undefined,
    onChange: onChange
  }, rest), placeholder ? /*#__PURE__*/React.createElement("option", {
    value: "",
    disabled: true
  }, placeholder) : null, options.map(opt => {
    const o = typeof opt === "string" ? {
      value: opt,
      label: opt
    } : opt;
    return /*#__PURE__*/React.createElement("option", {
      key: o.value,
      value: o.value
    }, o.label);
  })), /*#__PURE__*/React.createElement("span", {
    className: "obds-select-wrap__chevron"
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "chevron-down",
    size: 16
  })));
}
Object.assign(__ds_scope, { Select });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Select.jsx", error: String((e && e.message) || e) }); }

// components/forms/Switch.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const {
  useState
} = React;
/* OpenBooks Switch — from the codebase's shadcn switch.tsx (32×18, green when on). */
const switchCss = `
.obds-switch {
  position: relative; display: inline-flex; align-items: center; flex-shrink: 0;
  width: 32px; height: 18px; padding: 0; cursor: pointer;
  border: 1px solid transparent; border-radius: var(--radius-full);
  background: var(--input); outline: none;
  transition: background-color 120ms ease-out;
}
.obds-switch[aria-checked="true"] { background: var(--primary); }
.obds-switch:focus-visible { border-color: var(--ring); box-shadow: var(--ring-shadow); }
.obds-switch:disabled { cursor: not-allowed; opacity: 0.5; }
.obds-switch__thumb {
  display: block; width: 14px; height: 14px; margin-left: 1px;
  border-radius: var(--radius-full); background: var(--background);
  transition: transform 120ms ease-out;
}
.obds-switch[aria-checked="true"] .obds-switch__thumb { transform: translateX(14px); }
.obds-switch--sm { width: 24px; height: 14px; }
.obds-switch--sm .obds-switch__thumb { width: 10px; height: 10px; }
.obds-switch--sm[aria-checked="true"] .obds-switch__thumb { transform: translateX(10px); }
`;
if (typeof document !== "undefined" && !document.getElementById("obds-switch-css")) {
  const s = document.createElement("style");
  s.id = "obds-switch-css";
  s.textContent = switchCss;
  document.head.appendChild(s);
}
function Switch({
  checked,
  defaultChecked = false,
  onCheckedChange,
  size = "default",
  className = "",
  ...rest
}) {
  const [internal, setInternal] = useState(defaultChecked);
  const isOn = checked !== undefined ? checked : internal;
  const toggle = () => {
    const next = !isOn;
    if (checked === undefined) setInternal(next);
    if (onCheckedChange) onCheckedChange(next);
  };
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    role: "switch",
    "aria-checked": isOn,
    onClick: toggle,
    className: `obds-switch ${size === "sm" ? "obds-switch--sm" : ""} ${className}`
  }, rest), /*#__PURE__*/React.createElement("span", {
    className: "obds-switch__thumb"
  }));
}
Object.assign(__ds_scope, { Switch });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Switch.jsx", error: String((e && e.message) || e) }); }

// components/navigation/PageHeader.jsx
try { (() => {
/* OpenBooks PageHeader — title row at the top of every screen: 24px semibold title,
   muted description, actions right-aligned. */

function PageHeader({
  title,
  description,
  actions,
  style
}) {
  return /*#__PURE__*/React.createElement("header", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 16,
      flexWrap: "wrap",
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 2,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("h1", {
    style: {
      fontSize: "var(--text-page-title-size)",
      fontWeight: "var(--text-page-title-weight)",
      lineHeight: "var(--leading-tight)",
      letterSpacing: "-0.01em"
    }
  }, title), description ? /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: "var(--text-sm)",
      color: "var(--text-muted)"
    }
  }, description) : null), actions ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      flexShrink: 0
    }
  }, actions) : null);
}
Object.assign(__ds_scope, { PageHeader });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/PageHeader.jsx", error: String((e && e.message) || e) }); }

// components/navigation/SideNav.jsx
try { (() => {
/* OpenBooks SideNav — the app shell's fixed left rail (232px, light, green active state).
   Logo mark: assets/logo/openbooks-mark.png (pass logoSrc with the correct relative path). */

const sideNavCss = `
.obds-sidenav {
  display: flex; flex-direction: column; flex-shrink: 0;
  width: var(--sidebar-width); height: 100%;
  background: var(--sidebar); border-right: 1px solid var(--sidebar-border);
  font-family: var(--font-sans);
}
.obds-sidenav__brand {
  display: flex; align-items: center; gap: 10px;
  padding: 16px 16px 12px;
}
.obds-sidenav__brand img { width: 28px; height: 28px; border-radius: var(--radius-full); }
.obds-sidenav__wordmark {
  font-size: var(--text-base); font-weight: var(--weight-semibold);
  color: var(--foreground); letter-spacing: -0.01em;
}
.obds-sidenav__items { display: flex; flex-direction: column; gap: 2px; padding: 8px; flex: 1; overflow-y: auto; }
.obds-sidenav__section {
  padding: 14px 8px 4px; font-size: 11px; font-weight: var(--weight-medium);
  letter-spacing: 0.05em; text-transform: uppercase; color: var(--text-muted);
}
.obds-sidenav__item {
  display: flex; align-items: center; gap: 10px;
  padding: 7px 8px; border: none; border-radius: var(--radius-md);
  background: transparent; cursor: pointer; text-align: left; width: 100%;
  font-size: var(--text-sm); font-weight: var(--weight-medium);
  color: var(--sidebar-foreground);
  transition: background-color 120ms ease-out, color 120ms ease-out;
}
.obds-sidenav__item:hover { background: color-mix(in oklab, var(--muted) 70%, transparent); color: var(--foreground); }
.obds-sidenav__item[data-active="true"] {
  background: var(--sidebar-accent); color: var(--sidebar-accent-foreground);
}
.obds-sidenav__item-label { flex: 1; }
.obds-sidenav__count {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 18px; height: 18px; padding: 0 5px;
  border-radius: var(--radius-full); background: var(--primary);
  color: var(--primary-foreground); font-size: 11px; font-weight: var(--weight-semibold);
}
.obds-sidenav__footer { padding: 8px; border-top: 1px solid var(--sidebar-border); }
`;
if (typeof document !== "undefined" && !document.getElementById("obds-sidenav-css")) {
  const s = document.createElement("style");
  s.id = "obds-sidenav-css";
  s.textContent = sideNavCss;
  document.head.appendChild(s);
}
function SideNav({
  items = [],
  activeId,
  onSelect,
  logoSrc,
  footerItems = [],
  style
}) {
  const renderItem = item => {
    if (item.section) {
      return /*#__PURE__*/React.createElement("div", {
        key: `s-${item.section}`,
        className: "obds-sidenav__section"
      }, item.section);
    }
    return /*#__PURE__*/React.createElement("button", {
      key: item.id,
      type: "button",
      className: "obds-sidenav__item",
      "data-active": item.id === activeId ? "true" : "false",
      onClick: () => onSelect && onSelect(item.id)
    }, item.icon ? /*#__PURE__*/React.createElement(__ds_scope.Icon, {
      name: item.icon,
      size: 18,
      strokeWidth: 1.75
    }) : null, /*#__PURE__*/React.createElement("span", {
      className: "obds-sidenav__item-label"
    }, item.label), item.count ? /*#__PURE__*/React.createElement("span", {
      className: "obds-sidenav__count"
    }, item.count) : null);
  };
  return /*#__PURE__*/React.createElement("nav", {
    className: "obds-sidenav",
    style: style
  }, /*#__PURE__*/React.createElement("div", {
    className: "obds-sidenav__brand"
  }, logoSrc ? /*#__PURE__*/React.createElement("img", {
    src: logoSrc,
    alt: "OpenBooks"
  }) : null, /*#__PURE__*/React.createElement("span", {
    className: "obds-sidenav__wordmark"
  }, "open books")), /*#__PURE__*/React.createElement("div", {
    className: "obds-sidenav__items"
  }, items.map(renderItem)), footerItems.length ? /*#__PURE__*/React.createElement("div", {
    className: "obds-sidenav__footer"
  }, footerItems.map(renderItem)) : null);
}
Object.assign(__ds_scope, { SideNav });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/SideNav.jsx", error: String((e && e.message) || e) }); }

// ui_kits/openbooks/CashFlow.jsx
try { (() => {
const {
  PageHeader: OBCPageHeader,
  StatCard: OBCStatCard,
  Amount: OBCAmount,
  BarChart: OBCBarChart,
  Badge: OBCBadge,
  Card: OBCCard,
  CardHeader: OBCCardHeader,
  CardTitle: OBCCardTitle,
  CardDescription: OBCCardDescription,
  CardContent: OBCCardContent,
  Select: OBCSelect,
  Icon: OBCIcon
} = window.OpenBooksDesignSystem_8d97bf;
const obPlanner = [{
  label: "Halpern Co retainer",
  due: "Jun 15",
  amount: 5500,
  dir: "in"
}, {
  label: "Contractor — delivery",
  due: "Jun 18",
  amount: -3700,
  dir: "out"
}, {
  label: "Rent — WeWork",
  due: "Jul 1",
  amount: -1200,
  dir: "out"
}, {
  label: "Stripe payout (est.)",
  due: "Jul 2",
  amount: 4100,
  dir: "in"
}, {
  label: "Quarterly insurance",
  due: "Jul 8",
  amount: -860,
  dir: "out"
}];
const obBudgets = [{
  label: "Software & AI tools",
  spent: 1240,
  budget: 1500
}, {
  label: "Contractor labor",
  spent: 5550,
  budget: 6000
}, {
  label: "Marketing",
  spent: 480,
  budget: 1200
}];
function OBCashFlow() {
  return /*#__PURE__*/React.createElement("div", {
    className: "ob-page"
  }, /*#__PURE__*/React.createElement(OBCPageHeader, {
    title: "Cash flow",
    description: "Where money moved, and what's coming",
    actions: /*#__PURE__*/React.createElement(OBCSelect, {
      options: ["Last 6 months", "Last 12 months"],
      defaultValue: "Last 6 months"
    })
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(3, 1fr)",
      gap: 16
    }
  }, /*#__PURE__*/React.createElement(OBCStatCard, {
    label: "Cash today",
    value: /*#__PURE__*/React.createElement(OBCAmount, {
      value: 128400,
      abbreviate: true,
      decimals: 1
    }),
    detail: "All accounts",
    icon: "landmark"
  }), /*#__PURE__*/React.createElement(OBCStatCard, {
    label: "Expected in 30 days",
    value: /*#__PURE__*/React.createElement(OBCAmount, {
      value: 9600,
      abbreviate: true,
      decimals: 1,
      signed: true
    }),
    detail: "Planner net",
    icon: "calendar",
    trend: "2 bills due",
    trendVariant: "outline"
  }), /*#__PURE__*/React.createElement(OBCStatCard, {
    label: "Runway",
    value: "14 months",
    detail: "At current average burn",
    icon: "clock-3"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1.45fr 0.85fr",
      gap: 16,
      alignItems: "start"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 16
    }
  }, /*#__PURE__*/React.createElement(OBCCard, null, /*#__PURE__*/React.createElement(OBCCardHeader, null, /*#__PURE__*/React.createElement(OBCCardTitle, null, "Net cash flow"), /*#__PURE__*/React.createElement(OBCCardDescription, null, "Monthly in minus out \xB7 amber = projected")), /*#__PURE__*/React.createElement(OBCCardContent, null, /*#__PURE__*/React.createElement(OBCBarChart, {
    height: 170,
    data: [{
      label: "Jan",
      value: 12400
    }, {
      label: "Feb",
      value: -3200
    }, {
      label: "Mar",
      value: 8900
    }, {
      label: "Apr",
      value: 15300
    }, {
      label: "May",
      value: 6100
    }, {
      label: "Jun",
      value: 9800
    }, {
      label: "Jul",
      value: 7400,
      color: "var(--chart-3)"
    }, {
      label: "Aug",
      value: 8200,
      color: "var(--chart-3)"
    }],
    formatValue: v => "$" + Math.abs(v).toLocaleString()
  }))), /*#__PURE__*/React.createElement(OBCCard, null, /*#__PURE__*/React.createElement(OBCCardHeader, null, /*#__PURE__*/React.createElement(OBCCardTitle, null, "Budgets"), /*#__PURE__*/React.createElement(OBCCardDescription, null, "June, three tracked categories")), /*#__PURE__*/React.createElement(OBCCardContent, {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 14
    }
  }, obBudgets.map(b => {
    const pct = Math.min(100, Math.round(b.spent / b.budget * 100));
    const over = pct >= 90;
    return /*#__PURE__*/React.createElement("div", {
      key: b.label,
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 6
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        justifyContent: "space-between",
        fontSize: "var(--text-sm)"
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontWeight: 500
      }
    }, b.label), /*#__PURE__*/React.createElement("span", {
      style: {
        color: "var(--text-muted)",
        fontFamily: "var(--font-figures)"
      }
    }, "$", b.spent.toLocaleString(), " / $", b.budget.toLocaleString())), /*#__PURE__*/React.createElement("div", {
      style: {
        height: 6,
        borderRadius: 3,
        background: "var(--muted)",
        overflow: "hidden"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        width: pct + "%",
        height: "100%",
        borderRadius: 3,
        background: over ? "var(--warning)" : "var(--chart-1)"
      }
    })));
  })))), /*#__PURE__*/React.createElement(OBCCard, null, /*#__PURE__*/React.createElement(OBCCardHeader, null, /*#__PURE__*/React.createElement(OBCCardTitle, null, "Planner"), /*#__PURE__*/React.createElement(OBCCardDescription, null, "Known and recurring items, next 30 days")), /*#__PURE__*/React.createElement(OBCCardContent, {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 12
    }
  }, obPlanner.map(p => /*#__PURE__*/React.createElement("div", {
    key: p.label,
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      width: 28,
      height: 28,
      borderRadius: "var(--radius-md)",
      background: p.dir === "in" ? "var(--positive-surface)" : "var(--negative-surface)",
      color: p.dir === "in" ? "var(--positive)" : "var(--negative)"
    }
  }, /*#__PURE__*/React.createElement(OBCIcon, {
    name: p.dir === "in" ? "arrow-down-right" : "arrow-up-right",
    size: 14
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: "var(--text-sm)",
      fontWeight: 500
    }
  }, p.label), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: "var(--text-xs)",
      color: "var(--text-muted)"
    }
  }, p.due)), /*#__PURE__*/React.createElement(OBCAmount, {
    value: p.amount,
    colored: true,
    signed: true
  })))))));
}
window.OBCashFlow = OBCashFlow;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/openbooks/CashFlow.jsx", error: String((e && e.message) || e) }); }

// ui_kits/openbooks/Dashboard.jsx
try { (() => {
const {
  PageHeader,
  AskAI,
  StatCard,
  Amount,
  Sparkline,
  BarChart,
  Badge,
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
  CardContent,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Icon,
  Select
} = window.OpenBooksDesignSystem_8d97bf;
const obAccounts = [{
  name: "Mercury Checking",
  kind: "Bank · Plaid",
  balance: 84210.33,
  icon: "landmark"
}, {
  name: "Chase Business Savings",
  kind: "Bank · Plaid",
  balance: 40102.18,
  icon: "landmark"
}, {
  name: "Stripe — Main",
  kind: "Payments · Stripe",
  balance: 4087.49,
  icon: "credit-card"
}];
const obPnlMonths = [{
  label: "Jan",
  income: 31,
  expenses: 22
}, {
  label: "Feb",
  income: 28,
  expenses: 21
}, {
  label: "Mar",
  income: 36,
  expenses: 24
}, {
  label: "Apr",
  income: 33,
  expenses: 19
}, {
  label: "May",
  income: 41,
  expenses: 23
}, {
  label: "Jun",
  income: 43,
  expenses: 20
}];
function OBDashboard({
  onNavigate,
  inboxCount = 3
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "ob-page"
  }, /*#__PURE__*/React.createElement(PageHeader, {
    title: "Business at a glance",
    description: "Jun 10, 2026 \xB7 All accounts synced 12 minutes ago",
    actions: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Select, {
      options: ["This month", "This quarter", "Year to date", "Last 12 months"],
      defaultValue: "This month"
    }), /*#__PURE__*/React.createElement(Button, {
      variant: "outline",
      icon: "plus",
      onClick: () => onNavigate("transactions")
    }, "Add transaction"))
  }), /*#__PURE__*/React.createElement(AskAI, {
    suggestions: ["How much did I spend on software in May?", "What's my runway at current burn?", "Which receivables are overdue?"]
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(4, 1fr)",
      gap: 16
    }
  }, /*#__PURE__*/React.createElement(StatCard, {
    label: "Total balance",
    value: /*#__PURE__*/React.createElement(Amount, {
      value: 128400,
      abbreviate: true,
      decimals: 1
    }),
    detail: "3 connected accounts",
    icon: "landmark",
    trend: "Synced",
    trendVariant: "info"
  }), /*#__PURE__*/React.createElement(StatCard, {
    label: "Income MTD",
    value: /*#__PURE__*/React.createElement(Amount, {
      value: 42800,
      abbreviate: true,
      decimals: 1
    }),
    detail: "Stripe and ACH sources",
    icon: "arrow-up-right",
    trend: "+18%",
    trendVariant: "positive"
  }, /*#__PURE__*/React.createElement(Sparkline, {
    data: [18, 22, 19, 27, 31, 42],
    width: 200,
    height: 28
  })), /*#__PURE__*/React.createElement(StatCard, {
    label: "Expenses MTD",
    value: /*#__PURE__*/React.createElement(Amount, {
      value: 19600,
      abbreviate: true,
      decimals: 1
    }),
    detail: "Software, contractors, fees",
    icon: "arrow-down-right",
    trend: "\u22124%",
    trendVariant: "positive"
  }), /*#__PURE__*/React.createElement(StatCard, {
    label: "Net profit MTD",
    value: /*#__PURE__*/React.createElement(Amount, {
      value: 23200,
      abbreviate: true,
      decimals: 1
    }),
    detail: "54% margin",
    icon: "trending-up",
    trend: "+31%",
    trendVariant: "positive"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1.45fr 0.85fr",
      gap: 16,
      alignItems: "start"
    }
  }, /*#__PURE__*/React.createElement(Card, null, /*#__PURE__*/React.createElement(CardHeader, null, /*#__PURE__*/React.createElement(CardTitle, null, "Profit & Loss"), /*#__PURE__*/React.createElement(CardDescription, null, "Income vs expenses, last 6 months ($K)"), /*#__PURE__*/React.createElement(CardAction, null, /*#__PURE__*/React.createElement(Button, {
    variant: "link",
    onClick: () => onNavigate("reports")
  }, "Run report"))), /*#__PURE__*/React.createElement(CardContent, null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 16,
      marginBottom: 8,
      fontSize: "var(--text-xs)",
      color: "var(--text-muted)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 8,
      height: 8,
      borderRadius: 2,
      background: "var(--chart-1)"
    }
  }), "Income"), /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 8,
      height: 8,
      borderRadius: 2,
      background: "var(--chart-4)"
    }
  }), "Expenses")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: `repeat(${obPnlMonths.length}, 1fr)`,
      gap: 12,
      alignItems: "end",
      height: 150
    }
  }, obPnlMonths.map(m => /*#__PURE__*/React.createElement("div", {
    key: m.label,
    style: {
      display: "flex",
      gap: 4,
      alignItems: "flex-end",
      justifyContent: "center",
      height: "100%"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 16,
      height: `${m.income / 45 * 100}%`,
      background: "var(--chart-1)",
      borderRadius: "3px 3px 0 0"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      width: 16,
      height: `${m.expenses / 45 * 100}%`,
      background: "var(--chart-4)",
      borderRadius: "3px 3px 0 0"
    }
  })))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: `repeat(${obPnlMonths.length}, 1fr)`,
      marginTop: 6
    }
  }, obPnlMonths.map(m => /*#__PURE__*/React.createElement("span", {
    key: m.label,
    style: {
      textAlign: "center",
      fontSize: "var(--text-xs)",
      color: "var(--text-muted)"
    }
  }, m.label))))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 16
    }
  }, /*#__PURE__*/React.createElement(Card, null, /*#__PURE__*/React.createElement(CardHeader, null, /*#__PURE__*/React.createElement(CardTitle, null, "Accounts"), /*#__PURE__*/React.createElement(CardAction, null, /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    size: "sm",
    icon: "plus"
  }, "Connect"))), /*#__PURE__*/React.createElement(CardContent, {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 12
    }
  }, obAccounts.map(a => /*#__PURE__*/React.createElement("div", {
    key: a.name,
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      width: 32,
      height: 32,
      borderRadius: "var(--radius-md)",
      border: "1px solid var(--border)",
      color: "var(--text-secondary)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: a.icon,
    size: 16
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: "var(--text-sm)",
      fontWeight: 500
    }
  }, a.name), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: "var(--text-xs)",
      color: "var(--text-muted)"
    }
  }, a.kind)), /*#__PURE__*/React.createElement(Amount, {
    value: a.balance,
    weight: 500
  }))))), /*#__PURE__*/React.createElement(Card, null, /*#__PURE__*/React.createElement(CardHeader, null, /*#__PURE__*/React.createElement(CardTitle, null, "Needs your input"), /*#__PURE__*/React.createElement(CardDescription, null, inboxCount, " transactions the AI couldn't place"), /*#__PURE__*/React.createElement(CardAction, null, /*#__PURE__*/React.createElement(Badge, {
    variant: "warning",
    icon: "circle-alert"
  }, inboxCount))), /*#__PURE__*/React.createElement(CardContent, null, /*#__PURE__*/React.createElement(Button, {
    variant: "outline",
    icon: "inbox",
    onClick: () => onNavigate("inbox"),
    style: {
      width: "100%"
    }
  }, "Open inbox"))))));
}
window.OBDashboard = OBDashboard;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/openbooks/Dashboard.jsx", error: String((e && e.message) || e) }); }

// ui_kits/openbooks/Inbox.jsx
try { (() => {
const {
  PageHeader: OBIPageHeader,
  ReviewItem: OBIReviewItem,
  EmptyState: OBIEmptyState,
  Badge: OBIBadge,
  Tabs: OBITabs,
  TabsList: OBITabsList,
  TabsTrigger: OBITabsTrigger,
  TabsContent: OBITabsContent
} = window.OpenBooksDesignSystem_8d97bf;
const obInboxSeed = [{
  id: 1,
  counterparty: "Wise transfer",
  date: "Jun 5",
  account: "Mercury Checking",
  amount: -1850,
  question: "I wasn't sure if this is contractor delivery labor or an owner reimbursement — you've used both for Wise before.",
  options: ["Contractor labor", "Owner reimbursement", "Something else"]
}, {
  id: 2,
  counterparty: "Amazon Mktp",
  date: "Jun 4",
  account: "Chase Business Savings",
  amount: -312.87,
  question: "This could be office supplies or inventory. Your last three Amazon purchases were split between the two.",
  options: ["Office supplies", "Inventory", "Something else"]
}, {
  id: 3,
  counterparty: "Zelle from R. Patel",
  date: "Jun 2",
  account: "Mercury Checking",
  amount: 2400,
  question: "I couldn't match this to an open invoice. Is it client revenue or a loan repayment?",
  options: ["Client revenue", "Loan repayment", "Something else"]
}];
function OBInbox({
  count,
  setCount
}) {
  const [items, setItems] = React.useState(obInboxSeed);
  const [resolved, setResolved] = React.useState([]);
  const resolve = (item, choice) => {
    setItems(prev => prev.filter(i => i.id !== item.id));
    setResolved(prev => [{
      ...item,
      choice
    }, ...prev]);
    if (setCount) setCount(c => Math.max(0, c - 1));
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "ob-page"
  }, /*#__PURE__*/React.createElement(OBIPageHeader, {
    title: "Inbox",
    description: "The AI asks here when it needs your context. Everything else posts automatically."
  }), /*#__PURE__*/React.createElement(OBITabs, {
    defaultValue: "open"
  }, /*#__PURE__*/React.createElement(OBITabsList, null, /*#__PURE__*/React.createElement(OBITabsTrigger, {
    value: "open"
  }, "Needs input", items.length ? ` (${items.length})` : ""), /*#__PURE__*/React.createElement(OBITabsTrigger, {
    value: "resolved"
  }, "Resolved", resolved.length ? ` (${resolved.length})` : "")), /*#__PURE__*/React.createElement(OBITabsContent, {
    value: "open"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 12,
      marginTop: 8
    }
  }, items.length === 0 ? /*#__PURE__*/React.createElement(OBIEmptyState, {
    icon: "circle-check",
    title: "Inbox zero",
    description: "Every transaction is categorized. AI will ask here when it needs your input."
  }) : items.map(item => /*#__PURE__*/React.createElement(OBIReviewItem, {
    key: item.id,
    counterparty: item.counterparty,
    date: item.date,
    account: item.account,
    amount: item.amount,
    question: item.question,
    options: item.options,
    onChoose: choice => resolve(item, choice),
    onSkip: () => resolve(item, "Skipped")
  })))), /*#__PURE__*/React.createElement(OBITabsContent, {
    value: "resolved"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 8,
      marginTop: 8
    }
  }, resolved.length === 0 ? /*#__PURE__*/React.createElement(OBIEmptyState, {
    icon: "inbox",
    title: "Nothing resolved yet",
    description: "Answered questions appear here with the category you chose."
  }) : resolved.map(item => /*#__PURE__*/React.createElement("div", {
    key: item.id,
    style: {
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "10px 16px",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-card)",
      background: "var(--surface-card)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 500,
      fontSize: "var(--text-sm)"
    }
  }, item.counterparty), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "var(--text-xs)",
      color: "var(--text-muted)",
      fontFamily: "var(--font-figures)"
    }
  }, item.date), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement(OBIBadge, {
    variant: item.choice === "Skipped" ? "secondary" : "positive",
    icon: item.choice === "Skipped" ? "clock-3" : "circle-check"
  }, item.choice)))))));
}
window.OBInbox = OBInbox;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/openbooks/Inbox.jsx", error: String((e && e.message) || e) }); }

// ui_kits/openbooks/Reports.jsx
try { (() => {
const {
  PageHeader: OBRPageHeader,
  Button: OBRButton,
  Select: OBRSelect,
  Icon: OBRIcon,
  Card: OBRCard,
  CardHeader: OBRCardHeader,
  CardTitle: OBRCardTitle,
  CardDescription: OBRCardDescription,
  CardContent: OBRCardContent,
  Table: OBRTable,
  TableHeader: OBRTableHeader,
  TableBody: OBRTableBody,
  TableFooter: OBRTableFooter,
  TableRow: OBRTableRow,
  TableHead: OBRTableHead,
  TableCell: OBRTableCell,
  Amount: OBRAmount
} = window.OpenBooksDesignSystem_8d97bf;
const obReportGroups = [{
  group: "Business overview",
  reports: [{
    id: "pl",
    name: "Profit & Loss",
    desc: "Income, expenses, and net profit for a period",
    icon: "chart-line"
  }, {
    id: "bs",
    name: "Balance Sheet",
    desc: "What you own and owe at a point in time",
    icon: "scale"
  }, {
    id: "cf",
    name: "Statement of Cash Flows",
    desc: "Cash in and out across operating, investing, financing",
    icon: "chart-column"
  }, {
    id: "snap",
    name: "Business Snapshot",
    desc: "Trends and key ratios at a glance",
    icon: "layout-dashboard"
  }]
}, {
  group: "Who owes you",
  reports: [{
    id: "ar",
    name: "A/R Aging Summary",
    desc: "Unpaid customer balances by 30/60/90-day buckets",
    icon: "arrow-down-right"
  }]
}, {
  group: "What you owe",
  reports: [{
    id: "ap",
    name: "A/P Aging Summary",
    desc: "Unpaid bills by 30/60/90-day buckets",
    icon: "arrow-up-right"
  }]
}];
const obPlLines = {
  income: [["Marketing retainer revenue", 27500.0], ["Stripe sales", 14182.49], ["Consulting income", 1117.51]],
  expenses: [["Contractor labor", 9250.0], ["Software & AI tools", 3118.4], ["Rent & facilities", 3600.0], ["Payment processing fees", 711.55], ["Bank fees", 120.05]]
};
function OBRReportPL({
  onBack
}) {
  const totalIncome = obPlLines.income.reduce((s, [, v]) => s + v, 0);
  const totalExpenses = obPlLines.expenses.reduce((s, [, v]) => s + v, 0);
  return /*#__PURE__*/React.createElement("div", {
    className: "ob-page"
  }, /*#__PURE__*/React.createElement(OBRPageHeader, {
    title: "Profit & Loss",
    description: "OpenBooks Demo Co \xB7 Apr 1 \u2013 Jun 10, 2026 \xB7 Accrual basis",
    actions: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(OBRSelect, {
      options: ["This quarter", "Year to date", "Last year"],
      defaultValue: "This quarter"
    }), /*#__PURE__*/React.createElement(OBRButton, {
      variant: "outline",
      icon: "download"
    }, "Export"), /*#__PURE__*/React.createElement(OBRButton, {
      variant: "ghost",
      icon: "chevron-left",
      onClick: onBack
    }, "All reports"))
  }), /*#__PURE__*/React.createElement(OBRCard, null, /*#__PURE__*/React.createElement(OBRCardContent, null, /*#__PURE__*/React.createElement(OBRTable, null, /*#__PURE__*/React.createElement(OBRTableHeader, null, /*#__PURE__*/React.createElement(OBRTableRow, null, /*#__PURE__*/React.createElement(OBRTableHead, null, "Account"), /*#__PURE__*/React.createElement(OBRTableHead, {
    numeric: true
  }, "Total"))), /*#__PURE__*/React.createElement(OBRTableBody, null, /*#__PURE__*/React.createElement(OBRTableRow, null, /*#__PURE__*/React.createElement(OBRTableCell, {
    style: {
      fontWeight: 600
    }
  }, "Income"), /*#__PURE__*/React.createElement(OBRTableCell, {
    numeric: true
  })), obPlLines.income.map(([name, v]) => /*#__PURE__*/React.createElement(OBRTableRow, {
    key: name
  }, /*#__PURE__*/React.createElement(OBRTableCell, {
    style: {
      paddingLeft: 28,
      color: "var(--text-secondary)"
    }
  }, name), /*#__PURE__*/React.createElement(OBRTableCell, {
    numeric: true
  }, /*#__PURE__*/React.createElement(OBRAmount, {
    value: v
  })))), /*#__PURE__*/React.createElement(OBRTableRow, null, /*#__PURE__*/React.createElement(OBRTableCell, {
    style: {
      fontWeight: 500
    }
  }, "Total income"), /*#__PURE__*/React.createElement(OBRTableCell, {
    numeric: true
  }, /*#__PURE__*/React.createElement(OBRAmount, {
    value: totalIncome,
    weight: 600
  }))), /*#__PURE__*/React.createElement(OBRTableRow, null, /*#__PURE__*/React.createElement(OBRTableCell, {
    style: {
      fontWeight: 600
    }
  }, "Expenses"), /*#__PURE__*/React.createElement(OBRTableCell, {
    numeric: true
  })), obPlLines.expenses.map(([name, v]) => /*#__PURE__*/React.createElement(OBRTableRow, {
    key: name
  }, /*#__PURE__*/React.createElement(OBRTableCell, {
    style: {
      paddingLeft: 28,
      color: "var(--text-secondary)"
    }
  }, name), /*#__PURE__*/React.createElement(OBRTableCell, {
    numeric: true
  }, /*#__PURE__*/React.createElement(OBRAmount, {
    value: -v
  })))), /*#__PURE__*/React.createElement(OBRTableRow, null, /*#__PURE__*/React.createElement(OBRTableCell, {
    style: {
      fontWeight: 500
    }
  }, "Total expenses"), /*#__PURE__*/React.createElement(OBRTableCell, {
    numeric: true
  }, /*#__PURE__*/React.createElement(OBRAmount, {
    value: -totalExpenses,
    weight: 600
  })))), /*#__PURE__*/React.createElement(OBRTableFooter, null, /*#__PURE__*/React.createElement(OBRTableRow, null, /*#__PURE__*/React.createElement(OBRTableCell, {
    style: {
      fontWeight: 600
    }
  }, "Net profit"), /*#__PURE__*/React.createElement(OBRTableCell, {
    numeric: true
  }, /*#__PURE__*/React.createElement(OBRAmount, {
    value: totalIncome - totalExpenses,
    colored: true,
    weight: 600
  }))))))));
}
function OBReports() {
  const [view, setView] = React.useState("list");
  if (view === "pl") return /*#__PURE__*/React.createElement(OBRReportPL, {
    onBack: () => setView("list")
  });
  return /*#__PURE__*/React.createElement("div", {
    className: "ob-page"
  }, /*#__PURE__*/React.createElement(OBRPageHeader, {
    title: "Reports",
    description: "Standard and custom reports for any period",
    actions: /*#__PURE__*/React.createElement(OBRButton, {
      variant: "outline",
      icon: "plus"
    }, "Custom report")
  }), obReportGroups.map(g => /*#__PURE__*/React.createElement("div", {
    key: g.group,
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      fontSize: "var(--text-sm)",
      fontWeight: 500,
      color: "var(--text-muted)"
    }
  }, g.group), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(2, 1fr)",
      gap: 12
    }
  }, g.reports.map(r => /*#__PURE__*/React.createElement(OBRCard, {
    size: "sm",
    key: r.id,
    style: {
      cursor: r.id === "pl" ? "pointer" : "default"
    }
  }, /*#__PURE__*/React.createElement(OBRCardContent, {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 12
    },
    onClick: () => {
      if (r.id === "pl") setView("pl");
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      width: 36,
      height: 36,
      borderRadius: "var(--radius-md)",
      background: "var(--ob-green-50)",
      color: "var(--ob-green-700)",
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement(OBRIcon, {
    name: r.icon,
    size: 18
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: "var(--text-sm)",
      fontWeight: 500
    }
  }, r.name), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: "var(--text-xs)",
      color: "var(--text-muted)"
    }
  }, r.desc)), /*#__PURE__*/React.createElement(OBRIcon, {
    name: "chevron-right",
    size: 16,
    style: {
      color: "var(--text-muted)"
    }
  }))))))), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: "var(--text-xs)",
      color: "var(--text-muted)"
    }
  }, "Only Profit & Loss is wired in this kit; other reports open the same pattern."));
}
window.OBReports = OBReports;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/openbooks/Reports.jsx", error: String((e && e.message) || e) }); }

// ui_kits/openbooks/Transactions.jsx
try { (() => {
const {
  PageHeader: OBTPageHeader,
  Input: OBTInput,
  Select: OBTSelect,
  Button: OBTButton,
  Badge: OBTBadge,
  Amount: OBTAmount,
  Card: OBTCard,
  CardContent: OBTCardContent,
  Table: OBTTable,
  TableHeader: OBTTableHeader,
  TableBody: OBTTableBody,
  TableRow: OBTTableRow,
  TableHead: OBTTableHead,
  TableCell: OBTTableCell,
  Tabs: OBTTabs,
  TabsList: OBTTabsList,
  TabsTrigger: OBTTabsTrigger
} = window.OpenBooksDesignSystem_8d97bf;
const obTxns = [{
  date: "Jun 9",
  name: "Stripe payout",
  account: "Stripe — Main",
  category: "Clearing reconciliation",
  amount: 4892.14,
  state: ["secondary", null, "Match"],
  ai: false
}, {
  date: "Jun 8",
  name: "Figma",
  account: "Mercury Checking",
  category: "Software & AI tools",
  amount: -45.0,
  state: ["positive", "circle-check", "Posted"],
  ai: true
}, {
  date: "Jun 6",
  name: "OpenAI",
  account: "Mercury Checking",
  category: "Software & AI tools",
  amount: -248.0,
  state: ["outline", null, "Ready"],
  ai: true
}, {
  date: "Jun 5",
  name: "Wise transfer",
  account: "Mercury Checking",
  category: "—",
  amount: -1850.0,
  state: ["warning", "circle-alert", "Needs review"],
  ai: false
}, {
  date: "Jun 4",
  name: "Mercury ACH — Halpern Co",
  account: "Mercury Checking",
  category: "Marketing retainer revenue",
  amount: 5500.0,
  state: ["positive", "circle-check", "Posted"],
  ai: true
}, {
  date: "Jun 4",
  name: "Google Workspace",
  account: "Chase Business Savings",
  category: "Software & AI tools",
  amount: -86.4,
  state: ["positive", "circle-check", "Posted"],
  ai: true
}, {
  date: "Jun 3",
  name: "WeWork",
  account: "Chase Business Savings",
  category: "Rent & facilities",
  amount: -1200.0,
  state: ["positive", "circle-check", "Posted"],
  ai: false
}, {
  date: "Jun 2",
  name: "Zelle from R. Patel",
  account: "Mercury Checking",
  category: "—",
  amount: 2400.0,
  state: ["warning", "circle-alert", "Needs review"],
  ai: false
}, {
  date: "Jun 1",
  name: "Stripe fees",
  account: "Stripe — Main",
  category: "Payment processing fees",
  amount: -142.31,
  state: ["positive", "circle-check", "Posted"],
  ai: true
}];
function OBTransactions({
  mode
}) {
  const title = mode === "income" ? "Income" : mode === "expenses" ? "Expenses" : "Transactions";
  const description = mode === "income" ? "Money in — every dollar attributed to a source" : mode === "expenses" ? "Money out — operational and other expenses" : "Every transaction from your banks and Stripe, categorized by AI";
  const rows = obTxns.filter(t => mode === "income" ? t.amount > 0 : mode === "expenses" ? t.amount < 0 : true);
  return /*#__PURE__*/React.createElement("div", {
    className: "ob-page"
  }, /*#__PURE__*/React.createElement(OBTPageHeader, {
    title: title,
    description: description,
    actions: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(OBTButton, {
      variant: "outline",
      icon: "upload"
    }, "Import receipts"), /*#__PURE__*/React.createElement(OBTButton, {
      icon: "plus"
    }, "Add transaction"))
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      alignItems: "center",
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement(OBTInput, {
    icon: "search",
    placeholder: "Search by vendor, amount, or category",
    style: {
      maxWidth: 320
    }
  }), /*#__PURE__*/React.createElement(OBTSelect, {
    options: ["All accounts", "Mercury Checking", "Chase Business Savings", "Stripe — Main"],
    defaultValue: "All accounts"
  }), /*#__PURE__*/React.createElement(OBTSelect, {
    options: ["All categories", "Software & AI tools", "Contractor labor", "Rent & facilities", "Payment processing fees"],
    defaultValue: "All categories"
  }), /*#__PURE__*/React.createElement(OBTSelect, {
    options: ["Last 30 days", "This quarter", "Year to date"],
    defaultValue: "Last 30 days"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement(OBTTabs, {
    defaultValue: "all"
  }, /*#__PURE__*/React.createElement(OBTTabsList, null, /*#__PURE__*/React.createElement(OBTTabsTrigger, {
    value: "review"
  }, "For review"), /*#__PURE__*/React.createElement(OBTTabsTrigger, {
    value: "all"
  }, "All")))), /*#__PURE__*/React.createElement(OBTCard, null, /*#__PURE__*/React.createElement(OBTCardContent, null, /*#__PURE__*/React.createElement(OBTTable, null, /*#__PURE__*/React.createElement(OBTTableHeader, null, /*#__PURE__*/React.createElement(OBTTableRow, null, /*#__PURE__*/React.createElement(OBTTableHead, null, "Date"), /*#__PURE__*/React.createElement(OBTTableHead, null, "Description"), /*#__PURE__*/React.createElement(OBTTableHead, null, "Account"), /*#__PURE__*/React.createElement(OBTTableHead, null, "Category"), /*#__PURE__*/React.createElement(OBTTableHead, {
    numeric: true
  }, "Amount"), /*#__PURE__*/React.createElement(OBTTableHead, {
    style: {
      textAlign: "right"
    }
  }, "State"))), /*#__PURE__*/React.createElement(OBTTableBody, null, rows.map((t, i) => /*#__PURE__*/React.createElement(OBTTableRow, {
    key: i
  }, /*#__PURE__*/React.createElement(OBTTableCell, {
    style: {
      fontFamily: "var(--font-figures)",
      fontSize: "var(--text-xs)",
      color: "var(--text-muted)"
    }
  }, t.date), /*#__PURE__*/React.createElement(OBTTableCell, {
    style: {
      fontWeight: 500
    }
  }, t.name), /*#__PURE__*/React.createElement(OBTTableCell, {
    style: {
      color: "var(--text-muted)",
      fontSize: "var(--text-xs)"
    }
  }, t.account), /*#__PURE__*/React.createElement(OBTTableCell, {
    style: {
      color: "var(--text-secondary)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 6
    }
  }, t.category, t.ai ? /*#__PURE__*/React.createElement(OBTBadge, {
    variant: "ai",
    icon: "sparkles"
  }, "AI") : null)), /*#__PURE__*/React.createElement(OBTTableCell, {
    numeric: true
  }, /*#__PURE__*/React.createElement(OBTAmount, {
    value: t.amount,
    colored: true
  })), /*#__PURE__*/React.createElement(OBTTableCell, {
    style: {
      textAlign: "right"
    }
  }, /*#__PURE__*/React.createElement(OBTBadge, {
    variant: t.state[0],
    icon: t.state[1] || undefined
  }, t.state[2])))))))));
}
window.OBTransactions = OBTransactions;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/openbooks/Transactions.jsx", error: String((e && e.message) || e) }); }

__ds_ns.AskAI = __ds_scope.AskAI;

__ds_ns.ReviewItem = __ds_scope.ReviewItem;

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.CardHeader = __ds_scope.CardHeader;

__ds_ns.CardTitle = __ds_scope.CardTitle;

__ds_ns.CardDescription = __ds_scope.CardDescription;

__ds_ns.CardAction = __ds_scope.CardAction;

__ds_ns.CardContent = __ds_scope.CardContent;

__ds_ns.CardFooter = __ds_scope.CardFooter;

__ds_ns.ICON_NAMES = __ds_scope.ICON_NAMES;

__ds_ns.Icon = __ds_scope.Icon;

__ds_ns.Tabs = __ds_scope.Tabs;

__ds_ns.TabsList = __ds_scope.TabsList;

__ds_ns.TabsTrigger = __ds_scope.TabsTrigger;

__ds_ns.TabsContent = __ds_scope.TabsContent;

__ds_ns.Amount = __ds_scope.Amount;

__ds_ns.BarChart = __ds_scope.BarChart;

__ds_ns.EmptyState = __ds_scope.EmptyState;

__ds_ns.Sparkline = __ds_scope.Sparkline;

__ds_ns.StatCard = __ds_scope.StatCard;

__ds_ns.Table = __ds_scope.Table;

__ds_ns.TableHeader = __ds_scope.TableHeader;

__ds_ns.TableBody = __ds_scope.TableBody;

__ds_ns.TableFooter = __ds_scope.TableFooter;

__ds_ns.TableRow = __ds_scope.TableRow;

__ds_ns.TableHead = __ds_scope.TableHead;

__ds_ns.TableCell = __ds_scope.TableCell;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.Select = __ds_scope.Select;

__ds_ns.Switch = __ds_scope.Switch;

__ds_ns.PageHeader = __ds_scope.PageHeader;

__ds_ns.SideNav = __ds_scope.SideNav;

})();
