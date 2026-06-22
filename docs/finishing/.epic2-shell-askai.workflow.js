export const meta = {
  name: 'openbooks-epic2-shell-askai',
  description: 'Epic 2: declutter the app shell/header/nav and rebuild Ask AI as a 4-mode AskAIWidget on AI Elements, preserving the Convex agent streaming contract. Then adversarially critique (streaming/labels/responsive) and fix.',
  phases: [
    { title: 'Build', detail: 'one shell+AI agent rebuilds the chrome and the assistant' },
    { title: 'Critique', detail: 'parallel critics: streaming-contract, no-provider-labels+design, responsive' },
    { title: 'Fix', detail: 'apply confirmed fixes, re-green typecheck/lint' },
  ],
}

const REPO = '/Volumes/SSD/OpenBooks'
const WEB = 'apps/web'
const REPORT = 'docs/finishing/frontend-redesign-research-report.md'

const DS = `OpenBooks DESIGN SYSTEM (HARD rules): white ledger surfaces; Geist + Geist Mono money/dates (money-figures, tabular-nums, letter-spacing 0); ONE brand green #2ca01c; AI affordances GREEN (text-primary/--ai/--ai-surface, lucide Sparkles) NEVER purple/violet/gradient; hairline borders; quiet AI. Use SEMANTIC TOKENS not raw hex/Tailwind (the brand-green Ask-AI hexes #bbe0a9/#f1f8ee/#1d6b12/#63b347 at AppShell.tsx:450-451,458 and the link chip #bbe0a9/#f1f8ee/#1d6b12 at OpenBooksAIChat.tsx:185 must route through bg-ai-surface/text-ai/border-primary etc — tokens added in Epic 1: --ai #1d6b12, --ai-surface #f1f8ee, --ob-green-50..900). BANNED: gradients, glassmorphism, emoji, unicode-as-icon. shadcn/ui primitives before raw controls. Mobile is a real responsive surface.`

const SKILLS = `BEFORE you build, READ and follow:
- shadcn rules: ${REPO}/.claude/skills/shadcn/SKILL.md + rules/styling.md + rules/composition.md (className=layout only; no space-x/space-y→gap; Dialog/Sheet/Drawer need a Title; items inside their Group; no manual z-index on overlays; Badge/Skeleton/Empty over custom).
- frontend-design doctrine: ${REPO}/.claude/skills/frontend-design/SKILL.md (write UI copy from the user's side; quiet, intentional, no templated defaults).
- AI Elements component APIs: read the relevant files under ${REPO}/${WEB}/src/components/ai-elements/ (installed in Epic 2 setup) AND their docs at /Users/ansar/.claude/skills/ai-elements/references/ (conversation.md, message.md, response.md, prompt-input.md, suggestion.md, sources.md, tool.md, reasoning.md, actions.md). Use these primitives — do NOT hand-roll message bubbles/markdown.`

const AI_ELEMENTS = `AI ELEMENTS COMPONENTS (under ${WEB}/src/components/ai-elements/ — CONFIRMED exports; import exactly these, read a file if unsure):
- conversation.tsx → Conversation, ConversationContent, ConversationScrollButton, ConversationEmptyState (built-in stick-to-bottom; replaces the manual scroll list/effect)
- message.tsx → Message, MessageContent, MessageResponse (THE streamed-markdown renderer wrapping streamdown — USE THIS where you'd expect "Response"), MessageActions, MessageAction, MessageToolbar (replaces MessageBubble + the hand-rolled MarkdownBlocks/InlineMarkdown)
- prompt-input.tsx → PromptInput, PromptInputBody, PromptInputTextarea, PromptInputSubmit, PromptInputTools, PromptInputButton, PromptInputFooter, PromptInputHeader (+ hooks usePromptInputController/usePromptInputAttachments) (replaces the hand-built form+Input+send composer)
- suggestion.tsx → Suggestions, Suggestion (purpose-built WRAPPING chip row — replaces the overflow-x-auto chip row)
- sources.tsx → Sources, SourcesTrigger, SourcesContent, Source (NEW — cite the journal lines/reports an answer drew from)
- tool.tsx → Tool, ToolHeader, ToolContent, ToolInput, ToolOutput (replaces ToolPartCard's native <details>)
- reasoning.tsx → Reasoning, ReasoningTrigger, ReasoningContent (optional quiet 'thinking' disclosure)
- (transitive, used internally: shimmer.tsx → Shimmer; code-block.tsx → CodeBlock)
CRITICAL: there is NO standalone "Response" or "Actions" component in this registry version. Use MessageResponse for streamed markdown, and MessageActions/MessageAction for copy/retry/open-source affordances. Deps streamdown + ai are installed. A root package.json pnpm.overrides block pins react/react-dom/@types to single versions — DO NOT touch it. The propose→confirm ProposalCard stays conceptually but is re-housed as a first-class Tool/MessageActions render (never auto-posts).`

