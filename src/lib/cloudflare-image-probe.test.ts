import { expect, it } from "vitest";

const posters = [
  ["Batman Begins", "https://www.kultunaut.dk/images/film/2653133/plakat.jpg"],
  ["Cocoa Dreams", "https://www.kultunaut.dk/images/film/7107265/plakat.jpg"],
  ["Den utrolige historie om den kæmpestore pære", "https://www.kultunaut.dk/images/film/7095600/plakat.jpg"],
  ["Det vi ikke taler om", "https://www.kultunaut.dk/images/film/7107243/plakat.jpg"],
  ["DJ Ahmet", "https://www.kultunaut.dk/images/film/7105898/plakat.jpg"],
  ["Dobbeltfejl", "https://www.kultunaut.dk/images/film/7107130/plakat.jpg"],
  ["Flådens friske fyre (1965)", "https://www.kultunaut.dk/images/film/7093852/plakat.jpg"],
  ["Gravity", "https://www.kultunaut.dk/images/film/7091030/plakat.jpg"],
  ["Hana Korea", "https://www.kultunaut.dk/images/film/7106751/plakat.jpg"],
  ["Michael (2025)", "https://www.kultunaut.dk/images/film/7105887/plakat.jpg"],
  ["Obsession (2025)", "https://www.kultunaut.dk/images/film/7106689/plakat.jpg"],
  ["One in a Million", "https://www.kultunaut.dk/images/film/7106715/plakat.jpg"],
  ["One Night Only", "https://www.kultunaut.dk/images/film/7107006/plakat.jpg"],
  ["Pressure", "https://www.kultunaut.dk/images/film/7107138/plakat.jpg"],
  ["Romeo + Juliet", "https://www.kultunaut.dk/images/film/7090946/plakat.jpg"],
  ["The Dark Knight", "https://www.kultunaut.dk/images/film/7087149/plakat.jpg"],
  ["The Dark Knight Rises", "https://www.kultunaut.dk/images/film/7089376/plakat.jpg"],
  ["The Odyssey (2026)", "https://www.kultunaut.dk/images/film/7106936/plakat.jpg"],
] as const;

it("measures active Copenhagen Kultunaut source posters", async () => {
  const results = await Promise.all(
    posters.map(async ([title, url]) => {
      const response = await fetch(url, { method: "HEAD", redirect: "follow" });
      return {
        title,
        status: response.status,
        contentType: response.headers.get("content-type"),
        contentLength: Number(response.headers.get("content-length") ?? 0),
      };
    }),
  );
  console.log("[kultunaut-poster-heads]", JSON.stringify(results));
  expect(results.every((result) => result.status < 500)).toBe(true);
});
