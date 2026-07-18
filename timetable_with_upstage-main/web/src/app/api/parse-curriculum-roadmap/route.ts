import { parseCurriculumRoadmap, validateRoadmapForTarget } from "../../../lib/curriculum-roadmap";

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const schema = { type: "object", additionalProperties: false,
  required: ["academicYear", "programCode", "programName", "layoutType", "courses", "reviewReasons"],
  properties: { academicYear: nullable("integer"), programCode: nullable("string"), programName: nullable("string"), layoutType: { enum: ["semester_grid", "year_grid", "track_map", "mixed", "unknown"] }, reviewReasons: strings(),
    courses: { type: "array", items: { type: "object", additionalProperties: false,
      required: ["printedCourseName", "curriculumCategory", "trackName", "placementType", "grade", "semester", "fromGrade", "fromSemester", "toGrade", "toSemester", "uncertain", "uncertaintyReasons", "sourceEvidence"],
      properties: { printedCourseName: { type: "string" }, curriculumCategory: nullable("string"), trackName: nullable("string"), placementType: { enum: ["exact", "year_only", "range", "unspecified"] }, grade: nullable("integer"), semester: term(), fromGrade: nullable("integer"), fromSemester: term(), toGrade: nullable("integer"), toSemester: term(), uncertain: { type: "boolean" }, uncertaintyReasons: strings(), sourceEvidence: nullable("string") } } },
  } };

export async function POST(request: Request): Promise<Response> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return fail(503, "GEMINI_API_KEY가 서버에 설정되지 않았습니다.");
  let form: FormData; try { form = await request.formData(); } catch { return fail(400, "파일 업로드 형식이 올바르지 않습니다."); }
  const image = form.get("document");
  if (!(image instanceof File) || !["image/png", "image/jpeg", "image/webp"].includes(image.type)) return fail(400, "학과 한 페이지를 PNG, JPG 또는 WEBP 이미지로 올려 주세요.");
  if (!image.size || image.size > MAX_IMAGE_BYTES) return fail(400, "이미지는 15MB 이하여야 합니다.");

  const selectedYear = Number(form.get("academicYear"));
  const selectedCode = String(form.get("programCode") ?? "").trim();
  const currentGrade = Number(form.get("currentGrade"));
  const selectedSemester = Number(form.get("semester"));
  if (!Number.isInteger(selectedYear) || !selectedCode || !Number.isInteger(currentGrade) || (selectedSemester !== 1 && selectedSemester !== 2)) {
    return fail(400, "입학연도·학과·현재 학년·조회 학기를 먼저 적용해 주세요.");
  }
  const prompt = `대학 교과과정 로드맵 이미지에서 오직 ${currentGrade}학년 ${selectedSemester}학기 칸에 직접 배치된 과목만 추출하라.
사용자 입학연도는 ${selectedYear}년이고 학과코드는 ${selectedCode}이다. 이미지에 '2021학번 이후'처럼 시작 연도와 '이후'가 표시되면 ${selectedYear}가 그 연도 이상일 때 적용되는 로드맵이다.
먼저 상단의 학년 헤더에서 '${currentGrade}학년' 영역을 찾고, 그 안의 '${selectedSemester}학기' 세로 열 경계를 찾는다. 그 열 경계 안에 중심점이 있는 과목 박스만 courses에 넣는다. 다른 학년, 다른 학기, 화면 하단 범례/대체교과목/실험실습 목록은 절대 넣지 않는다. 화살표로 연결됐더라도 목표 열 밖이면 넣지 않는다. 각 과목의 sourceEvidence에는 확인한 위치를 짧게 적는다(예: "3학년 > 2학기 열"). 실제로 해당 칸임이 보일 때만 placementType=exact, grade=${currentGrade}, semester=${selectedSemester}로 기록한다. 학년만 보이면 year_only, 위치를 판단할 수 없으면 unspecified로 기록하며 값을 추정하지 않는다. 이미지에 인쇄된 과목명을 그대로 사용하고 중복을 제거한다. 경계에 걸치거나 글자가 불명확하면 uncertain=true와 이유를 남긴다. 이미지에 없는 과목을 만들지 않는다.`;
  let response: Response;
  try {
    response = await fetch(GEMINI_URL, { method: "POST", headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" }, cache: "no-store",
      body: JSON.stringify({ model: "gemini-3.5-flash", store: false, input: [{ type: "text", text: prompt }, { type: "image", data: Buffer.from(await image.arrayBuffer()).toString("base64"), mime_type: image.type }], response_format: { type: "text", mime_type: "application/json", schema }, generation_config: { thinking_level: "minimal" } }),
    });
  } catch { return fail(502, "Gemini 비전 API에 연결하지 못했습니다."); }
  if (!response.ok) return fail(502, `Gemini 비전 분석에 실패했습니다. (${response.status})`);
  try {
    const output = outputText(await response.json());
    if (!output) return fail(502, "Gemini 응답에서 정규화 JSON을 찾지 못했습니다.");
    const parsedOutput: unknown = JSON.parse(stripJsonFence(output));
    if (!record(parsedOutput)) return fail(502, "Gemini 로드맵 JSON이 객체 형식이 아닙니다.");
    const roadmap = parseCurriculumRoadmap({
      ...parsedOutput,
      academicYear: Number.isInteger(selectedYear) ? selectedYear : parsedOutput.academicYear,
      programCode: selectedCode || parsedOutput.programCode,
      sourceDocumentId: crypto.randomUUID(),
      status: "draft",
    });
    const validated = validateRoadmapForTarget(roadmap, { currentGrade, semester: selectedSemester as 1 | 2 });
    const courses = validated.courses;
    if (!courses.length) return fail(422, `${currentGrade}학년 ${selectedSemester}학기에 해당하는 과목을 이미지에서 찾지 못했습니다. 학년·학기 헤더가 모두 보이는 고해상도 이미지를 확인해 주세요.`);
    return Response.json({ roadmap: validated });
  } catch { return fail(502, "Gemini 로드맵 정규화 결과를 검증하지 못했습니다."); }
}
function outputText(body: unknown): string | null {
  if (!record(body)) return null;
  if (typeof body.output_text === "string") return body.output_text;
  const containers = [body.steps, body.outputs, body.output];
  for (const container of containers) {
    if (!Array.isArray(container)) continue;
    for (const step of container) {
      if (!record(step) || !Array.isArray(step.content)) continue;
      for (const content of step.content) {
        if (record(content) && typeof content.text === "string" && content.text.trim()) {
          return content.text;
        }
      }
    }
  }
  return null;
}
function stripJsonFence(value: string): string {
  return value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}
function nullable(type: "integer" | "string") { return { type: [type, "null"] }; }
function term() { return { type: ["integer", "null"], enum: [1, 2, null] }; }
function strings() { return { type: "array", items: { type: "string" } }; }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function fail(status: number, message: string): Response { return Response.json({ error: { message } }, { status }); }
