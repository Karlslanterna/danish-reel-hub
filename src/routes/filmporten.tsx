import { createFileRoute } from "@tanstack/react-router";
import { specialEventHead } from "@/lib/special-event-seo";
import { HomePage, loadCachedHomeCatalog } from "./index";

export const Route = createFileRoute("/filmporten")({
  loader: ({ context }) => loadCachedHomeCatalog(context.queryClient),
  head: ({ loaderData }) => specialEventHead(loaderData, "Filmporten"),
  component: FilmportenPage,
});

function FilmportenPage() {
  return <HomePage catalog={Route.useLoaderData()} specialEvent="Filmporten" />;
}
