"use client";

import { useState } from "react";

import {
  getDocumentPreview,
  getSyllabusApiError,
  parseSyllabusResponse,
  type ParsedSyllabusResponse,
} from "@/lib/parse-syllabus-response";
import {
  MAX_DOCUMENT_BYTES,
  MAX_DOCUMENT_SIZE_LABEL,
} from "@/lib/document-limits";

import styles from "./SyllabusUploader.module.css";

export function SyllabusUploader() {
  const [file, setFile] = useState<File>();
  const [analysis, setAnalysis] = useState<ParsedSyllabusResponse>();
  const [error, setError] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  function selectFile(nextFile: File | undefined): void {
    setAnalysis(undefined);
    setError("");

    if (!nextFile) {
      setFile(undefined);
      return;
    }
    if (nextFile.size === 0 || nextFile.size > MAX_DOCUMENT_BYTES) {
      setFile(undefined);
      setError(`PDF 파일은 1바이트 이상 ${MAX_DOCUMENT_SIZE_LABEL} 이하만 분석할 수 있습니다.`);
      return;
    }
    if (nextFile.type !== "application/pdf" && !nextFile.name.toLowerCase().endsWith(".pdf")) {
      setFile(undefined);
      setError("강의계획서 PDF 파일만 선택해 주세요.");
      return;
    }
    setFile(nextFile);
  }

  async function analyzeSyllabus(): Promise<void> {
    if (!file) {
      return;
    }

    setIsAnalyzing(true);
    setError("");
    setAnalysis(undefined);
    try {
      const formData = new FormData();
      formData.set("document", file);
      const response = await fetch("/api/parse-syllabus", { method: "POST", body: formData });
      const payload: unknown = await response.json();
      if (!response.ok) {
        throw new Error(getSyllabusApiError(payload));
      }
      setAnalysis(parseSyllabusResponse(payload));
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "강의계획서 분석을 완료하지 못했습니다. 다시 시도해 주세요.",
      );
    } finally {
      setIsAnalyzing(false);
    }
  }

  const preview = analysis ? getDocumentPreview(analysis.document) : null;

  return (
    <section className={styles.panel} aria-labelledby="syllabus-heading">
      <div className={styles.intro}>
        <p className={styles.eyebrow}>UPSTAGE DOCUMENT PARSE</p>
        <h2 id="syllabus-heading">강의계획서에서 평가 방식을 확인하세요.</h2>
        <p>
          PDF는 분석 요청에만 사용되며, API 키는 브라우저에 전달되지 않습니다. 명시된 평가 비율만
          추출해 보여 드립니다.
        </p>
      </div>

      <div className={styles.uploadRow}>
        <label className={styles.filePicker}>
          <span>{file ? file.name : "강의계획서 PDF 선택"}</span>
          <input
            accept="application/pdf,.pdf"
            type="file"
            onChange={(event) => {
              selectFile(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </label>
        <button disabled={!file || isAnalyzing} type="button" onClick={() => void analyzeSyllabus()}>
          {isAnalyzing ? "Upstage 분석 중…" : "PDF 분석하기"}
        </button>
      </div>
      <p className={styles.limit}>
        PDF 1개 · 최대 {MAX_DOCUMENT_SIZE_LABEL} · 분석 후 서버에 저장하지 않음
      </p>

      {error ? <p className={styles.error}>{error}</p> : null}

      {analysis ? (
        <div className={styles.result} aria-live="polite">
          <div className={styles.resultHeading}>
            <div>
              <p>분석 완료</p>
              <h3>명시된 평가 항목</h3>
            </div>
            <span>순위·점수화 없음</span>
          </div>

          {analysis.syllabus.assessmentItems.length > 0 ? (
            <ul className={styles.assessmentList}>
              {analysis.syllabus.assessmentItems.map((item, index) => (
                <li key={`${item.label}-${index}`}>
                  <span>{item.label}</span>
                  <strong>{item.weight}%</strong>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.empty}>명시적인 백분율 평가 항목을 찾지 못했습니다.</p>
          )}

          <div className={styles.signals}>
            <span>{analysis.syllabus.burden.hasMidterm ? "중간고사 표기 있음" : "중간고사 표기 없음"}</span>
            <span>{analysis.syllabus.burden.hasFinal ? "기말고사 표기 있음" : "기말고사 표기 없음"}</span>
          </div>

          {preview ? (
            <details className={styles.preview}>
              <summary>Document Parse 텍스트 미리보기</summary>
              <p>{preview}</p>
            </details>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
