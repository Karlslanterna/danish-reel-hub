import fs from "node:fs/promises";

async function config() {
  const text = await fs.readFile(new URL("../src/integrations/supabase/public-config.ts", import.meta.url), "utf8");
  const baseUrl = text.match(/PUBLIC_SUPABASE_URL\s*=\s*["']([^"']+)/)?.[1];
  const key = text.match(/PUBLIC_SUPABASE_PUBLISHABLE_KEY\s*=\s*["']([^"']+)/)?.[1];
  if (!baseUrl || !key) throw new Error("Missing public Supabase config");
  return { baseUrl, key };
}

async function fetchRows(baseUrl, key, table, params) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const url = new URL(`/rest/v1/${table}`, baseUrl);
    for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
    const response = await fetch(url, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Range: `${from}-${from + 999}`,
        "Range-Unit": "items",
      },
    });
    if (!response.ok) throw new Error(`${table}: ${response.status} ${await response.text()}`);
    const page = await response.json();
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

const ids = [
  "kn-A3d0YpOA419u2z+tQ3XptqQ",
  "kn-APr/l55AmCzcELYp9qnIHXQ",
  "kn-7106936",
];
const { baseUrl, key } = await config();
const rows = await fetchRows(baseUrl, key, "screenings", {
  select: "movie_id,cinema_id,local_date,local_time",
  movie_id: `in.(${ids.join(",")})`,
  order: "starts_at.asc",
});

const byMovie = new Map(ids.map((id) => [id, new Set()]));
for (const row of rows) {
  const slot = `${row.cinema_id}|${row.local_date}|${String(row.local_time).slice(0, 5)}`;
  byMovie.get(row.movie_id)?.add(slot);
}

const overlaps = [];
for (let i = 0; i < ids.length; i++) {
  for (let j = i + 1; j < ids.length; j++) {
    const a = ids[i];
    const b = ids[j];
    const aSlots = byMovie.get(a) ?? new Set();
    const bSlots = byMovie.get(b) ?? new Set();
    let overlap = 0;
    for (const slot of aSlots) if (bSlots.has(slot)) overlap += 1;
    overlaps.push({ a, aSlots: aSlots.size, b, bSlots: bSlots.size, exactOverlap: overlap });
  }
}
console.log(JSON.stringify({ overlaps }, null, 2));
