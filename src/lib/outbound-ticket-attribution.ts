import { addCalendarDays, cinemaDate } from "@/lib/date-window";

const KULTUNAUT_TICKET_HOSTS = new Set(["kultunaut.dk", "www.kultunaut.dk"]);
const KULTUNAUT_TICKET_PATH = "/perl/billet/type-nynaut";

/**
 * Browser-only attribution for a short-lived, deterministic sample of real
 * Kultunaut ticket links.
 *
 * Arrangement ids are reissued by the source, so the sample is selected from
 * each current import instead of keeping a fixed allowlist. A URL fragment is
 * never included in the HTTP request to the ticket provider, so the booking
 * destination and every query parameter remain unchanged.
 */
const OUTBOUND_ATTRIBUTION_FRAGMENT = "lref-v7m2q9k4dx";
const CANARY_ACTIVE_FROM = "2026-08-21";
const CANARY_ACTIVE_THROUGH = "2026-09-07";
const CANARY_MIN_DAYS_AHEAD = 2;
const CANARY_MAX_DAYS_AHEAD = 9;
const SAMPLED_ARRANGEMENT_LAST_DIGIT = "3";

const isPositiveInteger = (value: string | null): value is string =>
  Boolean(value && /^\d+$/.test(value) && Number(value) > 0);

function isCurrentCanarySample(url: URL, now: Date): boolean {
  const arrangementId = url.searchParams.get("ArrNr");
  const startValue = url.searchParams.get("start");
  if (!isPositiveInteger(arrangementId) || !isPositiveInteger(startValue)) return false;
  if (!arrangementId.endsWith(SAMPLED_ARRANGEMENT_LAST_DIGIT)) return false;

  const today = cinemaDate(now);
  if (today < CANARY_ACTIVE_FROM || today > CANARY_ACTIVE_THROUGH) return false;

  const startSeconds = Number(startValue);
  if (!Number.isSafeInteger(startSeconds)) return false;
  const screeningDate = cinemaDate(new Date(startSeconds * 1000));
  return (
    screeningDate >= addCalendarDays(today, CANARY_MIN_DAYS_AHEAD) &&
    screeningDate <= addCalendarDays(today, CANARY_MAX_DAYS_AHEAD)
  );
}

export function addOutboundTicketAttribution(raw: string, now: Date = new Date()): string {
  try {
    const url = new URL(raw);
    if (
      KULTUNAUT_TICKET_HOSTS.has(url.hostname) &&
      url.pathname === KULTUNAUT_TICKET_PATH &&
      isCurrentCanarySample(url, now)
    ) {
      url.hash = OUTBOUND_ATTRIBUTION_FRAGMENT;
      return url.toString();
    }
  } catch {
    // URL validation remains the responsibility of the public read model.
  }
  return raw;
}