const FOUNDATION = `FOUNDATION IN PLACE:
- Epic 1 workbench primitives exist under ${WEB}/src/components/openbooks/workbench/ (barrel: @/components/openbooks/workbench) incl. CommandPalette stays separate. Tokens --ai/--ai-surface/--ob-green-* and shadcn popover/scroll-area/collapsible/command/sheet/drawer already present.
- Epic 2 setup added to ${WEB}: deps streamdown + ai; AI Elements components under ${WEB}/src/components/ai-elements/.
${AI_ELEMENTS}`

const STREAMING = `LOAD-BEARING CONSTRAINT — DO NOT BREAK THE BACKEND STREAMING CONTRACT (report Section 7.4):
- The chat does NOT use the AI SDK transport. It streams via @convex-dev/agent/react. KEEP every one of these exactly:
  useUIMessages(api.aiThreads.listThreadMessages, { threadId }, { initialNumItems, stream: true }) — message source (UIMessage[] with parts[]);
  useSmoothText(text, { startStreaming: streaming, charsPerSec: 220 }) — token smoothing, feed into <MessageResponse>;
  useMutation(api.aiThreads.sendMessage).withOptimisticUpdate(optimisticallySendMessage(api.aiThreads.listThreadMessages)) — send path behind PromptInput submit;
  api.aiThreads.createThread/deleteThread/listMine — thread lifecycle; api.proposals.listProposals/confirmProposal/dismissProposal — proposals; message.status === 'streaming'|'pending' — loader/streaming flag.
- ADAPT ONLY THE VIEW: map UIMessage parts → AI Elements: part.type==='text' → <MessageResponse>; part.type.startsWith('tool-') → <Tool>; proposal rows → the propose→confirm confirmation render (a first-class Tool/MessageActions card that NEVER auto-posts — keep 'Nothing has been posted yet' copy + confirmProposal/dismissProposal wiring). Do NOT add a second streaming/provider path. Do NOT edit convex/ or api.aiThreads/api.proposals.`

