import { writeFile } from "node:fs/promises";

const siteRoot = "https://funkinbackstage.net/";
const requestOptions = {
  cache: "no-store",
  headers: {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  },
};
const pageResponse = await fetch(siteRoot, requestOptions);
if (!pageResponse.ok) {
  throw new Error(`Site page returned ${pageResponse.status}`);
}

const page = await pageResponse.text();
const scriptPaths = [...page.matchAll(/\bsrc=["']([^"']+)["']/g)].map((match) => match[1]);
const bundlePath = scriptPaths.find((src) => /\/assets\/index-[^/]+\.js(?:\?.*)?$/.test(src));
if (!bundlePath) {
  throw new Error("Couldn't find the current site bundle.");
}

const bundleResponse = await fetch(new URL(bundlePath, siteRoot), requestOptions);
if (!bundleResponse.ok) {
  throw new Error(`Player bundle returned ${bundleResponse.status}`);
}

const bundle = await bundleResponse.text();
const trackPattern = /\{\s*title:\s*("(?:\\.|[^"\\])*")\s*,\s*artist:\s*("(?:\\.|[^"\\])*")\s*,\s*src:\s*("(?:\\.|[^"\\])*")\s*\}/g;
const tracks = [];

for (const match of bundle.matchAll(trackPattern)) {
  const title = JSON.parse(match[1]);
  const artist = JSON.parse(match[2]);
  const src = JSON.parse(match[3]);

  if (src.startsWith("/music/") && src.toLowerCase().endsWith(".mp3")) {
    tracks.push({ title, artist, url: new URL(src, siteRoot).href });
  }
}

if (!tracks.length) {
  throw new Error("No music tracks found in the current bundle.");
}

await writeFile("tracks.json", `${JSON.stringify(tracks, null, 2)}\n`);
console.log(`Wrote ${tracks.length} tracks to tracks.json`);
