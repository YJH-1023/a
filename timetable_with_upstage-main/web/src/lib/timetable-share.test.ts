import { describe, expect, it } from "vitest";

import { decodeShareableTimetable, encodeShareableTimetable } from "./timetable-share";
import type { Timetable } from "./timetable";

const SAMPLE_TIMETABLE: Timetable = {
  courses: [
    {
      id: "course-1",
      title: "창의적글쓰기",
      schedule: "월 09:00-10:15",
      credits: 3,
      section: "01",
      professor: "홍길동",
      campus: "인사캠",
      courseType: "대면",
    },
    {
      id: "course-2",
      title: "미분적분학1",
      schedule: "화 10:30-11:45, 목 10:30-11:45",
      credits: 3,
    },
  ],
  meetings: [],
  fixedEvents: [],
};

describe("encodeShareableTimetable / decodeShareableTimetable", () => {
  it("round-trips a timetable through the encoded URL string", () => {
    const encoded = encodeShareableTimetable(SAMPLE_TIMETABLE);
    const decoded = decodeShareableTimetable(encoded);

    expect(decoded?.courses).toEqual(SAMPLE_TIMETABLE.courses);
  });

  it("produces a base64url string with no characters that need escaping in a URL path segment", () => {
    const encoded = encodeShareableTimetable(SAMPLE_TIMETABLE);

    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("returns null for empty, garbage, or non-array input", () => {
    expect(decodeShareableTimetable("")).toBeNull();
    expect(decodeShareableTimetable("not-a-valid-encoding")).toBeNull();
    expect(decodeShareableTimetable("%%%")).toBeNull();
  });

  it("drops course rows missing required fields instead of throwing", () => {
    const encoded = encodeShareableTimetable({
      courses: [
        { id: "ok", title: "정상 과목", schedule: "월 09:00-10:15" },
        // @ts-expect-error intentionally malformed for the defensive-parsing test
        { id: "missing-title", schedule: "월 09:00-10:15" },
      ],
      meetings: [],
      fixedEvents: [],
    });

    const decoded = decodeShareableTimetable(encoded);

    expect(decoded?.courses).toHaveLength(1);
    expect(decoded?.courses[0]?.id).toBe("ok");
  });

  it("caps the number of shared courses to guard against oversized payloads", () => {
    const manyCourses = Array.from({ length: 50 }, (_, index) => ({
      id: `course-${index}`,
      title: `과목 ${index}`,
      schedule: "월 09:00-10:15",
    }));

    const encoded = encodeShareableTimetable({ courses: manyCourses, meetings: [], fixedEvents: [] });
    const decoded = decodeShareableTimetable(encoded);

    expect(decoded?.courses.length).toBeLessThanOrEqual(30);
  });
});
