import { sortShowtimes } from "@/lib/showtime-sort";

/**
 * One canonical screening row at the public read boundary. The public UI still
 * consumes grouped showtimes, so the adapter lives here independently of which
 * table the production loader currently reads.
 */
export type ScreeningReadRow = {
  movie_id: string;
  cinema_id: string;
  starts_at: string;
  local_date: string;
  local_time: string;
  hall: string;
  ticket_url: string | null;
  formats: string[] | null;
  languages: string[] | null;
  events: string[] | null;
};

export type UiShowtime = {
  movieId: string;
  cinemaId: string;
  date: string;
  times: string[];
  hall: string;
  bookingUrl: string | null;
  ticketUrls: string[];
  formats: string[];
  languages: string[];
  events: string[];
};

type ShowtimeGroup = UiShowtime & {
  slots: Array<{ time: string; startsAt: string; ticketUrl: string | null }>;
};

const addUnique = (target: string[], values: string[] | null | undefined) => {
  for (const value of values ?? []) if (value && !target.includes(value)) target.push(value);
};

/**
 * Convert one-row-per-screening canonical data into the unchanged UI contract.
 * Ticket URLs remain aligned with the exact screening after sorting.
 */
export function groupScreeningsForUi(rows: ScreeningReadRow[]): UiShowtime[] {
  const groups = new Map<string, ShowtimeGroup>();

  for (const row of rows) {
    const key = `${row.movie_id}|${row.cinema_id}|${row.local_date}|${row.hall}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        movieId: row.movie_id,
        cinemaId: row.cinema_id,
        date: row.local_date,
        times: [],
        hall: row.hall,
        bookingUrl: null,
        ticketUrls: [],
        formats: [],
        languages: [],
        events: [],
        slots: [],
      };
      groups.set(key, group);
    }

    group.slots.push({
      time: row.local_time.slice(0, 5),
      startsAt: row.starts_at,
      ticketUrl: row.ticket_url,
    });
    addUnique(group.formats, row.formats);
    addUnique(group.languages, row.languages);
    addUnique(group.events, row.events);
  }

  const result: UiShowtime[] = [];
  for (const group of groups.values()) {
    group.slots.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    const ticketUrls = group.slots.map((slot) => slot.ticketUrl ?? "");
    result.push({
      movieId: group.movieId,
      cinemaId: group.cinemaId,
      date: group.date,
      times: group.slots.map((slot) => slot.time),
      hall: group.hall,
      bookingUrl: group.slots.find((slot) => slot.ticketUrl)?.ticketUrl ?? null,
      ticketUrls,
      formats: group.formats,
      languages: group.languages,
      events: group.events,
    });
  }

  return sortShowtimes(result);
}
