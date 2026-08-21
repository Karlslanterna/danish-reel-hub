import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addOutboundTicketAttribution } from "./outbound-ticket-attribution";
import { normalizeTicketUrl } from "./screening-read-model";

const NOW = new Date("2026-08-21T10:00:00.000Z");
const ATTRIBUTION_FRAGMENT = "#lref-v7m2q9k4dx";

const startEpoch = (date: string): number =>
  Math.floor(new Date(`${date}T12:00:00+02:00`).getTime() / 1000);

const ticketUrl = ({
  arrangementId = "20255503",
  date = "2026-08-23",
  host = "www.kultunaut.dk",
  path = "/perl/billet/type-nynaut",
}: {
  arrangementId?: string;
  date?: string;
  host?: string;
  path?: string;
} = {}) =>
  `http://${host}${path}?ArrNr=${arrangementId}&start=${startEpoch(date)}`;

describe("outbound ticket attribution", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("marks current sampled Kultunaut arrangements without a fixed id allowlist", () => {
    const raw = ticketUrl({ arrangementId: "20999993", date: "2026-08-23" });

    expect(addOutboundTicketAttribution(raw)).toBe(`${raw}${ATTRIBUTION_FRAGMENT}`);
    expect(normalizeTicketUrl(raw)).toBe(`${raw}${ATTRIBUTION_FRAGMENT}`);
  });

  it("marks only screenings two through nine Danish calendar days ahead", () => {
    for (const date of ["2026-08-23", "2026-08-30"]) {
      const raw = ticketUrl({ date });
      expect(addOutboundTicketAttribution(raw)).toBe(`${raw}${ATTRIBUTION_FRAGMENT}`);
    }

    for (const date of ["2026-08-22", "2026-08-31"]) {
      const raw = ticketUrl({ date });
      expect(addOutboundTicketAttribution(raw)).toBe(raw);
    }
  });

  it("leaves non-sampled arrangements, other hosts and other paths unchanged", () => {
    const nonSampled = ticketUrl({ arrangementId: "20255504" });
    const otherHost = ticketUrl({ host: "example.com" });
    const otherPath = ticketUrl({ path: "/perl/billet/other" });

    expect(addOutboundTicketAttribution(nonSampled)).toBe(nonSampled);
    expect(addOutboundTicketAttribution(otherHost)).toBe(otherHost);
    expect(addOutboundTicketAttribution(otherPath)).toBe(otherPath);
    expect(normalizeTicketUrl(nonSampled)).toBe(nonSampled);
  });

  it("does not change the provider request URL or query parameters", () => {
    const raw = ticketUrl();
    const attributed = addOutboundTicketAttribution(raw);
    const before = new URL(raw);
    const after = new URL(attributed);

    expect(`${after.origin}${after.pathname}${after.search}`).toBe(
      `${before.origin}${before.pathname}${before.search}`,
    );
    expect(after.hash).toBe(ATTRIBUTION_FRAGMENT);
  });

  it("stops attributing automatically after the short-lived canary period", () => {
    const raw = ticketUrl({ date: "2026-09-10" });
    const afterExpiry = new Date("2026-09-08T10:00:00.000Z");

    expect(addOutboundTicketAttribution(raw, afterExpiry)).toBe(raw);
  });
});
