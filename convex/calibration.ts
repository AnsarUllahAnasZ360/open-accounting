/**
 * E6.1 Confidence calibration + E6.2 business-impact gate.
 *
 * Pure, deterministic math with no Convex/runtime dependencies so it can be
 * unit-tested directly and reused from queries, mutations, and actions.
 *
 * Why this exists: raw LLM confidence is systematically overconfident, so a
 * raw 0.90 is NOT 90%-correct. We FIT a calibration map from the leakage-free
 * holdout's `(rawConfidence, wasCorrect)` pairs and apply the CALIBRATED
 * probability to the UNCHANGED autonomy thresholds (0.90 balanced / 0.75
 * autopilot). Calibration never changes those constants; it only changes the
 * probability they are compared against, and for an overconfident model that
 * makes auto-post strictly MORE conservative.
 */

/** A single observed (rawConfidence, wasCorrect) pair from the holdout. */
export type CalibrationSample = {
  rawConfidence: number;
  correct: boolean;
};

export type CalibrationMethod = "temperature" | "platt" | "identity";

/**
 * Fitted calibration parameters. `method` records which fit produced them.
 *
 * Both temperature scaling and Platt scaling are applied in logit space:
 *   z      = logit(rawConfidence)
 *   zCal   = a * z + b
 *   pCal   = sigmoid(zCal)
 *
 * - Temperature scaling fits a single temperature T (a = 1/T, b = 0).
 * - Platt scaling fits both a slope (a) and an intercept (b).
 *
 * For an overconfident model both fits learn a < 1, which shrinks extreme
 * logits toward 0 and lowers the calibrated probability — i.e. it is more
 * conservative exactly where the model was too sure.
 */
export type CalibrationParams = {
  method: CalibrationMethod;
  a: number;
  b: number;
  sampleCount: number;
  positiveCount: number;
};

export const IDENTITY_CALIBRATION: CalibrationParams = {
  method: "identity",
  a: 1,
  b: 0,
  sampleCount: 0,
  positiveCount: 0,
};

/** Keep raw confidences strictly inside (0,1) so logit() is finite. */
const EPS = 1e-6;

function clampProb(p: number): number {
  if (!Number.isFinite(p)) return 0.5;
  return Math.min(1 - EPS, Math.max(EPS, p));
}

export function sigmoid(z: number): number {
  if (z >= 0) {
    const e = Math.exp(-z);
    return 1 / (1 + e);
  }
  const e = Math.exp(z);
  return e / (1 + e);
}

export function logit(p: number): number {
  const c = clampProb(p);
  return Math.log(c / (1 - c));
}

/**
 * Apply fitted parameters to a single raw confidence, returning the calibrated
 * probability in [0,1]. Identity params return the raw confidence unchanged.
 */
export function applyCalibration(rawConfidence: number, params: CalibrationParams): number {
  const raw = clampProb(rawConfidence);
  if (params.method === "identity" || (params.a === 1 && params.b === 0)) {
    return raw;
  }
  const z = logit(raw);
  return clampProb(sigmoid(params.a * z + params.b));
}

/**
 * Fit a calibration map from holdout samples by minimizing the negative
 * log-likelihood (cross-entropy) of the labels under the calibrated
 * probabilities. This is the standard objective for both temperature and
 * Platt scaling. We use deterministic batch gradient descent — no randomness,
 * no external solver — so the result is fully reproducible in a unit test.
 *
 * `method`:
 *   "temperature" fits a single slope a = 1/T (intercept pinned to 0).
 *   "platt" fits slope a and intercept b jointly.
 */
/**
 * Minimum number of mixed-outcome holdout samples required to fit a NON-identity
 * calibration. Below this — or when the labels are single-class — fitCalibration
 * returns identity. E2-T10 uses the same threshold to decide whether an entity
 * gets its OWN per-entity calibration or inherits the workspace-level fallback.
 */
export const MIN_MIXED_OUTCOME_SAMPLES = 4;

/**
 * True when the supplied holdout samples carry enough mixed-outcome signal to fit
 * a real (non-identity) calibration: at least MIN_MIXED_OUTCOME_SAMPLES usable
 * rows AND both outcomes present (so the fit is not degenerate single-class).
 */
