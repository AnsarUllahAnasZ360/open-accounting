"use client";

import {
  optimisticallySendMessage,
  useSmoothText,
  useUIMessages,
  type UIMessage,
} from "@convex-dev/agent/react";
import { useMutation, useQuery } from "convex/react";
import {
  Check,
  ChevronsUpDown,
  Loader2,
  Maximize2,
  MessageSquarePlus,
  MoreHorizontal,
  PanelRightClose,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from "react";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputButton,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import {
  Source,
  Sources,
  SourcesContent,
  SourcesTrigger,
} from "@/components/ai-elements/sources";
import { Suggestion } from "@/components/ai-elements/suggestion";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { aiSuggestedPrompts, type AiStatus } from "@/lib/openbooks/ai";
import type { ReportPack } from "@/lib/openbooks/reports-export";
import { cn } from "@/lib/utils";

export type AskAIMode = "collapsed" | "docked" | "page" | "mobile";

type ThreadSummary = {
  threadId: string;
  title: string;
  lastActiveAt: number;
};

type ProposalKind = "categorize" | "rule" | "invoiceDraft" | "bill" | "journalEntry";
type ProposalStatus = "proposed" | "confirmed" | "dismissed" | "expired";

type ProposalRow = {
  id: Id<"proposals">;
  kind: ProposalKind;
  summary: string;
  status: ProposalStatus;
  messageId: string | null;
  payload: unknown;
  resultSummary: string | null;
  createdAt: number;
  decidedAt: number | null;
};

type ProposalActionState = {
  status: "confirming" | "dismissing" | "done" | "error";
  message?: string;
};

type MessagePart = UIMessage["parts"][number] & Record<string, unknown>;

type MessageSource = { key: string; title: string; href?: string };

function sentenceCase(value: string) {
  return value
    .replace(/^tool-/, "")
    .replace(/([A-Z])/g, " $1")
    .replace(/[-_]/g, " ")
    .trim()
    .replace(/^./, (char) => char.toUpperCase());
}

function formatThreadTime(value: number) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

function proposalKindLabel(kind: ProposalKind) {
  switch (kind) {
    case "categorize":
      return "Categorization proposal";
    case "rule":
      return "Rule proposal";
    case "invoiceDraft":
      return "Draft invoice proposal";
    case "bill":
      return "Bill posting proposal";
    case "journalEntry":
      return "Journal entry proposal";
  }
}

function proposalActionLabel(kind: ProposalKind) {
  switch (kind) {
    case "categorize":
      return "Confirm categorization";
    case "rule":
      return "Create rule";
    case "invoiceDraft":
      return "Save invoice draft";
    case "bill":
      return "Add bill";
    case "journalEntry":
      return "Post journal entry";
  }
}

function payloadFacts(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  return Object.entries(payload as Record<string, unknown>)
    .filter(([, value]) => typeof value !== "object")
    .slice(0, 6)
    .map(([key, value]) => ({ label: sentenceCase(key), value: String(value) }));
}

function partText(part: MessagePart) {
  return typeof part.text === "string" ? part.text : "";
}

function textForMessage(message: UIMessage) {
  const partTextValue = message.parts
    .filter((part): part is MessagePart => part.type === "text")
    .map(partText)
    .filter(Boolean)
    .join("\n\n");
  return partTextValue || message.text || "";
}

function reasoningForMessage(message: UIMessage) {
  return message.parts
    .filter((part): part is MessagePart => part.type === "reasoning")
    .map(partText)
    .filter(Boolean)
    .join("\n\n");
}

function toolPartsForMessage(message: UIMessage) {
  return message.parts.filter((part): part is MessagePart => part.type.startsWith("tool-"));
}

// The read-only data tools the agent can call. We surface these as plain-English
// "sources" so the owner can see what the answer was grounded in — the honest
// equivalent of a web chatbot's citation list, drawn from their own books.
const READ_TOOL_SOURCE_LABELS: Record<string, string> = {
  getReport: "Reports",
  getBalances: "Account balances",
  queryTransactions: "Transactions",
  searchContacts: "Contacts",
  getPayrollRuns: "Payroll",
};

function humanizeReport(value: string) {
  switch (value) {
    case "profitAndLoss":
      return "Profit & Loss";
    case "balanceSheet":
      return "Balance sheet";
    case "cashFlow":
      return "Cash flow";
    case "arAging":
      return "A/R aging";
    case "apAging":
      return "A/P aging";
    case "trialBalance":
      return "Trial balance";
    default:
      return sentenceCase(value);
  }
}

// Collect citation-style sources for an assistant message: any model-provided
// source-url / source-document parts, plus a friendly label per read-tool the
// answer leaned on. Deduped by title so repeated reads collapse to one row.
function sourcesForMessage(message: UIMessage): MessageSource[] {
  const out: MessageSource[] = [];
  const seen = new Set<string>();
  const push = (title: string, href?: string) => {
    const dedupeKey = `${title}::${href ?? ""}`;
    if (!title || seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    out.push({ key: `${message.id}-${out.length}`, title, href });
  };

  for (const rawPart of message.parts) {
    const part = rawPart as MessagePart;
    if (part.type === "source-url") {
      const href = typeof part.url === "string" ? part.url : undefined;
      push(typeof part.title === "string" && part.title ? part.title : href ?? "Source", href);
    } else if (part.type === "source-document") {
      const title =
        (typeof part.title === "string" && part.title) ||
        (typeof part.filename === "string" && part.filename) ||
        "Document";
      push(title);
    } else if (part.type.startsWith("tool-")) {
      const toolName = part.type.slice("tool-".length);
      const label = READ_TOOL_SOURCE_LABELS[toolName];
      if (!label) continue;
      let title = label;
      if (toolName === "getReport" && part.input && typeof part.input === "object") {
        const report = (part.input as Record<string, unknown>).report;
        if (typeof report === "string") title = humanizeReport(report);
      }
      push(title);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Thread switcher — one Command/Combobox used in every mode. Search, select,
// rename, delete, and new conversation, all kept close to the composer so the
// surface reads as a focused chat product rather than a dashboard.
// ---------------------------------------------------------------------------

function ThreadSwitcher({
  activeThreadId,
  threads,
  onSelect,
  onNew,
  onRename,
  onDelete,
  className,
}: {
  activeThreadId: string | null | undefined;
  threads: ThreadSummary[];
  onSelect: (threadId: string | null) => void;
  onNew: () => void;
  onRename: (threadId: string, title: string) => Promise<void>;
  onDelete: (thread: ThreadSummary) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [renameError, setRenameError] = useState("");
  const [savingName, setSavingName] = useState(false);
  const active = threads.find((thread) => thread.threadId === activeThreadId);
  const label = active?.title ?? "New conversation";

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      if (nextOpen) {
        setEditTitle(active?.title ?? "");
        setRenameError("");
      }
    },
    [active?.title],
  );

  const submitRename = useCallback(async () => {
    if (!active) return;
    const title = editTitle.trim();
    if (!title) {
      setRenameError("Name the conversation first.");
      return;
    }
    setSavingName(true);
    try {
      await onRename(active.threadId, title);
      setOpen(false);
    } catch (error) {
      setRenameError(error instanceof Error ? error.message : "Could not rename this conversation.");
    } finally {
      setSavingName(false);
    }
  }, [active, editTitle, onRename]);

  return (
    <Popover onOpenChange={handleOpenChange} open={open}>
      <PopoverTrigger asChild>
        <Button
          aria-label="Switch conversation"
          className={cn("min-w-0 max-w-[220px] justify-between font-normal", className)}
          data-testid="ai-thread-switcher"
          role="combobox"
          size="sm"
          type="button"
          variant="outline"
        >
          <span className="min-w-0 flex-1 truncate text-left">{label}</span>
          <ChevronsUpDown className="shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[300px] p-0">
        <Command>
          <CommandInput data-testid="ai-thread-search" placeholder="Find a conversation…" />
          <CommandList>
            <CommandEmpty>No conversations yet.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                onSelect={() => {
                  onNew();
                  setOpen(false);
                }}
                value="__new__ new conversation"
              >
                <MessageSquarePlus />
                <span>New conversation</span>
              </CommandItem>
            </CommandGroup>
            {threads.length ? (
              <CommandGroup heading="Recent">
                {threads.map((thread) => (
                  <CommandItem
                    data-active={thread.threadId === activeThreadId ? "true" : "false"}
                    data-testid="ai-thread-list-row"
                    key={thread.threadId}
                    onSelect={() => {
                      onSelect(thread.threadId);
                      setOpen(false);
                    }}
                    value={`${thread.threadId} ${thread.title}`}
                  >
                    <Check
                      className={cn(
                        thread.threadId === activeThreadId ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{thread.title}</span>
                      <span className="block text-[11px] text-muted-foreground">
                        {formatThreadTime(thread.lastActiveAt)}
                      </span>
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
        {active ? (
          <div className="space-y-2 border-t p-2" data-testid="ai-thread-manage">
            <div className="flex items-center gap-2">
              <Input
                aria-label="Conversation name"
                className="h-8"
                onChange={(event) => setEditTitle(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void submitRename();
                  }
                }}
                value={editTitle}
              />
              <Button disabled={savingName} onClick={() => void submitRename()} size="sm" type="button">
                Save
              </Button>
            </div>
            {renameError ? <div className="text-xs text-destructive">{renameError}</div> : null}
            <Button
              className="w-full justify-start text-muted-foreground hover:text-destructive"
              onClick={() => {
                onDelete(active);
                setOpen(false);
              }}
              size="sm"
              type="button"
              variant="ghost"
            >
              <Trash2 data-icon="inline-start" />
              Delete chat
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Thread rail — the full-page (ChatGPT-style) chat sidebar. New chat, search,
// and a recents list with per-row rename/delete. Desktop-only; on narrow page
// views the composer keeps the compact ThreadSwitcher instead.
// ---------------------------------------------------------------------------

function ThreadRow({
  thread,
  active,
  onSelect,
  onRename,
  onDelete,
}: {
  thread: ThreadSummary;
  active: boolean;
  onSelect: (threadId: string | null) => void;
  onRename: (threadId: string, title: string) => Promise<void>;
  onDelete: (thread: ThreadSummary) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editTitle, setEditTitle] = useState(thread.title);
  const [renameError, setRenameError] = useState("");
  const [saving, setSaving] = useState(false);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      setMenuOpen(next);
      if (next) {
        setEditTitle(thread.title);
        setRenameError("");
      }
    },
    [thread.title],
  );

  const submitRename = useCallback(async () => {
    const title = editTitle.trim();
    if (!title) {
      setRenameError("Name the conversation first.");
      return;
    }
    setSaving(true);
    try {
      await onRename(thread.threadId, title);
      setMenuOpen(false);
    } catch (error) {
      setRenameError(error instanceof Error ? error.message : "Could not rename this conversation.");
    } finally {
      setSaving(false);
    }
  }, [editTitle, onRename, thread.threadId]);

  return (
    <li
      className={cn(
        "group/row relative flex items-center rounded-md pr-1 text-sm",
        active ? "bg-ai-surface text-ai" : "text-foreground hover:bg-muted",
      )}
      data-active={active ? "true" : "false"}
      data-testid="ai-thread-list-row"
    >
      <button
        className="min-w-0 flex-1 truncate rounded-md px-2.5 py-2 text-left"
        onClick={() => onSelect(thread.threadId)}
        title={thread.title}
        type="button"
      >
        {thread.title}
      </button>
      <Popover onOpenChange={handleOpenChange} open={menuOpen}>
        <PopoverTrigger asChild>
          <Button
            aria-label="Conversation options"
            className={cn(
              "size-7 shrink-0 opacity-0 group-hover/row:opacity-100 data-[state=open]:opacity-100",
              active ? "text-ai opacity-100" : "text-muted-foreground",
            )}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <MoreHorizontal />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[264px] space-y-2 p-2" side="right">
          <div className="flex items-center gap-2">
            <Input
              aria-label="Conversation name"
              className="h-8"
              onChange={(event) => setEditTitle(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void submitRename();
                }
              }}
              value={editTitle}
            />
            <Button disabled={saving} onClick={() => void submitRename()} size="sm" type="button">
              Save
            </Button>
          </div>
          {renameError ? <p className="text-xs text-destructive">{renameError}</p> : null}
          <Button
            className="w-full justify-start text-muted-foreground hover:text-destructive"
            onClick={() => {
              setMenuOpen(false);
              onDelete(thread);
            }}
            size="sm"
            type="button"
            variant="ghost"
          >
            <Trash2 data-icon="inline-start" />
            Delete chat
          </Button>
        </PopoverContent>
      </Popover>
    </li>
  );
}

function ThreadSidebar({
  threads,
  activeThreadId,
  onSelect,
  onNew,
  onRename,
  onDelete,
}: {
  threads: ThreadSummary[];
  activeThreadId: string | null | undefined;
  onSelect: (threadId: string | null) => void;
  onNew: () => void;
  onRename: (threadId: string, title: string) => Promise<void>;
  onDelete: (thread: ThreadSummary) => void;
}) {
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const filtered = query
    ? threads.filter((thread) => thread.title.toLowerCase().includes(query))
    : threads;

  return (
    <aside
      className="hidden w-[268px] shrink-0 flex-col border-r bg-muted/20 md:flex"
      data-testid="ai-thread-rail"
    >
      <div className="flex flex-col gap-2 p-3">
        <Button
          aria-label="New Ask AI conversation"
          className="w-full justify-start gap-2 font-normal"
          onClick={onNew}
          type="button"
          variant="outline"
        >
          <MessageSquarePlus className="size-4" />
          New chat
        </Button>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search conversations"
            className="h-9 border-transparent bg-muted/60 pl-8 focus-visible:border-input focus-visible:bg-background"
            data-testid="ai-thread-search"
            onChange={(event) => setSearch(event.currentTarget.value)}
            placeholder="Search chats"
            value={search}
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        <div className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Recents
        </div>
        {filtered.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">
            {threads.length === 0 ? "No conversations yet." : "No matches."}
          </p>
        ) : (
          <ul className="space-y-0.5">
            {filtered.map((thread) => (
              <ThreadRow
                active={thread.threadId === activeThreadId}
                key={thread.threadId}
                onDelete={onDelete}
                onRename={onRename}
                onSelect={onSelect}
                thread={thread}
              />
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Smoothed streamed markdown — preserves the existing useSmoothText feel and
// feeds it into the AI Elements MessageResponse (streamdown) renderer.
// ---------------------------------------------------------------------------

function StreamedAnswer({ text, streaming }: { text: string; streaming: boolean }) {
  const [visibleText] = useSmoothText(text, { startStreaming: streaming, charsPerSec: 220 });
  return (
    // A wide markdown table (e.g. a P&L breakdown) would otherwise clip money
    // figures at the right edge of the narrow docked panel. Make any nested
    // table scroll horizontally inside its own track so amounts stay whole
    // instead of being cut to "$280,400.0…". min-w-0 lets the block shrink to
    // the panel width; the table wrapper owns the overflow.
    <div
      data-testid="ai-markdown-response"
      className="min-w-0 leading-relaxed [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_table]:whitespace-nowrap"
    >
      <MessageResponse controls={{ table: false }}>{visibleText}</MessageResponse>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reasoning, Tool, and Sources disclosures on their AI Elements primitives.
// ---------------------------------------------------------------------------

function MessageReasoning({ text, streaming }: { text: string; streaming: boolean }) {
  if (!text) return null;
  return (
    <Reasoning className="mb-0" isStreaming={streaming}>
      <ReasoningTrigger />
      <ReasoningContent>{text}</ReasoningContent>
    </Reasoning>
  );
}

// The AI SDK tool-part states ToolHeader's status badge can render. Any value
// outside this set is clamped to "input-streaming" so the badge degrades
// gracefully (a real icon + "Pending") instead of an empty icon + undefined
// label for a future/non-AI-SDK state string.
const TOOL_STATES = new Set<ComponentProps<typeof ToolHeader>["state"]>([
  "approval-requested",
  "approval-responded",
  "input-available",
  "input-streaming",
  "output-available",
  "output-denied",
  "output-error",
]);

function ToolPart({ part }: { part: MessagePart }) {
  const rawState = typeof part.state === "string" ? part.state : "input-streaming";
  const candidateState = rawState as ComponentProps<typeof ToolHeader>["state"];
  const state = TOOL_STATES.has(candidateState) ? candidateState : "input-streaming";
  const input = "input" in part ? part.input : undefined;
  const output = "output" in part ? part.output : undefined;
  const errorText = typeof part.errorText === "string" ? part.errorText : undefined;

  return (
    <div data-testid="ai-tool-card">
      <Tool>
        <ToolHeader
          state={state}
          title={sentenceCase(part.type)}
          toolName={sentenceCase(part.type)}
          type="dynamic-tool"
        />
        <ToolContent>
          {input !== undefined ? <ToolInput input={input} /> : null}
          {output !== undefined || errorText ? (
            <ToolOutput errorText={errorText} output={output} />
          ) : null}
        </ToolContent>
      </Tool>
    </div>
  );
}

function MessageSources({ sources }: { sources: MessageSource[] }) {
  if (!sources.length) return null;
  return (
    <Sources>
      <SourcesTrigger count={sources.length} />
      <SourcesContent>
        {sources.map((source) => (
          <Source href={source.href} key={source.key} title={source.title} />
        ))}
      </SourcesContent>
    </Sources>
  );
}

// ---------------------------------------------------------------------------
// Propose → confirm card. A first-class confirmation render that NEVER
// auto-posts. Keeps the "Nothing has been posted yet" copy + confirm/dismiss
// wiring and the legacy `ai-confirmation-card` / `ai-proposal-result` hooks.
// ---------------------------------------------------------------------------

function ProposalCard({
  proposal,
  state,
  onConfirm,
  onDismiss,
}: {
  proposal: ProposalRow;
  state?: ProposalActionState;
  onConfirm: (proposal: ProposalRow) => void;
  onDismiss: (proposal: ProposalRow) => void;
}) {
  const pending = state?.status === "confirming" || state?.status === "dismissing";
  const proposed = proposal.status === "proposed";
  const facts = payloadFacts(proposal.payload);
  const result = state?.message ?? proposal.resultSummary;

  return (
    <div
      className="mt-3 overflow-hidden rounded-[10px] border border-ob-green-200 bg-card"
      data-testid="ai-confirmation-card"
    >
      <div className="flex items-start gap-2.5 p-3">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-ai" />
        <div className="min-w-0">
          <div className="text-sm font-semibold">{proposalKindLabel(proposal.kind)}</div>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">{proposal.summary}</p>
        </div>
      </div>
      <div className="mx-3 rounded-[7px] bg-ai-surface px-2.5 py-2 text-xs leading-5 text-ai">
        Nothing has been posted or written yet. The ledger changes only after confirmation.
      </div>
      {facts.length ? (
        <div className="m-3 divide-y rounded-[8px] border text-xs">
          {facts.map((fact) => (
            <div className="grid grid-cols-[0.8fr_1fr] gap-3 px-3 py-2" key={fact.label}>
              <span className="text-muted-foreground">{fact.label}</span>
              <span className="min-w-0 truncate font-medium">{fact.value}</span>
            </div>
          ))}
        </div>
      ) : null}
      {result ? (
        <div
          className={cn(
            "mx-3 rounded-[7px] border px-2.5 py-2 text-xs",
            state?.status === "error"
              ? "border-destructive/30 text-destructive"
              : "border-ob-green-200 text-ai",
          )}
          data-testid="ai-proposal-result"
        >
          {result}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 p-3">
        <Button
          disabled={!proposed || pending}
          onClick={() => onConfirm(proposal)}
          size="sm"
          type="button"
        >
          {state?.status === "confirming" ? "Confirming…" : proposalActionLabel(proposal.kind)}
        </Button>
        <Button
          disabled={!proposed || pending}
          onClick={() => onDismiss(proposal)}
          size="sm"
          type="button"
          variant="outline"
        >
          {state?.status === "dismissing" ? "Dismissing…" : "Not now"}
        </Button>
        {proposed ? null : (
          <Badge className="h-7 capitalize" variant="outline">
            {proposal.status}
          </Badge>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One message row mapped from UIMessage parts onto AI Elements primitives:
// reasoning → tool calls → sources → answer → proposals.
// ---------------------------------------------------------------------------

function MessageRow({
  message,
  proposals,
  actionStates,
  onConfirm,
  onDismiss,
}: {
  message: UIMessage;
  proposals: ProposalRow[];
  actionStates: Record<string, ProposalActionState>;
  onConfirm: (proposal: ProposalRow) => void;
  onDismiss: (proposal: ProposalRow) => void;
}) {
  const text = textForMessage(message);
  const reasoning = reasoningForMessage(message);
  const toolParts = toolPartsForMessage(message);
  const sources = sourcesForMessage(message);
  const streaming = message.status === "streaming" || message.status === "pending";
  const isUser = message.role === "user";
  const waiting = !text && !reasoning && toolParts.length === 0 && streaming;

  return (
    <Message from={message.role}>
      <MessageContent data-testid={isUser ? "ai-user-message" : "ai-assistant-message"}>
        {isUser ? (
          <div className="whitespace-pre-wrap leading-relaxed">{text}</div>
        ) : (
          <>
            <MessageReasoning streaming={streaming} text={reasoning} />
            {toolParts.map((part) => (
              <ToolPart key={`${message.id}-${part.type}-${String(part.toolCallId ?? "")}`} part={part} />
            ))}
            <MessageSources sources={sources} />
            {text ? <StreamedAnswer streaming={streaming} text={text} /> : null}
            {waiting ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin text-ai" />
                Reading your books…
              </div>
            ) : null}
            {proposals.map((proposal) => (
              <ProposalCard
                key={proposal.id}
                onConfirm={onConfirm}
                onDismiss={onDismiss}
                proposal={proposal}
                state={actionStates[proposal.id]}
              />
            ))}
          </>
        )}
      </MessageContent>
    </Message>
  );
}

// ---------------------------------------------------------------------------
// The shared conversation core. All four modes compose this.
// ---------------------------------------------------------------------------

function AskAIConversation({
  contextLabel,
  reportPack,
  aiStatus,
  workspaceId,
  pendingPrompt,
  pendingNonce,
  mode,
  onClose,
  onExpand,
}: {
  contextLabel: string;
  reportPack: ReportPack | undefined;
  aiStatus: AiStatus;
  workspaceId?: Id<"workspaces">;
  pendingPrompt?: string;
  pendingNonce?: number;
  mode: AskAIMode;
  onClose?: () => void;
  onExpand?: () => void;
}) {
  const createThread = useMutation(api.aiThreads.createThread);
  const deleteThread = useMutation(api.aiThreads.deleteThread);
  const renameThread = useMutation(api.aiThreads.rename);
  const sendMessage = useMutation(api.aiThreads.sendMessage).withOptimisticUpdate((store, args) => {
    optimisticallySendMessage(api.aiThreads.listThreadMessages)(store, args);
  });
  const confirmProposal = useMutation(api.proposals.confirmProposal);
  const dismissProposal = useMutation(api.proposals.dismissProposal);

  const threadRows = useQuery(api.aiThreads.listMine, workspaceId ? { limit: 16 } : "skip") as
    | ThreadSummary[]
    | undefined;
  const [activeThreadId, setActiveThreadId] = useState<string | null | undefined>(undefined);
  const messagesPage = useUIMessages(
    api.aiThreads.listThreadMessages,
    activeThreadId ? { threadId: activeThreadId } : "skip",
    { initialNumItems: 40, stream: true },
  );
  const proposalRows = useQuery(
    api.proposals.listProposals,
    activeThreadId ? { threadId: activeThreadId } : "skip",
  ) as ProposalRow[] | undefined;

  const [sendError, setSendError] = useState("");
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ThreadSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [proposalStates, setProposalStates] = useState<Record<string, ProposalActionState>>({});
  const lastNonceRef = useRef<number | undefined>(undefined);

  const threads = threadRows ?? [];
  const messages = useMemo(
    () => (activeThreadId ? ((messagesPage.results ?? []) as UIMessage[]) : []),
    [activeThreadId, messagesPage.results],
  );
  const proposals = useMemo(
    () => (activeThreadId ? proposalRows ?? [] : []),
    [activeThreadId, proposalRows],
  );
  const entityId = reportPack?.entity.id as Id<"entities"> | undefined;
  const booksContextReady = Boolean(workspaceId && entityId);

  useEffect(() => {
    if (!threadRows) return;
    if (activeThreadId === undefined) {
      setActiveThreadId(threadRows[0]?.threadId ?? null);
      return;
    }
    if (activeThreadId && !threadRows.some((thread) => thread.threadId === activeThreadId)) {
      setActiveThreadId(threadRows[0]?.threadId ?? null);
    }
  }, [activeThreadId, threadRows]);

  const submitPrompt = useCallback(
    async (prompt: string) => {
      const trimmed = prompt.trim();
      if (!trimmed) return false;
      if (!booksContextReady || !entityId) {
        setSendError("OpenBooks is still loading the workspace and business context.");
        return false;
      }
      setSending(true);
      setSendError("");
      try {
        let threadId = activeThreadId || null;
        if (!threadId) {
          const created = await createThread({ entityId, firstMessage: trimmed });
          threadId = created.threadId;
          setActiveThreadId(threadId);
        }
        await sendMessage({ threadId, prompt: trimmed });
        return true;
      } catch (error) {
        setSendError(error instanceof Error ? error.message : "Could not send this Ask AI message.");
        return false;
      } finally {
        setSending(false);
      }
    },
    [activeThreadId, booksContextReady, createThread, entityId, sendMessage],
  );

  // A structured { prompt, nonce } payload: re-submit only when the nonce
  // changes, so prompts containing "::" are never truncated.
  useEffect(() => {
    if (pendingNonce === undefined || pendingNonce === lastNonceRef.current) return;
    if (!pendingPrompt) return;
    if (!booksContextReady) return;
    lastNonceRef.current = pendingNonce;
    void submitPrompt(pendingPrompt);
  }, [booksContextReady, pendingNonce, pendingPrompt, submitPrompt]);

  const handleNewThread = useCallback(() => {
    setActiveThreadId(null);
    setSendError("");
    setDraft("");
    setProposalStates({});
  }, []);

  const handleDeleteThread = useCallback(
    async (threadId: string) => {
      await deleteThread({ threadId });
      setActiveThreadId(null);
    },
    [deleteThread],
  );

  const handleRenameThread = useCallback(
    async (threadId: string, title: string) => {
      await renameThread({ threadId, title });
    },
    [renameThread],
  );

  const confirmDeleteThread = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await handleDeleteThread(deleteTarget.threadId);
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, handleDeleteThread]);

  const handleConfirmProposal = useCallback(
    async (proposal: ProposalRow) => {
      setProposalStates((current) => ({
        ...current,
        [proposal.id]: { status: "confirming", message: "Applying this only after your confirmation…" },
      }));
      try {
        const result = await confirmProposal({ proposalId: proposal.id });
        setProposalStates((current) => ({
          ...current,
          [proposal.id]: { status: "done", message: result.resultSummary },
        }));
      } catch (error) {
        setProposalStates((current) => ({
          ...current,
          [proposal.id]: {
            status: "error",
            message: error instanceof Error ? error.message : "Could not confirm this proposal.",
          },
        }));
      }
    },
    [confirmProposal],
  );

  const handleDismissProposal = useCallback(
    async (proposal: ProposalRow) => {
      setProposalStates((current) => ({
        ...current,
        [proposal.id]: { status: "dismissing", message: "Dismissing this proposal…" },
      }));
      try {
        await dismissProposal({ proposalId: proposal.id });
        setProposalStates((current) => ({
          ...current,
          [proposal.id]: { status: "done", message: "Dismissed. No books were changed." },
        }));
      } catch (error) {
        setProposalStates((current) => ({
          ...current,
          [proposal.id]: {
            status: "error",
            message: error instanceof Error ? error.message : "Could not dismiss this proposal.",
          },
        }));
      }
    },
    [dismissProposal],
  );

  const proposalsByMessage = useMemo(() => {
    const map = new Map<string, ProposalRow[]>();
    for (const proposal of proposals) {
      if (!proposal.messageId) continue;
      const rows = map.get(proposal.messageId) ?? [];
      rows.push(proposal);
      map.set(proposal.messageId, rows);
    }
    return map;
  }, [proposals]);

  const unmatchedProposals = useMemo(() => {
    const messageIds = new Set(messages.map((message) => message.id));
    return proposals.filter((proposal) => !proposal.messageId || !messageIds.has(proposal.messageId));
  }, [messages, proposals]);

  const empty = messages.length === 0;
  const degraded = aiStatus.mode !== "active";
  const sendStatus = sending ? "submitted" : "ready";
  const centered = mode === "page";
  const showHeader = mode === "docked" || mode === "mobile";
  const starterPrompts = aiSuggestedPrompts.slice(0, mode === "page" ? 4 : 3);

  const handlePromptSubmit = useCallback(
    (message: PromptInputMessage) => {
      void submitPrompt(message.text).then((sent) => {
        if (sent) setDraft("");
      });
    },
    [submitPrompt],
  );

  return (
    <div
      aria-label={`Ask AI chat for ${contextLabel}`}
      className="flex h-full w-full min-h-0 min-w-0 bg-background"
    >
      {mode === "page" ? (
        <ThreadSidebar
          activeThreadId={activeThreadId}
          onDelete={setDeleteTarget}
          onNew={handleNewThread}
          onRename={handleRenameThread}
          onSelect={setActiveThreadId}
          threads={threads}
        />
      ) : null}
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
        {showHeader ? (
          <div className="flex h-12 shrink-0 items-center justify-between gap-2 px-3">
            <div className="flex min-w-0 items-center gap-2">
              <Sparkles className="size-4 shrink-0 text-ai" />
              <span className="text-sm font-semibold">Chat</span>
              {degraded ? (
                <Badge className="h-5 px-1.5 text-[11px]" variant="secondary">
                  AI off
                </Badge>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              {mode === "docked" && onExpand ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      aria-label="Open full screen"
                      onClick={onExpand}
                      size="icon-sm"
                      type="button"
                      variant="ghost"
                    >
                      <Maximize2 />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Open full screen</TooltipContent>
                </Tooltip>
              ) : null}
              {onClose ? (
                <Button
                  aria-label="Close Ask AI"
                  onClick={onClose}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <PanelRightClose />
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* Transcript — AI Elements Conversation with built-in stick-to-bottom. */}
        <Conversation className="min-h-0 flex-1">
          <ConversationContent
            className={cn("gap-6 px-4 py-6", centered && "mx-auto w-full max-w-3xl")}
          >
            {empty ? (
              <div
                className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-10 text-center"
                data-testid="ai-empty-state"
              >
                <span className="flex size-11 items-center justify-center rounded-full bg-ai-surface text-ai">
                  <Sparkles className="size-5" />
                </span>
                <h2 className="text-base font-semibold tracking-tight">Ask anything about your books</h2>
              </div>
            ) : null}

            {messages.map((message) => (
              <MessageRow
                actionStates={proposalStates}
                key={message.id}
                message={message}
                onConfirm={handleConfirmProposal}
                onDismiss={handleDismissProposal}
                proposals={proposalsByMessage.get(message.id) ?? []}
              />
            ))}

            {unmatchedProposals.length ? (
              <div className="space-y-1 rounded-[10px] border bg-card px-3 py-2">
                <div className="text-sm font-semibold">Open confirmation cards</div>
                {unmatchedProposals.map((proposal) => (
                  <ProposalCard
                    key={proposal.id}
                    onConfirm={handleConfirmProposal}
                    onDismiss={handleDismissProposal}
                    proposal={proposal}
                    state={proposalStates[proposal.id]}
                  />
                ))}
              </div>
            ) : null}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        {/* Composer — AI Elements PromptInput, modeled after the chatbot example.
            Suggestions stack vertically directly above it and clear on the first
            message. */}
        <div className={cn("shrink-0 bg-background px-4 pb-4 pt-3", !empty && "border-t")}>
          <div className={cn(centered && "mx-auto w-full max-w-3xl")}>
            {sendError ? (
              <div className="mb-3 rounded-[7px] border border-destructive/30 px-2.5 py-2 text-xs text-destructive">
                {sendError}
              </div>
            ) : null}
            {empty ? (
              <div className="mb-2 flex flex-col" data-testid="ai-suggestions">
                {starterPrompts.map((prompt) => (
                  <Suggestion
                    className="h-auto w-full justify-start rounded-md px-2.5 py-1.5 text-left text-sm font-normal text-muted-foreground hover:bg-ai-surface hover:text-ai"
                    disabled={!booksContextReady || sending}
                    key={prompt}
                    onClick={(value) => void submitPrompt(value)}
                    suggestion={prompt}
                    variant="ghost"
                  />
                ))}
              </div>
            ) : null}
            <PromptInput className="shadow-xs" onSubmit={handlePromptSubmit}>
              <PromptInputTextarea
                aria-label="Ask about your books"
                className="max-h-52 min-h-20 px-3 py-3 text-sm"
                disabled={sending || !booksContextReady}
                maxLength={1000}
                onChange={(event) => setDraft(event.currentTarget.value)}
                placeholder={booksContextReady ? "Ask about your books…" : "Loading your books…"}
                value={draft}
              />
              <PromptInputFooter className="items-center gap-1">
                <PromptInputTools className={cn("min-w-0 flex-1", mode === "page" && "md:hidden")}>
                  <PromptInputButton
                    aria-label="New Ask AI conversation"
                    onClick={handleNewThread}
                    tooltip="New chat"
                  >
                    <MessageSquarePlus />
                  </PromptInputButton>
                  <ThreadSwitcher
                    activeThreadId={activeThreadId}
                    className="h-8 max-w-[180px] border-0 bg-transparent px-2 text-muted-foreground hover:bg-muted hover:text-foreground"
                    onDelete={setDeleteTarget}
                    onNew={handleNewThread}
                    onRename={handleRenameThread}
                    onSelect={setActiveThreadId}
                    threads={threads}
                  />
                </PromptInputTools>
                <div className="ml-auto flex shrink-0 items-center gap-2">
                  {draft.length > 900 ? (
                    <span className="money-figures text-[11px] tabular-nums text-muted-foreground">
                      {draft.length}/1000
                    </span>
                  ) : null}
                  <PromptInputSubmit
                    aria-label="Send question"
                    disabled={sending || !booksContextReady || !draft.trim()}
                    status={sendStatus}
                  />
                </div>
              </PromptInputFooter>
            </PromptInput>
          </div>
        </div>
      </div>

      <AlertDialog onOpenChange={(open) => !open && setDeleteTarget(null)} open={Boolean(deleteTarget)}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this chat?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the conversation from your Ask AI history. It does not change the books.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(event) => {
                event.preventDefault();
                void confirmDeleteThread();
              }}
              variant="destructive"
            >
              {deleting ? "Deleting..." : "Delete chat"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AskAIWidget — one component, four modes off a `mode` prop.
// ---------------------------------------------------------------------------

export type AskAIWidgetProps = {
  mode: AskAIMode;
  contextLabel: string;
  reportPack?: ReportPack;
  aiStatus: AiStatus;
  workspaceId?: Id<"workspaces">;
  pendingPrompt?: string;
  pendingNonce?: number;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onOpen?: () => void;
  collapsed?: boolean;
};

export function AskAIWidget({
  mode,
  contextLabel,
  reportPack,
  aiStatus,
  workspaceId,
  pendingPrompt,
  pendingNonce,
  open = false,
  onOpenChange,
  onOpen,
  collapsed,
}: AskAIWidgetProps) {
  const router = useRouter();

  // 1) COLLAPSED — a Sparkles trigger for the iconified rail. No panel.
  if (mode === "collapsed") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-label="Ask AI"
            data-testid="ask-ai-rail-trigger"
            onClick={onOpen}
            size={collapsed ? "icon-sm" : "sm"}
            variant="ghost"
          >
            <Sparkles className="text-ai" />
            {collapsed ? null : <span>Ask AI</span>}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">Ask AI · ⌘J</TooltipContent>
      </Tooltip>
    );
  }

  const conversation = (
    <AskAIConversation
      aiStatus={aiStatus}
      contextLabel={contextLabel}
      mode={mode}
      onClose={onOpenChange ? () => onOpenChange(false) : undefined}
      onExpand={() => {
        if (typeof window !== "undefined") {
          window.sessionStorage.setItem("openbooks:ai-return", window.location.pathname);
        }
        onOpenChange?.(false);
        router.push("/ask-ai");
      }}
      pendingNonce={pendingNonce}
      pendingPrompt={pendingPrompt}
      reportPack={reportPack}
      workspaceId={workspaceId}
    />
  );

  // 2) MOBILE — a shadcn Sheet (side bottom) with a reachable thread switcher.
  if (mode === "mobile") {
    return (
      <Sheet onOpenChange={onOpenChange} open={open}>
        <SheetContent
          className="h-[88dvh] gap-0 rounded-t-[14px] p-0 sm:max-w-none"
          data-testid="ai-panel-mobile"
          showCloseButton={false}
          side="bottom"
        >
          <SheetTitle className="sr-only">Ask AI</SheetTitle>
          <SheetDescription className="sr-only">
            Ask questions about your books and manage your AI conversations.
          </SheetDescription>
          {conversation}
        </SheetContent>
      </Sheet>
    );
  }

  // 3) PAGE — the /ask-ai full screen. A true edge-to-edge chat: a left thread
  // rail (new/search/recents) beside a centered transcript and composer. The
  // widget is full-bleed; AppShell drops the page padding for this route.
  if (mode === "page") {
    return (
      <div
        className="flex h-full min-h-0 w-full overflow-hidden bg-background"
        data-testid="m10-ai-chat-page"
      >
        {conversation}
      </div>
    );
  }

  // 4) DOCKED — a reserved right-hand column. This is intentionally not fixed
  // and has no scrim: the ledger content remains visible and measurable.
  if (!open) return null;
  return (
    <aside
      className="sticky top-0 hidden h-screen w-[min(420px,34vw)] min-w-[360px] max-w-[440px] shrink-0 border-l bg-background md:flex"
      data-testid="ai-panel"
    >
      <div className="min-w-0 flex-1">{conversation}</div>
    </aside>
  );
}
