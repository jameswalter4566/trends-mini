import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchCoinBook, type CoinRecord } from '../lib/stream';
import { fmtUsd, fmtPct, ago } from '../lib/fmt';

/** Feed/Search — search bar pinned top (searches the whole coin book by ticker/
 *  name/mint), latest launches streaming under it. */
export default function Feed() {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [coins, setCoins] = useState<CoinRecord[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let dead = false;
    fetchCoinBook().then(({ coins }) => { if (!dead) { setCoins(coins); setLoaded(true); } });
    const iv = setInterval(() => fetchCoinBook().then(({ coins }) => { if (!dead && coins.length) setCoins(coins); }), 20000);
    return () => { dead = true; clearInterval(iv); };
  }, []);

  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return [...coins].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)).slice(0, 60);
    return coins.filter((c) =>
      (c.symbol || '').toLowerCase().includes(term) ||
      (c.name || '').toLowerCase().includes(term) ||
      c.mint.toLowerCase() === term,
    ).slice(0, 60);
  }, [coins, q]);

  return (
    <div>
      <div className="section" style={{ paddingBottom: 6 }}>
        <input className="inp" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search tickers, names, or paste a CA…" />
      </div>
      {!loaded ? (
        <div className="loading"><div className="spin" /></div>
      ) : list.length === 0 ? (
        <div className="center">No coins match “{q}”.</div>
      ) : (
        list.map((c) => (
          <div key={c.mint} className="coin-row" onClick={() => nav(`/t/${c.mint}`)} role="button">
            {c.image ? <img className="coin-img" src={c.image} alt="" loading="lazy" /> : <span className="coin-img" />}
            <div className="coin-main">
              <div className="coin-sym">${c.symbol || c.mint.slice(0, 5)}</div>
              <div className="coin-name">{c.name || ''}{c.createdAt ? ` · launched ${ago(c.createdAt)} ago` : ''}</div>
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
