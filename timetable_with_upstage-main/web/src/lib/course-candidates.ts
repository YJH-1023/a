import type { CourseCandidate } from "./timetable";

export interface CourseCandidateGroup {
  id: string;
  title: string;
  classification: string;
  credits: number;
  candidates: CourseCandidate[];
}

export function shouldShowSectionDetails(sectionCount: number): boolean {
  return sectionCount > 0;
}

type ScrapedCourse = {
  course_id: string;
  course_number: string;
  section: string;
  name: string;
  schedule: string;
  credits: number;
  classification: string;
  professor: string;
  campus: string;
  course_type: string;
};

/**
 * Converts the server's privacy-minimized course collection into course/section choices.
 * The result is kept only in browser memory and is not persisted by the web app.
 */
export function courseGroupsFromCollection(collection: unknown): CourseCandidateGroup[] {
  if (!isRecord(collection) || !Array.isArray(collection.courses)) {
    throw new Error("개설강좌 응답에 courses 배열이 없습니다.");
  }

  const groups = new Map<string, CourseCandidateGroup>();
  const courseIds = new Set<string>();

  for (const value of collection.courses) {
    const course = readCourse(value);
    if (courseIds.has(course.course_id)) {
      continue;
    }
    courseIds.add(course.course_id);

    const groupId = course.course_number || course.course_id;
    const group = groups.get(groupId) ?? {
      id: groupId,
      title: course.name || groupId,
      classification: course.classification,
      credits: course.credits,
      candidates: [],
    };
    group.credits = Math.max(group.credits, course.credits);
    group.candidates.push({
      id: course.course_id,
      title: formatCandidateTitle(course),
      schedule: course.schedule,
      credits: course.credits,
      ...(course.section ? { section: course.section } : {}),
      ...(course.professor ? { professor: course.professor } : {}),
      ...(course.campus ? { campus: course.campus } : {}),
      ...(course.course_type ? { courseType: course.course_type } : {}),
    });
    groups.set(groupId, group);
  }

  if (groups.size === 0) {
    throw new Error("시간표 후보로 쓸 과목이 JSON에 없습니다.");
  }
  return [...groups.values()];
}

function readCourse(value: unknown): ScrapedCourse {
  if (!isRecord(value)) {
    throw new Error("courses 배열의 각 항목은 객체여야 합니다.");
  }
  const course_id = readRequiredString(value, "course_id");
  const course_number = readOptionalString(value, "course_number");
  const section = readOptionalString(value, "section");
  const name = readOptionalString(value, "name");
  const schedule = readOptionalString(value, "schedule");
  const credits = readCredits(value.credits);
  const classification = readOptionalString(value, "classification");
  const professor = readOptionalString(value, "professor");
  const campus = readOptionalString(value, "campus");
  const course_type = readOptionalString(value, "course_type");
  return {
    course_id,
    course_number,
    section,
    name,
    schedule,
    credits,
    classification,
    professor,
    campus,
    course_type,
  };
}

function readCredits(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? value : 0;
  }
  if (typeof value !== "string") {
    return 0;
  }
  const match = value.trim().match(/^\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function formatCandidateTitle(course: ScrapedCourse): string {
  const name = course.name || course.course_number || course.course_id;
  return course.section ? `${name} · ${course.section}분반` : name;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readRequiredString(record: Record<string, unknown>, key: string): string {
  const value = readOptionalString(record, key);
  if (!value) {
    throw new Error(`courses 항목에 ${key} 문자열이 필요합니다.`);
  }
  return value;
}

function readOptionalString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value !== "string") {
    throw new Error(`courses 항목의 ${key}은 문자열이어야 합니다.`);
  }
  return value;
}
