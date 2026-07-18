# 2026-07-13 — Codex P11 강의계획서 분석 UI

- `SyllabusUploader`를 추가해 사용자가 PDF 한 건을 선택하고 `/api/parse-syllabus` 분석을 실행하게 했다.
- 브라우저는 `FormData`만 서버 경로로 보내고 API 키는 전달받지 않는다. 응답은 명시 평가 항목,
  중간/기말 표기, 안전한 Markdown 텍스트 미리보기로 표시한다.
- 부담도 점수화, 결과 정렬, 상위 N 추천은 사용자 지시(D-13)에 따라 추가하지 않았다.
- 검증: `npm run lint && npm run typecheck && npm run test && npm run build` 통과
  (Vitest 6개 파일, 16개 테스트).
