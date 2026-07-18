# PROJECT_STRUCTURE.md — 폴더 구조 (목표)

> AI 도구와 사람이 "어디에 무엇을 만들지" 파악하기 위한 지도.
> **⚠️ 현재는 하네스 문서만 있고 scraper/·web/ 코드는 아직 없다. 아래는 만들어갈 목표 구조다.**
> 구조를 실제로 만든 뒤에는 이 파일을 실제와 일치하게 유지한다 (가비지 컬렉션 점검 항목).

```
skku-timetable/
├── AGENTS.md              # ★ AI 지침서 (모든 도구가 먼저 읽음)
├── CLAUDE.md              # Claude Code 진입점 (AGENTS.md로 위임)
├── README.md              # 사람용 프로젝트 소개·실행법
├── .gitignore             # 키·빌드산출물 제외 (보안 필수)
├── .pre-commit-config.yaml # 커밋 전 자동 린트/테스트
│
├── docs/                  # 외부화된 기억 (기획+개발 하네스)
│   ├── 00_프로젝트_현황_요약.md
│   ├── 01_의사결정_로그.md
│   ├── 02_기술검증_기록.md   # ★ 성대 API 명세 (개발 시 필수)
│   ├── 03_아이디어_후보_평가.md
│   ├── 04_규칙과_지켜야할것.md
│   ├── 05_미해결_과제.md
│   ├── PROJECT_STRUCTURE.md  # 이 파일
│   ├── GARBAGE_COLLECTION.md # 청소 에이전트 절차
│   └── 성대_학과코드_전체.txt  # 학과코드 132개 (수집기 상수)
│
├── scraper/               # 개설강좌 수집기 (Python, 독립 실행)
│   ├── skku_scraper/       # 패키지
│   │   ├── __init__.py
│   │   ├── ssv.py          # 넥사크로 SSV 파서
│   │   ├── client.py       # 성대 API 호출 (전공/교양)
│   │   ├── codes.py        # 학과코드·영역코드·TERM 상수
│   │   └── models.py       # 과목 데이터 구조
│   ├── data/               # 수집 결과 JSON (gitignore 대상 후보)
│   ├── tests/              # pytest
│   ├── pyproject.toml      # ruff·pytest 설정, 의존성
│   └── README.md
│
├── web/                   # 서비스 (Next.js + TypeScript)
│   ├── src/
│   │   ├── app/            # App Router 페이지
│   │   │   └── api/        # ★ Upstage 프록시 (키는 여기서만)
│   │   ├── lib/            # 공통 로직 (조합계산·Upstage클라이언트)
│   │   └── components/     # UI 컴포넌트
│   ├── package.json        # eslint·prettier·vitest 스크립트
│   ├── tsconfig.json
│   └── ...
│
└── .github/
    ├── workflows/         # CI gate (자동 테스트/린트)
    └── agent-logs/        # AI 작업 로그 (세션 인수인계용)
```

## 데이터 흐름 (한눈에)

```
[수집] scraper (Python)
   성대 selectMain.do / selectMain03.do 호출
   → SSV 파싱 → 과목 JSON (INTRO_URL=강의계획서 포함)
        │
        ▼
[파싱·주연] web/api (Upstage)
   강의계획서 PDF → Document Parse → Extract
   (평가방식·과제비중·시험일정·수업유형)
        │
        ▼
[조합·계산] web/lib
   시간충돌 없는 조합 생성 → 제약·목적함수로 상위 N개
        │
        ▼
[추천사유] web/api (Solar)
   "이 조합은 과제가 몰려있다" 등 생성
        │
        ▼
[표시] web/app + components
```

## 어디를 고쳐야 하나 (빠른 판별)

| 증상/작업 | 위치 |
|---|---|
| 과목 수집이 안 됨 / SSV 파싱 오류 | `scraper/skku_scraper/` |
| 학과·영역·학기 코드 | `scraper/skku_scraper/codes.py` + `docs/성대_학과코드_전체.txt` |
| 강의계획서 파싱 품질 | `web/src/app/api/` (Upstage 호출부) |
| 시간표 조합 로직 | `web/src/lib/` |
| 화면·UI | `web/src/app/`, `web/src/components/` |
| API 키·환경변수 | `.env.local` (gitignore), Vercel 환경변수 |
