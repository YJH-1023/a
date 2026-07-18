import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  fetchSkkuAllElectiveSubjects,
  fetchSkkuElectiveAreas,
  fetchSkkuElectiveCourses,
  fetchSkkuElectiveSubjects,
  fetchSkkuMajorCourses,
  parseSsv,
  resetSkkuApiCaches,
} from "./skku-course-api";

const RS = "\x1e";
const US = "\x1f";

function courseSsv(): string {
  return [
    "SSV:utf-8",
    "ErrorCode:int=0",
    "ErrorMsg:string=SUCCESS",
    "Dataset:dsGrdMain",
    [
      "_RowType_",
      "GAESUL_YEAR:string(4)",
      "GAESUL_TERM:string(2)",
      "HAKSU_NO_BUNBAN:string(20)",
      "HAKSU_NO:string(20)",
      "GWAMOK_NAME:string(200)",
      "GYOSI_NAME:string(200)",
    ].join(US),
    ["N", "2026", "20", "BUS2001-01", "BUS2001", "경영학원론", "월09:00-10:15"].join(US),
    "",
  ].join(RS);
}

function datasetSsv(name: string, columns: string[], values: string[]): string {
  return [
    "SSV:utf-8",
    "ErrorCode:int=0",
    "ErrorMsg:string=SUCCESS",
    `Dataset:${name}`,
    ["_RowType_", ...columns.map((column) => `${column}:string(200)`)].join(US),
    ["N", ...values].join(US),
    "",
  ].join(RS);
}

