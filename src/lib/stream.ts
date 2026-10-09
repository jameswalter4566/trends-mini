/**
 * Thin client for the trends-exec VPS — the ONE data backend. Coin book (HTTP
 * snapshot + WS deltas), per-mint watch (candles + trades), coininfo, and the
 * non-custodial /build-swap. Mirrors the trends.fm web protocol exactly.
 */
import { VersionedTransaction } from '@solana/web3.js';

export const STREAM_BASE = 'https://194-163-134-79.sslip.io';
const WS_URL = STREAM_BASE.replace(/^http/, 'ws') + '/ws';

export type CoinRecord = {
  mint: string;
  symbol?: string;
  name?: string;
  image?: string;
  priceSol?: number;
  priceUsd?: number;
  mc?: number;
  vol24hUsd?: number;
  change24h?: number | null;
  venue?: string | null;
  launchpad?: string | null;
  pool?: string | null;
  bonded?: boolean;
  verified?: boolean;
  createdAt?: number | null;
};

export async function fetchCoinBook(): Promise<{ coins: CoinRecord[]; solUsd: number }> {
  const r = await fetch(`${STREAM_BASE}/coins`);
  const j = await r.json().catch(() => ({ coins: [], solUsd: 0 }));
  return { coins: Array.isArray(j.coins) ? j.coins : [], solUsd: j.solUsd || 0 };
}

/** Live coin book: snapshot on connect + per-coin deltas. Returns unsubscribe. */
export function openCoinBook(onBook: (coins: CoinRecord[]) => void, onDelta: (c: CoinRecord) => void): () => void {
  let ws: WebSocket | null = null;
  let closed = false;
  let retry = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const connect = () => {
    if (closed) return;
    ws = new WebSocket(WS_URL);
    ws.onopen = () => { retry = 0; try { ws!.send(JSON.stringify({ type: 'subscribe', topics: ['coins'] })); } catch { /* noop */ } };
    ws.onmessage = (ev) => {
      try {
        const m = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
        if (m.type === 'book' && m.topic === 'coins' && Array.isArray(m.data)) onBook(m.data);
        else if (m.type === 'event' && m.topic === 'coins' && m.data?.mint) onDelta(m.data);
      } catch { /* ignore */ }
    };
    ws.onclose = () => { if (!closed) timer = setTimeout(connect, Math.min(15000, 1000 * 2 ** Math.min(retry++, 4))); };
    ws.onerror = () => { try { ws?.close(); } catch { /* noop */ } };
  };
  connect();
  return () => { closed = true; if (timer) clearTimeout(timer); try { ws?.close(); } catch { /* noop */ } };
}

export type LiveBar = { t: number; o: number; h: number; l: number; c: number; v: number };
export type WatchEvent =
  | { kind: 'history'; interval: number; bars: LiveBar[] }
  | { kind: 'candle'; interval: number; bar: LiveBar }
  | { kind: 'trade'; priceSol: number; sizeBase: number; at: number };

/** Watch one mint: candle history + live bars. Returns unsubscribe. */
export function openWatch(mint: string, onEvent: (e: WatchEvent) => void): () => void {
  let ws: WebSocket | null = null;
  let closed = false;
  let retry = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const connect = () => {
    if (closed) return;
    ws = new WebSocket(WS_URL);
    ws.onopen = () => { retry = 0; try { ws!.send(JSON.stringify({ type: 'watch', mint })); } catch { /* noop */ } };
    ws.onmessage = (ev) => {
      try {
        const m = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
        if (m.type === 'history' && Array.isArray(m.bars)) onEvent({ kind: 'history', interval: Number(m.interval), bars: m.bars });
        else if (m.type === 'event' && m.topic === 'candles' && m.data?.bar) onEvent({ kind: 'candle', interval: Number(m.data.interval), bar: m.data.bar });
        else if (m.type === 'event' && m.topic === 'trades' && m.data) onEvent({ kind: 'trade', priceSol: Number(m.data.priceSol), sizeBase: Number(m.data.sizeBase), at: Number(m.data.at) });
      } catch { /* ignore */ }
    };
    ws.onclose = () => { if (!closed) timer = setTimeout(connect, Math.min(15000, 1000 * 2 ** Math.min(retry++, 4))); };
    ws.onerror = () => { try { ws?.close(); } catch { /* noop */ } };
  };
  connect();
  return () => {
    closed = true;
    if (timer) clearTimeout(timer);
    try { ws?.send(JSON.stringify({ type: 'unwatch', mint })); } catch { /* noop */ }
    try { ws?.close(); } catch { /* noop */ }
  };
}

export type CoinInfo = { symbol?: string; name?: string; image?: string; priceUsd?: number; priceSol?: number; mc?: number; vol24hUsd?: number; change24h?: number | null; venue?: string | null; launchpad?: string | null; bonded?: boolean; createdAt?: number | null };

export type Holders = { holders: number; top10Pct: number; topHolders?: { owner: string; amount: number }[] };

/** Real holder count + top-10 concentration from the VPS /holders resolver. */
export async function fetchHolders(mint: string): Promise<Holders | null> {
  try {
    const r = await fetch(`${STREAM_BASE}/holders`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mint }) });
    if (!r.ok) return null;
    const j = await r.json();
    if (typeof j.holders !== 'number') return null;
    return { holders: j.holders, top10Pct: j.top10Pct ?? 0, topHolders: j.topHolders };
  } catch { return null; }
}

export type Socials = { website?: string; twitter?: string; telegram?: string; tiktok?: string };

/** Socials from the token's metadata JSON (deterministic Supabase storage path). */
export async function fetchSocials(mint: string): Promise<Socials> {
  try {
    const r = await fetch(`https://xtkacuezimrxdgjpxujk.supabase.co/storage/v1/object/public/post-media/tokens/token-${mint}.json`);
    if (!r.ok) return {};
    const j = await r.json();
    const ext = j.extensions || {};
    return { website: j.website ?? ext.website, twitter: j.twitter ?? ext.twitter, telegram: j.telegram ?? ext.telegram, tiktok: j.tiktok ?? ext.tiktok };
  } catch { return {}; }
}

export async function fetchCoinInfo(mint: string): Promise<{ info: CoinInfo | null; solUsd: number }> {
  try {
    const r = await fetch(`${STREAM_BASE}/coininfo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mints: [mint] }),
    });
    const j = await r.json();
    return { info: j?.coins?.[mint] ?? null, solUsd: Number(j?.solUsd) || 0 };
  } catch {
    return { info: null, solUsd: 0 };
  }
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** VPS builds an unsigned v0 tx where the user is sole signer + payer. */
export async function buildSwapTx(params: {
  mint: string;
  side: 'buy' | 'sell';
  user: string;
  amountBase: string; // buy: SOL lamports · sell: token base units
  slippageBps?: number;
}): Promise<{ tx: VersionedTransaction; outAmount: string; venue: string }> {
  const r = await fetch(`${STREAM_BASE}/build-swap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slippageBps: 150, ...params }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.txBase64) throw new Error(j.error || `build_failed_${r.status}`);
  return { tx: VersionedTransaction.deserialize(b64ToBytes(j.txBase64)), outAmount: j.outAmount, venue: j.venue };
}
