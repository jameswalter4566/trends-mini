import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supa';

/**
 * Sign in with X → full Trends account + the SAME server-provisioned Privy wallet
 * Trends itself creates (edge fn `x-auth` → `_shared/provisionWallet` = identical to
 * `provision-privy-wallet`, same Privy app, same server auth key, same Solana+EVM
 * wallet on profiles.wallet_address). No client-side Privy login. The embed runs in
 * an X iframe, so OAuth happens in a popup and the result posts back to the opener.
 */
export type XUser = {
  profile_id: string;
  x_user_id: string;
  x_handle: string;
  wallet_address: string | null;
  evm_wallet_address: string | null;
};

const b64url = (b: Uint8Array) =>
  btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function pkce() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: b64url(new Uint8Array(digest)) };
}

export async function callXAuth(body: Record<string, unknown>) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/x-auth`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return r.json();
}

function applySession(res: any) {
  if (res?.session?.access_token) {
    localStorage.setItem('x_session', JSON.stringify(res.session));
    supabase.auth.setSession({
      access_token: res.session.access_token,
      refresh_token: res.session.refresh_token,
    }).catch(() => {});
  }
}

const XAuthCtx = createContext<{
  user: XUser | null;
  connecting: boolean;
  connectX: () => Promise<void>;
  logout: () => void;
}>({ user: null, connecting: false, connectX: async () => {}, logout: () => {} });

export function XAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<XUser | null>(null);
  const [connecting, setConnecting] = useState(false);

  function apply(res: any) {
    if (!res?.ok) return;
    const u: XUser = {
      profile_id: res.profile_id, x_user_id: res.x_user_id, x_handle: res.x_handle,
      wallet_address: res.wallet_address, evm_wallet_address: res.evm_wallet_address,
    };
    localStorage.setItem('x_user', JSON.stringify(u));
    applySession(res);
    setUser(u);
    setConnecting(false);
  }

  useEffect(() => {
    const u = localStorage.getItem('x_user');
    const s = localStorage.getItem('x_session');
    if (u) setUser(JSON.parse(u));
    if (s) {
      const sess = JSON.parse(s);
      supabase.auth.setSession({ access_token: sess.access_token, refresh_token: sess.refresh_token }).catch(() => {});
    }
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === 'x-auth-success') apply(e.data.result);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  async function connectX() {
    setConnecting(true);
    try {
      const { verifier, challenge } = await pkce();
      const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
      localStorage.setItem('x_pkce', JSON.stringify({ verifier, state }));
      const { url, error } = await callXAuth({ action: 'start', state, code_challenge: challenge });
      if (!url) throw new Error(error || 'start_failed');
      const popup = window.open(url, 'xlogin', 'width=500,height=720,menubar=no,toolbar=no');
      if (!popup) window.location.href = url; // popup blocked → full redirect
    } catch (e) {
      setConnecting(false);
      throw e;
    }
  }

  function logout() {
    localStorage.removeItem('x_user');
    localStorage.removeItem('x_session');
    supabase.auth.signOut().catch(() => {});
    setUser(null);
  }

  return <XAuthCtx.Provider value={{ user, connecting, connectX, logout }}>{children}</XAuthCtx.Provider>;
}

export const useXAuth = () => useContext(XAuthCtx);
