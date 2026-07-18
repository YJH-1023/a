import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

function timetable(id: string, meetings: Array<{ day: string; startMinutes: number; endMinutes: number }>) {
  return {
    courses: [{ id, title: `과목 ${id}`, schedule: "" }],
    meetings,
  };
}

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/timetable-recommendations", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// A1 occupies every weekday (0 free days); B1 occupies only Monday (4 free days) — a clear
// free_days winner so the deterministic scorer has an unambiguous ranking to assert against.
const weekdayFilledTimetable = timetable("A1", [
  { day: "mon", startMinutes: 600, endMinutes: 660 },
  { day: "tue", startMinutes: 600, endMinutes: 660 },
  { day: "wed", startMinutes: 600, endMinutes: 660 },
  { day: "thu", startMinutes: 600, endMinutes: 660 },
  { day: "fri", startMinutes: 600, endMinutes: 660 },
]);
const spaciousTimetable = timetable("B1", [{ day: "mon", startMinutes: 600, endMinutes: 660 }]);

describe("POST /api/timetable-recommendations", () => {
  beforeEach(() => {
    vi.stubEnv("UPSTAGE_API_KEY", "test-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("rejects a non-JSON body", async () => {
    const response = await POST(
      new Request("http://localhost/api/timetable-recommendations", {
        method: "POST",
        body: "not json",
      }),
    );
    expect(response.status).toBe(400);
  });

  it("rejects an empty or malformed timetables array", async () => {
    const response = await POST(jsonRequest({ timetables: [] }));
    expect(response.status).toBe(400);
    const malformed = await POST(jsonRequest({ timetables: [{ courses: [] }] }));
    expect(malformed.status).toBe(400);
  });

  it("returns deterministic-only recommendations without calling Solar when UPSTAGE_API_KEY is unset", async () => {
    vi.unstubAllEnvs();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      jsonRequest({
        timetables: [weekdayFilledTimetable, spaciousTimetable],
        weights: [{ id: "free_days", enabled: true, importance: "medium" }],
      }),
    );
    const body = (await response.json()) as {
      recommendations: Array<{ candidateId: string; reason: string | null }>;
      aiExplanationFailed: boolean;
    };

    expect(response.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(body.aiExplanationFailed).toBe(true);
    expect(body.recommendations[0]?.candidateId).toBe("B1");
    expect(body.recommendations.every((entry) => entry.reason === null)).toBe(true);
  });

  it("attaches Solar reasons and requirement contributions on the happy path", async () => {
    const solarResult = JSON.stringify([
      { candidateId: "B1", rank: 1, reason: "공강이 더 많습니다.", requirementContribution: "전공필수 충족", customPreferenceNote: null },
      { candidateId: "A1", rank: 2, reason: "요일이 몰려 있습니다.", requirementContribution: null, customPreferenceNote: null },
    ]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ choices: [{ message: { role: "assistant", content: solarResult } }] }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      jsonRequest({
        timetables: [weekdayFilledTimetable, spaciousTimetable],
        weights: [{ id: "free_days", enabled: true, importance: "medium" }],
        requirements: [{ label: "전공필수", status: "unmet", remainingCredits: 3 }],
      }),
    );
    const body = (await response.json()) as {
      recommendations: Array<{
        candidateId: string;
        rank: number;
        reason: string | null;
        requirementContribution: string | null;
      }>;
      aiExplanationFailed: boolean;
    };

    expect(body.aiExplanationFailed).toBe(false);
    expect(body.recommendations[0]).toMatchObject({
      candidateId: "B1",
      rank: 1,
      reason: "공강이 더 많습니다.",
      requirementContribution: "전공필수 충족",
    });
    expect(body.recommendations[1]).toMatchObject({ candidateId: "A1", rank: 2 });
  });

  it("falls back to deterministic ranking when Solar returns malformed JSON", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ choices: [{ message: { role: "assistant", content: "이건 JSON이 아닙니다." } }] }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      jsonRequest({
        timetables: [weekdayFilledTimetable, spaciousTimetable],
        weights: [{ id: "free_days", enabled: true, importance: "medium" }],
      }),
    );
    const body = (await response.json()) as {
      recommendations: Array<{ candidateId: string; reason: string | null }>;
      aiExplanationFailed: boolean;
    };

    expect(body.aiExplanationFailed).toBe(true);
    expect(body.recommendations[0]?.candidateId).toBe("B1");
    expect(body.recommendations.every((entry) => entry.reason === null)).toBe(true);
  });

  it("reorders by customPreference only when Solar returns a clean rank permutation", async () => {
    const solarResult = JSON.stringify([
      { candidateId: "B1", rank: 2, reason: "이유1", requirementContribution: null, customPreferenceNote: "덜 맞음" },
      { candidateId: "A1", rank: 1, reason: "이유2", requirementContribution: null, customPreferenceNote: "화요일 수업 회피 조건에 맞음" },
    ]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ choices: [{ message: { role: "assistant", content: solarResult } }] }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      jsonRequest({
        timetables: [weekdayFilledTimetable, spaciousTimetable],
        weights: [{ id: "free_days", enabled: true, importance: "medium" }],
        customPreference: "화요일 수업은 피하고 싶어요",
      }),
    );
    const body = (await response.json()) as {
      recommendations: Array<{ candidateId: string; rank: number }>;
    };

    expect(body.recommendations[0]).toMatchObject({ candidateId: "A1", rank: 1 });
    expect(body.recommendations[1]).toMatchObject({ candidateId: "B1", rank: 2 });
  });

  it("uses default weights when weights is omitted", async () => {
    vi.unstubAllEnvs();
    const response = await POST(jsonRequest({ timetables: [weekdayFilledTimetable, spaciousTimetable] }));
    expect(response.status).toBe(200);
  });
});
