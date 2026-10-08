/**
 * Stub for @solana-program/memo — an OPTIONAL peer of @privy-io/react-auth/solana
 * that pulls in a @solana/kit subpath incompatible with our installed version. We
 * never attach memo instructions (trades/launches use their own builders), so this
 * satisfies Privy's top-level import without the dependency-version conflict. If a
 * memo is ever actually requested it throws — but nothing in our flow calls it.
 */
export function getAddMemoInstruction(): never {
  throw new Error('memo instructions are not supported on the web app');
}
