const SITE_ORIGIN = "https://funkinbackstage.net";
const API_ORIGIN = "https://api.funkinbackstage.net";

export async function loadBackstageStickers() {
  const pageResponse = await fetch(`${SITE_ORIGIN}/chat`, {
    headers: { Accept: "text/html", "User-Agent": "BackstageExtraAPI/1.0" },
  });
  if (!pageResponse.ok) throw new Error(`Chat page returned ${pageResponse.status}`);

  const page = await pageResponse.text();
  const mainBundlePath = [...page.matchAll(/\bsrc=["']([^"']+)["']/g)]
    .map((match) => match[1])
    .find((src) => /\/assets\/index-[^/]+\.js(?:\?.*)?$/.test(src));
  if (!mainBundlePath) throw new Error("Could not find the current site JavaScript bundle");

  const mainBundleResponse = await fetch(new URL(mainBundlePath, `${SITE_ORIGIN}/`), {
    headers: { Accept: "application/javascript" },
  });
  if (!mainBundleResponse.ok) throw new Error(`Site bundle returned ${mainBundleResponse.status}`);

  const mainBundle = await mainBundleResponse.text();
  const stickerChunkPath = mainBundle.match(/(?:\.\/|\/)?assets\/stickers-[^"']+\.js/)?.[0];
  if (!stickerChunkPath) throw new Error("Could not find the chat sticker data chunk");

  const stickerChunkResponse = await fetch(new URL(stickerChunkPath, `${SITE_ORIGIN}/`), {
    headers: { Accept: "application/javascript" },
  });
  if (!stickerChunkResponse.ok) throw new Error(`Sticker data chunk returned ${stickerChunkResponse.status}`);

  const stickerChunk = await stickerChunkResponse.text();
  const richTextPath = stickerChunk.match(/from["']\.\/(richText-[^"']+\.js)["']/)?.[1];
  if (!richTextPath) throw new Error("Could not find the built-in sticker list");

  const richTextResponse = await fetch(new URL(richTextPath, `${SITE_ORIGIN}/assets/`), {
    headers: { Accept: "application/javascript" },
  });
  if (!richTextResponse.ok) throw new Error(`Built-in sticker list returned ${richTextResponse.status}`);

  const richTextBundle = await richTextResponse.text();
  const builtIn = parseBuiltInStickerData(richTextBundle);
  const siteResponse = await fetch(`${API_ORIGIN}/site`, {
    headers: { Accept: "application/json", "User-Agent": "BackstageExtraAPI/1.0" },
  });
  if (!siteResponse.ok) throw new Error(`Site data endpoint returned ${siteResponse.status}`);

  const siteData = await siteResponse.json();
  const customCategories = Array.isArray(siteData.categories) ? siteData.categories : [];
  const customStickers = Array.isArray(siteData.stickers) ? siteData.stickers : [];

  const categories = [
    ...builtIn.categories,
    ...customCategories.map((category) => ({
      id: category.key,
      name: category.name,
      custom: true,
    })),
  ];
  const stickers = [
    ...builtIn.stickers,
    ...customStickers.map((sticker) => ({
      name: sticker.name,
      group: sticker.group,
      url: new URL(sticker.url, `${API_ORIGIN}/`).href,
      custom: true,
    })),
  ];

  const groupedCategories = categories
    .map((category) => ({
      ...category,
      stickers: stickers.filter((sticker) => sticker.group === category.id),
    }))
    .filter((category) => category.stickers.length > 0);

  return {
    categoryCount: groupedCategories.length,
    stickerCount: groupedCategories.reduce((total, category) => total + category.stickers.length, 0),
    categories: groupedCategories,
  };
}

function parseBuiltInStickerData(bundle) {
  const maps = bundle.match(/const\s+[A-Za-z_$][\w$]*=(\{[^{}]*\}),[A-Za-z_$][\w$]*=(\{[^{}]*\}),/);
  if (!maps) throw new Error("Could not parse built-in sticker categories");

  const stickerGroups = new Map();
  for (const match of maps[1].matchAll(/([A-Za-z_$][\w$]*):(\[[^\]]*\])/g)) {
    stickerGroups.set(match[1], JSON.parse(match[2]));
  }

  const categoryNames = new Map();
  for (const match of maps[2].matchAll(/([A-Za-z_$][\w$]*):("(?:\\.|[^"\\])*")/g)) {
    categoryNames.set(match[1], JSON.parse(match[2]));
  }

  if (!stickerGroups.size || stickerGroups.size !== categoryNames.size) {
    throw new Error("Built-in sticker category data was incomplete");
  }

  const gifNames = new Set();
  const gifMatch = bundle.match(/new Set\((\[[^\]]*\])\)/);
  if (gifMatch) {
    for (const name of JSON.parse(gifMatch[1])) gifNames.add(name);
  }

  return {
    categories: [...stickerGroups.keys()].map((id) => ({
      id,
      name: categoryNames.get(id),
      custom: false,
    })),
    stickers: [...stickerGroups.entries()].flatMap(([group, names]) =>
      names.map((name) => ({
        name,
        group,
        url: new URL(`/images/chat/stickers/${name}.${gifNames.has(name) ? "gif" : "png"}`, SITE_ORIGIN).href,
        custom: false,
      })),
    ),
  };
}
