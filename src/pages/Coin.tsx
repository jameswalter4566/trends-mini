import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { createChart, CandlestickSeries, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts';
import { PublicKey } from '@solana/web3.js';
import { openWatch, fetchCoinInfo, fetchHolders, fetchSocials, buildSwapTx, type CoinInfo, type Holders, type Socials, type LiveBar } from '../lib/stream';
import { useWallet } from '../lib/wallet';
import { useToast } from '../lib/toast';
import { fmtUsd, fmtPrice, fmtPct, fmtNum, ago, trunc } from '../lib/fmt';

const INTERVAL = 60;

/**
 * Full coin terminal — header (image/ticker/badge/socials) + stats grid + live
 * candle chart + complete trade panel + about. Serves BOTH /t/:mint and the
 * twitter:player target /embed/:mint (embed just hides the footer via App + adds
 * an "Open Trends" button). Modeled 1:1 on trends.fm's TokensTerminalPage coin view.
 */
export default function Coin({ embed = false }: { embed?: boolean }) {
  const { mint = '' } = useParams();
  const { connected, address, connection, login, signAndSendTransaction } = useWallet();
  const { toast, node } = useToast();

  const [info, setInfo] = useState<CoinInfo | null>(null);
  const [solUsd, setSolUsd] = useState(0);
  const [holders, setHolders] = useState<Holders | null>(null);
  const [socials, setSocials] = useState<Socials>({});
  const [lastPriceSol, setLastPriceSol] = useState(0);

  // Trade panel state
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [amount, setAmount] = useState('');
  const [pct, setPct] = useState<number | null>(null);
  const [solBal, setSolBal] = useState(0);
  const [holding, setHolding] = useState({ ui: 0, raw: '0', decimals: 6 });
  const [busy, setBusy] = useState(false);

  const chartRef = useRef<HTMLDivElement>(null);

  // Branding + stats + socials + holders.
  useEffect(() => {
    let dead = false;
    fetchCoinInfo(mint).then(({ info, solUsd }) => { if (!dead) { setInfo(info); setSolUsd(solUsd); if (info?.priceSol) setLastPriceSol(info.priceSol); } });
    fetchHolders(mint).then((h) => { if (!dead) setHolders(h); });
    fetchSocials(mint).then((s) => { if (!dead) setSocials(s); });
    const iv = setInterval(() => { fetchCoinInfo(mint).then(({ info, solUsd }) => { if (!dead && info) { setInfo(info); if (solUsd) setSolUsd(solUsd); } }); }, 15000);
    return () => { dead = true; clearInterval(iv); };
  }, [mint]);

  // Chart + live candles.
  useEffect(() => {
    if (!chartRef.current) return;
    const c = createChart(chartRef.current, {
      layout: { background: { color: 'transparent' }, textColor: '#71717a', fontSize: 10, attributionLogo: false },
      grid: { vertLines: { color: 'rgba(255,255,255,0.04)' }, horzLines: { color: 'rgba(255,255,255,0.04)' } },
      rightPriceScale: { borderVisible: false }, timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
      autoSize: true, crosshair: { mode: 0 },
    });
    const s: ISeriesApi<'Candlestick'> = c.addSeries(CandlestickSeries, {
      upColor: '#22C55E', downColor: '#ef4444', borderVisible: false, wickUpColor: '#22C55E', wickDownColor: '#ef4444',
      priceFormat: { type: 'price', precision: 10, minMove: 0.0000000001 },
    });
    const toCandle = (b: LiveBar) => ({ time: Math.floor(b.t / 1000) as UTCTimestamp, open: b.o, high: b.h, low: b.l, close: b.c });
    const stop = openWatch(mint, (e) => {
      if (e.kind === 'history' && e.interval === INTERVAL) { s.setData(e.bars.map(toCandle)); c.timeScale().fitContent(); const last = e.bars[e.bars.length - 1]; if (last) setLastPriceSol(last.c); }
      else if (e.kind === 'candle' && e.interval === INTERVAL) { s.update(toCandle(e.bar)); setLastPriceSol(e.bar.c); }
      else if (e.kind === 'trade' && e.priceSol > 0) setLastPriceSol(e.priceSol);
    });
    return () => { stop(); c.remove(); };
  }, [mint]);

  // Balances.
  const refreshBalances = async () => {
    if (!connected || !address) { setSolBal(0); setHolding({ ui: 0, raw: '0', decimals: 6 }); return; }
    try {
      const lam = await connection.getBalance(new PublicKey(address)); setSolBal(lam / 1e9);
      const res = await connection.getParsedTokenAccountsByOwner(new PublicKey(address), { mint: new PublicKey(mint) });
      let raw = 0n; let decimals = 6;
      for (const { account } of res.value) { const t = account.data.parsed?.info?.tokenAmount; if (t) { raw += BigInt(t.amount); decimals = t.decimals; } }
      setHolding({ raw: raw.toString(), ui: Number(raw) / 10 ** decimals, decimals });
    } catch { /* keep */ }
  };
  useEffect(() => { refreshBalances(); const iv = setInterval(refreshBalances, 15000); return () => clearInterval(iv); }, [connected, address, mint]);

  const priceUsd = lastPriceSol * solUsd || info?.priceUsd || 0;
  const liveMc = info?.mc;
  const isPump = info?.launchpad === 'pump' || info?.venue === 'pump' || info?.venue === 'pumpfun';

  const execute = async () => {
    if (!connected || !address) { login(); return; }
    setBusy(true);
    try {
      let amountBase: string;
      if (side === 'buy') { const sol = parseFloat(amount); if (!(sol > 0)) throw new Error('Enter a SOL amount'); amountBase = String(Math.floor(sol * 1e9)); }
      else { const p = pct ?? 100; amountBase = ((BigInt(holding.raw) * BigInt(p)) / 100n).toString(); if (amountBase === '0') throw new Error('No holdings to sell'); }
      const { tx } = await buildSwapTx({ mint, side, user: address, amountBase });
      const sig = await signAndSendTransaction(tx);
      toast(`${side === 'buy' ? 'Bought' : 'Sold'} $${info?.symbol || ''} ✓`);
      setAmount(''); setPct(null); refreshBalances();
    } catch (e) { toast(e instanceof Error ? e.message : 'Swap failed'); }
    finally { setBusy(false); }
  };

  const solPresets = [0.1, 0.5, 1, 2];
  const pctPresets = [25, 50, 100];
  const sym = info?.symbol || mint.slice(0, 5);

  return (
    <div style={{ position: 'relative' }}>
      {embed && <a className="open-full" href={`/t/${mint}`} target="_blank" rel="noreferrer">Open Trends ↗</a>}

      {/* Header */}
      <div className="coin-head">
        {info?.image ? <img src={info.image} alt="" /> : <span className="coin-img" />}
        <div className="t">
          <div className="sym">
            ${sym}
            <span className={'badge' + (isPump ? ' pump' : '')} style={{ marginLeft: 6 }}>{isPump ? 'PUMP' : 'TRENDS'}</span>
            {info?.bonded && <span className="badge" style={{ marginLeft: 4, background: 'rgba(245,158,11,0.15)', color: '#f59e0b' }}>BONDED</span>}
          </div>
          <div className="nm">
            {info?.name || ''}
            {(socials.website || socials.twitter || socials.tiktok) && (
              <span style={{ marginLeft: 6 }}>
                {socials.website && <a href={socials.website} target="_blank" rel="noreferrer" style={{ color: '#a1a1aa', marginRight: 6 }}>🌐</a>}
                {socials.twitter && <a href={/^https?:/.test(socials.twitter) ? socials.twitter : `https://x.com/${socials.twitter}`} target="_blank" rel="noreferrer" style={{ color: '#a1a1aa', marginRight: 6, fontWeight: 900 }}>𝕏</a>}
                {socials.tiktok && <a href={socials.tiktok} target="_blank" rel="noreferrer" style={{ color: '#a1a1aa' }}>♪</a>}
              </span>
            )}
          </div>
        </div>
        <div className="px">
          <div className="p">{fmtPrice(priceUsd)}</div>
          <div className={'m ' + ((info?.change24h ?? 0) >= 0 ? 'up' : 'down')}>{fmtPct(info?.change24h) || ''}</div>
        </div>
      </div>

      {/* Stats grid */}
      <div className="stats-grid">
        <Stat label="Market cap" value={fmtUsd(liveMc)} />
        <Stat label="24H vol" value={fmtUsd(info?.vol24hUsd)} />
        <Stat label="Holders" value={holders ? holders.holders.toLocaleString() : '—'} />
        <Stat label="Top 10" value={holders ? `${holders.top10Pct.toFixed(1)}%` : '—'} />
        <Stat label="Status" value={info?.bonded ? 'Bonded' : 'Bonding'} />
        <Stat label="Age" value={ago(info?.createdAt) || '—'} />
      </div>

      <div className="chart-box"><div ref={chartRef} style={{ width: '100%', height: '100%' }} /></div>

      {/* Trade panel */}
      <div className="section">
        <div className="seg">
          <button className={side === 'buy' ? 'on buy' : ''} onClick={() => setSide('buy')}>BUY</button>
          <button className={side === 'sell' ? 'on sell' : ''} onClick={() => setSide('sell')}>SELL</button>
        </div>

        {side === 'buy' ? (
          <>
            <div className="amt-row">
              <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" placeholder="0.0" />
              <span className="amt-unit">SOL</span>
            </div>
            <div className="preset-row">
              {solPresets.map((p) => <button key={p} className="preset" onClick={() => setAmount(String(p))}>{p}</button>)}
            </div>
          </>
        ) : (
          <>
            <div className="hold-row">You hold <b>{holding.ui.toLocaleString(undefined, { maximumFractionDigits: 2 })}</b> ${sym}</div>
            <div className="preset-row">
              {pctPresets.map((p) => <button key={p} className={'preset' + (pct === p ? ' on' : '')} onClick={() => setPct(p)}>{p}%</button>)}
            </div>
          </>
        )}

        <div className="avail-row">
          <span>{!connected ? 'Sign in with 𝕏 to trade' : `${solBal.toFixed(3)} SOL available`}</span>
          {side === 'buy' && connected && <button className="maxlink" onClick={() => setAmount(Math.max(0, solBal - 0.01).toFixed(3))}>Max</button>}
        </div>

        <button className={'btn ' + (side === 'buy' ? 'green' : 'red')} disabled={busy} onClick={execute}>
          {busy ? <span className="spin" /> : !connected ? 'Sign in with 𝕏' : side === 'buy' ? `Buy $${sym}` : `Sell $${sym}`}
        </button>
        <div className="hint" style={{ textAlign: 'center' }}>You approve each trade in your wallet · ~1.5% slippage</div>
      </div>

      {/* About */}
      <div className="section" style={{ paddingTop: 0 }}>
        <div className="card">
          <div className="label">About ${sym}</div>
          <div className="kv"><span>Market cap</span><b>{fmtUsd(liveMc)}</b></div>
          <div className="kv"><span>Price</span><b>{fmtPrice(priceUsd)}</b></div>
          <div className="kv"><span>Holders</span><b>{holders ? holders.holders.toLocaleString() : '—'}</b></div>
          <div className="kv"><span>Top 10</span><b>{holders ? `${holders.top10Pct.toFixed(1)}%` : '—'}</b></div>
          <div className="kv"><span>Contract</span><b>{trunc(mint, 5, 5)}</b></div>
          <a className="btn ghost" style={{ marginTop: 10 }} href={`https://solscan.io/token/${mint}`} target="_blank" rel="noreferrer">View on Solscan ↗</a>
        </div>
      </div>
      {node}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="stat-l">{label}</div>
      <div className="stat-v">{value}</div>
    </div>
  );
}
