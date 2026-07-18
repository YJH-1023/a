import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

vi.mock("../../../lib/skku-course-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../lib/skku-course-api")>();
  return {
    ...original,
    fetchSkkuAllElectiveSubjects: vi.fn(),
    fetchSkkuElectiveAreas: vi.fn(),
    fetchSkkuElectiveSubjects: vi.fn(),
    fetchSkkuElectiveCourses: vi.fn(),
  };
});

import {
  fetchSkkuAllElectiveSubjects,
  fetchSkkuElectiveAreas,
  fetchSkkuElectiveCourses,
  fetchSkkuElectiveSubjects,
} from "../../../lib/skku-course-api";

const fetchAreasMock = vi.mocked(fetchSkkuElectiveAreas);
const fetchAllSubjectsMock = vi.mocked(fetchSkkuAllElectiveSubjects);
const fetchSubjectsMock = vi.mocked(fetchSkkuElectiveSubjects);
const fetchCoursesMock = vi.mocked(fetchSkkuElectiveCourses);

afterEach(() => vi.clearAllMocks());

function request(body: unknown): Request {
  return new Request("http://localhost/api/skku-electives", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/skku-electives", () => {
  it("loads the complete elective catalog for the explicitly selected campus", async () => {
    fetchAllSubjectsMock.mockResolvedValue({
      areas: [{ code: "A5", label: "글로벌", count: 1 }],
      subjects: [{ areaCode: "A5", courseNumber: "GEDG001", name: "영어쓰기" }],
    });

    const response = await POST(
      request({ year: 2026, term: 20, campus: 3, mode: "all_subjects" }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      subjects: [{ courseNumber: "GEDG001" }],
    });
    expect(fetchAllSubjectsMock).toHaveBeenCalledWith({ year: 2026, term: 20, campus: 3 });
  });

  it("loads subjects only for the selected official area", async () => {
    fetchSubjectsMock.mockResolvedValue([
      { areaCode: "A5", courseNumber: "GEDG001", name: "영어쓰기" },
    ]);

    const response = await POST(
      request({ year: 2026, term: 20, campus: 1, mode: "subjects", areaCode: "A5" }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      subjects: [{ courseNumber: "GEDG001", name: "영어쓰기" }],
    });
    expect(fetchSubjectsMock).toHaveBeenCalledWith(
      { year: 2026, term: 20, campus: 1 },
      "A5",
    );
  });

  it("rejects unknown areas and malformed course numbers", async () => {
    expect((await POST(request({ year: 2026, term: 20, campus: 1, mode: "subjects", areaCode: "X" }))).status).toBe(400);
    expect((await POST(request({ year: 2026, term: 20, campus: 1, mode: "sections", courseNumber: "bad" }))).status).toBe(400);
    expect((await POST(request({ year: 2026, term: 20, campus: 4, mode: "all_subjects" }))).status).toBe(400);
    expect(fetchAreasMock).not.toHaveBeenCalled();
    expect(fetchSubjectsMock).not.toHaveBeenCalled();
    expect(fetchCoursesMock).not.toHaveBeenCalled();
  });
});
