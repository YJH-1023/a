import { describe, expect, it } from "vitest";

import {
  enumerateSubjectSelections,
  generateTimetablesForSelectionPlan,
  getInitialSectionIds,
  removeSubjectsOwnedBy,
  SelectionPlanError,
  SelectionPlanLimitError,
  toggleEnabledSectionId,
  type SubjectOption,
} from "./selection-plan";

function subject(id: string, sectionCount = 1, credits = 3): SubjectOption {
  return {
    id,
    title: id,
    credits,
    sections: Array.from({ length: sectionCount }, (_, index) => ({
      id: `${id}-${index + 1}`,
      title: `${id} ${index + 1}분반`,
      schedule: "",
    })),
  };
}

describe("enumerateSubjectSelections", () => {
  it("enables only the first section when a subject is initially selected", () => {
    expect(getInitialSectionIds(subject("A", 3).sections)).toEqual(["A-1"]);
    expect(getInitialSectionIds([])).toEqual([]);
  });

  it("lets users add or replace sections without leaving a selected subject empty", () => {
    expect(toggleEnabledSectionId(["A-1"], "A-2")).toEqual(["A-1", "A-2"]);
    expect(toggleEnabledSectionId(["A-1", "A-2"], "A-1")).toEqual(["A-2"]);
    expect(toggleEnabledSectionId(["A-2"], "A-2")).toEqual(["A-2"]);
  });

  it("removes every course and section setting owned by a deleted group", () => {
    expect(removeSubjectsOwnedBy(
      {
        selectedIds: ["A", "B", "C"],
        owners: { A: "one", B: "two", C: "one" },
        enabledSectionIds: { A: ["A-1"], B: ["B-1"], C: ["C-2"] },
      },
      "one",
    )).toEqual({
      selectedIds: ["B"],
      owners: { B: "two" },
      enabledSectionIds: { B: ["B-1"] },
      removedIds: ["A", "C"],
    });
  });

  it("enumerates every allowed subject subset while preserving all sections", () => {
    const required = subject("REQ", 2);
    const first = subject("A", 3);
    const second = subject("B", 1);

    const selections = enumerateSubjectSelections({
      requiredSubjects: [required],
      choiceBags: [{ id: "interest", title: "관심 과목", subjects: [first, second] }],
    });

    expect(selections.map((items) => items.map(({ id }) => id))).toEqual([
      ["REQ", "A"],
      ["REQ", "B"],
    ]);
    expect(selections[0]?.[0]?.sections).toHaveLength(2);
    expect(selections[0]?.[1]?.sections).toHaveLength(3);
  });

  it("supports optional bags and choosing several subjects from one bag", () => {
    const selections = enumerateSubjectSelections({
      requiredSubjects: [],
      choiceBags: [
        {
          id: "free",
          title: "자유 선택",
          subjects: [subject("A"), subject("B")],
          minSubjects: 0,
          maxSubjects: 2,
        },
      ],
    });

    expect(selections.map((items) => items.map(({ id }) => id))).toEqual([
      [],
      ["A"],
      ["B"],
      ["A", "B"],
    ]);
  });

  it("keeps only subject combinations inside the requested credit range", () => {
    const selections = enumerateSubjectSelections({
      requiredSubjects: [subject("REQ", 1, 3)],
      choiceBags: [{
        id: "credit-options",
        title: "학점 선택",
        subjects: [subject("A", 1, 12), subject("B", 1, 15), subject("C", 1, 18)],
      }],
      creditRange: { minCredits: 15, maxCredits: 18 },
    });

    expect(selections.map((items) => items.map(({ id }) => id))).toEqual([
      ["REQ", "A"],
      ["REQ", "B"],
    ]);
  });

  it("counts subject credits once even when several sections are enabled", () => {
    const timetables = generateTimetablesForSelectionPlan({
      requiredSubjects: [subject("A", 2, 3)],
      choiceBags: [],
      creditRange: { minCredits: 3, maxCredits: 3 },
    });

    expect(timetables).toHaveLength(2);
  });

  it("rejects an inverted credit range", () => {
    expect(() => enumerateSubjectSelections({
      requiredSubjects: [],
      choiceBags: [],
      creditRange: { minCredits: 18, maxCredits: 15 },
    })).toThrow("최소·최대 학점");
  });

  it("combines exact counts from several groups before expanding their sections", () => {
    const timetables = generateTimetablesForSelectionPlan({
      requiredSubjects: [],
      choiceBags: [
        {
          id: "one",
          title: "1번 그룹",
          subjects: [subject("A"), subject("B")],
          minSubjects: 1,
          maxSubjects: 1,
        },
        {
          id: "two",
          title: "2번 그룹",
          subjects: [subject("C"), subject("D")],
          minSubjects: 1,
          maxSubjects: 1,
        },
        {
          id: "three",
          title: "3번 그룹",
          subjects: [subject("E"), subject("F"), subject("G")],
          minSubjects: 2,
          maxSubjects: 2,
        },
      ],
    });

    expect(timetables).toHaveLength(12);
    expect(timetables.map(({ courses }) => courses.map(({ id }) => id))).toContainEqual([
      "A-1",
      "C-1",
      "E-1",
      "F-1",
    ]);
  });

  it("uses only the sections enabled by the user", () => {
    const selectedSection = subject("A", 2);
    selectedSection.sections = [selectedSection.sections[1]!];

    const timetables = generateTimetablesForSelectionPlan({
      requiredSubjects: [selectedSection],
      choiceBags: [],
    });

    expect(timetables.map(({ courses }) => courses[0]?.id)).toEqual(["A-2"]);
  });

  it("removes completed subjects unless the user explicitly re-enables them", () => {
    const selections = enumerateSubjectSelections({
      requiredSubjects: [],
      choiceBags: [
        {
          id: "retake",
          title: "수강 후보",
          subjects: [subject("DONE"), subject("NEW")],
        },
      ],
      excludedSubjectIds: ["DONE"],
    });

    expect(selections.map((items) => items.map(({ id }) => id))).toEqual([["NEW"]]);
  });

  it("rejects a subject duplicated across bags instead of silently losing combinations", () => {
    const duplicate = subject("SAME");
    expect(() =>
      enumerateSubjectSelections({
        requiredSubjects: [],
        choiceBags: [
          { id: "one", title: "책가방 1", subjects: [duplicate] },
          { id: "two", title: "책가방 2", subjects: [duplicate] },
        ],
      }),
    ).toThrow(SelectionPlanError);
  });

  it("fails rather than returning an arbitrary subset when the safety limit is exceeded", () => {
    expect(() =>
      enumerateSubjectSelections(
        {
          requiredSubjects: [],
          choiceBags: [
            {
              id: "many",
              title: "많은 후보",
              subjects: [subject("A"), subject("B"), subject("C")],
            },
          ],
        },
        2,
      ),
    ).toThrow(SelectionPlanLimitError);
  });
});
