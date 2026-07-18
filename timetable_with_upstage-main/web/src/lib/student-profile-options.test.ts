import { describe, expect, it } from "vitest";

import {
  ADMISSION_YEAR_OPTIONS,
  COURSE_YEAR_OPTIONS,
  parseDirectYear,
} from "./student-profile-options";

describe("student profile year options", () => {
  it("shows each admission year once with a Korean year suffix", () => {
    expect(ADMISSION_YEAR_OPTIONS).toHaveLength(9);
    expect(ADMISSION_YEAR_OPTIONS.find(({ value }) => value === 2022)).toEqual({
      value: 2022,
      label: "2022년",
    });
    expect(new Set(ADMISSION_YEAR_OPTIONS.map(({ value }) => value)).size).toBe(9);
  });

  it("keeps the current course-year quick choices while allowing direct input", () => {
    expect(COURSE_YEAR_OPTIONS.map(({ value }) => value)).toEqual([
      2026, 2025, 2024, 2023, 2022, 2021, 2020,
    ]);
    expect(parseDirectYear("2017")).toBe(2017);
    expect(parseDirectYear("2022년")).toBe(2022);
    expect(parseDirectYear("")).toBeNull();
  });
});
