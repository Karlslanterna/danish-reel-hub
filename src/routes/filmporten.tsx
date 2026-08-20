import { createFileRoute } from "@tanstack/react-router";
import { specialEventHead } from "@/lib/special-event-seo";
import { HomePage } from "./index";
import { loadCachedHomeCatalog } from "@/lib/home-catalog";

export const Route = createFileRoute("/filmporten")({
  loader: ({ context }) => loadCachedHomeCatalog(context.queryClient),
  head: ({ loaderData }) => specialEventHead(loaderData, "Filmporten"),
  component: FilmportenPage,
});

function FilmportenPage() {
  return <HomePage catalog={Route.useLoaderData()} specialEvent="Filmporten" />;
}
