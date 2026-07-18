import type {
  AcademicDocumentKind,
  AcademicProfile,
  AcademicTerm,
  CompletedCourse,
  CompletionStatus,
  Requirement,
  RequirementRule,
  RequirementScope,
  RequirementStatus,
  ReviewIssue,
} from "./academic-profile";

export interface ReviewChecklistItem {
  id: string;
  message: string;
}

const DOCUMENT_KINDS: readonly AcademicDocumentKind[] = [
  "course_history",
  "graduation_requirements",
];
const DOCUMENT_STATUSES = ["draft", "confirmed"] as const;
const TERMS: readonly AcademicTerm[] = ["spring", "summer", "fall", "winter"];
const COMPLETION_STATUSES: readonly CompletionStatus[] = [
  "earned",
  "failed",
  "withdrawn",
  "review",
];
const REQUIREMENT_SCOPES: readonly RequirementScope[] = [
  "primary_major",
  "general",
  "ds",
  "university",
  "other",
];
const REQUIREMENT_STATUSES: readonly RequirementStatus[] = [
  "satisfied",
  "in_progress",
  "unmet",
  "review",
];
const COURSE_CODE_PATTERN = /^[A-Z]{2,6}[0-9]{3,4}$/;

export function parseAcademicProfileResponse(payload: unknown): AcademicProfile {
  if (!isRecord(payload) || !isAcademicProfile(payload.academicProfile)) {
    throw new Error("학사문서 분석 응답 형식이 올바르지 않습니다. 다시 시도해 주세요.");
  }
  return payload.academicProfile;
}

