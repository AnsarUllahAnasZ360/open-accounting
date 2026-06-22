# E12 — Settings & app-shell UI overhaul — make all 11 sections real, on-brand, responsive, and wire the scope-switcher hook

> Part of the **OpenBooks Launch Sprint**. Master plan: [../README.md](../README.md) · Backlog: [../backlog.md](../backlog.md)

**Goal.** Turn the Settings area and surrounding app shell from a partially-stubbed admin surface into a complete, consistent, responsive control panel where every section (Profile, Businesses, Tax, Connections, AI, Categories, Rules, Notifications, Team, Data, Audit) is fully functional on real data — and where the app shell exposes the "All businesses / per-LLC" scope switcher that the rest of the go-live sprint depends on. Connections + AI deep work belongs to E3; this epic owns the other 9 sections, the shared shell that frames them, and the scope-switcher UI/context hook (E5 owns the data plumbing behind it).

**Why it matters.** Settings is where Ansar configures his two LLCs, keys, team, taxes, and chart of accounts — and it is currently the most uneven surface in the product. Several sections are read-only or stubbed (no edit-business, no role changes, no member removal, audit capped at 200 rows and filtered in the browser, notifications that only reflect an env var). For a free open-source product where every user brings their own keys and runs their own books, a broken or half-implemented Settings page is the fastest way to lose trust and the first thing a self-hosting prospect inspects. The scope switcher is also the keystone of Ansar's "unified portfolio of businesses" vision; without the shell hook, the dashboard/transactions/reports work has nowhere to attach. Getting this epic right makes the whole org feel finished and operable on day one.

## Current state

Settings is a 2-level layout in apps/web/src/components/openbooks/SettingsScreen.tsx: a grouped desktop subnav (SETTINGS_NAV_GROUPS in apps/web/src/lib/openbooks/settings-sections.ts) plus a mobile drill-in list, routing to /settings/[section]. The shell base is decent but each *Section.tsx renders its own ad-hoc card layout with no shared page-header / empty-state / save-bar primitives, so spacing, save affordances, and entity-picker patterns differ across sections. Confirmed per-section gaps from reading the code: (1) BusinessesSection.tsx + convex/entities.ts (create:135, archive:191, unarchive:228, updateTaxSettings:255) have NO edit/rename/profile mutation — you can create and archive a business but never edit its name, type, or legal/tax fields from the Businesses card; legal fields only live in TaxSection. (2) CategoriesSection.tsx (rename:79/setArchived:104/createCategory:155 in convex/categories.ts) is a flat grouped list with no chart-of-accounts tree, no account-number display in plain mode, no move-between-groups, and no normal-side/balance affordance. (3) RulesSection.tsx is AND-only flat conditions with arrow reorder (no real drag, no OR/condition groups, no "test all rules at once" runner); convex/rules.ts preview:300 already supports single-rule preview. (4) NotificationsSection.tsx toggles persist via convex/settings.ts (notificationPreferences:37/setNotification:56/setNotificationEmail:85) but emailDeliveryConfigured is just Boolean(process.env.PLUNK_API_KEY) at settings.ts:50 — there is no per-channel digest cadence, no editable delivery email in the UI, and no link to the Plunk send path. (5) TeamSection.tsx + convex/team.ts (list:41, invite:99, revokeInvite:180) can invite and revoke invites but CANNOT change a member's role or remove an active member, and the UI never surfaces revokeInvite on pending rows. (6) TaxSection.tsx is solid but duplicates the legal-name/entity-type fields that should be co-owned with Businesses. (7) AuditSection.tsx filters CLIENT-SIDE over data.settings.audit.rows which comes from convex/moduleViews.ts overview:121 capped at .take(200) (moduleViews.ts:177) — so the "filterable audit log" silently misses anything older than the most recent 200 events and cannot paginate. (8) AppShell.tsx BusinessSwitcher (~line 994) is a flat per-entity dropdown labeled "Viewing books for" with NO "All businesses / Portfolio" option, and apps/web/src/lib/openbooks/active-entity.tsx ActiveEntityContextValue has no scope concept — this is the missing E5 hook. (9) DataSection.tsx is real (export + real-test reset) but uses hardcoded REPORT_ARGS dates (2026-01-01..2026-12-31) and points the danger zone at archive only. Existing coverage: tests/e2e/settings.spec.ts exercises nav + add-business + audit filter + rule reorder, so regressions are catchable.

