import { useEffect, useRef } from "react";

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
  if (typeof window === "undefined") return;
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
