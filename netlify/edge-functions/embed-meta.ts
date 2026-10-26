// embed-meta — injects per-mint X Player Card meta tags into /embed/:mint.
// twitter:card=player + twitter:player=<this page> makes X render a cover with a
// Play button; tapping Play loads this URL as an iframe in the tweet (the terminal).
// Branding (name/symbol/image) comes from Supabase token_launches — the VPS is not
// reachable from Netlify's edge runtime, but Supabase is.

const SUPABASE_URL = 'https://xtkacuezimrxdgjpxujk.supabase.co';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh0a2FjdWV6aW1yeGRnanB4dWprIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxMTkyMjEsImV4cCI6MjA4ODY5NTIyMX0.Df0gLhpCe_zuKZz3ynDquyXCG6qSvZv3DJDIglwLdkw';

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
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/token_launches?token_mint=eq.${mint}&select=name,symbol,image_url&limit=1`,
      { headers: { apikey: ANON, authorization: `Bearer ${ANON}` }, signal: AbortSignal.timeout(5000) },
    );
    const rows = await r.json();
    const c = Array.isArray(rows) ? rows[0] : null;
    if (c) {
      if (c.name) name = String(c.name);
      if (c.symbol) symbol = String(c.symbol);
      if (c.image_url) image = String(c.image_url);
    }
  } catch { /* fall back to defaults — the card still renders */ }

  // EXACT shape of the proven bo1zlite.xcade.gg player card (renders a PLAY button
  // in the tweet with no X approval): 1280x720 player + 1200x630 cover image with
  // explicit og:image dimensions.
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const playerUrl = `${url.origin}/embed/${mint}`;
  const title = `\$${esc(symbol)} — ${esc(name)}, tradeable in the tweet`;
  const desc = `Trade \$${esc(symbol)} right here on X. Tap PLAY — sign in with your X account, no install.`;
  const tags = [
    `<meta name="twitter:card" content="player">`,
    `<meta name="twitter:title" content="${title}">`,
    `<meta name="twitter:description" content="${desc}">`,
    `<meta name="twitter:image" content="${esc(image)}">`,
    `<meta name="twitter:player" content="${esc(playerUrl)}">`,
    `<meta name="twitter:player:width" content="1280">`,
    `<meta name="twitter:player:height" content="720">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:url" content="${esc(playerUrl)}">`,
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${desc}">`,
    `<meta property="og:image" content="${esc(image)}">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
  ].join('\n    ');

  // Strip index.html's default twitter:/og: tags so ONLY the player card is present
  // (duplicate twitter:card would make X fall back to the first = summary).
  const html = (await res.text()).replace(/[ \t]*<meta[^>]+(?:name="twitter:[^"]*"|property="og:[^"]*")[^>]*>\s*/gi, '');
  return new Response(html.replace('</head>', `    ${tags}\n  </head>`), {
    status: res.status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
};
