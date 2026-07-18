import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

function requestWithDocument(
  kind: string,
  document?: Blob,
  filename = "academic-record.png",
): Request {
  const formData = new FormData();
  formData.set("kind", kind);
  if (document) {
    formData.set("document", document, filename);
  }
  return new Request("http://localhost/api/parse-academic-document", {
    method: "POST",
    body: formData,
  });
}

describe("POST /api/parse-academic-document", () => {
  beforeEach(() => {
    vi.stubEnv("UPSTAGE_API_KEY", "test-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("parses an image, calls Solar, and returns only a draft AcademicProfile", async () => {
    const solarResult = JSON.stringify({
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
          flags: [],
          reviewReasons: ["3.0 학점 표시됨"],
          exactGrade: "A+",
        },
      ],
      requirements: [],
      reviewIssues: [],
      studentName: "반환 금지",
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ content: { markdown: "| 학수번호 | 과목명 |" } }))
      .mockResolvedValueOnce(
        Response.json({ choices: [{ message: { role: "assistant", content: solarResult } }] }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      requestWithDocument(
        "course_history",
        new Blob(["image"], { type: "image/png" }),
      ),
    );
    const body = (await response.json()) as { academicProfile: Record<string, unknown> };

    expect(response.status).toBe(200);
    expect(body.academicProfile).toMatchObject({
      schemaVersion: "1.0",
      sourceDocuments: [
        {
          id: expect.any(String),
          kind: "course_history",
          status: "draft",
        },
      ],
      completedCourses: [
        expect.objectContaining({
          courseCode: "BUS2001",
          recommendationPolicy: "exclude",
        }),
      ],
      requirements: [],
    });
    expect(JSON.stringify(body)).not.toContain("A+");
    expect(JSON.stringify(body)).not.toContain("반환 금지");
    expect(JSON.stringify(body)).not.toContain("학점 표시됨");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.upstage.ai/v1/document-digitization",
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://api.upstage.ai/v1/chat/completions");
    const solarInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(solarInit.headers).toEqual({
      Authorization: "Bearer test-key",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(solarInit.body as string)).toMatchObject({
      model: "solar-pro3",
      stream: false,
    });
  });

  it("rejects an unknown document kind before calling Upstage", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      requestWithDocument("unknown", new Blob(["pdf"], { type: "application/pdf" }), "a.pdf"),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "invalid_document_kind" },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns requirement rows that Solar omitted but Document Parse preserved", async () => {
    const markdown = `| 구분 | 기준학점 | 취득학점 | 1학기 | 여름 | 2학기 | 겨울 | 계 | 잔여학점 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 제1전공 심화학점 | 36 | 15 | 0 | 0 | 0 | 0 | 0 | 21 |
| 제1전공 코어학점 | 60 | 30 | 0 | 0 | 0 | 0 | 0 | 30 |
| 제1전공 실험실습 | 9 | 3 | 0 | 0 | 0 | 0 | 0 | 6 |
| 의사소통 | 4 | 4 | 0 | 0 | 0 | 0 | 0 | 0 |`;
    const requirements = [
      ["제1전공 심화학점", 36, 15, 21],
      ["제1전공 코어학점", 60, 30, 30],
      ["제1전공 실험실습", 9, 3, 6],
    ].map(([label, required, earned, remaining]) => ({
      scope: "primary_major",
      label,
      rule: { kind: "credit_minimum", credits: required },
      earnedCredits: earned,
      inProgressCredits: { spring: 0, summer: 0, fall: 0, winter: 0, total: 0 },
      remainingCredits: remaining,
      status: "unmet",
      rawValues: {},
      reviewReasons: [],
    }));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ content: { markdown } }))
      .mockResolvedValueOnce(
        Response.json({
          choices: [
            {
              message: {
                role: "assistant",
                content: JSON.stringify({
                  completedCourses: [],
                  requirements,
                  reviewIssues: [],
                }),
              },
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      requestWithDocument(
        "graduation_requirements",
        new Blob(["image"], { type: "image/png" }),
      ),
    );
    const body = (await response.json()) as {
      academicProfile: {
        requirements: Array<{ label: string }>;
        reviewIssues: Array<{ code: string }>;
      };
    };

    expect(response.status).toBe(200);
    expect(body.academicProfile.requirements.map((requirement) => requirement.label)).toEqual([
      "제1전공 심화학점",
      "제1전공 코어학점",
      "제1전공 실험실습",
      "의사소통",
    ]);
    expect(body.academicProfile.reviewIssues).toEqual([
      expect.objectContaining({ code: "solar_requirement_rows_supplemented" }),
    ]);
  });

  it("retries and merges completed courses omitted by the first Solar pass", async () => {
    const markdown = `| 학수번호 | 교과목명 | 학기 |
| --- | --- | --- |
| GEDG001 | Communication | 1학기 |
| BIZ2021 | Business | 2학기 |`;
    const course = (courseCode: string, courseName: string, term: string) => ({
      courseCode,
      courseName,
      majorScope: "general",
      classification: "general",
      year: 2025,
      term,
      credits: 3,
      area: "general",
      completionStatus: "earned",
      flags: [],
      reviewReasons: [],
    });
    const solarResponse = (completedCourses: Array<Record<string, unknown>>) =>
      Response.json({
        choices: [
          {
            message: {
              role: "assistant",
              content: JSON.stringify({ completedCourses, requirements: [], reviewIssues: [] }),
            },
          },
        ],
      });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ content: { markdown } }))
      .mockResolvedValueOnce(solarResponse([course("GEDG001", "Communication", "1학기")]))
      .mockResolvedValueOnce(solarResponse([course("BIZ2021", "Business", "2학기")]));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      requestWithDocument(
        "course_history",
        new Blob(["pdf"], { type: "application/pdf" }),
        "courses.pdf",
      ),
    );
    const body = (await response.json()) as {
      academicProfile: {
        completedCourses: Array<{ courseCode: string; term: string }>;
        reviewIssues: Array<{ code: string }>;
      };
    };

    expect(response.status).toBe(200);
    expect(body.academicProfile.completedCourses).toMatchObject([
      { courseCode: "GEDG001", term: "spring" },
      { courseCode: "BIZ2021", term: "fall" },
    ]);
    expect(body.academicProfile.reviewIssues).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const retryInit = fetchMock.mock.calls[2]?.[1] as RequestInit;
    expect(retryInit.body).toContain("BIZ2021");
  });

  it("splits two named courses that Document Parse merged into one table cell", async () => {
    const markdown = `| 전공 | 이수구분 | 년도 | 학기 | 학수번호 교과목명 | 영역 | 학점 |
| --- | --- | --- | --- | --- | --- | --- |
| major | required | 2025 | 1학기 2학기 | ADD2032 First Design ADD3008 Digital Design | major | 3 |`;
    const firstPass = {
      completedCourses: [],
      requirements: [],
      reviewIssues: [],
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ content: { markdown } }))
      .mockResolvedValueOnce(
        Response.json({
          choices: [{ message: { role: "assistant", content: JSON.stringify(firstPass) } }],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      requestWithDocument(
        "course_history",
        new Blob(["pdf"], { type: "application/pdf" }),
        "courses.pdf",
      ),
    );
    const body = (await response.json()) as {
      academicProfile: {
        completedCourses: Array<{
          courseCode: string;
          courseName: string;
          term: string;
          flags: string[];
        }>;
        reviewIssues: Array<{ code: string }>;
      };
    };

    expect(response.status).toBe(200);
    expect(body.academicProfile.completedCourses).toMatchObject([
      { courseCode: "ADD2032", courseName: "First Design", term: "spring" },
      {
        courseCode: "ADD3008",
        courseName: "Digital Design",
        term: "fall",
        flags: ["document_parse_table_supplemented"],
      },
    ]);
    expect(body.academicProfile.reviewIssues).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps the first completed-course result when the coverage retry is invalid", async () => {
    const markdown = "| 학수번호 |\n| --- |\n| GEDG001 |\n| BIZ2021 |";
    const firstPass = {
      completedCourses: [
        {
          courseCode: "GEDG001",
          courseName: "Communication",
          majorScope: "general",
          classification: "general",
          year: 2025,
          term: "spring",
          credits: 3,
          area: "general",
          completionStatus: "earned",
          flags: [],
          reviewReasons: [],
        },
      ],
      requirements: [],
      reviewIssues: [],
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ content: { markdown } }))
      .mockResolvedValueOnce(
        Response.json({
          choices: [{ message: { role: "assistant", content: JSON.stringify(firstPass) } }],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ choices: [{ message: { role: "assistant", content: "not json" } }] }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      requestWithDocument(
        "course_history",
        new Blob(["pdf"], { type: "application/pdf" }),
        "courses.pdf",
      ),
    );
    const body = (await response.json()) as {
      academicProfile: {
        completedCourses: Array<{ courseCode: string }>;
        reviewIssues: Array<{ code: string }>;
      };
    };

    expect(response.status).toBe(200);
    expect(body.academicProfile.completedCourses).toMatchObject([{ courseCode: "GEDG001" }]);
    expect(body.academicProfile.reviewIssues).toEqual([
      expect.objectContaining({ code: "missing_completed_courses" }),
    ]);
  });

  it("rejects unsupported file types before calling Upstage", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      requestWithDocument(
        "course_history",
        new Blob(["text"], { type: "text/plain" }),
        "record.txt",
      ),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "invalid_document" } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed when Solar does not return the fixed JSON contract", async () => {
    // extractAcademicProfile retries one malformed Solar response before giving up, so both the
    // first attempt and the retry must return invalid content for this to fail closed.
    const invalidSolarResponse = () =>
      Response.json({ choices: [{ message: { role: "assistant", content: "not json" } }] });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ content: { markdown: "parsed" } }))
      .mockResolvedValueOnce(invalidSolarResponse())
      .mockResolvedValueOnce(invalidSolarResponse());
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      requestWithDocument(
        "graduation_requirements",
        new Blob(["pdf"], { type: "application/pdf" }),
        "requirements.pdf",
      ),
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "solar_extraction_failed",
        message: "Solar 추출 결과가 학사 데이터 형식을 만족하지 않았습니다.",
      },
    });
  });
});
