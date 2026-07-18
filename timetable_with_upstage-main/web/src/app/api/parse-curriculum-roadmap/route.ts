import { parseCurriculumRoadmap } from "../../../lib/curriculum-roadmap";

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const schema = { type: "object", additionalProperties: false,
  required: ["academicYear", "programCode", "programName", "layoutType", "courses", "reviewReasons"],
  properties: { academicYear: nullable("integer"), programCode: nullable("string"), programName: nullable("string"), layoutType: { enum: ["semester_grid", "year_grid", "track_map", "mixed", "unknown"] }, reviewReasons: strings(),
    courses: { type: "array", items: { type: "object", additionalProperties: false,
      required: ["printedCourseName", "curriculumCategory", "trackName", "placementType", "grade", "semester", "fromGrade", "fromSemester", "toGrade", "toSemester", "uncertain", "uncertaintyReasons"],
      properties: { printedCourseName: { type: "string" }, curriculumCategory: nullable("string"), trackName: nullable("string"), placementType: { enum: ["exact", "year_only", "range", "unspecified"] }, grade: nullable("integer"), semester: term(), fromGrade: nullable("integer"), fromSemester: term(), toGrade: nullable("integer"), toSemester: term(), uncertain: { type: "boolean" }, uncertaintyReasons: strings() } } },
  } };

export async function POST(request: Request): Promise<Response> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return fail(503, "GEMINI_API_KEY가 서버에 설정되지 않았습니다.");
  let form: FormData; try { form = await request.formData(); } catch { return fail(400, "파일 업로드 형식이 올바르지 않습니다."); }
  const image = form.get("document");
  if (!(image instanceof File) || !["image/png", "image/jpeg", "image/webp"].includes(image.type)) return fail(400, "학과 한 페이지를 PNG, JPG 또는 WEBP 이미지로 올려 주세요.");
  if (!image.size || image.size > MAX_IMAGE_BYTES) return fail(400, "이미지는 15MB 이하여야 합니다.");

  const prompt = `대학 교과과정 로드맵 이미지를 직접 읽어 정규화하라. 입학연도 힌트=${String(form.get("academicYear") ?? "미입력")}, 학과코드 힌트=${String(form.get("programCode") ?? "미입력")}.
이미지에 실제로 인쇄된 과목만 위에서 아래, 왼쪽에서 오른쪽 순서로 한 번씩 추출한다. 각 박스 위치를 학년·학기 헤더와 직접 대조한다. 학기 열이 명시되면 exact, 학년만 명시되면 year_only, 명시적인 범위면 range, 없으면 unspecified다. 과목명이나 상식으로 학년·학기를 추정하지 않는다. 범례 색상은 curriculumCategory 또는 trackName으로 기록한다. OCR이나 위치가 애매하면 uncertain=true와 이유를 남긴다. 이미지에 없는 과목을 만들지 않는다.`;
  let response: Response;
  try {
    response = await fetch(GEMINI_URL, { method: "POST", headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" }, cache: "no-store",
      body: JSON.stringify({ model: "gemini-3.5-flash", input: [{ type: "text", text: prompt }, { type: "image", data: Buffer.from(await image.arrayBuffer()).toString("base64"), mime_type: image.type }], response_format: { type: "text", mime_type: "application/json", schema }, generation_config: { thinking_level: "minimal" } }),
    });
  } catch { return fail(502, "Gemini 비전 API에 연결하지 못했습니다."); }
  if (!response.ok) return fail(502, `Gemini 비전 분석에 실패했습니다. (${response.status})`);
  try {
    const output = outputText(await response.json());
    if (!output) return fail(502, "Gemini 응답에서 정규화 JSON을 찾지 못했습니다.");
    const roadmap = parseCurriculumRoadmap({ ...JSON.parse(output), sourceDocumentId: crypto.randomUUID(), status: "draft" });
    const courses = roadmap.courses.filter((course) => course.placement.type !== "unspecified");
    if (!courses.length) return fail(422, "과목명은 읽었지만 학년·학기 위치를 판별하지 못했습니다. 회전되지 않은 고해상도 학과 한 페이지 이미지를 올려 주세요.");
    return Response.json({ roadmap: { ...roadmap, courses } });
  } catch { return fail(502, "Gemini 로드맵 정규화 결과를 검증하지 못했습니다."); }
}
function outputText(body: unknown): string | null { if (!record(body)) return null; if (typeof body.output_text === "string") return body.output_text; if (!Array.isArray(body.outputs)) return null; for (const output of body.outputs) if (record(output) && Array.isArray(output.content)) for (const content of output.content) if (record(content) && typeof content.text === "string") return content.text; return null; }
function nullable(type: "integer" | "string") { return { type: [type, "null"] }; }
function term() { return { type: ["integer", "null"], enum: [1, 2, null] }; }
function strings() { return { type: "array", items: { type: "string" } }; }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function fail(status: number, message: string): Response { return Response.json({ error: { message } }, { status }); }
