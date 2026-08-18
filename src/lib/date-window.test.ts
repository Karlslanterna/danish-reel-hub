import { describe, expect, it } from "vitest";
import { addCalendarDays, cinemaDate, windowBounds, windowEnd, windowStart } from "./date-window";

describe("Danish cinema date window", () => {
  it("uses Copenhagen's date even when the UTC date is still yesterday", () => {
    const instant = new Date("2026-08-17T22:30:00.000Z");
    expect(cinemaDate(instant)).toBe("2026-08-18");
    expect(windowStart(instant)).toBe("2026-08-18");
    expect(windowEnd(instant)).toBe("2026-09-17");
  });

  it("adds calendar days safely across month and year boundaries", () => {
    expect(addCalendarDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addCalendarDays("2026-03-28", 2)).toBe("2026-03-30");
  });

  it("builds date-picker bounds from the same Danish dates", () => {
    const { from, to } = windowBounds(new Date("2026-08-17T22:30:00.000Z"));
    expect([from.getFullYear(), from.getMonth() + 1, from.getDate()]).toEqual([2026, 8, 18]);
    expect([to.getFullYear(), to.getMonth() + 1, to.getDate()]).toEqual([2026, 9, 17]);
  });
});
