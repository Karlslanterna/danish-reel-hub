import { expect, it } from "vitest";

it("probes the production Cloudflare remote image transformation path", async () => {
  const source = "https://www.kultunaut.dk/images/film/7106751/plakat.jpg";
  const url = `https://lanterna.dk/cdn-cgi/image/width=342,quality=75,format=auto/${source}`;
  const response = await fetch(url, { redirect: "manual" });
  const body = await response.arrayBuffer();
  console.log(
    "[cloudflare-image-probe]",
    JSON.stringify({
      status: response.status,
      contentType: response.headers.get("content-type"),
      contentLength: body.byteLength,
      cfResized: response.headers.get("cf-resized"),
      location: response.headers.get("location"),
      bodyPrefix: new TextDecoder().decode(body.slice(0, 160)),
    }),
  );
  expect(response.status).toBeLessThan(500);
});
