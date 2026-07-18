import {
  AcademicExtractionError,
  extractAcademicProfile,
} from "../../../lib/academic-document";
import type { AcademicDocumentKind } from "../../../lib/academic-profile";
import { MAX_DOCUMENT_SIZE_LABEL } from "../../../lib/document-limits";
import {
  getDocumentMarkdown,
  isAcademicDocument,
  MAX_DOCUMENT_BYTES,
  parseDocumentWithUpstage,
  UpstageApiError,
} from "../../../lib/upstage";

type ApiErrorCode =
  | "invalid_document"
  | "invalid_document_kind"
  | "upstage_not_configured"
  | "document_parse_failed"
  | "solar_extraction_failed"
  | "upstage_unavailable";

function errorResponse(status: number, code: ApiErrorCode, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

function isAcademicDocumentKind(value: FormDataEntryValue | null): value is AcademicDocumentKind {
  return value === "course_history" || value === "graduation_requirements";
}

/**
 * Converts one user-selected academic document into an unconfirmed, privacy-minimized draft.
 * The original file and full Document Parse markdown are never returned or persisted here.
 */
export async function POST(request: Request): Promise<Response> {
  const apiKey = process.env.UPSTAGE_API_KEY;
  if (!apiKey) {
    return errorResponse(
      503,
      "upstage_not_configured",
      "UPSTAGE_API_KEY가 서버에 설정되지 않았습니다.",
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return errorResponse(
      400,
      "invalid_document",
      "multipart/form-data 학사문서 업로드가 필요합니다.",
    );
  }

  const kind = formData.get("kind");
  if (!isAcademicDocumentKind(kind)) {
    return errorResponse(
      400,
      "invalid_document_kind",
      "kind는 course_history 또는 graduation_requirements여야 합니다.",
    );
  }

  const document = formData.get("document");
  if (!(document instanceof File) || !isAcademicDocument(document)) {
    return errorResponse(
      400,
      "invalid_document",
      "PDF, PNG, JPG 파일을 document 필드로 업로드해야 합니다.",
    );
  }
  if (document.size === 0 || document.size > MAX_DOCUMENT_BYTES) {
    return errorResponse(
      400,
      "invalid_document",
      `학사문서 파일은 1바이트 이상 ${MAX_DOCUMENT_SIZE_LABEL} 이하여야 합니다.`,
    );
  }

  try {
    const parsedDocument = await parseDocumentWithUpstage(document, apiKey);
    const markdown = getDocumentMarkdown(parsedDocument);
    if (!markdown) {
      return errorResponse(
        502,
        "document_parse_failed",
        "Document Parse 응답에서 분석할 텍스트를 찾지 못했습니다.",
      );
    }

    const sourceDocumentId = crypto.randomUUID();
    const academicProfile = await extractAcademicProfile(
      markdown,
      kind,
      sourceDocumentId,
      apiKey,
    );
    return Response.json({ academicProfile });
  } catch (error) {
    if (error instanceof AcademicExtractionError) {
      return errorResponse(
        502,
        "solar_extraction_failed",
        "Solar 추출 결과가 학사 데이터 형식을 만족하지 않았습니다.",
      );
    }
    if (error instanceof UpstageApiError) {
      if (error.failure === "unavailable") {
        return errorResponse(502, "upstage_unavailable", "Upstage에 연결할 수 없습니다.");
      }
      const isSolar = error.service === "solar";
      return errorResponse(
        502,
        isSolar ? "solar_extraction_failed" : "document_parse_failed",
        isSolar
          ? "Solar 학사 데이터 추출 요청이 실패했습니다."
          : "Upstage Document Parse 요청이 실패했습니다.",
      );
    }
    return errorResponse(
      502,
      "solar_extraction_failed",
      "학사문서를 구조화하는 중 오류가 발생했습니다.",
    );
  }
}
