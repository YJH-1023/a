import type { AssessmentItem, NormalizedSyllabus, SyllabusBurden } from "./syllabus";

export interface ParsedSyllabusResponse {
  document: unknown;
  syllabus: NormalizedSyllabus;
}

const MAX_PREVIEW_LENGTH = 600;

/**
 * Validates the server response before it is rendered in the browser.
 *
 * Document Parse output is intentionally kept as unknown here: only the normalized, explicit
 * assessment signals are used by the UI, while a short text preview makes the Parse result visible.
 */
export function parseSyllabusResponse(payload: unknown): ParsedSyllabusResponse {
  if (!isRecord(payload) || !("document" in payload) || !isNormalizedSyllabus(payload.syllabus)) {
    throw new Error("강의계획서 분석 응답 형식이 올바르지 않습니다. 다시 시도해 주세요.");
  }

  return { document: payload.document, syllabus: payload.syllabus };
}

export function getSyllabusApiError(payload: unknown): string {
  if (
    isRecord(payload) &&
    isRecord(payload.error) &&
    typeof payload.error.message === "string" &&
    payload.error.message.trim()
  ) {
    return payload.error.message;
  }
  return "강의계획서 분석을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}

export function getDocumentPreview(document: unknown): string | null {
  if (!isRecord(document) || !isRecord(document.content)) {
    return null;
  }

  const markdown = document.content.markdown;
  if (typeof markdown !== "string" || !markdown.trim()) {
    return null;
  }

  const normalized = markdown.replace(/\s+/g, " ").trim();
  return normalized.length > MAX_PREVIEW_LENGTH
    ? `${normalized.slice(0, MAX_PREVIEW_LENGTH)}…`
    : normalized;
}

function isNormalizedSyllabus(value: unknown): value is NormalizedSyllabus {
  return (
    isRecord(value) &&
    Array.isArray(value.assessmentItems) &&
    value.assessmentItems.every(isAssessmentItem) &&
    isSyllabusBurden(value.burden)
  );
}

function isAssessmentItem(value: unknown): value is AssessmentItem {
  return (
    isRecord(value) &&
    typeof value.label === "string" &&
    typeof value.weight === "number" &&
    Number.isFinite(value.weight) &&
    Array.isArray(value.tags) &&
    value.tags.every((tag) => typeof tag === "string")
  );
}

function isSyllabusBurden(value: unknown): value is SyllabusBurden {
  return (
    isRecord(value) &&
    typeof value.assignmentWeight === "number" &&
    typeof value.quizWeight === "number" &&
    typeof value.examWeight === "number" &&
    typeof value.presentationWeight === "number" &&
    typeof value.participationWeight === "number" &&
    typeof value.hasMidterm === "boolean" &&
    typeof value.hasFinal === "boolean"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
