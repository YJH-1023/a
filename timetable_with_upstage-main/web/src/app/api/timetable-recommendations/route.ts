import type { CourseCandidate, Meeting, Timetable, Weekday } from "../../../lib/timetable";
import {
  DEFAULT_RECOMMENDATION_WEIGHTS,
  scoreTimetables,
  type RecommendationWeight,
  type ScoreBreakdown,
  type ScoredTimetable,
  type WeightId,
  type WeightImportance,
} from "../../../lib/timetable-scoring";
import { requestSolarCompletion } from "../../../lib/upstage";

type ApiErrorCode = "invalid_request";

const MAX_RECOMMENDATIONS = 8;
const MAX_TIMETABLES = 500;
const MAX_CUSTOM_PREFERENCE_CHARACTERS = 500;

const WEEKDAY_SET = new Set<Weekday>(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
const WEIGHT_ID_SET = new Set<WeightId>([
  "free_days",
  "back_to_back",
  "lunch_break",
  "avoid_9am",
  "compact_days",
  "prefer_in_person",
  "prefer_online",
  "minimize_daily_span",
]);
const IMPORTANCE_SET = new Set<WeightImportance>(["low", "medium", "high"]);

interface RequirementSummary {
  scope: string;
  label: string;
  status: string;
  remainingCredits: number | null;
}

interface TimetableRecommendationItem {
  candidateId: string;
  rank: number;
  timetable: Timetable;
  scoreBreakdown: ScoreBreakdown[];
  reason: string | null;
  requirementContribution: string | null;
  customPreferenceNote: string | null;
}

interface SolarExplanation {
  candidateId: string;
  rank: number | null;
  reason: string;
  requirementContribution: string | null;
  customPreferenceNote: string | null;
}

function errorResponse(status: number, code: ApiErrorCode, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

/**
 * Ranks already-generated valid timetables against user-selected soft preferences
 * (deterministic) and, when Upstage is configured, asks Solar to explain the top
 * candidates and how they contribute to unmet graduation requirements. Solar failures
 * degrade gracefully to the deterministic ranking — they never fail the whole request.
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "invalid_request", "JSON 본문이 필요합니다.");
  }
  if (!isRecord(body)) {
    return errorResponse(400, "invalid_request", "요청 형식이 올바르지 않습니다.");
  }

  const timetables = parseTimetables(body.timetables);
  if (!timetables) {
    return errorResponse(
      400,
      "invalid_request",
      `timetables는 1~${MAX_TIMETABLES}개의 유효한 시간표 배열이어야 합니다.`,
    );
  }
  const weights = parseWeights(body.weights);
  const unmetRequirements = parseRequirementSummaries(body.requirements).filter(
    (requirement) => requirement.status !== "satisfied",
  );
  const customPreference = parseCustomPreference(body.customPreference);

  const scored = scoreTimetables(timetables, weights).slice(0, MAX_RECOMMENDATIONS);

  const apiKey = process.env.UPSTAGE_API_KEY;
  if (!apiKey || scored.length === 0) {
    return Response.json({
      recommendations: toRecommendationList(scored),
      aiExplanationFailed: !apiKey && scored.length > 0,
    });
  }

  try {
    const explanations = await requestRecommendationExplanations(
      scored,
      unmetRequirements,
      customPreference,
      apiKey,
    );
    const ordered = customPreference
      ? (tryReorderByCustomPreference(scored, explanations) ?? scored)
      : scored;
    return Response.json({
      recommendations: applyExplanations(ordered, explanations),
      aiExplanationFailed: false,
    });
  } catch {
    return Response.json({
      recommendations: toRecommendationList(scored),
      aiExplanationFailed: true,
    });
  }
}

function toRecommendationList(scored: readonly ScoredTimetable[]): TimetableRecommendationItem[] {
  return scored.map((entry, index) => ({
    candidateId: entry.candidateId,
    rank: index + 1,
    timetable: entry.timetable,
    scoreBreakdown: entry.breakdown,
    reason: null,
    requirementContribution: null,
    customPreferenceNote: null,
  }));
}

function applyExplanations(
  scored: readonly ScoredTimetable[],
  explanations: readonly SolarExplanation[],
): TimetableRecommendationItem[] {
  const byId = new Map(explanations.map((item) => [item.candidateId, item]));
  return scored.map((entry, index) => {
    const explanation = byId.get(entry.candidateId);
    return {
      candidateId: entry.candidateId,
      rank: index + 1,
      timetable: entry.timetable,
      scoreBreakdown: entry.breakdown,
      reason: explanation?.reason ?? null,
      requirementContribution: explanation?.requirementContribution ?? null,
      customPreferenceNote: explanation?.customPreferenceNote ?? null,
    };
  });
}

/** Only reorders when Solar returned a rank for every candidate forming a clean 1..N permutation. */
function tryReorderByCustomPreference(
  scored: readonly ScoredTimetable[],
  explanations: readonly SolarExplanation[],
): ScoredTimetable[] | null {
  if (explanations.length !== scored.length) {
    return null;
  }
  const rankById = new Map(explanations.map((item) => [item.candidateId, item.rank]));
  const ranks = scored.map((entry) => rankById.get(entry.candidateId));
  if (ranks.some((rank) => rank === null || rank === undefined)) {
    return null;
  }
  const sortedRanks = [...(ranks as number[])].sort((a, b) => a - b);
  const isCleanPermutation = sortedRanks.every((rank, index) => rank === index + 1);
  if (!isCleanPermutation) {
    return null;
  }
  return [...scored].sort(
    (a, b) => (rankById.get(a.candidateId) ?? 0) - (rankById.get(b.candidateId) ?? 0),
  );
}

async function requestRecommendationExplanations(
  scored: readonly ScoredTimetable[],
  unmetRequirements: readonly RequirementSummary[],
  customPreference: string | undefined,
  apiKey: string,
): Promise<SolarExplanation[]> {
  const systemPrompt = [
    "당신은 성균관대 시간표 추천 서비스의 설명 엔진입니다.",
    "이미 결정론적으로 정렬된 시간표 후보 목록과 학생의 졸업요건 미충족 현황이 주어집니다.",
    "각 후보에 대해 한국어 2~3문장으로 추천 이유를 작성하세요.",
    "제공된 과목·요건 정보만 사용하고 존재하지 않는 사실을 지어내지 마세요.",
    "출력은 마크다운이나 다른 설명 없이 JSON 배열만 반환하세요.",
    '각 원소 형식: {"candidateId": string, "rank": number, "reason": string, "requirementContribution": string 또는 null, "customPreferenceNote": string 또는 null}',
    "rank는 1부터 후보 개수까지 각각 한 번씩만 사용하세요. customPreference가 없으면 입력 순서를 그대로 rank로 사용하세요.",
    "customPreference가 있으면 그 조건에 더 부합하는 후보일수록 낮은 rank(더 상위)를 부여하고, customPreferenceNote에 그 이유를 설명하세요. 없으면 customPreferenceNote는 null로 두세요.",
    "requirementContribution에는 미충족 졸업요건 중 이 후보가 어떤 영역에 도움이 되는지 설명하고, 해당사항이 없으면 null로 두세요.",
  ].join("\n");

  const userPrompt = JSON.stringify({
    candidates: scored.map((entry) => ({
      candidateId: entry.candidateId,
      courses: entry.timetable.courses.map((course) => ({
        title: course.title,
        professor: course.professor ?? null,
        schedule: course.schedule,
        courseType: course.courseType ?? null,
      })),
      scoreHighlights: entry.breakdown
        .filter((item) => item.weightedScore !== 0)
        .map((item) => ({ weight: item.weightId, weightedScore: item.weightedScore })),
    })),
    unmetRequirements,
    customPreference: customPreference ?? null,
  });

  const content = await requestSolarCompletion(systemPrompt, userPrompt, apiKey);
  return parseSolarExplanations(
    content,
    new Set(scored.map((entry) => entry.candidateId)),
  );
}

function parseSolarExplanations(
  content: string,
  validCandidateIds: ReadonlySet<string>,
): SolarExplanation[] {
  const trimmed = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const start = trimmed.indexOf("[");
  const end = trimmed.lastIndexOf("]");
  if (start < 0 || end < start) {
    throw new Error("solar_response_not_json_array");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    throw new Error("solar_response_invalid_json");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("solar_response_not_array");
  }

  const explanations: SolarExplanation[] = [];
  for (const entry of parsed) {
    if (
      !isRecord(entry) ||
      typeof entry.candidateId !== "string" ||
      !validCandidateIds.has(entry.candidateId) ||
      typeof entry.reason !== "string" ||
      !entry.reason.trim()
    ) {
      continue;
    }
    explanations.push({
      candidateId: entry.candidateId,
      rank: typeof entry.rank === "number" && Number.isInteger(entry.rank) ? entry.rank : null,
      reason: entry.reason.trim(),
      requirementContribution:
        typeof entry.requirementContribution === "string" && entry.requirementContribution.trim()
          ? entry.requirementContribution.trim()
          : null,
      customPreferenceNote:
        typeof entry.customPreferenceNote === "string" && entry.customPreferenceNote.trim()
          ? entry.customPreferenceNote.trim()
          : null,
    });
  }
  if (explanations.length === 0) {
    throw new Error("solar_response_empty");
  }
  return explanations;
}

function parseTimetables(value: unknown): Timetable[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_TIMETABLES) {
    return null;
  }
  const timetables: Timetable[] = [];
  for (const entry of value) {
    const timetable = parseTimetable(entry);
    if (!timetable) {
      return null;
    }
    timetables.push(timetable);
  }
  return timetables;
}

function parseTimetable(value: unknown): Timetable | null {
  if (!isRecord(value) || !Array.isArray(value.courses) || !Array.isArray(value.meetings)) {
    return null;
  }
  const courses: CourseCandidate[] = [];
  for (const courseValue of value.courses) {
    const course = parseCourseCandidate(courseValue);
    if (!course) {
      return null;
    }
    courses.push(course);
  }
  if (courses.length === 0) {
    return null;
  }
  const meetings: Meeting[] = [];
  for (const meetingValue of value.meetings) {
    const meeting = parseMeeting(meetingValue);
    if (!meeting) {
      return null;
    }
    meetings.push(meeting);
  }
  // Fixed events (알바 등) don't affect scoring/explanation, so they're not part of this wire format.
  return { courses, meetings, fixedEvents: [] };
}

function parseCourseCandidate(value: unknown): CourseCandidate | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.title !== "string" ||
    typeof value.schedule !== "string"
  ) {
    return null;
  }
  return {
    id: value.id,
    title: value.title,
    schedule: value.schedule,
    credits: typeof value.credits === "number" ? value.credits : undefined,
    section: typeof value.section === "string" ? value.section : undefined,
    professor: typeof value.professor === "string" ? value.professor : undefined,
    campus: typeof value.campus === "string" ? value.campus : undefined,
    courseType: typeof value.courseType === "string" ? value.courseType : undefined,
  };
}