const TASKS = `BUILD TASKS (read ${REPORT} Sections 6.12, 7 (all), 8.1, 8.6 for the authoritative spec; read the current files before editing):

A) Ask AI rebuilt as ONE component — create ${WEB}/src/components/openbooks/AskAIWidget.tsx taking mode: 'collapsed'|'docked'|'page'|'mobile'. It composes the AI Elements primitives over the PRESERVED Convex hooks (see STREAMING). Modes:
   - collapsed: a Sparkles icon trigger (add to CollapsedRail in AppShell so AI is reachable when the sidebar is iconified).
   - docked: right-side panel; make it an OVERLAY (scrim) or resizable (drag handle, min ~360/max ~560) so dense Reports/Transactions tables are not crushed; available from md up (not only lg). Today it is a width-stealing flex sibling w-[380px] (AppShell.tsx:467-469) next to main (max-w-[1200px] :463) — fix the squeeze.
   - page: the /ask-ai full page — drop the redundant outer PageHeader (AskAIScreen.tsx) and let the widget own its chrome; real conversation switcher (Command/Combobox, not <select>), optional Sources/artifacts canvas.
   - mobile: a shadcn Sheet (side bottom) with a compact single-row header whose thread switcher IS reachable (today the thread <select>/new-chat/maximize are .sm-gated and vanish on mobile).
   ONE thread switcher (Command/Combobox) across ALL modes. Suggestion chips WRAP (never overflow-x scroll). Replace the hand-rolled MarkdownBlocks/InlineMarkdown/ToolPartCard<details>/raw<select> with AI Elements + shadcn equivalents. Keep the existing OpenBooksAIChat.tsx working until AskAIWidget replaces it, then switch AppShell/AskAIScreen to render AskAIWidget and delete the dead code paths it subsumes.

B) Remove ALL provider/debug labels (report 7.5) — there are FOUR user-facing spots: the 'Bedrock active'/'Degraded mode' Badge at OpenBooksAIChat.tsx:758; AskAIScreen.tsx:45; the Settings card at ModuleScreens.tsx:1568; and frontendAiStatus in ${WEB}/src/lib/openbooks/ai.ts:143 whose label is literally 'Bedrock provider is configured' (shown as the status-card title when no active thread, OpenBooksAIChat.tsx:804) plus the ':807' copy that names 'Convex Agent'. Fix: ACTIVE state shows NO badge; DEGRADED state shows one quiet capability chip ('AI is off — rules and reports still work'), never a provider name. Relabel ai.ts frontendAiStatus to provider-agnostic ('AI is on'/'AI is off') and drop 'Convex Agent'/'Bedrock' from copy. After building, GREP the app for user-facing 'Bedrock'/'Convex Agent'/provider strings and confirm none render in the chat/shell/settings UI (Settings MAY keep a technical provider/model field, but the conversational surface must not).

C) Shell/header declutter (AppShell.tsx, AppScreen.tsx, ${WEB}/src/lib/openbooks/content.ts):
   - Header (AppShell.tsx:419-461): remove the static 'Jun 2026' month chip (:444-446). Turn the big global-search pill (:430-441, md:flex only) into a compact search affordance reachable at ALL widths (icon button that opens the CommandPalette — fixes mobile having no ⌘K path, gate G10). Make Ask AI an icon-only Sparkles button (tooltip + ⌘J), not a text pill; route its brand-green hexes (:450-451,458) through --ai/--ai-surface tokens.
   - Move Settings OUT of the primary nav list into a quiet footer/utility cluster (gear icon) alongside Sync + Profile (content.ts settingsRoute + the sidebar footer in ExpandedSidebar/CollapsedRail). Keep EntitySwitcher as the single place the entity name appears.
   - Remove the body 'Demo entity' chip + entity-eyebrow duplication injected at AppScreen.tsx:50-54 (PageHeader eyebrow={activeEntity.name} + Demo-entity CategoryChip). Replace with a subtle isDemo indicator near the workspace name in the sidebar (a small neutral chip/dot, D6) — NOT a body chip.
   - Replace the '::' pending-prompt nonce (AppShell.tsx:226 appends '::'+Date.now(), stripped at OpenBooksAIChat.tsx:644) with a structured { prompt, nonce } payload so prompts containing '::' aren't truncated.
   - Collapse the duplicated SUGGESTIONS (OpenBooksAIChat.tsx:33-39 vs ai.ts:121-127 aiSuggestedPrompts) to the single ai.ts export.
   - Mobile: keep the bottom nav; add a Search action reachable on mobile (opens palette).

D) Mount <Toaster /> from ${WEB}/src/components/ui/sonner once in the app shell so toasts work app-wide.

E) Do NOT redesign the page BODIES (Dashboard/Inbox/Transactions/Income/Expenses/Bills/Contacts/Payroll/Reports/Settings) — those are Epics 3-6. You only touch the shell frame, the header, nav config, the AI chat/widget, AskAIScreen, the ai-elements layer, ai.ts, CommandPalette, AppScreen header clutter, and the ModuleScreens.tsx:1568 / AskAIScreen.tsx:45 provider-badge removals. Keep money integer minor units; keep 'AI proposes, ledger posts' (no client posting).`

