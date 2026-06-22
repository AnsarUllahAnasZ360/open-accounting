/**
 * E14-T4 — Committed label-safe categorization gold dataset + accuracy scoring.
 *
 * DATASET PROVENANCE & LABEL-SAFETY GUARANTEE
 * -------------------------------------------
 * Every row below is a SYNTHESIZED, human-confirmed example. There is NO live
 * PII, no real customer name, no real bank/card number, and no copied
 * statement line. Merchant strings are invented but realistic, modeled on the
 * three real OpenBooks income streams (marketing services, the Z360
 * platform/usage/setup, and AI consulting) plus the expenses a small services
 * business actually sees. Each row's `expectedAccountNumber` is the
 * double-entry category an accountant would post it to, using the standard
 * OpenBooks chart of accounts (see convex/ledger.ts STANDARD_CHART). Because
 * the labels are fixed and committed, categorization quality is measured the
 * SAME way on every run, and the eval emits no secrets and needs no live AI key.
 *
 * This file is intentionally free of any `convex/_generated` import so it can be
 * consumed by both Convex functions and pure unit tests.
 */

export type CategorizationGoldRow = {
  /** Stable id so a prediction can be paired back to its gold row. */
  id: string;
  merchant: string;
  description: string;
  /** Integer minor units (cents). Negative = money out, positive = money in. */
  amountMinor: number;
  currency: string;
  /** The chart-of-accounts number the txn should be categorized to. */
  expectedAccountNumber: string;
  expectedAccountName: string;
};

/**
 * The committed gold set. >= 60 label-safe rows. Keep additions label-safe:
 * synthesized merchants only, no real PII.
 */
