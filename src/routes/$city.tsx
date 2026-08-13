import { createFileRoute, Link, Outlet, notFound } from "@tanstack/react-router";
import { SiteHeader } from "@/components/SiteHeader";

export const Route = createFileRoute("/$city")({
  loader: async ({ params }) => {
    const { RESERVED_CITY_SLUGS } = await import("@/lib/city-slug");
    if (RESERVED_CITY_SLUGS.has(params.city.toLowerCase())) throw notFound();
    return null;
  },
  notFoundComponent: () => (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <div className="mx-auto max-w-2xl px-8 py-24 text-center">
        <h1 className="font-display text-4xl">Siden findes ikke</h1>
        <Link to="/" className="mt-6 inline-block text-sm text-primary underline-offset-4 hover:underline">
          Tilbage til forsiden
        </Link>
      </div>
    </div>
  ),
  component: () => <Outlet />,
});
