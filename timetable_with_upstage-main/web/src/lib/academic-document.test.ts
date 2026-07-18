import { describe, expect, it } from "vitest";

import {
  AcademicExtractionError,
  cleanCompletedCourseExtraction,
  parseAcademicExtraction,
  supplementGraduationRequirementsFromMarkdown,
} from "./academic-document";

const EMPTY_REQUIREMENT_ARRAYS = {
  requirements: [],
  reviewIssues: [],
};

describe("parseAcademicExtraction", () => {
  it("builds a privacy-minimized course-history draft", () => {
    const content = JSON.stringify({
      completedCourses: [
        {
          courseCode: "bus2001",
          courseName: "경영학원론",
          majorScope: "제1전공",
          classification: "전공",
          year: 2025,
          term: "fall",
          credits: 3,
          area: "전공코어",
          completionStatus: "earned",
          flags: ["국제어", "국제어"],
          reviewReasons: [],
          exactGrade: "A+",
          studentName: "반환하면 안 됨",
        },
      ],
      ...EMPTY_REQUIREMENT_ARRAYS,
      studentNumber: "2020123456",
    });

    const profile = parseAcademicExtraction(content, "course_history", "source-1");

    expect(profile.sourceDocuments).toEqual([
      { id: "source-1", kind: "course_history", status: "draft" },
    ]);
    expect(profile.completedCourses).toEqual([
      {
        courseCode: "BUS2001",
        courseName: "경영학원론",
        majorScope: "제1전공",
        classification: "전공",
        year: 2025,
        term: "fall",
        credits: 3,
        area: "전공코어",
        completionStatus: "earned",
        recommendationPolicy: "exclude",
        flags: ["국제어"],
        sourceDocumentId: "source-1",
        reviewReasons: [],
      },
    ]);
    expect(JSON.stringify(profile)).not.toContain("A+");
    expect(JSON.stringify(profile)).not.toContain("2020123456");
    expect(profile.profile).toEqual({
      departmentCode: null,
      majorCodes: [],
      admissionYear: null,
      currentGrade: null,
      primaryCampus: null,
    });
  });

  it("accepts fenced JSON and builds requirement identifiers on the server", () => {
    const content = `\`\`\`json
${JSON.stringify({
  completedCourses: [],
  requirements: [
    {
      scope: "general",
      label: "균형교양 - 인간/문화",
      rule: {
        kind: "distribution_minimum",
        minimumAreas: 2,
        totalCredits: 6,
        rawText: "3개 영역 중 2개 영역 이상 6학점",
      },
      earnedCredits: null,
      inProgressCredits: { spring: 0, summer: 0, fall: 0, winter: 0, total: 0 },
      remainingCredits: 0,
      status: "review",
      rawValues: { 취득학점: "6 / 0" },
      reviewReasons: ["복합값 확인 필요"],
    },
  ],
  reviewIssues: [{ code: "composite_value", message: "복합 셀을 확인해주세요." }],
})}
\`\`\``;

    const profile = parseAcademicExtraction(
      content,
      "graduation_requirements",
      "source-2",
    );

    expect(profile.requirements[0]).toMatchObject({
      requirementId: "requirement-1",
      status: "review",
      rawValues: { 취득학점: "6 / 0" },
      sourceDocumentId: "source-2",
    });
    expect(profile.reviewIssues).toEqual([
      {
        code: "composite_value",
        message: "복합 셀을 확인해주세요.",
        sourceDocumentId: "source-2",
      },
    ]);
  });

  it("drops a malformed row and creates an explicit review issue", () => {
    const profile = parseAcademicExtraction(
      JSON.stringify({
        completedCourses: [
          {
            courseCode: "not-a-course-code",
            courseName: "형식 오류",
            majorScope: "",
            classification: "",
            year: null,
            term: null,
            credits: 3,
            area: "",
            completionStatus: "review",
            flags: [],
            reviewReasons: ["확인 필요"],
          },
        ],
        ...EMPTY_REQUIREMENT_ARRAYS,
      }),
      "course_history",
      "source-3",
    );

    expect(profile.completedCourses).toEqual([]);
    expect(profile.reviewIssues).toEqual([
      expect.objectContaining({ code: "invalid_completed_course", sourceDocumentId: "source-3" }),
    ]);
  });

  it("accepts SKKU three-digit course codes and Korean semester labels", () => {
    const terms = [
      ["GEDG001", "1학기", "spring"],
      ["GEDM012", "2 학기", "fall"],
      ["CHS7001", "여름학", "summer"],
      ["BIZ2021", "겨울학", "winter"],
    ];
    const profile = parseAcademicExtraction(
      JSON.stringify({
        completedCourses: terms.map(([courseCode, term]) => ({
          courseCode,
          courseName: "테스트 과목",
          majorScope: "제1전공",
          classification: "교양",
          year: 2025,
          term,
          credits: 3,
          area: "영역",
          completionStatus: "earned",
          flags: [],
          reviewReasons: ["다중 학수번호"],
        })),
        requirements: [],
        reviewIssues: [
          { code: "E3", message: "제1전공" },
          { code: "MULTIPLESUBJECT", message: "Row contains multiple course codes" },
        ],
      }),
      "course_history",
      "source-skku-codes",
    );

    expect(profile.completedCourses.map(({ courseCode, term }) => [courseCode, term])).toEqual(
      terms.map(([courseCode, , normalizedTerm]) => [courseCode, normalizedTerm]),
    );
    expect(profile.completedCourses.every((course) => course.reviewReasons.length === 0)).toBe(
      true,
    );
    expect(profile.reviewIssues).toEqual([]);
  });

  it("preserves all requirement rows when Solar returns safe values in mixed JSON types", () => {
    const requirements = Array.from({ length: 16 }, (_, index) => ({
      scope: index < 3 ? "제1전공" : "general",
      label: index < 3 ? `제1전공 요건 ${index + 1}` : `교양 요건 ${index + 1}`,
      rule: { kind: "credit_minimum", credits: String(index + 2) },
      earnedCredits: String(index),
      inProgressCredits: {
        "1학기": "0",
        여름: 0,
        "2학기": "0",
        겨울: 0,
        계: "0",
      },
      remainingCredits: String(index + 2),
      status: "미충족",
      rawValues: {
        기준학점: index + 2,
        취득학점: index,
        잔여학점: index + 2,
      },
    }));

    const profile = parseAcademicExtraction(
      JSON.stringify({ completedCourses: [], requirements, reviewIssues: [] }),
      "graduation_requirements",
      "source-requirements",
    );

    expect(profile.requirements).toHaveLength(16);
    expect(profile.requirements[0]).toMatchObject({
      requirementId: "requirement-1",
      scope: "primary_major",
      rule: { kind: "credit_minimum", credits: 2 },
      earnedCredits: 0,
      inProgressCredits: { spring: 0, summer: 0, fall: 0, winter: 0, total: 0 },
      remainingCredits: 2,
      status: "unmet",
      rawValues: { 기준학점: "2", 취득학점: "0", 잔여학점: "2" },
      reviewReasons: [],
    });
    expect(profile.reviewIssues).toEqual([]);
  });

  it("keeps a composite requirement as a review row instead of dropping it", () => {
    const profile = parseAcademicExtraction(
      JSON.stringify({
        completedCourses: [],
        requirements: [
          {
            scope: "general",
            label: "균형교양 - 인간/문화",
            rule: {
              kind: "distribution_minimum",
              minimumAreas: "2",
              totalCredits: "6",
              rawText: "3개 영역 중 2개 영역 이상에서 총 6학점 이상 이수",
            },
            earnedCredits: "6 / 0",
            inProgressCredits: {
              spring: "0 / 0",
              summer: "0 / 0",
              fall: "0 / 0",
              winter: "0 / 0",
              total: "0 / 0",
            },
            remainingCredits: "0",
            status: "satisfied",
            rawValues: { 기준학점: "영역 이수", 취득학점: "6 / 0", 잔여학점: 0 },
          },
        ],
        reviewIssues: [],
      }),
      "graduation_requirements",
      "source-composite",
    );

    expect(profile.requirements).toHaveLength(1);
    expect(profile.requirements[0]).toMatchObject({
      earnedCredits: null,
      inProgressCredits: { spring: 0, summer: 0, fall: 0, winter: 0, total: 0 },
      remainingCredits: 0,
      status: "review",
      rawValues: { 취득학점: "6 / 0", 잔여학점: "0" },
    });
    expect(profile.requirements[0]?.reviewReasons).toEqual(
      expect.arrayContaining([expect.stringContaining("취득학점")]),
    );
    expect(profile.reviewIssues).toEqual([]);
  });

  it("does not create blocking reviews for unused in-progress credits or known DS duplication", () => {
    const profile = parseAcademicExtraction(
      JSON.stringify({
        completedCourses: [],
        requirements: [
          {
            scope: "ds",
            label: "DS기반(공통)",
            rule: { kind: "manual", rawText: "졸업요건 원문 확인" },
            earnedCredits: 0,
            remainingCredits: 2,
            status: "unmet",
            rawValues: { 기준학점: 2, 취득학점: 0, 잔여학점: 2 },
            reviewReasons: [
              "중복 표시 주의",
              "졸업요건 규칙을 자동으로 확정하지 못해 원문 기준으로 표시했습니다.",
              "수강학점 일부가 비어 있거나 복합 형식이어서 0으로 표시했습니다.",
            ],
          },
        ],
        reviewIssues: [
          {
            code: "duplicate_credit",
            message:
              "중복 학점 표시 확인 필요: DS기반(계열1)과 DS기반(공통)에서 동일한 전공 과목이 중복 표시됨",
          },
        ],
      }),
      "graduation_requirements",
      "source-known-information",
    );

    expect(profile.requirements[0]).toMatchObject({
      rule: { kind: "credit_minimum", credits: 2 },
      inProgressCredits: { spring: 0, summer: 0, fall: 0, winter: 0, total: 0 },
      status: "unmet",
      reviewReasons: [],
    });
    expect(profile.reviewIssues).toEqual([]);
  });

  it("derives a satisfied credit requirement from remaining credits instead of Solar warnings", () => {
    const profile = parseAcademicExtraction(
      JSON.stringify({
        completedCourses: [],
        requirements: [
          {
            scope: "general",
            label: "의사소통",
            rule: { kind: "credit_minimum", credits: 4 },
            earnedCredits: 4,
            remainingCredits: 0,
            status: "unmet",
            rawValues: { 기준학점: 4, 취득학점: 4, 잔여학점: 0 },
            reviewReasons: ["기준학점 미달"],
          },
        ],
        reviewIssues: [],
      }),
      "graduation_requirements",
      "source-satisfied-requirement",
    );

    expect(profile.requirements[0]).toMatchObject({
      label: "의사소통",
      rule: { kind: "credit_minimum", credits: 4 },
      earnedCredits: 4,
      remainingCredits: 0,
      status: "satisfied",
      reviewReasons: [],
    });
  });

  it("recomputes remaining credits from code instead of trusting Solar's own arithmetic, and flags a mismatch", () => {
    const profile = parseAcademicExtraction(
      JSON.stringify({
        completedCourses: [],
        requirements: [
          {
            scope: "general",
            label: "글로벌",
            rule: { kind: "credit_minimum", credits: 10 },
            earnedCredits: 6,
            inProgressCredits: { spring: 0, summer: 0, fall: 0, winter: 0, total: 0 },
            // Solar reported 5, but 10 - 6 - 0 = 4: code must win, not Solar's arithmetic.
            remainingCredits: 5,
            status: "unmet",
            rawValues: { 기준학점: "10", 취득학점: "6", 잔여학점: "5" },
          },
        ],
        reviewIssues: [],
      }),
      "graduation_requirements",
      "source-remaining-mismatch",
    );

    expect(profile.requirements[0]).toMatchObject({
      remainingCredits: 4,
      status: "review",
    });
    expect(profile.requirements[0]?.reviewReasons).toEqual(
      expect.arrayContaining([expect.stringContaining("기준·취득·수강학점으로 계산한 잔여학점")]),
    );
  });

  it("computes remaining credits even when Solar omits the field entirely", () => {
    const profile = parseAcademicExtraction(
      JSON.stringify({
        completedCourses: [],
        requirements: [
          {
            scope: "general",
            label: "창의",
            rule: { kind: "credit_minimum", credits: 3 },
            earnedCredits: 1,
            inProgressCredits: { spring: 1, summer: 0, fall: 0, winter: 0, total: 1 },
            remainingCredits: null,
            status: "in_progress",
            rawValues: { 기준학점: "3", 취득학점: "1" },
          },
        ],
        reviewIssues: [],
      }),
      "graduation_requirements",
      "source-remaining-missing",
    );

    expect(profile.requirements[0]).toMatchObject({
      remainingCredits: 1,
      reviewReasons: [],
    });
  });

  it("supplements general and DS rows omitted by Solar from the Document Parse table", () => {
    const tableRows = [
      ["제1전공 심화학점", "36", "15", "0", "0", "0", "0", "0", "21"],
      ["제1전공 코어학점", "60", "30", "0", "0", "0", "0", "0", "30"],
      ["제1전공 실험실습", "9", "3", "0", "0", "0", "0", "0", "6"],
      ["의사소통", "4", "4", "0", "0", "0", "0", "0", "0"],
      ["창의", "3", "3", "0", "0", "0", "0", "0", "0"],
      ["글로벌(필수)", "2", "2", "0", "0", "0", "0", "0", "0"],
      ["글로벌", "4", "4", "0", "0", "0", "0", "0", "0"],
      ["인문사회과학/자연과학기반", "18", "15", "0", "0", "0", "0", "0", "3"],
      ["성균인성·리더십", "2", "2", "0", "0", "0", "0", "0", "0"],
      ["고전·명저", "3", "3", "0", "0", "0", "0", "0", "0"],
      ["DS기반(계열1)", "2", "4", "0", "0", "0", "0", "0", "0"],
      ["DS기반(공통)", "2", "0", "0", "0", "0", "0", "0", "2"],
      [
        "균형교양 - 인간/문화",
        "균형교양 3개 영역 중 2개 영역 이상에서 총 6학점 이상 이수",
        "6 / 0",
        "0 / 0",
        "0 / 0",
        "0 / 0",
        "0 / 0",
        "0 / 0",
        "0",
      ],
      [
        "균형교양 - 사회/역사",
        "균형교양 3개 영역 중 2개 영역 이상에서 총 6학점 이상 이수",
        "6 / 3",
        "0 / 0",
        "0 / 0",
        "0 / 0",
        "0 / 0",
        "0 / 0",
        "0",
      ],
      [
        "균형교양 - 자연/과학/기술",
        "균형교양 3개 영역 중 2개 영역 이상에서 총 6학점 이상 이수",
        "6 / 3",
        "0 / 0",
        "0 / 0",
        "0 / 0",
        "0 / 0",
        "0 / 0",
        "0",
      ],
    ];
    const markdown = [
      "| 구분 | 기준학점 | 취득학점 | 1학기 | 여름 | 2학기 | 겨울 | 계 | 잔여학점 |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
      ...tableRows.map((row) => `| ${row.join(" | ")} |`),
    ].join("\n");
    const solarProfile = parseAcademicExtraction(
      JSON.stringify({
        completedCourses: [],
        requirements: tableRows.slice(0, 3).map((row) => ({
          scope: "primary_major",
          label: row[0],
          rule: { kind: "credit_minimum", credits: Number(row[1]) },
          earnedCredits: Number(row[2]),
          inProgressCredits: { spring: 0, summer: 0, fall: 0, winter: 0, total: 0 },
          remainingCredits: Number(row[8]),
          status: "unmet",
          rawValues: {},
          reviewReasons: ["수강학점 일부가 비어 있거나 복합 형식이어서 0으로 표시했습니다."],
        })),
        reviewIssues: [],
      }),
      "graduation_requirements",
      "source-full-table",
    );

    const supplemented = supplementGraduationRequirementsFromMarkdown(
      solarProfile,
      markdown,
      "source-full-table",
    );

    expect(supplemented.requirements).toHaveLength(15);
    expect(supplemented.requirements.map((requirement) => requirement.label)).toEqual(
      tableRows.map((row) => row[0]),
    );
    expect(supplemented.requirements[3]).toMatchObject({
      label: "의사소통",
      scope: "general",
      status: "satisfied",
    });
    expect(supplemented.requirements.slice(0, 12).every(
      (requirement) => requirement.reviewReasons.length === 0,
    )).toBe(true);
    expect(supplemented.requirements[10]).toMatchObject({
      label: "DS기반(계열1)",
      scope: "ds",
    });
    expect(supplemented.requirements.slice(12).map((requirement) => requirement.rule)).toEqual([
      expect.objectContaining({
        kind: "distribution_minimum",
        groupId: "balanced-general",
        totalAreas: 3,
        minimumAreas: 2,
        totalCredits: 6,
      }),
      expect.objectContaining({
        kind: "distribution_minimum",
        groupId: "balanced-general",
        totalAreas: 3,
        minimumAreas: 2,
        totalCredits: 6,
      }),
      expect.objectContaining({
        kind: "distribution_minimum",
        groupId: "balanced-general",
        totalAreas: 3,
        minimumAreas: 2,
        totalCredits: 6,
      }),
    ]);
    expect(supplemented.requirements.slice(12).map((requirement) => requirement.earnedCredits)).toEqual([
      0,
      3,
      3,
    ]);
    expect(supplemented.requirements.slice(12).every(
      (requirement) => requirement.status === "satisfied" && requirement.reviewReasons.length === 0,
    )).toBe(true);
    expect(supplemented.reviewIssues).toEqual([
      expect.objectContaining({
        code: "solar_requirement_rows_supplemented",
        message: expect.stringContaining("12개"),
      }),
    ]);
  });

  it("expands HTML rowspans when Document Parse preserves a merged requirement cell", () => {
    const html = `<table>
      <tr><th>구분</th><th>기준학점</th><th>취득학점</th><th>1학기</th><th>여름</th><th>2학기</th><th>겨울</th><th>계</th><th>잔여학점</th></tr>
      <tr><td>균형교양 - 인간/문화</td><td rowspan="3">3개 영역 중 2개 영역 이상에서 총 6학점 이상 이수</td><td>6 / 0</td><td>0 / 0</td><td>0 / 0</td><td>0 / 0</td><td>0 / 0</td><td>0 / 0</td><td>0</td></tr>
      <tr><td>균형교양 - 사회/역사</td><td>6 / 3</td><td>0 / 0</td><td>0 / 0</td><td>0 / 0</td><td>0 / 0</td><td>0 / 0</td><td>0</td></tr>
      <tr><td>균형교양 - 자연/과학/기술</td><td>6 / 3</td><td>0 / 0</td><td>0 / 0</td><td>0 / 0</td><td>0 / 0</td><td>0 / 0</td><td>0</td></tr>
    </table>`;
    const emptyProfile = parseAcademicExtraction(
      JSON.stringify({ completedCourses: [], requirements: [], reviewIssues: [] }),
      "graduation_requirements",
      "source-html-table",
    );

    const supplemented = supplementGraduationRequirementsFromMarkdown(
      emptyProfile,
      html,
      "source-html-table",
    );

    expect(supplemented.requirements).toHaveLength(3);
    expect(supplemented.requirements.every((requirement) => requirement.scope === "general")).toBe(
      true,
    );
    expect(supplemented.requirements[2]?.rule).toMatchObject({
      kind: "distribution_minimum",
      minimumAreas: 2,
      totalCredits: 6,
    });
  });

  it("rejects a response without the fixed top-level arrays", () => {
    expect(() =>
      parseAcademicExtraction('{"completedCourses":[]}', "course_history", "source-4"),
    ).toThrow(AcademicExtractionError);
  });
});

