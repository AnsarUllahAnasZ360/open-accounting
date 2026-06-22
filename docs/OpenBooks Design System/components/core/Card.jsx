import React from "react";

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

export function Card({ size = "default", children, className = "", style, ...rest }) {
  return (
    <div className={`obds-card ${size === "sm" ? "obds-card--sm" : ""} ${className}`} style={style} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({ children, className = "", ...rest }) {
  return <div className={`obds-card__header ${className}`} {...rest}>{children}</div>;
}

export function CardTitle({ children, className = "", style, ...rest }) {
  return <div className={`obds-card__title ${className}`} style={style} {...rest}>{children}</div>;
}

export function CardDescription({ children, className = "", ...rest }) {
  return <div className={`obds-card__description ${className}`} {...rest}>{children}</div>;
}

export function CardAction({ children, className = "", ...rest }) {
  return <div className={`obds-card__action ${className}`} {...rest}>{children}</div>;
}

export function CardContent({ children, className = "", style, ...rest }) {
  return <div className={`obds-card__content ${className}`} style={style} {...rest}>{children}</div>;
}

export function CardFooter({ children, className = "", ...rest }) {
  return <div className={`obds-card__footer ${className}`} {...rest}>{children}</div>;
}
