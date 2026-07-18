import { normalizeSyllabus } from "../../../lib/syllabus";
import { MAX_DOCUMENT_SIZE_LABEL } from "../../../lib/document-limits";
import {
  getDocumentMarkdown,
  isPdf,
  MAX_DOCUMENT_BYTES,
  parseDocumentWithUpstage,
  UpstageApiError,
} from "../../../lib/upstage";

const MAX_PREVIEW_MARKDOWN_CHARACTERS = 1_200;

type ApiErrorCode =
  | "invalid_document"
  | "upstage_not_configured"
  | "upstage_request_failed"
  | "upstage_unavailable";

function errorResponse(status: number, code: ApiErrorCode, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

/**
 * Upload a syllabus PDF to Upstage Document Parse without ever exposing the API key to the browser.
 *
 * P6 verification showed that the university's INTRO_URL can be access-restricted, so this endpoint
 * deliberately receives a PDF uploaded by the user instead of attempting to proxy that URL.
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
    return errorResponse(400, "invalid_document", "multipart/form-data PDF 업로드가 필요합니다.");
  }

  const document = formData.get("document");
  if (!(document instanceof File) || !isPdf(document)) {
    return errorResponse(400, "invalid_document", "PDF 파일을 document 필드로 업로드해야 합니다.");
  }
  if (document.size === 0 || document.size > MAX_DOCUMENT_BYTES) {
    return errorResponse(
      400,
      "invalid_document",
      `PDF 파일은 1바이트 이상 ${MAX_DOCUMENT_SIZE_LABEL} 이하여야 합니다.`,
    );
  }

  let parsedDocument: unknown;
  try {
    parsedDocument = await parseDocumentWithUpstage(document, apiKey);
  } catch (error) {
    if (error instanceof UpstageApiError && error.failure === "unavailable") {
      return errorResponse(
        502,
        "upstage_unavailable",
        "Upstage Document Parse에 연결할 수 없습니다.",
      );
    }
    return errorResponse(
      502,
      "upstage_request_failed",
      "Upstage Document Parse 요청이 실패했습니다.",
    );
  }

  const markdown = getDocumentMarkdown(parsedDocument);
  return Response.json({
    document: markdown
      ? { content: { markdown: markdown.slice(0, MAX_PREVIEW_MARKDOWN_CHARACTERS) } }
      : {},
    syllabus: normalizeSyllabus(parsedDocument),
  });
}
