import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supa';
import { useWallet } from '../lib/wallet';

type XCreator = { handle: string; name: string; avatar: string | null; followers?: number | null; verified?: boolean };

/**
 * Creator Fees — pick a creator on X, launch a coin whose fees are directed to
 * them (routes through the Launch flow with the creator prefilled). Mirrors the
 * trends.fm Creator Fees hub, trimmed to the X path for the embed surface.
 */
export default function Fees() {
  const nav = useNavigate();
  const { connected, login } = useWallet();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<XCreator[]>([]);
  const [searching, setSearching] = useState(false);
  const t = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    const term = q.trim().replace(/^@/, '');
    if (term.length < 2) { setResults([]); setSearching(false); return; }
    setSearching(true);
    if (t.current) clearTimeout(t.current);
    t.current = setTimeout(async () => {
      try {
        const { data } = await supabase.functions.invoke('x-creator-search', { body: { q: term } });
        setResults(Array.isArray(data?.creators) ? data.creators : Array.isArray(data) ? data : []);
      } catch { setResults([]); }
      finally { setSearching(false); }
    }, 300);
    return () => { if (t.current) clearTimeout(t.current); };
  }, [q]);

  const pick = (c: XCreator) => {
    // Hand off to Launch with the X creator prefilled as the fee beneficiary.
    nav(`/launch?beneficiary=${encodeURIComponent(c.handle)}&bname=${encodeURIComponent(c.name || c.handle)}${c.avatar ? `&bimg=${encodeURIComponent(c.avatar)}` : ''}`);
  };

  return (
    <div>
      <div className="page-head"><span className="page-title">Gift fees to a creator</span></div>
      <div className="section" style={{ paddingTop: 0 }}>
        <p className="hint" style={{ marginBottom: 10, fontSize: 12 }}>Find a creator on 𝕏 and launch a coin whose trading fees are directed to them.</p>
        <input className="inp" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a creator on 𝕏…" />
      </div>
      {searching && <div className="loading"><div className="spin" /></div>}
      {results.map((c) => (
        <div key={c.handle} className="coin-row" onClick={() => pick(c)} role="button">
          {c.avatar ? <img className="coin-img" src={c.avatar} alt="" loading="lazy" /> : <span className="coin-img" />}
          <div className="coin-main">
            <div className="coin-sym">{c.name || c.handle}</div>
            <div className="coin-name">@{c.handle}{c.followers != null ? ` · ${Intl.NumberFormat('en', { notation: 'compact' }).format(c.followers)} followers` : ''}</div>
          </div>
          <span className="btn green sm">Launch →</span>
        </div>
      ))}
      {!connected && !searching && results.length === 0 && (
        <div className="center">
          Sign in with 𝕏 to launch creator-fee coins.
          <button className="btn" style={{ maxWidth: 240 }} onClick={() => login()}>Sign in with 𝕏</button>
        </div>
      )}
    </div>
  );
}
