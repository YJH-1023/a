import { describe, expect, it } from "vitest";

import {
  CombinationLimitError,
  generateValidTimetables,
  mergeMeetingsForDisplay,
  meetingsConflict,
  parseSchedule,
} from "./timetable";

describe("parseSchedule", () => {
  it("parses SKKU schedule strings with module and room annotations", () => {
    expect(parseSchedule("【모듈A】화12:00-13:15【33302】,목13:30-14:45【33302】")).toEqual([
      { day: "tue", startMinutes: 720, endMinutes: 795 },
      { day: "thu", startMinutes: 810, endMinutes: 885 },
    ]);
  });

  it("does not treat adjacent meetings as a conflict", () => {
    expect(
      meetingsConflict(
        { day: "mon", startMinutes: 540, endMinutes: 615 },
        { day: "mon", startMinutes: 615, endMinutes: 690 },
      ),
    ).toBe(false);
  });

  it("merges one course's consecutive periods into one block on the same day", () => {
    expect(mergeMeetingsForDisplay([
      { day: "thu", startMinutes: 810, endMinutes: 885 },
      { day: "mon", startMinutes: 810, endMinutes: 885 },
      { day: "mon", startMinutes: 900, endMinutes: 975 },
      { day: "mon", startMinutes: 990, endMinutes: 1065 },
    ])).toEqual([
      { day: "mon", startMinutes: 810, endMinutes: 1065 },
      { day: "thu", startMinutes: 810, endMinutes: 885 },
    ]);
  });
});

describe("generateValidTimetables", () => {
  const groups = [
    [
      { id: "a-mon", title: "월요일 과목", schedule: "월09:00-10:15" },
      { id: "a-tue", title: "화요일 과목", schedule: "화10:30-11:45" },
    ],
    [
      { id: "b-conflict", title: "월요일 충돌", schedule: "월10:00-11:15" },
      { id: "b-wed", title: "수요일 과목", schedule: "수12:00-13:15" },
    ],
  ];

  it("removes time conflicts and applies user constraints without ranking results", () => {
    const timetables = generateValidTimetables(groups, {
      unavailableDays: ["tue"],
      earliestStartMinutes: 540,
    });

    expect(timetables.map((timetable) => timetable.courses.map((course) => course.id))).toEqual([
      ["a-mon", "b-wed"],
    ]);
  });

  it("keeps an unscheduled course as a candidate because no conflict is known", () => {
    const timetables = generateValidTimetables([
      [{ id: "online", title: "온라인", schedule: "온라인 수업" }],
      [{ id: "wed", title: "수요일", schedule: "수12:00-13:15" }],
    ]);

    expect(timetables).toHaveLength(1);
    expect(timetables[0]?.meetings).toEqual([{ day: "wed", startMinutes: 720, endMinutes: 795 }]);
  });

  it("fails explicitly instead of returning an arbitrary top N when combinations exceed the guard", () => {
    expect(() => generateValidTimetables(groups, {}, 1)).toThrow(CombinationLimitError);
  });

  it("excludes courses that overlap a fixed event and attaches the event to every result", () => {
    const timetables = generateValidTimetables(groups, {
      unavailableDays: ["tue"],
      fixedEvents: [
        { id: "part-time", label: "알바", day: "mon", startMinutes: 570, endMinutes: 660 },
      ],
    });

    // a-mon (월 09:00-10:15) overlaps 알바 (월 09:30-11:00) and must be excluded, leaving only
    // combinations built from b-conflict/b-wed with no first-group course left standing on 월.
    expect(timetables.map((timetable) => timetable.courses.map((course) => course.id))).toEqual([]);
    expect(
      generateValidTimetables(groups, {
        fixedEvents: [
          { id: "part-time", label: "알바", day: "mon", startMinutes: 570, endMinutes: 660 },
        ],
      })[0]?.fixedEvents,
    ).toEqual([{ id: "part-time", label: "알바", day: "mon", startMinutes: 570, endMinutes: 660 }]);
  });
});
