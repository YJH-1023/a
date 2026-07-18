import { describe, expect, it } from "vitest";

import type { AcademicProfile } from "./academic-profile";
import {
  confirmAcademicProfile,
  getAcademicProfileValidationErrors,
  getReviewChecklist,
  isAcademicProfileConfirmed,
  markAcademicProfileDraft,
  parseAcademicProfileResponse,
} from "./academic-profile-client";

function makeProfile(): AcademicProfile {
  return {
    schemaVersion: "1.0",
    profile: {
      departmentCode: null,
      majorCodes: [],
      admissionYear: null,
      currentGrade: null,
      primaryCampus: null,
    },
    sourceDocuments: [{ id: "source-1", kind: "course_history", status: "draft" }],
    completedCourses: [
      {
        courseCode: "BUS2001",
        courseName: "경영학원론",
        majorScope: "제1전공",
        classification: "전공",
        year: 2025,
        term: "spring",
        credits: 3,
        area: "전공코어",
        completionStatus: "earned",
        recommendationPolicy: "exclude",
        flags: [],
        sourceDocumentId: "source-1",
        reviewReasons: ["영역 셀을 확인해 주세요."],
      },
    ],
    requirements: [],
    reviewIssues: [
      { code: "shifted_cell", message: "연도 셀을 확인해 주세요.", sourceDocumentId: "source-1" },
    ],
  };
}

