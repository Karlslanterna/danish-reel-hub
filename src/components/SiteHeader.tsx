import { Link } from "@tanstack/react-router";
import lanternaIcon from "@/assets/lanterna-icon.png.asset.json";

function LogoIcon({ className }: { className?: string }) {
  return (
    <img
      src={lanternaIcon.url}
      alt="Lanterna Magica"
      className={className}
      width={28}
      height={28}
    />
  );
}

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1400px] items-center justify-between px-8">
        <Link to="/" className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-sm bg-primary text-primary-foreground">
            <LanternIcon className="h-4 w-4" />
          </div>
          <span className="font-display text-lg tracking-tight">lanterna.dk</span>
        </Link>
        <nav className="flex items-center gap-7 text-sm text-muted-foreground">
          <Link to="/" className="transition-colors hover:text-foreground" activeOptions={{ exact: true }} activeProps={{ className: "text-foreground" }}>
            Film
          </Link>
          <a href="#cinemas" className="transition-colors hover:text-foreground">Biografer</a>
          <a href="#" className="transition-colors hover:text-foreground">Program</a>
          <a href="#" className="hidden rounded-sm border border-border px-3 py-1.5 text-foreground transition-colors hover:bg-secondary md:inline-block">
            Log ind
          </a>
        </nav>
      </div>
    </header>
  );
}
