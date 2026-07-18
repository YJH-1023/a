import {
  ELECTIVE_CATALOG_CACHE_TTL_MS,
  ELECTIVE_SECTIONS_CACHE_TTL_MS,
  SESSION_COOKIE_CACHE_TTL_MS,
} from "./cache-constants";
import { InMemoryTtlCache, type CacheStore } from "./cache-store";

const RS = "\x1e";
const US = "\x1f";

const BASE_URL = "https://kingoinfo.skku.edu/gaia";
const SESSION_LOGIN_URL = `${BASE_URL}/E_NCommon/sessionLogin.do`;
const MAJOR_COURSES_URL = `${BASE_URL}/E_NHSSU900020M/selectMain.do`;
const ELECTIVE_AREAS_URL = `${BASE_URL}/E_NHSSU900010M/selectMain01.do`;
const ELECTIVE_SUBJECTS_URL = `${BASE_URL}/E_NHSSU900010M/selectMain02.do`;
const ELECTIVE_COURSES_URL = `${BASE_URL}/E_NHSSU900010M/selectMain03.do`;

const REQUEST_HEADERS = {
  Accept: "application/xml, text/xml, */*",
  "Cache-Control": "no-cache",
  "Content-Type": "text/xml",
  Origin: "https://kingoinfo.skku.edu",
  Referer:
    "https://kingoinfo.skku.edu/gaia/nxui/outdex.html?language=KO&menuId=NHSSU030840M",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  "X-NX-Content-Type": "2",
  "X-Requested-With": "XMLHttpRequest",
} as const;

export const SKKU_TERMS = [10, 15, 20, 25] as const;
export type SkkuTerm = (typeof SKKU_TERMS)[number];
export type SkkuCampus = 1 | 2;
export type SkkuElectiveCampus = SkkuCampus | 3;

export const SKKU_ELECTIVE_AREA_DEFINITIONS = [
  { code: "A01", label: "고전·명저" },
  { code: "A02", label: "성균인성·리더십" },
  { code: "A5", label: "글로벌" },
  { code: "A1", label: "소통과사고" },
  { code: "A2", label: "창의" },
  { code: "A7", label: "미래(SW/AI)" },
  { code: "D4", label: "인문사회과학/자연과학기반" },
  { code: "D1", label: "인간/문화" },
  { code: "D2", label: "사회/역사" },
  { code: "D3", label: "자연/과학/기술" },
  { code: "ETC", label: "일반선택" },
  { code: "S", label: "기타과목" },
  { code: "DS11", label: "DS기반" },
  { code: "DS12", label: "DS심화" },
] as const;

export type SkkuElectiveAreaCode = (typeof SKKU_ELECTIVE_AREA_DEFINITIONS)[number]["code"];

export interface SkkuCourseQuery {
  year: number;
  term: SkkuTerm;
  campus: SkkuCampus;
  departmentCode: string;
}

export interface SkkuElectiveQuery {
  year: number;
  term: SkkuTerm;
  campus: SkkuElectiveCampus;
}

export interface SkkuCourse {
  source: "major" | "elective";
  year: number;
  term: number;
  course_id: string;
  course_number: string;
  section: string;
  name: string;
  english_name: string;
  credits: string;
  professor: string;
  schedule: string;
  location: string;
  classification: string;
  course_type: string;
  campus: string;
  syllabus_url: string;
}

export interface SkkuElectiveArea {
  code: SkkuElectiveAreaCode;
  label: string;
  count: number;
}

export interface SkkuElectiveSubject {
  areaCode: SkkuElectiveAreaCode;
  courseNumber: string;
  name: string;
}

export interface SkkuElectiveCatalog {
  areas: SkkuElectiveArea[];
  subjects: SkkuElectiveSubject[];
}

interface SsvResponse {
  errorCode: number;
  errorMessage: string;
  datasets: Record<string, Array<Record<string, string>>>;
}

export class SkkuCourseApiError extends Error {
  constructor(
    public readonly failure: "unavailable" | "request_failed" | "invalid_response",
  ) {
    super(`skku_courses:${failure}`);
    this.name = "SkkuCourseApiError";
  }
}

const SESSION_CACHE_KEY = "session";

/**
 * Module-level singletons. Swap the `InMemoryTtlCache` instances below for a
 * `CacheStore` backed by Vercel KV/Upstash Redis to share state across
 * serverless instances — every call site here only depends on the
 * `CacheStore` interface.
 */
