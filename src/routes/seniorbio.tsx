import { createFileRoute } from "@tanstack/react-router";
import { specialEventHead } from "@/lib/special-event-seo";
import { HomePage, loadCachedHomeCatalog } from "./index";

export const Route = createFileRoute("/seniorbio")({
  loader: ({ context }) => loadCachedHomeCatalog(context.queryClient),
  head: ({ loaderData }) => specialEventHead(loaderData, "Seniorbio"),
  component: SeniorbioPage,
});

function SeniorbioPage() {
  return <HomePage catalog={Route.useLoaderData()} specialEvent="Seniorbio" />;
}
