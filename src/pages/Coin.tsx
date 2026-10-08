import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { createChart, CandlestickSeries, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts';
import { PublicKey } from '@solana/web3.js';
import { openWatch, fetchCoinInfo, buildSwapTx, type CoinInfo, type LiveBar } from '../lib/stream';
import { useWallet } from '../lib/wallet';
import { useToast } from '../lib/toast';
import { fmtUsd, fmtPrice } from '../lib/fmt';

const INTERVAL = 60; // 1m candles

/**
 * Coin view: live candles + non-custodial quick trade. Doubles as the
 * twitter:player iframe target at /embed/:mint (embed → compact, no footer,
 * an "Open Trends" escape hatch).
 */
export default function Coin({ embed = false }: { embed?: boolean }) {
  const { mint = '' } = useParams();
  const nav = useNavigate();
  const { connected, address, connection, login, signAndSendTransaction } = useWallet();
  const { toast, node } = useToast();

  const [info, setInfo] = useState<CoinInfo | null>(null);
  const [solUsd, setSolUsd] = useState(0);
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [busy, setBusy] = useState<string | null>(null);
  const [holding, setHolding] = useState<{ raw: string; ui: number; decimals: number }>({ raw: '0', ui: 0, decimals: 6 });
  const [lastPriceSol, setLastPriceSol] = useState(0);

  const chartRef = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<'Candlestick'> | null>(null);

  // Coin branding + solUsd.
  useEffect(() => {
    let dead = false;
    fetchCoinInfo(mint).then(({ info, solUsd }) => { if (!dead) { setInfo(info); setSolUsd(solUsd); if (info?.priceSol) setLastPriceSol(info.priceSol); } });
    return () => { dead = true; };
  }, [mint]);

  // Chart + live candles over the VPS watch socket.
  useEffect(() => {
    if (!chartRef.current) return;
    const c = createChart(chartRef.current, {
      layout: { background: { color: 'transparent' }, textColor: '#71717a', fontSize: 10, attributionLogo: false },
      grid: { vertLines: { color: 'rgba(255,255,255,0.04)' }, horzLines: { color: 'rgba(255,255,255,0.04)' } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
      autoSize: true,
      crosshair: { mode: 0 },
    });
    const s = c.addSeries(CandlestickSeries, {
      upColor: '#22C55E', downColor: '#ef4444', borderVisible: false,
      wickUpColor: '#22C55E', wickDownColor: '#ef4444',
      priceFormat: { type: 'price', precision: 10, minMove: 0.0000000001 },
    });
    chart.current = c; series.current = s;

    const toCandle = (b: LiveBar) => ({ time: Math.floor(b.t / 1000) as UTCTimestamp, open: b.o, high: b.h, low: b.l, close: b.c });
    const stop = openWatch(mint, (e) => {
      if (e.kind === 'history' && e.interval === INTERVAL) {
        series.current?.setData(e.bars.map(toCandle));
        chart.current?.timeScale().fitContent();
        const last = e.bars[e.bars.length - 1];
        if (last) setLastPriceSol(last.c);
      } else if (e.kind === 'candle' && e.interval === INTERVAL) {
        series.current?.update(toCandle(e.bar));
        setLastPriceSol(e.bar.c);
      } else if (e.kind === 'trade' && e.priceSol > 0) {
        setLastPriceSol(e.priceSol);
      }
    });
    return () => { stop(); c.remove(); chart.current = null; series.current = null; };
  }, [mint]);

  // The user's holding of this mint (for sells).
  useEffect(() => {
    if (!connected || !address) { setHolding({ raw: '0', ui: 0, decimals: 6 }); return; }
    let dead = false;
    const load = async () => {
      try {
        const res = await connection.getParsedTokenAccountsByOwner(new PublicKey(address), { mint: new PublicKey(mint) });
        let raw = 0n; let decimals = 6;
        for (const { account } of res.value) {
          const t = account.data.parsed?.info?.tokenAmount;
          if (t) { raw += BigInt(t.amount); decimals = t.decimals; }
        }
        if (!dead) setHolding({ raw: raw.toString(), ui: Number(raw) / 10 ** decimals, decimals });
      } catch { /* keep last */ }
    };
    load();
    const iv = setInterval(load, 15000);
    return () => { dead = true; clearInterval(iv); };
  }, [connected, address, mint, connection]);

  const priceUsd = lastPriceSol * solUsd || info?.priceUsd || 0;

  const trade = async (amountBase: string, label: string) => {
    if (!connected || !address) { login(); return; }
    setBusy(label);
    try {
      const { tx } = await buildSwapTx({ mint, side, user: address, amountBase });
      const sig = await signAndSendTransaction(tx);
      toast(`${side === 'buy' ? 'Bought' : 'Sold'} ✓ ${sig.slice(0, 10)}…`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Trade failed');
    } finally {
      setBusy(null);
    }
  };

  const buyAmounts = [0.05, 0.1, 0.5, 1];
  const sellPcts = [25, 50, 75, 100];

  const sellBase = (pct: number): string => {
    const raw = BigInt(holding.raw);
    return ((raw * BigInt(pct)) / 100n).toString();
  };

  const header = useMemo(() => (
    <div className="coin-head">
      {!embed && (
        <button className="btn ghost sm" onClick={() => nav(-1)} style={{ padding: '6px 10px' }}>←</button>
      )}
      {info?.image ? <img src={info.image} alt="" /> : <span className="coin-img" />}
      <div className="t">
        <div className="sym">${info?.symbol || mint.slice(0, 5)}</div>
        <div className="nm">{info?.name || ''}</div>
      </div>
      <div className="px">
        <div className="p">{fmtPrice(priceUsd)}</div>
        <div className="m">MC {fmtUsd(info?.mc)}</div>
      </div>
    </div>
  ), [info, priceUsd, embed, mint, nav]);

  return (
    <div style={{ position: 'relative' }}>
      {embed && (
        <a className="open-full" href={`/t/${mint}`} target="_blank" rel="noreferrer">Open Trends ↗</a>
      )}
      {header}
      <div className="chart-box"><div ref={chartRef} style={{ width: '100%', height: '100%' }} /></div>

      <div className="section">
        <div className="seg">
          <button className={side === 'buy' ? 'on buy' : ''} onClick={() => setSide('buy')}>BUY</button>
          <button className={side === 'sell' ? 'on sell' : ''} onClick={() => setSide('sell')}>SELL</button>
        </div>

        {side === 'buy' ? (
          <div className="trade-row">
            {buyAmounts.map((a) => (
              <button key={a} className="qbtn" disabled={!!busy}
                onClick={() => trade(String(Math.floor(a * 1e9)), `b${a}`)}>
                {busy === `b${a}` ? <span className="spin" style={{ margin: '0 auto' }} /> : `${a} ◎`}
              </button>
            ))}
          </div>
        ) : (
          <div className="trade-row">
            {sellPcts.map((p) => (
              <button key={p} className="qbtn sell" disabled={!!busy || holding.ui <= 0}
                onClick={() => trade(sellBase(p), `s${p}`)}>
                {busy === `s${p}` ? <span className="spin" style={{ margin: '0 auto' }} /> : `${p}%`}
              </button>
            ))}
          </div>
        )}

        <div className="hint" style={{ textAlign: 'center' }}>
          {connected
            ? side === 'sell'
              ? `You hold ${holding.ui.toLocaleString(undefined, { maximumFractionDigits: 2 })} $${info?.symbol || ''}`
              : 'Non-custodial — you approve every trade'
            : 'Sign in with 𝕏 to trade — a wallet is created for you'}
        </div>
        {!connected && (
          <>
            <div className="spacer" />
            <button className="btn" onClick={() => login()}>Sign in with 𝕏</button>
          </>
        )}
      </div>
      {node}
    </div>
  );
}
