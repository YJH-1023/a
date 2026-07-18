import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

function requestWithDocument(document?: Blob, filename = "syllabus.pdf"): Request {
  const formData = new FormData();
  if (document) {
    formData.set("document", document, filename);
  }
  return new Request("http://localhost/api/parse-syllabus", { method: "POST", body: formData });
}

describe("POST /api/parse-syllabus", () => {
  beforeEach(() => {
    vi.stubEnv("UPSTAGE_API_KEY", "test-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("forwards a PDF to Upstage only from the server route", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({ content: { html: "<p>강의계획서</p>", markdown: "강의계획서" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(requestWithDocument(new Blob(["pdf"], { type: "application/pdf" })));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      document: { content: { markdown: "강의계획서" } },
      syllabus: {
        assessmentItems: [],
        burden: {
          assignmentWeight: 0,
          quizWeight: 0,
          examWeight: 0,
          presentationWeight: 0,
          participationWeight: 0,
          hasMidterm: false,
          hasFinal: false,
        },
      },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.upstage.ai/v1/document-digitization",
      expect.objectContaining({
        method: "POST",
        headers: { Authorization: "Bearer test-key" },
        cache: "no-store",
      }),
    );
    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(requestInit.body).toBeInstanceOf(FormData);
    expect((requestInit.body as FormData).get("model")).toBe("document-parse");
    expect((requestInit.body as FormData).get("output_formats")).toBe('["html","markdown"]');
  });

  it("returns only a bounded Markdown preview instead of echoing the full Parse response", async () => {
    const markdown = `Final Exam 40%\n${"본문 ".repeat(1_000)}`;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      Response.json({
        content: { html: `<p>${"large ".repeat(10_000)}</p>`, markdown },
        elements: Array.from({ length: 100 }, () => ({ content: "large" })),
      }),
    ));

    const response = await POST(requestWithDocument(new Blob(["pdf"], { type: "application/pdf" })));
    const body = await response.json();

    expect(body.document.content.markdown.length).toBeLessThanOrEqual(1_200);
    expect(JSON.stringify(body)).not.toContain("elements");
    expect(JSON.stringify(body)).not.toContain("<p>");
    expect(body.syllabus.burden.hasFinal).toBe(true);
  });

  it("rejects a non-PDF upload before calling Upstage", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      requestWithDocument(new Blob(["plain text"], { type: "text/plain" }), "notes.txt"),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "invalid_document",
        message: "PDF 파일을 document 필드로 업로드해야 합니다.",
      },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports missing server-only configuration without calling Upstage", async () => {
    vi.stubEnv("UPSTAGE_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(requestWithDocument(new Blob(["pdf"], { type: "application/pdf" })));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "upstage_not_configured",
        message: "UPSTAGE_API_KEY가 서버에 설정되지 않았습니다.",
      },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