export function getAcademicDocumentApiError(payload: unknown): string {
  if (
    isRecord(payload) &&
    isRecord(payload.error) &&
    typeof payload.error.message === "string" &&
    payload.error.message.trim()
  ) {
    return payload.error.message;
  }
  return "학사문서 분석을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}

/** The API's own error code (e.g. "upstage_not_configured"), for analytics error_type — never
 * the free-text Korean message, which could in principle echo back user-controlled content. */
export function getAcademicDocumentApiErrorCode(payload: unknown): string {
  if (
    isRecord(payload) &&
    isRecord(payload.error) &&
    typeof payload.error.code === "string" &&
    payload.error.code.trim()
  ) {
    return payload.error.code;
  }
  return "unknown_error";
}

export function getReviewChecklist(profile: AcademicProfile): ReviewChecklistItem[] {
  const items: ReviewChecklistItem[] = profile.reviewIssues.flatMap((issue, index) =>
    isNonBlockingReviewMessage(issue.code, issue.message)
      ? []
      : [{ id: `issue-${index}`, message: issue.message }],
  );

  profile.completedCourses.forEach((course, courseIndex) => {
    course.reviewReasons.forEach((reason, reasonIndex) => {
      if (isNonBlockingCourseReview(reason)) {
        return;
      }
      items.push({
        id: `course-${courseIndex}-${reasonIndex}`,
        message: `${course.courseCode} ${course.courseName}: ${reason}`,
      });
    });
  });
  const groupedRequirementReasons = new Set<string>();
  profile.requirements.forEach((requirement, requirementIndex) => {
    requirement.reviewReasons.forEach((reason, reasonIndex) => {
      if (isNonBlockingRequirementReview(requirement, reason)) {
        return;
      }
      if (requirement.rule.kind === "distribution_minimum") {
        const groupReasonKey = `${requirement.rule.groupId}\u001f${reason}`;
        if (groupedRequirementReasons.has(groupReasonKey)) {
          return;
        }
        groupedRequirementReasons.add(groupReasonKey);
        items.push({
          id: `requirement-group-${requirementIndex}-${reasonIndex}`,
          message: `${requirement.label.split("-")[0]?.trim() || requirement.label} 공동 요건: ${reason}`,
        });
        return;
      }
      items.push({
        id: `requirement-${requirementIndex}-${reasonIndex}`,
        message: `${requirement.label}: ${reason}`,
      });
    });
  });
  return items;
}

function isNonBlockingRequirementReview(
  requirement: Requirement,
  reason: string,
): boolean {
  if (
    reason.includes("수강학점 일부가 비어 있거나 복합 형식") ||
    reason.includes("수강학점 세부값이 없어 0으로 표시") ||
    reason.includes("기준학점 미달") ||
    reason.includes("취득학점 미달") ||
    isDeterministicRequirementNotice(requirement, reason)
  ) {
    return true;
  }
  if (!reason.includes("졸업요건 규칙을 자동으로 확정하지 못해")) {
    return false;
  }
  const requiredCredits =
    requirement.rawValues["기준학점"] ??
    requirement.rawValues.requiredCredits ??
    requirement.rawValues.minimumCredits;
  return typeof requiredCredits === "string" && isNonNegativeNumber(Number(requiredCredits));
}

function isNonBlockingCourseReview(reason: string): boolean {
  const normalized = reason.trim().toLowerCase();
  return (
    normalized === "다중 학수번호" ||
    normalized === "multiple course codes" ||
    /^\d+(?:\.\d+)?\s*학점\s*표시됨$/.test(normalized)
  );
}

function isDeterministicRequirementNotice(
  requirement: Requirement,
  reason: string,
): boolean {
  const normalized = reason.replace(/\s+/g, " ").trim();
  return (
    normalized === "중복 표시 주의" ||
    (normalized.includes("C/L 과목") && normalized.includes("중복")) ||
    normalized.includes("중복 표시됨") ||
    /취득학점.*기준(?:학점)?.*초과/.test(normalized) ||
    normalized.includes("동일 분포 규칙을 공유") ||
    normalized.includes("그룹 ID='balanced-area'") ||
    normalized.includes("일반 교양에 해당") ||
    normalized.includes("DS 교양에 해당") ||
    normalized.includes("혼합값은 status review로 처리") ||
    normalized.includes("혼합값임") ||
    (requirement.rule.kind === "distribution_minimum" &&
      normalized.includes("취득학점 값이 복합 형식"))
  );
}

function isNonBlockingReviewMessage(code: string, message: string): boolean {
  return (
    code.trim().toUpperCase() === "MULTIPLESUBJECT" ||
    code === "unexpected_document_rows" ||
    code === "solar_requirement_rows_supplemented" ||
    (message.includes("중복 학점 표시 확인 필요") && message.includes("DS기반")) ||
    isDeterministicReviewMessage(message)
  );
}

function isDeterministicReviewMessage(message: string): boolean {
  const normalized = message.replace(/\s+/g, " ").trim();
  return (
    (normalized.includes("C/L 과목") && normalized.includes("중복")) ||
    normalized.includes("중복 표시됨") ||
    /취득학점.*기준(?:학점)?.*초과/.test(normalized) ||
    normalized.includes("동일 분포 규칙을 공유") ||
    normalized.includes("그룹 ID='balanced-area'") ||
    normalized.includes("일반 교양에 해당") ||
    normalized.includes("DS 교양에 해당") ||
    normalized.includes("혼합값은 status review로 처리") ||
    normalized.includes("혼합값임")
  );
}

export function markAcademicProfileDraft(profile: AcademicProfile): AcademicProfile {
  return {
    ...profile,
    sourceDocuments: profile.sourceDocuments.map((document) => ({
      ...document,
      status: "draft",
    })),
  };
}

export function confirmAcademicProfile(
  profile: AcademicProfile,
  acknowledgedReviewIds: ReadonlySet<string>,
): AcademicProfile {
  const validationErrors = getAcademicProfileValidationErrors(profile);
  if (validationErrors.length > 0) {
    throw new Error(validationErrors[0]);
  }

  const pendingReviews = getReviewChecklist(profile).filter(
    (item) => !acknowledgedReviewIds.has(item.id),
  );
  if (pendingReviews.length > 0) {
    throw new Error(`확인하지 않은 검토 항목이 ${pendingReviews.length}개 있습니다.`);
  }

  return {
    ...profile,
    sourceDocuments: profile.sourceDocuments.map((document) => ({
      ...document,
      status: "confirmed",
    })),
  };
}

export function isAcademicProfileConfirmed(profile: AcademicProfile): boolean {
  return (
    profile.sourceDocuments.length > 0 &&
    profile.sourceDocuments.every((document) => document.status === "confirmed")
  );
}

export function getAcademicProfileValidationErrors(profile: AcademicProfile): string[] {
  const errors: string[] = [];
  profile.completedCourses.forEach((course, index) => {
    if (!COURSE_CODE_PATTERN.test(course.courseCode.trim().toUpperCase())) {
      errors.push(`${index + 1}번째 과목의 학수번호를 확인해 주세요.`);
    }
    if (!course.courseName.trim()) {
      errors.push(`${index + 1}번째 과목명을 입력해 주세요.`);
    }
    if (!Number.isFinite(course.credits) || course.credits < 0) {
      errors.push(`${index + 1}번째 과목의 학점을 확인해 주세요.`);
    }
    if (course.year !== null && !isIntegerInRange(course.year, 2000, 2100)) {
      errors.push(`${index + 1}번째 과목의 이수년도를 확인해 주세요.`);
    }
  });
  profile.requirements.forEach((requirement, index) => {
    if (!requirement.label.trim()) {
      errors.push(`${index + 1}번째 요건명을 입력해 주세요.`);
    }
    if (!isNullableNonNegativeNumber(requirement.earnedCredits)) {
      errors.push(`${index + 1}번째 요건의 취득학점을 확인해 주세요.`);
    }
    if (!isNullableNonNegativeNumber(requirement.remainingCredits)) {
      errors.push(`${index + 1}번째 요건의 잔여학점을 확인해 주세요.`);
    }
    if (!isNonNegativeNumber(requirement.inProgressCredits.total)) {
      errors.push(`${index + 1}번째 요건의 수강중 학점을 확인해 주세요.`);
    }
    if (!isRequirementRule(requirement.rule)) {
      errors.push(`${index + 1}번째 요건의 기준 규칙을 확인해 주세요.`);
    }
  });
  return errors;
}

function isAcademicProfile(value: unknown): value is AcademicProfile {
  return (
    isRecord(value) &&
    value.schemaVersion === "1.0" &&
    isProfileSummary(value.profile) &&
    Array.isArray(value.sourceDocuments) &&
    value.sourceDocuments.length > 0 &&
    value.sourceDocuments.every(isSourceDocument) &&
    Array.isArray(value.completedCourses) &&
    value.completedCourses.every(isCompletedCourse) &&
    Array.isArray(value.requirements) &&
    value.requirements.every(isRequirement) &&
    Array.isArray(value.reviewIssues) &&
    value.reviewIssues.every(isReviewIssue)
  );
}

function isProfileSummary(value: unknown): value is AcademicProfile["profile"] {
  return (
    isRecord(value) &&
    (value.departmentCode === null || typeof value.departmentCode === "string") &&
    Array.isArray(value.majorCodes) &&
    value.majorCodes.every((code) => typeof code === "string") &&
    (value.admissionYear === null || isIntegerInRange(value.admissionYear, 2000, 2100)) &&
    (value.currentGrade === null || isIntegerInRange(value.currentGrade, 1, 7)) &&
    (value.primaryCampus === null ||
      value.primaryCampus === "humanities" ||
      value.primaryCampus === "natural_sciences")
  );
}

function isSourceDocument(value: unknown): value is AcademicProfile["sourceDocuments"][number] {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    readEnum(value.kind, DOCUMENT_KINDS) !== null &&
    readEnum(value.status, DOCUMENT_STATUSES) !== null
  );
}

