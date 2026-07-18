import { describe, expect, it } from "vitest";

import { courseGroupsFromCollection, shouldShowSectionDetails } from "./course-candidates";

describe("courseGroupsFromCollection", () => {
  it("shows section metadata before course selection for one or multiple sections", () => {
    expect(shouldShowSectionDetails(0)).toBe(false);
    expect(shouldShowSectionDetails(1)).toBe(true);
    expect(shouldShowSectionDetails(2)).toBe(true);
  });

  it("groups scraper Course JSON rows by course number and keeps every section", () => {
    const groups = courseGroupsFromCollection({
      generated_at: "2026-07-13T00:00:00Z",
      courses: [
        {
          course_id: "BUS101-01",
          course_number: "BUS101",
          section: "01",
          name: "경영학원론",
          schedule: "월09:00-10:15",
          credits: "3(3)",
          classification: "전공코어",
          professor: "김교수",
          course_type: "오프라인",
        },
        {
          course_id: "BUS101-02",
          course_number: "BUS101",
          section: "02",
          name: "경영학원론",
          schedule: "화13:30-14:45",
          credits: "3(3)",
          classification: "전공코어",
        },
        {
          course_id: "GEDG001-41",
          course_number: "GEDG001",
          section: "41",
          name: "영어쓰기",
          schedule: "수12:00-13:15",
          credits: "2(2)",
          classification: "의사소통",
        },
      ],
    });

    expect(groups).toEqual([
      {
        id: "BUS101",
        title: "경영학원론",
        classification: "전공코어",
        credits: 3,
        candidates: [
          {
            id: "BUS101-01",
            title: "경영학원론 · 01분반",
            schedule: "월09:00-10:15",
            credits: 3,
            section: "01",
            professor: "김교수",
            courseType: "오프라인",
          },
          {
            id: "BUS101-02",
            title: "경영학원론 · 02분반",
            schedule: "화13:30-14:45",
            credits: 3,
            section: "02",
          },
        ],
      },
      {
        id: "GEDG001",
        title: "영어쓰기",
        classification: "의사소통",
        credits: 2,
        candidates: [
          {
            id: "GEDG001-41",
            title: "영어쓰기 · 41분반",
            schedule: "수12:00-13:15",
            credits: 2,
            section: "41",
          },
        ],
      },
    ]);
  });

  it("reads the leading credit value from SKKU's combined credit notation", () => {
    const [group] = courseGroupsFromCollection({
      courses: [{
        course_id: "TEST-01",
        course_number: "TEST",
        name: "테스트",
        credits: "1.5(2)",
      }],
    });

    expect(group?.credits).toBe(1.5);
    expect(group?.candidates[0]?.credits).toBe(1.5);
  });

  it("rejects a malformed collection instead of guessing its schema", () => {
    expect(() => courseGroupsFromCollection({ courses: [{ name: "과목" }] })).toThrow(
      "course_id 문자열이 필요합니다.",
    );
  });
});
