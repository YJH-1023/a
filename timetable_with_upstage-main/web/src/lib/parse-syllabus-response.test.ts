import { describe, expect, it } from "vitest";

import {
  getDocumentPreview,
  getSyllabusApiError,
  parseSyllabusResponse,
} from "./parse-syllabus-response";

const syllabus = {
  assessmentItems: [{ label: "Final Exam", weight: 40, tags: ["final"] }],
  burden: {
    assignmentWeight: 0,
    quizWeight: 0,
    examWeight: 40,
    presentationWeight: 0,
    participationWeight: 0,
    hasMidterm: false,
    hasFinal: true,
  },
};

describe("parseSyllabusResponse", () => {
  it("accepts the normalized response returned by the server route", () => {
    const result = parseSyllabusResponse({
      document: { content: { markdown: "# Course\nFinal Exam 40%" } },
      syllabus,
    });

    expect(result.syllabus).toEqual(syllabus);
    expect(getDocumentPreview(result.document)).toBe("# Course Final Exam 40%");
  });

  it("rejects incomplete responses and reads safe API errors", () => {
    expect(() => parseSyllabusResponse({ syllabus: {} })).toThrow("응답 형식");
    expect(getSyllabusApiError({ error: { message: "PDF 파일이 필요합니다." } })).toBe(
      "PDF 파일이 필요합니다.",
    );
    expect(getSyllabusApiError({ error: {} })).toContain("완료하지 못했습니다");
  });
});
