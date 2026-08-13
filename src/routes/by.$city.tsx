import { createFileRoute, redirect } from "@tanstack/react-router";
import { slugifyCity } from "@/lib/city-slug";

// Legacy URL. Permanently redirects to the short city URL: /by/københavn -> /koebenhavn
export const Route = createFileRoute("/by/$city")({
  loader: ({ params }) => {
    throw redirect({
      to: "/$city",
      params: { city: slugifyCity(decodeURIComponent(params.city)) },
      statusCode: 301,
    });
  },
  component: () => null,
});
