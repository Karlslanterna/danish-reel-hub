import { Link } from "@tanstack/react-router";
import { useLanguage } from "@/lib/i18n";

export function SiteHeader() {
  const { t } = useLanguage();

  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1400px] items-center justify-between px-8">
        <Link to="/" className="flex items-center gap-3">
          <img src="/logo.svg" alt="Lanterna" width={32} height={32} className="h-8 w-8" />
          <span className="font-hero text-lg font-bold tracking-tight">{t("header.tagline")}</span>
        </Link>
      </div>
    </header>
  );
}
