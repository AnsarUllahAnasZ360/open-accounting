"use client";

import { useAuthToken } from "@convex-dev/auth/react";
import { useMutation } from "convex/react";
import { ArrowUp, CheckCircle2, CircleAlert, Maximize2, PanelRightClose, Sparkles } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  aiSuggestedPrompts,
  answerOpenBooksQuestion,
  formatAiMoney,
  type AiAnswer,
  type AiStatus,
} from "@/lib/openbooks/ai";
import type { ReportPack } from "@/lib/openbooks/reports-export";
import { cn } from "@/lib/utils";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  answer?: AiAnswer;
  pending?: boolean;
  streaming?: boolean;
};

type ProposalAnswer = Extract<AiAnswer, { kind: "proposal" }>;
type ProposalState = {
  status: "idle" | "saving" | "saved" | "error";
  message?: string;
};

function nextMessageId() {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function convexSiteUrl() {
  const raw = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!raw) return null;

  try {
    const url = new URL(raw);
    if (url.hostname.endsWith(".convex.cloud")) {
      url.hostname = url.hostname.replace(/\.convex\.cloud$/, ".convex.site");
      return url.toString().replace(/\/$/, "");
    }
    if ((url.hostname === "localhost" || url.hostname === "127.0.0.1") && url.port === "3210") {
      url.port = "3211";
      return url.toString().replace(/\/$/, "");
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function shouldUseLiveRuntime(question: string, answer: AiAnswer) {
  if (answer.kind === "proposal") return false;
  const normalized = question.trim().toLowerCase();
  if (aiSuggestedPrompts.some((prompt) => prompt.toLowerCase() === normalized)) return false;
  return ![
    "top 5",
    "expense",
    "owe",
    "owes",
    "payroll",
    "stripe",
    "last month",
    "explain this report",
  ].some((phrase) => normalized.includes(phrase));
}

async function streamLiveAnswer({
  question,
  workspaceId,
  entityId,
  token,
  onChunk,
}: {
  question: string;
  workspaceId: Id<"workspaces">;
  entityId?: Id<"entities">;
  token: string;
  onChunk: (text: string) => void;
}) {
  const siteUrl = convexSiteUrl();
  if (!siteUrl) {
    throw new Error("Convex HTTP endpoint is not configured.");
  }

  const response = await fetch(`${siteUrl}/ai/chat`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ workspaceId, entityId, question }),
  });

  if (!response.body) {
    throw new Error("OpenBooks AI did not return a stream.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    received += decoder.decode(value, { stream: true });
    onChunk(received);
  }
  received += decoder.decode();
  if (!response.ok && !received) {
    throw new Error(`OpenBooks AI returned HTTP ${response.status}.`);
  }
  return received.trim();
}

function AnswerCard({
  answer,
  proposalState,
  onConfirmProposal,
}: {
  answer: AiAnswer;
  proposalState?: ProposalState;
  onConfirmProposal?: (answer: ProposalAnswer) => void;
}) {
  if (answer.kind === "table") {
    return (
      <div className="mt-3 overflow-hidden rounded-lg border bg-background">
        <div className="border-b px-3 py-2">
          <div className="text-sm font-medium">{answer.title}</div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{answer.body}</p>
        </div>
        <table className="w-full text-sm" data-testid="ai-answer-table">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">{answer.columns[0]}</th>
              <th className="px-3 py-2 text-right font-medium">{answer.columns[1]}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {answer.rows.map((row) => (
              <tr key={row.label}>
                <td className="px-3 py-2">{row.label}</td>
                <td className="money-figures px-3 py-2 text-right">{row.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (answer.kind === "proposal") {
    const state = proposalState ?? { status: "idle" as const };
    return (
      <div className="mt-3 rounded-lg border bg-background p-3">
        <div className="flex items-start gap-2">
          <CircleAlert className="mt-0.5 size-4 text-primary" />
          <div>
            <div className="text-sm font-medium">{answer.title}</div>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">{answer.body}</p>
          </div>
        </div>
        <div className="mt-3 rounded-lg bg-muted/40 p-2 text-xs text-muted-foreground">
          Nothing has been posted or written yet.
        </div>
        {answer.facts.length ? (
          <div className="mt-3 divide-y rounded-lg border text-xs">
            {answer.facts.map((fact) => (
              <div key={fact.label} className="grid grid-cols-[0.7fr_1fr] gap-3 px-3 py-2">
                <span className="text-muted-foreground">{fact.label}</span>
                <span className="font-medium">{fact.value}</span>
              </div>
            ))}
          </div>
        ) : null}
        {state.message ? (
          <div
            className={cn(
              "mt-3 rounded-lg border p-2 text-xs",
              state.status === "error" ? "border-destructive/30 text-destructive" : "border-primary/30 text-primary",
            )}
            data-testid="ai-proposal-result"
          >
            {state.message}
          </div>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            disabled={!onConfirmProposal || state.status === "saving" || state.status === "saved"}
            size="sm"
            onClick={() => onConfirmProposal?.(answer)}
          >
            {state.status === "saving" ? "Confirming..." : state.status === "saved" ? "Confirmed" : answer.actionLabel}
          </Button>
          <Button size="sm" variant="outline">Not now</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-lg border bg-background p-3">
      <div className="text-sm font-medium">{answer.title}</div>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">{answer.body}</p>
      {answer.rows?.length ? (
        <div className="mt-3 divide-y rounded-lg border">
          {answer.rows.map((row) => (
            <div key={row.label} className="grid grid-cols-[1fr_auto] gap-3 px-3 py-2 text-sm">
              <span className="text-muted-foreground">{row.label}</span>
              <span className="money-figures font-medium">{row.value}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
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
  const authToken = useAuthToken();
  const createConfirmedRule = useMutation(api.ai.createConfirmedRule);
  const categorizeTransactions = useMutation(api.aiChatActions.categorizeTransactions);
  const draftInvoice = useMutation(api.aiChatActions.draftInvoice);
  const addBill = useMutation(api.aiChatActions.addBill);
  const createJournalEntry = useMutation(api.aiChatActions.createJournalEntry);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "Ask a read-only question about reports, transactions, balances, contacts, or payroll. Write-like requests become confirmation cards.",
    },
  ]);
  const [proposalStates, setProposalStates] = useState<Record<string, ProposalState>>({});
  const listRef = useRef<HTMLDivElement>(null);
  const lastExternalPromptRef = useRef("");
  const booksContextReady = Boolean(reportPack?.entity.id);

  const submitQuestion = useCallback(async (question: string) => {
    const trimmed = question.trim();
    if (!trimmed || !booksContextReady) return;

    const pendingId = nextMessageId();
    const localAnswer = answerOpenBooksQuestion(trimmed, reportPack);
    const useLiveRuntime = Boolean(
      aiStatus.configured &&
        authToken &&
        workspaceId &&
        shouldUseLiveRuntime(trimmed, localAnswer),
    );
    setMessages((current) => [
      ...current,
      { id: nextMessageId(), role: "user", content: trimmed },
      {
        id: pendingId,
        role: "assistant",
        content: aiStatus.configured ? "Reading your books..." : "Reading available report data in degraded mode...",
        pending: true,
        streaming: useLiveRuntime,
      },
    ]);
    setInput("");

    if (useLiveRuntime && authToken && workspaceId) {
      try {
        const text = await streamLiveAnswer({
          question: trimmed,
          workspaceId,
          entityId: reportPack?.entity.id as Id<"entities"> | undefined,
          token: authToken,
          onChunk: (text) => {
            setMessages((current) =>
              current.map((message) =>
                message.id === pendingId
                  ? { ...message, content: text || "Reading your books...", pending: true, streaming: true }
                  : message,
              ),
            );
          },
        });
        setMessages((current) =>
          current.map((message) =>
            message.id === pendingId
              ? {
                  ...message,
                  content: text || "OpenBooks AI did not return an answer.",
                  pending: false,
                  streaming: false,
                }
              : message,
          ),
        );
      } catch {
        const answer = answerOpenBooksQuestion(trimmed, reportPack);
        setMessages((current) =>
          current.map((message) =>
            message.id === pendingId
              ? {
                  ...message,
                  content: answer.title,
                  answer,
                  pending: false,
                  streaming: false,
                }
              : message,
          ),
        );
      }
      return;
    }

    window.setTimeout(() => {
      setMessages((current) =>
        current.map((message) =>
          message.id === pendingId
            ? { ...message, content: localAnswer.title, answer: localAnswer, pending: false, streaming: false }
            : message,
        ),
      );
    }, 320);
  }, [aiStatus.configured, authToken, booksContextReady, reportPack, workspaceId]);

  const confirmProposal = useCallback(async (messageId: string, answer: ProposalAnswer) => {
    const entityId = reportPack?.entity.id as Id<"entities"> | undefined;
    if (!entityId) {
      setProposalStates((current) => ({
        ...current,
        [messageId]: {
          status: "error",
          message: "Load the entity report context before confirming this action.",
        },
      }));
      return;
    }

    setProposalStates((current) => ({
      ...current,
      [messageId]: { status: "saving", message: "Applying this action after your confirmation..." },
    }));

    try {
      let message: string;
      switch (answer.action) {
        case "createRule": {
          const result = await createConfirmedRule({
            entityId,
            merchantContains: answer.merchantContains,
            autoPost: false,
          });
          message = `Rule ${result.status}; ${answer.merchantContains} will file to ${result.categoryName} after review.`;
          break;
        }
        case "categorizeTransactions": {
          const result = await categorizeTransactions({
            entityId,
            merchantContains: answer.merchantContains,
            categoryAccountNumber: answer.categoryAccountNumber,
            limit: answer.limit,
          });
          message = `${result.updatedCount} transaction${result.updatedCount === 1 ? "" : "s"} categorized as ${result.categoryName}.`;
          break;
        }
        case "draftInvoice": {
          const result = await draftInvoice({
            entityId,
            customerName: answer.customerName,
            amountMinor: answer.amountMinor,
            issueDate: answer.issueDate,
            dueDate: answer.dueDate,
            ...(answer.memo ? { memo: answer.memo } : {}),
          });
          message = `Draft invoice ${result.number} created. No revenue was posted yet.`;
          break;
        }
        case "addBill": {
          const result = await addBill({
            entityId,
            vendorName: answer.vendorName,
            amountMinor: answer.amountMinor,
            issueDate: answer.issueDate,
            dueDate: answer.dueDate,
            expenseAccountNumber: answer.expenseAccountNumber,
          });
          message = `Bill added and posted to A/P through postEntry as ${result.expenseAccountName}.`;
          break;
        }
        case "createJournalEntry": {
          const result = await createJournalEntry({
            entityId,
            date: answer.date,
            memo: answer.memo,
            amountMinor: answer.amountMinor,
            debitAccountNumber: answer.debitAccountNumber,
            creditAccountNumber: answer.creditAccountNumber,
          });
          message = `Balanced journal entry posted. Debits and credits both equal ${formatAiMoney(result.debitTotal, reportPack?.entity.currency)}.`;
          break;
        }
      }
      setProposalStates((current) => ({
        ...current,
        [messageId]: {
          status: "saved",
          message,
        },
      }));
    } catch (error) {
      setProposalStates((current) => ({
        ...current,
        [messageId]: {
          status: "error",
          message: error instanceof Error ? error.message : "Could not create the rule.",
        },
      }));
    }
  }, [
    addBill,
    categorizeTransactions,
    createConfirmedRule,
    createJournalEntry,
    draftInvoice,
    reportPack?.entity.currency,
    reportPack?.entity.id,
  ]);

  useEffect(() => {
    if (!pendingPrompt || pendingPrompt === lastExternalPromptRef.current) return;
    if (!booksContextReady) return;
    lastExternalPromptRef.current = pendingPrompt;
    void submitQuestion(pendingPrompt.split("::")[0]);
  }, [booksContextReady, pendingPrompt, submitQuestion]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  return (
    <div
      className={cn(
        "flex h-full flex-col bg-background",
        mode === "page" && "min-h-[680px] overflow-hidden rounded-lg border shadow-xs",
      )}
      data-testid={mode === "page" ? "m10-ai-chat-page" : "m10-ai-chat-drawer"}
    >
      <div className="flex h-14 items-center justify-between border-b px-4">
        <div className="flex min-w-0 items-center gap-2 text-sm font-semibold">
          <Sparkles className="size-4 text-primary" />
          <span>Ask AI</span>
          <Badge variant="outline" className="ml-1">
            {aiStatus.mode === "active" ? "Bedrock active" : "Degraded mode"}
          </Badge>
        </div>
        <div className="flex items-center gap-1">
          {mode === "drawer" ? (
            <Button aria-label="Open Ask AI full page" asChild size="icon-sm" variant="ghost">
              <Link href="/ask-ai">
                <Maximize2 />
              </Link>
            </Button>
          ) : null}
          {onClose ? (
            <Button aria-label="Close Ask AI" size="icon-sm" variant="ghost" onClick={onClose}>
              <PanelRightClose />
            </Button>
          ) : null}
        </div>
      </div>

      <div className="border-b bg-muted/30 px-4 py-3">
        <div className="flex items-start gap-2 rounded-lg border bg-background p-3">
          <CheckCircle2 className="mt-0.5 size-4 text-primary" />
          <div className="min-w-0">
            <div className="text-sm font-medium">{aiStatus.label}</div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{aiStatus.detail}</p>
            <div className="mt-2 text-xs text-muted-foreground">Context: {contextLabel}</div>
          </div>
        </div>
      </div>

      <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.map((message) => (
          <div
            key={message.id}
            className={cn(
              "max-w-[92%] rounded-lg border px-3 py-2 text-sm shadow-xs",
              message.role === "user"
                ? "ml-auto bg-primary text-primary-foreground"
                : "bg-card text-card-foreground",
              message.pending && "text-muted-foreground",
            )}
          >
            <div>{message.content}</div>
            {message.answer ? (
              <AnswerCard
                answer={message.answer}
                proposalState={proposalStates[message.id]}
                onConfirmProposal={
                  message.answer.kind === "proposal"
                    ? (answer) => void confirmProposal(message.id, answer)
                    : undefined
                }
              />
            ) : null}
          </div>
        ))}
      </div>

      <div className="border-t bg-background p-4">
        <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
          {aiSuggestedPrompts.map((prompt) => (
            <Button
              key={prompt}
              className="shrink-0"
              disabled={!booksContextReady}
              size="sm"
              type="button"
              variant="outline"
              onClick={() => void submitQuestion(prompt)}
            >
              {prompt}
            </Button>
          ))}
        </div>
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void submitQuestion(input);
          }}
        >
          <Input
            aria-label="Ask about your books"
            disabled={!booksContextReady}
            placeholder={booksContextReady ? "Ask about your books" : "Loading books context"}
            value={input}
            onChange={(event) => setInput(event.target.value)}
          />
          <Button aria-label="Send question" disabled={!booksContextReady} size="icon" type="submit">
            <ArrowUp className="size-4" />
          </Button>
        </form>
      </div>
    </div>
  );
}
