# WORKFLOW.md — Claude Code + Codex 병행 개발 워크플로우

> VS Code에서 두 AI 코딩 도구를 넘나들며 개발하는 전체 방법.
> 사람(재성)이 읽는 안내서. 실제 규칙은 `AGENTS.md`, 인수인계는 `CURRENT_STATE.md`.

---

## 0. 큰 그림 — 왜 이렇게 하나

두 도구(Claude Code, Codex)는 **대화 세션이 서로 독립적**이다. 한쪽 대화를 다른 쪽이 볼 수 없다.
그래서 맥락을 **대화가 아니라 "파일"로 주고받는다.** 이 파일들이 "공유 기억" 역할을 한다:

```
        ┌─────────────── 공유 기억 (파일) ───────────────┐
        │  AGENTS.md      = 변하지 않는 규칙·워크플로우     │
        │  docs/00~05     = 프로젝트 맥락 (기획·기술·결정)  │
        │  CURRENT_STATE.md = 지금 상태 (매 세션 갱신) ★    │
        │  git 커밋 이력   = 실제 코드 변경 기록            │
        └────────────────────────────────────────────────┘
              ▲                              ▲
              │ 읽고/쓰고                     │ 읽고/쓰고
        ┌─────┴─────┐                  ┌─────┴─────┐
        │ Claude Code│  ←── 번갈아 ──→  │   Codex    │
        └───────────┘                  └───────────┘
```

**핵심 원리:** 어느 도구든 세션을 시작할 때 위 파일들을 읽으면 "지금까지 뭐가 됐는지" 알 수 있고,
멈출 때 `CURRENT_STATE.md`를 갱신하면 다음 도구가 이어받는다. **토큰이 떨어져도 맥락이 안 끊긴다.**

---

## 1. 사전 준비 (한 번만)

### 1-1. 폴더 열기
- VS Code로 이 프로젝트 폴더를 연다.
- 이 킷의 파일들이 프로젝트 루트에 있어야 한다 (아래 2장 "파일 배치" 참조).

### 1-2. 두 도구 설치·인증
- **Claude Code**: 설치·로그인. (설치법은 공식문서 최신 확인)
- **Codex**: 설치·로그인.
- 둘 다 VS Code **통합 터미널**에서 실행한다. 터미널을 2개 열어 한쪽은 Claude Code, 한쪽은 Codex로 써도 된다.

### 1-3. Git·GitHub
- `git init` → GitHub 리포 생성 → 연결.
- 첫 커밋으로 이 킷 전체를 올린다 (코드는 아직 없어도 됨).

### 1-4. 품질 자동화 켜기 (선택이지만 권장)
```bash
pip install pre-commit && pre-commit install   # 커밋 전 자동 검사 활성화
```
- 이후 커밋할 때마다 린터·포맷·키검사가 자동 실행되고, 실패하면 커밋이 막힌다.
- CI(GitHub Actions)는 push하면 자동으로 돈다 (`.github/workflows/`).

---

## 2. 파일 배치 — 어떤 파일을 어디에 두나

```
프로젝트루트/
├── AGENTS.md            ★ AI가 먼저 읽는 규칙 (Codex 기본 인식)
├── CLAUDE.md            ★ Claude Code가 먼저 읽음 (AGENTS.md로 위임)
├── CURRENT_STATE.md     ★ 세션 인수인계 상태판 (매번 갱신)
├── WORKFLOW.md          이 파일 (사람용 안내)
├── PROMPTS.md           복붙용 프롬프트 모음
├── .gitignore           키·빌드산출물 제외
├── .pre-commit-config.yaml
├── docs/                프로젝트 기억 (기획·기술검증·규칙·학과코드)
└── .github/workflows/   CI gate
```

> **왜 AGENTS.md와 CLAUDE.md 둘 다?** Codex는 `AGENTS.md`를, Claude Code는 `CLAUDE.md`를 관례적으로
> 먼저 읽는다. 그래서 `CLAUDE.md`는 "AGENTS.md를 읽어라"라고만 적어 두 도구가 같은 규칙을 공유한다.

---

## 3. 매일의 개발 루프 (한 도구로 작업할 때)

