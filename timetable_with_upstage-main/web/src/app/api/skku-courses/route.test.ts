import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

vi.mock("../../../lib/skku-course-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../lib/skku-course-api")>();
  return { ...original, fetchSkkuMajorCourses: vi.fn() };
});

import { fetchSkkuMajorCourses } from "../../../lib/skku-course-api";

const fetchCoursesMock = vi.mocked(fetchSkkuMajorCourses);

afterEach(() => {
  vi.clearAllMocks();
});

function request(body: unknown): Request {
  return new Request("http://localhost/api/skku-courses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/skku-courses", () => {
  it("returns only the selected department scope", async () => {
    fetchCoursesMock.mockResolvedValue([
      {
        source: "major",
        year: 2026,
        term: 20,
        course_id: "BUS2001-01",
        course_number: "BUS2001",
        section: "01",
        name: "경영학원론",
        english_name: "",
        credits: "3",
        professor: "",
        schedule: "월09:00-10:15",
        location: "",
        classification: "전공코어",
        course_type: "",
        campus: "인문사회과학캠퍼스",
        syllabus_url: "",
      },
    ]);

    const response = await POST(
      request({ year: 2026, term: 20, campus: 1, departmentCode: "316901" }),
    );
    const body = (await response.json()) as { courses: Array<{ course_id: string }> };

    expect(response.status).toBe(200);
    expect(body.courses).toEqual([expect.objectContaining({ course_id: "BUS2001-01" })]);
    expect(fetchCoursesMock).toHaveBeenCalledWith({
      year: 2026,
      term: 20,
      campus: 1,
      departmentCode: "316901",
    });
  });

  it("rejects an invalid department code before contacting SKKU", async () => {
    const response = await POST(
      request({ year: 2026, term: 20, campus: 1, departmentCode: "invalid" }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "invalid_query" } });
    expect(fetchCoursesMock).not.toHaveBeenCalled();
  });
});
