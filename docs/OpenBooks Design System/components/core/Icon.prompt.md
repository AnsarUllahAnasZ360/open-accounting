Lucide icon by name, tinted via currentColor — the only way to render icons in OpenBooks UIs.

```jsx
<Icon name="landmark" size={16} />
<span style={{ color: "var(--ai)" }}><Icon name="sparkles" /></span>
```

Names are kebab-case lucide names (50 available, see `assets/icons/`): `landmark`, `banknote`, `wallet`, `credit-card`, `receipt`, `inbox`, `sparkles`, `chart-column`, `chart-line`, `chart-pie`, `trending-up`, `trending-down`, `arrow-up-right`, `arrow-down-right`, `circle-alert`, `circle-check`, `shield-check`, `search`, `plus`, `chevron-down`, `calendar`, `download`, `refresh-cw`, `settings`, `ellipsis`, `x`, `check`, `funnel`, `tag`, `pencil`, `trash-2`, `dollar-sign`, `book-open`, `scale`, `link-2`, `upload`, `list-filter`, `zap`, `eye`, `info`, `mail`, `bot`, `building-2`, `clock-3`, `layout-dashboard`, `file-text`, `arrow-right`, `chevron-up`, `chevron-left`, `chevron-right`.

Sizes: 16 inline/buttons, 18–20 nav, 40 empty states. Unknown names warn and render null.
