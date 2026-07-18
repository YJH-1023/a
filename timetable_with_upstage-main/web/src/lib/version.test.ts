import { describe, expect, it } from "vitest";

import { APP_VERSION } from "./version";

describe("APP_VERSION", () => {
  it("is set", () => {
    expect(APP_VERSION).toBe("0.1.0");
  });
});
