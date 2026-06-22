import { Agent, mockModel, stepCountIs } from "@convex-dev/agent";

// The agent's `languageModel` expects a LanguageModelV3. Both mockModel(...)
// and the catalog factory return one; derive the type from mockModel so we
// don't depend on a non-hoisted @ai-sdk/provider path.
type AgentLanguageModel = ReturnType<typeof mockModel>;

import { components } from "./_generated/api";
import { normalizeAiProviderId, type AiProviderId } from "./aiCatalog";
import {
  buildModelForProvider,
  credentialIsComplete,
  resolveCredentialFromEnv,
  resolveModelId,
} from "./aiProvider";
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
  "When the owner asks 'how am I doing', 'what's my runway', 'how long will my cash last', or any cash-survival question, call getRunwayAndBurn and answer from its grounded cash/burn/runway numbers. When they ask 'what should I worry about' or 'what should I do', call getAdvisories and base your answer on those signals (runway, income trend, expense creep, customer concentration, forecast, tax set-aside, anomalies). Cite only the numbers the tool returns; never invent or recompute them.",
  "When comparing periods, call getReport separately for each period being compared. Do not use one combined date range unless the owner explicitly asks for an aggregate.",
  "AI proposes, the ledger engine posts. You can NEVER post, change, delete, pay, invoice, or journal anything yourself.",
  "When the owner asks you to take an action (categorize, create a rule, draft an invoice, add a bill, or make a journal entry), you MUST call the matching propose-* tool before answering. That records a proposal the owner must confirm; it changes nothing on its own. Never say a proposal is prepared, recorded, created, or ready unless a propose-* tool returned a proposalId.",
  "Speak in plain English: say 'money you're owed' rather than 'accounts receivable' outside of report titles. Use sentence case. Be concise and concrete.",
  "Format integer minor-unit money values as currency, e.g. 12345 means $123.45. Use Markdown (tables, bold, lists) so the answer renders cleanly.",
  "Do not expose internal database IDs unless the owner explicitly asks for technical trace details.",
].join("\n");

/**
 * Resolve whether chat is configured from ENV (any catalog provider, not just
 * Bedrock — E3-T3). The Bedrock env registry is consulted first for back-compat;
 * otherwise any catalog provider with a complete env credential counts. Note
 * this is the env-only gate used at module load for the singleton agent; the
 * per-workspace BYO path lives in aiChatRuntime.ts via resolveActiveAiModel.
 */
export function aiChatRuntimeStatus() {
  const registry = resolveAIProviderRegistry();
  const bedrockActive =
    registry.mode === "active" &&
    registry.activeProvider === "bedrock" &&
    Boolean(registry.model) &&
    Boolean(registry.region);
  if (bedrockActive) {
    return {
      mode: "active" as const,
      provider: "bedrock" as const,
      model: registry.model,
      region: registry.region,
      degradedReason: null,
    };
  }

  const providerId: AiProviderId = normalizeAiProviderId(process.env.AI_PROVIDER) ?? "bedrock";
  const credential = resolveCredentialFromEnv(providerId);
  if (credentialIsComplete(providerId, credential)) {
    return {
      mode: "active" as const,
      provider: providerId,
      model: resolveModelId(providerId, process.env.AI_MODEL ?? null),
      region: credential.region ?? null,
      degradedReason: null,
    };
  }

  return {
    mode: "degraded" as const,
    provider: null,
    model: null,
    region: null,
    degradedReason:
      registry.degradedReason ??
      "AI provider is not configured. Add a provider key in Settings → AI to enable Ask AI.",
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
  // Provider-agnostic (E3-T3): build the agent's model from whichever catalog
  // provider's env credential is configured, not a hardcoded Bedrock path. When
  // nothing is configured, return a mock so the Agent constructor never crashes
  // at module load; every generation path is gated on isAiChatConfigured first.
  const providerId: AiProviderId = normalizeAiProviderId(process.env.AI_PROVIDER) ?? "bedrock";
  const credential = resolveCredentialFromEnv(providerId);
  if (!credentialIsComplete(providerId, credential)) {
    return mockModel({
      content: [
        {
          type: "text",
          text: "OpenBooks AI is not configured. Add a provider key in Settings → AI to enable Ask AI.",
        },
      ],
    });
  }
  const modelId = resolveModelId(providerId, process.env.AI_MODEL ?? null);
  return buildModelForProvider({ providerId, modelId, credential }) as AgentLanguageModel;
}

export const openBooksAgent = new Agent(components.agent, {
  name: AGENT_NAME,
  languageModel: buildLanguageModel(),
  instructions: OPENBOOKS_AGENT_INSTRUCTIONS,
  tools: openBooksReadTools,
  stopWhen: stepCountIs(5),
});

export { AGENT_NAME };
