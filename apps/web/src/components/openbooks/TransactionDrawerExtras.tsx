"use client";

import { useMutation, useQuery } from "convex/react";
import { FileText, ImageIcon, Send, Upload } from "lucide-react";
import { useRef, useState } from "react";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { formatMinorMoney } from "@/components/openbooks/primitives";
import { AttentionState } from "@/components/openbooks/workbench";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

function formatStamp(ms: number) {
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Owner/team notes on a transaction. Reads + posts through the
 * transactionComments backend; ⌘/Ctrl+Enter posts.
 */
export function CommentsThread({
  transactionId,
}: {
  transactionId: string;
}) {
  const comments = useQuery(api.transactionComments.listTransactionComments, {
    transactionId: transactionId as Id<"transactions">,
  });
  const addComment = useMutation(api.transactionComments.addTransactionComment);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);

  async function submit() {
    const trimmed = text.trim();
    if (!trimmed) return;
    setPending(true);
    try {
      await addComment({ transactionId: transactionId as Id<"transactions">, text: trimmed });
      setText("");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="rounded-[14px] ring-1 ring-foreground/10">
      <div className="border-b px-3 py-2 text-sm font-semibold">Comments</div>
      <div className="flex max-h-56 flex-col divide-y overflow-y-auto">
        {comments === undefined ? (
          <div className="px-3 py-3 text-sm text-muted-foreground">Loading…</div>
        ) : comments.length === 0 ? (
          <div className="px-3 py-3 text-sm text-muted-foreground">No comments yet. Add a note for your team.</div>
        ) : (
          comments.map((comment) => (
            <div key={comment.id} className="px-3 py-2 text-sm" data-testid="transaction-comment">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{comment.authorName ?? "Teammate"}</span>
                <span className="money-figures text-xs text-muted-foreground">{formatStamp(comment.createdAt)}</span>
              </div>
              <p className="whitespace-pre-wrap text-muted-foreground">{comment.text}</p>
            </div>
          ))
        )}
      </div>
      <div className="flex items-end gap-2 border-t p-2">
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void submit();
            }
          }}
          placeholder="Add a comment…"
          data-testid="comment-input"
          className="min-h-9 flex-1 resize-none rounded-[10px] border bg-background p-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
        <Button
          size="icon-sm"
          onClick={() => void submit()}
          disabled={pending || !text.trim()}
          aria-label="Post comment"
          data-testid="comment-post"
        >
          <Send />
        </Button>
      </div>
    </div>
  );
}

type AttachmentRow = {
  id: string;
  kind: string;
  fileName: string | null;
  mimeType: string | null;
  vendor: string;
  date: string;
  totalMinor: number;
  status: string;
  fileUrl: string | null;
};

/**
 * Upload a receipt/attachment to a transaction and view it inline (image or PDF)
 * via a signed URL. Reuses the receipts storage pipeline (generateUploadUrl →
 * POST → attachToTransaction) and the lazy transactionAttachments query.
 */
export function AttachmentPanel({
  transactionId,
  entityId,
  currency = "USD",
  isExpense = false,
}: {
  transactionId: string;
  entityId?: string;
  currency?: string;
  isExpense?: boolean;
}) {
  const attachments = useQuery(api.coreViews.transactionAttachments, {
    transactionId: transactionId as Id<"transactions">,
    ...(entityId ? { entityId: entityId as Id<"entities"> } : {}),
  }) as AttachmentRow[] | undefined;
  const generateUploadUrl = useMutation(api.receipts.generateUploadUrl);
  const attach = useMutation(api.receipts.attachToTransaction);
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<AttachmentRow | null>(null);

  async function handleFile(file: File) {
    if (!entityId) return;
    setUploading(true);
    try {
      const uploadUrl = await generateUploadUrl({ entityId: entityId as Id<"entities"> });
      const result = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      const { storageId } = (await result.json()) as { storageId: string };
      await attach({
        transactionId: transactionId as Id<"transactions">,
        storageId: storageId as Id<"_storage">,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
      });
    } finally {
      setUploading(false);
    }
  }

  const list = attachments ?? [];

  return (
    <div className="rounded-[14px] ring-1 ring-foreground/10">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2 text-sm font-semibold">
        <span>Attachments</span>
        <Button
          size="xs"
          variant="outline"
          onClick={() => inputRef.current?.click()}
          disabled={uploading || !entityId}
          data-testid="attachment-upload"
        >
          <Upload data-icon="inline-start" />
          {uploading ? "Uploading…" : "Attach"}
        </Button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleFile(file);
          event.target.value = "";
        }}
      />
      {attachments === undefined ? (
        <div className="px-3 py-3 text-sm text-muted-foreground">Loading…</div>
      ) : list.length === 0 ? (
        <div className="flex flex-col gap-2 px-3 py-3 text-sm text-muted-foreground">
          {isExpense ? <AttentionState state="missing-evidence" /> : null}
          No attachments yet. Add a receipt or document.
        </div>
      ) : (
        <div className="flex flex-col divide-y">
          {list.map((attachment) => {
            const isImage = (attachment.mimeType ?? "").startsWith("image/");
            return (
              <div key={attachment.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                {isImage ? (
                  <ImageIcon className="size-4 shrink-0 text-muted-foreground" />
                ) : (
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{attachment.fileName ?? attachment.vendor}</div>
                  {attachment.totalMinor > 0 ? (
                    <div className="money-figures text-xs text-muted-foreground">
                      {formatMinorMoney(attachment.totalMinor, { currency })} · {attachment.date}
                    </div>
                  ) : null}
                </div>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => setPreview(attachment)}
                  disabled={!attachment.fileUrl}
                  data-testid="attachment-view"
                >
                  View
                </Button>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={preview != null} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="truncate">{preview?.fileName ?? preview?.vendor ?? "Attachment"}</DialogTitle>
            <DialogDescription>Receipt / document preview.</DialogDescription>
          </DialogHeader>
          {preview?.fileUrl ? (
            (preview.mimeType ?? "").startsWith("image/") ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview.fileUrl} alt={preview.fileName ?? "Attachment"} className="max-h-[70vh] w-full rounded-md object-contain" />
            ) : (
              <iframe src={preview.fileUrl} title="Attachment" className={cn("h-[70vh] w-full rounded-md border")} />
            )
          ) : (
            <p className="text-sm text-muted-foreground">No preview available.</p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
