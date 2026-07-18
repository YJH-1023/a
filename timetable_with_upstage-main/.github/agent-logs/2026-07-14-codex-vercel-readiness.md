# 2026-07-14 Codex — Vercel 배포 준비

- Vercel Functions의 4.5MB request/response payload 한도를 고려해 학사문서·강의계획서 업로드 한도를 4MB로 통일했다.
- 강의계획서 API가 전체 Upstage Parse 응답을 다시 반환하지 않고, 1,200자 markdown 미리보기와 정규화된 강의계획서만 반환하게 경량화했다.
- `.env.local`이 Git에서 무시되고 트래킹되지 않음을 확인했다. 실제 비밀값이 없는 `.env.example`만 배포 안내용으로 추적한다.
- `npm run lint`, `npm run typecheck`, `npm run test`(17개 파일/84개), `npm run build`를 모두 통과했다.
- 다음 사용자 작업: Vercel에서 GitHub 저장소를 import하고 Root Directory를 `web`으로 지정한 뒤, `UPSTAGE_API_KEY`를 Production·Preview Sensitive 환경변수로 등록해 배포한다.
