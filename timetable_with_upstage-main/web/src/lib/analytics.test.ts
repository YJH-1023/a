import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  initAbandonTracking,
  markSessionCompleted,
  track,
  trackFieldComplete,
  trackFieldFocus,
} from "./analytics";

// This project's test suite runs under Node (no jsdom), matching every other lib test here —
// analytics.ts only needs `window.gtag` and a `document` with addEventListener, so minimal
// stand-ins are cheaper than adding a browser DOM environment for one file.
function stubWindow(): { gtag: ReturnType<typeof vi.fn> } {
  const gtag = vi.fn();
  (globalThis as { window?: unknown }).window = { gtag };
  return { gtag };
}

function clearStubWindow(): void {
  delete (globalThis as { window?: unknown }).window;
}

describe("track", () => {
  afterEach(clearStubWindow);

  it("does nothing when window/gtag is not available", () => {
    expect(() => track("profile_applied")).not.toThrow();
  });

  it("forwards the event name and params to gtag when it is available", () => {
    const { gtag } = stubWindow();

    track("ai_recommend_done", { duration_ms: 1234 });

    expect(gtag).toHaveBeenCalledWith("event", "ai_recommend_done", { duration_ms: 1234 });
  });
});

describe("field tracking", () => {
  afterEach(clearStubWindow);

  it("sends field_focus with the field name", () => {
    const { gtag } = stubWindow();
    trackFieldFocus("department");
    expect(gtag).toHaveBeenCalledWith("event", "field_focus", { field_name: "department" });
  });

  it("skips field_complete for a blank value", () => {
    const { gtag } = stubWindow();
    trackFieldComplete("admission_year", "  ");
    expect(gtag).not.toHaveBeenCalled();
  });

  it("sends field_complete for a non-blank value", () => {
    const { gtag } = stubWindow();
    trackFieldComplete("admission_year", "2023");
    expect(gtag).toHaveBeenCalledWith("event", "field_complete", { field_name: "admission_year" });
  });
});

describe("initAbandonTracking", () => {
  let listeners: Map<string, (event: unknown) => void>;
  let visibilityState: "visible" | "hidden";

  beforeEach(() => {
    listeners = new Map();
    visibilityState = "visible";
    (globalThis as { document?: unknown }).document = {
      get visibilityState() {
        return visibilityState;
      },
      addEventListener: (type: string, handler: (event: unknown) => void) => {
        listeners.set(type, handler);
      },
      removeEventListener: (type: string) => {
        listeners.delete(type);
      },
    };
  });

  afterEach(() => {
    clearStubWindow();
    delete (globalThis as { document?: unknown }).document;
  });

  function hideTab(): void {
    visibilityState = "hidden";
    listeners.get("visibilitychange")?.(new Event("visibilitychange"));
  }

  it("sends form_abandon with the last focused field when the tab is hidden before completion", () => {
    const { gtag } = stubWindow();
    const stop = initAbandonTracking();
    trackFieldFocus("department");
    gtag.mockClear();

    hideTab();

    expect(gtag).toHaveBeenCalledWith("event", "form_abandon", { last_field_focused: "department" });
    stop();
  });

  it("does not send form_abandon once the session is marked completed", () => {
    const { gtag } = stubWindow();
    const stop = initAbandonTracking();
    trackFieldFocus("department");
    markSessionCompleted();
    gtag.mockClear();

    hideTab();

    expect(gtag).not.toHaveBeenCalledWith("event", "form_abandon", expect.anything());
    stop();
  });
});
