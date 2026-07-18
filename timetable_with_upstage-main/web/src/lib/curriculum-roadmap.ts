export type RoadmapPlacement =
  | { type: "exact"; grade: number; semester: 1 | 2 }
  | { type: "year_only"; grade: number; semester: null }
  | { type: "range"; fromGrade: number; fromSemester: 1 | 2 | null; toGrade: number; toSemester: 1 | 2 | null }
  | { type: "unspecified"; grade: null; semester: null };

export interface RoadmapCourse {
  id: string;
  printedCourseName: string;
  curriculumCategory: string | null;
  trackName: string | null;
  placement: RoadmapPlacement;
  reviewStatus: "verified" | "needs_review";
  reviewReasons: string[];
  sourceEvidence: string | null;
}

export interface CurriculumRoadmap {
  schemaVersion: "1.1";
  sourceDocumentId: string;
  status: "draft" | "confirmed";
  academicYear: number | null;
  programCode: string | null;
  programName: string | null;
  layoutType: "semester_grid" | "year_grid" | "track_map" | "mixed" | "unknown";
  courses: RoadmapCourse[];
  reviewReasons: string[];
}

export interface RoadmapContext { programCode: string; admissionYear: number; currentGrade: number; semester: 1 | 2; }

export function parseCurriculumRoadmap(value: unknown): CurriculumRoadmap {
  if (!record(value) || !Array.isArray(value.courses)) throw new Error("invalid roadmap");
  return {
    schemaVersion: "1.1",
    sourceDocumentId: typeof value.sourceDocumentId === "string" ? value.sourceDocumentId : crypto.randomUUID(),
    status: value.status === "confirmed" ? "confirmed" : "draft",
    academicYear: integer(value.academicYear), programCode: text(value.programCode), programName: text(value.programName),
    layoutType: isLayout(value.layoutType) ? value.layoutType : "unknown",
    courses: value.courses.map(parseCourse), reviewReasons: texts(value.reviewReasons),
  };
}

export function confirmCurriculumRoadmap(value: CurriculumRoadmap): CurriculumRoadmap {
  return { ...value, status: "confirmed", reviewReasons: [], courses: value.courses.map((course) => ({ ...course, reviewStatus: "verified", reviewReasons: [] })) };
}

/**
 * Keep exact target-cell courses plus year/range courses that explicitly cover
 * the requested grade. Semester-less entries remain advisory for both terms.
 */
export function validateRoadmapForTarget(
  value: CurriculumRoadmap,
  context: Pick<RoadmapContext, "currentGrade" | "semester">,
): CurriculumRoadmap {
  const seen = new Set<string>();
  const courses = value.courses.flatMap((course) => {
    const key = normalize(course.printedCourseName);
    if (!key || seen.has(key)) return [];
    const applies = course.placement.type === "exact"
      ? course.placement.grade === context.currentGrade && course.placement.semester === context.semester
      : course.placement.type === "year_only"
        ? course.placement.grade === context.currentGrade
        : course.placement.type === "range"
          ? context.currentGrade >= course.placement.fromGrade && context.currentGrade <= course.placement.toGrade
          : false;
    if (!applies) return [];
    seen.add(key);
    return [course];
  });
  const removed = value.courses.length - courses.length;
  return {
    ...value,
    status: "draft",
    courses,
    reviewReasons: removed > 0
      ? [...value.reviewReasons, `${removed}개 항목은 선택 학년·학기 근거가 없어 제외됨`]
      : value.reviewReasons,
  };
}

export function updateRoadmapCourse(value: CurriculumRoadmap, id: string, patch: Partial<RoadmapCourse>): CurriculumRoadmap {
  return { ...value, status: "draft", courses: value.courses.map((course) => course.id === id ? { ...course, ...patch, reviewStatus: "needs_review" } : course) };
}

export function getRoadmapMatch(courseName: string, context: RoadmapContext | null, roadmap: CurriculumRoadmap | null): RoadmapCourse | null {
  if (!context || !roadmap || roadmap.status !== "confirmed") return null;
  const name = normalize(courseName);
  return roadmap.courses.find((course) => course.reviewStatus === "verified" && normalize(course.printedCourseName) === name) ?? null;
}

export function isRoadmapFilterActive(context: RoadmapContext | null, roadmap: CurriculumRoadmap | null): boolean {
  return Boolean(context && roadmap && roadmap.status === "confirmed" && roadmap.academicYear === context.admissionYear && roadmap.programCode === context.programCode);
}

function parseCourse(raw: unknown, index: number): RoadmapCourse {
  if (!record(raw) || !text(raw.printedCourseName)) throw new Error(`invalid course ${index}`);
  const type = raw.placementType;
  const grade = integer(raw.grade); const semester = term(raw.semester);
  let placement: RoadmapPlacement = { type: "unspecified", grade: null, semester: null };
  if (type === "exact" && grade !== null && semester !== null) placement = { type, grade, semester };
  else if (type === "year_only" && grade !== null) placement = { type, grade, semester: null };
  else if (type === "range" && integer(raw.fromGrade) !== null && integer(raw.toGrade) !== null) placement = { type, fromGrade: integer(raw.fromGrade)!, fromSemester: term(raw.fromSemester), toGrade: integer(raw.toGrade)!, toSemester: term(raw.toSemester) };
  return { id: typeof raw.id === "string" ? raw.id : `course-${index + 1}`, printedCourseName: text(raw.printedCourseName)!, curriculumCategory: text(raw.curriculumCategory), trackName: text(raw.trackName), placement, reviewStatus: raw.uncertain === false || raw.reviewStatus === "verified" ? "verified" : "needs_review", reviewReasons: texts(raw.uncertaintyReasons ?? raw.reviewReasons), sourceEvidence: text(raw.sourceEvidence) };
}
function normalize(v: string): string { return v.normalize("NFKC").replace(/\((?:선택|학석|학사|대학원)\)$/u, "").replace(/[\s·ㆍ,:/\\_()\[\]-]+/g, "").toLowerCase(); }
function record(v: unknown): v is Record<string, unknown> { return typeof v === "object" && v !== null && !Array.isArray(v); }
function integer(v: unknown): number | null { return typeof v === "number" && Number.isInteger(v) ? v : null; }
function term(v: unknown): 1 | 2 | null { return v === 1 || v === 2 ? v : null; }
function text(v: unknown): string | null { return typeof v === "string" && v.trim() ? v.trim() : null; }
function texts(v: unknown): string[] { return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []; }
function isLayout(v: unknown): v is CurriculumRoadmap["layoutType"] { return v === "semester_grid" || v === "year_grid" || v === "track_map" || v === "mixed" || v === "unknown"; }
