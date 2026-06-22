import React from "react";
import { Icon } from "../core/Icon.jsx";
import { Badge } from "../core/Badge.jsx";
import { Button } from "../core/Button.jsx";
import { Amount } from "../data/Amount.jsx";

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

export function ReviewItem({
  counterparty,
  date,
  amount,
  account,
  question,
  options = [],
  onChoose,
  onSkip,
  style,
}) {
  return (
    <div className="obds-review" style={style}>
      <div className="obds-review__top">
        <div className="obds-review__txn">
          <span className="obds-review__counterparty">{counterparty}</span>
          <span className="obds-review__date">{date}{account ? ` · ${account}` : ""}</span>
        </div>
        <Amount value={amount} colored weight={500} />
        <Badge variant="warning" icon="circle-alert">Needs your input</Badge>
      </div>
      <div className="obds-review__question">
        <Icon name="sparkles" size={14} />
        <span>{question}</span>
      </div>
      <div className="obds-review__options">
        {options.map((opt) => (
          <button key={opt} type="button" className="obds-review__option" onClick={() => onChoose && onChoose(opt)}>
            <Icon name="check" size={12} />
            {opt}
          </button>
        ))}
        <Button variant="ghost" size="sm" onClick={onSkip}>Skip for now</Button>
      </div>
    </div>
  );
}
