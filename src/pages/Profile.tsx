import { useEffect, useState } from 'react';
import { useWallet } from '../lib/wallet';
import { useToast } from '../lib/toast';
import { trunc, fmtNum } from '../lib/fmt';

/** Profile — X identity, embedded wallet (balance, copy address, export key), logout. */
export default function Profile() {
  const { ready, connected, address, xHandle, connection, login, logout, exportKey } = useWallet();
  const { toast, node } = useToast();
  const [sol, setSol] = useState<number | null>(null);

  useEffect(() => {
    if (!connected || !address) { setSol(null); return; }
    let dead = false;
    const load = async () => {
      try { const { PublicKey } = await import('@solana/web3.js'); const b = await connection.getBalance(new PublicKey(address)); if (!dead) setSol(b / 1e9); } catch { /* keep */ }
    };
    load();
    const iv = setInterval(load, 15000);
    return () => { dead = true; clearInterval(iv); };
  }, [connected, address, connection]);

  if (!ready) return <div className="loading"><div className="spin" /></div>;

  if (!connected) {
    return (
      <div>
        <div className="page-head"><span className="page-title">Profile</span></div>
        <div className="center">
          <img src="/trends-logo.jpg" alt="" style={{ width: 54, height: 54, borderRadius: 999 }} />
          <div style={{ fontSize: 14, fontWeight: 800, color: '#fff' }}>Sign in with 𝕏</div>
          <div>A Solana wallet is created for you automatically — trade & launch instantly.</div>
          <button className="btn" style={{ maxWidth: 260 }} onClick={() => login()}>Sign in with 𝕏</button>
        </div>
        {node}
      </div>
    );
  }

  return (
    <div>
      <div className="page-head"><span className="page-title">Profile</span></div>
      <div className="section" style={{ paddingTop: 0 }}>
        <div className="card">
          <div className="row" style={{ alignItems: 'center' }}>
            <span style={{ width: 44, height: 44, borderRadius: 999, background: '#18181b', display: 'grid', placeItems: 'center', fontSize: 18, fontWeight: 900 }}>𝕏</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 900 }}>{xHandle ? `@${xHandle}` : 'Trends user'}</div>
              <div className="coin-name">Signed in with 𝕏</div>
            </div>
          </div>
          <div className="spacer" />
          <div className="label">Wallet balance</div>
          <div style={{ fontSize: 26, fontWeight: 900 }}>{sol == null ? '—' : fmtNum(sol)} <span style={{ fontSize: 14, color: '#71717a' }}>SOL</span></div>
          <div className="spacer" />
          <div className="label">Address</div>
          <button className="btn ghost" onClick={() => { if (address) { navigator.clipboard.writeText(address); toast('Address copied'); } }}>
            {address ? trunc(address, 6, 6) : '—'} · Copy
          </button>
        </div>

        <div className="spacer" />
        <button className="btn ghost" onClick={async () => { try { await exportKey(); } catch (e) { toast(e instanceof Error ? e.message : 'Export failed'); } }}>
          🔑 Export private key
        </button>
        <div className="hint">You reveal your key through Privy — we never see it.</div>

        <div className="spacer" /><div className="spacer" />
        <button className="btn ghost" onClick={() => logout()}>Log out</button>
      </div>
      {node}
    </div>
  );
}
