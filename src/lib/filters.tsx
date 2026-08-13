import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Plus, ChevronRight, ArrowLeft } from "lucide-react";
import { useLanguage, type Lang } from "@/lib/i18n";
import { sortTagOptions } from "@/lib/showtime-tags";
import { slugifyCity } from "@/lib/city-slug";
import { useNavigate, useRouterState } from "@tanstack/react-router";

export type Radius = 2 | 5 | 10 | 25 | 50 | "all";

export const RADIUS_OPTIONS: Array<{ value: Radius; label: string }> = [
  { value: 2, label: "2 km" },
  { value: 5, label: "5 km" },
  { value: 10, label: "10 km" },
  { value: 25, label: "25 km" },
  { value: 50, label: "50 km" },
  { value: "all", label: "Hele Danmark" },
];

export type GeoStatus = "idle" | "prompt" | "granted" | "denied" | "unavailable" | "timeout" | "unsupported";

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

const todayStr = () => new Date().toISOString().split("T")[0];
const tomorrowStr = () => new Date(Date.now() + 86400000).toISOString().split("T")[0];

export function fmtDateLabel(date: string | null, lang: Lang = "da") {
  const en = lang === "en";
  if (!date) return en ? "Date" : "Dato";
  if (date === todayStr()) return en ? "Today" : "I dag";
  if (date === tomorrowStr()) return en ? "Tomorrow" : "I morgen";
  return new Date(date + "T12:00:00").toLocaleDateString(en ? "en-GB" : "da-DK", { day: "numeric", month: "short" });
}

type Loc = { lat: number; lng: number };

/** Minimal cinema shape the filter UI needs. */
export type CinemaFilterOption = { id: string; slug: string; name: string; city: string };

type FiltersState = {
  radius: Radius;
  userLoc: Loc | null;
  selectedDate: string | null;
  selectedGenre: string | null;
  selectedFormat: string | null;
  selectedLanguage: string | null;
  selectedEvent: string | null;
  selectedCity: string | null;
  selectedCinemaId: string | null;
  selectedCinemaSlug: string | null;
  selectedCinemaName: string | null;
  geoStatus: GeoStatus;
  geoLoading: boolean;
  setRadius: (r: Radius) => void;
  setSelectedDate: (d: string | null) => void;
  setSelectedGenre: (g: string | null) => void;
  setSelectedFormat: (v: string | null) => void;
  setSelectedLanguage: (v: string | null) => void;
  setSelectedEvent: (v: string | null) => void;
  setSelectedCity: (v: string | null) => void;
  setSelectedCinema: (c: CinemaFilterOption | null) => void;
  requestLocation: (onSuccess?: () => void) => void;
  dismissGeo: () => void;
  clear: () => void;
};

const FiltersContext = createContext<FiltersState | null>(null);

const STORAGE_KEY = "lanterna.filters.v1";

type Persisted = {
  radius: Radius;
  userLoc: Loc | null;
  selectedDate: string | null;
  selectedGenre: string | null;
  selectedFormat: string | null;
  selectedLanguage: string | null;
  selectedEvent: string | null;
  selectedCity: string | null;
  selectedCinemaId: string | null;
  selectedCinemaSlug: string | null;
  selectedCinemaName: string | null;
};

const EMPTY_PERSISTED: Persisted = {
  radius: "all",
  userLoc: null,
  selectedDate: null,
  selectedGenre: null,
  selectedFormat: null,
  selectedLanguage: null,
  selectedEvent: null,
  selectedCity: null,
  selectedCinemaId: null,
  selectedCinemaSlug: null,
  selectedCinemaName: null,
};

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

function loadPersisted(): Persisted {
  if (typeof window === "undefined") return EMPTY_PERSISTED;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_PERSISTED;
    const p = JSON.parse(raw) as Partial<Persisted>;
    const radius: Radius = p.radius === "all" || (typeof p.radius === "number" && [2, 5, 10, 25, 50].includes(p.radius)) ? (p.radius as Radius) : "all";
    const userLoc = p.userLoc && typeof p.userLoc.lat === "number" && typeof p.userLoc.lng === "number" ? p.userLoc : null;
    let selectedDate = typeof p.selectedDate === "string" ? p.selectedDate : null;
    const selectedGenre = typeof p.selectedGenre === "string" && p.selectedGenre.length > 0 ? p.selectedGenre : null;
    // drop past dates
    if (selectedDate && selectedDate < todayStr()) selectedDate = null;
    return {
      radius,
      userLoc,
      selectedDate,
      selectedGenre,
      selectedFormat: str(p.selectedFormat),
      selectedLanguage: str(p.selectedLanguage),
      selectedEvent: str(p.selectedEvent),
      selectedCity: str(p.selectedCity),
      selectedCinemaId: str(p.selectedCinemaId),
      selectedCinemaSlug: str(p.selectedCinemaSlug),
      selectedCinemaName: str(p.selectedCinemaName),
    };
  } catch {
    return EMPTY_PERSISTED;
  }
}