function parseMeeting(value: unknown): Meeting | null {
  if (
    !isRecord(value) ||
    typeof value.day !== "string" ||
    !WEEKDAY_SET.has(value.day as Weekday) ||
    typeof value.startMinutes !== "number" ||
    typeof value.endMinutes !== "number"
  ) {
    return null;
  }
  return { day: value.day as Weekday, startMinutes: value.startMinutes, endMinutes: value.endMinutes };
}

function parseWeights(value: unknown): RecommendationWeight[] {
  if (!Array.isArray(value)) {
    return DEFAULT_RECOMMENDATION_WEIGHTS;
  }
  const weights: RecommendationWeight[] = [];
  for (const entry of value) {
    if (
      !isRecord(entry) ||
      typeof entry.id !== "string" ||
      !WEIGHT_ID_SET.has(entry.id as WeightId) ||
      typeof entry.enabled !== "boolean" ||
      typeof entry.importance !== "string" ||
      !IMPORTANCE_SET.has(entry.importance as WeightImportance)
    ) {
      continue;
    }
    weights.push({
      id: entry.id as WeightId,
      enabled: entry.enabled,
      importance: entry.importance as WeightImportance,
      config: parseWeightConfig(entry.config),
    });
  }
  return weights.length > 0 ? weights : DEFAULT_RECOMMENDATION_WEIGHTS;
}

function parseWeightConfig(value: unknown): RecommendationWeight["config"] {
  if (!isRecord(value)) {
    return undefined;
  }
  const thresholdMinutes = typeof value.thresholdMinutes === "number" ? value.thresholdMinutes : undefined;
  const direction = value.direction === "prefer" || value.direction === "avoid" ? value.direction : undefined;
  return thresholdMinutes === undefined && direction === undefined
    ? undefined
    : { thresholdMinutes, direction };
}

function parseRequirementSummaries(value: unknown): RequirementSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const summaries: RequirementSummary[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.label !== "string" || typeof entry.status !== "string") {
      continue;
    }
    summaries.push({
      scope: typeof entry.scope === "string" ? entry.scope : "other",
      label: entry.label,
      status: entry.status,
      remainingCredits: typeof entry.remainingCredits === "number" ? entry.remainingCredits : null,
    });
  }
  return summaries;
}

function parseCustomPreference(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim().slice(0, MAX_CUSTOM_PREFERENCE_CHARACTERS);
  return trimmed || undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
