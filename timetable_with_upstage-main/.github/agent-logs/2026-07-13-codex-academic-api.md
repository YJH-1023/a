# 2026-07-13 — Codex GLS 학사문서 API

- PDF/PNG/JPG 학사문서를 Document Parse→Solar로 처리하는 서버 라우트를 추가했다.
- Solar 출력을 AcademicProfile로 런타임 검증·재구성하고, 임의 필드·정확한 성적·
  개인식별 필드를 응답에 복사하지 않도록 했다.
- 자동 추출은 항상 draft로 반환하고, 형식 오류 행은 review issue로 남긴다.
- 가상 빈 학사 데이터로 Solar를 실호출해 HTTP 200·`solar-pro3-260323`·고정 JSON을 확인했다.
- web lint·typecheck·29개 테스트·production build가 모두 통과했다.
