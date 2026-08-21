import { createFileRoute } from "@tanstack/react-router";
import { specialEventHead } from "@/lib/special-event-seo";
import { HomePage } from "./index";
import { loadSpecialEventHomeShell } from "@/lib/home-catalog";

export const Route = createFileRoute("/babybio")({
  loader: () => loadSpecialEventHomeShell("Babybio"),
  head: ({ loaderData }) => specialEventHead(loaderData, "Babybio"),
  component: BabybioPage,
});

function BabybioPage() {
  return <HomePage catalog={Route.useLoaderData()} specialEvent="Babybio" />;
}
