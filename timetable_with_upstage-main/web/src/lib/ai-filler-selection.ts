import type { SkkuElectiveAreaCode, SkkuElectiveSubject } from "./skku-course-api";

export interface AiFillerSelectionInput {
  catalogSubjects: readonly SkkuElectiveSubject[];
  /** Subject ids (matching SubjectOption.id) already used as required/choice subjects. */
  usedSelectionIds: ReadonlySet<string>;
  /** Already-completed course numbers (from 수강내역) that must never be re-suggested. */
  excludedCourseNumbers: ReadonlySet<string>;
  /** Labels of unmet `scope: "general"` graduation requirements, if a profile was uploaded. */
  unmetGeneralLabels: readonly string[];
  /** Whether any graduation requirement rows exist at all (profile was uploaded). */
  hasAnyRequirements: boolean;
  areaLabelByCode: ReadonlyMap<SkkuElectiveAreaCode, string>;
  /** Builds the same subject id scheme used elsewhere so exclusion checks line up. */
  selectionIdFor: (courseNumber: string) => string;
  maxShortlist: number;
}

/**
 * Picks which elective subjects the AI recommendation step may add as filler, without touching
 * the network. A profile with fully satisfied 교양 requirements yields an empty shortlist
 * (respecting that the student no longer needs more); an unmet profile prioritizes matching
 * areas; no profile at all falls back to any available area.
 */
export function selectAiFillerSubjects(input: AiFillerSelectionInput): SkkuElectiveSubject[] {
  const {
    catalogSubjects,
    usedSelectionIds,
    excludedCourseNumbers,
    unmetGeneralLabels,
    hasAnyRequirements,
    areaLabelByCode,
    selectionIdFor,
    maxShortlist,
  } = input;

  if (hasAnyRequirements && unmetGeneralLabels.length === 0) {
    return [];
  }

  const matchesUnmetArea = (areaCode: SkkuElectiveAreaCode): boolean => {
    const areaLabel = areaLabelByCode.get(areaCode) ?? "";
    return unmetGeneralLabels.some((label) => label.includes(areaLabel) || areaLabel.includes(label));
  };

  const excludedUpper = new Set([...excludedCourseNumbers].map((value) => value.toUpperCase()));
  const availableSubjects = catalogSubjects.filter(
    (subject) =>
      !usedSelectionIds.has(selectionIdFor(subject.courseNumber)) &&
      !excludedUpper.has(subject.courseNumber.toUpperCase()),
  );
  const prioritized =
    unmetGeneralLabels.length > 0
      ? availableSubjects.filter((subject) => matchesUnmetArea(subject.areaCode))
      : availableSubjects;

  return prioritized.slice(0, maxShortlist);
}
