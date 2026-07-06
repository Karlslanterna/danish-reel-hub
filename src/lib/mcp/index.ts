import { defineMcp } from "@lovable.dev/mcp-js";
import searchMovies from "./tools/search-movies";
import searchCinemas from "./tools/search-cinemas";
import getShowtimes from "./tools/get-showtimes";

export default defineMcp({
  name: "lanterna-mcp",
  title: "Lanterna",
  version: "0.1.0",
  instructions:
    "Tools for Lanterna, a Danish cinema portal. Use `search_movies` and `search_cinemas` to look up titles and venues, and `get_showtimes` to find screenings by movie, cinema, and/or date.",
  tools: [searchMovies, searchCinemas, getShowtimes],
});
