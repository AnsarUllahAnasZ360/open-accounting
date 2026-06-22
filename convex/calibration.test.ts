import { describe, expect, it } from "vitest";

import {
  applyCalibration,
  AUTO_POST_HARD_CEILING_MINOR,
  autoPostPrecisionSummary,
  type CalibrationSample,
  decideAutoPost,
  fitCalibration,
  IDENTITY_CALIBRATION,
  isBlockedCategory,
  logit,
  reliabilityReport,
  requiredConfidenceForAmount,
  sigmoid,
} from "./calibration";

/**
 * Build a deterministic, miscalibrated synthetic holdout: an OVERCONFIDENT
 * model whose stated confidence is systematically higher than its real
 * accuracy. We tie each item's correctness to its raw confidence via a fixed
 * pseudo-random hash so the set is reproducible with no RNG.
 */
function overconfidentSamples(count: number): CalibrationSample[] {
  const samples: CalibrationSample[] = [];
  for (let i = 0; i < count; i += 1) {
    // Raw confidence spread across [0.5, 0.99].
    const rawConfidence = 0.5 + ((i * 37) % 50) / 100; // 0.50..0.99
    // True accuracy is much lower than stated confidence (overconfident):
    // realProb ~= rawConfidence^3, so 0.9 stated -> ~0.73 real.
    const realProb = Math.pow(rawConfidence, 3);
    // Deterministic threshold from a fixed hash in [0,1).
    const hash = ((i * 2654435761) % 1000) / 1000;
    samples.push({ rawConfidence, correct: hash < realProb });
  }
  return samples;
}

describe("E6.1 calibration math", () => {
  it("sigmoid and logit are inverse and finite at the edges", () => {
    expect(sigmoid(0)).toBeCloseTo(0.5, 10);
    expect(sigmoid(logit(0.73))).toBeCloseTo(0.73, 6);
    expect(Number.isFinite(logit(0))).toBe(true);
    expect(Number.isFinite(logit(1))).toBe(true);
  });

  it("identity calibration leaves raw confidence unchanged", () => {
    for (const p of [0.1, 0.5, 0.75, 0.9, 0.99]) {
      expect(applyCalibration(p, IDENTITY_CALIBRATION)).toBeCloseTo(p, 10);
    }
  });

  it("is monotonic: higher raw confidence maps to higher calibrated probability", () => {
    const params = fitCalibration(overconfidentSamples(120), "temperature");
    let prev = -1;
    for (const p of [0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.99]) {
      const calibrated = applyCalibration(p, params);
      expect(calibrated).toBeGreaterThan(prev);
      prev = calibrated;
    }
  });

  it("fits an overconfident model to a shrinking slope and lowers high confidences", () => {
    const params = fitCalibration(overconfidentSamples(120), "temperature");
    // Overconfident -> slope a < 1 (temperature T > 1).
    expect(params.a).toBeLessThan(1);
    expect(params.method).toBe("temperature");
    // A raw 0.90 must calibrate DOWN (the model was too sure).
    expect(applyCalibration(0.9, params)).toBeLessThan(0.9);
    expect(applyCalibration(0.99, params)).toBeLessThan(0.99);
  });

  it("decreases ECE on a miscalibrated set (before > after)", () => {
    const samples = overconfidentSamples(200);
    const params = fitCalibration(samples, "temperature");
    const before = reliabilityReport(
      samples.map((s) => ({ probability: s.rawConfidence, correct: s.correct })),
    );
    const after = reliabilityReport(
      samples.map((s) => ({ probability: applyCalibration(s.rawConfidence, params), correct: s.correct })),
    );
    expect(before.ece).toBeGreaterThan(0);
    expect(after.ece).toBeLessThan(before.ece);
  });

  it("falls back to identity for degenerate or tiny sample sets (never fabricates a loosening fit)", () => {
    expect(fitCalibration([], "temperature").method).toBe("identity");
    expect(fitCalibration([{ rawConfidence: 0.9, correct: true }], "platt").method).toBe("identity");
    // All-correct (single class) -> identity, so we never invent a fit.
    const allCorrect: CalibrationSample[] = Array.from({ length: 10 }, (_, i) => ({
      rawConfidence: 0.8 + i / 100,
      correct: true,
    }));
    expect(fitCalibration(allCorrect, "temperature").method).toBe("identity");
  });
});

