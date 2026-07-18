import { describe, expect, it } from "vitest";
import { confirmCurriculumRoadmap, getRoadmapMatch, parseCurriculumRoadmap, validateRoadmapForTarget } from "./curriculum-roadmap";

const extracted = { sourceDocumentId: "doc", status: "draft", academicYear: 2025, programCode: "316321", programName: "나노공학과", layoutType: "semester_grid", reviewReasons: [], courses: [{ printedCourseName: "공학수치해석", curriculumCategory: "전공", trackName: null, placementType: "exact", grade: 3, semester: 1, fromGrade: null, fromSemester: null, toGrade: null, toSemester: null, uncertain: false, uncertaintyReasons: [] }] };

describe("curriculum roadmap", () => {
  it("does not highlight an unconfirmed extraction", () => {
    const roadmap = parseCurriculumRoadmap(extracted);
    expect(getRoadmapMatch("공학수치해석", { programCode: "316321", admissionYear: 2025, currentGrade: 3, semester: 1 }, roadmap)).toBeNull();
  });
  it("matches a confirmed course by normalized printed name", () => {
    const roadmap = confirmCurriculumRoadmap(parseCurriculumRoadmap(extracted));
    expect(getRoadmapMatch("공학 수치해석", { programCode: "316321", admissionYear: 2025, currentGrade: 3, semester: 1 }, roadmap)?.printedCourseName).toBe("공학수치해석");
    expect(getRoadmapMatch("공학수치해석", { programCode: "316321", admissionYear: 2025, currentGrade: 3, semester: 2 }, roadmap)?.printedCourseName).toBe("공학수치해석");
  });
  it("does not include courses without a printed grade placement", () => {
    const parsed = parseCurriculumRoadmap({ ...extracted, courses: [{ ...extracted.courses[0], placementType: "unspecified", grade: null, semester: null }] });
    const roadmap = confirmCurriculumRoadmap(validateRoadmapForTarget(parsed, { currentGrade: 3, semester: 1 }));
    expect(getRoadmapMatch("공학수치해석", { programCode: "316321", admissionYear: 2025, currentGrade: 3, semester: 1 }, roadmap)).toBeNull();
  });
  it("rejects another term but keeps applicable year-only and range courses", () => {
    const roadmap = parseCurriculumRoadmap({ ...extracted, courses: [
      extracted.courses[0],
      { ...extracted.courses[0], printedCourseName: "다른학기과목", semester: 2 },
      { ...extracted.courses[0], printedCourseName: "학년만있는과목", placementType: "year_only", semester: null },
      { ...extracted.courses[0], printedCourseName: "건축설계현장실습", placementType: "range", grade: null, semester: null, fromGrade: 2, toGrade: 5 },
      { ...extracted.courses[0], printedCourseName: "1학년범위과목", placementType: "range", grade: null, semester: null, fromGrade: 1, toGrade: 1 },
    ] });
    const validated = validateRoadmapForTarget(roadmap, { currentGrade: 3, semester: 1 });
    expect(validated.courses.map((course) => course.printedCourseName)).toEqual(["공학수치해석", "학년만있는과목", "건축설계현장실습"]);
  });
});