const defaultSessionCache: CacheStore<string> = new InMemoryTtlCache();
const defaultElectiveCatalogCache: CacheStore<SkkuElectiveCatalog> = new InMemoryTtlCache();
const defaultElectiveSectionsCache: CacheStore<SkkuCourse[]> = new InMemoryTtlCache();

/** Test-only: clears every default cache so tests don't leak state across cases. */
export function resetSkkuApiCaches(): void {
  (defaultSessionCache as InMemoryTtlCache<string>).clear();
  (defaultElectiveCatalogCache as InMemoryTtlCache<SkkuElectiveCatalog>).clear();
  (defaultElectiveSectionsCache as InMemoryTtlCache<SkkuCourse[]>).clear();
}

function electiveCatalogCacheKey(query: SkkuElectiveQuery): string {
  return `${query.year}:${query.term}:${query.campus}`;
}

function electiveSectionsCacheKey(query: SkkuElectiveQuery, courseNumber: string): string {
  return `${query.year}:${query.term}:${query.campus}:${courseNumber}`;
}

export async function fetchSkkuMajorCourses(
  query: SkkuCourseQuery,
  options: {
    fetcher?: typeof fetch;
    requestIntervalMs?: number;
    sessionCache?: CacheStore<string>;
  } = {},
): Promise<SkkuCourse[]> {
  const fetcher = options.fetcher ?? fetch;
  const requestIntervalMs = options.requestIntervalMs ?? 500;
  const sessionCookie = await establishSkkuSession(fetcher, options.sessionCache);
  const rows = await fetchSkkuDataset(
    MAJOR_COURSES_URL,
    sessionCookie,
    "dsGrdMain",
    {
        YEAR: String(query.year),
        TERM: String(query.term),
        HAKGWA_CD: query.departmentCode,
        CAMPUS_GB: String(query.campus),
        ROAD_MAP: "%",
        HAK_JIBJUNG: "0",
        _FIRST_OUT_DS_NM: "dsGrdMain",
        _TRANSACTION_ID: "selectMain",
    },
    fetcher,
    requestIntervalMs,
  );
  return normalizeCourseRows(rows, "major");
}

export async function fetchSkkuElectiveAreas(
  query: SkkuElectiveQuery,
  options: {
    fetcher?: typeof fetch;
    requestIntervalMs?: number;
    sessionCache?: CacheStore<string>;
  } = {},
): Promise<SkkuElectiveArea[]> {
  const fetcher = options.fetcher ?? fetch;
  const sessionCookie = await establishSkkuSession(fetcher, options.sessionCache);
  const rows = await fetchSkkuDataset(
    ELECTIVE_AREAS_URL,
    sessionCookie,
    "dsGrdMain01",
    electiveParams(query, "dsGrdMain01", "selectMain01"),
    fetcher,
    options.requestIntervalMs ?? 500,
  );
  const counts = rows[0] ?? {};
  return SKKU_ELECTIVE_AREA_DEFINITIONS.map(({ code, label }) => ({
    code,
    label,
    count: readInteger(counts[code]),
  }));
}

export async function fetchSkkuElectiveSubjects(
  query: SkkuElectiveQuery,
  areaCode: SkkuElectiveAreaCode,
  options: {
    fetcher?: typeof fetch;
    requestIntervalMs?: number;
    sessionCache?: CacheStore<string>;
  } = {},
): Promise<SkkuElectiveSubject[]> {
  const fetcher = options.fetcher ?? fetch;
  const sessionCookie = await establishSkkuSession(fetcher, options.sessionCache);
  const rows = await fetchSkkuDataset(
    ELECTIVE_SUBJECTS_URL,
    sessionCookie,
    "dsGrdMain02",
    {
      ...electiveParams(query, "dsGrdMain02", "selectMain02"),
      YUNGYUK_ETC_CD: areaCode,
    },
    fetcher,
    options.requestIntervalMs ?? 500,
  );
  return rows.flatMap((row) => {
    const courseNumber = row.HAKSU_NO?.trim().toUpperCase();
    return courseNumber
      ? [{ areaCode, courseNumber, name: row.GWAMOK_NAME?.trim() ?? "" }]
      : [];
  });
}

