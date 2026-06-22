The OpenBooks action button — green primary, quiet outline/ghost for everything else.

```jsx
<Button icon="plus">Add transaction</Button>
<Button variant="outline" icon="download">Export</Button>
<Button variant="ghost" size="icon" icon="ellipsis" aria-label="More" />
```

Variants: `default` (brand green — max one per view), `outline` (most common), `secondary`, `ghost` (toolbars, table rows), `destructive` (tinted red, not solid), `link`. Sizes: `default` 32px, `sm` 28px, `lg` 36px, `icon`/`icon-sm` square. Press state nudges down 1px; never add scale or shadow effects.
