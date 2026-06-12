"use client";

import {
  optimisticallySendMessage,
  useSmoothText,
  useUIMessages,
  type UIMessage,
} from "@convex-dev/agent/react";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowUp,
  CheckCircle2,
  CircleAlert,
  Loader2,
  Maximize2,
  MessageSquarePlus,
  PanelRightClose,
  Sparkles,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AiStatus } from "@/lib/openbooks/ai";
import type { ReportPack } from "@/lib/openbooks/reports-export";
import { cn } from "@/lib/utils";

const SUGGESTIONS = [
  "How did we do last month vs. before?",
  "Top 5 expenses this quarter?",
  "Who owes me money right now?",
  "How much did Stripe take in fees this year?",
  "What's my monthly payroll cost in USD?",
];

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

function compactJson(value: unknown) {
  if (value === undefined || value === null) return "";
  try {
    return JSON.stringify(value, null, 2).slice(0, 1200);
  } catch {
    return String(value);
  }
}

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
    .map(([key, value]) => ({
      label: sentenceCase(key),
      value: String(value),
    }));
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

function toolPartsForMessage(message: UIMessage) {
  return message.parts.filter((part): part is MessagePart => part.type.startsWith("tool-"));
}

function isSeparatorLine(line: string) {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line);
}

function isTableStart(lines: string[], index: number) {
  return Boolean(lines[index]?.includes("|") && lines[index + 1] && isSeparatorLine(lines[index + 1]!));
}

function parseTableRow(line: string) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function InlineMarkdown({ text }: { text: string }) {
  const pieces = text.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g).filter(Boolean);
  return (
    <>
      {pieces.map((piece, index) => {
        const bold = piece.match(/^\*\*([^*]+)\*\*$/);
        if (bold) {
          return <strong key={`${piece}-${index}`}>{bold[1]}</strong>;
        }
        const link = piece.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (link) {
          const [, label, href] = link;
          const className =
            href.startsWith("/")
              ? "inline-flex h-7 items-center rounded-[6px] border border-[#bbe0a9] bg-[#f1f8ee] px-2 text-xs font-medium text-[#1d6b12] hover:bg-[#dcefd2]"
              : "font-medium text-primary underline underline-offset-2";
          return (
            <Link key={`${piece}-${index}`} href={href} className={className}>
              {label}
            </Link>
          );
        }
        return <span key={`${piece}-${index}`}>{piece}</span>;
      })}
    </>
  );
}

