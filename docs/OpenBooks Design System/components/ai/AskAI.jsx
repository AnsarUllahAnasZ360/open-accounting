import React, { useState } from "react";
import { Icon } from "../core/Icon.jsx";

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

export function AskAI({
  placeholder = "Ask anything about your books",
  suggestions = [],
  onSubmit,
  style,
}) {
  const [value, setValue] = useState("");
  const submit = (text) => {
    if (!text.trim()) return;
    if (onSubmit) onSubmit(text.trim());
    setValue("");
  };
  return (
    <div className="obds-askai" style={style}>
      <div className="obds-askai__bar">
        <Icon name="sparkles" size={18} />
        <input
          className="obds-askai__input"
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(value); }}
        />
        <button
          type="button"
          className="obds-askai__send"
          aria-label="Ask"
          disabled={!value.trim()}
          onClick={() => submit(value)}
        >
          <Icon name="arrow-right" size={16} />
        </button>
      </div>
      {suggestions.length ? (
        <div className="obds-askai__chips">
          {suggestions.map((s) => (
            <button key={s} type="button" className="obds-askai__chip" onClick={() => submit(s)}>
              {s}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
