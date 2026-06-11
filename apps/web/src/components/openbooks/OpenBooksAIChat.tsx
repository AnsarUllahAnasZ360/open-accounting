"use client";

import { useMutation } from "convex/react";
import { ArrowUp, CheckCircle2, CircleAlert, PanelRightClose, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  aiSuggestedPrompts,
  answerOpenBooksQuestion,
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
};

type ProposalAnswer = Extract<AiAnswer, { kind: "proposal" }>;
type ProposalState = {
  status: "idle" | "saving" | "saved" | "error";
  message?: string;
};

function nextMessageId() {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
  pendingPrompt,
  onClose,
}: {
  contextLabel: string;
  reportPack: ReportPack | undefined;
  aiStatus: AiStatus;
  pendingPrompt?: string;
  onClose: () => void;
}) {
  const createConfirmedRule = useMutation(api.ai.createConfirmedRule);
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

  const submitQuestion = useCallback((question: string) => {
    const trimmed = question.trim();
    if (!trimmed) return;

    const pendingId = nextMessageId();
    setMessages((current) => [
      ...current,
      { id: nextMessageId(), role: "user", content: trimmed },
      {
        id: pendingId,
        role: "assistant",
        content: aiStatus.configured ? "Reading your books..." : "Reading available report data in degraded mode...",
        pending: true,
      },
    ]);
    setInput("");

    window.setTimeout(() => {
      const answer = answerOpenBooksQuestion(trimmed, reportPack);
      setMessages((current) =>
        current.map((message) =>
          message.id === pendingId
            ? { ...message, content: answer.title, answer, pending: false }
            : message,
        ),
      );
    }, 320);
  }, [aiStatus.configured, reportPack]);

  const confirmProposal = useCallback(async (messageId: string, answer: ProposalAnswer) => {
    if (!reportPack?.entity.id) {
      setProposalStates((current) => ({
        ...current,
        [messageId]: {
          status: "error",
          message: "Load the entity report context before confirming this rule.",
        },
      }));
      return;
    }

    setProposalStates((current) => ({
      ...current,
      [messageId]: { status: "saving", message: "Creating the rule after your confirmation..." },
    }));

    try {
      const result = await createConfirmedRule({
        entityId: reportPack.entity.id as Id<"entities">,
        merchantContains: answer.merchantContains,
        autoPost: false,
      });
      setProposalStates((current) => ({
        ...current,
        [messageId]: {
          status: "saved",
          message: `Rule ${result.status}; ${answer.merchantContains} will file to ${result.categoryName} after review.`,
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
  }, [createConfirmedRule, reportPack?.entity.id]);

  useEffect(() => {
    if (!pendingPrompt || pendingPrompt === lastExternalPromptRef.current) return;
    lastExternalPromptRef.current = pendingPrompt;
    submitQuestion(pendingPrompt.split("::")[0]);
  }, [pendingPrompt, submitQuestion]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  return (
    <div className="flex h-full flex-col" data-testid="m10-ai-chat-drawer">
      <div className="flex h-14 items-center justify-between border-b px-4">
        <div className="flex min-w-0 items-center gap-2 text-sm font-semibold">
          <Sparkles className="size-4 text-primary" />
          <span>Ask AI</span>
          <Badge variant="outline" className="ml-1">
            {aiStatus.mode === "active" ? "Bedrock active" : "Degraded mode"}
          </Badge>
        </div>
        <Button aria-label="Close Ask AI" size="icon-sm" variant="ghost" onClick={onClose}>
          <PanelRightClose />
        </Button>
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
              size="sm"
              type="button"
              variant="outline"
              onClick={() => submitQuestion(prompt)}
            >
              {prompt}
            </Button>
          ))}
        </div>
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            submitQuestion(input);
          }}
        >
          <Input
            aria-label="Ask about your books"
            placeholder="Ask about your books"
            value={input}
            onChange={(event) => setInput(event.target.value)}
          />
          <Button aria-label="Send question" size="icon" type="submit">
            <ArrowUp className="size-4" />
          </Button>
        </form>
      </div>
    </div>
  );
}
