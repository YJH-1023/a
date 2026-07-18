# CLAUDE.md

> **이 프로젝트의 AI 지침은 [`AGENTS.md`](./AGENTS.md)에 통합되어 있다.**
> Claude Code는 작업 전 반드시 `AGENTS.md`를 먼저 읽는다.
> (Codex 등 다른 도구도 동일한 `AGENTS.md`를 읽으므로, 두 도구가 같은 규칙·맥락을 공유한다.)

## 빠른 시작 (Claude Code용 요약 — 상세는 AGENTS.md)

1. `AGENTS.md` → `CURRENT_STATE.md` → `docs/00_프로젝트_현황_요약.md` → `docs/05_미해결_과제.md` 순으로 읽는다.
2. 코드 작성 후 커밋 전 품질 게이트를 통과한다:
   - web: `cd web && npm run lint && npm run typecheck && npm run test`
   - scraper: `cd scraper && ruff check . && ruff format --check . && pytest`
3. 작은 단위로 쪼개서 작업하고, 각 단위마다 확인 방법을 명시한다.
4. API 키는 절대 코드에 넣지 않는다 (환경변수 `UPSTAGE_API_KEY`).
5. 큰 작업 완료 후 `.github/agent-logs/`에 로그를 남긴다.

## 이 프로젝트의 핵심 제약 (절대 어기지 말 것)
- **Upstage(Parse/Extract/Solar)가 서비스의 심장이어야 한다.** 크롤링은 조연.
- 강의계획서 PDF 파싱이 진짜 가치. 개설강좌 수집은 시딩일 뿐.
- 상세 규칙·워크플로우·금지사항은 전부 `AGENTS.md`에 있다.
