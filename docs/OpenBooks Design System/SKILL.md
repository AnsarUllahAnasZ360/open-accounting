---
name: openbooks-design
description: Use this skill to generate well-branded interfaces and assets for OpenBooks (free, open-source AI bookkeeping for small businesses), either for production or throwaway prototypes/mocks/etc. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping.
user-invocable: true
---

Read the README.md file within this skill, and explore the other available files.
If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets out and create static HTML files for the user to view. If working on production code, you can copy assets and read the rules here to become an expert in designing with this brand.
If the user invokes this skill without any other guidance, ask them what they want to build or design, ask some questions, and act as an expert designer who outputs HTML artifacts _or_ production code, depending on the need.

Key facts:
- One accent color: OpenBooks green #2ca01c. AI affordances are green, never purple. No gradients, no emoji, no exclamation marks.
- Fonts: Geist (UI) and Geist Mono (all money figures, tabular numerals) — binaries in assets/fonts/, @font-face in tokens/fonts.css.
- Icons: lucide only — SVGs in assets/icons/, or the Icon React component.
- Components compile to _ds_bundle.js; per-component usage notes are in components/**/<Name>.prompt.md.
- Full app screens to copy from: ui_kits/openbooks/.
