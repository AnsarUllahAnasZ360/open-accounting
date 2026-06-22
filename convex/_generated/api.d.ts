/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as activeEntity from "../activeEntity.js";
import type * as agent from "../agent.js";
import type * as agentToolQueries from "../agentToolQueries.js";
import type * as agentTools from "../agentTools.js";
import type * as ai from "../ai.js";
import type * as aiCatalog from "../aiCatalog.js";
import type * as aiCategorizeRuntime from "../aiCategorizeRuntime.js";
import type * as aiCfo from "../aiCfo.js";
import type * as aiCfoAggregate from "../aiCfoAggregate.js";
import type * as aiCfoAnomalies from "../aiCfoAnomalies.js";
import type * as aiCfoVerify from "../aiCfoVerify.js";
import type * as aiChatActions from "../aiChatActions.js";
import type * as aiChatRuntime from "../aiChatRuntime.js";
import type * as aiChatTools from "../aiChatTools.js";
import type * as aiInsights from "../aiInsights.js";
import type * as aiInsightsAuth from "../aiInsightsAuth.js";
import type * as aiInsightsVerify from "../aiInsightsVerify.js";
import type * as aiProvider from "../aiProvider.js";
import type * as aiProviderRegistry from "../aiProviderRegistry.js";
import type * as aiResolve from "../aiResolve.js";
import type * as aiSdkRuntime from "../aiSdkRuntime.js";
import type * as aiThreads from "../aiThreads.js";
import type * as audit from "../audit.js";
import type * as auth from "../auth.js";
import type * as authAdmin from "../authAdmin.js";
import type * as authz from "../authz.js";
import type * as bedrockCategorizer from "../bedrockCategorizer.js";
import type * as bills from "../bills.js";
import type * as calibration from "../calibration.js";
import type * as categories from "../categories.js";
import type * as connections from "../connections.js";
import type * as contacts from "../contacts.js";
import type * as coreViews from "../coreViews.js";
import type * as credentials from "../credentials.js";
import type * as crons from "../crons.js";
import type * as defaultBankAccount from "../defaultBankAccount.js";
import type * as demo from "../demo.js";
import type * as demoWorkspace from "../demoWorkspace.js";
import type * as embeddings from "../embeddings.js";
import type * as embeddingsStore from "../embeddingsStore.js";
import type * as entities from "../entities.js";
import type * as entityMetrics from "../entityMetrics.js";
import type * as entityScope from "../entityScope.js";
import type * as expensesViews from "../expensesViews.js";
import type * as exportAccount from "../exportAccount.js";
import type * as fixtures_categorizationGold from "../fixtures/categorizationGold.js";
import type * as http from "../http.js";
import type * as incomeViews from "../incomeViews.js";
import type * as insightsFixtures from "../insightsFixtures.js";
import type * as intercompany from "../intercompany.js";
import type * as invoices from "../invoices.js";
import type * as ledger from "../ledger.js";
import type * as lib_provenance from "../lib/provenance.js";
import type * as moduleViews from "../moduleViews.js";
import type * as money from "../money.js";
import type * as onboarding from "../onboarding.js";
import type * as onboardingProposals from "../onboardingProposals.js";
import type * as payroll from "../payroll.js";
import type * as payrollMath from "../payrollMath.js";
import type * as performance from "../performance.js";
import type * as pipeline from "../pipeline.js";
import type * as plaid from "../plaid.js";
import type * as plaidWebhook from "../plaidWebhook.js";
import type * as plunk from "../plunk.js";
import type * as portfolioMoney from "../portfolioMoney.js";
import type * as portfolioViews from "../portfolioViews.js";
import type * as profile from "../profile.js";
import type * as proposals from "../proposals.js";
import type * as publicDemo from "../publicDemo.js";
import type * as realTestReset from "../realTestReset.js";
import type * as receipts from "../receipts.js";
import type * as reconciliation from "../reconciliation.js";
import type * as reportViews from "../reportViews.js";
import type * as reports from "../reports.js";
import type * as requestAccess from "../requestAccess.js";
import type * as ruleMatcher from "../ruleMatcher.js";
import type * as rules from "../rules.js";
import type * as secretBox from "../secretBox.js";
import type * as secretRedaction from "../secretRedaction.js";
import type * as seedDemo from "../seedDemo.js";
import type * as session from "../session.js";
import type * as settings from "../settings.js";
import type * as stripe from "../stripe.js";
import type * as stripeWebhook from "../stripeWebhook.js";
import type * as systemActors from "../systemActors.js";
import type * as team from "../team.js";
import type * as testSupport from "../testSupport.js";
import type * as transactionComments from "../transactionComments.js";
import type * as unreviewedGap from "../unreviewedGap.js";
import type * as weeklyDigest from "../weeklyDigest.js";
import type * as weeklyDigestData from "../weeklyDigestData.js";
import type * as workspaceReset from "../workspaceReset.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  activeEntity: typeof activeEntity;
  agent: typeof agent;
  agentToolQueries: typeof agentToolQueries;
  agentTools: typeof agentTools;
  ai: typeof ai;
  aiCatalog: typeof aiCatalog;
  aiCategorizeRuntime: typeof aiCategorizeRuntime;
  aiCfo: typeof aiCfo;
  aiCfoAggregate: typeof aiCfoAggregate;
  aiCfoAnomalies: typeof aiCfoAnomalies;
  aiCfoVerify: typeof aiCfoVerify;
  aiChatActions: typeof aiChatActions;
  aiChatRuntime: typeof aiChatRuntime;
  aiChatTools: typeof aiChatTools;
  aiInsights: typeof aiInsights;
  aiInsightsAuth: typeof aiInsightsAuth;
  aiInsightsVerify: typeof aiInsightsVerify;
  aiProvider: typeof aiProvider;
  aiProviderRegistry: typeof aiProviderRegistry;
  aiResolve: typeof aiResolve;
  aiSdkRuntime: typeof aiSdkRuntime;
  aiThreads: typeof aiThreads;
  audit: typeof audit;
  auth: typeof auth;
  authAdmin: typeof authAdmin;
  authz: typeof authz;
  bedrockCategorizer: typeof bedrockCategorizer;
  bills: typeof bills;
  calibration: typeof calibration;
  categories: typeof categories;
  connections: typeof connections;
  contacts: typeof contacts;
  coreViews: typeof coreViews;
  credentials: typeof credentials;
  crons: typeof crons;
  defaultBankAccount: typeof defaultBankAccount;
  demo: typeof demo;
  demoWorkspace: typeof demoWorkspace;
  embeddings: typeof embeddings;
  embeddingsStore: typeof embeddingsStore;
  entities: typeof entities;
  entityMetrics: typeof entityMetrics;
  entityScope: typeof entityScope;
  expensesViews: typeof expensesViews;
  exportAccount: typeof exportAccount;
  "fixtures/categorizationGold": typeof fixtures_categorizationGold;
  http: typeof http;
  incomeViews: typeof incomeViews;
  insightsFixtures: typeof insightsFixtures;
  intercompany: typeof intercompany;
  invoices: typeof invoices;
  ledger: typeof ledger;
  "lib/provenance": typeof lib_provenance;
  moduleViews: typeof moduleViews;
  money: typeof money;
  onboarding: typeof onboarding;
  onboardingProposals: typeof onboardingProposals;
  payroll: typeof payroll;
  payrollMath: typeof payrollMath;
  performance: typeof performance;
  pipeline: typeof pipeline;
  plaid: typeof plaid;
  plaidWebhook: typeof plaidWebhook;
  plunk: typeof plunk;
  portfolioMoney: typeof portfolioMoney;
  portfolioViews: typeof portfolioViews;
  profile: typeof profile;
  proposals: typeof proposals;
  publicDemo: typeof publicDemo;
  realTestReset: typeof realTestReset;
  receipts: typeof receipts;
  reconciliation: typeof reconciliation;
  reportViews: typeof reportViews;
  reports: typeof reports;
  requestAccess: typeof requestAccess;
  ruleMatcher: typeof ruleMatcher;
  rules: typeof rules;
  secretBox: typeof secretBox;
  secretRedaction: typeof secretRedaction;
  seedDemo: typeof seedDemo;
  session: typeof session;
  settings: typeof settings;
  stripe: typeof stripe;
  stripeWebhook: typeof stripeWebhook;
  systemActors: typeof systemActors;
  team: typeof team;
  testSupport: typeof testSupport;
  transactionComments: typeof transactionComments;
  unreviewedGap: typeof unreviewedGap;
  weeklyDigest: typeof weeklyDigest;
  weeklyDigestData: typeof weeklyDigestData;
  workspaceReset: typeof workspaceReset;
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
