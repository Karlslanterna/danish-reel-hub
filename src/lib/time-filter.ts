export type TimePeriod = "morning" | "afternoon" | "evening" | "late";

const periodForMinutes = (minutes: number): TimePeriod => {
  if (minutes < 12 * 60) return "morning";
  if (minutes < 17 * 60) return "afternoon";
  if (minutes < 21 * 60) return "evening";
  return "late";
};

export function showtimeMatchesTimePeriod(times: string[], period: TimePeriod): boolean {
  return times.some((time) => {
    const match = time.match(/^(\d{1,2}):(\d{2})/);
    if (!match) return false;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) return false;
    return periodForMinutes(hours * 60 + minutes) === period;
  });
}
