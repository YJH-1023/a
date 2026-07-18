export type AssessmentTag =
  | "assignment"
  | "quiz"
  | "midterm"
  | "final"
  | "presentation"
  | "participation";

export interface AssessmentItem {
  label: string;
  weight: number;
  tags: AssessmentTag[];
}

export interface SyllabusBurden {
  assignmentWeight: number;
  quizWeight: number;
  examWeight: number;
  presentationWeight: number;
  participationWeight: number;
  hasMidterm: boolean;
  hasFinal: boolean;
}

export interface NormalizedSyllabus {
  assessmentItems: AssessmentItem[];
  burden: SyllabusBurden;
}

type ParsedDocumentContent = {
  html?: unknown;
  markdown?: unknown;
};

const TAG_PATTERNS: ReadonlyArray<readonly [AssessmentTag, RegExp]> = [
  ["assignment", /assignment|homework|report|paper|project|과제|레포트|보고서|프로젝트/i],
  ["quiz", /quiz|퀴즈/i],
  ["midterm", /midterm|중간(?:고사|시험)?/i],
  ["final", /final|기말(?:고사|시험)?/i],
  ["presentation", /presentation|발표/i],
  ["participation", /participation|attendance|출석|참여/i],
];

const EMPTY_BURDEN: SyllabusBurden = {
  assignmentWeight: 0,
  quizWeight: 0,
  examWeight: 0,
  presentationWeight: 0,
  participationWeight: 0,
  hasMidterm: false,
  hasFinal: false,
};

/**
 * Converts Document Parse content into only explicit assessment signals.
 *
 * This intentionally does not guess weights from prose: the burden score is a transparent
 * downstream input, so an item is included only when a percentage and an assessment keyword
 * appear on the same parsed line.
 */
export function normalizeSyllabus(parsedDocument: unknown): NormalizedSyllabus {
  const text = getParsedText(parsedDocument);
  const assessmentItems = extractAssessmentItems(text);

  return {
    assessmentItems,
    burden: assessmentItems.reduce(updateBurden, { ...EMPTY_BURDEN }),
  };
}

function getParsedText(parsedDocument: unknown): string {
  if (typeof parsedDocument !== "object" || parsedDocument === null || !("content" in parsedDocument)) {
    return "";
  }
  const content = parsedDocument.content as ParsedDocumentContent;
  if (typeof content.markdown === "string" && content.markdown.trim()) {
    return content.markdown;
  }
  if (typeof content.html === "string") {
    return content.html.replace(/<[^>]*>/g, " ");
  }
  return "";
}

function extractAssessmentItems(text: string): AssessmentItem[] {
  const items: AssessmentItem[] = [];
  for (const line of text.split(/\r?\n/)) {
    const cleanedLine = line.replace(/[|*_`]/g, " ").replace(/\s+/g, " ").trim();
    const match = cleanedLine.match(/^(.*?)\s*[:\-–—]?\s+(\d{1,3}(?:\.\d+)?)\s*%\s*$/);
    if (!match) {
      continue;
    }

    const label = match[1]?.trim() ?? "";
    const weight = Number(match[2]);
    const tags = TAG_PATTERNS.filter(([, pattern]) => pattern.test(label)).map(([tag]) => tag);
    if (tags.length > 0 && Number.isFinite(weight) && weight >= 0 && weight <= 100) {
      items.push({ label, weight, tags });
    }
  }
  return items;
}

function updateBurden(burden: SyllabusBurden, item: AssessmentItem): SyllabusBurden {
  const hasTag = (tag: AssessmentTag): boolean => item.tags.includes(tag);
  const isPresentation = hasTag("presentation");

  return {
    assignmentWeight: burden.assignmentWeight + (hasTag("assignment") ? item.weight : 0),
    quizWeight: burden.quizWeight + (hasTag("quiz") ? item.weight : 0),
    // A midterm/final presentation is a presentation burden, not a written-exam burden.
    examWeight:
      burden.examWeight +
      ((hasTag("midterm") || hasTag("final")) && !isPresentation ? item.weight : 0),
    presentationWeight: burden.presentationWeight + (isPresentation ? item.weight : 0),
    participationWeight: burden.participationWeight + (hasTag("participation") ? item.weight : 0),
    hasMidterm: burden.hasMidterm || hasTag("midterm"),
    hasFinal: burden.hasFinal || hasTag("final"),
  };
}
