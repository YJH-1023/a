import { describe, expect, it } from "vitest";
import { confirmCurriculumRoadmap, getRoadmapMatch, parseCurriculumRoadmap } from "./curriculum-roadmap";

const extracted = { sourceDocumentId: "doc", status: "draft", academicYear: 2025, programCode: "316321", programName: "나노공학과", layoutType: "semester_grid", reviewReasons: [], courses: [{ printedCourseName: "공학수치해석", curriculumCategory: "전공", trackName: null, placementType: "exact", grade: 3, semester: 1, fromGrade: null, fromSemester: null, toGrade: null, toSemester: null, uncertain: false, uncertaintyReasons: [] }] };

describe("curriculum roadmap", () => {
  it("does not highlight an unconfirmed extraction", () => {
    const roadmap = parseCurriculumRoadmap(extracted);
    expect(getRoadmapMatch("공학수치해석", { programCode: "316321", admissionYear: 2025, currentGrade: 3, semester: 1 }, roadmap)).toBeNull();
  });
  it("matches only the confirmed admission-year, department, grade and semester", () => {
    const roadmap = confirmCurriculumRoadmap(parseCurriculumRoadmap(extracted));
    expect(getRoadmapMatch("공학 수치해석", { programCode: "316321", admissionYear: 2025, currentGrade: 3, semester: 1 }, roadmap)?.printedCourseName).toBe("공학수치해석");
    expect(getRoadmapMatch("공학수치해석", { programCode: "316321", admissionYear: 2025, currentGrade: 3, semester: 2 }, roadmap)).toBeNull();
  });
  it("does not include courses without a printed grade placement", () => {
    const roadmap = confirmCurriculumRoadmap(parseCurriculumRoadmap({ ...extracted, courses: [{ ...extracted.courses[0], placementType: "unspecified", grade: null, semester: null }] }));
    expect(getRoadmapMatch("공학수치해석", { programCode: "316321", admissionYear: 2025, currentGrade: 3, semester: 1 }, roadmap)).toBeNull();
  });
});
