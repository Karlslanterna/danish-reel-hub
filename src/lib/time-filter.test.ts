import { describe, expect, it } from "vitest";
import { filterShowtimeTimesByPeriod, showtimeMatchesTimePeriod } from "./time-filter";

describe("showtimeMatchesTimePeriod", () => {
  it("uses the agreed boundaries", () => {
    expect(showtimeMatchesTimePeriod(["11:59"], "morning")).toBe(true);
    expect(showtimeMatchesTimePeriod(["12:00", "16:59"], "afternoon")).toBe(true);
    expect(showtimeMatchesTimePeriod(["17:00", "20:59"], "evening")).toBe(true);
    expect(showtimeMatchesTimePeriod(["21:00"], "late")).toBe(true);
  });

  it("matches when at least one screening is in the selected period", () => {
    expect(showtimeMatchesTimePeriod(["10:00", "18:30"], "evening")).toBe(true);
    expect(showtimeMatchesTimePeriod(["10:00", "18:30"], "late")).toBe(false);
  });
});

describe("filterShowtimeTimesByPeriod", () => {
  it("removes non-matching slots and keeps ticket URLs aligned", () => {
    expect(
      filterShowtimeTimesByPeriod(
        {
          times: ["11:30", "12:00", "17:00", "21:00"],
          ticketUrls: ["morning", "afternoon", "evening", "late"],
        },
        "evening",
      ),
    ).toEqual({ times: ["17:00"], ticketUrls: ["evening"] });
  });

  it("returns null when a grouped screening has no matching slot", () => {
    expect(filterShowtimeTimesByPeriod({ times: ["10:00"] }, "late")).toBeNull();
  });
});
