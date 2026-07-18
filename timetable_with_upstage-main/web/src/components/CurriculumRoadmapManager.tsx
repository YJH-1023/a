"use client";

import { useState } from "react";
import { confirmCurriculumRoadmap, parseCurriculumRoadmap, updateRoadmapCourse, type CurriculumRoadmap } from "@/lib/curriculum-roadmap";
import styles from "./CurriculumRoadmapManager.module.css";

interface Props { academicYear: number | null; programCode: string; currentGrade: number | null; semester: 1 | 2 | null; onChange: (value: CurriculumRoadmap | null) => void; }

export function CurriculumRoadmapManager({ academicYear, programCode, currentGrade, semester, onChange }: Props) {
  const [file, setFile] = useState<File>(); const [roadmap, setRoadmap] = useState<CurriculumRoadmap | null>(null);
  const [consent, setConsent] = useState(false); const [loading, setLoading] = useState(false); const [error, setError] = useState("");
  function replace(next: CurriculumRoadmap | null) { setRoadmap(next); onChange(next); }
  async function analyze() {
    if (!file || !consent) return; setLoading(true); setError(""); replace(null);
    const body = new FormData(); body.set("document", file); if (academicYear) body.set("academicYear", String(academicYear)); if (programCode) body.set("programCode", programCode); if (currentGrade) body.set("currentGrade", String(currentGrade)); if (semester) body.set("semester", String(semester));
    try { const response = await fetch("/api/parse-curriculum-roadmap", { method: "POST", body }); const payload: unknown = await response.json();
      if (!response.ok || !isRecord(payload) || !isRecord(payload.roadmap)) throw new Error(errorMessage(payload));
      replace(parseCurriculumRoadmap(payload.roadmap));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "로드맵 분석에 실패했습니다."); } finally { setLoading(false); }
  }
  function addCourse(): void {
    if (!roadmap || currentGrade === null || semester === null) return;
    replace({
      ...roadmap,
      status: "draft",
      courses: [...roadmap.courses, {
        id: `manual-${crypto.randomUUID()}`,
        printedCourseName: "",
        curriculumCategory: null,
        trackName: null,
        placement: { type: "exact", grade: currentGrade, semester },
        reviewStatus: "needs_review",
        reviewReasons: ["사용자가 직접 추가한 과목"],
        sourceEvidence: null,
      }],
    });
  }
  return <section className={styles.card}>
    <div><span className={styles.eyebrow}>입학연도 교육과정</span><h2>로드맵 이미지로 추천 과목 표시</h2><p>학과 한 페이지를 올리면 과목을 정규화합니다. 검토 후 확정한 과목만 개설과목 목록에 색칠됩니다.</p></div>
    <input accept="image/png,image/jpeg,image/webp" type="file" onChange={(e) => setFile(e.target.files?.[0])} />
    <label className={styles.consent}><input checked={consent} type="checkbox" onChange={(e) => setConsent(e.target.checked)} /> 원본은 저장하지 않고 분석 요청에만 사용한다는 점에 동의합니다.</label>
    <button disabled={!file || !consent || loading} type="button" onClick={analyze}>{loading ? "Gemini 비전으로 이미지 분석 중…" : "로드맵 이미지 분석"}</button>
    {error ? <p className={styles.error}>{error}</p> : null}
    {roadmap ? <div className={styles.result}>
      <p><strong>{roadmap.programName ?? "학과명 미확인"}</strong> · {currentGrade ?? "-"}학년 {semester ?? "-"}학기 · 해당 과목 {roadmap.courses.length}개 · {roadmap.status === "confirmed" ? "확정됨" : "검토 필요"}</p>
      <div className={styles.rows}>{roadmap.courses.map((course) => (
        <div className={styles.row} key={course.id}>
          <input aria-label="과목명" value={course.printedCourseName} onChange={(e) => replace(updateRoadmapCourse(roadmap, course.id, { printedCourseName: e.target.value }))} />
          <button type="button" onClick={() => replace({ ...roadmap, status: "draft", courses: roadmap.courses.filter((x) => x.id !== course.id) })}>삭제</button>
        </div>
      ))}</div>
      <button className={styles.addCourseButton} disabled={currentGrade === null || semester === null} type="button" onClick={addCourse}>+ 과목 직접 추가</button>
      <p className={styles.warning}>AI 추출 결과입니다. 원본과 대조한 뒤 확정하세요. 확정 후 수정하면 다시 초안으로 전환됩니다.</p>
      <button disabled={!roadmap.courses.length || roadmap.courses.some((course) => !course.printedCourseName.trim())} type="button" onClick={() => replace(confirmCurriculumRoadmap(roadmap))}>검토 완료 · 색칠에 적용</button>
    </div> : null}
  </section>;
}
function isRecord(v: unknown): v is Record<string, unknown> { return typeof v === "object" && v !== null && !Array.isArray(v); }
function errorMessage(v: unknown): string { return isRecord(v) && isRecord(v.error) && typeof v.error.message === "string" ? v.error.message : "로드맵 분석에 실패했습니다."; }
