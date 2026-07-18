import { mergeMeetingsForDisplay, type Meeting, type Timetable, type Weekday } from "./timetable";

export type WeightId =
  | "free_days"
  | "back_to_back"
  | "lunch_break"
  | "avoid_9am"
  | "compact_days"
  | "prefer_in_person"
  | "prefer_online"
  | "minimize_daily_span";

export type WeightImportance = "low" | "medium" | "high";

export interface RecommendationWeight {
  id: WeightId;
  enabled: boolean;
  importance: WeightImportance;
  config?: {
    /** back_to_back 전용: 이 시간(분) 이상 이어지는 연강을 "긴 연강"으로 간주. 기본 180분(3시간). */
    thresholdMinutes?: number;
    /** back_to_back 전용: 긴 연강을 선호할지 기피할지. 기본 기피(avoid). */
    direction?: "prefer" | "avoid";
  };
}

export interface ScoreBreakdown {
  weightId: WeightId;
  rawValue: number;
  weightedScore: number;
}

export interface ScoredTimetable {
  candidateId: string;
  timetable: Timetable;
  totalScore: number;
  breakdown: ScoreBreakdown[];
}

export const WEEKDAYS: readonly Weekday[] = ["mon", "tue", "wed", "thu", "fri"];

const DEFAULT_BACK_TO_BACK_THRESHOLD_MINUTES = 180;
const LUNCH_WINDOW_START_MINUTES = 11 * 60;
const LUNCH_WINDOW_END_MINUTES = 13 * 60;
const LUNCH_DURATION_MINUTES = 60;
const NINE_AM_MINUTES = 9 * 60;

const IMPORTANCE_MULTIPLIER: Record<WeightImportance, number> = { low: 1, medium: 2, high: 3 };

export const DEFAULT_RECOMMENDATION_WEIGHTS: RecommendationWeight[] = [
  { id: "free_days", enabled: true, importance: "medium" },
  {
    id: "back_to_back",
    enabled: false,
    importance: "medium",
    config: { thresholdMinutes: DEFAULT_BACK_TO_BACK_THRESHOLD_MINUTES, direction: "avoid" },
  },
  { id: "lunch_break", enabled: true, importance: "medium" },
  { id: "avoid_9am", enabled: false, importance: "medium" },
  { id: "compact_days", enabled: false, importance: "low" },
  { id: "prefer_in_person", enabled: false, importance: "medium" },
  { id: "prefer_online", enabled: false, importance: "medium" },
  { id: "minimize_daily_span", enabled: false, importance: "low" },
];

/** Stable identity for a timetable candidate, independent of array order. */
export function getTimetableCandidateId(timetable: Timetable): string {
  return timetable.courses
    .map((course) => course.id)
    .sort()
    .join("|");
}

/**
 * Deterministically scores and ranks already-generated valid timetables against
 * user-selected soft preferences. Never generates or discards timetables itself —
 * that stays the job of `generateValidTimetables`/`generateTimetablesForSelectionPlan`.
 */
export function scoreTimetables(
  timetables: readonly Timetable[],
  weights: readonly RecommendationWeight[],
): ScoredTimetable[] {
  const enabledWeights = weights.filter((weight) => weight.enabled);
  if (enabledWeights.length === 0) {
    return timetables.map((timetable) => ({
      candidateId: getTimetableCandidateId(timetable),
      timetable,
      totalScore: 0,
      breakdown: [],
    }));
  }

  const rawMatrix = timetables.map((timetable) =>
    enabledWeights.map((weight) => computeRawValue(timetable, weight)),
  );
  const ranges = enabledWeights.map((_, weightIndex) => {
    const values = rawMatrix.map((row) => row[weightIndex] ?? 0);
    return { min: Math.min(...values), max: Math.max(...values) };
  });

  const scored = timetables.map((timetable, timetableIndex) => {
    const breakdown: ScoreBreakdown[] = enabledWeights.map((weight, weightIndex) => {
      const rawValue = rawMatrix[timetableIndex]?.[weightIndex] ?? 0;
      const range = ranges[weightIndex] ?? { min: 0, max: 0 };
      const normalized = normalize(rawValue, range.min, range.max);
      return {
        weightId: weight.id,
        rawValue,
        weightedScore: normalized * IMPORTANCE_MULTIPLIER[weight.importance],
      };
    });
    const totalScore = breakdown.reduce((sum, item) => sum + item.weightedScore, 0);
    return { candidateId: getTimetableCandidateId(timetable), timetable, totalScore, breakdown };
  });

  return scored.sort((a, b) => b.totalScore - a.totalScore);
}

