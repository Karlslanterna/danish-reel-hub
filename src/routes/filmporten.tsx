import { createFileRoute } from "@tanstack/react-router";
import { specialEventHead } from "@/lib/special-event-seo";
import { HomePage } from "./index";
import { loadSpecialEventHomeShell } from "@/lib/home-catalog";

export const Route = createFileRoute("/filmporten")({
  loader: () => loadSpecialEventHomeShell("Filmporten"),
  head: ({ loaderData }) => specialEventHead(loaderData, "Filmporten"),
  component: FilmportenPage,
});

function FilmportenPage() {
  return <HomePage catalog={Route.useLoaderData()} specialEvent="Filmporten" />;
}