describe("E6.1 calibration only ever tightens auto-post for overconfident scores", () => {
  it("never auto-posts something the raw gate rejected once calibration lowers the probability", () => {
    const params = fitCalibration(overconfidentSamples(200), "temperature");
    expect(params.a).toBeLessThan(1); // confirmed overconfident fit

    for (let i = 0; i < 100; i += 1) {
      const raw = 0.5 + i / 200; // 0.50..0.995
      const rawDecision = decideAutoPost({
        baseThreshold: 0.75,
        rawConfidence: raw,
        calibration: IDENTITY_CALIBRATION,
      });
      const calibratedDecision = decideAutoPost({
        baseThreshold: 0.75,
        rawConfidence: raw,
        calibration: params,
      });
      // For an overconfident fit the calibrated probability is <= raw, so the
      // calibrated gate is a strict subset of the raw gate: it can only ever
      // turn a raw "post" into "do not post", never the reverse.
      if (!rawDecision.autoPost) {
        expect(calibratedDecision.autoPost).toBe(false);
      }
      expect(calibratedDecision.calibratedConfidence).toBeLessThanOrEqual(raw + 1e-9);
    }
  });

  it("stays a subset of the raw gate even for a SHARPENING fit (a>1) via the conservative gate clamp", () => {
    // Real Bedrock data can be bimodal (cluster always-wrong, cluster
    // always-right), which fits a SHARPENING slope a>1 that would push high
    // confidences UP. The gate must still never auto-post anything the raw gate
    // rejected. The min(calibrated, raw) gateConfidence guarantees this.
    const sharpening: CalibrationSample[] = Array.from({ length: 120 }, (_, i) => {
      const raw = i % 2 === 0 ? 0.45 : 0.93;
      return { rawConfidence: raw, correct: raw > 0.5 };
    });
    const params = fitCalibration(sharpening, "temperature");
    expect(params.a).toBeGreaterThan(1); // sharpening fit on this real-shaped data

    for (let i = 0; i < 100; i += 1) {
      const raw = 0.5 + i / 200;
      const rawDecision = decideAutoPost({
        baseThreshold: 0.75,
        rawConfidence: raw,
        calibration: IDENTITY_CALIBRATION,
      });
      const calibratedDecision = decideAutoPost({
        baseThreshold: 0.75,
        rawConfidence: raw,
        calibration: params,
      });
      // gateConfidence never exceeds raw, so the calibrated gate is a subset.
      expect(calibratedDecision.gateConfidence).toBeLessThanOrEqual(raw + 1e-9);
      if (!rawDecision.autoPost) {
        expect(calibratedDecision.autoPost).toBe(false);
      }
    }
  });
});