export function hasSufficientMixedOutcomes(samples: CalibrationSample[]): boolean {
  const usable = samples.filter((s) => Number.isFinite(s.rawConfidence));
  const positiveCount = usable.filter((s) => s.correct).length;
  return (
    usable.length >= MIN_MIXED_OUTCOME_SAMPLES &&
    positiveCount > 0 &&
    positiveCount < usable.length
  );
}

export function fitCalibration(
  samples: CalibrationSample[],
  method: "temperature" | "platt" = "temperature",
): CalibrationParams {
  const usable = samples.filter((s) => Number.isFinite(s.rawConfidence));
  const sampleCount = usable.length;
  const positiveCount = usable.filter((s) => s.correct).length;

  // Not enough signal, or a degenerate single-class set: fall back to identity
  // so we never fabricate a calibration that could loosen the gate.
  if (sampleCount < MIN_MIXED_OUTCOME_SAMPLES || positiveCount === 0 || positiveCount === sampleCount) {
    return { ...IDENTITY_CALIBRATION, sampleCount, positiveCount };
  }

  const zs = usable.map((s) => logit(s.rawConfidence));
  const ys = usable.map((s) => (s.correct ? 1 : 0));

  // Start from identity (a=1, b=0) and descend.
  let a = 1;
  let b = 0;
  const lr = 0.05;
  const iterations = 5000;
  const fitIntercept = method === "platt";

  for (let iter = 0; iter < iterations; iter += 1) {
    let gradA = 0;
    let gradB = 0;
    for (let i = 0; i < sampleCount; i += 1) {
      const p = sigmoid(a * zs[i] + b);
      const err = p - ys[i];
      gradA += err * zs[i];
      gradB += err;
    }
    gradA /= sampleCount;
    gradB /= sampleCount;
    a -= lr * gradA;
    if (fitIntercept) {
      b -= lr * gradB;
    }
  }

  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return { ...IDENTITY_CALIBRATION, sampleCount, positiveCount };
  }

  return {
    method,
    a,
    b: fitIntercept ? b : 0,
    sampleCount,
    positiveCount,
  };
}

export type ReliabilityBucket = {
  label: string;
  lower: number;
  upper: number;
  count: number;
  meanConfidence: number;
  accuracy: number;
  gapAbs: number;
};

export type ReliabilityReport = {
  sampleCount: number;
  ece: number;
  buckets: ReliabilityBucket[];
};

const DEFAULT_BUCKET_EDGES = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1.0001];

/**
 * Compute Expected Calibration Error (ECE) and a per-bucket reliability table
 * for a set of (probability, correct) pairs. ECE is the sample-weighted mean
 * absolute gap between bucket mean-confidence and bucket accuracy. Lower is
 * better-calibrated; a perfectly calibrated model has ECE = 0.
 */
export function reliabilityReport(
  pairs: { probability: number; correct: boolean }[],
  edges: number[] = DEFAULT_BUCKET_EDGES,
): ReliabilityReport {
  const usable = pairs.filter((p) => Number.isFinite(p.probability));
  const buckets: ReliabilityBucket[] = [];
  let weightedGap = 0;

  for (let i = 0; i < edges.length - 1; i += 1) {
    const lower = edges[i];
    const upper = edges[i + 1];
    const inBucket = usable.filter((p) => p.probability >= lower && p.probability < upper);
    const count = inBucket.length;
    const meanConfidence = count === 0 ? 0 : inBucket.reduce((s, p) => s + p.probability, 0) / count;
    const accuracy = count === 0 ? 0 : inBucket.filter((p) => p.correct).length / count;
    const gapAbs = count === 0 ? 0 : Math.abs(meanConfidence - accuracy);
    if (count > 0) {
      weightedGap += (count / usable.length) * gapAbs;
    }
    buckets.push({
      label: `${lower.toFixed(2)}-${Math.min(upper, 1).toFixed(2)}`,
      lower,
      upper,
      count,
      meanConfidence,
      accuracy,
      gapAbs,
    });
  }

  return {
    sampleCount: usable.length,
    ece: usable.length === 0 ? 0 : weightedGap,
    buckets: buckets.filter((bucket) => bucket.count > 0),
  };
}

