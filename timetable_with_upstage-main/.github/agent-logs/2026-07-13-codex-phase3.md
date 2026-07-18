# 2026-07-13 — Codex Phase 3 착수

- 수집된 강의계획서 URL은 접근제한 HTML을 반환함을 확인했고, 자동 URL 수집 대신 사용자 PDF 업로드를 MVP 입력으로 정했다.
- `POST /api/parse-syllabus`를 추가했다. Upstage 키는 서버 환경변수로만 사용하며 PDF 검증과 업스트림 오류 처리를 포함한다.
- 이 환경에는 `UPSTAGE_API_KEY`가 없어 실제 Parse 호출은 하지 못했다. 키 설정 뒤 PDF 1건으로 최우선 검증이 필요하다.
- web lint/typecheck/test 통과 (Vitest 4개 테스트).

## API 키 설정 후 실검증

- 공개 1쪽 PDF를 로컬 `POST /api/parse-syllabus`로 업로드해 Upstage 실제 호출을 검증했다.
- HTTP 200, API 2.0, HTML·Markdown·elements 응답을 확인했다. 키 값은 출력·로그·커밋하지 않았다.
- 실제 강의계획서 PDF 품질 검증은 접근 가능한 파일을 사용자가 제공/업로드해야 한다.

## 공개 성균관대 강의계획서 품질·정규화 검증

- 공개 School of Business 강의계획서 PDF를 실제로 Parse해 11개 레이아웃 요소와 평가·퀴즈·중간·기말·발표 키워드를 확인했다.
- `syllabus.ts`를 추가해 같은 줄에 명시된 평가 항목·백분율만 보수적으로 정규화했다.
- 라이브 결과: 평가 5개, 과제/퀴즈 10%, 발표 60%, 참여 30%, 중간/기말 존재. Phase 3 완료, 다음은 Phase 4 조합 로직.