```
1. 세션 시작
   → "AGENTS.md, CURRENT_STATE.md, git diff 읽고 이어서 작업해" (PROMPTS.md의 시작 프롬프트)

2. 작은 단위로 작업
   → 한 번에 큰 코드 X. 기능 하나씩. 각 단위마다 "어떻게 확인하는지" 명시.

3. 품질 게이트 (커밋 전 필수)
   → web:     npm run lint && npm run typecheck && npm run test
   → scraper: ruff check . && ruff format --check . && pytest
   → 실패하면? 4번(피드백 루프)

4. 피드백 루프 (린터/테스트가 오류 잡으면)
   → 오류를 읽고 → 근본원인 파악 → 수정 → 다시 3번. 통과할 때까지 반복.
   → 우회(무시)하지 않는다. 같은 오류 2번 이상이면 AGENTS.md에 규칙 추가.

5. 커밋
   → git add → git commit (말머리 feat/fix/docs/refactor/test/chore)
   → pre-commit이 다시 자동 검사

6. 세션 종료 전
   → CURRENT_STATE.md 갱신 (한 일 / 바꾼 파일 / 다음 할 일)
   → 큰 작업이면 .github/agent-logs/ 에도 기록
```

---

## 4. 도구 전환 — Codex ↔ Claude Code 넘나들기

### 언제 전환하나
- 한 도구의 토큰/한도가 떨어졌을 때
- 한 도구가 잘 하는 작업이 있을 때 (예: 한쪽에 구현, 다른 쪽에 교차 리뷰)
- 막혀서 다른 관점이 필요할 때

### 전환 절차 (3단계)
```
[멈추는 도구]
  → "여기서 멈춰. CURRENT_STATE.md를 최신화해:
     바꾼 파일, 실행한 명령어, 남은 문제, 다음 할 일. 코드는 더 건드리지 마."

[사람]
  → 다른 도구의 터미널로 이동 (또는 새로 실행)

[이어받는 도구]
  → "AGENTS.md, CURRENT_STATE.md, 현재 git diff를 먼저 읽어.
     기존 구현을 되돌리지 말고 Recommended Next Step부터 이어서 작업해.
     끝나면 CURRENT_STATE.md도 갱신해."
```
(위 프롬프트 전문은 `PROMPTS.md`에 있다 — 복붙용)

### 자기 세션 재개 (같은 도구로 돌아올 때)
- Codex: `codex resume --last`
- Claude Code: `claude --continue` (또는 특정 세션: `claude --resume`)
- ※ 두 도구의 세션은 독립적이다. 서로의 대화는 못 본다 → 그래서 CURRENT_STATE.md가 다리 역할.

### 교차 리뷰 활용 (권장)
- 한 도구가 구현 → 다른 도구에게 "이 diff를 리뷰해줘. AGENTS.md 규칙 위반·보안·죽은코드 관점으로."
- 서로 다른 모델이 보니 놓친 걸 잡는다. (docs/codex 스킬의 "second opinion" 개념과 동일)

---

## 5. 주기적 청소 (가비지 컬렉션)

코드가 쌓이면 나쁜 패턴이 눈덩이처럼 불어난다. 주기적으로 청소한다.
- **언제:** 큰 기능 완료 후, 또는 주 1회
- **어떻게:** 도구에게 "docs/GARBAGE_COLLECTION.md 절차대로 청소해. 먼저 문제를 목록으로 보고하고 승인받은 뒤 고쳐."
- 점검: 문서-코드 불일치 / 규칙위반 코드 / 죽은 코드 / 중복 로직

---

## 6. 자주 하는 실수 (피하기)

| 실수 | 결과 | 예방 |
|---|---|---|
| CURRENT_STATE.md 갱신 안 하고 도구 전환 | 다음 도구가 맥락 잃음 | 멈추기 전 반드시 갱신 |
| 게이트 안 돌리고 커밋 | 깨진 코드가 쌓임 | pre-commit 설치 |
| 큰 코드 한 번에 요청 | 리뷰·디버깅 불가 | 작은 단위로 |
| 린터 오류 우회 | 나쁜 패턴 누적 | 근본원인 수정 |
| API 키 커밋 | 보안 사고 | .gitignore + detect-private-key 훅 |

---

## 7. 요약 — 딱 이것만 기억

1. **시작할 때:** AGENTS.md + CURRENT_STATE.md 읽기
2. **작업할 때:** 작은 단위 + 게이트 통과 + 커밋
3. **멈출 때:** CURRENT_STATE.md 갱신
4. **전환할 때:** 위 3개를 다음 도구가 읽으면 끝

→ 구체적인 복붙 프롬프트는 `PROMPTS.md`.
