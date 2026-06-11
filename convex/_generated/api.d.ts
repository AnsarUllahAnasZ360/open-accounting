/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as ai from "../ai.js";
import type * as aiProviderRegistry from "../aiProviderRegistry.js";
import type * as aiSdkRuntime from "../aiSdkRuntime.js";
import type * as auth from "../auth.js";
import type * as authAdmin from "../authAdmin.js";
import type * as authz from "../authz.js";
import type * as bedrockCategorizer from "../bedrockCategorizer.js";
import type * as coreViews from "../coreViews.js";
import type * as http from "../http.js";
import type * as ledger from "../ledger.js";
import type * as moduleViews from "../moduleViews.js";
import type * as money from "../money.js";
import type * as pipeline from "../pipeline.js";
import type * as plaid from "../plaid.js";
import type * as receipts from "../receipts.js";
import type * as reportViews from "../reportViews.js";
import type * as reports from "../reports.js";
import type * as requestAccess from "../requestAccess.js";
import type * as seedDemo from "../seedDemo.js";
import type * as semanticMemory from "../semanticMemory.js";
import type * as session from "../session.js";
import type * as stripe from "../stripe.js";
import type * as stripeWebhook from "../stripeWebhook.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  ai: typeof ai;
  aiProviderRegistry: typeof aiProviderRegistry;
  aiSdkRuntime: typeof aiSdkRuntime;
  auth: typeof auth;
  authAdmin: typeof authAdmin;
  authz: typeof authz;
  bedrockCategorizer: typeof bedrockCategorizer;
  coreViews: typeof coreViews;
  http: typeof http;
  ledger: typeof ledger;
  moduleViews: typeof moduleViews;
  money: typeof money;
  pipeline: typeof pipeline;
  plaid: typeof plaid;
  receipts: typeof receipts;
  reportViews: typeof reportViews;
  reports: typeof reports;
  requestAccess: typeof requestAccess;
  seedDemo: typeof seedDemo;
  semanticMemory: typeof semanticMemory;
  session: typeof session;
  stripe: typeof stripe;
  stripeWebhook: typeof stripeWebhook;
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

export declare const components: {};
