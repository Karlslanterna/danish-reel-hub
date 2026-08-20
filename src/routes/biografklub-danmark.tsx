import { createFileRoute } from "@tanstack/react-router";
import { specialEventHead } from "@/lib/special-event-seo";
import { HomePage } from "./index";
import { loadCachedHomeCatalog } from "@/lib/home-catalog";

export const Route = createFileRoute("/biografklub-danmark")({
  loader: ({ context }) => loadCachedHomeCatalog(context.queryClient),
  head: ({ loaderData }) => specialEventHead(loaderData, "Biografklub Danmark"),
  component: BiografklubDanmarkPage,
});

function BiografklubDanmarkPage() {
  return <HomePage catalog={Route.useLoaderData()} specialEvent="Biografklub Danmark" />;
}