/** Every metric is defined so that a higher raw value is always better. */
function computeRawValue(timetable: Timetable, weight: RecommendationWeight): number {
  switch (weight.id) {
    case "free_days":
      return countFreeDays(timetable);
    case "back_to_back":
      return backToBackScore(timetable, weight.config);
    case "lunch_break":
      return lunchBreakScore(timetable);
    case "avoid_9am":
      return -countNineAmMeetings(timetable);
    case "compact_days":
      return -countActiveDays(timetable);
    case "prefer_in_person":
      return countCoursesByFormat(timetable, false);
    case "prefer_online":
      return countCoursesByFormat(timetable, true);
    case "minimize_daily_span":
      return -totalDailySpanMinutes(timetable);
  }
}

function normalize(value: number, min: number, max: number): number {
  return max === min ? 0.5 : (value - min) / (max - min);
}

function activeDays(timetable: Timetable): ReadonlySet<Weekday> {
  return new Set(timetable.meetings.map((meeting) => meeting.day));
}

function countFreeDays(timetable: Timetable): number {
  const days = activeDays(timetable);
  return WEEKDAYS.filter((day) => !days.has(day)).length;
}

function countActiveDays(timetable: Timetable): number {
  return activeDays(timetable).size;
}

function countNineAmMeetings(timetable: Timetable): number {
  return timetable.meetings.filter((meeting) => meeting.startMinutes === NINE_AM_MINUTES).length;
}

function groupMeetingsByDay(meetings: readonly Meeting[]): Map<Weekday, Meeting[]> {
  const byDay = new Map<Weekday, Meeting[]>();
  for (const meeting of meetings) {
    const list = byDay.get(meeting.day) ?? [];
    list.push(meeting);
    byDay.set(meeting.day, list);
  }
  return byDay;
}

/** Merges each day's meetings into contiguous blocks, grouped by day. */
function mergedBlocksByDay(timetable: Timetable): Map<Weekday, Meeting[]> {
  return groupMeetingsByDay(mergeMeetingsForDisplay(timetable.meetings));
}

function backToBackScore(timetable: Timetable, config: RecommendationWeight["config"]): number {
  const thresholdMinutes = config?.thresholdMinutes ?? DEFAULT_BACK_TO_BACK_THRESHOLD_MINUTES;
  const direction = config?.direction ?? "avoid";
  let longRunCount = 0;
  for (const blocks of mergedBlocksByDay(timetable).values()) {
    for (const block of blocks) {
      if (block.endMinutes - block.startMinutes >= thresholdMinutes) {
        longRunCount += 1;
      }
    }
  }
  return direction === "prefer" ? longRunCount : -longRunCount;
}

function lunchBreakScore(timetable: Timetable): number {
  let goodDays = 0;
  let badDays = 0;
  for (const blocks of mergedBlocksByDay(timetable).values()) {
    if (blocks.length === 0) {
      continue;
    }
    if (hasFreeWindow(blocks, LUNCH_WINDOW_START_MINUTES, LUNCH_WINDOW_END_MINUTES, LUNCH_DURATION_MINUTES)) {
      goodDays += 1;
    } else {
      badDays += 1;
    }
  }
  return goodDays - badDays;
}

/** Whether a free gap of at least `minFreeMinutes` exists inside [windowStart, windowEnd). */
function hasFreeWindow(
  busyBlocks: readonly Meeting[],
  windowStart: number,
  windowEnd: number,
  minFreeMinutes: number,
): boolean {
  const sorted = [...busyBlocks].sort((first, second) => first.startMinutes - second.startMinutes);
  let cursor = windowStart;
  for (const block of sorted) {
    const start = Math.max(block.startMinutes, windowStart);
    const end = Math.min(block.endMinutes, windowEnd);
    if (start >= windowEnd) {
      break;
    }
    if (end <= start) {
      continue;
    }
    if (start - cursor >= minFreeMinutes) {
      return true;
    }
    cursor = Math.max(cursor, end);
  }
  return windowEnd - cursor >= minFreeMinutes;
}

function countCoursesByFormat(timetable: Timetable, online: boolean): number {
  return timetable.courses.filter((course) => {
    const label = course.courseType?.trim();
    return label ? label.includes("온라인") === online : false;
  }).length;
}

function totalDailySpanMinutes(timetable: Timetable): number {
  let total = 0;
  for (const meetings of groupMeetingsByDay(timetable.meetings).values()) {
    const start = Math.min(...meetings.map((meeting) => meeting.startMinutes));
    const end = Math.max(...meetings.map((meeting) => meeting.endMinutes));
    total += end - start;
  }
  return total;
}