describe("cleanCompletedCourseExtraction", () => {
  const course = (courseCode: string) => ({
    courseCode,
    courseName: "테스트과목",
    majorScope: "",
    classification: "",
    year: null,
    term: null,
    credits: 3,
    area: "",
    completionStatus: "earned" as const,
    recommendationPolicy: "exclude" as const,
    flags: [],
    sourceDocumentId: "source-1",
    reviewReasons: [],
  });

  const baseProfile = (reviewIssues: Array<{ code: string; message: string }>) => ({
    schemaVersion: "1.0" as const,
    profile: {
      departmentCode: null,
      majorCodes: [],
      admissionYear: null,
      currentGrade: null,
      primaryCampus: null,
    },
    sourceDocuments: [{ id: "source-1", kind: "course_history" as const, status: "draft" as const }],
    completedCourses: [course("ADD2013")],
    requirements: [],
    reviewIssues: reviewIssues.map((issue) => ({ ...issue, sourceDocumentId: "source-1" })),
  });

  it("drops Solar's freeform document-level reviewIssues once the table parser succeeded", () => {
    const profile = baseProfile([
      {
        code: "unclear_classification",
        message: "ADD2013 한국건축사: 전공 과목 이수 정보가 학수번호, 영역, 학점 등과 함께 표시되어 구체적인 이수구분이 명확히 구분되지 않음",
      },
      { code: "document_truncated", message: "문서가 길어 일부만 자동 추출했습니다." },
    ]);

    const cleaned = cleanCompletedCourseExtraction(profile, ["ADD2013"], true);

    expect(cleaned.reviewIssues).toEqual([
      expect.objectContaining({ code: "document_truncated" }),
    ]);
  });

  it("keeps the narrower legacy filter when the table parser found no rows", () => {
    const profile = baseProfile([
      { code: "unclear_classification", message: "표에서 확인되지 않은 항목입니다." },
      { code: "invalid_completed_course", message: "1번째 행은 형식을 만족하지 않습니다." },
    ]);

    const cleaned = cleanCompletedCourseExtraction(profile, ["ADD2013"], false);

    expect(cleaned.reviewIssues).toEqual([
      expect.objectContaining({ code: "unclear_classification" }),
    ]);
  });

  it("still reports missing course codes regardless of table parsing outcome", () => {
    const profile = baseProfile([]);

    const cleaned = cleanCompletedCourseExtraction(profile, ["ADD2013", "ADD2029"], true);

    expect(cleaned.reviewIssues).toEqual([
      expect.objectContaining({ code: "missing_completed_courses", message: expect.stringContaining("1개") }),
    ]);
  });
});