const RULES = `RULES: Allowed to edit: ${WEB}/src/components/openbooks/AppShell.tsx, OpenBooksAIChat.tsx (or supersede it via AskAIWidget.tsx), AskAIScreen.tsx, AppScreen.tsx (header clutter only), CommandPalette.tsx, ${WEB}/src/lib/openbooks/ai.ts, ${WEB}/src/lib/openbooks/content.ts, ${WEB}/src/app/ask-ai/page.tsx, ${WEB}/src/app/layout.tsx (Toaster mount), and the targeted provider-badge line at ModuleScreens.tsx:1568. New file: AskAIWidget.tsx. Do NOT edit convex/, api.aiThreads/api.proposals, the Epic 1 workbench primitives, globals.css, or any page body beyond the listed header-clutter removals. Before returning, RUN \`pnpm --filter @openbooks/web typecheck\` and \`pnpm --filter @openbooks/web lint\` from ${REPO} and ensure BOTH are green; and grep to confirm no user-facing 'Bedrock'/'Convex Agent' provider label renders in the chat/shell.`

const MANIFEST_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['filesChanged', 'whatChanged', 'streamingPreserved', 'providerLabelsRemoved', 'typecheck', 'lint', 'risks'],
  properties: {
    filesChanged: { type: 'array', items: { type: 'string' } },
    whatChanged: { type: 'string', description: 'Concise summary of shell + AskAIWidget changes and the 4 modes.' },
    streamingPreserved: { type: 'string', description: 'Exactly how the Convex hooks (useUIMessages/useSmoothText/optimisticallySendMessage/api.aiThreads/api.proposals) were kept; confirm no second streaming path.' },
    providerLabelsRemoved: { type: 'string', description: 'The 4 spots fixed + grep result proving no user-facing Bedrock/Convex-Agent label remains.' },
    typecheck: { type: 'string', enum: ['green', 'failing'] },
    lint: { type: 'string', enum: ['green', 'failing'] },
    risks: { type: 'array', items: { type: 'string' } },
  },
}

const CRITIQUE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['lens', 'findings', 'verdict'],
  properties: {
    lens: { type: 'string' },
    findings: { type: 'array', items: {
      type: 'object', additionalProperties: false,
      required: ['severity', 'file', 'issue', 'fix'],
      properties: {
        severity: { type: 'string', enum: ['blocker', 'high', 'medium', 'low'] },
        file: { type: 'string' }, issue: { type: 'string' }, fix: { type: 'string' },
      },
    } },
    verdict: { type: 'string', enum: ['pass', 'needs-fixes'] },
  },
}

phase('Build')
const build = await agent(
  `You are the single-owner BUILD agent for Epic 2 (shell + Ask AI) of the OpenBooks redesign. This is foundation chrome every page inherits — be careful and coherent.\n\n${SKILLS}\n\n${DS}\n\n${FOUNDATION}\n\n${STREAMING}\n\n${TASKS}\n\n${RULES}\n\nReturn the manifest.`,
  { label: 'epic2:build', phase: 'Build', schema: MANIFEST_SCHEMA },
)
log(`Build: typecheck=${build?.typecheck} lint=${build?.lint}; files=${build?.filesChanged?.length}`)

