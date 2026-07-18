# 2026-07-13 — Codex P10 scraper JSON → UI 연결

- `course-candidates.ts`가 scraper Course JSON을 과목번호별 분반 후보로 변환하게 구현했다.
- UI는 JSON 파일을 브라우저 메모리에서만 읽어 시간표 조합에 사용하며 서버에 저장하지 않는다.
- malformed JSON·중복 course_id를 처리하는 단위테스트를 포함했다.
- web lint/typecheck/test(14개)/production build 통과.
