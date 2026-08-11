import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/admin/denied")({
  head: () => ({
    meta: [
      { title: "Adgang nægtet" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AccessDenied,
});

function AccessDenied() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col justify-center px-4 py-12">
      <h1 className="font-display text-3xl font-bold text-foreground">403 — Adgang nægtet</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Din konto har ikke rettigheder til dette område.
      </p>
    </div>
  );
}
