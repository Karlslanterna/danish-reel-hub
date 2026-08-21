import { describe, expect, it } from "vitest";
import { addOutboundTicketAttribution } from "./outbound-ticket-attribution";
import { normalizeTicketUrl } from "./screening-read-model";

const ATTRIBUTION_FRAGMENT = "#lref-p5xw4utdpfy";
const TARGET_ARRANGEMENTS = [
  "20238093",
  "20238096",
  "20238184",
  "20238194",
  "20238230",
  "20255503",
  "20255560",
  "20255649",
];

describe("outbound ticket attribution", () => {
  it("adds the browser-only fragment to every selected Kultunaut arrangement", () => {
    for (const arrangementId of TARGET_ARRANGEMENTS) {
      const raw =
        `http://www.kultunaut.dk/perl/billet/type-nynaut?ArrNr=${arrangementId}` +
        "&start=1787401200";
      expect(addOutboundTicketAttribution(raw)).toBe(`${raw}${ATTRIBUTION_FRAGMENT}`);
      expect(normalizeTicketUrl(raw)).toBe(`${raw}${ATTRIBUTION_FRAGMENT}`);
    }
  });

  it("does not change the provider request URL or query parameters", () => {
    const raw =
      "http://www.kultunaut.dk/perl/billet/type-nynaut" +
      "?ArrNr=20238093&start=1787401200";
    const attributed = addOutboundTicketAttribution(raw);
    const before = new URL(raw);
    const after = new URL(attributed);

    expect(`${after.origin}${after.pathname}${after.search}`).toBe(
      `${before.origin}${before.pathname}${before.search}`,
    );
    expect(after.hash).toBe(ATTRIBUTION_FRAGMENT);
  });

  it("leaves other arrangements and hosts byte-for-byte unchanged", () => {
    const otherArrangement =
      "http://www.kultunaut.dk/perl/billet/type-nynaut" +
      "?ArrNr=20238094&start=1787401200";
    const otherHost =
      "https://example.com/perl/billet/type-nynaut" +
      "?ArrNr=20238093&start=1787401200";

    expect(addOutboundTicketAttribution(otherArrangement)).toBe(otherArrangement);
    expect(addOutboundTicketAttribution(otherHost)).toBe(otherHost);
    expect(normalizeTicketUrl(otherArrangement)).toBe(otherArrangement);
  });
});
