/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agent from "../agent.js";
import type * as agentToolQueries from "../agentToolQueries.js";
import type * as agentTools from "../agentTools.js";
import type * as ai from "../ai.js";
import type * as aiChatActions from "../aiChatActions.js";
import type * as aiChatRuntime from "../aiChatRuntime.js";
import type * as aiChatTools from "../aiChatTools.js";
import type * as aiProviderRegistry from "../aiProviderRegistry.js";
import type * as aiSdkRuntime from "../aiSdkRuntime.js";
import type * as aiThreads from "../aiThreads.js";
import type * as auth from "../auth.js";
import type * as authAdmin from "../authAdmin.js";
import type * as authz from "../authz.js";
import type * as bedrockCategorizer from "../bedrockCategorizer.js";
import type * as bills from "../bills.js";
import type * as categories from "../categories.js";
import type * as coreViews from "../coreViews.js";
import type * as entities from "../entities.js";
import type * as expensesViews from "../expensesViews.js";
import type * as http from "../http.js";
import type * as incomeViews from "../incomeViews.js";
import type * as invoices from "../invoices.js";
import type * as ledger from "../ledger.js";
import type * as moduleViews from "../moduleViews.js";
import type * as money from "../money.js";
import type * as payroll from "../payroll.js";
import type * as payrollMath from "../payrollMath.js";
import type * as pipeline from "../pipeline.js";
import type * as plaid from "../plaid.js";
import type * as proposals from "../proposals.js";
import type * as receipts from "../receipts.js";
import type * as reportViews from "../reportViews.js";
import type * as reports from "../reports.js";
import type * as requestAccess from "../requestAccess.js";
import type * as rules from "../rules.js";
import type * as seedDemo from "../seedDemo.js";
import type * as semanticMemory from "../semanticMemory.js";
import type * as session from "../session.js";
import type * as settings from "../settings.js";
import type * as stripe from "../stripe.js";
import type * as stripeWebhook from "../stripeWebhook.js";
import type * as team from "../team.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agent: typeof agent;
  agentToolQueries: typeof agentToolQueries;
  agentTools: typeof agentTools;
  ai: typeof ai;
  aiChatActions: typeof aiChatActions;
  aiChatRuntime: typeof aiChatRuntime;
  aiChatTools: typeof aiChatTools;
  aiProviderRegistry: typeof aiProviderRegistry;
  aiSdkRuntime: typeof aiSdkRuntime;
  aiThreads: typeof aiThreads;
  auth: typeof auth;
  authAdmin: typeof authAdmin;
  authz: typeof authz;
  bedrockCategorizer: typeof bedrockCategorizer;
  bills: typeof bills;
  categories: typeof categories;
  coreViews: typeof coreViews;
  entities: typeof entities;
  expensesViews: typeof expensesViews;
  http: typeof http;
  incomeViews: typeof incomeViews;
  invoices: typeof invoices;
  ledger: typeof ledger;
  moduleViews: typeof moduleViews;
  money: typeof money;
  payroll: typeof payroll;
  payrollMath: typeof payrollMath;
  pipeline: typeof pipeline;
  plaid: typeof plaid;
  proposals: typeof proposals;
  receipts: typeof receipts;
  reportViews: typeof reportViews;
  reports: typeof reports;
  requestAccess: typeof requestAccess;
  rules: typeof rules;
  seedDemo: typeof seedDemo;
  semanticMemory: typeof semanticMemory;
  session: typeof session;
  settings: typeof settings;
  stripe: typeof stripe;
  stripeWebhook: typeof stripeWebhook;
  team: typeof team;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  agent: import("@convex-dev/agent/_generated/component.js").ComponentApi<"agent">;
};
