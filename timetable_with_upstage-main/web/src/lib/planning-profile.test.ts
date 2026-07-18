import { describe, expect, it } from "vitest";

import {
  getExcludedCourseNumbers,
  getStudentProfileError,
  INITIAL_STUDENT_PROFILE,
  toAcademicProfileDetails,
  toSkkuCourseQuery,
} from "./planning-profile";

describe("student planning profile", () => {
  it("accepts fifth, sixth, and extended enrollment grades", () => {
    for (const currentGrade of [5, 6, 7]) {
      expect(getStudentProfileError({
        ...INITIAL_STUDENT_PROFILE,
        departmentCode: "316901",
        admissionYear: 2022,
        currentGrade,
        primaryCampus: "humanities",
      })).toBeNull();
    }
  });

  it("accepts a directly entered admission year outside the quick-select range", () => {
    expect(getStudentProfileError({
      ...INITIAL_STUDENT_PROFILE,
      departmentCode: "316901",
      admissionYear: 2017,
      currentGrade: 3,
      primaryCampus: "humanities",
    })).toBeNull();
  });

  it("requires identity-minimized basic information before querying courses", () => {
    expect(getStudentProfileError(INITIAL_STUDENT_PROFILE)).toContain("학과");
    expect(toSkkuCourseQuery(INITIAL_STUDENT_PROFILE)).toBeNull();
  });

  it("maps campus and department into a scoped course query", () => {
    const profile = {
      ...INITIAL_STUDENT_PROFILE,
      departmentCode: "316901",
      admissionYear: 2022,
      currentGrade: 3,
      primaryCampus: "humanities" as const,
    };

    expect(toSkkuCourseQuery(profile)).toEqual({
      year: 2026,
      term: 20,
      campus: 1,
      departmentCode: "316901",
    });
    expect(toAcademicProfileDetails(profile)).toMatchObject({
      departmentCode: "316901",
      majorCodes: ["316901"],
      admissionYear: 2022,
      currentGrade: 3,
      primaryCampus: "humanities",
    });
  });

  it("excludes only earned courses that are not marked for retake", () => {
    const profile = {
      schemaVersion: "1.0" as const,
      profile: toAcademicProfileDetails(INITIAL_STUDENT_PROFILE),
      sourceDocuments: [],
      requirements: [],
      reviewIssues: [],
      completedCourses: [
        {
          courseCode: " add2003 ",
          courseName: "경영학원론",
          majorScope: "제1전공",
          classification: "전공코어",
          year: 2025,
          term: "spring" as const,
          credits: 3,
          area: "전공코어",
          completionStatus: "earned" as const,
          recommendationPolicy: "exclude" as const,
          flags: [],
          sourceDocumentId: "source-1",
          reviewReasons: [],
        },
        {
          courseCode: "ADD2021",
          courseName: "재수강 과목",
          majorScope: "제1전공",
          classification: "전공코어",
          year: 2025,
          term: "fall" as const,
          credits: 3,
          area: "전공코어",
          completionStatus: "earned" as const,
          recommendationPolicy: "exclude" as const,
          flags: [],
          sourceDocumentId: "source-1",
          reviewReasons: [],
        },
        {
          courseCode: "ADD9999",
          courseName: "Retake candidate",
          majorScope: "major",
          classification: "major",
          year: 2025,
          term: "fall" as const,
          credits: 3,
          area: "major",
          completionStatus: "earned" as const,
          recommendationPolicy: "retake" as const,
          flags: [],
          sourceDocumentId: "source-1",
          reviewReasons: [],
        },
      ],
    };

    expect(getExcludedCourseNumbers(profile)).toEqual(["ADD2003", "ADD2021"]);
  });
});
