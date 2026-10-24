import { useEffect, useState } from 'react';
import { useWallet } from '../lib/wallet';
import { useXAuth } from '../lib/xauth';
import { useToast } from '../lib/toast';
import { trunc, fmtNum } from '../lib/fmt';

/** Profile — sign in with X (server-side x-auth → Trends account + the SAME
 *  server-provisioned Privy wallet Trends creates). Shows wallet + balance + logout. */
export default function Profile() {
  const { connection } = useWallet(); // RPC only (no client Privy login used here)
  const { user, connecting, connectX, logout } = useXAuth();
  const { toast, node } = useToast();
  const [sol, setSol] = useState<number | null>(null);
  const address = user?.wallet_address || null;

  useEffect(() => {
    if (!address) { setSol(null); return; }
    let dead = false;
    const load = async () => {
      try { const { PublicKey } = await import('@solana/web3.js'); const b = await connection.getBalance(new PublicKey(address)); if (!dead) setSol(b / 1e9); } catch { /* keep */ }
    };
    load();
    const iv = setInterval(load, 15000);
    return () => { dead = true; clearInterval(iv); };
  }, [address, connection]);

  if (!user) {
    return (
      <div>
        <div className="page-head"><span className="page-title">Profile</span></div>
        <div className="center">
          <img src="/trends-logo.jpg" alt="" style={{ width: 54, height: 54, borderRadius: 999 }} />
          <div style={{ fontSize: 14, fontWeight: 800, color: '#fff' }}>Sign in with 𝕏</div>
          <div>A Trends account + Solana wallet is created for you automatically — trade & launch instantly.</div>
          <button className="btn" style={{ maxWidth: 260 }} disabled={connecting}
            onClick={() => connectX().catch((e) => toast(e instanceof Error ? e.message : 'Sign-in failed'))}>
            {connecting ? 'Connecting…' : 'Sign in with 𝕏'}
          </button>
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
              <div style={{ fontSize: 15, fontWeight: 900 }}>@{user.x_handle}</div>
              <div className="coin-name">Signed in with 𝕏</div>
            </div>
          </div>
          <div className="spacer" />
          <div className="label">Wallet balance</div>
          <div style={{ fontSize: 26, fontWeight: 900 }}>{sol == null ? '—' : fmtNum(sol)} <span style={{ fontSize: 14, color: '#71717a' }}>SOL</span></div>
          <div className="spacer" />
          <div className="label">Solana address</div>
          <button className="btn ghost" onClick={() => { if (address) { navigator.clipboard.writeText(address); toast('Address copied'); } }}>
            {address ? trunc(address, 6, 6) : '—'} · Copy
          </button>
        </div>

        <div className="spacer" /><div className="spacer" />
        <button className="btn ghost" onClick={() => logout()}>Log out</button>
      </div>
      {node}
    </div>
  );
}