## Definition of done (epic)

- [ ] All 11 settings sections render with a single shared layout system (page header + description + optional save-bar + consistent card spacing) and pass an axe/keyboard pass at 375px, 768px, and 1280px with no horizontal scroll and no overlapping controls.
- [ ] A business can be fully edited (name, type, legal name, entity type, EIN, home state) from one place without round-tripping between Businesses and Tax — currency is displayed read-only as USD (immutable, set at creation; no FX vocabulary); convex/entities.ts gains an updateProfile mutation with server-side authz + audit event and debits=credits/ledger untouched.
- [ ] Categories renders as a chart-of-accounts-friendly view: plain mode shows grouped categories with YTD; accountant mode shows account number + type + normal side; a category can be created, renamed, archived, and moved between Income/Expenses/Other, each writing an audit event.
- [ ] Rules supports ordered condition GROUPS (ALL-of within a group, with at least merchant/description/amount/direction conditions), live 90-day preview per rule, drag-or-arrow reorder that persists, and a 'test all active rules' summary; first-match-wins semantics are preserved and unit-tested.
- [ ] Notifications exposes an editable delivery email, per-channel toggles, and a weekly-digest cadence control; the UI honestly reflects whether Plunk is configured and links to Connections to set it up; toggles + email persist across reload.
- [ ] Team supports invite, revoke pending invite (surfaced on pending rows), change an active member's role, and remove an active member — each owner-gated server-side with an audit event; the last owner cannot be demoted or removed.
- [ ] Audit log is served by a real paginated, server-filtered query (actor kind, date range, free text) that is NOT capped at 200 rows, with a load-more control; client never filters the whole dataset in memory.
- [ ] The app shell exposes a scope switcher with 'All businesses' + each entity; selecting a scope updates active-entity context (new scope field) and persists; downstream screens can read scope via `useActiveScope()`. E5 consumes this contract for the All-mode read-side aggregation (decided: see decisions.md Q62); this epic delivers the switcher UI + context contract + persistence and a documented interface for E5. Day-one scope='all' screens: Dashboard, Reports, Transactions, Insights; per-entity-only settings sections fall back to the primary entity.
- [ ] pnpm -C apps/web typecheck && pnpm -C apps/web lint && pnpm -C apps/web build are green; tests/e2e/settings.spec.ts is extended to cover edit-business, category move, rule groups, team role-change/remove, audit pagination, and scope switch, and passes.
- [ ] No change touches convex/ledger.ts posting path or money math; every new mutation re-checks workspace authorization server-side.

## Tickets (10)

### E12-T1 — Shared Settings layout primitives (page header, save-bar, section shell, empty state)
`size: M` · `risk: low` · `depends on: —`

**Intent.** Eliminate the per-section ad-hoc layout drift by giving every settings section one consistent, on-brand, responsive frame so spacing, headings, save affordances, and empty states match across all 11 sections.

**Changes**

- Create apps/web/src/components/openbooks/settings/_shell.tsx exporting: SettingsSectionShell (wraps content, owns vertical rhythm), SettingsCard (the rounded-[14px] border bg-card shadow-xs surface used everywhere), SettingsSaveBar (sticky-on-mobile save row with Saving…/Saved/error states mirroring TaxSection.tsx save UX), SettingsEmptyState, and SettingsEntityPicker (the multi-business <Select> currently re-implemented in TaxSection.tsx:93-109 and AuditSection).
- Refactor TaxSection.tsx, NotificationsSection.tsx, DataSection.tsx card markup to consume SettingsCard + SettingsSaveBar without changing behavior (proves the primitives).
- Keep SETTINGS_SECTIONS / SETTINGS_NAV_GROUPS as the single source of truth (settings-sections.ts) — do not fork section lists.
- Add the one-line per-section description already in SettingsScreen.tsx SECTION_DESCRIPTIONS into the shell header so SectionBody stops rendering a bare <p>.

