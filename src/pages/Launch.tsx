import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { VersionedTransaction, Transaction } from '@solana/web3.js';
import { supabase } from '../lib/supa';
import { useWallet } from '../lib/wallet';
import { useToast } from '../lib/toast';

type Venue = 'pump' | 'meteora';

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Launch — pump.fun or Meteora, NON-CUSTODIAL. The mini-launch edge fn builds the
 * create tx with YOUR wallet as creator + payer (mint partial-signed server-side,
 * Meteora SDK stays off this bundle), you sign in Privy, we send + record. Creator
 * fees accrue to YOUR wallet.
 */
export default function Launch() {
  const nav = useNavigate();
  const { connected, address, login, signAndSendTransaction } = useWallet();
  const { toast, node } = useToast();

  const [venue, setVenue] = useState<Venue>('pump');
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [desc, setDesc] = useState('');
  const [devBuy, setDevBuy] = useState('0.01');
  const [img, setImg] = useState<File | null>(null);
  const [imgPreview, setImgPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const onImage = (f: File | null) => {
    setImg(f);
    setImgPreview(f ? URL.createObjectURL(f) : null);
  };

  const canLaunch = connected && name.trim() && symbol.trim() && img && !busy;

  const launch = async () => {
    if (!connected || !address) { login(); return; }
    if (!img) { toast('Add a token image'); return; }
    try {
      // 1) Host the image (anon storage upload — same path trends.fm web uses).
      setBusy('Uploading image…');
      const ext = img.type.includes('png') ? 'png' : img.type.includes('webp') ? 'webp' : 'jpeg';
      const path = `tokens/mini-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const up = await supabase.storage.from('post-media').upload(path, img, { contentType: img.type, upsert: true, cacheControl: '3600' });
      if (up.error) throw new Error('image upload failed: ' + up.error.message);
      const imageUrl = supabase.storage.from('post-media').getPublicUrl(path).data.publicUrl;

      // 2) Server builds the create tx (user = creator + payer; mint partial-signed).
      setBusy('Building launch…');
      const { data: built, error: bErr } = await supabase.functions.invoke('mini-launch', {
        body: {
          action: 'build', venue, name: name.trim(), symbol: symbol.trim().toUpperCase(),
          description: desc.trim(), imageUrl, userWallet: address, devBuySol: Number(devBuy) || 0,
        },
      });
      if (bErr) throw new Error(bErr.message);
      if (built?.error) throw new Error(built.detail ? `${built.error}: ${JSON.stringify(built.detail).slice(0, 120)}` : String(built.error));

      // 3) You sign + we send (Privy sheet pops).
      setBusy('Sign in wallet…');
      const bytes = b64ToBytes(built.txBase64);
      let tx: VersionedTransaction | Transaction;
      try { tx = VersionedTransaction.deserialize(bytes); } catch { tx = Transaction.from(bytes); }
      const sig = await signAndSendTransaction(tx);

      // 4) Record so the coin shows on trends.fm + here instantly.
      setBusy('Recording…');
      await supabase.functions.invoke('mini-launch', {
        body: {
          action: 'record', venue, mint: built.mint, pool: built.pool ?? null, signature: sig,
          name: name.trim(), symbol: symbol.trim().toUpperCase(), description: desc.trim(),
          imageUrl, metadataUri: built.metadataUri ?? null, userWallet: address,
        },
      });

      toast(`$${symbol.trim().toUpperCase()} launched ✓`);
      setTimeout(() => nav(`/t/${built.mint}`), 900);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Launch failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <div className="page-head"><span className="page-title">Launch a coin</span></div>

      <div className="section" style={{ paddingTop: 0 }}>
        <span className="label">Launchpad</span>
        <button className={'venue-tile' + (venue === 'pump' ? ' on' : '')} onClick={() => setVenue('pump')}>
          <img src="https://pump.fun/favicon.ico" alt="" onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }} />
          <span>
            <span className="venue-title">Pump.fun</span>
            <div className="venue-sub">Bonding curve on pump.fun · creator fees accrue to YOUR wallet</div>
          </span>
        </button>
        <button className={'venue-tile' + (venue === 'meteora' ? ' on' : '')} onClick={() => setVenue('meteora')}>
          <img src="/trends-logo.jpg" alt="" />
          <span>
            <span className="venue-title">Trends · Meteora</span>
            <div className="venue-sub">Trends DBC curve · 4% fees, you are the pool creator</div>
          </span>
        </button>

        <div className="spacer" />
        <span className="label">Name</span>
        <input className="inp" value={name} onChange={(e) => setName(e.target.value)} maxLength={28} placeholder="My Coin" />
        <div className="spacer" />
        <span className="label">Ticker</span>
        <input className="inp" value={symbol} onChange={(e) => setSymbol(e.target.value.replace(/[^A-Za-z0-9/]/g, ''))} maxLength={10} placeholder="COIN" />
        <div className="spacer" />
        <span className="label">Description (optional)</span>
        <input className="inp" value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={300} placeholder="What is this coin?" />
        <div className="spacer" />
        <span className="label">Dev buy (SOL{venue === 'pump' ? ', min 0.001' : ', optional'})</span>
        <input className="inp" value={devBuy} onChange={(e) => setDevBuy(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" style={{ width: 120 }} />
        <div className="spacer" />
        <span className="label">Image</span>
        <label className="card" style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
          {imgPreview
            ? <img src={imgPreview} alt="" style={{ width: 54, height: 54, borderRadius: 10, objectFit: 'cover' }} />
            : <span style={{ width: 54, height: 54, borderRadius: 10, background: 'rgba(255,255,255,0.07)', display: 'grid', placeItems: 'center', color: '#52525b', fontSize: 22 }}>+</span>}
          <span style={{ fontSize: 13, color: '#a1a1aa' }}>{img ? img.name : 'Tap to choose the token image'}</span>
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" style={{ display: 'none' }} onChange={(e) => onImage(e.target.files?.[0] ?? null)} />
        </label>

        <div className="spacer" /><div className="spacer" />
        {connected ? (
          <button className="btn green" disabled={!canLaunch} onClick={launch}>
            {busy ? <><span className="spin" /> {busy}</> : `Launch on ${venue === 'pump' ? 'Pump.fun' : 'Meteora'} →`}
          </button>
        ) : (
          <button className="btn" onClick={() => login()}>Sign in with 𝕏 to launch</button>
        )}
        <div className="hint" style={{ textAlign: 'center' }}>You pay the launch from your wallet and keep the creator fees.</div>
      </div>
      {node}
    </div>
  );
}