phase('Critique')
const CTX = `Epic 2 build done. Files changed:\n${JSON.stringify(build?.filesChanged ?? [], null, 1)}\nSpec: ${REPORT} Sections 6.12/7/8.1/8.6.\n${DS}`
const critiques = await parallel([
  () => agent(
    `${CTX}\n\nLENS: STREAMING + CORRECTNESS. Verify the Convex agent contract is intact (report 7.4): useUIMessages/useSmoothText/optimisticallySendMessage/api.aiThreads.*/api.proposals.* unchanged; UIMessage parts mapped to AI Elements (text→MessageResponse, tool-*→Tool); propose→confirm card never auto-posts (still calls confirmProposal/dismissProposal, keeps 'nothing posted yet'); no second streaming/provider path; message.status drives the loader. Confirm convex/ and api.aiThreads/api.proposals were NOT edited. Run \`pnpm --filter @openbooks/web typecheck\` yourself. Cite path:line + fix. Read-only except typecheck.`,
    { label: 'crit:streaming', phase: 'Critique', schema: CRITIQUE_SCHEMA }),
  () => agent(
    `${CTX}\n\nLENS: DESIGN-SYSTEM + NO PROVIDER LABELS. GREP the whole ${WEB}/src for user-facing 'Bedrock', 'Convex Agent', provider/model debug strings and confirm NONE render in the chat/shell (Settings may keep a technical field). Confirm active-state shows no badge; degraded shows one quiet capability chip. Check the AI affordances are brand GREEN via --ai/--ai-surface tokens (no raw #bbe0a9/#f1f8ee/#1d6b12/#63b347 hexes, no purple/gradient/emoji), Sparkles icon, quiet. Confirm the 'Jun 2026' month chip and the body 'Demo entity' chip are gone and Settings moved to the footer/utility cluster. Cite path:line + fix. Read-only.`,
    { label: 'crit:labels', phase: 'Critique', schema: CRITIQUE_SCHEMA }),
  () => agent(
    `${CTX}\n\nLENS: RESPONSIVE (report 8.1/8.6). Verify AskAIWidget works in all 4 modes without breaking the page: collapsed Sparkles trigger reachable (incl. iconified rail), docked panel does NOT crush dense tables (overlay/resizable, available from md), page mode has a reachable thread switcher, mobile Sheet exposes the thread switcher (not .sm-gated away) and the composer/suggestions wrap. Confirm a search affordance is reachable at 390 (mobile ⌘K path). Flag any element causing horizontal overflow or text overlap at 390/768/1306. Cite path:line + fix. Read-only.`,
    { label: 'crit:responsive', phase: 'Critique', schema: CRITIQUE_SCHEMA }),
])
const findings = critiques.filter(Boolean).flatMap((c) => (c.findings ?? []).map((f) => ({ ...f, lens: c.lens })))
const blockers = findings.filter((f) => f.severity === 'blocker' || f.severity === 'high')
log(`Critique: ${findings.length} findings (${blockers.length} blocker/high); verdicts ${critiques.filter(Boolean).map((c) => c.lens + '=' + c.verdict).join(', ')}`)

phase('Fix')
let fix = null
if (findings.length) {
  fix = await agent(
    `You are the FIX agent for Epic 2. Apply EVERY blocker/high finding and any clearly-correct medium/low one, staying within the Epic 2 allowed files (shell/header/nav/AskAIWidget/ai-elements/ai.ts/content.ts/ask-ai page/layout Toaster + the ModuleScreens:1568 badge). Do NOT touch convex/, api.aiThreads/proposals, Epic 1 primitives, globals.css, or page bodies. The Convex streaming contract MUST stay intact.\n\n${DS}\n\nFINDINGS:\n${JSON.stringify(findings, null, 1)}\n\nThen RUN \`pnpm --filter @openbooks/web typecheck\` and \`pnpm --filter @openbooks/web lint\` from ${REPO} until BOTH are green. Return the manifest.`,
    { label: 'epic2:fix', phase: 'Fix', schema: MANIFEST_SCHEMA },
  )
  log(`Fix: typecheck=${fix?.typecheck} lint=${fix?.lint}`)
}

return { build, critiques: critiques.filter(Boolean), findings, fix }