export const CATEGORIZATION_GOLD: readonly CategorizationGoldRow[] = [
  // --- Income: marketing services ---
  { id: "g001", merchant: "Northwind Retail", description: "Marketing retainer — June", amountMinor: 350_000, currency: "USD", expectedAccountNumber: "4100", expectedAccountName: "Services" },
  { id: "g002", merchant: "Brightwave Studios", description: "Campaign management fee", amountMinor: 180_000, currency: "USD", expectedAccountNumber: "4100", expectedAccountName: "Services" },
  { id: "g003", merchant: "Cedar & Co", description: "Social media services invoice", amountMinor: 120_000, currency: "USD", expectedAccountNumber: "4100", expectedAccountName: "Services" },
  { id: "g004", merchant: "Lumen Apparel", description: "Brand strategy engagement", amountMinor: 275_000, currency: "USD", expectedAccountNumber: "4100", expectedAccountName: "Services" },
  { id: "g005", merchant: "Harbor Foods", description: "Paid ads management — monthly", amountMinor: 90_000, currency: "USD", expectedAccountNumber: "4100", expectedAccountName: "Services" },
  // --- Income: Z360 platform / usage / setup ---
  { id: "g006", merchant: "Z360 Platform", description: "Z360 platform subscription — Acme Dental", amountMinor: 49_900, currency: "USD", expectedAccountNumber: "4000", expectedAccountName: "Sales" },
  { id: "g007", merchant: "Z360 Platform", description: "Z360 usage overage — messaging", amountMinor: 12_300, currency: "USD", expectedAccountNumber: "4000", expectedAccountName: "Sales" },
  { id: "g008", merchant: "Z360 Platform", description: "Z360 onboarding & setup fee", amountMinor: 75_000, currency: "USD", expectedAccountNumber: "4000", expectedAccountName: "Sales" },
  { id: "g009", merchant: "Z360 Platform", description: "Z360 platform subscription — Riverside Clinic", amountMinor: 49_900, currency: "USD", expectedAccountNumber: "4000", expectedAccountName: "Sales" },
  { id: "g010", merchant: "Z360 Platform", description: "Z360 usage — automation runs", amountMinor: 8_400, currency: "USD", expectedAccountNumber: "4000", expectedAccountName: "Sales" },
  // --- Income: AI consulting ---
  { id: "g011", merchant: "Meridian Health", description: "AI strategy consulting — phase 1", amountMinor: 500_000, currency: "USD", expectedAccountNumber: "4100", expectedAccountName: "Services" },
  { id: "g012", merchant: "Pinecrest Labs", description: "LLM integration consulting", amountMinor: 320_000, currency: "USD", expectedAccountNumber: "4100", expectedAccountName: "Services" },
  { id: "g013", merchant: "Oakline Group", description: "AI workshop facilitation", amountMinor: 150_000, currency: "USD", expectedAccountNumber: "4100", expectedAccountName: "Services" },
  { id: "g014", merchant: "Solstice Media", description: "AI advisory retainer", amountMinor: 200_000, currency: "USD", expectedAccountNumber: "4100", expectedAccountName: "Services" },
  { id: "g015", merchant: "Vertex Realty", description: "AI consulting — model evaluation", amountMinor: 240_000, currency: "USD", expectedAccountNumber: "4100", expectedAccountName: "Services" },
  // --- Software & SaaS ---
  { id: "g016", merchant: "Notion Labs", description: "Notion team subscription", amountMinor: -4_999, currency: "USD", expectedAccountNumber: "5200", expectedAccountName: "Software & SaaS" },
  { id: "g017", merchant: "Figma", description: "Figma professional seats", amountMinor: -9_000, currency: "USD", expectedAccountNumber: "5200", expectedAccountName: "Software & SaaS" },
  { id: "g018", merchant: "Linear", description: "Linear standard plan", amountMinor: -8_000, currency: "USD", expectedAccountNumber: "5200", expectedAccountName: "Software & SaaS" },
  { id: "g019", merchant: "1Password", description: "1Password business subscription", amountMinor: -7_960, currency: "USD", expectedAccountNumber: "5200", expectedAccountName: "Software & SaaS" },
  { id: "g020", merchant: "Slack", description: "Slack pro monthly", amountMinor: -8_750, currency: "USD", expectedAccountNumber: "5200", expectedAccountName: "Software & SaaS" },
  { id: "g021", merchant: "Adobe", description: "Adobe Creative Cloud", amountMinor: -5_999, currency: "USD", expectedAccountNumber: "5200", expectedAccountName: "Software & SaaS" },
  // --- Cloud / infrastructure ---
  { id: "g022", merchant: "Amazon Web Services", description: "AWS — June compute", amountMinor: -42_310, currency: "USD", expectedAccountNumber: "5300", expectedAccountName: "Cloud/Infrastructure" },
  { id: "g023", merchant: "Vercel", description: "Vercel Pro hosting", amountMinor: -20_000, currency: "USD", expectedAccountNumber: "5300", expectedAccountName: "Cloud/Infrastructure" },
  { id: "g024", merchant: "Cloudflare", description: "Cloudflare workers + DNS", amountMinor: -2_500, currency: "USD", expectedAccountNumber: "5300", expectedAccountName: "Cloud/Infrastructure" },
  { id: "g025", merchant: "Convex", description: "Convex backend usage", amountMinor: -2_500, currency: "USD", expectedAccountNumber: "5300", expectedAccountName: "Cloud/Infrastructure" },
  { id: "g026", merchant: "OpenAI", description: "OpenAI API usage — June", amountMinor: -18_640, currency: "USD", expectedAccountNumber: "5300", expectedAccountName: "Cloud/Infrastructure" },
  { id: "g027", merchant: "Anthropic", description: "Anthropic API usage — June", amountMinor: -22_100, currency: "USD", expectedAccountNumber: "5300", expectedAccountName: "Cloud/Infrastructure" },
  // --- Marketing & ads ---
  { id: "g028", merchant: "Google Ads", description: "Google Ads — search campaign", amountMinor: -65_000, currency: "USD", expectedAccountNumber: "5400", expectedAccountName: "Marketing & Ads" },
  { id: "g029", merchant: "Meta Platforms", description: "Meta ads — June", amountMinor: -48_000, currency: "USD", expectedAccountNumber: "5400", expectedAccountName: "Marketing & Ads" },
  { id: "g030", merchant: "LinkedIn", description: "LinkedIn sponsored content", amountMinor: -30_000, currency: "USD", expectedAccountNumber: "5400", expectedAccountName: "Marketing & Ads" },
  { id: "g031", merchant: "Mailchimp", description: "Mailchimp email marketing", amountMinor: -3_499, currency: "USD", expectedAccountNumber: "5400", expectedAccountName: "Marketing & Ads" },
  // --- Professional services ---
  { id: "g032", merchant: "Stripe Atlas", description: "Legal formation services", amountMinor: -50_000, currency: "USD", expectedAccountNumber: "5500", expectedAccountName: "Professional Services" },
  { id: "g033", merchant: "Gusto Accounting", description: "Bookkeeping services — June", amountMinor: -40_000, currency: "USD", expectedAccountNumber: "5500", expectedAccountName: "Professional Services" },
  { id: "g034", merchant: "Riley Tax LLP", description: "Tax preparation services", amountMinor: -120_000, currency: "USD", expectedAccountNumber: "5500", expectedAccountName: "Professional Services" },
  { id: "g035", merchant: "Halifax Legal", description: "Contract review legal fees", amountMinor: -85_000, currency: "USD", expectedAccountNumber: "5500", expectedAccountName: "Professional Services" },
  // --- Payment processing fees ---
  { id: "g036", merchant: "Stripe", description: "Stripe processing fees — June", amountMinor: -11_240, currency: "USD", expectedAccountNumber: "5600", expectedAccountName: "Payment Processing Fees" },
  { id: "g037", merchant: "PayPal", description: "PayPal transaction fees", amountMinor: -3_120, currency: "USD", expectedAccountNumber: "5600", expectedAccountName: "Payment Processing Fees" },
  { id: "g038", merchant: "Square", description: "Square card processing fee", amountMinor: -2_640, currency: "USD", expectedAccountNumber: "5600", expectedAccountName: "Payment Processing Fees" },
  // --- Meals ---
  { id: "g039", merchant: "Blue Bottle Coffee", description: "Client coffee meeting", amountMinor: -1_850, currency: "USD", expectedAccountNumber: "5800", expectedAccountName: "Meals" },
  { id: "g040", merchant: "Sweetgreen", description: "Team lunch", amountMinor: -4_320, currency: "USD", expectedAccountNumber: "5800", expectedAccountName: "Meals" },
  { id: "g041", merchant: "Olive Tree Bistro", description: "Client dinner", amountMinor: -12_400, currency: "USD", expectedAccountNumber: "5800", expectedAccountName: "Meals" },
  { id: "g042", merchant: "Corner Cafe", description: "Working lunch with partner", amountMinor: -2_675, currency: "USD", expectedAccountNumber: "5800", expectedAccountName: "Meals" },
  // --- Travel ---
  { id: "g043", merchant: "United Airlines", description: "Flight to client onsite", amountMinor: -41_200, currency: "USD", expectedAccountNumber: "5900", expectedAccountName: "Travel" },
  { id: "g044", merchant: "Marriott", description: "Hotel — conference", amountMinor: -28_900, currency: "USD", expectedAccountNumber: "5900", expectedAccountName: "Travel" },
  { id: "g045", merchant: "Uber", description: "Ride to airport", amountMinor: -3_450, currency: "USD", expectedAccountNumber: "5900", expectedAccountName: "Travel" },
  { id: "g046", merchant: "Lyft", description: "Ride from client meeting", amountMinor: -2_180, currency: "USD", expectedAccountNumber: "5900", expectedAccountName: "Travel" },
  { id: "g047", merchant: "Amtrak", description: "Train to regional office", amountMinor: -9_600, currency: "USD", expectedAccountNumber: "5900", expectedAccountName: "Travel" },
  // --- Office & supplies ---
  { id: "g048", merchant: "Staples", description: "Office supplies restock", amountMinor: -6_780, currency: "USD", expectedAccountNumber: "6000", expectedAccountName: "Office & Supplies" },
  { id: "g049", merchant: "Amazon", description: "Desk monitor stand", amountMinor: -4_999, currency: "USD", expectedAccountNumber: "6000", expectedAccountName: "Office & Supplies" },
  { id: "g050", merchant: "IKEA", description: "Office chair", amountMinor: -19_900, currency: "USD", expectedAccountNumber: "6000", expectedAccountName: "Office & Supplies" },
  { id: "g051", merchant: "Best Buy", description: "USB-C dock", amountMinor: -8_999, currency: "USD", expectedAccountNumber: "6000", expectedAccountName: "Office & Supplies" },
  // --- Utilities ---
  { id: "g052", merchant: "Comcast Business", description: "Office internet — June", amountMinor: -11_000, currency: "USD", expectedAccountNumber: "6100", expectedAccountName: "Utilities" },
  { id: "g053", merchant: "Pacific Power", description: "Electricity — June", amountMinor: -7_350, currency: "USD", expectedAccountNumber: "6100", expectedAccountName: "Utilities" },
  { id: "g054", merchant: "AT&T", description: "Business phone line", amountMinor: -5_500, currency: "USD", expectedAccountNumber: "6100", expectedAccountName: "Utilities" },
  // --- Rent ---
  { id: "g055", merchant: "Hudson Property Mgmt", description: "Office rent — June", amountMinor: -210_000, currency: "USD", expectedAccountNumber: "5100", expectedAccountName: "Rent" },
  { id: "g056", merchant: "WeWork", description: "Coworking membership", amountMinor: -45_000, currency: "USD", expectedAccountNumber: "5100", expectedAccountName: "Rent" },
  // --- Payroll & contractors ---
  { id: "g057", merchant: "Upwork", description: "Contractor — design work", amountMinor: -60_000, currency: "USD", expectedAccountNumber: "5000", expectedAccountName: "Payroll & Contractors" },
  { id: "g058", merchant: "Toptal", description: "Contractor — backend dev", amountMinor: -180_000, currency: "USD", expectedAccountNumber: "5000", expectedAccountName: "Payroll & Contractors" },
  { id: "g059", merchant: "Deel", description: "Contractor payment — overseas", amountMinor: -95_000, currency: "USD", expectedAccountNumber: "5000", expectedAccountName: "Payroll & Contractors" },
  // --- Insurance ---
  { id: "g060", merchant: "Hiscox", description: "Professional liability insurance", amountMinor: -14_500, currency: "USD", expectedAccountNumber: "5700", expectedAccountName: "Insurance" },
  { id: "g061", merchant: "Next Insurance", description: "Business owner policy — monthly", amountMinor: -9_900, currency: "USD", expectedAccountNumber: "5700", expectedAccountName: "Insurance" },
  // --- Extra income to round out streams ---
  { id: "g062", merchant: "Acme Dental", description: "Z360 platform — annual prepay", amountMinor: 598_800, currency: "USD", expectedAccountNumber: "4000", expectedAccountName: "Sales" },
  { id: "g063", merchant: "Fernwood Spa", description: "Marketing services — retainer", amountMinor: 160_000, currency: "USD", expectedAccountNumber: "4100", expectedAccountName: "Services" },
  { id: "g064", merchant: "Quill & Quirk", description: "AI consulting — discovery", amountMinor: 90_000, currency: "USD", expectedAccountNumber: "4100", expectedAccountName: "Services" },
];

