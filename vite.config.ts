import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// trends-mini — the X-embeddable Trends terminal. Keep the bundle SKINNY: this app
// loads inside a tweet iframe (player card), so no Meteora SDK, no wallet-adapter
// zoo — Privy embedded wallets + thin HTTP/WS clients over the VPS only.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Privy's Solana module lists @solana-program/memo as an optional peer whose
      // @solana/kit subpath conflicts with our version. We never attach memos → stub it.
      '@solana-program/memo': '/src/stubs/memo.ts',
    },
  },
  define: { 'process.env': {}, global: 'globalThis' },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1500,
  },
});