describe("SKKU course API", () => {
  beforeEach(() => {
    resetSkkuApiCaches();
  });

  it("parses typed SSV columns and rows", () => {
    expect(parseSsv(courseSsv())).toMatchObject({
      errorCode: 0,
      datasets: {
        dsGrdMain: [
          {
            GAESUL_YEAR: "2026",
            HAKSU_NO_BUNBAN: "BUS2001-01",
            GWAMOK_NAME: "경영학원론",
          },
        ],
      },
    });
  });

  it("establishes a session and returns privacy-minimized course rows", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("ok", { headers: { "set-cookie": "JSESSIONID=session-1; Path=/; HttpOnly" } }),
      )
      .mockResolvedValueOnce(new Response(courseSsv()));

    const courses = await fetchSkkuMajorCourses(
      { year: 2026, term: 20, campus: 1, departmentCode: "316901" },
      { fetcher, requestIntervalMs: 0 },
    );

    expect(courses).toEqual([
      expect.objectContaining({
        source: "major",
        year: 2026,
        term: 20,
        course_id: "BUS2001-01",
        course_number: "BUS2001",
        section: "01",
        name: "경영학원론",
        schedule: "월09:00-10:15",
      }),
    ]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const request = fetcher.mock.calls[1]?.[1];
    expect(request?.headers).toMatchObject({ Cookie: "JSESSIONID=session-1" });
    expect(request?.body).toContain(`SSV:utf-8${RS}YEAR=2026${RS}TERM=20${RS}`);
    expect(request?.body).toContain(`${RS}HAKGWA_CD=316901${RS}`);
  });

  it("loads the official elective area counts and selected subject catalog", async () => {
    const session = () =>
      new Response("ok", { headers: { "set-cookie": "JSESSIONID=session-1; Path=/" } });
    const areaFetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(session())
      .mockResolvedValueOnce(
        new Response(datasetSsv("dsGrdMain01", ["A5", "A7", "D1"], ["11", "4", "3"])),
      );
    const areas = await fetchSkkuElectiveAreas(
      { year: 2026, term: 20, campus: 1 },
      { fetcher: areaFetcher, requestIntervalMs: 0 },
    );
    expect(areas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "A5", label: "글로벌", count: 11 }),
        expect.objectContaining({ code: "A7", label: "미래(SW/AI)", count: 4 }),
        expect.objectContaining({ code: "D1", label: "인간/문화", count: 3 }),
      ]),
    );

    resetSkkuApiCaches();
    const subjectFetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(session())
      .mockResolvedValueOnce(
        new Response(
          datasetSsv("dsGrdMain02", ["HAKSU_NO", "GWAMOK_NAME"], ["GEDG001", "영어쓰기"]),
        ),
      );
    await expect(
      fetchSkkuElectiveSubjects(
        { year: 2026, term: 20, campus: 1 },
        "A5",
        { fetcher: subjectFetcher, requestIntervalMs: 0 },
      ),
    ).resolves.toEqual([{ areaCode: "A5", courseNumber: "GEDG001", name: "영어쓰기" }]);
    expect(subjectFetcher.mock.calls[1]?.[1]?.body).toContain(
      `${RS}YUNGYUK_ETC_CD=A5${RS}`,
    );
  });

  it("loads sections for one selected elective course", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("ok", { headers: { "set-cookie": "JSESSIONID=session-1; Path=/" } }),
      )
      .mockResolvedValueOnce(
        new Response(
          datasetSsv(
            "dsGrdMain03",
            ["GAESUL_YEAR", "GAESUL_TERM", "HAKSU_NO_BUNBAN", "HAKSU_NO", "GWAMOK_NAME", "GYOSI_NAME"],
            ["2026", "20", "GEDG001-01", "GEDG001", "영어쓰기", "월09:00-10:15"],
          ),
        ),
      );

    const courses = await fetchSkkuElectiveCourses(
      { year: 2026, term: 20, campus: 1 },
      "GEDG001",
      { fetcher, requestIntervalMs: 0 },
    );

    expect(courses).toEqual([
      expect.objectContaining({ source: "elective", course_id: "GEDG001-01" }),
    ]);
    expect(fetcher.mock.calls[1]?.[1]?.body).toContain(`${RS}HAKSU_NO=GEDG001${RS}`);
  });

  it("loads all nonempty elective areas with one campus-scoped session", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("ok", { headers: { "set-cookie": "JSESSIONID=session-1; Path=/" } }),
      )
      .mockResolvedValueOnce(
        new Response(datasetSsv("dsGrdMain01", ["A5", "D1"], ["1", "1"])),
      )
      .mockResolvedValueOnce(
        new Response(
          datasetSsv("dsGrdMain02", ["HAKSU_NO", "GWAMOK_NAME"], ["GEDG001", "영어쓰기"]),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          datasetSsv("dsGrdMain02", ["HAKSU_NO", "GWAMOK_NAME"], ["GEDH001", "인간과문화"]),
        ),
      );

    const catalog = await fetchSkkuAllElectiveSubjects(
      { year: 2026, term: 20, campus: 3 },
      { fetcher, requestIntervalMs: 0 },
    );

    expect(catalog.subjects).toEqual([
      { areaCode: "A5", courseNumber: "GEDG001", name: "영어쓰기" },
      { areaCode: "D1", courseNumber: "GEDH001", name: "인간과문화" },
    ]);
    expect(fetcher).toHaveBeenCalledTimes(4);
    for (const call of fetcher.mock.calls.slice(1)) {
      expect(call[1]?.headers).toMatchObject({ Cookie: "JSESSIONID=session-1" });
      expect(call[1]?.body).toContain(`${RS}CAMPUS_GB=3${RS}`);
    }
  });

  it("rejects an SSV response without an error code", () => {
    expect(() => parseSsv("SSV:utf-8")).toThrow("Missing SSV ErrorCode");
  });

  it("serves a repeated elective catalog request from cache without re-fetching", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("ok", { headers: { "set-cookie": "JSESSIONID=session-1; Path=/" } }),
      )
      .mockResolvedValueOnce(
        new Response(datasetSsv("dsGrdMain01", ["A5"], ["1"])),
      )
      .mockResolvedValueOnce(
        new Response(
          datasetSsv("dsGrdMain02", ["HAKSU_NO", "GWAMOK_NAME"], ["GEDG001", "영어쓰기"]),
        ),
      );

    const query = { year: 2026, term: 20 as const, campus: 1 as const };
    const first = await fetchSkkuAllElectiveSubjects(query, { fetcher, requestIntervalMs: 0 });
    const second = await fetchSkkuAllElectiveSubjects(query, { fetcher, requestIntervalMs: 0 });

    expect(second).toEqual(first);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("reuses a cached session across independent calls", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("ok", { headers: { "set-cookie": "JSESSIONID=session-1; Path=/" } }),
      )
      .mockResolvedValueOnce(new Response(courseSsv()))
      .mockResolvedValueOnce(new Response(courseSsv()));

    const query = { year: 2026, term: 20 as const, campus: 1 as const, departmentCode: "316901" };
    await fetchSkkuMajorCourses(query, { fetcher, requestIntervalMs: 0 });
    await fetchSkkuMajorCourses(
      { ...query, departmentCode: "316902" },
      { fetcher, requestIntervalMs: 0 },
    );

    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