describe("academic profile client state", () => {
  it("validates the API envelope before rendering", () => {
    const profile = makeProfile();

    expect(parseAcademicProfileResponse({ academicProfile: profile })).toBe(profile);
    expect(() => parseAcademicProfileResponse({ academicProfile: { schemaVersion: "1.0" } })).toThrow(
      "응답 형식",
    );
  });

  it("requires every document and row review before confirmation", () => {
    const profile = makeProfile();
    const checklist = getReviewChecklist(profile);

    expect(checklist).toHaveLength(2);
    expect(() => confirmAcademicProfile(profile, new Set([checklist[0]?.id]))).toThrow(
      "확인하지 않은",
    );

    const confirmed = confirmAcademicProfile(
      profile,
      new Set(checklist.map(({ id }) => id)),
    );
    expect(isAcademicProfileConfirmed(confirmed)).toBe(true);
    expect(isAcademicProfileConfirmed(markAcademicProfileDraft(confirmed))).toBe(false);
  });

  it("blocks confirmation when an edited row is invalid", () => {
    const profile = makeProfile();
    profile.completedCourses[0] = { ...profile.completedCourses[0]!, courseCode: "invalid" };

    expect(getAcademicProfileValidationErrors(profile)).toContain(
      "1번째 과목의 학수번호를 확인해 주세요.",
    );
    expect(() =>
      confirmAcademicProfile(profile, new Set(getReviewChecklist(profile).map(({ id }) => id))),
    ).toThrow("학수번호");
  });

  it("accepts a SKKU course code with three trailing digits", () => {
    const profile = makeProfile();
    profile.completedCourses[0] = {
      ...profile.completedCourses[0]!,
      courseCode: "GEDG001",
    };

    expect(getAcademicProfileValidationErrors(profile)).not.toEqual(
      expect.arrayContaining([expect.stringContaining("학수번호")]),
    );
  });

  it("does not require confirmation after multiple course codes were successfully split", () => {
    const profile = makeProfile();
    profile.completedCourses[0] = {
      ...profile.completedCourses[0]!,
      reviewReasons: ["다중 학수번호", "3.0 학점 표시됨"],
    };
    profile.reviewIssues = [
      {
        code: "MULTIPLESUBJECT",
        message: "Row contains multiple course codes",
        sourceDocumentId: "source-1",
      },
      {
        code: "unexpected_document_rows",
        message: "문서 종류와 맞지 않는 requirements 행은 반영하지 않았습니다.",
        sourceDocumentId: "source-1",
      },
    ];

    expect(getReviewChecklist(profile)).toEqual([]);
  });

  it("revalidates editable requirement rules before confirmation", () => {
    const profile = makeProfile();
    profile.completedCourses = [];
    profile.reviewIssues = [];
    profile.requirements = [
      {
        requirementId: "requirement-1",
        scope: "primary_major",
        label: "제1전공 심화학점",
        rule: { kind: "credit_minimum", credits: Number.NaN },
        earnedCredits: 15,
        inProgressCredits: { spring: 0, summer: 0, fall: 0, winter: 0, total: 0 },
        remainingCredits: 21,
        status: "unmet",
        rawValues: {},
        sourceDocumentId: "source-1",
        reviewReasons: [],
      },
    ];

    expect(() => confirmAcademicProfile(profile, new Set())).toThrow("기준 규칙");
  });

  it("groups repeated review reasons from one shared distribution requirement", () => {
    const profile = makeProfile();
    profile.completedCourses = [];
    profile.reviewIssues = [];
    profile.requirements = ["인간/문화", "사회/역사", "자연/과학/기술"].map(
      (area, index) => ({
        requirementId: `requirement-${index + 1}`,
        scope: "general",
        label: `균형교양 - ${area}`,
        rule: {
          kind: "distribution_minimum",
          groupId: "balanced-general",
          totalAreas: 3,
          minimumAreas: 2,
          totalCredits: 6,
          rawText: "3개 영역 중 최소 2개 영역에서 합계 6학점 이상 이수",
        },
        earnedCredits: null,
        inProgressCredits: { spring: 0, summer: 0, fall: 0, winter: 0, total: 0 },
        remainingCredits: 0,
        status: "review" as const,
        rawValues: { 취득학점: index === 0 ? "6 / 0" : "6 / 3" },
        sourceDocumentId: "source-1",
        reviewReasons: ["취득학점 값이 복합 형식이어서 원문 확인이 필요합니다."],
      }),
    );

    expect(getReviewChecklist(profile)).toEqual([]);
  });

  it("hides legacy non-blocking extraction notices from the confirmation checklist", () => {
    const profile = makeProfile();
    profile.completedCourses = [];
    profile.reviewIssues = [
      {
        code: "duplicate_credit",
        message: "중복 학점 표시 확인 필요: DS기반 행에 동일 과목이 중복 표시됨",
        sourceDocumentId: "source-1",
      },
    ];
    profile.requirements = [
      {
        requirementId: "requirement-1",
        scope: "ds",
        label: "DS기반(공통)",
        rule: { kind: "manual", rawText: "졸업요건 원문 확인" },
        earnedCredits: 0,
        inProgressCredits: { spring: 0, summer: 0, fall: 0, winter: 0, total: 0 },
        remainingCredits: 2,
        status: "review",
        rawValues: { 기준학점: "2" },
        sourceDocumentId: "source-1",
        reviewReasons: [
          "중복 표시 주의",
          "졸업요건 규칙을 자동으로 확정하지 못해 원문 기준으로 표시했습니다.",
          "수강학점 일부가 비어 있거나 복합 형식이어서 0으로 표시했습니다.",
          "기준학점 미달",
          "취득학점 미달",
        ],
      },
    ];

    expect(getReviewChecklist(profile)).toEqual([]);
  });

  it("hides deterministic classification, duplicate-credit, and distribution notices", () => {
    const profile = makeProfile();
    profile.completedCourses = [];
    profile.reviewIssues = [
      {
        code: "solar_requirement_rows_supplemented",
        message: "Solar가 누락한 졸업요건을 표에서 보완했습니다.",
        sourceDocumentId: "source-1",
      },
      {
        code: "duplicate_major_credit",
        message: "제1전공 심화·코어·실험실습은 C/L 과목 중복 취득학점 표시입니다.",
        sourceDocumentId: "source-1",
      },
      {
        code: "credit_above_requirement",
        message: "DS기반(계열1) 취득학점 4가 기준 2를 초과합니다.",
        sourceDocumentId: "source-1",
      },
    ];
    profile.requirements = [
      {
        requirementId: "requirement-1",
        scope: "general",
        label: "글로벌",
        rule: { kind: "credit_minimum", credits: 4 },
        earnedCredits: 4,
        inProgressCredits: { spring: 0, summer: 0, fall: 0, winter: 0, total: 0 },
        remainingCredits: 0,
        status: "satisfied",
        rawValues: {},
        sourceDocumentId: "source-1",
        reviewReasons: [
          "'글로벌'은 일반 교양에 해당함",
          "기준으로 '글로벌학점'이 중복 표시됨",
          "C/L 과목은 각각의 전공에 중복 되어 취득학점으로 표시",
        ],
      },
    ];

    expect(getReviewChecklist(profile)).toEqual([]);
  });
});
