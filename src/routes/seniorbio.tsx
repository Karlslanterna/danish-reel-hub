import { createFileRoute } from "@tanstack/react-router";
import { specialEventHead } from "@/lib/special-event-seo";
import { HomePage } from "./index";
import { loadSpecialEventHomeShell } from "@/lib/home-catalog";

export const Route = createFileRoute("/seniorbio")({
  loader: () => loadSpecialEventHomeShell("Seniorbio"),
  head: ({ loaderData }) => specialEventHead(loaderData, "Seniorbio"),
  component: SeniorbioPage,
});

function SeniorbioPage() {
  return <HomePage catalog={Route.useLoaderData()} specialEvent="Seniorbio" />;
}
