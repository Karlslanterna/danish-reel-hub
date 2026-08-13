import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Lang = "da" | "en";

const STORAGE_KEY = "lanterna.lang.v1";

const dict = {
  da: {
    "header.tagline": "Lanterna",
    "header.signIn": "Log ind",
    "header.signOut": "Log ud",
    "home.hero": "En hurtigere vej i biografen",
    "home.sub": "Alle danske biografer og aktuelle film, ét sted.",
    "home.movies": "film",
    "home.cinemas": "biografer",
    "home.search": "Søg på film, biograf eller by",
    "home.clearSearch": "Ryd",
    "home.currentMovies": "Aktuelle film",
    "home.clearFilters": "Ryd filtre",
    "home.locating": "Finder din placering…",
    "home.noMatch": "Ingen film matcher",
    "home.tryRadius": "Prøv en større radius.",
    "home.tryQuery": "Prøv et andet søgeord.",
    "home.cinemasHeading": "Biografer",
    "home.places": "steder",
    "home.within": "inden for",
    "home.screens": "sale",
    "kind.movie": "Film",
    "kind.cinema": "Biograf",
    "kind.city": "By",
    "sug.cinema": "biograf",
    "sug.cinemas": "biografer",
    "sug.areas": "områder",
    "filter.distance": "Afstand fra mig",
    "filter.within": "Inden for",
    "filter.allDenmark": "Hele Danmark",
    "filter.date": "Dato",
    "filter.today": "I dag",
    "filter.tomorrow": "I morgen",
    "filter.clearDate": "Ryd dato",
    "filter.more": "Flere filtre",
    "filter.genre": "Genre",
    "filter.noMore": "Ingen ekstra filtre tilgængelige",
    "filter.back": "Tilbage",
    "filter.pickGenre": "Vælg genre",
    "filter.screening": "Visningstype",
    "filter.pickScreening": "Vælg visningstype",
    "filter.language": "Sprog",
    "filter.pickLanguage": "Vælg sprog",
    "filter.event": "Arrangement",
    "filter.pickEvent": "Vælg arrangement",
    "filter.city": "By",
    "filter.pickCity": "Vælg by",
    "filter.allCities": "Alle byer",
    "filter.cinema": "Biograf",
    "filter.pickCinema": "Vælg biograf",
    "filter.allCinemas": "Alle biografer",
    "filter.searchCinema": "Søg biograf…",
    "filter.noCinemas": "Ingen biografer matcher",
    "filter.lockedByCinema": "Slået fra, når en biograf er valgt",
    "filter.lockedByGeo": "Slået fra, når afstand er aktiv",
    "geo.denied": "LANTERNA har ikke adgang til din placering.",
    "geo.unsupported": "Din browser understøtter ikke geolokation.",
    "geo.unavailable": "Din placering kunne ikke bestemmes lige nu.",
    "geo.timeout": "Det tog for lang tid at finde din placering.",
    "geo.explain": "Aktiver placeringstilladelser i dine browserindstillinger, eller vælg en by manuelt.",
    "geo.explainNoConnection": "Tjek din forbindelse, eller vælg en by manuelt.",
    "geo.retry": "Prøv igen",
    "geo.pickCity": "Vælg by",
    "geo.close": "Luk",
    "lang.toggle": "English",
  },
  en: {
    "header.tagline": "Lanterna",
    "header.signIn": "Sign in",
    "header.signOut": "Sign out",
    "home.hero": "A faster way to the cinema",
    "home.sub": "All Danish cinemas and current movies, in one place.",
    "home.movies": "movies",
    "home.cinemas": "cinemas",
    "home.search": "Search for a movie, cinema or city",
    "home.clearSearch": "Clear",
    "home.currentMovies": "Now showing",
    "home.clearFilters": "Clear filters",
    "home.locating": "Finding your location…",
    "home.noMatch": "No movies match",
    "home.tryRadius": "Try a larger radius.",
    "home.tryQuery": "Try another search term.",
    "home.cinemasHeading": "Cinemas",
    "home.places": "places",
    "home.within": "within",
    "home.screens": "screens",
    "kind.movie": "Movie",
    "kind.cinema": "Cinema",
    "kind.city": "City",
    "sug.cinema": "cinema",
    "sug.cinemas": "cinemas",
    "sug.areas": "areas",
    "filter.distance": "Distance from me",
    "filter.within": "Within",
    "filter.allDenmark": "All of Denmark",
    "filter.date": "Date",
    "filter.today": "Today",
    "filter.tomorrow": "Tomorrow",
    "filter.clearDate": "Clear date",
    "filter.more": "More filters",
    "filter.genre": "Genre",
    "filter.noMore": "No extra filters available",
    "filter.back": "Back",
    "filter.pickGenre": "Pick a genre",
    "filter.screening": "Screening type",
    "filter.pickScreening": "Pick a screening type",
    "filter.language": "Language",
    "filter.pickLanguage": "Pick a language",
    "filter.event": "Event",
    "filter.pickEvent": "Pick an event",
    "filter.city": "City",
    "filter.pickCity": "Pick a city",
    "filter.allCities": "All cities",
    "filter.cinema": "Cinema",
    "filter.pickCinema": "Pick a cinema",
    "filter.allCinemas": "All cinemas",
    "filter.searchCinema": "Search cinema…",
    "filter.noCinemas": "No cinemas match",
    "filter.lockedByCinema": "Disabled while a cinema is selected",
    "filter.lockedByGeo": "Disabled while distance is active",
    "geo.denied": "LANTERNA does not have access to your location.",
    "geo.unsupported": "Your browser does not support geolocation.",
    "geo.unavailable": "Your location could not be determined right now.",
    "geo.timeout": "It took too long to find your location.",
    "geo.explain": "Enable location permissions in your browser settings, or choose a city manually.",
    "geo.explainNoConnection": "Check your connection, or choose a city manually.",
    "geo.retry": "Try again",
    "geo.pickCity": "Choose city",
    "geo.close": "Close",
    "lang.toggle": "Dansk",
  },
} as const;

export type TKey = keyof (typeof dict)["da"];

type LanguageState = {
  lang: Lang;
  setLang: (l: Lang) => void;
  toggle: () => void;
  t: (key: TKey) => string;
};

const LanguageContext = createContext<LanguageState | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("da");

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === "en" || saved === "da") setLangState(saved);
    } catch { /* ignore */ }
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try { window.localStorage.setItem(STORAGE_KEY, l); } catch { /* ignore */ }
    if (typeof document !== "undefined") document.documentElement.lang = l === "en" ? "en" : "da";
  }, []);

  const value = useMemo<LanguageState>(() => ({
    lang,
    setLang,
    toggle: () => setLang(lang === "da" ? "en" : "da"),
    t: (key: TKey) => dict[lang][key] ?? dict.da[key],
  }), [lang, setLang]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be used within LanguageProvider");
  return ctx;
}

export function LanguageToggle({ className = "" }: { className?: string }) {
  const { t, toggle, lang } = useLanguage();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={lang === "da" ? "Switch to English" : "Skift til dansk"}
      className={`inline-flex items-center gap-2 rounded-full border border-border bg-card/40 px-4 py-1.5 text-xs uppercase tracking-[0.15em] text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground ${className}`}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18" />
      </svg>
      {t("lang.toggle")}
    </button>
  );
}
