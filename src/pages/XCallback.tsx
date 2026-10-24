import { useEffect, useState } from 'react';
import { callXAuth } from '../lib/xauth';

/** /x-callback — X redirects here (inside the login popup) with ?code&state.
 *  We exchange the code via the x-auth edge fn, then hand the result back to the
 *  opener (the embed) and close. If opened standalone (no opener), store + go home. */
export default function XCallback() {
  const [msg, setMsg] = useState('Finishing sign-in…');

  useEffect(() => {
    (async () => {
      const q = new URLSearchParams(window.location.search);
      const code = q.get('code');
      const state = q.get('state');
      const err = q.get('error');
      if (err) { setMsg('X sign-in cancelled.'); return; }
      const stored = JSON.parse(localStorage.getItem('x_pkce') || '{}');
      if (!code || !state || state !== stored.state) { setMsg('Sign-in failed (state mismatch).'); return; }

      const res = await callXAuth({ action: 'callback', code, code_verifier: stored.verifier });
      localStorage.removeItem('x_pkce');
      if (!res?.ok) { setMsg('Sign-in failed: ' + (res?.error || 'unknown')); return; }

      if (window.opener) {
        window.opener.postMessage({ type: 'x-auth-success', result: res }, window.location.origin);
        setMsg('Signed in! Closing…');
        setTimeout(() => window.close(), 500);
      } else {
        localStorage.setItem('x_user', JSON.stringify({
          profile_id: res.profile_id, x_user_id: res.x_user_id, x_handle: res.x_handle,
          wallet_address: res.wallet_address, evm_wallet_address: res.evm_wallet_address,
        }));
        if (res.session) localStorage.setItem('x_session', JSON.stringify(res.session));
        window.location.href = '/profile';
      }
    })();
  }, []);

  return (
    <div style={{ padding: 40, textAlign: 'center', color: '#e8eaf0' }}>
      <div style={{ fontSize: 15, fontWeight: 600 }}>🎬 Trends</div>
      <div style={{ marginTop: 12, color: '#8b90a0' }}>{msg}</div>
    </div>
  );
}
