import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { LayoutDashboard, Database, Settings2, Menu, UserRound } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

type NavItem = {
  label: string;
  to?: "/admin" | "/admin/pipeline";
  icon: typeof LayoutDashboard;
  soon?: boolean;
  match: (path: string) => boolean;
};

const NAV: NavItem[] = [
  {
    label: "Dashboard",
    to: "/admin",
    icon: LayoutDashboard,
    match: (p) => p === "/admin" || p === "/admin/",
  },
  {
    label: "Data Pipeline",
    to: "/admin/pipeline",
    icon: Database,
    match: (p) => p.startsWith("/admin/pipeline") || p.startsWith("/admin/import"),
  },
  {
    label: "Systemindstillinger",
    icon: Settings2,
    soon: true,
    match: () => false,
  },
];

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <nav className="space-y-1">
      {NAV.map((item) => {
        const Icon = item.icon;
        const active = item.match(pathname);
        if (!item.to) {
          return (
            <div
              key={item.label}
              aria-disabled
              className="flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground/50"
            >
              <span className="flex min-w-0 items-center gap-3">
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </span>
              <span className="shrink-0 text-[10px] uppercase tracking-wider">Kommer snart</span>
            </div>
          );
        }
        return (
          <Link
            key={item.label}
            to={item.to}
            onClick={onNavigate}
            className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
              active
                ? "bg-muted font-medium text-foreground"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            }`}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className="truncate">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function ProfileMenu() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    supabase.auth.getUser().then(({ data }) => {
      if (active) setEmail(data.user?.email ?? null);
    });
    return () => {
      active = false;
    };
  }, []);

  async function handleSignOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", search: {}, replace: true });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2" aria-label="Administratormenu">
          <UserRound className="h-4 w-4" />
          <span className="hidden max-w-[14rem] truncate sm:inline">
            {email ?? "Administrator"}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <p className="text-xs text-muted-foreground">Administrator</p>
          <p className="truncate text-sm">{email ?? "—"}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void handleSignOut()}>Log ud</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AdminShell({ title, children }: { title: string; children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      {/* Sidebar — permanent on desktop */}
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-border bg-card/40 px-3 py-5 lg:flex">
        <div className="px-3 pb-6">
          <p className="font-display text-sm font-semibold text-foreground">Lanterna</p>
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Administration
          </p>
        </div>
        <NavList />
      </aside>

      <div className="lg:pl-60">
        {/* Top bar */}
        <header className="sticky top-0 z-20 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
          <div className="flex min-w-0 items-center gap-3">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Åbn menu">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-64 p-4">
                <SheetTitle className="mb-6 text-left">
                  <span className="block font-display text-sm font-semibold">Lanterna</span>
                  <span className="block text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    Administration
                  </span>
                </SheetTitle>
                <NavList onNavigate={() => setMobileOpen(false)} />
              </SheetContent>
            </Sheet>
            <div className="min-w-0">
              <p className="hidden text-[11px] uppercase tracking-[0.18em] text-muted-foreground sm:block">
                Lanterna Administration
              </p>
              <h1 className="truncate text-sm font-medium text-foreground">{title}</h1>
            </div>
          </div>
          <ProfileMenu />
        </header>

        <main className="px-4 py-8 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
