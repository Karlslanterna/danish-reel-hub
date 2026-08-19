import { useEffect, useRef } from "react";

export const ANALYTICS_OPT_OUT_KEY = "lanterna:analytics-opt-out";

type PreferenceStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const browserStorage = (): PreferenceStorage | null => {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

export function isAnalyticsOptedOut(storage: PreferenceStorage | null = browserStorage()): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(ANALYTICS_OPT_OUT_KEY) === "1";
  } catch {
    return false;
  }
}

export function setAnalyticsOptOut(
  excluded: boolean,
  storage: PreferenceStorage | null = browserStorage(),
): void {
  if (!storage) return;
  try {
    if (excluded) storage.setItem(ANALYTICS_OPT_OUT_KEY, "1");
    else storage.removeItem(ANALYTICS_OPT_OUT_KEY);
  } catch {
    // A blocked storage preference must never interrupt the admin page.
  }
}

export type AnalyticsEventType = "page_view" | "filter_change" | "zero_results" | "ticket_click";

export type AnalyticsEvent = {
  eventType: AnalyticsEventType;
  path?: string;
  itemType?: "movie" | "cinema";
  itemId?: string;
  filterName?: string;
  filterValue?: string;
  isActive?: boolean;
};

/**
 * Cookie-free, anonymous product measurement. No user identifier, IP address,
 * referrer or full destination URL is included in the event payload.
 */
export function trackAnalyticsEvent(event: AnalyticsEvent) {
  if (typeof window === "undefined" || isAnalyticsOptedOut()) return;
  const payload = JSON.stringify({
    ...event,
    path: event.path ?? window.location.pathname,
  });

  try {
    if (
      navigator.sendBeacon?.(
        "/api/public/analytics",
        new Blob([payload], { type: "application/json" }),
      )
    ) {
      return;
    }
    void fetch("/api/public/analytics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload,
      keepalive: true,
      credentials: "omit",
    });
  } catch {
    // Measurement must never interrupt the visitor experience.
  }
}

export function trackFilterChange(filterName: string, value: string | null, isActive: boolean) {
  trackAnalyticsEvent({
    eventType: "filter_change",
    filterName,
    filterValue: value ?? "all",
    isActive,
  });
}

/** Record one anonymous zero-result event per distinct active filter state. */
export function useTrackZeroResults(resultCount: number, active: boolean, signature: unknown) {
  const lastSignature = useRef("");
  useEffect(() => {
    if (!active || resultCount > 0) {
      lastSignature.current = "";
      return;
    }
    const value = JSON.stringify(signature);
    if (lastSignature.current === value) return;
    lastSignature.current = value;
    trackAnalyticsEvent({ eventType: "zero_results" });
  }, [active, resultCount, signature]);
}
