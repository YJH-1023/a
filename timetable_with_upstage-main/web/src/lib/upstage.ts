const UPSTAGE_DOCUMENT_DIGITIZATION_URL = "https://api.upstage.ai/v1/document-digitization";
const UPSTAGE_CHAT_COMPLETIONS_URL = "https://api.upstage.ai/v1/chat/completions";

export { MAX_DOCUMENT_BYTES } from "./document-limits";

export type UpstageService = "document_parse" | "solar";
export type UpstageFailure = "unavailable" | "request_failed" | "invalid_response";

export class UpstageApiError extends Error {
  constructor(
    public readonly service: UpstageService,
    public readonly failure: UpstageFailure,
  ) {
    super(`${service}:${failure}`);
    this.name = "UpstageApiError";
  }
}

export function isPdf(document: File): boolean {
  return document.type === "application/pdf" || document.name.toLowerCase().endsWith(".pdf");
}

export function isAcademicDocument(document: File): boolean {
  const name = document.name.toLowerCase();
  return (
    isPdf(document) ||
    document.type === "image/png" ||
    document.type === "image/jpeg" ||
    name.endsWith(".png") ||
    name.endsWith(".jpg") ||
    name.endsWith(".jpeg")
  );
}

export async function parseDocumentWithUpstage(
  document: File,
  apiKey: string,
): Promise<unknown> {
  const formData = new FormData();
  formData.set("document", document, document.name);
  formData.set("model", "document-parse");
  formData.set("ocr", "auto");
  formData.set("coordinates", "true");
  formData.set("output_formats", '["html","markdown"]');

  let response: Response;
  try {
    response = await fetch(UPSTAGE_DOCUMENT_DIGITIZATION_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
      cache: "no-store",
    });
  } catch {
    throw new UpstageApiError("document_parse", "unavailable");
  }

  if (!response.ok) {
    throw new UpstageApiError("document_parse", "request_failed");
  }

  try {
    return await response.json();
  } catch {
    throw new UpstageApiError("document_parse", "invalid_response");
  }
}

export function getDocumentMarkdown(parsedDocument: unknown): string | null {
  if (!isRecord(parsedDocument) || !isRecord(parsedDocument.content)) {
    return null;
  }
  const markdown = parsedDocument.content.markdown;
  return typeof markdown === "string" && markdown.trim() ? markdown.trim() : null;
}

export interface SolarJsonSchema {
  name: string;
  schema: Record<string, unknown>;
}

/**
 * Optional strict JSON Schema for response_format. Verified live against solar-pro3
 * (2026-07-18): eliminates schema-shape drift (e.g. the model echoing the literal word
 * "string" or prompt text back as field values) but does not by itself make row selection
 * or status judgements consistent — callers that have a deterministic cross-check should
 * still prefer it over trusting Solar's own judgement fields.
 */
export async function requestSolarCompletion(
  systemPrompt: string,
  userPrompt: string,
  apiKey: string,
  jsonSchema?: SolarJsonSchema,
): Promise<string> {
  let response: Response;
  try {
    response = await fetch(UPSTAGE_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "solar-pro3",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        stream: false,
        ...(jsonSchema
          ? {
              response_format: {
                type: "json_schema",
                json_schema: { name: jsonSchema.name, schema: jsonSchema.schema, strict: true },
              },
            }
          : {}),
      }),
      cache: "no-store",
    });
  } catch {
    throw new UpstageApiError("solar", "unavailable");
  }

  if (!response.ok) {
    throw new UpstageApiError("solar", "request_failed");
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new UpstageApiError("solar", "invalid_response");
  }

  const content = getSolarMessageContent(body);
  if (!content) {
    throw new UpstageApiError("solar", "invalid_response");
  }
  return content;
}

function getSolarMessageContent(body: unknown): string | null {
  if (!isRecord(body) || !Array.isArray(body.choices)) {
    return null;
  }
  const firstChoice: unknown = body.choices[0];
  if (!isRecord(firstChoice) || !isRecord(firstChoice.message)) {
    return null;
  }
  const content = firstChoice.message.content;
  return typeof content === "string" && content.trim() ? content.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
