import {
  fetchSkkuMajorCourses,
  SKKU_TERMS,
  SkkuCourseApiError,
  type SkkuCampus,
  type SkkuCourseQuery,
  type SkkuTerm,
} from "../../../lib/skku-course-api";

type ApiErrorCode = "invalid_query" | "skku_unavailable" | "skku_request_failed";

function errorResponse(status: number, code: ApiErrorCode, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "invalid_query", "개설강좌 조회 조건을 JSON으로 보내 주세요.");
  }
  const query = parseCourseQuery(body);
  if (!query) {
    return errorResponse(
      400,
      "invalid_query",
      "년도·학기·캠퍼스·학과코드를 다시 확인해 주세요.",
    );
  }

  try {
    const courses = await fetchSkkuMajorCourses(query);
    return Response.json({
      generated_at: new Date().toISOString(),
      query,
      courses,
    });
  } catch (error) {
    if (error instanceof SkkuCourseApiError) {
      return errorResponse(
        502,
        error.failure === "unavailable" ? "skku_unavailable" : "skku_request_failed",
        error.failure === "unavailable"
          ? "성균관대 개설강좌 서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요."
          : "성균관대 개설강좌 응답을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      );
    }
    return errorResponse(502, "skku_request_failed", "개설강좌 조회 중 오류가 발생했습니다.");
  }
}

function parseCourseQuery(value: unknown): SkkuCourseQuery | null {
  if (!isRecord(value)) {
    return null;
  }
  const year = value.year;
  const term = value.term;
  const campus = value.campus;
  const departmentCode = value.departmentCode;
  if (
    typeof year !== "number" ||
    !Number.isInteger(year) ||
    year < 2020 ||
    year > 2100 ||
    typeof term !== "number" ||
    !SKKU_TERMS.includes(term as SkkuTerm) ||
    (campus !== 1 && campus !== 2) ||
    typeof departmentCode !== "string" ||
    !/^\d{4,8}$/.test(departmentCode)
  ) {
    return null;
  }
  return { year, term: term as SkkuTerm, campus: campus as SkkuCampus, departmentCode };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
