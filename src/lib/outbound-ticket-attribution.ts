const KULTUNAUT_TICKET_HOSTS = new Set(["kultunaut.dk", "www.kultunaut.dk"]);
const KULTUNAUT_TICKET_PATH = "/perl/billet/type-nynaut";

/**
 * Browser-only attribution for a short-lived sample of verified, real ticket links.
 *
 * A URL fragment is never included in the HTTP request to the ticket provider,
 * so the booking destination and all query parameters remain unchanged.
 */
const OUTBOUND_ATTRIBUTION_FRAGMENT = "lref-p5xw4utdpfy";
const ATTRIBUTED_KULTUNAUT_ARRANGEMENTS = new Set([
  "20238093",
  "20238096",
  "20238184",
  "20238194",
  "20238230",
  "20255503",
  "20255560",
  "20255649",
]);

export function addOutboundTicketAttribution(raw: string): string {
  try {
    const url = new URL(raw);
    const arrangementId = url.searchParams.get("ArrNr");
    if (
      KULTUNAUT_TICKET_HOSTS.has(url.hostname) &&
      url.pathname === KULTUNAUT_TICKET_PATH &&
      arrangementId &&
      ATTRIBUTED_KULTUNAUT_ARRANGEMENTS.has(arrangementId)
    ) {
      url.hash = OUTBOUND_ATTRIBUTION_FRAGMENT;
      return url.toString();
    }
  } catch {
    // URL validation remains the responsibility of the public read model.
  }
  return raw;
}
