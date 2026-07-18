import { describe, expect, it } from "vitest";

import {
  getClipboardImageFile,
  MAX_ACADEMIC_DOCUMENT_BYTES,
  validateAcademicDocumentFile,
} from "./academic-document-file";

describe("academic document file input", () => {
  it("accepts PDF and screenshot image files within the size limit", () => {
    expect(
      validateAcademicDocumentFile(new File(["pdf"], "record.pdf", { type: "application/pdf" })),
    ).toBeNull();
    expect(
      validateAcademicDocumentFile(new File(["png"], "clipboard.png", { type: "image/png" })),
    ).toBeNull();
  });

  it("rejects unsupported, empty, and oversized files", () => {
    expect(
      validateAcademicDocumentFile(new File(["text"], "record.txt", { type: "text/plain" })),
    ).toContain("PDF, PNG, JPG");
    expect(validateAcademicDocumentFile(new File([], "empty.png", { type: "image/png" }))).toContain(
      "1바이트",
    );
    const oversized = new File(["image"], "large.png", { type: "image/png" });
    Object.defineProperty(oversized, "size", { value: MAX_ACADEMIC_DOCUMENT_BYTES + 1 });
    expect(validateAcademicDocumentFile(oversized)).toContain("4MB");
  });

  it("finds the first image file in clipboard items", () => {
    const image = new File(["image"], "clipboard.png", { type: "image/png" });
    const result = getClipboardImageFile([
      { kind: "string", type: "text/plain", getAsFile: () => null },
      { kind: "file", type: "image/png", getAsFile: () => image },
    ]);

    expect(result).toBe(image);
    expect(
      getClipboardImageFile([{ kind: "string", type: "text/plain", getAsFile: () => null }]),
    ).toBeNull();
  });
});