/** Loads every elective subject for one user-selected campus with one scoped SKKU session. */
export async function fetchSkkuAllElectiveSubjects(
  query: SkkuElectiveQuery,
  options: {
    fetcher?: typeof fetch;
    requestIntervalMs?: number;
    sessionCache?: CacheStore<string>;
    catalogCache?: CacheStore<SkkuElectiveCatalog>;
  } = {},
): Promise<SkkuElectiveCatalog> {
  const catalogCache = options.catalogCache ?? defaultElectiveCatalogCache;
  const cacheKey = electiveCatalogCacheKey(query);
  const cached = catalogCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const fetcher = options.fetcher ?? fetch;
  const requestIntervalMs = options.requestIntervalMs ?? 300;
  const sessionCookie = await establishSkkuSession(fetcher, options.sessionCache);
  const areaRows = await fetchSkkuDataset(
    ELECTIVE_AREAS_URL,
    sessionCookie,
    "dsGrdMain01",
    electiveParams(query, "dsGrdMain01", "selectMain01"),
    fetcher,
    requestIntervalMs,
  );
  const counts = areaRows[0] ?? {};
  const areas = SKKU_ELECTIVE_AREA_DEFINITIONS.map(({ code, label }) => ({
    code,
    label,
    count: readInteger(counts[code]),
  }));
  const subjects = new Map<string, SkkuElectiveSubject>();

  for (const area of areas) {
    if (area.count === 0) {
      continue;
    }
    const rows = await fetchSkkuDataset(
      ELECTIVE_SUBJECTS_URL,
      sessionCookie,
      "dsGrdMain02",
      {
        ...electiveParams(query, "dsGrdMain02", "selectMain02"),
        YUNGYUK_ETC_CD: area.code,
      },
      fetcher,
      requestIntervalMs,
    );
    for (const row of rows) {
      const courseNumber = row.HAKSU_NO?.trim().toUpperCase();
      if (courseNumber && !subjects.has(courseNumber)) {
        subjects.set(courseNumber, {
          areaCode: area.code,
          courseNumber,
          name: row.GWAMOK_NAME?.trim() ?? "",
        });
      }
    }
  }

  const result = { areas, subjects: [...subjects.values()] };
  catalogCache.set(cacheKey, result, ELECTIVE_CATALOG_CACHE_TTL_MS);
  return result;
}

export async function fetchSkkuElectiveCourses(
  query: SkkuElectiveQuery,
  courseNumber: string,
  options: {
    fetcher?: typeof fetch;
    requestIntervalMs?: number;
    sessionCache?: CacheStore<string>;
    sectionsCache?: CacheStore<SkkuCourse[]>;
  } = {},
): Promise<SkkuCourse[]> {
  const sectionsCache = options.sectionsCache ?? defaultElectiveSectionsCache;
  const cacheKey = electiveSectionsCacheKey(query, courseNumber);
  const cached = sectionsCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const fetcher = options.fetcher ?? fetch;
  const sessionCookie = await establishSkkuSession(fetcher, options.sessionCache);
  const rows = await fetchSkkuDataset(
    ELECTIVE_COURSES_URL,
    sessionCookie,
    "dsGrdMain03",
    {
      ...electiveParams(query, "dsGrdMain03", "selectMain03"),
      HAKSU_NO: courseNumber,
      ROAD_MAP: "%",
    },
    fetcher,
    options.requestIntervalMs ?? 500,
  );
  const result = normalizeCourseRows(rows, "elective");
  sectionsCache.set(cacheKey, result, ELECTIVE_SECTIONS_CACHE_TTL_MS);
  return result;
}

export function parseSsv(text: string): SsvResponse {
  let errorCode: number | undefined;
  let errorMessage = "";
  let currentDataset: string | undefined;
  let columns: string[] = [];
  const datasets: SsvResponse["datasets"] = {};

  for (const record of text.split(RS)) {
    if (!record) {
      continue;
    }
    if (record.startsWith("ErrorCode:")) {
      const value = Number(record.slice(record.lastIndexOf("=") + 1));
      if (!Number.isInteger(value)) {
        throw new Error("Invalid SSV ErrorCode");
      }
      errorCode = value;
    } else if (record.startsWith("ErrorMsg:")) {
      errorMessage = record.slice(record.indexOf("=") + 1);
    } else if (record.startsWith("Dataset:")) {
      currentDataset = record.slice(record.indexOf(":") + 1);
      datasets[currentDataset] = [];
      columns = [];
    } else if (record.startsWith("_RowType_")) {
      columns = record
        .split(US)
        .slice(1)
        .map((column) => column.split(":", 1)[0] ?? "");
    } else if (currentDataset && columns.length > 0) {
      const values = record.split(US).slice(1);
      const row: Record<string, string> = {};
      columns.forEach((column, index) => {
        row[column] = values[index] ?? "";
      });
      datasets[currentDataset]?.push(row);
    }
  }
  if (errorCode === undefined) {
    throw new Error("Missing SSV ErrorCode");
  }
  return { errorCode, errorMessage, datasets };
}

