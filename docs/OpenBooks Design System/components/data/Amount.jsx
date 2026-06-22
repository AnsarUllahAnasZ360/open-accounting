import React from "react";

/* OpenBooks Amount — every money figure in the product renders through this.
   Geist Mono, tabular numerals, semantic sign coloring. */

export function formatMoney(value, { currency = "$", decimals = 2, abbreviate = false } = {}) {
  const abs = Math.abs(value);
  if (abbreviate && abs >= 1000) {
    const k = abs >= 1e6 ? abs / 1e6 : abs / 1e3;
    const suffix = abs >= 1e6 ? "M" : "K";
    return currency + k.toFixed(1) + suffix;
  }
  return currency + abs.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function Amount({
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
  const body = formatMoney(value, { currency, decimals, abbreviate });
  const sign = negative ? "−" : signed ? "+" : "";
  const color = colored ? (negative ? "var(--negative)" : "var(--positive)") : undefined;
  return (
    <span
      className={className}
      style={{
        fontFamily: "var(--font-figures)",
        fontFeatureSettings: '"tnum" 1, "lnum" 1',
        fontSize: size,
        fontWeight: weight,
        color,
        whiteSpace: "nowrap",
        ...style,
      }}
      {...rest}
    >
      {sign}{body}
    </span>
  );
}
