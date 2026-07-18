This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Upstage Document Parse

`/api/parse-syllabus` accepts a user-uploaded PDF and calls Upstage Document Parse only on the server.
Create `web/.env.local` from `.env.example` and set `UPSTAGE_API_KEY`; never use a `NEXT_PUBLIC_` prefix.

```bash
cp .env.example .env.local
```

The university's sample syllabus URL is access-restricted, so the MVP uses user PDF uploads as its reliable input path.

The home screen includes a **강의계획서 PDF 선택** control. It sends one selected PDF to the server-only route,
then shows the explicitly parsed assessment items, midterm/final indicators, and a short Markdown preview. The PDF
and result are not saved by this application, and the API key is never sent to the browser.

## GLS 학사문서 추출 API

`/api/parse-academic-document` is a server-only `multipart/form-data` endpoint for a GLS PDF or screenshot.
It accepts `document` (PDF/PNG/JPG, up to 4MB) and one of these `kind` values. The 4MB application
limit leaves multipart overhead below Vercel Functions' 4.5MB request payload limit:

- `course_history`: 수강/취득과목 목록
- `graduation_requirements`: 졸업요건충족현황

The route calls Document Parse and then Solar on the server. It returns only a runtime-validated
`academicProfile` draft; it does not return or save the original file, full Parse Markdown, exact grades,
name, or full student number. A client must let the user edit and confirm the draft before recommendation logic
uses it.

The home screen now provides that confirmation step for both document kinds. Users can edit or remove extracted
rows, add a missing row manually, mark a completed course for retake, and acknowledge every review issue.
Confirmation is blocked while a row is invalid or a review remains unchecked. Editing confirmed data changes it
back to `draft`, and all state remains in browser memory.

For `graduation_requirements`, a screenshot can also be copied and pasted with `Ctrl+V` while that tab is
active. Pasting into an editor input is left untouched, and pasting an image only selects it; the user still
starts the Parse + Solar request explicitly with the analysis button.

## 개설강좌 자동 연결

첫 화면에서 소속·입학연도·현재 학년·캠퍼스·조회 학기를 입력하면
`POST /api/skku-courses`가 선택한 학과 범위의 공개 전공 개설강좌를 성대 서버에서 직접 조회한다.
교양은 `POST /api/skku-electives`가 공식 화면처럼 영역 개설 수→영역 내 교과목→선택 과목 분반을
단계별로 조회한다.
Next.js 서버가 성대 세션과 SSV 응답을 처리하고 최소 과목·분반 필드만 브라우저에 반환한다.
JSON 파일을 고르는 개발용 버튼은 제거했으며 조회 결과를 웹 서버에 저장하지 않는다.

확정된 수강/취득과목 중 `earned + exclude` 학수번호는 자동으로 후보에서 제외되고, 재수강으로
지정한 과목은 다시 표시된다. 전공/교양 탭에서 선택한 과목은 같은 충돌·사용자 제약 엔진에 합쳐지고,
유효 조합은 월~금 주간표의 수업 블록으로 표시된다.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
