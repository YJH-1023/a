import { describe, expect, it } from "vitest";

import { normalizeSyllabus } from "./syllabus";

describe("normalizeSyllabus", () => {
  it("extracts explicit assessment weights from Document Parse markdown", () => {
    const result = normalizeSyllabus({
      content: {
        markdown: `## Tentative Grading Breakdown
Participation 30%
Quizzes/Homework 10%
In-class Presentations 20%
Midterm Presentation 15%
Final Presentation 25%`,
      },
    });

    expect(result.assessmentItems).toEqual([
      { label: "Participation", weight: 30, tags: ["participation"] },
      { label: "Quizzes/Homework", weight: 10, tags: ["assignment", "quiz"] },
      { label: "In-class Presentations", weight: 20, tags: ["presentation"] },
      { label: "Midterm Presentation", weight: 15, tags: ["midterm", "presentation"] },
      { label: "Final Presentation", weight: 25, tags: ["final", "presentation"] },
    ]);
    expect(result.burden).toEqual({
      assignmentWeight: 10,
      quizWeight: 10,
      examWeight: 0,
      presentationWeight: 60,
      participationWeight: 30,
      hasMidterm: true,
      hasFinal: true,
    });
  });

  it("does not infer an assessment from prose without an explicit percentage", () => {
    const result = normalizeSyllabus({
      content: { markdown: "There will be a final presentation and weekly reading." },
    });

    expect(result.assessmentItems).toEqual([]);
    expect(result.burden).toEqual({
      assignmentWeight: 0,
      quizWeight: 0,
      examWeight: 0,
      presentationWeight: 0,
      participationWeight: 0,
      hasMidterm: false,
      hasFinal: false,
    });
  });

  it("uses HTML when markdown is empty", () => {
    const result = normalizeSyllabus({
      content: { html: "<p>Final Exam 40%</p>" },
    });

    expect(result.assessmentItems).toEqual([
      { label: "Final Exam", weight: 40, tags: ["final"] },
    ]);
    expect(result.burden.examWeight).toBe(40);
  });
});