function isCompletedCourse(value: unknown): value is CompletedCourse {
  return (
    isRecord(value) &&
    typeof value.courseCode === "string" &&
    typeof value.courseName === "string" &&
    typeof value.majorScope === "string" &&
    typeof value.classification === "string" &&
    (value.year === null || isIntegerInRange(value.year, 2000, 2100)) &&
    (value.term === null || readEnum(value.term, TERMS) !== null) &&
    isNonNegativeNumber(value.credits) &&
    typeof value.area === "string" &&
    readEnum(value.completionStatus, COMPLETION_STATUSES) !== null &&
    (value.recommendationPolicy === "exclude" || value.recommendationPolicy === "retake") &&
    isStringArray(value.flags) &&
    typeof value.sourceDocumentId === "string" &&
    value.sourceDocumentId.length > 0 &&
    isStringArray(value.reviewReasons)
  );
}

function isRequirement(value: unknown): value is Requirement {
  return (
    isRecord(value) &&
    typeof value.requirementId === "string" &&
    value.requirementId.length > 0 &&
    readEnum(value.scope, REQUIREMENT_SCOPES) !== null &&
    typeof value.label === "string" &&
    isRequirementRule(value.rule) &&
    isNullableNonNegativeNumber(value.earnedCredits) &&
    isInProgressCredits(value.inProgressCredits) &&
    isNullableNonNegativeNumber(value.remainingCredits) &&
    readEnum(value.status, REQUIREMENT_STATUSES) !== null &&
    isStringRecord(value.rawValues) &&
    typeof value.sourceDocumentId === "string" &&
    value.sourceDocumentId.length > 0 &&
    isStringArray(value.reviewReasons)
  );
}

function isRequirementRule(value: unknown): value is RequirementRule {
  if (!isRecord(value)) {
    return false;
  }
  if (value.kind === "credit_minimum") {
    return isNonNegativeNumber(value.credits);
  }
  if (value.kind === "distribution_minimum") {
    return (
      typeof value.groupId === "string" &&
      value.groupId.length > 0 &&
      typeof value.totalAreas === "number" &&
      Number.isInteger(value.totalAreas) &&
      value.totalAreas >= 1 &&
      typeof value.minimumAreas === "number" &&
      Number.isInteger(value.minimumAreas) &&
      value.minimumAreas >= 1 &&
      value.minimumAreas <= value.totalAreas &&
      isNonNegativeNumber(value.totalCredits) &&
      typeof value.rawText === "string"
    );
  }
  return (
    (value.kind === "completion" || value.kind === "manual") &&
    typeof value.rawText === "string"
  );
}

function isInProgressCredits(value: unknown): value is Requirement["inProgressCredits"] {
  return (
    isRecord(value) &&
    isNonNegativeNumber(value.spring) &&
    isNonNegativeNumber(value.summer) &&
    isNonNegativeNumber(value.fall) &&
    isNonNegativeNumber(value.winter) &&
    isNonNegativeNumber(value.total)
  );
}

function isReviewIssue(value: unknown): value is ReviewIssue {
  return (
    isRecord(value) &&
    typeof value.code === "string" &&
    value.code.length > 0 &&
    typeof value.message === "string" &&
    value.message.length > 0 &&
    typeof value.sourceDocumentId === "string" &&
    value.sourceDocumentId.length > 0
  );
}

function isNullableNonNegativeNumber(value: unknown): value is number | null {
  return value === null || isNonNegativeNumber(value);
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isIntegerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= maximum;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === "string");
}

function readEnum<T extends string>(value: unknown, values: readonly T[]): T | null {
  return typeof value === "string" && values.includes(value as T) ? (value as T) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
