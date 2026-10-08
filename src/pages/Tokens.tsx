import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchCoinBook, openCoinBook, type CoinRecord } from '../lib/stream';
import { fmtUsd, fmtPct, ago } from '../lib/fmt';

type Tab = 'trending' | 'new' | 'bonded';

/** Token discovery — the VPS coin book (snapshot + live deltas), same data as trends.fm. */
export default function Tokens() {
  const nav = useNavigate();
  const [tab, setTab] = useState<Tab>('trending');
  const [coins, setCoins] = useState<CoinRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const pending = useRef<Map<string, CoinRecord>>(new Map());

  useEffect(() => {
    let dead = false;
    fetchCoinBook().then(({ coins }) => { if (!dead && coins.length) { setCoins(coins); setLoaded(true); } });
    // Batch deltas → flush ~1/sec (they arrive ~25/sec; per-delta renders would melt the iframe).
    const flush = window.setInterval(() => {
      if (dead || pending.current.size === 0) return;
      const batch = pending.current;
      pending.current = new Map();
      setCoins((prev) => {
        const next = prev.map((r) => (batch.has(r.mint) ? batch.get(r.mint)! : r));
        const have = new Set(prev.map((r) => r.mint));
        for (const [mint, c] of batch) if (!have.has(mint)) next.push(c);
        return next;
      });
    }, 1000);
    const stop = openCoinBook(
      (all) => { if (!dead) { setCoins(all); setLoaded(true); } },
      (c) => { if (!dead) pending.current.set(c.mint, c); },
    );
    return () => { dead = true; window.clearInterval(flush); stop(); };
  }, []);

  const list = useMemo(() => {
    const byMc = (a: CoinRecord, b: CoinRecord) => (b.mc ?? 0) - (a.mc ?? 0);
    const byDate = (a: CoinRecord, b: CoinRecord) => (b.createdAt ?? 0) - (a.createdAt ?? 0);
    if (tab === 'new') return [...coins].sort(byDate);
    if (tab === 'bonded') return coins.filter((c) => c.bonded).sort(byMc);
    return [...coins].sort(byMc);
  }, [coins, tab]);

  return (
    <div>
      <div className="page-head">
        <span className="page-title">Tokens</span>
        <img src="/trends-logo.jpg" alt="" style={{ width: 26, height: 26, borderRadius: 999 }} />
      </div>
      <div className="pill-row">
        {(['trending', 'new', 'bonded'] as Tab[]).map((t) => (
          <button key={t} className={'pill' + (tab === t ? ' on' : '')} onClick={() => setTab(t)}>
            {t === 'trending' ? 'Trending' : t === 'new' ? 'New Pairs' : 'Bonded'}
          </button>
        ))}
      </div>
      {!loaded ? (
        <div className="loading"><div className="spin" /></div>
      ) : (
        list.slice(0, 120).map((c) => (
          <div key={c.mint} className="coin-row" onClick={() => nav(`/t/${c.mint}`)} role="button">
            {c.image ? <img className="coin-img" src={c.image} alt="" loading="lazy" /> : <span className="coin-img" />}
            <div className="coin-main">
              <div className="coin-sym">
                ${c.symbol || c.mint.slice(0, 5)}
                {(c.launchpad === 'pump' || c.venue === 'pump' || c.venue === 'pumpfun') ? <span className="badge pump">PUMP</span> : <span className="badge">TRENDS</span>}
              </div>
              <div className="coin-name">{c.name || ''}{c.createdAt ? ` · ${ago(c.createdAt)}` : ''}</div>
            </div>
            <div className="coin-right">
              <div className="coin-mc">{fmtUsd(c.mc)}</div>
              <div className={'coin-name ' + ((c.change24h ?? 0) >= 0 ? 'up' : 'down')}>{fmtPct(c.change24h)}</div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
