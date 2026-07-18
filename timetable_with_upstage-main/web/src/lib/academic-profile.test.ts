import { describe, expect, it } from "vitest";

import {
  isDistributionMinimumSatisfied,
  type DistributionMinimumRule,
} from "./academic-profile";

const BALANCED_GENERAL_RULE: DistributionMinimumRule = {
  kind: "distribution_minimum",
  groupId: "balanced-general",
  totalAreas: 3,
  minimumAreas: 2,
  totalCredits: 6,
  rawText: "3개 영역 중 최소 2개 영역에서 합계 6학점 이상 이수",
};

describe("isDistributionMinimumSatisfied", () => {
  it("does not accept all six credits from only one area", () => {
    expect(isDistributionMinimumSatisfied(BALANCED_GENERAL_RULE, [6, 0, 0])).toBe(false);
  });

  it("accepts six total credits spread across any two of the three areas", () => {
    expect(isDistributionMinimumSatisfied(BALANCED_GENERAL_RULE, [3, 3, 0])).toBe(true);
    expect(isDistributionMinimumSatisfied(BALANCED_GENERAL_RULE, [1, 5, 0])).toBe(true);
    expect(isDistributionMinimumSatisfied(BALANCED_GENERAL_RULE, [0, 3, 3])).toBe(true);
  });

  it("still requires six total credits even when two areas are represented", () => {
    expect(isDistributionMinimumSatisfied(BALANCED_GENERAL_RULE, [2, 3, 0])).toBe(false);
  });
});
