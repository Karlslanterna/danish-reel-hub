import { Link } from "@tanstack/react-router";
import { useLanguage } from "@/lib/i18n";

export function SiteHeader({ onSearchClick }: { onSearchClick?: () => void }) {
  const { t, lang, setLang } = useLanguage();

  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1400px] items-center justify-between gap-4 px-6 sm:px-8">
        <Link to="/" className="flex items-center gap-3">
          <img src="/logo.svg" alt="Lanterna" width={32} height={32} className="h-8 w-8" />
          <span className="font-hero text-lg font-bold tracking-tight">{t("header.tagline")}</span>
        </Link>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setLang(lang === "da" ? "en" : "da")}
            aria-label={lang === "da" ? "Switch to English" : "Skift til dansk"}
            className="inline-flex h-8 items-center justify-center rounded-md border border-border/60 bg-transparent px-2.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground"
          >
            {lang === "da" ? "EN" : "DA"}
          </button>
          {onSearchClick && (
            <button
              type="button"
              onClick={onSearchClick}
              aria-label={t("home.search")}
              className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-border/70 text-foreground transition-colors hover:border-primary hover:text-primary"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

