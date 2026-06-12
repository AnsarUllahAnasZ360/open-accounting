import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { Agent, mockModel, stepCountIs } from "@convex-dev/agent";

// The agent's `languageModel` expects a LanguageModelV3. Both mockModel(...)
// and bedrock(modelId) return one; derive the type from mockModel so we don't
// depend on a non-hoisted @ai-sdk/provider path.
type AgentLanguageModel = ReturnType<typeof mockModel>;

import { components } from "./_generated/api";
import { resolveAIProviderRegistry } from "./aiProviderRegistry";
import { openBooksReadTools } from "./agentTools";

/**
 * OpenBooks Ask AI agent (Epic B).
 *
 * The product rule is "AI proposes, the ledger engine posts." This agent has
 * read-only tools plus side-effect-free propose-* tools (see agentTools.ts).
 * It never writes to the ledger. All confirmations run through the existing
 * server paths via the `proposals` table.
 */

const AGENT_NAME = "openbooks-ask-ai";

export const OPENBOOKS_AGENT_INSTRUCTIONS = [
  "You are OpenBooks AI, a plain-English bookkeeping copilot for a small-business owner.",
  "The hidden double-entry ledger is the source of truth. Always use the read tools (getReport, getBalances, queryTransactions, searchContacts, getPayrollRuns) before answering questions about transactions, reports, balances, contacts, or payroll. Never guess numbers.",
  "AI proposes, the ledger engine posts. You can NEVER post, change, delete, pay, invoice, or journal anything yourself.",
  "When the owner asks you to take an action (categorize, create a rule, draft an invoice, add a bill, or make a journal entry), you MUST call the matching propose-* tool before answering. That records a proposal the owner must confirm; it changes nothing on its own. Never say a proposal is prepared, recorded, created, or ready unless a propose-* tool returned a proposalId.",
  "Speak in plain English: say 'money you're owed' rather than 'accounts receivable' outside of report titles. Use sentence case. Be concise and concrete.",
  "Format integer minor-unit money values as currency, e.g. 12345 means $123.45. Use Markdown (tables, bold, lists) so the answer renders cleanly.",
  "Do not expose internal database IDs unless the owner explicitly asks for technical trace details.",
].join("\n");

type EnvValue = string | null;

function envValue(name: string): EnvValue {
  return process.env[name]?.trim() || null;
}

/**
 * Resolve whether Bedrock is configured for chat. Mirrors the env-driven
 * provider registry so chat degrades exactly like the categorizer.
 */
export function aiChatRuntimeStatus() {
  const registry = resolveAIProviderRegistry();
  const active =
    registry.mode === "active" &&
    registry.activeProvider === "bedrock" &&
    Boolean(registry.model) &&
    Boolean(registry.region);
  return {
    mode: active ? ("active" as const) : ("degraded" as const),
    provider: registry.activeProvider === "bedrock" ? ("bedrock" as const) : null,
    model: active ? registry.model : null,
    region: active ? registry.region : null,
    degradedReason:
      active
        ? null
        : registry.degradedReason ??
          "AI provider is not configured. Set the Bedrock environment variables to enable Ask AI.",
  };
}

export function isAiChatConfigured() {
  return aiChatRuntimeStatus().mode === "active";
}

/**
 * Build the language model for the agent. When Bedrock env is present we
 * construct the real fetch-based Bedrock model. When absent we return a
 * mock model so the Agent constructor never crashes at module load; the
 * mock is never actually invoked because every generation path is gated on
 * {@link isAiChatConfigured} and returns a documented degraded result first.
 */
function buildLanguageModel(): AgentLanguageModel {
  const status = aiChatRuntimeStatus();
  if (status.mode !== "active" || !status.model || !status.region) {
    return mockModel({
      content: [
        {
          type: "text",
          text: "OpenBooks AI is not configured. Set the Bedrock environment variables to enable Ask AI.",
        },
      ],
    });
  }
  const bedrock = createAmazonBedrock({
    region: status.region,
    accessKeyId: envValue("AWS_ACCESS_KEY_ID") ?? undefined,
    secretAccessKey: envValue("AWS_SECRET_ACCESS_KEY") ?? undefined,
    sessionToken: envValue("AWS_SESSION_TOKEN") ?? undefined,
    apiKey: envValue("AWS_BEARER_TOKEN_BEDROCK") ?? undefined,
  });
  return bedrock(status.model) as AgentLanguageModel;
}

export const openBooksAgent = new Agent(components.agent, {
  name: AGENT_NAME,
  languageModel: buildLanguageModel(),
  instructions: OPENBOOKS_AGENT_INSTRUCTIONS,
  tools: openBooksReadTools,
  stopWhen: stepCountIs(5),
});

export { AGENT_NAME };
