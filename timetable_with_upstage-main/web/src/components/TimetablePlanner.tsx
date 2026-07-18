"use client";

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import type { Requirement } from "@/lib/academic-profile";
import { selectAiFillerSubjects } from "@/lib/ai-filler-selection";
import { markSessionCompleted, track } from "@/lib/analytics";
import { getRoadmapMatch, type CurriculumRoadmap, type RoadmapContext } from "@/lib/curriculum-roadmap";
import {
  courseGroupsFromCollection,
  shouldShowSectionDetails,
  type CourseCandidateGroup,
} from "@/lib/course-candidates";
import {
  SKKU_ELECTIVE_AREA_DEFINITIONS,
  type SkkuCourseQuery,
  type SkkuElectiveArea,
  type SkkuElectiveAreaCode,
  type SkkuElectiveCampus,
  type SkkuElectiveSubject,
} from "@/lib/skku-course-api";
import {
  generateTimetablesForSelectionPlan,
  getInitialSectionIds,
  removeSubjectsOwnedBy,
  SelectionPlanError,
  SelectionPlanLimitError,
  toggleEnabledSectionId,
  type ChoiceBag,
  type SubjectOption,
} from "@/lib/selection-plan";
import {
  CombinationLimitError,
  meetingsConflict,
  type CourseCandidate,
  type FixedEvent,
  type Timetable,
  type Weekday,
} from "@/lib/timetable";
import {
  DEFAULT_RECOMMENDATION_WEIGHTS,
  getTimetableCandidateId,
  type RecommendationWeight,
  type ScoreBreakdown,
  type WeightId,
  type WeightImportance,
} from "@/lib/timetable-scoring";

import { DAYS, formatCredits, formatMinutes, TimetableCard, type TimetableExtra } from "./TimetableCard";
import styles from "./TimetablePlanner.module.css";

interface Props {
  query: SkkuCourseQuery | null;
  queryLabel: string;
  excludedCourseNumbers: readonly string[];
  requirements: readonly Requirement[];
  curriculumRoadmap: CurriculumRoadmap | null;
  roadmapContext: RoadmapContext | null;
}

const WEIGHT_LABELS: Record<WeightId, string> = {
  free_days: "공강 요일 만들기",
  back_to_back: "연강 선호/기피",
  lunch_break: "점심시간(11~13시) 확보",
  avoid_9am: "오전 9시 수업 회피",
  compact_days: "수업일수 최소화",
  prefer_in_person: "대면 수업 선호",
  prefer_online: "온라인 수업 선호",
  minimize_daily_span: "하루 재학시간 최소화",
};

interface TimetableRecommendationItem {
  candidateId: string;
  rank: number;
  timetable: Timetable;
  scoreBreakdown: ScoreBreakdown[];
  reason: string | null;
  requirementContribution: string | null;
  customPreferenceNote: string | null;
}

const START_OPTIONS = [
  { value: "", label: "상관없음" },
  { value: "600", label: "10:00 이후" },
  { value: "720", label: "12:00 이후" },
] as const;

type CourseSource = "major" | "elective";

interface PlannerCourseGroup extends CourseCandidateGroup {
  selectionId: string;
  source: CourseSource;
  campus?: SkkuElectiveCampus;
}

interface ElectiveCatalog {
  areas: SkkuElectiveArea[];
  subjects: SkkuElectiveSubject[];
}

interface ChoiceGroupConfig {
  id: string;
  title: string;
  minSubjects: number;
  maxSubjects: number;
}

type CourseDestination = "required" | string;

const INITIAL_CHOICE_GROUPS: ChoiceGroupConfig[] = [
  { id: "choice-1", title: "선택 그룹 1", minSubjects: 1, maxSubjects: 1 },
];

const CAMPUS_OPTIONS: ReadonlyArray<{
  value: SkkuElectiveCampus;
  label: string;
  shortLabel: string;
}> = [
  { value: 1, label: "인문사회과학캠퍼스", shortLabel: "인사캠" },
  { value: 2, label: "자연과학캠퍼스", shortLabel: "자과캠" },
  { value: 3, label: "I-CAMPUS", shortLabel: "I-CAMPUS" },
];

const ELECTIVE_PREVIEW_CONCURRENCY = 3;

function createElectivePreviewLanes(): Promise<void>[] {
  return Array.from({ length: ELECTIVE_PREVIEW_CONCURRENCY }, () => Promise.resolve());
}

/** How many extra elective subjects the AI recommendation step may consider/add as filler. */
const MAX_FILLER_SHORTLIST = 8;
const MAX_FILLER_SUBJECTS = 5;
const AI_FILLER_BAG_ID = "ai-filler";
const AI_FILLER_GROUP_TITLE = "AI 추천 보충 교양";

