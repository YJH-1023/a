import { compressToBase64, decompressFromBase64 } from "lz-string";

import type { CourseCandidate, Timetable } from "./timetable";

/**
 * Shared timetables carry only course-schedule data (no login, no server storage): the receiving
 * browser rebuilds the same grid straight from this data, unlike a PNG export which would need
 * server-side hosting to be link-shareable at all. See docs/01_의사결정_로그.md.
 *
 * lz-string's own "EncodedURIComponent" charset includes `+`, which some routers/CDNs (verified
 * against this app's own Next.js dev server, 2026-07-18) rewrite or leave un-decoded in dynamic
 * route segments, corrupting the payload. Base64url (`-`/`_`, no `+`/`/`/`=`) has no characters
 * that need escaping in a URL path segment, so it round-trips everywhere.
 */
const MAX_SHARED_COURSES = 30;

export function encodeShareableTimetable(timetable: Timetable): string {
  const payload = timetable.courses.slice(0, MAX_SHARED_COURSES).map(stripCourseForSharing);
  return toBase64Url(compressToBase64(JSON.stringify(payload)));
}

export function decodeShareableTimetable(encoded: string): Timetable | null {
  if (!encoded) {
    return null;
  }
  let json: string | null;
  try {
    json = decompressFromBase64(fromBase64Url(encoded));
  } catch {
    return null;
  }
  if (!json) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) {
    return null;
  }
  const courses = parsed.slice(0, MAX_SHARED_COURSES).flatMap((item) => {
    const course = readCourseCandidate(item);
    return course ? [course] : [];
  });
  if (courses.length === 0) {
    return null;
  }
  // Fixed events (알바 등) are personal and never encoded into the link — see stripCourseForSharing.
  return { courses, meetings: [], fixedEvents: [] };
}

function toBase64Url(base64: string): string {
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(base64Url: string): string {
  const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
  const padding = base64.length % 4 === 0 ? "" : "=".repeat(4 - (base64.length % 4));
  return base64 + padding;
}

function stripCourseForSharing(course: CourseCandidate): CourseCandidate {
  return {
    id: course.id,
    title: course.title,
    schedule: course.schedule,
    credits: course.credits,
    section: course.section,
    professor: course.professor,
    campus: course.campus,
    courseType: course.courseType,
  };
}

function readCourseCandidate(value: unknown): CourseCandidate | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : null;
  const title = typeof record.title === "string" ? record.title : null;
  const schedule = typeof record.schedule === "string" ? record.schedule : null;
  if (!id || !title || schedule === null) {
    return null;
  }
  return {
    id,
    title,
    schedule,
    credits: typeof record.credits === "number" ? record.credits : undefined,
    section: typeof record.section === "string" ? record.section : undefined,
    professor: typeof record.professor === "string" ? record.professor : undefined,
    campus: typeof record.campus === "string" ? record.campus : undefined,
    courseType: typeof record.courseType === "string" ? record.courseType : undefined,
  };
}