export type CategorizationEvalStatus = "meets_target" | "below_target" | "no_eval_rows";

export type CategorizationAccuracy = {
  evaluatedCount: number;
  correctCount: number;
  accuracy: number;
  targetAccuracy: number;
  status: CategorizationEvalStatus;
};

/** Shared 80% quality target (mirrors ai.ts targetAccuracy). */
export const CATEGORIZATION_TARGET_ACCURACY = 0.8;

/**
 * Pure, deterministic accuracy + PASS/FAIL computation over (predicted vs
 * expected) account-number pairs. No LLM, no DB — this is the exact math the
 * gold eval persists and the unit test asserts. `evaluatedCount === 0` yields
 * `no_eval_rows`; otherwise `accuracy >= targetAccuracy` ? meets_target :
 * below_target.
 */
export function scoreCategorizationAccuracy(
  pairs: ReadonlyArray<{ predictedAccountNumber: string | null; expectedAccountNumber: string }>,
  targetAccuracy: number = CATEGORIZATION_TARGET_ACCURACY,
): CategorizationAccuracy {
  const evaluatedCount = pairs.length;
  const correctCount = pairs.filter(
    (pair) => pair.predictedAccountNumber !== null && pair.predictedAccountNumber === pair.expectedAccountNumber,
  ).length;
  const accuracy = evaluatedCount === 0 ? 0 : correctCount / evaluatedCount;
  const status: CategorizationEvalStatus =
    evaluatedCount === 0
      ? "no_eval_rows"
      : accuracy >= targetAccuracy
        ? "meets_target"
        : "below_target";
  return { evaluatedCount, correctCount, accuracy, targetAccuracy, status };
}