/**
 * E6.2 business-impact gate.
 *
 * On top of the shared autonomy threshold (which is NOT changed here), we:
 *   1. Never auto-post a "blocklisted" category (equity, owner draws /
 *      distributions, taxes, intercompany, "ask my accountant"). These require
 *      human judgement regardless of confidence.
 *   2. Never auto-post above a hard dollar ceiling, no matter the confidence.
 *   3. Require a HIGHER calibrated confidence as the amount grows, so a large
 *      but sub-ceiling charge needs more certainty than a small one.
 *
 * All amounts are integer minor units (cents). The ceiling and ramp are
 * conservative defaults; they only ever RAISE the bar above the shared
 * threshold, never lower it.
 */

/** Hard ceiling: nothing auto-posts at or above this minor-unit amount. */
export const AUTO_POST_HARD_CEILING_MINOR = 5_000_00; // $5,000.00

/**
 * Below this amount the business-impact ramp adds nothing; above it the
 * required calibrated confidence rises linearly toward the ceiling.
 */
export const AUTO_POST_RAMP_FLOOR_MINOR = 500_00; // $500.00

/**
 * Maximum extra confidence the amount ramp can demand on top of the shared
 * threshold (just below the hard ceiling). Caps required confidence at well
 * under 1 so a legitimately certain mid-size charge can still post.
 */
export const AUTO_POST_RAMP_MAX_BONUS = 0.08;

/**
 * Category subtypes / numbers / names that must never auto-post. Matching is
 * case-insensitive and substring-based on name so "Owner Distribution",
 * "Intercompany Transfer", and "Ask my accountant" are all caught even on a
 * custom chart of accounts.
 */
export const AUTO_POST_BLOCKED_TYPES = new Set<string>(["equity"]);
export const AUTO_POST_BLOCKED_SUBTYPES = new Set<string>([
  "equity",
  "draw",
  "distribution",
  "distributions",
  "retained_earnings",
  "opening_balance",
  "tax",
  "taxes",
  "intercompany",
]);
export const AUTO_POST_BLOCKED_NAME_FRAGMENTS = [
  "owner draw",
  "owner's draw",
  "owner distribution",
  "distribution",
  "intercompany",
  "inter-company",
  "ask my accountant",
  "ask accountant",
  "tax",
];

export type BusinessImpactCategory = {
  type?: string | null;
  subtype?: string | null;
  number?: string | null;
  name?: string | null;
};

export function isBlockedCategory(category: BusinessImpactCategory | undefined | null): boolean {
  if (!category) return false;
  const type = (category.type ?? "").trim().toLowerCase();
  const subtype = (category.subtype ?? "").trim().toLowerCase();
  const name = (category.name ?? "").trim().toLowerCase();
  if (type && AUTO_POST_BLOCKED_TYPES.has(type)) return true;
  if (subtype && AUTO_POST_BLOCKED_SUBTYPES.has(subtype)) return true;
  if (name && AUTO_POST_BLOCKED_NAME_FRAGMENTS.some((fragment) => name.includes(fragment))) return true;
  return false;
}

/**
 * The minimum CALIBRATED confidence required to auto-post a given amount, given
 * the shared autonomy threshold. Returns the base threshold for small amounts
 * and ramps upward with size. Returns `null` (never post) at/above the ceiling.
 */
export function requiredConfidenceForAmount(
  baseThreshold: number,
  amountMinor: number,
): number | null {
  const abs = Math.abs(amountMinor);
  if (abs >= AUTO_POST_HARD_CEILING_MINOR) return null;
  if (abs <= AUTO_POST_RAMP_FLOOR_MINOR) return baseThreshold;
  const span = AUTO_POST_HARD_CEILING_MINOR - AUTO_POST_RAMP_FLOOR_MINOR;
  const progress = (abs - AUTO_POST_RAMP_FLOOR_MINOR) / span; // 0..1
  const bonus = AUTO_POST_RAMP_MAX_BONUS * progress;
  return Math.min(0.999, baseThreshold + bonus);
}

export type AutoPostDecisionInput = {
  baseThreshold: number | null;
  rawConfidence: number;
  needsHuman?: boolean;
  amountMinor?: number;
  category?: BusinessImpactCategory | null;
  calibration?: CalibrationParams | null;
};

