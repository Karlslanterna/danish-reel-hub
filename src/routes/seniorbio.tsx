import { createFileRoute } from "@tanstack/react-router";
import { specialEventHead } from "@/lib/special-event-seo";
import { HomePage } from "./index";
import { loadCachedHomeCatalog } from "@/lib/home-catalog";

export const Route = createFileRoute("/seniorbio")({
  loader: ({ context }) => loadCachedHomeCatalog(context.queryClient),
  head: ({ loaderData }) => specialEventHead(loaderData, "Seniorbio"),
  component: SeniorbioPage,
});

function SeniorbioPage() {
  return <HomePage catalog={Route.useLoaderData()} specialEvent="Seniorbio" />;
}