function buildSsvBody(params: Record<string, string>): string {
  return ["SSV:utf-8", ...Object.entries(params).map(([key, value]) => `${key}=${value}`)].join(
    RS,
  ) + RS;
}

async function establishSkkuSession(
  fetcher: typeof fetch,
  sessionCache: CacheStore<string> = defaultSessionCache,
): Promise<string> {
  const cached = sessionCache.get(SESSION_CACHE_KEY);
  if (cached) {
    return cached;
  }

  let response: Response;
  try {
    response = await fetcher(SESSION_LOGIN_URL, {
      method: "POST",
      headers: REQUEST_HEADERS,
      body: `SSV:utf-8${RS}`,
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new SkkuCourseApiError("unavailable");
  }
  if (!response.ok) {
    throw new SkkuCourseApiError("request_failed");
  }
  const sessionCookie = readSessionCookie(response.headers);
  if (!sessionCookie) {
    throw new SkkuCourseApiError("invalid_response");
  }
  sessionCache.set(SESSION_CACHE_KEY, sessionCookie, SESSION_COOKIE_CACHE_TTL_MS);
  return sessionCookie;
}

async function fetchSkkuDataset(
  url: string,
  sessionCookie: string,
  datasetName: string,
  params: Record<string, string>,
  fetcher: typeof fetch,
  requestIntervalMs: number,
): Promise<Array<Record<string, string>>> {
  if (requestIntervalMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, requestIntervalMs));
  }
  let response: Response;
  try {
    response = await fetcher(url, {
      method: "POST",
      headers: { ...REQUEST_HEADERS, Cookie: sessionCookie },
      body: buildSsvBody(params),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new SkkuCourseApiError("unavailable");
  }
  if (!response.ok) {
    throw new SkkuCourseApiError("request_failed");
  }
  let parsed: SsvResponse;
  try {
    parsed = parseSsv(await response.text());
  } catch {
    throw new SkkuCourseApiError("invalid_response");
  }
  if (parsed.errorCode !== 0) {
    throw new SkkuCourseApiError("request_failed");
  }
  return parsed.datasets[datasetName] ?? [];
}

function electiveParams(
  query: SkkuElectiveQuery,
  datasetName: string,
  transactionId: string,
): Record<string, string> {
  return {
    YEAR: String(query.year),
    TERM: String(query.term),
    CAMPUS_GB: String(query.campus),
    HAK_JIBJUNG: "0",
    _FIRST_OUT_DS_NM: datasetName,
    _TRANSACTION_ID: transactionId,
  };
}

function readSessionCookie(headers: Headers): string | null {
  const values =
    "getSetCookie" in headers && typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : [headers.get("set-cookie") ?? ""];
  for (const value of values) {
    const match = value.match(/(?:^|,\s*)(JSESSIONID=[^;,\s]+)/i);
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
}

function normalizeCourseRows(
  rows: Array<Record<string, string>>,
  source: SkkuCourse["source"],
): SkkuCourse[] {
  const courses = new Map<string, SkkuCourse>();
  rows.forEach((row) => {
    const courseId = row.HAKSU_NO_BUNBAN ?? "";
    if (!courseId || courses.has(courseId)) {
      return;
    }
    const separatorIndex = courseId.indexOf("-");
    const courseNumber =
      separatorIndex >= 0 ? courseId.slice(0, separatorIndex) : row.HAKSU_NO || courseId;
    const section = separatorIndex >= 0 ? courseId.slice(separatorIndex + 1) : "";
    courses.set(courseId, {
      source,
      year: readInteger(row.GAESUL_YEAR),
      term: readInteger(row.GAESUL_TERM),
      course_id: courseId,
      course_number: courseNumber,
      section,
      name: row.GWAMOK_NAME ?? "",
      english_name: row.GWAMOK_ENG_NAME ?? "",
      credits: row.HAKJUM ?? "",
      professor: row.PER_NAME ?? "",
      schedule: row.GYOSI_NAME ?? "",
      location: row.HYUNGTAE ?? "",
      classification: row.ISU_NAME ?? "",
      course_type: row.SUUP_TYPE_NM ?? "",
      campus: row.CAMPUS_NM ?? "",
      syllabus_url: row.INTRO_URL ?? "",
    });
  });
  return [...courses.values()];
}

function readInteger(value: string | undefined): number {
  return value && /^\d+$/.test(value) ? Number(value) : 0;
}
