import type { AcademicProfile } from "./academic-profile";
import type { SkkuCourseQuery, SkkuTerm } from "./skku-course-api";
import { findSkkuDepartment } from "./skku-departments";

export interface StudentPlanningProfile {
  departmentCode: string;
  admissionYear: number | null;
  currentGrade: number | null;
  primaryCampus: "humanities" | "natural_sciences" | null;
  courseYear: number;
  courseTerm: SkkuTerm;
}

export const INITIAL_STUDENT_PROFILE: StudentPlanningProfile = {
  departmentCode: "",
  admissionYear: null,
  currentGrade: null,
  primaryCampus: null,
  courseYear: 2026,
  courseTerm: 20,
};

export function getStudentProfileError(profile: StudentPlanningProfile): string | null {
  if (!/^\d{4,8}$/.test(profile.departmentCode)) {
    return "소속 학과를 선택하거나 학과코드를 입력해 주세요.";
  }
  if (
    profile.admissionYear === null ||
    !Number.isInteger(profile.admissionYear) ||
    profile.admissionYear < 2000 ||
    profile.admissionYear > profile.courseYear
  ) {
    return "입학연도를 4자리로 입력해 주세요.";
  }
  if (profile.currentGrade === null || ![1, 2, 3, 4, 5, 6, 7].includes(profile.currentGrade)) {
    return "현재 학년을 선택해 주세요.";
  }
  if (profile.primaryCampus === null) {
    return "주 캠퍼스를 선택해 주세요.";
  }
  return null;
}

export function toSkkuCourseQuery(profile: StudentPlanningProfile): SkkuCourseQuery | null {
  if (getStudentProfileError(profile)) {
    return null;
  }
  return {
    year: profile.courseYear,
    term: profile.courseTerm,
    campus: profile.primaryCampus === "humanities" ? 1 : 2,
    departmentCode: profile.departmentCode,
  };
}

export function toAcademicProfileDetails(
  profile: StudentPlanningProfile,
): AcademicProfile["profile"] {
  return {
    departmentCode: profile.departmentCode || null,
    majorCodes: profile.departmentCode ? [profile.departmentCode] : [],
    admissionYear: profile.admissionYear,
    currentGrade: profile.currentGrade,
    primaryCampus: profile.primaryCampus,
  };
}

export function getCourseQueryLabel(profile: StudentPlanningProfile): string {
  const department = findSkkuDepartment(profile.departmentCode);
  const termLabel: Record<SkkuTerm, string> = {
    10: "1학기",
    15: "여름학기",
    20: "2학기",
    25: "겨울학기",
  };
  return `${profile.courseYear}년 ${termLabel[profile.courseTerm]} · ${department?.name ?? profile.departmentCode}`;
}

export function getExcludedCourseNumbers(profile: AcademicProfile | undefined): string[] {
  return (profile?.completedCourses ?? [])
    .filter(
      (course) =>
        course.completionStatus === "earned" && course.recommendationPolicy === "exclude",
    )
    .map((course) => course.courseCode.trim().toUpperCase())
    .filter(Boolean);
}