export function TimetablePlanner({ query, queryLabel, excludedCourseNumbers, requirements, curriculumRoadmap, roadmapContext }: Props) {
  const [majorCourseGroups, setMajorCourseGroups] = useState<CourseCandidateGroup[]>([]);
  const [electiveCourseGroups, setElectiveCourseGroups] = useState<PlannerCourseGroup[]>([]);
  const [electivePreviewGroups, setElectivePreviewGroups] = useState<
    Record<string, PlannerCourseGroup>
  >({});
  const [electiveCatalogs, setElectiveCatalogs] = useState<Record<string, ElectiveCatalog>>({});
  const [electiveCampus, setElectiveCampus] = useState<SkkuElectiveCampus>(1);
  const [selectedElectiveArea, setSelectedElectiveArea] = useState<
    SkkuElectiveAreaCode | "all"
  >("all");
  const [courseSource, setCourseSource] = useState<CourseSource>("major");
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [choiceGroups, setChoiceGroups] = useState<ChoiceGroupConfig[]>(INITIAL_CHOICE_GROUPS);
  const [activeDestination, setActiveDestination] = useState<CourseDestination>("required");
  const [courseOwners, setCourseOwners] = useState<Record<string, CourseDestination>>({});
  const [enabledSectionIds, setEnabledSectionIds] = useState<Record<string, string[]>>({});
  const [unavailableDays, setUnavailableDays] = useState<Weekday[]>([]);
  const [earliestStart, setEarliestStart] = useState("");
  const [fixedEvents, setFixedEvents] = useState<FixedEvent[]>([]);
  const [newEventLabel, setNewEventLabel] = useState("");
  const [newEventDay, setNewEventDay] = useState<Weekday>("mon");
  const [newEventStart, setNewEventStart] = useState("18:00");
  const [newEventEnd, setNewEventEnd] = useState("20:00");
  const [fixedEventError, setFixedEventError] = useState("");
  const [minimumCredits, setMinimumCredits] = useState("12");
  const [maximumCredits, setMaximumCredits] = useState("21");
  const [disabledCourseTypes, setDisabledCourseTypes] = useState<Set<string>>(new Set());
  const [dayOffFilters, setDayOffFilters] = useState<Weekday[]>([]);
  const [courseSearch, setCourseSearch] = useState("");
  const [collectionError, setCollectionError] = useState("");
  const [electiveError, setElectiveError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isElectiveLoading, setIsElectiveLoading] = useState(false);
  const [loadingCourseNumbers, setLoadingCourseNumbers] = useState<string[]>([]);
  const [previewLoadingIds, setPreviewLoadingIds] = useState<string[]>([]);
  const nextChoiceGroupId = useRef(2);
  const electivePreviewRequestIds = useRef(new Set<string>());
  const electivePreviewLanes = useRef<Promise<void>[]>(createElectivePreviewLanes());
  const electivePreviewLaneCursor = useRef(0);
  const electivePreviewGeneration = useRef(0);
  const electivePrefetchAttempted = useRef(new Set<string>());

  useEffect(() => {
    if (!query) {
      return;
    }
    const activeQuery = query;
    electivePreviewGeneration.current += 1;
    electivePreviewRequestIds.current.clear();
    electivePreviewLanes.current = createElectivePreviewLanes();
    electivePreviewLaneCursor.current = 0;
    const controller = new AbortController();
    async function loadCourses(): Promise<void> {
      setIsLoading(true);
      setCollectionError("");
      setElectiveError("");
      setMajorCourseGroups([]);
      setElectiveCourseGroups([]);
      setElectivePreviewGroups({});
      setElectiveCatalogs({});
      setElectiveCampus(activeQuery.campus);
      setSelectedElectiveArea("all");
      setCourseSource("major");
      setSelectedGroupIds([]);
      setChoiceGroups(INITIAL_CHOICE_GROUPS);
      setActiveDestination("required");
      setCourseOwners({});
      setEnabledSectionIds({});
      setPreviewLoadingIds([]);
      setDisabledCourseTypes(new Set());
      setDayOffFilters([]);
      nextChoiceGroupId.current = 2;
      try {
        const majorResult = await postJson("/api/skku-courses", activeQuery, controller.signal);
        setMajorCourseGroups(courseGroupsFromCollection(majorResult));
      } catch (error) {
        if (isAbortError(error)) {
          return;
        }
        setCollectionError(readThrownMessage(error));
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }
    void loadCourses();
    return () => controller.abort();
  }, [query]);

  /**
   * The elective catalog fetch is slow on a cold cache (session login + up to 14 sequential
   * SKKU requests, ~10s) — see cache-store.ts. Firing it silently in the background as soon as
   * the department/year query is known, instead of waiting for the user to click the "교양"
   * tab, means the server-side TTL cache is usually already warm by the time they do, so the
   * on-demand fetch in loadAllElectives resolves instantly. Errors are swallowed here on purpose:
   * this is a best-effort head start, not a user-facing action, and loadAllElectives still runs
   * (and shows a visible error) whenever the user actually opens the tab.
   */
  useEffect(() => {
    if (!query) {
      return;
    }
    const activeQuery = query;
    CAMPUS_OPTIONS.forEach(({ value: campus }) => {
      const catalogKey = getElectiveCatalogKey(activeQuery, campus);
      if (electivePrefetchAttempted.current.has(catalogKey)) {
        return;
      }
      electivePrefetchAttempted.current.add(catalogKey);
      void (async () => {
        try {
          const payload = await postJson("/api/skku-electives", {
            year: activeQuery.year,
            term: activeQuery.term,
            campus,
            mode: "all_subjects",
          });
          const catalog = readElectiveCatalog(payload);
          setElectiveCatalogs((catalogs) =>
            catalogs[catalogKey] ? catalogs : { ...catalogs, [catalogKey]: catalog },
          );
        } catch {
          // Best-effort prefetch; loadAllElectives retries on demand and surfaces errors there.
        }
      })();
    });
  }, [query]);

  function selectCourseGroup(
    group: PlannerCourseGroup,
    destination = activeDestination,
    initialSectionIds = getInitialSectionIds(group.candidates),
  ): void {
    setSelectedGroupIds((ids) => [...new Set([...ids, group.selectionId])]);
    setCourseOwners((owners) => ({ ...owners, [group.selectionId]: destination }));
    setEnabledSectionIds((sections) => ({
      ...sections,
      [group.selectionId]: initialSectionIds,
    }));
  }

  function clearSelectedCourse(selectionId: string): void {
    setSelectedGroupIds((ids) => ids.filter((id) => id !== selectionId));
    setCourseOwners((owners) => {
      const next = { ...owners };
      delete next[selectionId];
      return next;
    });
    setEnabledSectionIds((sections) => {
      const next = { ...sections };
      delete next[selectionId];
      return next;
    });
  }

  function removeSelectedCourse(group: PlannerCourseGroup): void {
    clearSelectedCourse(group.selectionId);
    if (group.source === "elective") {
      setElectiveCourseGroups((groups) =>
        groups.filter(({ selectionId }) => selectionId !== group.selectionId),
      );
    }
  }

  /**
   * A course can only belong to one destination at a time. The catalog checkbox reflects
   * membership in the *currently active* destination, not "selected anywhere" — otherwise a
   * course assigned to 필수 still looks checked while browsing 선택 그룹 1, even though it isn't
   * actually in that group.
   */
  function isAssignedToActiveDestination(selectionId: string): boolean {
    return (
      selectedGroupIds.includes(selectionId) &&
      (courseOwners[selectionId] ?? "required") === activeDestination
    );
  }

  function toggleMajorCourseGroup(group: PlannerCourseGroup): void {
    if (isAssignedToActiveDestination(group.selectionId)) {
      removeSelectedCourse(group);
    } else {
      selectCourseGroup(group, activeDestination, enabledSectionIds[group.selectionId]);
    }
  }

  function addChoiceGroup(): void {
    const number = nextChoiceGroupId.current;
    nextChoiceGroupId.current += 1;
    const group = {
      id: `choice-${number}`,
      title: `선택 그룹 ${number}`,
      minSubjects: 1,
      maxSubjects: 1,
    };
    setChoiceGroups((groups) => [...groups, group]);
    setActiveDestination(group.id);
  }

  function removeChoiceGroup(groupId: string): void {
    const nextAssignment = removeSubjectsOwnedBy(
      {
        selectedIds: selectedGroupIds,
        owners: courseOwners,
        enabledSectionIds,
      },
      groupId,
    );
    const removedSelectionIds = new Set(nextAssignment.removedIds);
    setChoiceGroups((groups) => groups.filter(({ id }) => id !== groupId));
    setSelectedGroupIds(nextAssignment.selectedIds);
    setCourseOwners(nextAssignment.owners);
    setEnabledSectionIds(nextAssignment.enabledSectionIds);
    setElectiveCourseGroups((groups) =>
      groups.filter(({ selectionId }) => !removedSelectionIds.has(selectionId)),
    );
    if (activeDestination === groupId) {
      setActiveDestination("required");
    }
  }

  function updateChoiceGroup(
    groupId: string,
    update: Partial<Omit<ChoiceGroupConfig, "id">>,
  ): void {
    setChoiceGroups((groups) =>
      groups.map((group) => (group.id === groupId ? { ...group, ...update } : group)),
    );
  }

  function toggleSection(group: PlannerCourseGroup, sectionId: string): void {
    setEnabledSectionIds((sections) => {
      const current = sections[group.selectionId] ?? getInitialSectionIds(group.candidates);
      return {
        ...sections,
        [group.selectionId]: toggleEnabledSectionId(current, sectionId),
      };
    });
  }

  function toggleCatalogSection(group: PlannerCourseGroup, sectionId: string): void {
    if (isAssignedToActiveDestination(group.selectionId)) {
      toggleSection(group, sectionId);
      return;
    }
    if (group.source === "elective") {
      setElectiveCourseGroups((groups) =>
        groups.some(({ selectionId }) => selectionId === group.selectionId)
          ? groups
          : [...groups, group],
      );
    }
    selectCourseGroup(group, activeDestination, [sectionId]);
  }

  async function loadAllElectives(campus: SkkuElectiveCampus): Promise<void> {
    if (!query) {
      return;
    }
    const catalogKey = getElectiveCatalogKey(query, campus);
    if (electiveCatalogs[catalogKey]) {
      return;
    }
    setElectiveError("");
    setIsElectiveLoading(true);
    try {
      const payload = await postJson("/api/skku-electives", {
        year: query.year,
        term: query.term,
        campus,
        mode: "all_subjects",
      });
      setElectiveCatalogs((catalogs) => ({
        ...catalogs,
        [catalogKey]: readElectiveCatalog(payload),
      }));
    } catch (error) {
      setElectiveError(readThrownMessage(error));
    } finally {
      setIsElectiveLoading(false);
    }
  }

  function preloadElectiveSubject(
    subject: SkkuElectiveSubject,
    campus: SkkuElectiveCampus,
  ): void {
    if (!query) {
      return;
    }
    const selectionId = getElectiveSelectionId(campus, subject.courseNumber);
    if (
      electivePreviewGroups[selectionId] ||
      electivePreviewRequestIds.current.has(selectionId)
    ) {
      return;
    }

    const activeQuery = query;
    const generation = electivePreviewGeneration.current;
    electivePreviewRequestIds.current.add(selectionId);
    setPreviewLoadingIds((ids) => [...new Set([...ids, selectionId])]);

    const loadPreview = async (): Promise<void> => {
      try {
        const group = await fetchElectivePlannerGroup(activeQuery, campus, subject);
        if (electivePreviewGeneration.current === generation) {
          setElectivePreviewGroups((groups) => ({ ...groups, [selectionId]: group }));
        }
      } catch {
        // Preview failure must not block normal selection, which retries with a visible error.
      } finally {
        if (electivePreviewGeneration.current === generation) {
          electivePreviewRequestIds.current.delete(selectionId);
          setPreviewLoadingIds((ids) => ids.filter((id) => id !== selectionId));
        }
      }
    };
    const laneIndex = electivePreviewLaneCursor.current % electivePreviewLanes.current.length;
    electivePreviewLaneCursor.current += 1;
    electivePreviewLanes.current[laneIndex] = electivePreviewLanes.current[laneIndex].then(
      loadPreview,
      loadPreview,
    );
  }

  async function toggleElectiveSubject(subject: SkkuElectiveSubject): Promise<void> {
    const campus = electiveCampus;
    const selectionId = getElectiveSelectionId(campus, subject.courseNumber);
    const existing = electiveCourseGroups.find((group) => group.selectionId === selectionId);
    if (existing) {
      if (isAssignedToActiveDestination(selectionId)) {
        removeSelectedCourse(existing);
      } else {
        selectCourseGroup(existing, activeDestination, enabledSectionIds[selectionId]);
      }
      return;
    }
    if (!query || loadingCourseNumbers.includes(selectionId)) {
      return;
    }
    const previewGroup = electivePreviewGroups[selectionId];
    if (previewGroup) {
      setElectiveCourseGroups((groups) => [...groups, previewGroup]);
      selectCourseGroup(previewGroup);
      return;
    }
    setLoadingCourseNumbers((numbers) => [...numbers, selectionId]);
    setElectiveError("");
    const destination = activeDestination;
    try {
      const scopedGroup = await fetchElectivePlannerGroup(query, campus, subject);
      setElectivePreviewGroups((groups) => ({ ...groups, [selectionId]: scopedGroup }));
      setElectiveCourseGroups((groups) => [...groups, scopedGroup]);
      selectCourseGroup(scopedGroup, destination);
    } catch (error) {
      setElectiveError(readThrownMessage(error));
    } finally {
      setLoadingCourseNumbers((numbers) =>
        numbers.filter((courseNumber) => courseNumber !== selectionId),
      );
    }
  }

  const electiveCatalogKey = query ? getElectiveCatalogKey(query, electiveCampus) : "";
  const electiveCatalog = electiveCatalogs[electiveCatalogKey];
  const electiveAreas = useMemo(() => electiveCatalog?.areas ?? [], [electiveCatalog]);
  const electiveSubjects = useMemo(() => electiveCatalog?.subjects ?? [], [electiveCatalog]);

  const excludedCourseSet = useMemo(
    () => new Set(excludedCourseNumbers.map((courseNumber) => courseNumber.trim().toUpperCase())),
    [excludedCourseNumbers],
  );
  const courseGroups = useMemo(
    (): PlannerCourseGroup[] => [
      ...majorCourseGroups.map((group) => ({
        ...group,
        selectionId: `major:${group.id}`,
        source: "major" as const,
      })),
      ...electiveCourseGroups,
    ],
    [electiveCourseGroups, majorCourseGroups],
  );
  const availableCourseGroups = useMemo(
    () => courseGroups.filter((group) => !excludedCourseSet.has(group.id.trim().toUpperCase())),
    [courseGroups, excludedCourseSet],
  );
  const availableCourseTypes = useMemo(() => {
    const labels = new Set<string>();
    for (const group of availableCourseGroups) {
      for (const candidate of group.candidates) {
        labels.add(getCourseTypeLabel(candidate));
      }
    }
    return [...labels].sort((first, second) => first.localeCompare(second, "ko"));
  }, [availableCourseGroups]);
  function toggleCourseType(label: string): void {
    setDisabledCourseTypes((current) => {
      const next = new Set(current);
      if (next.has(label)) {
        next.delete(label);
      } else {
        next.add(label);
      }
      return next;
    });
  }
  function addFixedEvent(): void {
    const label = newEventLabel.trim();
    if (!label) {
      setFixedEventError("일정 이름을 입력해 주세요.");
      return;
    }
    const startMinutes = parseTimeInputToMinutes(newEventStart);
    const endMinutes = parseTimeInputToMinutes(newEventEnd);
    if (startMinutes === null || endMinutes === null || startMinutes >= endMinutes) {
      setFixedEventError("시작 시각이 종료 시각보다 빨라야 합니다.");
      return;
    }
    const candidate: FixedEvent = {
      id: `fixed-${Date.now()}-${Math.round(Math.random() * 1000)}`,
      label,
      day: newEventDay,
      startMinutes,
      endMinutes,
    };
    if (fixedEvents.some((event) => meetingsConflict(event, candidate))) {
      setFixedEventError("이미 등록한 다른 고정 일정과 시간이 겹칩니다.");
      return;
    }
    setFixedEvents((current) => [...current, candidate]);
    setNewEventLabel("");
    setFixedEventError("");
  }
  function removeFixedEvent(id: string): void {
    setFixedEvents((current) => current.filter((event) => event.id !== id));
  }
  /**
   * Format filtering happens here, while picking courses — not on already-generated timetables.
   * A course whose every section is filtered out simply disappears from the catalog; sections
   * already chosen for it drop out of the plan the same way excluded (기수강) courses do.
   */
  const formatFilteredCourseGroups = useMemo(
    () =>
      availableCourseGroups
        .map((group) => filterGroupCandidatesByFormat(group, disabledCourseTypes))
        .filter((group) => group.candidates.length > 0),
    [availableCourseGroups, disabledCourseTypes],
  );
  const visibleCourseGroups = useMemo(() => {
    const keyword = courseSearch.trim().toLowerCase();
    if (!keyword) {
      return formatFilteredCourseGroups;
    }
    return formatFilteredCourseGroups.filter((group) =>
      `${group.id} ${group.title} ${group.classification}`.toLowerCase().includes(keyword),
    );
  }, [courseSearch, formatFilteredCourseGroups]);
  const visibleMajorCourseGroups = useMemo(
    () => visibleCourseGroups.filter((group) => group.source === "major"),
    [visibleCourseGroups],
  );
  const visibleElectiveSubjects = useMemo(() => {
    const availableSubjects = electiveSubjects.filter(
      (subject) =>
        !excludedCourseSet.has(subject.courseNumber.trim().toUpperCase()) &&
        (selectedElectiveArea === "all" || subject.areaCode === selectedElectiveArea),
    );
    const keyword = courseSearch.trim().toLowerCase();
    if (!keyword) {
      return availableSubjects;
    }
    return availableSubjects.filter((subject) =>
      `${subject.courseNumber} ${subject.name}`.toLowerCase().includes(keyword),
    );
  }, [courseSearch, electiveSubjects, excludedCourseSet, selectedElectiveArea]);
  const electiveAreaLabels = useMemo(
    () => new Map(electiveAreas.map((area) => [area.code, area.label])),
    [electiveAreas],
  );
  const selectedElectiveAreaLabel = selectedElectiveArea === "all"
    ? "전체 교양"
    : electiveAreaLabels.get(selectedElectiveArea) ?? "선택 영역";
  // Deliberately NOT format-filtered: the format filter narrows what's browsable in the catalog
  // (formatFilteredCourseGroups), but a course the user already added to the plan must stay in
  // the plan even if they later hide its format while searching for something else.
  const effectiveSelectedGroupIds = useMemo(() => {
    const availableIds = new Set(availableCourseGroups.map((group) => group.selectionId));
    return selectedGroupIds.filter((id) => availableIds.has(id));
  }, [availableCourseGroups, selectedGroupIds]);
  const selectedCourseGroups = useMemo(
    () =>
      availableCourseGroups.filter(({ selectionId }) =>
        effectiveSelectedGroupIds.includes(selectionId),
      ),
    [availableCourseGroups, effectiveSelectedGroupIds],
  );
  const choiceGroupSubjectCounts = useMemo(
    () =>
      new Map(
        choiceGroups.map((choiceGroup) => [
          choiceGroup.id,
          selectedCourseGroups.filter(
            ({ selectionId }) => courseOwners[selectionId] === choiceGroup.id,
          ).length,
        ]),
      ),
    [choiceGroups, courseOwners, selectedCourseGroups],
  );

  const sectionIdToGroup = useMemo(() => {
    const map = new Map<string, PlannerCourseGroup>();
    for (const group of selectedCourseGroups) {
      for (const candidate of group.candidates) {
        map.set(candidate.id, group);
      }
    }
    return map;
  }, [selectedCourseGroups]);

  const manualSelectionPlanSubjects = useMemo(() => {
    const choiceGroupIds = new Set(choiceGroups.map(({ id }) => id));
    const requiredSubjects: SubjectOption[] = [];
    const choiceSubjects = new Map<string, SubjectOption[]>(
      choiceGroups.map(({ id }) => [id, []]),
    );
    for (const group of selectedCourseGroups) {
      const enabledIds = new Set(
        enabledSectionIds[group.selectionId] ?? getInitialSectionIds(group.candidates),
      );
      const subject = {
        id: group.selectionId,
        title: group.title,
        credits: group.credits,
        sections: group.candidates.filter((candidate) => enabledIds.has(candidate.id)),
      };
      const owner = courseOwners[group.selectionId] ?? "required";
      if (owner === "required" || !choiceGroupIds.has(owner)) {
        requiredSubjects.push(subject);
      } else {
        choiceSubjects.get(owner)?.push(subject);
      }
    }
    const choiceBags: ChoiceBag[] = choiceGroups.flatMap((choiceGroup) => {
      const subjects = choiceSubjects.get(choiceGroup.id) ?? [];
      return subjects.length > 0 ? [{ ...choiceGroup, subjects }] : [];
    });
    return { requiredSubjects, choiceBags };
  }, [choiceGroups, courseOwners, enabledSectionIds, selectedCourseGroups]);

  const result = useMemo(() => {
    if (selectedCourseGroups.length === 0) {
      return { entries: [], error: null };
    }
    try {
      const timetables = generateTimetablesForSelectionPlan(
        {
          requiredSubjects: manualSelectionPlanSubjects.requiredSubjects,
          choiceBags: manualSelectionPlanSubjects.choiceBags,
          creditRange: {
            minCredits: minimumCredits === "" ? Number.NaN : Number(minimumCredits),
            maxCredits: maximumCredits === "" ? Number.NaN : Number(maximumCredits),
          },
        },
        {
          unavailableDays,
          earliestStartMinutes: earliestStart ? Number(earliestStart) : undefined,
          fixedEvents,
        },
      );

      return {
        entries: timetables.map((timetable, index) => ({
          index,
          timetable,
          extras: describeTimetableExtras(timetable, sectionIdToGroup, courseOwners, choiceGroups),
        })),
        error: null,
      };
    } catch (error) {
      return {
        entries: [],
        error:
          error instanceof CombinationLimitError ||
          error instanceof SelectionPlanError ||
          error instanceof SelectionPlanLimitError
            ? error.message
            : "시간표 조합을 만드는 중 오류가 발생했습니다.",
      };
    }
  }, [
    choiceGroups,
    courseOwners,
    earliestStart,
    fixedEvents,
    manualSelectionPlanSubjects,
    maximumCredits,
    minimumCredits,
    sectionIdToGroup,
    selectedCourseGroups,
    unavailableDays,
  ]);

  const dayOffOptions = useMemo(() => {
    const total = result.entries.length;
    return DAYS.filter(({ id }) => {
      const freeCount = result.entries.filter(({ timetable }) => isDayFree(timetable, id)).length;
      return freeCount > 0 && freeCount < total;
    });
  }, [result.entries]);

  const filteredEntries = useMemo(() => {
    if (dayOffFilters.length === 0) {
      return result.entries;
    }
    return result.entries.filter(({ timetable }) =>
      dayOffFilters.every((day) => isDayFree(timetable, day)),
    );
  }, [dayOffFilters, result.entries]);

  const [recommendationWeights, setRecommendationWeights] = useState<RecommendationWeight[]>(
    DEFAULT_RECOMMENDATION_WEIGHTS,
  );
  const [customPreference, setCustomPreference] = useState("");
  const [recommendations, setRecommendations] = useState<TimetableRecommendationItem[] | null>(
    null,
  );
  const [aiCandidateTimetables, setAiCandidateTimetables] = useState<
    ReadonlyMap<string, { timetable: Timetable; extras: TimetableExtra[] }>
  >(new Map());
  const [isRecommending, setIsRecommending] = useState(false);
  const [recommendationError, setRecommendationError] = useState("");
  const [aiExplanationFailed, setAiExplanationFailed] = useState(false);

  const timetableListShownFired = useRef(false);
  useEffect(() => {
    if (timetableListShownFired.current || filteredEntries.length === 0) {
      return;
    }
    const timer = setTimeout(() => {
      timetableListShownFired.current = true;
      track("timetable_list_shown");
      markSessionCompleted();
    }, 3000);
    return () => clearTimeout(timer);
  }, [filteredEntries.length]);

  const aiRecommendShownFired = useRef(false);
  useEffect(() => {
    if (aiRecommendShownFired.current || !recommendations || recommendations.length === 0) {
      return;
    }
    const timer = setTimeout(() => {
      aiRecommendShownFired.current = true;
      track("ai_recommend_shown");
      markSessionCompleted();
    }, 3000);
    return () => clearTimeout(timer);
  }, [recommendations]);

  const [previousManualPlanSubjects, setPreviousManualPlanSubjects] = useState(
    manualSelectionPlanSubjects,
  );
  if (previousManualPlanSubjects !== manualSelectionPlanSubjects) {
    setPreviousManualPlanSubjects(manualSelectionPlanSubjects);
    setRecommendations(null);
    setRecommendationError("");
    setAiCandidateTimetables(new Map());
  }

  function toggleRecommendationWeight(id: WeightId): void {
    track("weight_adjust", { weight_type: id });
    setRecommendationWeights((weights) => {
      const nextEnabled = !(weights.find((weight) => weight.id === id)?.enabled ?? false);
      return weights.map((weight) => {
        if (weight.id === id) {
          return { ...weight, enabled: nextEnabled };
        }
        const isOppositeFormatPreference =
          (id === "prefer_in_person" && weight.id === "prefer_online") ||
          (id === "prefer_online" && weight.id === "prefer_in_person");
        return nextEnabled && isOppositeFormatPreference ? { ...weight, enabled: false } : weight;
      });
    });
  }

  function setRecommendationWeightImportance(id: WeightId, importance: WeightImportance): void {
    setRecommendationWeights((weights) =>
      weights.map((weight) => (weight.id === id ? { ...weight, importance } : weight)),
    );
  }

  function setBackToBackConfig(
    partial: Partial<NonNullable<RecommendationWeight["config"]>>,
  ): void {
    setRecommendationWeights((weights) =>
      weights.map((weight) =>
        weight.id === "back_to_back"
          ? { ...weight, config: { ...weight.config, ...partial } }
          : weight,
      ),
    );
  }

  /**
   * Looks beyond the user's manually chosen courses: pulls in elective subjects the user never
   * added to a choice group, preferring areas that match unmet 교양(general) graduation
   * requirements, and excluding already-completed subjects. Returns a synthetic, optional choice
   * bag (`minSubjects: 0`) so the combination engine can freely mix in 0..N of them — the existing
   * credit-range filter then keeps only combinations that actually land in the desired range.
   */
  async function buildAiFillerSubjects(): Promise<{
    bag: ChoiceBag | null;
    extrasBySectionId: Map<string, TimetableExtra>;
  }> {
    const extrasBySectionId = new Map<string, TimetableExtra>();
    if (!query) {
      return { bag: null, extrasBySectionId };
    }

    const campus = electiveCampus;
    let catalog: ElectiveCatalog;
    try {
      const payload = await postJson("/api/skku-electives", {
        year: query.year,
        term: query.term,
        campus,
        mode: "all_subjects",
      });
      catalog = readElectiveCatalog(payload);
    } catch {
      return { bag: null, extrasBySectionId };
    }

    const usedSelectionIds = new Set([
      ...manualSelectionPlanSubjects.requiredSubjects.map((subject) => subject.id),
      ...manualSelectionPlanSubjects.choiceBags.flatMap((bag) =>
        bag.subjects.map((subject) => subject.id),
      ),
    ]);
    const unmetGeneralLabels = requirements
      .filter((requirement) => requirement.scope === "general" && requirement.status !== "satisfied")
      .map((requirement) => requirement.label);

    const shortlist = selectAiFillerSubjects({
      catalogSubjects: catalog.subjects,
      usedSelectionIds,
      excludedCourseNumbers: new Set(excludedCourseNumbers),
      unmetGeneralLabels,
      hasAnyRequirements: requirements.length > 0,
      areaLabelByCode: new Map(SKKU_ELECTIVE_AREA_DEFINITIONS.map((area) => [area.code, area.label])),
      selectionIdFor: (courseNumber) => getElectiveSelectionId(campus, courseNumber),
      maxShortlist: MAX_FILLER_SHORTLIST,
    });
    if (shortlist.length === 0) {
      return { bag: null, extrasBySectionId };
    }

    const groups = await Promise.all(
      shortlist.map((subject) =>
        fetchElectivePlannerGroup(query, campus, subject).catch(() => null),
      ),
    );

    const subjects: SubjectOption[] = [];
    for (const group of groups) {
      if (!group) {
        continue;
      }
      const filtered = filterGroupCandidatesByFormat(group, disabledCourseTypes);
      if (filtered.candidates.length === 0) {
        continue;
      }
      subjects.push({
        id: filtered.selectionId,
        title: filtered.title,
        credits: filtered.credits,
        sections: filtered.candidates,
      });
      for (const candidate of filtered.candidates) {
        extrasBySectionId.set(candidate.id, {
          groupTitle: AI_FILLER_GROUP_TITLE,
          title: filtered.title,
          classification: filtered.classification || "영역 미상",
        });
      }
    }
    if (subjects.length === 0) {
      return { bag: null, extrasBySectionId };
    }

    return {
      bag: {
        id: AI_FILLER_BAG_ID,
        title: AI_FILLER_GROUP_TITLE,
        subjects,
        minSubjects: 0,
        maxSubjects: Math.min(subjects.length, MAX_FILLER_SUBJECTS),
      },
      extrasBySectionId,
    };
  }

  async function fetchAiRecommendations(): Promise<void> {
    const hasAnySelection =
      manualSelectionPlanSubjects.requiredSubjects.length > 0 ||
      manualSelectionPlanSubjects.choiceBags.length > 0;
    if (!hasAnySelection) {
      setRecommendationError("왼쪽에서 필수 과목이나 선택 그룹 후보를 먼저 추가해 주세요.");
      return;
    }
    track("ai_recommend_click");
    const startedAt = performance.now();
    setIsRecommending(true);
    setRecommendationError("");
    try {
      const filler = await buildAiFillerSubjects();
      const timetables = generateTimetablesForSelectionPlan(
        {
          requiredSubjects: manualSelectionPlanSubjects.requiredSubjects,
          choiceBags: [
            ...manualSelectionPlanSubjects.choiceBags,
            ...(filler.bag ? [filler.bag] : []),
          ],
          creditRange: {
            minCredits: minimumCredits === "" ? Number.NaN : Number(minimumCredits),
            maxCredits: maximumCredits === "" ? Number.NaN : Number(maximumCredits),
          },
        },
        {
          unavailableDays,
          earliestStartMinutes: earliestStart ? Number(earliestStart) : undefined,
          fixedEvents,
        },
      );
      const dayFiltered =
        dayOffFilters.length === 0
          ? timetables
          : timetables.filter((timetable) =>
              dayOffFilters.every((day) => isDayFree(timetable, day)),
            );

      if (dayFiltered.length === 0) {
        setRecommendationError(
          "조건을 만족하는 추천 조합을 만들지 못했습니다. 학점 범위·공강일·요일 제약을 조정해 보세요.",
        );
        setRecommendations(null);
        setAiCandidateTimetables(new Map());
        return;
      }

      const candidateMap = new Map<string, { timetable: Timetable; extras: TimetableExtra[] }>();
      for (const timetable of dayFiltered) {
        candidateMap.set(getTimetableCandidateId(timetable), {
          timetable,
          extras: describeTimetableExtras(
            timetable,
            sectionIdToGroup,
            courseOwners,
            choiceGroups,
            filler.extrasBySectionId,
          ),
        });
      }
      setAiCandidateTimetables(candidateMap);

      const payload = await postJson("/api/timetable-recommendations", {
        timetables: dayFiltered,
        weights: recommendationWeights,
        requirements,
        customPreference: customPreference.trim() || undefined,
      });
      const parsed = readRecommendationResponse(payload);
      setRecommendations(parsed.recommendations);
      setAiExplanationFailed(parsed.aiExplanationFailed);
    } catch (error) {
      setRecommendationError(readThrownMessage(error));
      setRecommendations(null);
    } finally {
      track("ai_recommend_done", { duration_ms: Math.round(performance.now() - startedAt) });
      setIsRecommending(false);
    }
  }

  const excludedCount = courseGroups.length - availableCourseGroups.length;

  return (
    <section className={styles.planner} aria-label="시간표 조합">
      <div className={styles.notice}>
        <div>
          <strong>{query ? queryLabel : "개설강좌 조회 전"}</strong>
          <span>
            {query
              ? "선택한 소속 범위의 공개 개설강좌를 서버에서 직접 조회합니다."
              : "위 기본정보를 입력하면 해당 소속의 실제 개설강좌가 여기에 표시됩니다."}
          </span>
        </div>
        {isLoading || isElectiveLoading ? (
          <span className={styles.loadingBadge}>
            {isElectiveLoading
              ? "교양 강좌 조회 중… (처음 조회는 최대 10초 정도 걸릴 수 있어요)"
              : "성대 강좌 조회 중…"}
          </span>
        ) : null}
      </div>
      {collectionError ? <p className={styles.collectionError} role="alert">{collectionError}</p> : null}
      {electiveError ? <p className={styles.collectionError} role="alert">{electiveError}</p> : null}

      <div className={styles.grid}>
        <aside className={styles.controls}>
          <fieldset>
            <legend>넣을 과목</legend>
            <div className={styles.sourceTabs} role="tablist" aria-label="과목 분류">
              <button
                aria-selected={courseSource === "major"}
                className={courseSource === "major" ? styles.activeSourceTab : undefined}
                role="tab"
                type="button"
                onClick={() => {
                  setCourseSource("major");
                  setCourseSearch("");
                }}
              >
                전공 과목
              </button>
              <button
                aria-selected={courseSource === "elective"}
                className={courseSource === "elective" ? styles.activeSourceTab : undefined}
                role="tab"
                type="button"
                onClick={() => {
                  setCourseSource("elective");
                  setCourseSearch("");
                  void loadAllElectives(electiveCampus);
                }}
              >
                교양 과목
              </button>
            </div>
            {courseSource === "elective" ? (
              <div className={styles.electiveCampusPicker}>
                <span>교양 캠퍼스</span>
                <div className={styles.campusChoices} aria-label="교양 캠퍼스">
                  {CAMPUS_OPTIONS.map((campus) => (
                    <button
                      aria-label={campus.label}
                      aria-pressed={electiveCampus === campus.value}
                      className={electiveCampus === campus.value ? styles.activeCampus : undefined}
                      disabled={isElectiveLoading}
                      key={campus.value}
                      type="button"
                      onClick={() => {
                        setElectiveCampus(campus.value);
                        setSelectedElectiveArea("all");
                        setCourseSearch("");
                        void loadAllElectives(campus.value);
                      }}
                    >
                      {campus.shortLabel}
                    </button>
                  ))}
                </div>
                <small className={styles.electiveCatalogNote}>
                  캠퍼스별 과목을 따로 찾아 함께 선택할 수 있습니다. 캠퍼스 간 이동 제한은 추후
                  추천 단계에서 적용합니다.
                </small>
                {electiveCatalog ? (
                  <div className={styles.electiveAreaFilter}>
                    <span>교양 영역</span>
                    <div className={styles.areaChoices} aria-label="교양 영역">
                      <button
                        aria-pressed={selectedElectiveArea === "all"}
                        className={selectedElectiveArea === "all" ? styles.activeArea : undefined}
                        type="button"
                        onClick={() => {
                          setSelectedElectiveArea("all");
                          setCourseSearch("");
                        }}
                      >
                        <span>전체</span>
                        <small>{electiveSubjects.length}</small>
                      </button>
                      {electiveAreas.map((area) => (
                        <button
                          aria-pressed={selectedElectiveArea === area.code}
                          className={selectedElectiveArea === area.code ? styles.activeArea : undefined}
                          disabled={area.count === 0}
                          key={area.code}
                          type="button"
                          onClick={() => {
                            setSelectedElectiveArea(area.code);
                            setCourseSearch("");
                          }}
                        >
                          <span>{area.label}</span>
                          <small>{area.count}</small>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
            <label className={styles.assignmentTarget}>
              <span>새로 선택한 과목을 담을 곳</span>
              <select
                value={activeDestination}
                onChange={(event) => setActiveDestination(event.target.value)}
              >
                <option value="required">필수 과목 · 모든 조합에 포함</option>
                {choiceGroups.map((choiceGroup) => (
                  <option key={choiceGroup.id} value={choiceGroup.id}>
                    {choiceGroup.title} · {choiceGroup.minSubjects}~{choiceGroup.maxSubjects}과목 선택
                  </option>
                ))}
              </select>
              <small>
                체크박스는 지금 선택한 위치에 들어있는 과목만 표시합니다. 다른 위치에 이미 담긴
                과목은 체크 해제 상태로 보이며, 눌러서 이 위치로 옮길 수 있습니다.
              </small>
            </label>
            <label className={styles.courseSearch}>
              <span className={styles.srOnly}>과목 검색</span>
              <input
                disabled={
                  courseSource === "major"
                    ? visibleMajorCourseGroups.length === 0 && !courseSearch
                    : !electiveCatalog || isElectiveLoading
                }
                placeholder={
                  courseSource === "major"
                    ? "과목명·학수번호·이수구분 검색"
                    : `${getCampusLabel(electiveCampus)} ${selectedElectiveAreaLabel}에서 과목명·학수번호 검색`
                }
                type="search"
                value={courseSearch}
                onChange={(event) => setCourseSearch(event.target.value)}
              />
            </label>
            {excludedCount > 0 ? (
              <p className={styles.excludedNotice}>
                기수강 과목 {excludedCount}개 자동 제외 · 재수강 체크 시 다시 표시
              </p>
            ) : null}
            {availableCourseTypes.length > 0 ? (
              <div className={styles.courseTypeFilter}>
                <span>강의 형식으로 좁히기</span>
                <div className={styles.courseTypeChoices}>
                  {availableCourseTypes.map((label) => {
                    const checked = !disabledCourseTypes.has(label);
                    return (
                      <label className={styles.courseTypeChoice} key={label}>
                        <input
                          checked={checked}
                          type="checkbox"
                          onChange={() => toggleCourseType(label)}
                        />
                        <span>{label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ) : null}
            <div className={styles.courseList}>
              {courseSource === "major" ? visibleMajorCourseGroups.map((group) => {
                const roadmapMatch = getRoadmapMatch(group.title, roadmapContext, curriculumRoadmap);
                const isSelectedElsewhere = selectedGroupIds.includes(group.selectionId);
                const checked = isAssignedToActiveDestination(group.selectionId);
                const selectedSections = checked
                  ? enabledSectionIds[group.selectionId] ?? getInitialSectionIds(group.candidates)
                  : [];
                return (
                  <div className={`${styles.courseCatalogItem} ${roadmapMatch ? styles.roadmapCourse : ""}`} key={group.selectionId}>
                    <label className={styles.courseToggle}>
                      <input
                        checked={checked}
                        type="checkbox"
                        onChange={() => toggleMajorCourseGroup(group)}
                      />
                      <span>
                        <strong>{group.title}</strong>
                        {roadmapMatch ? <span className={styles.roadmapBadge}>입학연도 로드맵</span> : null}
                        <small>
                          {group.id}
                          {group.classification ? ` · ${group.classification}` : ""}
                          {group.credits > 0 ? ` · ${formatCredits(group.credits)}학점` : ""}
                        </small>
                      </span>
                      <small>
                        {checked
                          ? getDestinationLabel(courseOwners[group.selectionId], choiceGroups)
                          : isSelectedElsewhere
                            ? `${getDestinationLabel(courseOwners[group.selectionId], choiceGroups)}에 있음 · 눌러서 옮기기`
                            : `${group.candidates.length}개 분반`}
                      </small>
                    </label>
                    {shouldShowSectionDetails(group.candidates.length)
                      ? (
                        <CourseSectionDetails
                          group={group}
                          selectedSectionIds={selectedSections}
                          onToggleSection={(sectionId) => toggleCatalogSection(group, sectionId)}
                        />
                      )
                      : null}
                  </div>
                );
              }) : visibleElectiveSubjects.map((subject) => {
                const selectionId = getElectiveSelectionId(electiveCampus, subject.courseNumber);
                const selectedGroup = electiveCourseGroups.find(
                  (group) => group.selectionId === selectionId,
                );
                const previewGroup = electivePreviewGroups[selectionId];
                const isSelectedElsewhere = Boolean(selectedGroup) && !isAssignedToActiveDestination(selectionId);
                const checked = isAssignedToActiveDestination(selectionId);
                const loading = loadingCourseNumbers.includes(selectionId);
                const previewLoading = previewLoadingIds.includes(selectionId);
                const displayedGroup = selectedGroup ?? previewGroup;
                // Filtered only for rendering/counts — toggle handlers below keep using the raw
                // `displayedGroup` so a filtered-out section is never permanently dropped from state.
                const filteredDisplayedGroup = displayedGroup
                  ? filterGroupCandidatesByFormat(displayedGroup, disabledCourseTypes)
                  : undefined;
                const selectedSections = checked && selectedGroup
                  ? enabledSectionIds[selectionId] ?? getInitialSectionIds(selectedGroup.candidates)
                  : [];
                return (
                  <ElectivePreviewBoundary
                    key={selectionId}
                    onVisible={() => preloadElectiveSubject(subject, electiveCampus)}
                  >
                    <label className={styles.courseToggle}>
                      <input
                        checked={checked}
                        disabled={loading}
                        type="checkbox"
                        onChange={() => void toggleElectiveSubject(subject)}
                      />
                      <span>
                        <strong>{subject.name}</strong>
                        <small>
                          {subject.courseNumber} · {electiveAreaLabels.get(subject.areaCode) ?? "교양"}
                          {displayedGroup && displayedGroup.credits > 0
                            ? ` · ${formatCredits(displayedGroup.credits)}학점`
                            : ""}
                        </small>
                      </span>
                      <small>
                        {loading
                          ? "분반 조회 중…"
                          : checked
                            ? getDestinationLabel(courseOwners[selectionId], choiceGroups)
                            : isSelectedElsewhere
                              ? `${getDestinationLabel(courseOwners[selectionId], choiceGroups)}에 있음 · 눌러서 옮기기`
                              : previewGroup
                                ? `${filterGroupCandidatesByFormat(previewGroup, disabledCourseTypes).candidates.length}개 분반`
                                : previewLoading
                                  ? "분반 확인 중…"
                                  : "선택"}
                      </small>
                    </label>
                    {filteredDisplayedGroup && shouldShowSectionDetails(filteredDisplayedGroup.candidates.length)
                      ? (
                        <CourseSectionDetails
                          group={filteredDisplayedGroup}
                          selectedSectionIds={selectedSections}
                          onToggleSection={(sectionId) =>
                            toggleCatalogSection(displayedGroup!, sectionId)
                          }
                        />
                      )
                      : null}
                  </ElectivePreviewBoundary>
                );
              })}
              {courseSource === "major" && !isLoading && query && visibleMajorCourseGroups.length === 0 ? (
                <p className={styles.courseEmpty}>
                  {majorCourseGroups.length === 0
                    ? "이 조건에서 조회된 개설강좌가 없습니다. 학기·캠퍼스를 확인해 주세요."
                    : "검색어와 일치하는 과목이 없습니다."}
                </p>
              ) : null}
              {courseSource === "elective" && !electiveCatalog && !isElectiveLoading && query ? (
                <p className={styles.courseEmpty}>교양 과목을 불러오지 못했습니다. 캠퍼스를 다시 선택해 주세요.</p>
              ) : null}
              {courseSource === "elective" && electiveCatalog && !isElectiveLoading && visibleElectiveSubjects.length === 0 ? (
                <p className={styles.courseEmpty}>
                  {electiveSubjects.length === 0
                    ? "이 캠퍼스에서 조회된 교양 과목이 없습니다."
                    : selectedElectiveArea === "all"
                      ? "검색어와 일치하거나 새로 수강할 수 있는 교양 과목이 없습니다."
                      : "선택한 영역에서 검색어와 일치하거나 새로 수강할 수 있는 과목이 없습니다."}
                </p>
              ) : null}
              {!query ? <p className={styles.courseEmpty}>먼저 기본정보를 입력해 주세요.</p> : null}
            </div>

            <section className={styles.selectionPlanEditor} aria-label="과목 조합 설정">
              <div className={styles.selectionPlanHeading}>
                <div>
                  <strong>과목 조합 설정</strong>
                  <small>각 선택 그룹에서 몇 과목을 고를지 정합니다.</small>
                </div>
                <button type="button" onClick={addChoiceGroup}>+ 선택 그룹 추가</button>
              </div>

              <div className={styles.choiceGroupRules}>
                <div className={styles.requiredRule}>
                  <span>필수 과목</span>
                  <strong>
                    {selectedCourseGroups.filter(
                      ({ selectionId }) =>
                        !courseOwners[selectionId] || courseOwners[selectionId] === "required",
                    ).length}개
                  </strong>
                  <small>모든 시간표에 들어갑니다.</small>
                </div>
                {choiceGroups.map((choiceGroup) => (
                  <div className={styles.choiceGroupRule} key={choiceGroup.id}>
                    <label>
                      <span className={styles.srOnly}>선택 그룹 이름</span>
                      <input
                        type="text"
                        value={choiceGroup.title}
                        onChange={(event) =>
                          updateChoiceGroup(choiceGroup.id, { title: event.target.value })
                        }
                      />
                    </label>
                    <div className={styles.cardinalityInputs}>
                      <label>
                        <span>최소</span>
                        <input
                          min="0"
                          max="20"
                          type="number"
                          value={choiceGroup.minSubjects}
                          onChange={(event) =>
                            updateChoiceGroup(choiceGroup.id, {
                              minSubjects: Number(event.target.value),
                            })
                          }
                        />
                      </label>
                      <span>~</span>
                      <label>
                        <span>최대</span>
                        <input
                          min="0"
                          max="20"
                          type="number"
                          value={choiceGroup.maxSubjects}
                          onChange={(event) =>
                            updateChoiceGroup(choiceGroup.id, {
                              maxSubjects: Number(event.target.value),
                            })
                          }
                        />
                      </label>
                    </div>
                    <small>{choiceGroupSubjectCounts.get(choiceGroup.id) ?? 0}개 후보</small>
                    <button
                      aria-label={`${choiceGroup.title} 삭제`}
                      className={styles.removeChoiceGroup}
                      type="button"
                      onClick={() => removeChoiceGroup(choiceGroup.id)}
                    >
                      삭제
                    </button>
                  </div>
                ))}
              </div>

              {selectedCourseGroups.length > 0 ? (
                <div className={styles.selectedSubjectList}>
                  {selectedCourseGroups.map((group) => {
                    const selectedSections = enabledSectionIds[group.selectionId]
                      ?? getInitialSectionIds(group.candidates);
                    const owner = courseOwners[group.selectionId] ?? "required";
                    return (
                      <details className={styles.selectedSubject} key={group.selectionId}>
                        <summary>
                          <span>
                            <strong>{group.title}</strong>
                            <small>{group.id}</small>
                          </span>
                          <small>
                            {getDestinationLabel(owner, choiceGroups)} · 분반 {selectedSections.length}/
                            {group.candidates.length}
                          </small>
                        </summary>
                        <div className={styles.subjectConfiguration}>
                          <label className={styles.subjectDestination}>
                            <span>과목 위치</span>
                            <select
                              value={owner}
                              onChange={(event) =>
                                setCourseOwners((owners) => ({
                                  ...owners,
                                  [group.selectionId]: event.target.value,
                                }))
                              }
                            >
                              <option value="required">필수 과목</option>
                              {choiceGroups.map((choiceGroup) => (
                                <option key={choiceGroup.id} value={choiceGroup.id}>
                                  {choiceGroup.title}
                                </option>
                              ))}
                            </select>
                          </label>
                          <button
                            className={styles.removeSelectedCourse}
                            type="button"
                            onClick={() => removeSelectedCourse(group)}
                          >
                            이 과목 선택 해제
                          </button>
                          <div className={styles.sectionChoices}>
                            {group.candidates.map((candidate) => (
                              <label key={candidate.id}>
                                <input
                                  checked={selectedSections.includes(candidate.id)}
                                  type="checkbox"
                                  onChange={() => toggleSection(group, candidate.id)}
                                />
                                <span>
                                  <strong>{candidate.title}</strong>
                                  <small>
                                    {candidate.professor || "교수 미정"} · {getCourseTypeLabel(candidate)}
                                  </small>
                                  <small>
                                    {candidate.schedule || "시간 미정/온라인"}
                                    {candidate.campus ? ` · ${candidate.campus}` : ""}
                                  </small>
                                </span>
                              </label>
                            ))}
                          </div>
                        </div>
                      </details>
                    );
                  })}
                </div>
              ) : (
                <p className={styles.selectionPlanEmpty}>
                  과목을 선택하면 여기서 그룹 이동과 분반 선택을 할 수 있습니다.
                </p>
              )}
            </section>
          </fieldset>

          <fieldset>
            <legend>수업 없는 요일</legend>
            <div className={styles.dayChoices}>
              {DAYS.map(({ id, label }) => {
                const checked = unavailableDays.includes(id);
                return (
                  <label className={styles.dayChoice} key={id}>
                    <input
                      checked={checked}
                      type="checkbox"
                      onChange={() =>
                        setUnavailableDays((days) =>
                          checked ? days.filter((day) => day !== id) : [...days, id],
                        )
                      }
                    />
                    <span>{label}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <fieldset>
            <legend>고정 일정(알바 등)</legend>
            {fixedEvents.length > 0 ? (
              <ul className={styles.fixedEventList}>
                {fixedEvents.map((event) => (
                  <li key={event.id}>
                    <span>
                      {DAYS.find(({ id }) => id === event.day)?.label ?? event.day} ·{" "}
                      {formatMinutes(event.startMinutes)}-{formatMinutes(event.endMinutes)} ·{" "}
                      {event.label}
                    </span>
                    <button type="button" onClick={() => removeFixedEvent(event.id)}>
                      삭제
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className={styles.fixedEventForm}>
              <input
                placeholder="일정 이름(예: 알바)"
                type="text"
                value={newEventLabel}
                onChange={(event) => setNewEventLabel(event.target.value)}
              />
              <select
                value={newEventDay}
                onChange={(event) => setNewEventDay(event.target.value as Weekday)}
              >
                {DAYS.map(({ id, label }) => (
                  <option key={id} value={id}>{label}</option>
                ))}
              </select>
              <input
                type="time"
                value={newEventStart}
                onChange={(event) => setNewEventStart(event.target.value)}
              />
              <span aria-hidden="true">~</span>
              <input
                type="time"
                value={newEventEnd}
                onChange={(event) => setNewEventEnd(event.target.value)}
              />
              <button type="button" onClick={addFixedEvent}>추가</button>
            </div>
            {fixedEventError ? <p className={styles.fixedEventError}>{fixedEventError}</p> : null}
            <small>등록한 시간에는 과목이 배치되지 않도록 시간표 조합에서 제외합니다.</small>
          </fieldset>

          <label className={styles.startSelect}>
            <span>첫 수업</span>
            <select value={earliestStart} onChange={(event) => setEarliestStart(event.target.value)}>
              {START_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          <fieldset>
            <legend>원하는 학점 범위</legend>
            <div className={styles.creditRangeInputs}>
              <label>
                <span>최소</span>
                <input
                  inputMode="numeric"
                  min="0"
                  step="1"
                  type="number"
                  value={minimumCredits}
                  onChange={(event) => setMinimumCredits(event.target.value)}
                />
              </label>
              <span aria-hidden="true">~</span>
              <label>
                <span>최대</span>
                <input
                  inputMode="numeric"
                  min="0"
                  step="1"
                  type="number"
                  value={maximumCredits}
                  onChange={(event) => setMaximumCredits(event.target.value)}
                />
              </label>
            </div>
            <small>과목 학점은 선택한 분반 수와 관계없이 과목당 한 번만 합산합니다.</small>
          </fieldset>
        </aside>

        <div className={styles.results} aria-live="polite">
          <div className={styles.resultHeading}>
            <div>
              <p>유효 시간표</p>
              <h2>
                {filteredEntries.length}개
                {dayOffFilters.length > 0 ? <small> · 전체 {result.entries.length}개 중</small> : null}
              </h2>
            </div>
            <span>순위 없음 · {minimumCredits || "?"}~{maximumCredits || "?"}학점</span>
          </div>

          {dayOffOptions.length > 0 ? (
            <div className={styles.dayOffFilter}>
              <span>공강일로 결과 좁히기</span>
              <div className={styles.dayChoices}>
                {dayOffOptions.map(({ id, label }) => {
                  const checked = dayOffFilters.includes(id);
                  return (
                    <label className={styles.dayChoice} key={id}>
                      <input
                        checked={checked}
                        type="checkbox"
                        onChange={() =>
                          setDayOffFilters((days) =>
                            checked ? days.filter((day) => day !== id) : [...days, id],
                          )
                        }
                      />
                      <span>{label} 공강</span>
                    </label>
                  );
                })}
              </div>
            </div>
          ) : null}

          {result.error ? <p className={styles.error}>{result.error}</p> : null}
          {!result.error && effectiveSelectedGroupIds.length === 0 ? (
            <p className={styles.empty}>왼쪽에서 필수 과목이나 선택 그룹 후보를 추가해 주세요.</p>
          ) : null}
          {!result.error && effectiveSelectedGroupIds.length > 0 && result.entries.length === 0 ? (
            <p className={styles.empty}>
              조건을 만족하는 조합이 없습니다. 학점·요일·시작 시간이나 과목 그룹을 조정해 보세요.
            </p>
          ) : null}
          {!result.error && result.entries.length > 0 && filteredEntries.length === 0 ? (
            <p className={styles.empty}>선택한 공강일 필터에 맞는 조합이 없습니다. 필터를 줄여 보세요.</p>
          ) : null}
          {!result.error && filteredEntries.length > 0 ? (
            <ol className={styles.timetableList}>
              {filteredEntries.map(({ index, timetable, extras }) => (
                <TimetableCard
                  extras={extras}
                  index={index}
                  key={timetable.courses.map(({ id }) => id).join("-")}
                  timetable={timetable}
                />
              ))}
            </ol>
          ) : null}

          <div className={styles.recommendationSection}>
            <h3>AI 시간표 추천</h3>
            <p className={styles.recommendationHint}>
              위 목록은 그대로 두고, 필수·선택 과목에 더해 부족한 학점만큼 관련 교양을 자동으로
              채운 뒤 아래 조건에 맞는 상위 후보를 골라 보여줍니다(이미 담은 과목은 그대로
              유지). 기수강 과목은 제외합니다.
              {requirements.length > 0
                ? " 업로드한 졸업요건 중 아직 충족하지 못한 교양 영역을 우선으로 채웁니다."
                : " 학사문서(졸업요건)를 업로드하면 미충족 교양 영역을 우선으로 채웁니다."}
            </p>

            <div className={styles.recommendationWeights}>
              {recommendationWeights.map((weight) => (
                <div className={styles.recommendationWeight} key={weight.id}>
                  <label className={styles.recommendationWeightToggle}>
                    <input
                      checked={weight.enabled}
                      type="checkbox"
                      onChange={() => toggleRecommendationWeight(weight.id)}
                    />
                    <span>{WEIGHT_LABELS[weight.id]}</span>
                  </label>
                  {weight.enabled ? (
                    <select
                      aria-label={`${WEIGHT_LABELS[weight.id]} 중요도`}
                      value={weight.importance}
                      onChange={(event) =>
                        setRecommendationWeightImportance(
                          weight.id,
                          event.target.value as WeightImportance,
                        )
                      }
                    >
                      <option value="low">낮음</option>
                      <option value="medium">보통</option>
                      <option value="high">높음</option>
                    </select>
                  ) : null}
                  {weight.enabled && weight.id === "back_to_back" ? (
                    <span className={styles.backToBackConfig}>
                      <select
                        aria-label="연강 선호/기피"
                        value={weight.config?.direction ?? "avoid"}
                        onChange={(event) =>
                          setBackToBackConfig({
                            direction: event.target.value as "prefer" | "avoid",
                          })
                        }
                      >
                        <option value="avoid">기피</option>
                        <option value="prefer">선호</option>
                      </select>
                      <input
                        aria-label="연강 기준 시간"
                        inputMode="numeric"
                        min="1"
                        step="1"
                        type="number"
                        value={(weight.config?.thresholdMinutes ?? 180) / 60}
                        onChange={(event) =>
                          setBackToBackConfig({
                            thresholdMinutes: Number(event.target.value) * 60,
                          })
                        }
                      />
                      <span>시간 이상</span>
                    </span>
                  ) : null}
                </div>
              ))}
            </div>

            <label className={styles.customPreferenceInput}>
              <span>기타 원하는 조건 (자유 입력, 선택)</span>
              <textarea
                placeholder="예: 화요일엔 3교시 이후 수업만 듣고 싶어요"
                value={customPreference}
                onChange={(event) => setCustomPreference(event.target.value)}
              />
            </label>

            <button
              disabled={
                isRecommending ||
                (manualSelectionPlanSubjects.requiredSubjects.length === 0 &&
                  manualSelectionPlanSubjects.choiceBags.length === 0)
              }
              type="button"
              onClick={() => void fetchAiRecommendations()}
            >
              {isRecommending ? "추천 생성 중…" : "AI 추천 받기"}
            </button>

            {recommendationError ? <p className={styles.error}>{recommendationError}</p> : null}
            {aiExplanationFailed && recommendations ? (
              <p className={styles.recommendationNotice}>
                Solar 추천 이유 생성에 실패해 가중치 기준 순위만 표시합니다.
              </p>
            ) : null}
            {recommendations && recommendations.length > 0 ? (
              <ol className={styles.timetableList}>
                {recommendations.map((recommendation) => {
                  const localEntry = aiCandidateTimetables.get(recommendation.candidateId);
                  const timetable = localEntry?.timetable ?? recommendation.timetable;
                  const extras = localEntry?.extras ?? [];
                  const hasFooterContent =
                    recommendation.reason ||
                    recommendation.requirementContribution ||
                    recommendation.customPreferenceNote;
                  return (
                    <TimetableCard
                      extras={extras}
                      footer={
                        hasFooterContent ? (
                          <div className={styles.recommendationFooter}>
                            {recommendation.reason ? <p>{recommendation.reason}</p> : null}
                            {recommendation.requirementContribution ? (
                              <p className={styles.recommendationRequirement}>
                                {recommendation.requirementContribution}
                              </p>
                            ) : null}
                            {recommendation.customPreferenceNote ? (
                              <p className={styles.recommendationCustomNote}>
                                {recommendation.customPreferenceNote}
                              </p>
                            ) : null}
                          </div>
                        ) : null
                      }
                      heading={`AI 추천 ${recommendation.rank}순위`}
                      index={recommendation.rank - 1}
                      key={recommendation.candidateId}
                      timetable={timetable}
                    />
                  );
                })}
              </ol>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

function ElectivePreviewBoundary({
  children,
  onVisible,
}: {
  children: ReactNode;
  onVisible: () => void;
}) {
  const elementRef = useRef<HTMLDivElement>(null);
  const onVisibleRef = useRef(onVisible);

  useEffect(() => {
    onVisibleRef.current = onVisible;
  }, [onVisible]);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) {
      return;
    }
    if (typeof IntersectionObserver === "undefined") {
      onVisibleRef.current();
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          onVisibleRef.current();
          observer.disconnect();
        }
      },
      { rootMargin: "120px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div className={styles.courseCatalogItem} ref={elementRef}>
      {children}
    </div>
  );
}

function CourseSectionDetails({
  group,
  selectedSectionIds,
  onToggleSection,
}: {
  group: CourseCandidateGroup;
  selectedSectionIds: readonly string[];
  onToggleSection: (sectionId: string) => void;
}) {
  if (group.candidates.length === 1) {
    return (
      <div className={styles.singleCourseSection}>
        <CourseSectionMetadata candidate={group.candidates[0]!} />
      </div>
    );
  }

  return (
    <details className={styles.courseSectionDetails}>
      <summary>
        <span>분반별 교수·수업 방식</span>
        <small>
          {selectedSectionIds.length > 0
            ? `${selectedSectionIds.length}/${group.candidates.length} 선택`
            : `${group.candidates.length}개 분반`}
        </small>
      </summary>
      <div className={styles.courseSectionRows}>
        {group.candidates.map((candidate) => {
          const checked = selectedSectionIds.includes(candidate.id);
          return (
            <CourseSectionChoice
              candidate={candidate}
              checked={checked}
              key={candidate.id}
              onToggle={() => onToggleSection(candidate.id)}
            />
          );
        })}
      </div>
    </details>
  );
}

function CourseSectionChoice({
  candidate,
  checked,
  onToggle,
}: {
  candidate: CourseCandidate;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label className={`${styles.courseSectionChoice} ${checked ? styles.courseSectionChoiceSelected : ""}`}>
      <input checked={checked} type="checkbox" onChange={onToggle} />
      <CourseSectionMetadata candidate={candidate} />
    </label>
  );
}

function CourseSectionMetadata({ candidate }: { candidate: CourseCandidate }) {
  return (
    <span className={styles.courseSectionRow}>
      <strong>{candidate.section ? `${candidate.section}분반` : "분반 미정"}</strong>
      <span>{candidate.professor || "교수 미정"}</span>
      <span>{getCourseTypeLabel(candidate)}</span>
    </span>
  );
}

async function postJson(url: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const payload: unknown = await response.json();
  if (!response.ok) {
    throw new Error(readCourseApiError(payload));
  }
  return payload;
}

/** Lists the non-required subjects a generated timetable drew from each choice group. */
function describeTimetableExtras(
  timetable: Timetable,
  sectionIdToGroup: ReadonlyMap<string, PlannerCourseGroup>,
  courseOwners: Readonly<Record<string, CourseDestination>>,
  choiceGroups: readonly ChoiceGroupConfig[],
  fillerExtrasBySectionId?: ReadonlyMap<string, TimetableExtra>,
): TimetableExtra[] {
  const seenSubjectIds = new Set<string>();
  const extras: TimetableExtra[] = [];
  for (const course of timetable.courses) {
    const fillerExtra = fillerExtrasBySectionId?.get(course.id);
    if (fillerExtra && !seenSubjectIds.has(fillerExtra.title)) {
      seenSubjectIds.add(fillerExtra.title);
      extras.push(fillerExtra);
      continue;
    }
    const group = sectionIdToGroup.get(course.id);
    if (!group || seenSubjectIds.has(group.selectionId)) {
      continue;
    }
    const owner = courseOwners[group.selectionId] ?? "required";
    const choiceGroup = choiceGroups.find(({ id }) => id === owner);
    if (!choiceGroup) {
      continue;
    }
    seenSubjectIds.add(group.selectionId);
    extras.push({
      groupTitle: choiceGroup.title,
      title: group.title,
      classification: group.classification || "영역 미상",
    });
  }
  return extras;
}

function isDayFree(timetable: Timetable, day: Weekday): boolean {
  return !timetable.meetings.some((meeting) => meeting.day === day) &&
    !timetable.fixedEvents.some((event) => event.day === day);
}

/** Parses an `<input type="time">` value ("HH:MM", 24-hour) into minutes since midnight. */
function parseTimeInputToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) {
    return null;
  }
  return hour * 60 + minute;
}

async function fetchElectivePlannerGroup(
  query: SkkuCourseQuery,
  campus: SkkuElectiveCampus,
  subject: SkkuElectiveSubject,
): Promise<PlannerCourseGroup> {
  const payload = await postJson("/api/skku-electives", {
    year: query.year,
    term: query.term,
    campus,
    mode: "sections",
    courseNumber: subject.courseNumber,
  });
  const [group] = courseGroupsFromCollection(payload);
  if (!group) {
    throw new Error("선택한 교양 과목의 개설 분반이 없습니다.");
  }
  return scopeElectiveGroup(group, campus);
}

function getElectiveCatalogKey(query: SkkuCourseQuery, campus: SkkuElectiveCampus): string {
  return `${query.year}:${query.term}:${campus}`;
}

function getElectiveSelectionId(campus: SkkuElectiveCampus, courseNumber: string): string {
  return `elective:${campus}:${courseNumber}`;
}

function getCampusLabel(campus: SkkuElectiveCampus): string {
  return CAMPUS_OPTIONS.find((option) => option.value === campus)?.shortLabel ?? "선택 캠퍼스";
}

function getCourseTypeLabel(candidate: {
  campus?: string;
  courseType?: string;
  schedule: string;
}): string {
  if (candidate.courseType?.trim()) {
    return candidate.courseType.trim();
  }
  const onlineHint = `${candidate.campus ?? ""} ${candidate.schedule}`
    .replaceAll("-", "")
    .toLowerCase();
  return onlineHint.includes("icampus") ? "온라인(I-CAMPUS)" : "수업 방식 미정";
}

/**
 * Returns a shallow copy with only the sections whose lecture format is still allowed.
 * Never mutates the original group, so callers may safely keep pointing at the raw,
 * unfiltered group for anything that gets written back into persistent state.
 */
function filterGroupCandidatesByFormat<G extends { candidates: CourseCandidate[] }>(
  group: G,
  disabledCourseTypes: ReadonlySet<string>,
): G {
  if (disabledCourseTypes.size === 0) {
    return group;
  }
  return {
    ...group,
    candidates: group.candidates.filter(
      (candidate) => !disabledCourseTypes.has(getCourseTypeLabel(candidate)),
    ),
  };
}

function getDestinationLabel(
  destination: CourseDestination | undefined,
  choiceGroups: readonly ChoiceGroupConfig[],
): string {
  if (!destination || destination === "required") {
    return "필수";
  }
  return choiceGroups.find(({ id }) => id === destination)?.title ?? "필수";
}

function scopeElectiveGroup(
  group: CourseCandidateGroup,
  campus: SkkuElectiveCampus,
): PlannerCourseGroup {
  const campusLabel = getCampusLabel(campus);
  return {
    ...group,
    selectionId: getElectiveSelectionId(campus, group.id),
    source: "elective",
    campus,
    candidates: group.candidates.map((candidate) => ({
      ...candidate,
      id: `${campus}:${candidate.id}`,
      title: `${candidate.title} · ${campusLabel}`,
    })),
  };
}

function readElectiveCatalog(value: unknown): ElectiveCatalog {
  return {
    areas: readElectiveAreas(value),
    subjects: readElectiveSubjects(value),
  };
}

function readElectiveAreas(value: unknown): SkkuElectiveArea[] {
  if (!isRecord(value) || !Array.isArray(value.areas)) {
    throw new Error("교양 영역 응답 형식이 올바르지 않습니다.");
  }
  return value.areas.flatMap((area) => {
    if (
      !isRecord(area) ||
      typeof area.code !== "string" ||
      typeof area.label !== "string" ||
      typeof area.count !== "number"
    ) {
      return [];
    }
    return [{ code: area.code as SkkuElectiveAreaCode, label: area.label, count: area.count }];
  });
}

function readElectiveSubjects(value: unknown): SkkuElectiveSubject[] {
  if (!isRecord(value) || !Array.isArray(value.subjects)) {
    throw new Error("교양 과목 응답 형식이 올바르지 않습니다.");
  }
  return value.subjects.flatMap((subject) => {
    if (
      !isRecord(subject) ||
      typeof subject.areaCode !== "string" ||
      typeof subject.courseNumber !== "string" ||
      typeof subject.name !== "string"
    ) {
      return [];
    }
    return [{
      areaCode: subject.areaCode as SkkuElectiveAreaCode,
      courseNumber: subject.courseNumber,
      name: subject.name,
    }];
  });
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function readThrownMessage(error: unknown): string {
  return error instanceof Error ? error.message : "개설강좌를 불러오지 못했습니다.";
}

function readCourseApiError(value: unknown): string {
  if (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "object" &&
    value.error !== null &&
    "message" in value.error &&
    typeof value.error.message === "string"
  ) {
    return value.error.message;
  }
  return "개설강좌를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.";
}

function readRecommendationResponse(value: unknown): {
  recommendations: TimetableRecommendationItem[];
  aiExplanationFailed: boolean;
} {
  if (!isRecord(value) || !Array.isArray(value.recommendations)) {
    throw new Error("추천 결과 형식이 올바르지 않습니다.");
  }
  return {
    recommendations: value.recommendations as TimetableRecommendationItem[],
    aiExplanationFailed: value.aiExplanationFailed === true,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
