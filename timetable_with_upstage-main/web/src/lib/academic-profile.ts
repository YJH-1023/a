export type AcademicDocumentKind = "course_history" | "graduation_requirements";
export type AcademicDocumentStatus = "draft" | "confirmed";
export type AcademicTerm = "spring" | "summer" | "fall" | "winter";
export type CompletionStatus = "earned" | "failed" | "withdrawn" | "review";
export type RequirementScope = "primary_major" | "general" | "ds" | "university" | "other";
export type RequirementStatus = "satisfied" | "in_progress" | "unmet" | "review";

export interface CompletedCourse {
  courseCode: string;
  courseName: string;
  majorScope: string;
  classification: string;
  year: number | null;
  term: AcademicTerm | null;
  credits: number;
  area: string;
  completionStatus: CompletionStatus;
  recommendationPolicy: "exclude" | "retake";
  flags: string[];
  sourceDocumentId: string;
  reviewReasons: string[];
}

export interface DistributionMinimumRule {
  kind: "distribution_minimum";
  groupId: string;
  totalAreas: number;
  minimumAreas: number;
  totalCredits: number;
  rawText: string;
}

export type RequirementRule =
  | { kind: "credit_minimum"; credits: number }
  | DistributionMinimumRule
  | { kind: "completion" | "manual"; rawText: string };

export function isDistributionMinimumSatisfied(
  rule: DistributionMinimumRule,
  creditsByArea: readonly number[],
): boolean {
  if (
    creditsByArea.length !== rule.totalAreas ||
    creditsByArea.some((credits) => !Number.isFinite(credits) || credits < 0)
  ) {
    return false;
  }
  const completedAreaCount = creditsByArea.filter((credits) => credits > 0).length;
  const totalCredits = creditsByArea.reduce((sum, credits) => sum + credits, 0);
  return completedAreaCount >= rule.minimumAreas && totalCredits >= rule.totalCredits;
}

export interface Requirement {
  requirementId: string;
  scope: RequirementScope;
  label: string;
  rule: RequirementRule;
  earnedCredits: number | null;
  inProgressCredits: {
    spring: number;
    summer: number;
    fall: number;
    winter: number;
    total: number;
  };
  remainingCredits: number | null;
  status: RequirementStatus;
  rawValues: Record<string, string>;
  sourceDocumentId: string;
  reviewReasons: string[];
}

export interface ReviewIssue {
  code: string;
  message: string;
  sourceDocumentId: string;
}

export interface AcademicProfile {
  schemaVersion: "1.0";
  profile: {
    departmentCode: string | null;
    majorCodes: string[];
    admissionYear: number | null;
    currentGrade: number | null;
    primaryCampus: "humanities" | "natural_sciences" | null;
  };
  sourceDocuments: Array<{
    id: string;
    kind: AcademicDocumentKind;
    status: AcademicDocumentStatus;
  }>;
  completedCourses: CompletedCourse[];
  requirements: Requirement[];
  reviewIssues: ReviewIssue[];
}
