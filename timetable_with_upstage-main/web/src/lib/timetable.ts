export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export interface Meeting {
  day: Weekday;
  startMinutes: number;
  endMinutes: number;
}

/** A user-defined block (e.g. 알바) that reserves time without being a course. */
export interface FixedEvent {
  id: string;
  label: string;
  day: Weekday;
  startMinutes: number;
  endMinutes: number;
}

export interface CourseCandidate {
  id: string;
  title: string;
  schedule: string;
  credits?: number;
  section?: string;
  professor?: string;
  campus?: string;
  courseType?: string;
}

export interface TimetableConstraints {
  unavailableDays?: Weekday[];
  /** A course beginning before this minute of the day is excluded. */
  earliestStartMinutes?: number;
  /** Reserved time blocks (e.g. 알바) that every generated timetable must avoid. */
  fixedEvents?: FixedEvent[];
}

export interface Timetable {
  courses: CourseCandidate[];
  meetings: Meeting[];
  fixedEvents: FixedEvent[];
}

export class CombinationLimitError extends Error {
  constructor(limit: number) {
    super(`시간표 조합이 안전 한도 ${limit}개를 초과했습니다. 과목 후보나 제약을 더 좁혀 주세요.`);
    this.name = "CombinationLimitError";
  }
}

const DAY_BY_KOREAN_NAME: Record<string, Weekday> = {
  월: "mon",
  화: "tue",
  수: "wed",
  목: "thu",
  금: "fri",
  토: "sat",
  일: "sun",
};

const WEEKDAY_ORDER: readonly Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

const DEFAULT_MAX_COMBINATIONS = 500;

/** Parses the time portions of SKKU's GYOSI_NAME field into weekday meeting intervals. */
export function parseSchedule(schedule: string): Meeting[] {
  const meetings: Meeting[] = [];
  const timePattern = /([월화수목금토일])\s*(\d{1,2}):(\d{2})\s*[-~]\s*(\d{1,2}):(\d{2})/g;

  for (const match of schedule.matchAll(timePattern)) {
    const day = DAY_BY_KOREAN_NAME[match[1] ?? ""];
    const startMinutes = toMinutes(match[2], match[3]);
    const endMinutes = toMinutes(match[4], match[5]);
    if (day && startMinutes !== null && endMinutes !== null && startMinutes < endMinutes) {
      meetings.push({ day, startMinutes, endMinutes });
    }
  }

  return meetings;
}

export function meetingsConflict(first: Meeting, second: Meeting): boolean {
  return (
    first.day === second.day &&
    first.startMinutes < second.endMinutes &&
    second.startMinutes < first.endMinutes
  );
}

/** Merges one course's consecutive class periods into one visual block per day. */
export function mergeMeetingsForDisplay(
  meetings: readonly Meeting[],
  maxBreakMinutes = 15,
): Meeting[] {
  if (!Number.isInteger(maxBreakMinutes) || maxBreakMinutes < 0) {
    throw new RangeError("maxBreakMinutes는 0 이상의 정수여야 합니다.");
  }

  const sorted = [...meetings].sort((first, second) => {
    const dayDifference = WEEKDAY_ORDER.indexOf(first.day) - WEEKDAY_ORDER.indexOf(second.day);
    return dayDifference || first.startMinutes - second.startMinutes;
  });
  const merged: Meeting[] = [];

  for (const meeting of sorted) {
    const previous = merged.at(-1);
    if (
      previous &&
      previous.day === meeting.day &&
      meeting.startMinutes <= previous.endMinutes + maxBreakMinutes
    ) {
      previous.endMinutes = Math.max(previous.endMinutes, meeting.endMinutes);
    } else {
      merged.push({ ...meeting });
    }
  }

  return merged;
}

/**
 * Returns every valid choice of one course from each group without assigning a score or rank.
 *
 * `maxCombinations` is a safety guard, not a recommendation limit: if more valid timetables
 * exist, the function throws instead of silently returning an arbitrary top N subset.
 */
export function generateValidTimetables(
  courseGroups: CourseCandidate[][],
  constraints: TimetableConstraints = {},
  maxCombinations = DEFAULT_MAX_COMBINATIONS,
): Timetable[] {
  if (!Number.isInteger(maxCombinations) || maxCombinations < 1) {
    throw new RangeError("maxCombinations는 1 이상의 정수여야 합니다.");
  }

  const results: Timetable[] = [];
  const unavailableDays = new Set(constraints.unavailableDays);
  const fixedEvents = constraints.fixedEvents ?? [];

  function visit(groupIndex: number, selectedCourses: CourseCandidate[], selectedMeetings: Meeting[]): void {
    if (groupIndex === courseGroups.length) {
      if (results.length === maxCombinations) {
        throw new CombinationLimitError(maxCombinations);
      }
      results.push({ courses: selectedCourses, meetings: selectedMeetings, fixedEvents });
      return;
    }

    for (const course of courseGroups[groupIndex] ?? []) {
      const meetings = parseSchedule(course.schedule);
      if (violatesConstraints(meetings, unavailableDays, constraints.earliestStartMinutes)) {
        continue;
      }
      if (
        meetings.some(
          (meeting) =>
            selectedMeetings.some((chosen) => meetingsConflict(meeting, chosen)) ||
            fixedEvents.some((fixed) => meetingsConflict(meeting, fixed)),
        )
      ) {
        continue;
      }
      visit(groupIndex + 1, [...selectedCourses, course], [...selectedMeetings, ...meetings]);
    }
  }

  visit(0, [], []);
  return results;
}

function toMinutes(hourValue: string | undefined, minuteValue: string | undefined): number | null {
  const hour = Number(hourValue);
  const minute = Number(minuteValue);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour > 23 || minute > 59) {
    return null;
  }
  return hour * 60 + minute;
}

function violatesConstraints(
  meetings: Meeting[],
  unavailableDays: ReadonlySet<Weekday>,
  earliestStartMinutes: number | undefined,
): boolean {
  return meetings.some(
    (meeting) =>
      unavailableDays.has(meeting.day) ||
      (earliestStartMinutes !== undefined && meeting.startMinutes < earliestStartMinutes),
  );
}
