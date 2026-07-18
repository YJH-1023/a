/**
 * GA4 event tracking. Every function here is a no-op until gtag is actually loaded (SSR, ad
 * blockers, or the Script tag not yet executed), so call sites never need to guard for that
 * themselves. Never pass file names, document contents, or any other identifying detail as an
 * event parameter — only event names and the fixed enum-like parameters listed per call site.
 */

type EventParams = Record<string, string | number | undefined>;

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

export function track(eventName: string, params: EventParams = {}): void {
  if (typeof window === "undefined" || typeof window.gtag !== "function") {
    return;
  }
  window.gtag("event", eventName, params);
}

let lastFieldFocused = "";
let sessionCompleted = false;

export function trackFieldFocus(fieldName: string): void {
  lastFieldFocused = fieldName;
  track("field_focus", { field_name: fieldName });
}

export function trackFieldComplete(fieldName: string, value: string): void {
  if (!value.trim()) {
    return;
  }
  track("field_complete", { field_name: fieldName });
}

/** Once a session reaches a meaningful outcome, a later tab-close is no longer a drop-off. */
export function markSessionCompleted(): void {
  sessionCompleted = true;
}

/** Call once near the app root. Returns a cleanup function for the calling effect. */
export function initAbandonTracking(): () => void {
  if (typeof document === "undefined") {
    return () => {};
  }
  const handleVisibilityChange = (): void => {
    if (document.visibilityState === "hidden" && !sessionCompleted) {
      track("form_abandon", { last_field_focused: lastFieldFocused || "(none)" });
    }
  };
  document.addEventListener("visibilitychange", handleVisibilityChange);
  return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
}
