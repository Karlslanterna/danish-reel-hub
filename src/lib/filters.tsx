import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";

export type Radius = 2 | 5 | 10 | 25 | 50 | "all";

export const RADIUS_OPTIONS: Array<{ value: Radius; label: string }> = [
  { value: 2, label: "2 km" },
  { value: 5, label: "5 km" },
  { value: 10, label: "10 km" },
  { value: 25, label: "25 km" },
  { value: 50, label: "50 km" },
  { value: "all", label: "Hele Danmark" },
];

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

export function fmtDateLabel(date: string | null) {
  if (!date) return "Dato";
  if (date === todayStr()) return "I dag";
  if (date === tomorrowStr()) return "I morgen";
  return new Date(date + "T12:00:00").toLocaleDateString("da-DK", { day: "numeric", month: "short" });
}

type Loc = { lat: number; lng: number };

type FiltersState = {
  radius: Radius;
  userLoc: Loc | null;
  selectedDate: string | null;
  geoError: string | null;
  geoLoading: boolean;
  setRadius: (r: Radius) => void;
  setSelectedDate: (d: string | null) => void;
  requestLocation: (onSuccess?: () => void) => void;
  clear: () => void;
};

const FiltersContext = createContext<FiltersState | null>(null);

const STORAGE_KEY = "lanterna.filters.v1";

type Persisted = { radius: Radius; userLoc: Loc | null; selectedDate: string | null };

function loadPersisted(): Persisted {
  if (typeof window === "undefined") return { radius: "all", userLoc: null, selectedDate: null };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { radius: "all", userLoc: null, selectedDate: null };
    const p = JSON.parse(raw) as Partial<Persisted>;
    const radius: Radius = p.radius === "all" || (typeof p.radius === "number" && [2, 5, 10, 25, 50].includes(p.radius)) ? (p.radius as Radius) : "all";
    const userLoc = p.userLoc && typeof p.userLoc.lat === "number" && typeof p.userLoc.lng === "number" ? p.userLoc : null;
    let selectedDate = typeof p.selectedDate === "string" ? p.selectedDate : null;
    // drop past dates
    if (selectedDate && selectedDate < todayStr()) selectedDate = null;
    return { radius, userLoc, selectedDate };
  } catch {
    return { radius: "all", userLoc: null, selectedDate: null };
  }
}

export function FiltersProvider({ children }: { children: ReactNode }) {
  const [radius, setRadiusState] = useState<Radius>("all");
  const [userLoc, setUserLoc] = useState<Loc | null>(null);
  const [selectedDate, setSelectedDateState] = useState<string | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [geoLoading, setGeoLoading] = useState(false);

  // Hydrate from localStorage on client
  useEffect(() => {
    const p = loadPersisted();
    setRadiusState(p.radius);
    setUserLoc(p.userLoc);
    setSelectedDateState(p.selectedDate);
  }, []);

  // Persist
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ radius, userLoc, selectedDate }));
    } catch { /* ignore */ }
  }, [radius, userLoc, selectedDate]);

  const setRadius = useCallback((r: Radius) => setRadiusState(r), []);
  const setSelectedDate = useCallback((d: string | null) => setSelectedDateState(d), []);

  const requestLocation = useCallback((onSuccess?: () => void) => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setGeoError("Geolokation understøttes ikke");
      return;
    }
    setGeoLoading(true);
    setGeoError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGeoLoading(false);
        onSuccess?.();
      },
      (err) => {
        setGeoError(err.code === err.PERMISSION_DENIED ? "Adgang nægtet" : "Kunne ikke finde dig");
        setGeoLoading(false);
        setRadiusState("all");
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  }, []);

  const clear = useCallback(() => {
    setRadiusState("all");
    setSelectedDateState(null);
  }, []);

  const value = useMemo<FiltersState>(
    () => ({ radius, userLoc, selectedDate, geoError, geoLoading, setRadius, setSelectedDate, requestLocation, clear }),
    [radius, userLoc, selectedDate, geoError, geoLoading, setRadius, setSelectedDate, requestLocation, clear],
  );

  return <FiltersContext.Provider value={value}>{children}</FiltersContext.Provider>;
}

export function useFilters() {
  const ctx = useContext(FiltersContext);
  if (!ctx) throw new Error("useFilters must be used within FiltersProvider");
  return ctx;
}

export function FilterBar({ className = "", hideRadius = false }: { className?: string; hideRadius?: boolean }) {
  const { radius, userLoc, selectedDate, setRadius, setSelectedDate, requestLocation } = useFilters();
  const [radiusOpen, setRadiusOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const TODAY = todayStr();
  const TOMORROW = tomorrowStr();

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
              {radius === "all" ? "Afstand fra mig" : `Inden for ${radius} km`}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-2" align="start">
            <div className="flex flex-col gap-1">
              {RADIUS_OPTIONS.map((opt) => {
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
                    {opt.label}
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
            {fmtDateLabel(selectedDate)}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-2" align="start">
          <div className="flex flex-col gap-1">
            <button
              type="button"
              onClick={() => { setSelectedDate(TODAY); setDateOpen(false); }}
              className={`rounded-md px-4 py-2 text-left text-sm transition-colors ${selectedDate === TODAY ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-secondary"}`}
            >
              I dag
            </button>
            <button
              type="button"
              onClick={() => { setSelectedDate(TOMORROW); setDateOpen(false); }}
              className={`rounded-md px-4 py-2 text-left text-sm transition-colors ${selectedDate === TOMORROW ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-secondary"}`}
            >
              I morgen
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
                Ryd dato
              </button>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
