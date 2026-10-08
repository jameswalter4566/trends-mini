import { type ReactNode } from 'react';
import { PrivyProvider, usePrivy, useLogin } from '@privy-io/react-auth';
import { useWallets, useSignTransaction, useExportWallet } from '@privy-io/react-auth/solana';
import { createSolanaRpc, createSolanaRpcSubscriptions } from '@solana/kit';
import { Connection, PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';

/**
 * Sign in with X → Privy auto-creates an embedded Solana wallet → every tx is
 * signed client-side (non-custodial). Same Privy app as trends.fm web/mobile, so
 * accounts unify across surfaces. Key export is Privy's built-in user-initiated
 * reveal (useExportWallet) — we never see the key.
 */
const APP_ID = 'cmeqs51zk021ek20ce5limvl4';
const RPC_URL = 'https://194-163-134-79.sslip.io/rpc';
const WSS_URL = 'wss://194-163-134-79.sslip.io/rpc-ws';

const conn = new Connection(RPC_URL, { commitment: 'confirmed', wsEndpoint: WSS_URL });

/** Confirm by POLLING getSignatureStatuses over HTTP — confirmTransaction's WS
 *  subscription stalls through the VPS relay; polling confirms in ~2-4s. */
async function pollConfirm(sig: string, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { value } = await conn.getSignatureStatuses([sig]);
    const st = value[0];
    if (st) {
      if (st.err) throw new Error('Transaction failed on chain');
      if (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized') return;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('Confirmation timed out — the transaction may still land.');
}

export function WalletProvider({ children }: { children: ReactNode }) {
  return (
    <PrivyProvider
      appId={APP_ID}
      config={{
        appearance: { theme: 'dark', accentColor: '#22C55E', logo: '/trends-logo.jpg', walletChainType: 'solana-only' },
        // X-first login. Twitter must be enabled in the Privy dashboard (plug our
        // X OAuth app's client id/secret there so the consent screen is OUR app).
        loginMethods: ['twitter', 'email', 'google'],
        embeddedWallets: { solana: { createOnLogin: 'all-users' } },
        solana: {
          rpcs: {
            'solana:mainnet': {
              rpc: createSolanaRpc(RPC_URL),
              rpcSubscriptions: createSolanaRpcSubscriptions(WSS_URL),
            },
          },
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}

export function useWallet() {
  const { authenticated, ready, logout, user } = usePrivy();
  const { login } = useLogin();
  const { wallets } = useWallets();
  const { signTransaction } = useSignTransaction();
  const { exportWallet } = useExportWallet();

  const wallet = wallets[0];
  const address = wallet?.address;
  const connected = authenticated && !!wallet;
  const xHandle = (user?.twitter?.username as string | undefined) || null;

  async function signAndSendTransaction(tx: Transaction | VersionedTransaction): Promise<string> {
    if (!wallet) throw new Error('Wallet not connected');
    const bytes = tx instanceof VersionedTransaction
      ? tx.serialize()
      : tx.serialize({ requireAllSignatures: false, verifySignatures: false });
    const { signedTransaction } = await signTransaction({ transaction: new Uint8Array(bytes), wallet, chain: 'solana:mainnet' });
    const sig = await conn.sendRawTransaction(signedTransaction as Uint8Array, { skipPreflight: false, maxRetries: 3 });
    await pollConfirm(sig);
    return sig;
  }

  return {
    ready,
    address,
    publicKey: address ? new PublicKey(address) : null,
    connected,
    connection: conn,
    wallet,
    xHandle,
    login: () => login(),
    logout: () => logout(),
    exportKey: () => (address ? exportWallet({ address }) : Promise.resolve()),
    signAndSendTransaction,
  };
}
