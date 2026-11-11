import { loadBackstageStickers } from "./sources/backstage-stickers.js";

const SITE_ORIGIN = "https://funkinbackstage.net";
const CACHE_TTL_SECONDS = 60 * 60;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== "GET") {
      return json({ error: "Method not allowed" }, 405, { Allow: "GET, OPTIONS" });
    }

    if (url.pathname === "/") {
      return env.ASSETS.fetch(new Request(new URL("/index.html", url), {
        method: "GET",
        headers: request.headers,
      }));
    }

    if (url.pathname === "/api") {
      return json({
        name: "Funkin' Backstage Extra API",
        endpoints: {
          tracks: "/api/tracks",
          track: "/api/tracks/:id",
          stickers: "/api/chat/stickers",
        },
        source: SITE_ORIGIN,
      });
    }

    if (url.pathname === "/api/tracks" || url.pathname.startsWith("/api/tracks/")) {
      try {
        const tracks = await getTracks(request);
        const trackId = url.pathname.slice("/api/tracks/".length);

        if (trackId) {
          let decodedTrackId;
          try {
            decodedTrackId = decodeURIComponent(trackId);
          } catch {
            return json({ error: "Invalid track ID" }, 400);
          }
          const track = tracks.find((item) => item.id === decodedTrackId);
          return track
            ? json(track)
            : json({ error: "Track not found", id: decodedTrackId }, 404);
        }

        const query = (url.searchParams.get("q") || "").trim().toLocaleLowerCase();
        const artist = (url.searchParams.get("artist") || "").trim().toLocaleLowerCase();
        const filtered = tracks.filter((track) =>
          (!query || `${track.title} ${track.artist}`.toLocaleLowerCase().includes(query)) &&
          (!artist || track.artist.toLocaleLowerCase().includes(artist)),
        );

        return json({ count: filtered.length, tracks: filtered });
      } catch (error) {
        return json({ error: "Could not load the Backstage song list", details: error.message }, 502, {
          "Cache-Control": "no-store",
        });
      }
    }

    if (url.pathname === "/api/chat/stickers") {
      try {
        return json(await getCachedData(request, "stickers", loadBackstageStickers));
      } catch (error) {
        return json({ error: "Could not load the Backstage chat stickers", details: error.message }, 502, {
          "Cache-Control": "no-store",
        });
      }
    }

    if (url.pathname.startsWith("/api/")) {
      return json({ error: "Not found" }, 404);
    }

    return env.ASSETS.fetch(request);
  },
};

async function getTracks(request) {
  return getCachedData(request, "tracks", scrapeTracks);
}

async function getCachedData(request, cacheName, loadData) {
  const cache = caches.default;
  const cacheKey = new Request(new URL(`/__worker_cache/${cacheName}-v1`, request.url));
  const cached = await cache.match(cacheKey);
  if (cached) return cached.json();

  const data = await loadData();
  const response = new Response(JSON.stringify(data), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": `public, max-age=${CACHE_TTL_SECONDS}`,
    },
  });
  await cache.put(cacheKey, response.clone());
  return data;
}

async function scrapeTracks() {
  const pageResponse = await fetch(SITE_ORIGIN, {
    headers: { Accept: "text/html", "User-Agent": "BackstageExtraAPI/1.0" },
  });
  if (!pageResponse.ok) throw new Error(`Site page returned ${pageResponse.status}`);

  const page = await pageResponse.text();
  const scriptPaths = [...page.matchAll(/\bsrc=["']([^"']+)["']/g)].map((match) => match[1]);
  const bundlePath = scriptPaths.find((src) => /\/assets\/index-[^/]+\.js(?:\?.*)?$/.test(src));
  if (!bundlePath) throw new Error("Could not find the current site JavaScript bundle");

  const bundleResponse = await fetch(new URL(bundlePath, `${SITE_ORIGIN}/`), {
    headers: { Accept: "application/javascript" },
  });
  if (!bundleResponse.ok) throw new Error(`Site bundle returned ${bundleResponse.status}`);

  const bundle = await bundleResponse.text();
  const pattern = /\{\s*title:\s*("(?:\\.|[^"\\])*")\s*,\s*artist:\s*("(?:\\.|[^"\\])*")\s*,\s*src:\s*("(?:\\.|[^"\\])*")\s*\}/g;
  const seenIds = new Map();
  const tracks = [];

  for (const match of bundle.matchAll(pattern)) {
    const title = JSON.parse(match[1]);
    const artist = JSON.parse(match[2]);
    const src = JSON.parse(match[3]);
    if (!src.startsWith("/music/") || !src.toLowerCase().endsWith(".mp3")) continue;

    const baseId = slugify(title) || "track";
    const occurrence = (seenIds.get(baseId) || 0) + 1;
    seenIds.set(baseId, occurrence);
    tracks.push({
      id: occurrence === 1 ? baseId : `${baseId}-${occurrence}`,
      title,
      artist,
      url: new URL(src, `${SITE_ORIGIN}/`).href,
    });
  }

  if (!tracks.length) throw new Error("No songs found in the site bundle");
  return tracks;
}

function slugify(value) {
  return value
    .normalize("NFKD")
    .toLocaleLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": status === 200 ? "public, max-age=300, stale-while-revalidate=3600" : "no-store",
      ...corsHeaders,
      ...extraHeaders,
    },
  });
}
