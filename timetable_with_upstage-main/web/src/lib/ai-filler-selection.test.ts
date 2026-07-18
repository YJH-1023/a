import { describe, expect, it } from "vitest";

import { selectAiFillerSubjects } from "./ai-filler-selection";
import type { SkkuElectiveAreaCode, SkkuElectiveSubject } from "./skku-course-api";

const AREA_LABELS = new Map<SkkuElectiveAreaCode, string>([
  ["A5", "글로벌"],
  ["D1", "인간/문화"],
  ["ETC", "일반선택"],
]);

function subject(areaCode: SkkuElectiveAreaCode, courseNumber: string, name = courseNumber): SkkuElectiveSubject {
  return { areaCode, courseNumber, name };
}

function baseInput(overrides: Partial<Parameters<typeof selectAiFillerSubjects>[0]> = {}) {
  return {
    catalogSubjects: [
      subject("A5", "GEDG001", "영어쓰기"),
      subject("D1", "GEDH001", "인간과문화"),
      subject("ETC", "GEDE001", "일반선택과목"),
    ],
    usedSelectionIds: new Set<string>(),
    excludedCourseNumbers: new Set<string>(),
    unmetGeneralLabels: [] as string[],
    hasAnyRequirements: false,
    areaLabelByCode: AREA_LABELS,
    selectionIdFor: (courseNumber: string) => `elective:1:${courseNumber}`,
    maxShortlist: 8,
    ...overrides,
  };
}

describe("selectAiFillerSubjects", () => {
  it("falls back to any area when no profile was uploaded", () => {
    const result = selectAiFillerSubjects(baseInput());
    expect(result.map((s) => s.courseNumber)).toEqual(["GEDG001", "GEDH001", "GEDE001"]);
  });

  it("prioritizes subjects whose area matches an unmet 교양 requirement label", () => {
    const result = selectAiFillerSubjects(
      baseInput({ hasAnyRequirements: true, unmetGeneralLabels: ["인간/문화 영역"] }),
    );
    expect(result.map((s) => s.courseNumber)).toEqual(["GEDH001"]);
  });

  it("returns nothing when a profile was uploaded and 교양 requirements are already satisfied", () => {
    const result = selectAiFillerSubjects(
      baseInput({ hasAnyRequirements: true, unmetGeneralLabels: [] }),
    );
    expect(result).toEqual([]);
  });

  it("excludes subjects already used as required/choice subjects", () => {
    const result = selectAiFillerSubjects(
      baseInput({ usedSelectionIds: new Set(["elective:1:GEDG001"]) }),
    );
    expect(result.map((s) => s.courseNumber)).not.toContain("GEDG001");
  });

  it("excludes already-completed course numbers regardless of casing", () => {
    const result = selectAiFillerSubjects(
      baseInput({ excludedCourseNumbers: new Set(["gedg001"]) }),
    );
    expect(result.map((s) => s.courseNumber)).not.toContain("GEDG001");
  });

  it("caps the shortlist at maxShortlist", () => {
    const many = Array.from({ length: 20 }, (_, index) => subject("ETC", `GEDE${index}`));
    const result = selectAiFillerSubjects(baseInput({ catalogSubjects: many, maxShortlist: 5 }));
    expect(result).toHaveLength(5);
  });
});
