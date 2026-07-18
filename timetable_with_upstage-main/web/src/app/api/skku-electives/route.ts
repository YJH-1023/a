import {
  fetchSkkuAllElectiveSubjects,
  fetchSkkuElectiveAreas,
  fetchSkkuElectiveCourses,
  fetchSkkuElectiveSubjects,
  SKKU_ELECTIVE_AREA_DEFINITIONS,
  SKKU_TERMS,
  SkkuCourseApiError,
  type SkkuElectiveCampus,
  type SkkuElectiveAreaCode,
  type SkkuTerm,
} from "../../../lib/skku-course-api";

type ElectiveMode = "areas" | "all_subjects" | "subjects" | "sections";
type ApiErrorCode = "invalid_query" | "skku_unavailable" | "skku_request_failed";

interface ElectiveQuery {
  year: number;
  term: SkkuTerm;
  campus: SkkuElectiveCampus;
  mode: ElectiveMode;
  areaCode?: SkkuElectiveAreaCode;
  courseNumber?: string;
}

function errorResponse(status: number, code: ApiErrorCode, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "invalid_query", "교양 조회 조건을 JSON으로 보내 주세요.");
  }
  const query = parseElectiveQuery(body);
  if (!query) {
    return errorResponse(400, "invalid_query", "년도·학기·캠퍼스와 교양 조회 조건을 확인해 주세요.");
  }

  const baseQuery = { year: query.year, term: query.term, campus: query.campus };
  try {
    if (query.mode === "areas") {
      return Response.json({ areas: await fetchSkkuElectiveAreas(baseQuery) });
    }
    if (query.mode === "all_subjects") {
      return Response.json(await fetchSkkuAllElectiveSubjects(baseQuery));
    }
    if (query.mode === "subjects" && query.areaCode) {
      return Response.json({
        areaCode: query.areaCode,
        subjects: await fetchSkkuElectiveSubjects(baseQuery, query.areaCode),
      });
    }
    if (query.mode === "sections" && query.courseNumber) {
      return Response.json({
        courseNumber: query.courseNumber,
        courses: await fetchSkkuElectiveCourses(baseQuery, query.courseNumber),
      });
    }
    return errorResponse(400, "invalid_query", "교양 조회 단계를 확인해 주세요.");
  } catch (error) {
    if (error instanceof SkkuCourseApiError) {
      return errorResponse(
        502,
        error.failure === "unavailable" ? "skku_unavailable" : "skku_request_failed",
        error.failure === "unavailable"
          ? "성균관대 교양 강좌 서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요."
          : "성균관대 교양 강좌 응답을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      );
    }
    return errorResponse(502, "skku_request_failed", "교양 강좌 조회 중 오류가 발생했습니다.");
  }
}

function parseElectiveQuery(value: unknown): ElectiveQuery | null {
  if (!isRecord(value)) {
    return null;
  }
  const { year, term, campus, mode, areaCode, courseNumber } = value;
  if (
    typeof year !== "number" ||
    !Number.isInteger(year) ||
    year < 2020 ||
    year > 2100 ||
    typeof term !== "number" ||
    !SKKU_TERMS.includes(term as SkkuTerm) ||
    (campus !== 1 && campus !== 2 && campus !== 3) ||
    (mode !== "areas" &&
      mode !== "all_subjects" &&
      mode !== "subjects" &&
      mode !== "sections")
  ) {
    return null;
  }
  if (
    mode === "subjects" &&
    (typeof areaCode !== "string" ||
      !SKKU_ELECTIVE_AREA_DEFINITIONS.some((area) => area.code === areaCode))
  ) {
    return null;
  }
  if (
    mode === "sections" &&
    (typeof courseNumber !== "string" || !/^[A-Z]{2,6}\d{3,4}$/.test(courseNumber))
  ) {
    return null;
  }
  return {
    year,
    term: term as SkkuTerm,
    campus: campus as SkkuElectiveCampus,
    mode,
    areaCode: areaCode as SkkuElectiveAreaCode | undefined,
    courseNumber: typeof courseNumber === "string" ? courseNumber : undefined,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