describe("E6.2 business-impact gate", () => {
  it("blocks equity / owner-draw / distribution / tax / intercompany categories", () => {
    expect(isBlockedCategory({ type: "equity", subtype: "equity", name: "Owner's Equity" })).toBe(true);
    expect(isBlockedCategory({ type: "equity", subtype: "draw", name: "Owner's Draw" })).toBe(true);
    expect(isBlockedCategory({ type: "expense", subtype: "taxes", name: "Taxes & Licenses" })).toBe(true);
    expect(isBlockedCategory({ type: "liability", subtype: "tax", name: "Sales Tax Payable" })).toBe(true);
    expect(isBlockedCategory({ name: "Intercompany Transfer" })).toBe(true);
    expect(isBlockedCategory({ name: "Ask my accountant" })).toBe(true);
    expect(isBlockedCategory({ name: "Owner Distribution" })).toBe(true);
    // Ordinary expense is NOT blocked.
    expect(isBlockedCategory({ type: "expense", subtype: "software", name: "Software & SaaS" })).toBe(false);
  });

  it("never auto-posts a blocklisted category even at confidence 1.0", () => {
    const decision = decideAutoPost({
      baseThreshold: 0.75,
      rawConfidence: 1.0,
      amountMinor: -1000,
      category: { type: "equity", subtype: "draw", name: "Owner's Draw" },
      calibration: IDENTITY_CALIBRATION,
    });
    expect(decision.autoPost).toBe(false);
    expect(decision.blockedReason).toBe("blocked_category");
  });

  it("never auto-posts above the hard dollar ceiling even at confidence 1.0", () => {
    const decision = decideAutoPost({
      baseThreshold: 0.75,
      rawConfidence: 1.0,
      amountMinor: -AUTO_POST_HARD_CEILING_MINOR,
      category: { type: "expense", subtype: "software", name: "Software & SaaS" },
      calibration: IDENTITY_CALIBRATION,
    });
    expect(decision.autoPost).toBe(false);
    expect(decision.blockedReason).toBe("amount_ceiling");
  });

  it("requires higher confidence as the amount grows (ramp), but still posts small clear items", () => {
    // Small amount: required == base threshold.
    expect(requiredConfidenceForAmount(0.75, -4999)).toBeCloseTo(0.75, 10);
    // Mid amount: required is strictly higher than base.
    const midRequired = requiredConfidenceForAmount(0.75, -250000);
    expect(midRequired).not.toBeNull();
    expect(midRequired!).toBeGreaterThan(0.75);
    // At/above ceiling: null (never post).
    expect(requiredConfidenceForAmount(0.75, -AUTO_POST_HARD_CEILING_MINOR)).toBeNull();

    // A mid-size charge at exactly the base threshold no longer auto-posts.
    const decision = decideAutoPost({
      baseThreshold: 0.75,
      rawConfidence: 0.75,
      amountMinor: -250000,
      category: { type: "expense", subtype: "software", name: "Software & SaaS" },
      calibration: IDENTITY_CALIBRATION,
    });
    expect(decision.autoPost).toBe(false);
    expect(decision.blockedReason).toBe("below_threshold");
  });

  it("suggest mode (null threshold) and needsHuman never auto-post", () => {
    expect(
      decideAutoPost({ baseThreshold: null, rawConfidence: 0.99, calibration: IDENTITY_CALIBRATION }).autoPost,
    ).toBe(false);
    expect(
      decideAutoPost({
        baseThreshold: 0.75,
        rawConfidence: 0.99,
        needsHuman: true,
        calibration: IDENTITY_CALIBRATION,
      }).autoPost,
    ).toBe(false);
  });
});

describe("E6.5 auto-post precision on calibrated decisions", () => {
  it("raises auto-post precision by demanding calibrated confidence on an overconfident set", () => {
    const samples = overconfidentSamples(200);
    const params = fitCalibration(samples, "temperature");
    const items = samples.map((s) => ({ rawConfidence: s.rawConfidence, correct: s.correct }));

    const rawGate = autoPostPrecisionSummary(items, {
      baseThreshold: 0.75,
      calibration: IDENTITY_CALIBRATION,
    });
    const calibratedGate = autoPostPrecisionSummary(items, { baseThreshold: 0.75, calibration: params });

    // The calibrated gate auto-posts no MORE items than the raw gate (more
    // conservative), and its precision on what it does post is at least as high.
    expect(calibratedGate.autoPostCount).toBeLessThanOrEqual(rawGate.autoPostCount);
    if (calibratedGate.precision !== null && rawGate.precision !== null) {
      expect(calibratedGate.precision).toBeGreaterThanOrEqual(rawGate.precision - 1e-9);
    }
  });
});
