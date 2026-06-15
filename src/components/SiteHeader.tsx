import { Link } from "@tanstack/react-router";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1400px] items-center justify-between px-8">
        <Link to="/" className="flex items-center gap-2.5">
          <span className="font-display text-lg font-bold tracking-tight">Lanterna - Danmarks nye biografportal</span>
        </Link>
        <nav className="flex items-center gap-7 text-sm text-muted-foreground">
          <a href="#" className="hidden rounded-sm border border-border px-3 py-1.5 text-foreground transition-colors hover:bg-secondary md:inline-block">
            Log ind
          </a>
        </nav>
      </div>
    </header>
  );
}
