// embed-meta — injects per-mint X Player Card meta tags into /embed/:mint.
// This is THE mechanism that renders the tradeable terminal inside a tweet:
// twitter:card=player + twitter:player=<this page> makes X show a cover with a
// Play button, and tapping Play loads this exact URL as an iframe in the post.
// Coin branding (name/symbol/image) comes live from the trends-exec VPS.

const VPS = 'https://194-163-134-79.sslip.io';

export default async (request: Request, context: { next: () => Promise<Response> }) => {
  const url = new URL(request.url);
  const m = url.pathname.match(/^\/embed\/([1-9A-HJ-NP-Za-km-z]{32,44})\/?$/);
  const res = await context.next();
  if (!m) return res;
  const mint = m[1];

  let name = 'Trends coin';
  let symbol = 'COIN';
  let image = `${url.origin}/trends-logo.jpg`;
  try {
    const r = await fetch(`${VPS}/coininfo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mints: [mint] }),
      signal: AbortSignal.timeout(4000),
    });
    const j = await r.json();
    const c = j?.coins?.[mint];
    if (c) {
      if (c.name) name = String(c.name);
      if (c.symbol) symbol = String(c.symbol);
      if (c.image) image = String(c.image);
    }
  } catch { /* fall back to defaults — the card still renders */ }

  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const playerUrl = `${url.origin}/embed/${mint}`;
  const title = `$${esc(symbol)} — ${esc(name)} on Trends`;
  const desc = `Tap Play to trade $${esc(symbol)} right here inside X`;
  const tags = [
    `<meta name="twitter:card" content="player" />`,
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${desc}" />`,
    `<meta name="twitter:image" content="${esc(image)}" />`,
    `<meta name="twitter:player" content="${esc(playerUrl)}" />`,
    `<meta name="twitter:player:width" content="480" />`,
    `<meta name="twitter:player:height" content="480" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${desc}" />`,
    `<meta property="og:image" content="${esc(image)}" />`,
    `<meta property="og:url" content="${esc(playerUrl)}" />`,
  ].join('\n    ');

  // Strip the index.html default twitter:/og: tags so there's ONLY the player card
  // on /embed/* — duplicate twitter:card tags make X fall back to the first (summary).
  const html = (await res.text()).replace(/[ \t]*<meta[^>]+(?:name="twitter:[^"]*"|property="og:[^"]*")[^>]*>\s*/gi, '');
  return new Response(html.replace('</head>', `    ${tags}\n  </head>`), {
    status: res.status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
};