function MarkdownBlocks({ text }: { text: string }) {
  const lines = text.split(/\r?\n/);
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    if (!trimmed) {
      index += 1;
      continue;
    }

    if (isTableStart(lines, index)) {
      const header = parseTableRow(lines[index]!);
      index += 2;
      const rows = [];
      while (index < lines.length && lines[index]!.includes("|") && lines[index]!.trim()) {
        rows.push(parseTableRow(lines[index]!));
        index += 1;
      }
      blocks.push(
        <div key={`table-${index}`} className="my-3 overflow-hidden rounded-[8px] border bg-background">
          <table className="w-full text-sm" data-testid="ai-markdown-table">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                {header.map((cell) => (
                  <th key={cell} className="px-3 py-2 text-left font-medium">
                    <InlineMarkdown text={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row, rowIndex) => (
                <tr key={`${row.join("-")}-${rowIndex}`}>
                  {row.map((cell, cellIndex) => (
                    <td
                      key={`${cell}-${cellIndex}`}
                      className={cn("px-3 py-2", cellIndex > 0 && "money-figures text-right")}
                    >
                      <InlineMarkdown text={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (trimmed.startsWith("### ")) {
      blocks.push(
        <h3 key={`h3-${index}`} className="mt-3 text-sm font-semibold">
          <InlineMarkdown text={trimmed.slice(4)} />
        </h3>,
      );
      index += 1;
      continue;
    }

    if (trimmed.startsWith("## ")) {
      blocks.push(
        <h2 key={`h2-${index}`} className="mt-3 text-[15px] font-semibold">
          <InlineMarkdown text={trimmed.slice(3)} />
        </h2>,
      );
      index += 1;
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index]!.trim())) {
        items.push(lines[index]!.trim().replace(/^[-*]\s+/, ""));
        index += 1;
      }
      blocks.push(
        <ul key={`ul-${index}`} className="my-2 list-disc space-y-1 pl-5">
          {items.map((item) => (
            <li key={item}>
              <InlineMarkdown text={item} />
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    const paragraph = [trimmed];
    index += 1;
    while (
      index < lines.length &&
      lines[index]!.trim() &&
      !isTableStart(lines, index) &&
      !/^#{2,3}\s+/.test(lines[index]!.trim()) &&
      !/^[-*]\s+/.test(lines[index]!.trim())
    ) {
      paragraph.push(lines[index]!.trim());
      index += 1;
    }
    blocks.push(
      <p key={`p-${index}`} className="my-2 leading-6">
        <InlineMarkdown text={paragraph.join(" ")} />
      </p>,
    );
  }

  if (!blocks.length) {
    return <p className="text-muted-foreground">Waiting for the assistant...</p>;
  }

  return <>{blocks}</>;
}

function SmoothMarkdown({ text, streaming }: { text: string; streaming: boolean }) {
  const [visibleText] = useSmoothText(text, { startStreaming: streaming, charsPerSec: 220 });
  return (
    <div className="text-sm leading-6" data-testid="ai-markdown-response">
      <MarkdownBlocks text={visibleText} />
    </div>
  );
}

function ToolPartCard({ part }: { part: MessagePart }) {
  const state = typeof part.state === "string" ? part.state : "pending";
  const input = "input" in part ? part.input : undefined;
  const output = "output" in part ? part.output : undefined;
  const content = compactJson(output ?? input);
  return (
    <details className="mt-3 rounded-[8px] border bg-background" data-testid="ai-tool-card">
      <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-muted-foreground">
        {sentenceCase(part.type)} · {sentenceCase(state)}
      </summary>
      {content ? (
        <pre className="max-h-[220px] overflow-auto border-t bg-muted/30 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
          {content}
        </pre>
      ) : null}
    </details>
  );
}

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
    <div className="mt-3 rounded-[8px] border bg-background p-3" data-testid="ai-confirmation-card">
      <div className="flex items-start gap-2">
        <CircleAlert className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="min-w-0">
          <div className="text-sm font-semibold">{proposalKindLabel(proposal.kind)}</div>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">{proposal.summary}</p>
        </div>
      </div>
      <div className="mt-3 rounded-[7px] bg-muted/40 p-2 text-xs text-muted-foreground">
        Nothing has been posted or written yet. The ledger changes only after confirmation.
      </div>
      {facts.length ? (
        <div className="mt-3 divide-y rounded-[8px] border text-xs">
          {facts.map((fact) => (
            <div key={fact.label} className="grid grid-cols-[0.8fr_1fr] gap-3 px-3 py-2">
              <span className="text-muted-foreground">{fact.label}</span>
              <span className="min-w-0 truncate font-medium">{fact.value}</span>
            </div>
          ))}
        </div>
      ) : null}
      {result ? (
        <div
          className={cn(
            "mt-3 rounded-[7px] border p-2 text-xs",
            state?.status === "error" ? "border-destructive/30 text-destructive" : "border-primary/30 text-primary",
          )}
          data-testid="ai-proposal-result"
        >
          {result}
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          disabled={!proposed || pending}
          size="sm"
          type="button"
          onClick={() => onConfirm(proposal)}
        >
          {state?.status === "confirming" ? "Confirming..." : proposalActionLabel(proposal.kind)}
        </Button>
        <Button
          disabled={!proposed || pending}
          size="sm"
          type="button"
          variant="outline"
          onClick={() => onDismiss(proposal)}
        >
          {state?.status === "dismissing" ? "Dismissing..." : "Not now"}
        </Button>
        {!proposed ? (
          <Badge variant="outline" className="h-8 capitalize">
            {proposal.status}
          </Badge>
        ) : null}
      </div>
    </div>
  );
}

function MessageBubble({
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
  const toolParts = toolPartsForMessage(message);
  const streaming = message.status === "streaming" || message.status === "pending";
  const isUser = message.role === "user";

  return (
    <div
      className={cn(
        "max-w-[94%] rounded-[8px] border px-3 py-2 shadow-xs",
        isUser ? "ml-auto border-primary bg-primary text-primary-foreground" : "bg-card text-card-foreground",
      )}
      data-testid={isUser ? "ai-user-message" : "ai-assistant-message"}
    >
      {isUser ? (
        <div className="whitespace-pre-wrap text-sm leading-6">{text}</div>
      ) : (
        <>
          {text ? <SmoothMarkdown text={text} streaming={streaming} /> : null}
          {!text && streaming ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Reading your books...
            </div>
          ) : null}
          {toolParts.map((part) => (
            <ToolPartCard key={`${message.id}-${part.type}-${String(part.toolCallId ?? "")}`} part={part} />
          ))}
          {proposals.map((proposal) => (
            <ProposalCard
              key={proposal.id}
              proposal={proposal}
              state={actionStates[proposal.id]}
              onConfirm={onConfirm}
              onDismiss={onDismiss}
            />
          ))}
        </>
      )}
    </div>
  );
}

function ThreadRail({
  activeThreadId,
  threads,
  onSelect,
  onNew,
  onDelete,
}: {
  activeThreadId: string | null | undefined;
  threads: ThreadSummary[];
  onSelect: (threadId: string | null) => void;
  onNew: () => void;
  onDelete: (threadId: string) => void;
}) {
  return (
    <aside className="hidden w-[236px] shrink-0 border-r bg-muted/20 lg:flex lg:flex-col" data-testid="ai-thread-rail">
      <div className="border-b p-3">
        <Button className="w-full justify-start" size="sm" type="button" variant="outline" onClick={onNew}>
          <MessageSquarePlus className="size-4" />
          New conversation
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {threads.length ? (
          threads.map((thread) => (
            <button
              key={thread.threadId}
              type="button"
              data-testid="ai-thread-row"
              data-active={thread.threadId === activeThreadId ? "true" : "false"}
              className={cn(
                "mb-1 w-full rounded-[8px] border px-3 py-2 text-left transition-colors",
                thread.threadId === activeThreadId
                  ? "border-[#bbe0a9] bg-[#f1f8ee]"
                  : "border-transparent hover:border-border hover:bg-background",
              )}
              onClick={() => onSelect(thread.threadId)}
            >
              <div className="truncate text-sm font-medium">{thread.title}</div>
              <div className="mt-1 text-[11px] text-muted-foreground">{formatThreadTime(thread.lastActiveAt)}</div>
            </button>
          ))
        ) : (
          <div className="rounded-[8px] border border-dashed p-3 text-xs leading-5 text-muted-foreground">
            Recent conversations will appear here after the first question.
          </div>
        )}
      </div>
      {activeThreadId ? (
        <div className="border-t p-3">
          <Button
            className="w-full justify-start"
            size="sm"
            type="button"
            variant="ghost"
            onClick={() => onDelete(activeThreadId)}
          >
            <Trash2 className="size-4" />
            Delete thread
          </Button>
        </div>
      ) : null}
    </aside>
  );
}

export function OpenBooksAIChat({
  contextLabel,
  reportPack,
  aiStatus,
  workspaceId,
  pendingPrompt,
  mode = "drawer",
  onClose,
}: {
  contextLabel: string;
  reportPack: ReportPack | undefined;
  aiStatus: AiStatus;
  workspaceId?: Id<"workspaces">;
  pendingPrompt?: string;
  mode?: "drawer" | "page";
  onClose?: () => void;
}) {
  const createThread = useMutation(api.aiThreads.createThread);
  const deleteThread = useMutation(api.aiThreads.deleteThread);
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
  const [input, setInput] = useState("");
  const [sendError, setSendError] = useState("");
  const [sending, setSending] = useState(false);
  const [proposalStates, setProposalStates] = useState<Record<string, ProposalActionState>>({});
  const listRef = useRef<HTMLDivElement>(null);
  const lastExternalPromptRef = useRef("");

  const threads = threadRows ?? [];
  const messages = useMemo(() => (messagesPage.results ?? []) as UIMessage[], [messagesPage.results]);
  const proposals = useMemo(() => proposalRows ?? [], [proposalRows]);
  const entityId = reportPack?.entity.id as Id<"entities"> | undefined;
  const booksContextReady = Boolean(workspaceId && entityId);
  const activeThread = threads.find((thread) => thread.threadId === activeThreadId);

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

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, proposals.length]);

  const submitPrompt = useCallback(
    async (prompt: string) => {
      const trimmed = prompt.trim();
      if (!trimmed) return;
      if (!booksContextReady || !entityId) {
        setSendError("OpenBooks is still loading the workspace and business context.");
        return;
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
        setInput("");
      } catch (error) {
        setSendError(error instanceof Error ? error.message : "Could not send this Ask AI message.");
      } finally {
        setSending(false);
      }
    },
    [activeThreadId, booksContextReady, createThread, entityId, sendMessage],
  );

  useEffect(() => {
    if (!pendingPrompt || pendingPrompt === lastExternalPromptRef.current) return;
    if (!booksContextReady) return;
    lastExternalPromptRef.current = pendingPrompt;
    void submitPrompt(pendingPrompt.split("::")[0] ?? pendingPrompt);
  }, [booksContextReady, pendingPrompt, submitPrompt]);

  const handleNewThread = useCallback(() => {
    setActiveThreadId(null);
    setInput("");
    setSendError("");
    setProposalStates({});
  }, []);

  const handleDeleteThread = useCallback(
    async (threadId: string) => {
      await deleteThread({ threadId });
      setActiveThreadId(null);
    },
    [deleteThread],
  );

  const handleConfirmProposal = useCallback(
    async (proposal: ProposalRow) => {
      setProposalStates((current) => ({
        ...current,
        [proposal.id]: { status: "confirming", message: "Applying this only after your confirmation..." },
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
        [proposal.id]: { status: "dismissing", message: "Dismissing this proposal..." },
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
  const pageMode = mode === "page";

  return (
    <div
      className={cn(
        "flex h-full min-h-0 min-w-0 overflow-hidden bg-background",
        pageMode && "min-h-[calc(100vh-12rem)] overflow-hidden rounded-[8px] border shadow-xs",
      )}
      data-testid={pageMode ? "m10-ai-chat-page" : "m10-ai-chat-drawer"}
    >
      {pageMode ? (
        <ThreadRail
          activeThreadId={activeThreadId}
          threads={threads}
          onSelect={setActiveThreadId}
          onNew={handleNewThread}
          onDelete={(threadId) => void handleDeleteThread(threadId)}
        />
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-h-14 items-center justify-between gap-2 border-b px-4">
          <div className="flex min-w-0 items-center gap-2">
            <Sparkles className="size-4 shrink-0 text-primary" />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">Ask AI</div>
              <div className="truncate text-[11px] text-muted-foreground">Viewing: {contextLabel}</div>
            </div>
            <Badge variant="outline" className="hidden shrink-0 sm:inline-flex">
              {aiStatus.mode === "active" ? "Bedrock active" : "Degraded mode"}
            </Badge>
          </div>
          <div className="flex min-w-0 items-center gap-1.5">
            <select
              aria-label="Conversation"
              className="hidden h-8 max-w-[170px] rounded-[7px] border bg-background px-2 text-xs outline-none ring-ring/30 focus:ring-2 sm:block"
              value={activeThreadId ?? "new"}
              onChange={(event) => setActiveThreadId(event.target.value === "new" ? null : event.target.value)}
            >
              <option value="new">New conversation</option>
              {threads.map((thread) => (
                <option key={thread.threadId} value={thread.threadId}>
                  {thread.title}
                </option>
              ))}
            </select>
            <Button
              aria-label="New Ask AI conversation"
              className="hidden sm:inline-flex"
              size="icon-sm"
              type="button"
              variant="ghost"
              onClick={handleNewThread}
            >
              <MessageSquarePlus />
            </Button>
            {!pageMode ? (
              <Button aria-label="Open Ask AI full page" asChild className="hidden sm:inline-flex" size="icon-sm" variant="ghost">
                <Link href="/ask-ai">
                  <Maximize2 />
                </Link>
              </Button>
            ) : null}
            {onClose ? (
              <Button aria-label="Close Ask AI" size="icon-sm" type="button" variant="ghost" onClick={onClose}>
                <PanelRightClose />
              </Button>
            ) : null}
          </div>
        </div>

        <div className="border-b bg-muted/25 px-4 py-3">
          <div className="flex items-start gap-2 rounded-[8px] border bg-background p-3">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
            <div className="min-w-0">
              <div className="text-sm font-medium">{activeThread?.title ?? aiStatus.label}</div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {aiStatus.mode === "active"
                  ? "Answers stream from the Convex Agent and every bookkeeping action becomes a confirmation card first."
                  : "AI is not configured. Messages stay honest and will show the missing-provider state instead of fake answers."}
              </p>
            </div>
          </div>
        </div>

        <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {empty ? (
            <div className="rounded-[8px] border border-dashed bg-card p-4" data-testid="ai-empty-state">
              <div className="text-sm font-semibold">Ask a plain-English question about the books.</div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Try one of the five flagship prompts. The answer is saved to a durable Convex thread and will survive reload.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {SUGGESTIONS.map((prompt) => (
                  <Button
                    key={prompt}
                    disabled={!booksContextReady || sending}
                    size="sm"
                    type="button"
                    variant="outline"
                    onClick={() => void submitPrompt(prompt)}
                  >
                    {prompt}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}

          {messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              proposals={proposalsByMessage.get(message.id) ?? []}
              actionStates={proposalStates}
              onConfirm={handleConfirmProposal}
              onDismiss={handleDismissProposal}
            />
          ))}

          {unmatchedProposals.length ? (
            <div className="max-w-[94%] rounded-[8px] border bg-card px-3 py-2 shadow-xs">
              <div className="text-sm font-semibold">Open confirmation cards</div>
              {unmatchedProposals.map((proposal) => (
                <ProposalCard
                  key={proposal.id}
                  proposal={proposal}
                  state={proposalStates[proposal.id]}
                  onConfirm={handleConfirmProposal}
                  onDismiss={handleDismissProposal}
                />
              ))}
            </div>
          ) : null}
        </div>

        <div className="border-t bg-background p-4">
          {sendError ? (
            <div className="mb-3 rounded-[7px] border border-destructive/30 p-2 text-xs text-destructive">
              {sendError}
            </div>
          ) : null}
          <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
            {SUGGESTIONS.map((prompt) => (
              <Button
                key={prompt}
                className="shrink-0"
                disabled={!booksContextReady || sending}
                size="sm"
                type="button"
                variant="outline"
                onClick={() => void submitPrompt(prompt)}
              >
                {prompt}
              </Button>
            ))}
          </div>
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void submitPrompt(input);
            }}
          >
            <Input
              aria-label="Ask about your books"
              disabled={!booksContextReady || sending}
              placeholder={booksContextReady ? "Ask about your books" : "Loading books context"}
              value={input}
              onChange={(event) => setInput(event.target.value)}
            />
            <Button aria-label="Send question" disabled={!booksContextReady || sending} size="icon" type="submit">
              {sending ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
            </Button>
          </form>
        </div>
      </div>

      {pageMode ? (
        <aside className="hidden w-[280px] shrink-0 border-l bg-muted/20 p-4 xl:block" data-testid="ai-artifacts-panel">
          <div className="text-sm font-semibold">Pinned artifacts</div>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            Confirmation cards and report links appear in the conversation today. A richer canvas can land after the core thread
            workflow is proven.
          </p>
        </aside>
      ) : null}
    </div>
  );
}