**Files:** `apps/web/src/components/openbooks/settings/_shell.tsx (new)`, `apps/web/src/components/openbooks/SettingsScreen.tsx`, `apps/web/src/components/openbooks/settings/TaxSection.tsx`, `apps/web/src/components/openbooks/settings/NotificationsSection.tsx`, `apps/web/src/components/openbooks/settings/DataSection.tsx`, `apps/web/src/lib/openbooks/settings-sections.ts`

**Definition of done**

- [ ] A single SettingsCard/SettingsSaveBar/SettingsEntityPicker is imported by at least Tax, Notifications, and Data sections.
- [ ] Tax/Notifications/Data render visually identical-or-better at 375/768/1280px with no horizontal scroll (screenshots).
- [ ] No section-level behavior regresses: tests/e2e/settings.spec.ts still green.
- [ ] typecheck + lint clean.

**Deliverables:** apps/web/src/components/openbooks/settings/_shell.tsx; Refactored Tax/Notifications/Data sections; Before/after screenshots at 3 widths

**Verify.** pnpm -C apps/web typecheck && pnpm -C apps/web lint && pnpm -C apps/web build; run tests/e2e/settings.spec.ts; capture /settings/tax + /settings/notifications + /settings/data at 375/768/1280 with the agent-browser skill.

### E12-T2 — Edit-a-business: entities.updateProfile mutation + merge legal/tax fields into the Businesses card
`size: M` · `risk: low` · `depends on: E12-T1`

**Intent.** Right now a business can be created and archived but never edited; legal/tax identity is stranded in TaxSection. Let the owner fully edit a business (name, type, legal name, entity type, EIN, home state) from the Businesses surface.

**Changes**

- Add convex/entities.ts updateProfile mutation: args entityId + optional { name, businessType, legalName, entityType, taxId, homeState }; reuse requireWorkspacePermission(...,'business.manage') exactly like archive:198; validate name length and businessType against businessTypeValidator; do NOT change currency after creation (currency is immutable per money rules) — surface it read-only; write an auditEvents row ('entity.updated') like create:172.
- Reuse the existing updateTaxSettings:255 for fiscal-year/basis so this mutation stays profile-only and the two don't collide.
- In BusinessesSection.tsx add an Edit action on each business card opening a dialog (mirror AddBusinessModal pattern, lines 149-241) pre-filled from entities.list rows (which already return legalName/entityType/taxId/homeState — entities.ts:114-117).
- Keep the archive/restore button; add the Edit button beside it; disable currency field with a 'set at creation' hint.

**Files:** `convex/entities.ts`, `apps/web/src/components/openbooks/settings/BusinessesSection.tsx`, `tests/e2e/settings.spec.ts`

**Definition of done**

- [ ] entities.updateProfile exists, is owner/business.manage gated server-side, writes an audit event, and rejects currency changes.
- [ ] Editing a business name in the dialog persists and the card + the AppShell BusinessSwitcher reflect the new name after reload.
- [ ] No ledger/account rows are mutated by an edit (only the entities doc).
- [ ] e2e: a new 'edit business' test renames a business and asserts the new name appears in the card and audit log.

**Deliverables:** entities.updateProfile mutation; Edit-business dialog in BusinessesSection.tsx; New e2e assertion in settings.spec.ts

**Verify.** npx convex dev (typegen) then pnpm -C apps/web typecheck; run settings.spec.ts edit-business case; manually edit a business and confirm rename in switcher + audit row via agent-browser.

### E12-T3 — Categories as a chart-of-accounts-friendly manager (move group, account-number + normal-side affordances)
`size: M` · `risk: med` · `depends on: E12-T1`

**Intent.** Make Categories read like a real, owner-friendly chart of accounts: grouped, with plain names by default and account number/type/normal-side in accountant mode, plus the ability to move a category between Income/Expenses/Other.

