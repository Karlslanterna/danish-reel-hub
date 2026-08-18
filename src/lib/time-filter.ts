export type TimePeriod = "morning" | "afternoon" | "evening" | "late";

const periodForMinutes = (minutes: number): TimePeriod => {
  if (minutes < 12 * 60) return "morning";
  if (minutes < 17 * 60) return "afternoon";
  if (minutes < 21 * 60) return "evening";
  return "late";
};

export function timePeriodForTime(time: string): TimePeriod | null {
  const match = time.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return periodForMinutes(hours * 60 + minutes);
}

export function timeMatchesTimePeriod(time: string, period: TimePeriod): boolean {
  return timePeriodForTime(time) === period;
}

export function showtimeMatchesTimePeriod(times: string[], period: TimePeriod): boolean {
  return times.some((time) => timeMatchesTimePeriod(time, period));
}

/** Keep ticket URLs aligned when a grouped row is narrowed to a time period. */
export function filterShowtimeTimesByPeriod<
  T extends { times: string[]; ticketUrls?: Array<string | null> },
>(row: T, period: TimePeriod): T | null {
  const indexes = row.times
    .map((time, index) => (timeMatchesTimePeriod(time, period) ? index : -1))
    .filter((index) => index >= 0);
  if (indexes.length === 0) return null;
  return {
    ...row,
    times: indexes.map((index) => row.times[index]),
    ...(row.ticketUrls
      ? { ticketUrls: indexes.map((index) => row.ticketUrls?.[index] ?? null) }
      : {}),
  };
}