export type AutoPostDecision = {
  autoPost: boolean;
  rawConfidence: number;
  /** The mathematically calibrated probability (used for ECE/reporting). */
  calibratedConfidence: number;
  /**
   * The probability actually compared to the threshold. It is the calibrated
   * probability clamped to never EXCEED the raw confidence, so the calibrated
   * gate is always a subset of the raw gate (acceptance #3): calibration can
   * only ever withhold an auto-post, never create one the raw gate rejected.
   */
  gateConfidence: number;
  requiredConfidence: number | null;
  blockedReason: string | null;
};

/**
 * The single decision used by both `shouldAutoPostAI` and the eval harness.
 * It calibrates the raw confidence, then applies the unchanged shared
 * threshold plus the business-impact gate. It can only ever REJECT relative to
 * the raw-threshold comparison; it never approves something the raw gate would
 * have rejected when the calibrated probability is lower.
 */
export function decideAutoPost(input: AutoPostDecisionInput): AutoPostDecision {
  const calibration = input.calibration ?? IDENTITY_CALIBRATION;
  const rawConfidence = clampProb(input.rawConfidence);
  const calibratedConfidence = applyCalibration(input.rawConfidence, calibration);
  // Conservative-only clamp: the gate never trusts more than the raw model did.
  // If a data fit would push a confidence UP, we ignore that for gating so the
  // calibrated gate can only ever be MORE conservative than the raw gate.
  const gateConfidence = Math.min(calibratedConfidence, rawConfidence);
  const base: Omit<AutoPostDecision, "autoPost" | "requiredConfidence" | "blockedReason"> = {
    rawConfidence: input.rawConfidence,
    calibratedConfidence,
    gateConfidence,
  };

  if (input.needsHuman) {
    return { ...base, autoPost: false, requiredConfidence: null, blockedReason: "needs_human" };
  }
  if (input.baseThreshold === null || input.baseThreshold === undefined) {
    // suggest mode: never auto-posts.
    return { ...base, autoPost: false, requiredConfidence: null, blockedReason: "suggest_mode" };
  }
  if (isBlockedCategory(input.category)) {
    return { ...base, autoPost: false, requiredConfidence: null, blockedReason: "blocked_category" };
  }

  const required = requiredConfidenceForAmount(input.baseThreshold, input.amountMinor ?? 0);
  if (required === null) {
    return { ...base, autoPost: false, requiredConfidence: null, blockedReason: "amount_ceiling" };
  }

  const autoPost = gateConfidence >= required;
  return {
    ...base,
    autoPost,
    requiredConfidence: required,
    blockedReason: autoPost ? null : "below_threshold",
  };
}

/**
 * E6.5: auto-post PRECISION on the items a gate WOULD auto-post. This is the
 * number that must be high (~99%+) before trusting auto-post. We compute it for
 * a given gate config (threshold + calibration + business-impact) over scored
 * holdout items, returning the count that would auto-post and how many of those
 * were correct.
 */
export type AutoPostPrecisionItem = {
  rawConfidence: number;
  correct: boolean;
  amountMinor?: number;
  category?: BusinessImpactCategory | null;
  needsHuman?: boolean;
};

export type AutoPostPrecisionSummary = {
  autoPostCount: number;
  autoPostCorrect: number;
  precision: number | null;
  coverage: number | null;
  totalEvaluated: number;
};

export function autoPostPrecisionSummary(
  items: AutoPostPrecisionItem[],
  config: { baseThreshold: number | null; calibration: CalibrationParams },
): AutoPostPrecisionSummary {
  let autoPostCount = 0;
  let autoPostCorrect = 0;
  for (const item of items) {
    const decision = decideAutoPost({
      baseThreshold: config.baseThreshold,
      rawConfidence: item.rawConfidence,
      calibration: config.calibration,
      ...(item.needsHuman !== undefined ? { needsHuman: item.needsHuman } : {}),
      ...(item.amountMinor !== undefined ? { amountMinor: item.amountMinor } : {}),
      category: item.category ?? null,
    });
    if (decision.autoPost) {
      autoPostCount += 1;
      if (item.correct) autoPostCorrect += 1;
    }
  }
  const totalEvaluated = items.length;
  return {
    autoPostCount,
    autoPostCorrect,
    precision: autoPostCount === 0 ? null : autoPostCorrect / autoPostCount,
    coverage: totalEvaluated === 0 ? null : autoPostCount / totalEvaluated,
    totalEvaluated,
  };
}
