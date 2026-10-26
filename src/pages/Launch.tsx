import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { VersionedTransaction, Transaction } from '@solana/web3.js';
import { supabase } from '../lib/supa';
import { useWallet } from '../lib/wallet';
import { useToast } from '../lib/toast';

type Mode = 'self' | 'trendspay' | 'antibundle';
type Venue = 'pump' | 'meteora';
type XCreator = { handle: string; name: string; avatar: string | null; followers?: number | null; verified?: boolean };

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Launch — two modes, mirroring the trends.fm browser Launchpad:
 *  • Self: pump.fun OR Meteora tile, NON-CUSTODIAL (you are creator+payer, fees to you).
 *  • Trends Pay: launch for a creator on 𝕏 — their avatar becomes the coin, trading
 *    fees are directed to them (server-signed via trendspay-launch). Creator-fee
 *    allocation slider included.
 */
export default function Launch() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const { connected, address, login, signAndSendTransaction } = useWallet();
  const { toast, node } = useToast();

  const [mode, setMode] = useState<Mode>('self');
  const [venue, setVenue] = useState<Venue>('pump');
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [desc, setDesc] = useState('');
  const [devBuy, setDevBuy] = useState('0.01');
  const [img, setImg] = useState<File | null>(null);
  const [imgPreview, setImgPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [feePct, setFeePct] = useState(100);

  // Anti-bundle presale
  const [windowSec, setWindowSec] = useState(120);
  const [abMode, setAbMode] = useState<'app_only' | 'open'>('app_only');
  const [capSol, setCapSol] = useState('');

  // Trends Pay creator
  const [creator, setCreator] = useState<XCreator | null>(null);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<XCreator[]>([]);
  const [searching, setSearching] = useState(false);
  const t = useRef<ReturnType<typeof setTimeout>>();

  // Deep-linked from the Fees tab with a creator chosen → Trends Pay prefilled.
  useEffect(() => {
    const b = sp.get('beneficiary');
    if (b) {
      setMode('trendspay');
      setCreator({ handle: b, name: sp.get('bname') || b, avatar: sp.get('bimg') });
      setName((sp.get('bname') || `@${b}`).slice(0, 28));
      setSymbol((sp.get('bname') || b).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'TREND');
    }
  }, [sp]);

  // X creator typeahead for Trends Pay.
  useEffect(() => {
    if (mode !== 'trendspay' || creator) { setResults([]); return; }
    const term = q.trim().replace(/^@/, '');
    if (term.length < 2) { setResults([]); setSearching(false); return; }
    setSearching(true);
    if (t.current) clearTimeout(t.current);
    t.current = setTimeout(async () => {
      try { const { data } = await supabase.functions.invoke('x-creator-search', { body: { q: term } }); setResults(Array.isArray(data?.creators) ? data.creators : Array.isArray(data) ? data : []); }
      catch { setResults([]); } finally { setSearching(false); }
    }, 300);
    return () => { if (t.current) clearTimeout(t.current); };
  }, [q, mode, creator]);

  const pickCreator = (c: XCreator) => {
    setCreator(c);
    setName((c.name || `@${c.handle}`).slice(0, 28));
    setSymbol((c.name || c.handle).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'TREND');
    setResults([]); setQ('');
  };

  const onImage = (f: File | null) => { setImg(f); setImgPreview(f ? URL.createObjectURL(f) : null); };

  // ---- Trends Pay: server-signed launch for the X creator (fees to them) ----
  const launchTrendsPay = async () => {
    if (!creator) { toast('Pick a creator on 𝕏'); return; }
    if (!name.trim() || !symbol.trim()) { toast('Add a name + ticker'); return; }
    try {
      setBusy('Launching for @' + creator.handle + '…');
      const { data, error } = await supabase.functions.invoke('trendspay-launch', {
        body: {
          name: name.trim(), symbol: symbol.trim().toUpperCase(), description: desc.trim(),
          coverUrl: creator.avatar, handle: creator.handle,
          twitter: `x.com/${creator.handle}`, tokenizedBy: null, devBuySol: 0,
        },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(String(data.error));
      toast(`$${symbol.trim().toUpperCase()} launched for @${creator.handle} ✓`);
      setTimeout(() => nav(`/t/${data.mint}`), 900);
    } catch (e) { toast(e instanceof Error ? e.message : 'Launch failed'); }
    finally { setBusy(null); }
  };

  // ---- Self: non-custodial pump/meteora via mini-launch ----
  const launchSelf = async () => {
    if (!connected || !address) { login(); return; }
    if (!img) { toast('Add a token image'); return; }
    try {
      setBusy('Uploading image…');
      const ext = img.type.includes('png') ? 'png' : img.type.includes('webp') ? 'webp' : 'jpeg';
      const path = `tokens/mini-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const up = await supabase.storage.from('post-media').upload(path, img, { contentType: img.type, upsert: true, cacheControl: '3600' });
      if (up.error) throw new Error('image upload failed: ' + up.error.message);
      const imageUrl = supabase.storage.from('post-media').getPublicUrl(path).data.publicUrl;

      setBusy('Building launch…');
      const { data: built, error: bErr } = await supabase.functions.invoke('mini-launch', {
        body: { action: 'build', venue, name: name.trim(), symbol: symbol.trim().toUpperCase(), description: desc.trim(), imageUrl, userWallet: address, devBuySol: Number(devBuy) || 0 },
      });
      if (bErr) throw new Error(bErr.message);
      if (built?.error) throw new Error(built.detail ? `${built.error}: ${JSON.stringify(built.detail).slice(0, 120)}` : String(built.error));

      setBusy('Sign in wallet…');
      const bytes = b64ToBytes(built.txBase64);
      let tx: VersionedTransaction | Transaction;
      try { tx = VersionedTransaction.deserialize(bytes); } catch { tx = Transaction.from(bytes); }
      const sig = await signAndSendTransaction(tx);

      setBusy('Recording…');
      await supabase.functions.invoke('mini-launch', {
        body: { action: 'record', venue, mint: built.mint, pool: built.pool ?? null, signature: sig, name: name.trim(), symbol: symbol.trim().toUpperCase(), description: desc.trim(), imageUrl, metadataUri: built.metadataUri ?? null, userWallet: address },
      });
      toast(`$${symbol.trim().toUpperCase()} launched ✓`);
      setTimeout(() => nav(`/t/${built.mint}`), 900);
    } catch (e) { toast(e instanceof Error ? e.message : 'Launch failed'); }
    finally { setBusy(null); }
  };

  // ---- Anti-bundle: treasury-sponsored gated launch + presale window ----
  const launchAntiBundle = async () => {
    if (!connected || !address) { login(); return; }
    if (!name.trim() || !symbol.trim()) { toast('Add a name + ticker'); return; }
    if (!img) { toast('Add a token image'); return; }
    try {
      setBusy('Uploading image…');
      const ext = img.type.includes('png') ? 'png' : img.type.includes('webp') ? 'webp' : 'jpeg';
      const path = `tokens/ab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const up = await supabase.storage.from('post-media').upload(path, img, { contentType: img.type, upsert: true, cacheControl: '3600' });
      if (up.error) throw new Error('image upload failed: ' + up.error.message);
      const imageUrl = supabase.storage.from('post-media').getPublicUrl(path).data.publicUrl;

      setBusy('Opening presale window…');
      const { data, error } = await supabase.functions.invoke('anti-bundle-launch', {
        body: {
          action: 'launch', name: name.trim(), symbol: symbol.trim().toUpperCase(), description: desc.trim(),
          imageUrl, windowSeconds: windowSec, mode: abMode, perWalletCapSol: capSol ? Number(capSol) : null,
        },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.detail ? `${data.error}: ${JSON.stringify(data.detail).slice(0, 120)}` : String(data.error));
      toast(`$${symbol.trim().toUpperCase()} window opened ✓`);
      setTimeout(() => nav(`/t/${data.mint}`), 900);
    } catch (e) { toast(e instanceof Error ? e.message : 'Launch failed'); }
    finally { setBusy(null); }
  };

  const canSelf = connected && name.trim() && symbol.trim() && img && !busy;
  const canTp = !!creator && name.trim() && symbol.trim() && !busy;
  const canAb = connected && name.trim() && symbol.trim() && img && !busy;
  const winPct = ((windowSec - 60) / 240) * 100;

  return (
    <div>
      <div className="page-head"><span className="page-title">Launch a coin</span></div>

      <div className="section" style={{ paddingTop: 0 }}>
        {/* Launchpad mode tiles */}
        <span className="label">Launchpad</span>
        <button className={'venue-tile' + (mode === 'self' ? ' on' : '')} onClick={() => setMode('self')}>
          <img src="/trends-logo.jpg" alt="" />
          <span><span className="venue-title">Launch yourself</span><div className="venue-sub">Pump.fun or Meteora · you're the creator, fees to you</div></span>
        </button>
        <button className={'venue-tile' + (mode === 'trendspay' ? ' on' : '')} onClick={() => setMode('trendspay')}>
          <span style={{ width: 30, height: 30, borderRadius: 8, background: '#22C55E', display: 'grid', placeItems: 'center', color: '#000', fontWeight: 900 }}>𝕏</span>
          <span><span className="venue-title">Trends Pay</span><div className="venue-sub">Launch for a creator on 𝕏 · fees directed to them</div></span>
        </button>
        <button className={'venue-tile' + (mode === 'antibundle' ? ' on' : '')} onClick={() => setMode('antibundle')}>
          <span style={{ width: 30, height: 30, borderRadius: 8, background: '#3CC2DD', display: 'grid', placeItems: 'center', color: '#000', fontWeight: 900 }}>🛡</span>
          <span><span className="venue-title">Anti-Bundle</span><div className="venue-sub">Fair presale window · unsnipeable · app-only or open</div></span>
        </button>

        {/* Self: venue sub-choice */}
        {mode === 'self' && (
          <>
            <div className="spacer" />
            <span className="label">Pairing / curve</span>
            <div className="row">
              <button className={'pill' + (venue === 'pump' ? ' on' : '')} style={{ flex: 1 }} onClick={() => setVenue('pump')}>Pump.fun</button>
              <button className={'pill' + (venue === 'meteora' ? ' on' : '')} style={{ flex: 1 }} onClick={() => setVenue('meteora')}>Meteora (Trends)</button>
            </div>
          </>
        )}

        {/* Anti-bundle: presale window + post-window mode */}
        {mode === 'antibundle' && (
          <>
            <div className="spacer" />
            <span className="label">Presale window</span>
            <div className="card">
              <div className="fee-head"><span className="label" style={{ margin: 0 }}>Duration</span><b style={{ fontSize: 15 }}>{windowSec >= 60 ? `${Math.floor(windowSec / 60)}:${String(windowSec % 60).padStart(2, '0')}` : `${windowSec}s`}</b></div>
              <input type="range" min={60} max={300} step={15} value={windowSec} onChange={(e) => setWindowSec(Number(e.target.value))} className="glass-slider"
                style={{ background: `linear-gradient(90deg, #3CC2DD ${winPct}%, rgba(255,255,255,0.08) ${winPct}%)` }} />
              <div className="hint">Any wallet sends SOL during the window. At close, everyone is filled pro-rata at the <b>same price</b> — nothing to snipe or bundle.</div>
            </div>
            <div className="spacer" />
            <span className="label">After the window</span>
            <div className="row">
              <button className={'pill' + (abMode === 'app_only' ? ' on' : '')} style={{ flex: 1 }} onClick={() => setAbMode('app_only')}>App-only</button>
              <button className={'pill' + (abMode === 'open' ? ' on' : '')} style={{ flex: 1 }} onClick={() => setAbMode('open')}>Open</button>
            </div>
            <div className="hint">{abMode === 'app_only' ? 'Unbundleable: buyable only through Trends & FOMO until graduation. Pump.fun locked out.' : 'Fair window, then trades everywhere like a normal coin.'}</div>
            <div className="spacer" />
            <span className="label">Per-wallet cap (optional, SOL)</span>
            <input className="inp" value={capSol} onChange={(e) => setCapSol(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" placeholder="no cap" style={{ width: 140 }} />
          </>
        )}

        {/* Trends Pay: creator search / card */}
        {mode === 'trendspay' && (
          <>
            <div className="spacer" />
            <span className="label">Creator on 𝕏</span>
            {creator ? (
              <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {creator.avatar ? <img src={creator.avatar} alt="" style={{ width: 40, height: 40, borderRadius: 999, objectFit: 'cover' }} /> : <span className="coin-img" />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 900, fontSize: 14 }}>{creator.name}</div>
                  <div className="coin-name">@{creator.handle}{creator.followers != null ? ` · ${Intl.NumberFormat('en', { notation: 'compact' }).format(creator.followers)} followers` : ''}</div>
                </div>
                <button className="btn ghost sm" onClick={() => { setCreator(null); setName(''); setSymbol(''); }}>Change</button>
              </div>
            ) : (
              <>
                <input className="inp" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a creator on 𝕏…" />
                {searching && <div className="loading"><div className="spin" /></div>}
                {results.map((c) => (
                  <div key={c.handle} className="coin-row" onClick={() => pickCreator(c)} role="button">
                    {c.avatar ? <img className="coin-img" src={c.avatar} alt="" /> : <span className="coin-img" />}
                    <div className="coin-main"><div className="coin-sym">{c.name || c.handle}</div><div className="coin-name">@{c.handle}</div></div>
                  </div>
                ))}
              </>
            )}
          </>
        )}

        {/* Creator Fees allocation */}
        <div className="spacer" />
        <div className="card">
          <div className="fee-head"><span className="label" style={{ margin: 0 }}>Creator fees</span><b style={{ fontSize: 15 }}>{feePct}%</b></div>
          <input type="range" min={0} max={100} value={feePct} onChange={(e) => setFeePct(Number(e.target.value))} className="glass-slider"
            style={{ background: `linear-gradient(90deg, #22C55E ${feePct}%, rgba(255,255,255,0.08) ${feePct}%)` }} />
          <div className="hint">{mode === 'trendspay' ? `${feePct}% of trading fees go to @${creator?.handle || 'the creator'}.` : `${feePct}% of creator fees kept by you (the launcher).`}</div>
        </div>

        {/* Shared fields */}
        <div className="spacer" />
        <span className="label">Name</span>
        <input className="inp" value={name} onChange={(e) => setName(e.target.value)} maxLength={28} placeholder="My Coin" />
        <div className="spacer" />
        <span className="label">Ticker</span>
        <input className="inp" value={symbol} onChange={(e) => setSymbol(e.target.value.replace(/[^A-Za-z0-9/]/g, ''))} maxLength={10} placeholder="COIN" />
        <div className="spacer" />
        <span className="label">Description (optional)</span>
        <input className="inp" value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={300} placeholder="What is this coin?" />

        {mode === 'self' && (
          <>
            <div className="spacer" />
            <span className="label">Dev buy (SOL)</span>
            <input className="inp" value={devBuy} onChange={(e) => setDevBuy(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" style={{ width: 120 }} />
          </>
        )}
        {(mode === 'self' || mode === 'antibundle') && (
          <>
            <div className="spacer" />
            <span className="label">Image</span>
            <label className="card" style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
              {imgPreview ? <img src={imgPreview} alt="" style={{ width: 54, height: 54, borderRadius: 10, objectFit: 'cover' }} />
                : <span style={{ width: 54, height: 54, borderRadius: 10, background: 'rgba(255,255,255,0.07)', display: 'grid', placeItems: 'center', color: '#52525b', fontSize: 22 }}>+</span>}
              <span style={{ fontSize: 13, color: '#a1a1aa' }}>{img ? img.name : 'Tap to choose the token image'}</span>
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" style={{ display: 'none' }} onChange={(e) => onImage(e.target.files?.[0] ?? null)} />
            </label>
          </>
        )}
        {mode === 'trendspay' && creator?.avatar && (
          <div className="hint" style={{ marginTop: 8 }}>The coin image will be @{creator.handle}'s 𝕏 avatar.</div>
        )}

        <div className="spacer" /><div className="spacer" />
        {mode === 'self' ? (
          connected
            ? <button className="btn green" disabled={!canSelf} onClick={launchSelf}>{busy ? <><span className="spin dark" /> {busy}</> : `Launch on ${venue === 'pump' ? 'Pump.fun' : 'Meteora'} →`}</button>
            : <button className="btn" onClick={() => login()}>Sign in with 𝕏 to launch</button>
        ) : mode === 'antibundle' ? (
          connected
            ? <button className="btn green" disabled={!canAb} onClick={launchAntiBundle}>{busy ? <><span className="spin dark" /> {busy}</> : `Open the ${windowSec >= 60 ? `${Math.floor(windowSec / 60)}:${String(windowSec % 60).padStart(2, '0')}` : `${windowSec}s`} window →`}</button>
            : <button className="btn" onClick={() => login()}>Sign in with 𝕏 to launch</button>
        ) : (
          <button className="btn green" disabled={!canTp} onClick={launchTrendsPay}>{busy ? <><span className="spin dark" /> {busy}</> : creator ? `Launch for @${creator.handle} →` : 'Pick a creator first'}</button>
        )}
        <div className="hint" style={{ textAlign: 'center' }}>{mode === 'self' ? 'You pay the launch and keep the creator fees.' : mode === 'antibundle' ? 'Trends sponsors the launch. The presale window fills everyone at one price — unsnipeable.' : 'Trends launches it and directs trading fees to the creator.'}</div>
      </div>
      {node}
    </div>
  );
}