**Changes**

- Read convex/categories.ts list:21/rename:79/setArchived:104/createCategory:155 and the ledgerAccounts schema to confirm available fields (number, type, normalSide).
- Add a categories.moveGroup (or extend createCategory's grouping logic) mutation that reassigns a non-system category's group/number band safely — Income→4xxx, Expenses→6xxx, Other→6xxx as the UI already documents (CategoriesSection.tsx:210); reject moving system accounts; write an audit event.
- In CategoriesSection.tsx: keep accountant-mode toggle; in accountant mode also show normal side (debit/credit) next to number·type (line 130-135); add a per-row 'Move to…' control (Select) wired to moveGroup; keep YTD Amount.
- Guard: never expose archive/move/rename for cat.isSystem (already partly guarded at line 139).

**Files:** `apps/web/src/components/openbooks/settings/CategoriesSection.tsx`, `convex/categories.ts`, `convex/schema.ts (read ledgerAccounts only)`, `tests/e2e/settings.spec.ts`

**Definition of done**

- [ ] Accountant mode shows account number + type + normal side; plain mode hides numbers.
- [ ] A non-system category can be moved between groups and the change persists + writes an audit event; system accounts cannot be moved/archived.
- [ ] Creating, renaming, archiving still work (no regression to existing flows).
- [ ] e2e: a test creates a category, moves it to another group, and asserts it appears under the new group header.

**Deliverables:** categories.moveGroup mutation (or equivalent); Updated CategoriesSection.tsx with normal-side + move control; e2e category-move case

**Verify.** pnpm -C apps/web typecheck + lint; run settings.spec.ts category cases; manually toggle accountant mode and move a category via agent-browser; confirm no system account is mutable.

### E12-T4 — Rules builder: ordered condition GROUPS + 'test all active rules' runner
`size: L` · `risk: med` · `depends on: E12-T1`

**Intent.** Upgrade the rules editor from a single flat AND row to ordered, testable condition groups and add a one-click 'test all active rules against last 90 days' summary, so the owner can reason about and trust their automation.

**Changes**

- Read convex/rules.ts save:150/list:62/preview:300/reorder:219 and the rules schema to see how conditions are stored today (merchantContains/descriptionContains/amount/direction).
- Extend the rule data shape to support an ordered array of condition groups (each group = ALL-of; rule matches if ANY group matches — i.e. groups are OR'd, conditions within AND'd) using a widen-only schema change. A **read-time shim that migrates legacy flat rules → single-group form on read is sufficient long-term**; a one-time backfill is optional, not required (decided: see decisions.md Q64). Keep the existing flat fields readable for back-compat. Do NOT change first-match-wins across rules.
- Update RuleEditor (RulesSection.tsx:221) to render add/remove condition groups; reuse the existing per-condition inputs (description/merchant/amount-min/max/direction, lines 312-347).
- Extend rules.preview:300 (or add rules.previewAll) to evaluate the full condition-group logic and to support a 'test all active rules' call that returns per-rule match counts over 90 days; render a summary panel under the rule list.
- Add a unit test for the group-OR / condition-AND matcher to lock semantics.

**Files:** `apps/web/src/components/openbooks/settings/RulesSection.tsx`, `convex/rules.ts`, `convex/schema.ts (rules table)`, `convex/rules.test.ts (new or extend)`, `tests/e2e/settings.spec.ts`

**Definition of done**

- [ ] A rule can hold ≥2 condition groups; preview reflects OR-of-groups / AND-of-conditions correctly (unit test asserts a txn matching group B but not group A still matches).
- [ ] Existing flat rules still load and evaluate identically (back-compat verified by a unit test on a legacy-shaped rule).
- [ ] 'Test all active rules' shows per-rule 90-day match counts.
- [ ] Reorder still persists (existing e2e rule-reorder case stays green).
- [ ] No change to the cross-rule first-match-wins ordering or to ledger posting.

**Deliverables:** Widened rules schema + read-time migration shim; Grouped-condition RuleEditor; rules.previewAll (or extended preview); Matcher unit test

**Verify.** Run convex unit tests for rules matcher; pnpm -C apps/web typecheck+lint+build; run settings.spec.ts rule-reorder + a new grouped-rule case; manually build a 2-group rule and confirm preview counts via agent-browser.

### E12-T5 — Notifications: editable delivery email, weekly-digest cadence, honest Plunk state + deep-link to Connections
`size: M` · `risk: low` · `depends on: E12-T1`

**Intent.** Notifications today only toggles preferences and shows a static 'wired to Plunk when configured' chip; give it an editable delivery email, a digest cadence control, and an honest, actionable Plunk status that links to where you set the key.

**Changes**

- Read convex/settings.ts notificationPreferences:37 / setNotification:56 / setNotificationEmail:85 and confirm emailDeliveryConfigured derivation at settings.ts:50.
- In NotificationsSection.tsx add an inline editable delivery email field bound to settings.setNotificationEmail (currently the email is display-only at line 61); validate format client+server.
- Add a digest cadence preference (off / weekly / monthly) — extend the notification settings doc with an additive field and a setter; default **weekly** when 'digest' is on, with an opt-to-monthly (decided: see decisions.md Q47; the send job that honors this runs Monday 13:00 UTC in E9-T6).
- Replace the static chip with a real status row: if Plunk configured → 'Email delivery active via Plunk'; else → a button linking to /settings/connections to add the Plunk key. Plunk lives in the unified `credentials` table (`kind:"plunk"`, workspace-scoped), owned by E3 — do not duplicate E3's connection UI or build a parallel store, just deep-link and read the configured status (decided: see decisions.md Q14/Q65).
- This epic owns ONLY the preference + honest status + Connections deep-link. The actual weekly-digest SEND job (cron → `sendPlunkEmail`) is owned by E9-T6, not here (decided: see decisions.md Q65).
- Keep optimistic toggle overlay (lines 39-55).

**Files:** `apps/web/src/components/openbooks/settings/NotificationsSection.tsx`, `convex/settings.ts`, `convex/schema.ts (userSettings/notification fields — additive only)`, `tests/e2e/settings.spec.ts`

**Definition of done**

- [ ] Delivery email can be edited and persists across reload; invalid email is rejected server-side.
- [ ] Digest cadence persists and is reflected in notificationPreferences output.
- [ ] Plunk-not-configured state renders a link to /settings/connections (Plunk stored in the unified credentials table by E3); configured state renders the active label. The actual digest SEND job is E9-T6, not this epic (decided: see decisions.md Q14/Q65).
- [ ] Existing notification toggles still persist (no regression).

**Deliverables:** Editable email + cadence UI; Additive cadence field + setter in settings.ts/schema.ts; e2e notification email+cadence case

**Verify.** pnpm -C apps/web typecheck+lint; run settings.spec.ts notification case; manually edit the delivery email and toggle digest via agent-browser and reload to confirm persistence.

### E12-T6 — Team: role change, member removal, surfaced invite revoke — with last-owner guard
`size: M` · `risk: low` · `depends on: E12-T1`

**Intent.** Team can only invite and revoke invites; the owner cannot change a teammate's role or remove a member, and pending invites have no UI revoke. Make Team a real access-management surface.

**Changes**

- Read convex/team.ts list:41 / invite:99 / revokeInvite:180 and the workspaceMembers schema + role permission helpers (roleHasPermission, workspaceRoleLabel).
- Add convex/team.ts changeRole (memberId, newRole) and removeMember (memberId) mutations: owner/team.manage gated like invite:105; forbid demoting/removing the last owner; write audit events ('team.role_changed','team.removed'). removeMember **detaches the workspaceMembers row** and **preserves the removed user's historical audit/posting attributions** (immutable journal references — safe); the removed user loses all access including any pending invites (decided: see decisions.md Q67).
- In TeamSection.tsx: add a role Select on each active member row (gated by data.canManage), a remove action with a confirm dialog, and surface revokeInvite on pending rows (the mutation already exists at team.ts:180 but is unused in the UI).
- Keep the role legend (lines 77-79) accurate.

**Files:** `convex/team.ts`, `apps/web/src/components/openbooks/settings/TeamSection.tsx`, `convex/schema.ts (read workspaceMembers/invites)`, `tests/e2e/settings.spec.ts`

**Definition of done**

- [ ] A member's role can be changed and persists; an active member can be removed after confirm; a pending invite can be revoked from its row.
- [ ] The last owner cannot be demoted or removed (server rejects with a clear error).
- [ ] Every team mutation re-checks team.manage server-side and writes an audit event.
- [ ] e2e: invite a teammate, change their role, then remove them; assert the row disappears and an audit event is written.

**Deliverables:** team.changeRole + team.removeMember mutations; Role-change/remove/revoke UI in TeamSection.tsx; e2e team management case

**Verify.** npx convex typegen; pnpm -C apps/web typecheck+lint; run settings.spec.ts team case; manually change a role + remove a member via agent-browser and confirm audit rows; attempt to remove the owner and confirm it is blocked.

### E12-T7 — Audit log: real paginated, server-filtered query (drop the 200-row in-memory cap)
`size: M` · `risk: med` · `depends on: E12-T1`

**Intent.** The audit log silently shows only the most recent 200 events and filters them in the browser, so older actions are invisible and filters lie. Replace it with a real server-side filtered, paginated query.

**Changes**

- Read convex/moduleViews.ts overview:121 and the .take(200) at moduleViews.ts:177 that feeds AuditSection's data.settings.audit.rows.
- Add a dedicated convex/audit.ts (or extend moduleViews) query: list({ entityId?, workspaceId, actorKind?, sinceMs?, untilMs?, text?, cursor? }) using the auditEvents by_workspace index (order desc) with Convex pagination (paginationOptts) and server-side filtering on actor/date; reuse auditActorLabel (moduleViews.ts:77).
- Rewrite AuditSection.tsx to call the new paginated query with a 'Load more' control instead of useMemo client filtering over all rows (current lines 40-51); keep the same filter controls (text/actor/since) but pass them as args.
- Preserve actor pill styling (ACTOR_STYLE, lines 23-28) and the responsive grid layout.
- **No retention cap for v1** — auditEvents grows unbounded; the paginated server-filtered query is the only constraint (decided: see decisions.md Q66). A workspace-level audit export belongs in **DataSection**, not here (decided: see decisions.md Q66).

**Files:** `convex/audit.ts (new) or convex/moduleViews.ts`, `apps/web/src/components/openbooks/settings/AuditSection.tsx`, `tests/e2e/settings.spec.ts`

**Definition of done**

- [ ] Audit query is paginated (returns a cursor) and filters by actor/date/text on the SERVER; it is not capped at 200.
- [ ] 'Load more' appends older events; an event older than the most recent 200 is reachable.
- [ ] The existing audit-filter e2e (settings.spec.ts:149-152) still finds a freshly-created business event.
- [ ] No N+1 explosion: query stays within Convex read limits for a workspace with thousands of events (spot-check).

**Deliverables:** Paginated audit query; Rewritten AuditSection.tsx with load-more; Updated/extended e2e audit case

**Verify.** pnpm -C apps/web typecheck+lint; run settings.spec.ts audit case; seed >200 audit events (or use real-test data) and confirm load-more reaches an old event; confirm server-side actor filter returns only that actor.

### E12-T8 — App-shell scope switcher: 'All businesses' + per-entity, with active-entity context contract for E5
`size: L` · `risk: med` · `depends on: E12-T1`

**Intent.** Replace the disliked flat business dropdown with a scope switcher (All businesses / Zikra / Z360) in the shell and extend the active-entity context with a scope concept, delivering the keystone hook the unified-portfolio sprint (E5) attaches to.

**Changes**

- Read AppShell.tsx BusinessSwitcher (~line 994-1041) and apps/web/src/lib/openbooks/active-entity.tsx ActiveEntityContextValue (no scope today).
- Extend active-entity.tsx: add scope: { kind: 'all' } | { kind: 'entity', id } to ActiveEntity/context, a selectScope setter, and persist the choice (extend the existing ob:active-entity-id localStorage usage; add an 'all' sentinel). Keep selectEntity working for back-compat.
- Rework BusinessSwitcher into a ScopeSwitcher: first item 'All businesses' (portfolio), then each entity; show a small portfolio glyph for All; data-testid='scope-switcher' with stable option testids.
- Do NOT implement the cross-entity data aggregation here — **E5 consumes the `useActiveScope()` contract for the All-mode read path** (decided: see decisions.md Q62). Export a documented TypeScript interface (the scope shape + a useActiveScope() hook) and add a short comment block in active-entity.tsx describing the contract E5 reads. Day-one scope='all' screens are Dashboard, Reports, Transactions, and Insights (decided: see decisions.md Q62).
- Ensure the entity-scoped settings sections (Categories/Rules use moduleEntityId in SettingsScreen.tsx:81) degrade sensibly when scope='all': **fall back to the primary entity with a hint** (e.g. "Editing categories for Zikra — switch business to edit Z360"), since those sections are inherently per-entity (decided: see decisions.md Q63).

**Files:** `apps/web/src/components/openbooks/AppShell.tsx`, `apps/web/src/lib/openbooks/active-entity.tsx`, `apps/web/src/components/openbooks/SettingsScreen.tsx`, `tests/e2e/settings.spec.ts`

**Definition of done**

- [ ] The shell shows a scope switcher with 'All businesses' + every entity; selecting a scope persists across reload.
- [ ] active-entity context exposes scope + selectScope + useActiveScope() with a documented interface comment for E5.
- [ ] Per-entity settings sections (Categories/Rules) fall back to the primary entity with a hint when scope='all' (decided: see decisions.md Q63).
- [ ] e2e: switch to 'All businesses', reload, assert the switcher still shows All; switch to a specific entity and assert per-entity sections load.
- [ ] No downstream screen crashes when scope='all' (smoke nav across dashboard/transactions/settings).

**Deliverables:** ScopeSwitcher in AppShell.tsx; Extended active-entity.tsx context + useActiveScope() + E5 contract comment; e2e scope-switch case

**Verify.** pnpm -C apps/web typecheck+lint+build; run settings.spec.ts scope case; manually switch All↔entity and reload via agent-browser; smoke-navigate the main routes with scope='all' to confirm no crash.

### E12-T9 — App-shell responsiveness + nav polish (sidebar, header, mobile sheet, settings subnav)
`size: M` · `risk: low` · `depends on: E12-T1, E12-T8`

**Intent.** Tighten the surrounding shell so the redesigned settings sections live in a polished, fully responsive frame: collapsible sidebar, mobile nav sheet, sticky header with page actions, and a settings subnav that behaves at every width.

**Changes**

- Read AppShell.tsx header (line 512+), mobile sidebar Sheet (lines 455-522), bottom mobile nav (line 649), ExpandedSidebar/CollapsedSidebar, and SettingsScreen.tsx desktop subnav (lines 156-200) + mobile drill (lines 114-150).
- Audit and fix any overflow/overlap at 375/768/1024/1280: the sticky settings subnav top offset (top-[72px], line 159) vs the 56px shell header; the page-actions slot (#ob-topbar-page-actions, line 548) not colliding with the scope switcher from T8; the mobile bottom nav not covering section save bars.
- Ensure focus-visible rings, aria-current, and keyboard order are correct on the settings subnav and the sidebar (some aria-current already present, SettingsScreen.tsx:176).
- Verify the mobile settings drill-in back link and section list match the shared shell from T1.
- Do not change routing or section identity — presentation/responsiveness only.

**Files:** `apps/web/src/components/openbooks/AppShell.tsx`, `apps/web/src/components/openbooks/SettingsScreen.tsx`, `tests/e2e/settings.spec.ts`

**Definition of done**

- [ ] No horizontal scroll and no overlapping/clipped controls on /settings and the main app routes at 375/768/1024/1280px (screenshots at each).
- [ ] Settings subnav stays correctly pinned under the header and scrolls internally on long sections; mobile drill-in works and matches the shared shell.
- [ ] Keyboard: tab order reaches subnav items and sidebar links; aria-current marks the active section/route; focus rings visible.
- [ ] No regressions in settings.spec.ts nav coverage.

**Deliverables:** Responsiveness/nav fixes in AppShell.tsx + SettingsScreen.tsx; Screenshot matrix (4 widths × /settings + 1 app route); Optional Playwright viewport assertions

**Verify.** pnpm -C apps/web build; run settings.spec.ts; capture the screenshot matrix with the agent-browser skill at 4 widths; run a keyboard-only pass on /settings.

### E12-T10 — Settings e2e + a11y regression pack covering every section's real actions
`size: M` · `risk: low` · `depends on: E12-T2, E12-T3, E12-T4, E12-T5, E12-T6, E12-T7, E12-T8`

**Intent.** Lock in the now-real Settings surface with end-to-end coverage so future epics can't silently re-break edit-business, category move, rule groups, team management, audit pagination, or the scope switch.

**Changes**

- Extend tests/e2e/settings.spec.ts (which already covers nav/add-business/audit-filter/rule-reorder) with cases: edit a business name (T2), move a category between groups (T3), build a 2-group rule + see preview (T4), edit notification email + cadence (T5), change a member role + remove a member + revoke an invite (T6), audit load-more reaches an old event (T7), scope switch persists across reload (T8).
- Add a lightweight a11y assertion (axe or role/landmark checks) on /settings at one desktop + one mobile viewport.
- Reuse existing helpers (gotoApp, visibleByTestId, EVIDENCE screenshots) and the stable data-testids added in T2–T8.
- Keep the suite resilient to seeded vs real data (the existing spec already guards with timeouts).

**Files:** `tests/e2e/settings.spec.ts`, `apps/web/src/components/openbooks/settings/* (testids only, no behavior change)`

**Definition of done**

- [ ] New e2e cases exist for all of T2–T8 and pass locally against a seeded workspace.
- [ ] An a11y check on /settings passes (no critical violations) at desktop + mobile widths.
- [ ] The full settings.spec.ts suite is green in CI-equivalent run.
- [ ] Each new case captures an evidence screenshot under the existing EVIDENCE dir.

**Deliverables:** Extended tests/e2e/settings.spec.ts; Evidence screenshots per new case; a11y assertion on /settings

**Verify.** Run the full tests/e2e/settings.spec.ts suite headed and headless; confirm all new cases pass and screenshots are written; run the axe/a11y assertion and confirm zero critical violations.

## Decisions applied

All prior open questions for this epic are RESOLVED in `../decisions.md` (canonical contract: `../rebuild/ANSAR-DECISIONS.md`). Applied here:

- **Scope-switcher boundary (Q62):** E12 ships the switcher UI + `useActiveScope()` context + persistence; E5 consumes it for the All-mode read path. Day-one scope='all' screens: Dashboard, Reports, Transactions, Insights. E12-T8 is upstream of E5-T2/T3, E6-T7, E8-T4.
- **Per-entity sections under 'All' (Q63):** Categories/Rules fall back to the primary entity with a hint — not a forced business pick.
- **Rules condition-groups migration (Q64):** read-time shim (legacy flat → single-group on read) is sufficient long-term; one-time backfill is optional.
- **Plunk send ownership (Q14/Q65):** E12 owns the preference + honest status + Connections deep-link; Plunk lives in the unified `credentials` table (E3-owned); the weekly-digest SEND job is E9-T6.
- **Audit retention (Q66):** no retention cap for v1 (paginated server-filtered query only); workspace-level audit export lives in DataSection.
- **Member removal semantics (Q67):** detach the workspaceMembers row, preserve immutable audit/posting attributions, remove all access including pending invites; last-owner guard enforced.

No items in this epic still require Ansar. (USD-only ledger, unified credential storage, live connectors local, and the required Stripe webhook are enforced in E3/E1/E5; this epic only deep-links to those surfaces and does not own them.)
