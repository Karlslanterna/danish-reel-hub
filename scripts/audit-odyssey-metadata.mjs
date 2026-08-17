import fs from "node:fs/promises";

const text = await fs.readFile(new URL("../src/integrations/supabase/public-config.ts", import.meta.url), "utf8");
const baseUrl = text.match(/PUBLIC_SUPABASE_URL\s*=\s*["']([^"']+)/)?.[1];
const key = text.match(/PUBLIC_SUPABASE_PUBLISHABLE_KEY\s*=\s*["']([^"']+)/)?.[1];
if (!baseUrl || !key) throw new Error("Missing public Supabase config");

const ids = ["kn-A3d0YpOA419u2z+tQ3XptqQ", "kn-APr/l55AmCzcELYp9qnIHXQ", "kn-7106936"];
const url = new URL("/rest/v1/movies", baseUrl);
url.searchParams.set("select", "id,title,original_title,runtime,genre,year,rating,synopsis,poster,external_id,ebillet_movie_base_id,ebillet_movie_ids");
url.searchParams.set("id", `in.(${ids.join(",")})`);
const response = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
const rows = await response.json();
console.log(JSON.stringify(rows, null, 2));