export function FiltersProvider({ children }: { children: ReactNode }) {
  const [radius, setRadiusState] = useState<Radius>("all");
  const [userLoc, setUserLoc] = useState<Loc | null>(null);
  const [selectedDate, setSelectedDateState] = useState<string | null>(null);
  const [selectedGenre, setSelectedGenreState] = useState<string | null>(null);
  const [selectedFormat, setSelectedFormatState] = useState<string | null>(null);
  const [selectedLanguage, setSelectedLanguageState] = useState<string | null>(null);
  const [selectedEvent, setSelectedEventState] = useState<string | null>(null);
  const [selectedCity, setSelectedCityState] = useState<string | null>(null);
  const [selectedCinemaId, setSelectedCinemaIdState] = useState<string | null>(null);
  const [selectedCinemaSlug, setSelectedCinemaSlugState] = useState<string | null>(null);
  const [selectedCinemaName, setSelectedCinemaNameState] = useState<string | null>(null);
  const [geoStatus, setGeoStatus] = useState<GeoStatus>("idle");
  const [geoLoading, setGeoLoading] = useState(false);

  // Hydrate from localStorage on client
  useEffect(() => {
    const p = loadPersisted();
    setRadiusState(p.radius);
    setUserLoc(p.userLoc);
    setSelectedDateState(p.selectedDate);
    setSelectedGenreState(p.selectedGenre);
    setSelectedFormatState(p.selectedFormat);
    setSelectedLanguageState(p.selectedLanguage);
    setSelectedEventState(p.selectedEvent);
    setSelectedCityState(p.selectedCity);
    setSelectedCinemaIdState(p.selectedCinemaId);
    setSelectedCinemaSlugState(p.selectedCinemaSlug);
    setSelectedCinemaNameState(p.selectedCinemaName);
  }, []);

  // Persist
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ radius, userLoc, selectedDate, selectedGenre, selectedFormat, selectedLanguage, selectedEvent, selectedCity, selectedCinemaId, selectedCinemaSlug, selectedCinemaName }),
      );
    } catch { /* ignore */ }
  }, [radius, userLoc, selectedDate, selectedGenre, selectedFormat, selectedLanguage, selectedEvent, selectedCity, selectedCinemaId, selectedCinemaSlug, selectedCinemaName]);

  // Watch for geolocation permission changes so a previously saved location is not used after the user revokes access.
  // Only surface a notice automatically when a location filter was actually active; otherwise wait for user interaction.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("permissions" in navigator)) return;
    let cleanup: (() => void) | undefined;
    const run = async () => {
      try {
        const res = await (navigator as unknown as { permissions: { query: (o: unknown) => Promise<{ state: string; addEventListener: (type: string, fn: () => void) => void; removeEventListener: (type: string, fn: () => void) => void }> } }).permissions.query({ name: "geolocation" });
        const onChange = () => {
          if (res.state === "denied") {
            setUserLoc(null);
            setRadiusState("all");
            setGeoStatus((prev) => (prev === "granted" || prev === "prompt" ? "denied" : prev));
          }
        };
        onChange();
        res.addEventListener("change", onChange);
        cleanup = () => res.removeEventListener("change", onChange);
      } catch { /* ignore */ }
    };
    run();
    return () => cleanup?.();
  }, []);

  const clearCinema = useCallback(() => {
    setSelectedCinemaIdState(null);
    setSelectedCinemaSlugState(null);
    setSelectedCinemaNameState(null);
  }, []);

  // "Near me" and a specific cinema are mutually exclusive filters.
  const setRadius = useCallback((r: Radius) => {
    setRadiusState(r);
    if (r !== "all") clearCinema();
  }, [clearCinema]);
  const setSelectedDate = useCallback((d: string | null) => setSelectedDateState(d), []);
  const setSelectedGenre = useCallback((g: string | null) => setSelectedGenreState(g), []);
  const setSelectedFormat = useCallback((v: string | null) => setSelectedFormatState(v), []);
  const setSelectedLanguage = useCallback((v: string | null) => setSelectedLanguageState(v), []);
  const setSelectedEvent = useCallback((v: string | null) => setSelectedEventState(v), []);
  const setSelectedCity = useCallback((v: string | null) => setSelectedCityState(v), []);
  const dismissGeo = useCallback(() => setGeoStatus("idle"), []);

  const requestLocation = useCallback((onSuccess?: () => void) => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setGeoStatus("unsupported");
      return;
    }
    const run = async () => {
      try {
        if ("permissions" in navigator) {
          const res = await (navigator as unknown as { permissions: { query: (o: unknown) => Promise<{ state: string }> } }).permissions.query({ name: "geolocation" });
          if (res.state === "denied") {
            setGeoStatus("denied");
            setRadiusState("all");
            return;
          }
        }
      } catch { /* fall through to getCurrentPosition */ }
      setGeoLoading(true);
      setGeoStatus("prompt");
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setUserLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          setGeoStatus("granted");
          setGeoLoading(false);
          onSuccess?.();
        },
        (err) => {
          let status: GeoStatus = "unavailable";
          if (err.code === err.PERMISSION_DENIED) status = "denied";
          else if (err.code === err.TIMEOUT) status = "timeout";
          setGeoStatus(status);
          setGeoLoading(false);
          setRadiusState("all");
        },
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
      );
    };
    run();
  }, []);

  const clear = useCallback(() => {
    setRadiusState("all");
    setSelectedDateState(null);
    setSelectedGenreState(null);
    setSelectedFormatState(null);
    setSelectedLanguageState(null);
    setSelectedEventState(null);
    setSelectedCityState(null);
    setGeoStatus("idle");
  }, []);

  const value = useMemo<FiltersState>(
    () => ({
      radius, userLoc, selectedDate, selectedGenre, selectedFormat, selectedLanguage, selectedEvent, selectedCity,
      geoStatus, geoLoading,
      setRadius, setSelectedDate, setSelectedGenre, setSelectedFormat, setSelectedLanguage, setSelectedEvent, setSelectedCity,
      requestLocation, dismissGeo, clear,
    }),
    [radius, userLoc, selectedDate, selectedGenre, selectedFormat, selectedLanguage, selectedEvent, selectedCity, geoStatus, geoLoading, setRadius, setSelectedDate, setSelectedGenre, setSelectedFormat, setSelectedLanguage, setSelectedEvent, setSelectedCity, requestLocation, dismissGeo, clear],
  );

  return <FiltersContext.Provider value={value}>{children}</FiltersContext.Provider>;
}

export function useFilters() {
  const ctx = useContext(FiltersContext);
  if (!ctx) throw new Error("useFilters must be used within FiltersProvider");
  return ctx;
}

const OPEN_CITY_FILTER_EVENT = "lanterna:open-city-filter";

export function GeoNotice({ className = "" }: { className?: string }) {
  const { geoStatus, geoLoading, requestLocation, dismissGeo } = useFilters();
  const { t } = useLanguage();
  const [cityFilterFound, setCityFilterFound] = useState(false);

  useEffect(() => {
    if (typeof document === "undefined") return;
    setCityFilterFound(Boolean(document.querySelector("[data-more-filters-trigger]")));
  }, []);

  if (geoLoading) return null;
  if (geoStatus === "idle" || geoStatus === "granted" || geoStatus === "prompt") return null;

  const titleKey: Parameters<typeof t>[0] =
    geoStatus === "denied" ? "geo.denied" :
    geoStatus === "unsupported" ? "geo.unsupported" :
    geoStatus === "timeout" ? "geo.timeout" : "geo.unavailable";

  const explainKey: Parameters<typeof t>[0] =
    geoStatus === "denied" || geoStatus === "unsupported" ? "geo.explain" : "geo.explainNoConnection";

  const openCityFilter = () => {
    dismissGeo();
    if (typeof document === "undefined") return;
    document.dispatchEvent(new CustomEvent(OPEN_CITY_FILTER_EVENT, { bubbles: true }));
  };

  return (
    <div className={`rounded-md border border-border bg-card/80 p-3 text-sm ${className}`} role="status" aria-live="polite">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0 text-primary">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2c0 7.3-8 11.8-8 11.8z" />
            <circle cx="12" cy="10" r="3" />
            {geoStatus === "denied" && <line x1="2" y1="2" x2="22" y2="22" />}
          </svg>
        </div>
        <div className="flex-1">
          <p className="font-medium text-foreground">{t(titleKey)}</p>
          <p className="mt-1 text-muted-foreground">{t(explainKey)}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {geoStatus !== "unsupported" && (
              <button
                type="button"
                onClick={() => requestLocation()}
                className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-medium uppercase tracking-[0.1em] text-primary-foreground transition-colors hover:bg-primary/90"
              >
                {t("geo.retry")}
              </button>
            )}
            {cityFilterFound && (
              <button
                type="button"
                onClick={openCityFilter}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium uppercase tracking-[0.1em] text-foreground transition-colors hover:bg-secondary"
              >
                {t("geo.pickCity")}
              </button>
            )}
            <button
              type="button"
              onClick={dismissGeo}
              className="text-xs uppercase tracking-[0.1em] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              {t("geo.close")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function FilterBar({
  className = "",
  hideRadius = false,
  genres,
  formats,
  languages,
  events,
  cities,
}: {
  className?: string;
  hideRadius?: boolean;
  genres?: string[];
  formats?: string[];
  languages?: string[];
  events?: string[];
  cities?: Array<{ value: string; count: number }>;
}) {
  const {
    radius, userLoc, selectedDate, selectedGenre, selectedFormat, selectedLanguage, selectedEvent, selectedCity,
    setRadius, setSelectedDate, setSelectedGenre, setSelectedFormat, setSelectedLanguage, setSelectedEvent, setSelectedCity,
    requestLocation,
  } = useFilters();
  const [radiusOpen, setRadiusOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [moreView, setMoreView] = useState<"menu" | "genres" | "formats" | "languages" | "events" | "cities">("menu");
  const { t, lang } = useLanguage();

  // Allow GeoNotice (or any other caller) to open the city filter inside the more-menu.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const handler = () => {
      setMoreView("cities");
      setMoreOpen(true);
    };
    document.addEventListener(OPEN_CITY_FILTER_EVENT, handler);
    return () => document.removeEventListener(OPEN_CITY_FILTER_EVENT, handler);
  }, []);
  const TODAY = todayStr();
  const TOMORROW = tomorrowStr();

  const sortedGenres = useMemo(() => {
    if (!genres || genres.length === 0) return [];
    return Array.from(new Set(genres)).sort((a, b) => a.localeCompare(b, lang));
  }, [genres]);

  const sortedFormats = useMemo(() => sortTagOptions("formats", formats ?? []), [formats]);
  const sortedLanguages = useMemo(() => sortTagOptions("languages", languages ?? []), [languages]);
  const sortedEvents = useMemo(() => sortTagOptions("events", events ?? []), [events]);

  const sortedCities = useMemo(
    () =>
      Array.from(new Map((cities ?? []).map((c) => [c.value, c])).values()).sort((a, b) =>
        a.value.localeCompare(b.value, "da"),
      ),
    [cities],
  );

  const hasMoreFilters = Boolean(selectedGenre || selectedFormat || selectedLanguage || selectedEvent || selectedCity);

  // City selection is part of the URL: picking a city moves the user to the
  // city-scoped version of the current page (and clearing it back to national).
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const applyCity = (cityName: string | null) => {
    setSelectedCity(cityName);
    setMoreOpen(false);
    setMoreView("menu");
    const slug = cityName ? slugifyCity(cityName) : null;
    const movie = pathname.match(/^\/(?:[^/]+\/)?film\/([^/?#]+)/);
    if (movie) {
      if (slug) navigate({ to: "/$city/film/$slug", params: { city: slug, slug: movie[1] } });
      else navigate({ to: "/film/$slug", params: { slug: movie[1] } });
      return;
    }
    const isHomeOrCity = /^\/[^/]*$/.test(pathname);
    if (isHomeOrCity) {
      if (slug) navigate({ to: "/$city", params: { city: slug } });
      else navigate({ to: "/" });
    }
  };



  return (
    <div className={`flex flex-wrap items-center gap-3 ${className}`}>
      {!hideRadius && (
        <Popover
          open={radiusOpen}
          onOpenChange={(open) => {
            if (!open) { setRadiusOpen(false); return; }
            if (!userLoc) requestLocation(() => setRadiusOpen(true));
            else setRadiusOpen(true);
          }}
        >
          <PopoverTrigger asChild>
            <button
              type="button"
              className={`inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-xs uppercase tracking-[0.15em] transition-colors ${
                radius !== "all"
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card/40 text-muted-foreground hover:border-primary/60 hover:text-foreground"
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
              </svg>
              {radius === "all" ? t("filter.distance") : `${t("filter.within")} ${radius} km`}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-2" align="start">
            <div className="flex flex-col gap-1">
              {RADIUS_OPTIONS.map((opt) => {
                const label = opt.value === "all" ? t("filter.allDenmark") : opt.label;
                const selected = radius === opt.value;
                return (
                  <button
                    key={String(opt.value)}
                    type="button"
                    onClick={() => { setRadius(opt.value); setRadiusOpen(false); }}
                    className={`rounded-md px-4 py-2 text-left text-sm transition-colors ${
                      selected ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-secondary"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>
      )}

      <Popover open={dateOpen} onOpenChange={setDateOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={`inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-xs uppercase tracking-[0.15em] transition-colors ${
              selectedDate
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card/40 text-muted-foreground hover:border-primary/60 hover:text-foreground"
            }`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            {fmtDateLabel(selectedDate, lang)}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-2" align="start">
          <div className="flex flex-col gap-1">
            <button
              type="button"
              onClick={() => { setSelectedDate(TODAY); setDateOpen(false); }}
              className={`rounded-md px-4 py-2 text-left text-sm transition-colors ${selectedDate === TODAY ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-secondary"}`}
            >
              {t("filter.today")}
            </button>
            <button
              type="button"
              onClick={() => { setSelectedDate(TOMORROW); setDateOpen(false); }}
              className={`rounded-md px-4 py-2 text-left text-sm transition-colors ${selectedDate === TOMORROW ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-secondary"}`}
            >
              {t("filter.tomorrow")}
            </button>
            <div className="px-2 py-2">
              <Calendar
                mode="single"
                selected={selectedDate ? new Date(selectedDate + "T12:00:00") : undefined}
                onSelect={(date) => {
                  if (date) {
                    const y = date.getFullYear();
                    const m = String(date.getMonth() + 1).padStart(2, "0");
                    const d = String(date.getDate()).padStart(2, "0");
                    setSelectedDate(`${y}-${m}-${d}`);
                    setDateOpen(false);
                  }
                }}
                disabled={(date) => {
                  const check = new Date(date.getFullYear(), date.getMonth(), date.getDate());
                  const today = new Date();
                  today.setHours(0, 0, 0, 0);
                  return check < today;
                }}
                initialFocus
                className="pointer-events-auto"
              />
            </div>
            {selectedDate && (
              <button
                type="button"
                onClick={() => { setSelectedDate(null); setDateOpen(false); }}
                className="rounded-md px-4 py-2 text-left text-xs uppercase tracking-[0.15em] text-muted-foreground hover:bg-secondary"
              >
                {t("filter.clearDate")}
              </button>
            )}
          </div>
        </PopoverContent>
      </Popover>

      <Popover
        open={moreOpen}
        onOpenChange={(open) => {

          setMoreOpen(open);
          if (!open) setMoreView("menu");
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            data-more-filters-trigger
            aria-label={t("filter.more")}
            className={`inline-flex h-[30px] w-[30px] items-center justify-center rounded-full border transition-colors ${
              hasMoreFilters
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card/40 text-muted-foreground hover:border-primary/60 hover:text-foreground"
            }`}
          >
            <Plus size="14" strokeWidth={2.5} />
          </button>
        </PopoverTrigger>
        <PopoverContent className="max-h-[70vh] w-56 overflow-y-auto p-2" align="start">
          {(() => {
            const groups = [
              { key: "genres" as const, label: t("filter.genre"), pick: t("filter.pickGenre"), options: sortedGenres.map((o) => ({ value: o, label: o })), allLabel: undefined as string | undefined, value: selectedGenre, set: setSelectedGenre },
              { key: "formats" as const, label: t("filter.screening"), pick: t("filter.pickScreening"), options: sortedFormats.map((o) => ({ value: o, label: o })), allLabel: undefined as string | undefined, value: selectedFormat, set: setSelectedFormat },
              { key: "languages" as const, label: t("filter.language"), pick: t("filter.pickLanguage"), options: sortedLanguages.map((o) => ({ value: o, label: o })), allLabel: undefined as string | undefined, value: selectedLanguage, set: setSelectedLanguage },
              { key: "events" as const, label: t("filter.event"), pick: t("filter.pickEvent"), options: sortedEvents.map((o) => ({ value: o, label: o })), allLabel: undefined as string | undefined, value: selectedEvent, set: setSelectedEvent },
            ].filter((g) => g.options.length > 0);

            if (moreView === "menu") {
              return (
                <div className="flex flex-col gap-1">
                  <div className="px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{t("filter.more")}</div>
                  {groups.map((g) => (
                    <button
                      key={g.key}
                      type="button"
                      onClick={() => setMoreView(g.key)}
                      className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-secondary"
                    >
                      <span>{g.label}</span>
                      <div className="flex items-center gap-2">
                        {g.value && <span className="max-w-[80px] truncate text-xs text-primary">{g.value}</span>}
                        <ChevronRight size="14" className="text-muted-foreground" />
                      </div>
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setMoreView("cities")}
                    className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-secondary"
                  >
                    <span>{t("filter.city")}</span>
                    <div className="flex items-center gap-2">
                      {selectedCity && <span className="max-w-[80px] truncate text-xs text-primary">{selectedCity}</span>}
                      <ChevronRight size="14" className="text-muted-foreground" />
                    </div>
                  </button>
                  {groups.length === 0 && !selectedCity && (
                    <div className="px-3 py-2 text-sm text-muted-foreground">{t("filter.noMore")}</div>
                  )}
                </div>
              );
            }

            if (moreView === "cities") {
              return (
                <div className="flex flex-col gap-1">
                  <button
                    type="button"
                    onClick={() => setMoreView("menu")}
                    className="flex items-center gap-2 rounded-md px-3 py-1.5 text-xs uppercase tracking-[0.15em] text-muted-foreground transition-colors hover:bg-secondary"
                  >
                    <ArrowLeft size="12" />
                    {t("filter.back")}
                  </button>
                  <div className="px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{t("filter.pickCity")}</div>
                  <button
                    type="button"
                    onClick={() => applyCity(null)}
                    className={`rounded-md px-3 py-2 text-left text-sm transition-colors ${
                      !selectedCity ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-secondary"
                    }`}
                  >
                    {t("filter.allCities")}
                  </button>
                  {sortedCities.map((c) => {
                    const selected = selectedCity === c.value;
                    return (
                      <button
                        key={c.value}
                        type="button"
                        onClick={() => applyCity(selected ? null : c.value)}
                        className={`rounded-md px-3 py-2 text-left text-sm transition-colors ${
                          selected ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-secondary"
                        }`}
                      >
                        {c.value} ({c.count})
                      </button>
                    );
                  })}
                </div>
              );
            }

            const active = groups.find((g) => g.key === moreView);
            if (!active) return null;
            return (
              <div className="flex flex-col gap-1">
                <button
                  type="button"
                  onClick={() => setMoreView("menu")}
                  className="flex items-center gap-2 rounded-md px-3 py-1.5 text-xs uppercase tracking-[0.15em] text-muted-foreground transition-colors hover:bg-secondary"
                >
                  <ArrowLeft size="12" />
                  {t("filter.back")}
                </button>
                <div className="px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{active.pick}</div>
                {active.allLabel && (
                  <button
                    type="button"
                    onClick={() => { active.set(null); setMoreOpen(false); }}
                    className={`rounded-md px-3 py-2 text-left text-sm transition-colors ${
                      !active.value ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-secondary"
                    }`}
                  >
                    {active.allLabel}
                  </button>
                )}
                {active.options.map((opt) => {
                  const selected = active.value === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => { active.set(selected ? null : opt.value); setMoreOpen(false); }}
                      className={`rounded-md px-3 py-2 text-left text-sm transition-colors ${
                        selected ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-secondary"
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            );
          })()}
        </PopoverContent>

      </Popover>
    </div>
  );
}
