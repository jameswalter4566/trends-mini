# Sign in with X → full Trends account + Privy wallet

*Written 2026-10-23 from the live auth/provisioning code in `tokens_app`:
`contexts/AuthContext.tsx` (createProfileUnified / reconciler),
`supabase/functions/provision-privy-wallet/index.ts` (server-side Privy wallet mint),
`supabase/functions/x-launch/index.ts` (lightweight X-handle placeholder profiles),
`supabase/migrations/20260929_x_mention_launch.sql`.*

## 0. Goal

A user connects their X account inside the embed (or anywhere) and — with ZERO app
download, zero seed phrase, zero Privy client login — gets a **real Trends account**: a
`profiles` row, a Supabase auth session, and a **Privy-provisioned Solana + EVM wallet**,
all server-side. This is the account that then trades X-gated coins ([[project_x_gated_tokens]]).

## 1. Why this is non-standard (the core problem)

Today a Trends account is born **client-side**: Apple/wallet sign-in creates a Supabase
auth user on the device, `AuthContext` reconciles `supabase_user_id` ↔ `wallet_address`
and calls `createProfileUnified`, then `provision-privy-wallet` (needs a signed-in
Supabase JWT) mints the wallet. 

For "just connect X" there is **no device, no client Supabase SDK, and no pre-existing
JWT**. Everything must happen server-side from an X identity alone. Two gaps today:
- **No server-side Supabase user/session minting exists anywhere** (`tiktok-oauth` only
  *links* a social account onto an already-existing profile; `x-launch` inserts a bare
  placeholder `profiles` row with NO auth user and NO wallet).
- **`provision-privy-wallet` assumes a caller JWT** — we'll call its logic directly with
  a service-role-resolved user id instead.

## 2. What we REUSE (already built + proven)

| Piece | Where | Reuse as |
|---|---|---|
| Privy server wallet mint (custom_auth user → Solana + EVM, owned by our P-256 key, exportable) | `provision-privy-wallet/index.ts` | call its body with the new user id |
| Profile shape (username/display_name/bio/accepted_terms_at) | `AuthContext.createProfileUnified` | server-side port |
| X handle → placeholder profile precedent | `x-launch/index.ts` (`profiles.insert`) | UPGRADE the placeholder into a real account on first login |
| Privy app (shared blockparty `cmeqs51zk`, custom_auth already in use) | [[reference_privy_app]] | unchanged |
| X OAuth app (@trendsecosystem creds in Supabase secrets) | memory [[project_trends_x_mention_launch]] | we own the OAuth — no Privy "Login with X" needed |

**Architecture decision: we own the X OAuth** (we have the app + keys), mint our own
Supabase session, and provision wallets via Privy `custom_auth` exactly like today. This
avoids Privy's X-login popup inside the X iframe entirely — cleaner and fully server-controlled.

## 3. Schema (one migration)

Add to `profiles` (nullable, additive):
- `x_user_id text unique` — the X numeric id (stable; handle can change). **The UNIQUE is
  the 1-account-per-X-user + 1-wallet-per-X-account rule** that anti-bundle depends on.
- `x_handle text`, `x_avatar_url text`, `x_connected_at timestamptz`.

No new table needed — `profiles` already carries `supabase_user_id`, `wallet_address`,
`evm_wallet_address`, `privy_user_id`, `privy_wallet_id`. We're adding the X identity to it.

## 4. The endpoint: `x-auth` edge fn (the whole flow)

One function, two entry modes:

**`action=start`** → returns the X OAuth 2.0 PKCE authorize URL (scopes `users.read
tweet.read`, redirect = the embed callback). Store `state`+`code_verifier` keyed by state.

**`action=callback`** (code + state) — the pipeline, all server-side with service role:
1. Exchange code → X token; `GET /2/users/me` → `{ x_user_id, x_handle, x_avatar }`.
2. **Find-or-create the account**, keyed by `x_user_id`:
   - Existing `profiles.x_user_id` → that's the account.
   - Else if an `x-launch` placeholder exists for this handle → **upgrade it** (attach auth
     user + wallet) rather than duplicate.
   - Else create fresh.
3. **Supabase auth user**: `supabase.auth.admin.createUser({ email:
   \`x_${x_user_id}@users.trends.x\`, email_confirm: true, user_metadata: { x_user_id,
   x_handle } })` (synthetic email = stable unique key; never emailed). Reuse if it exists.
4. **Profile**: insert/patch `profiles` with `supabase_user_id`, `x_user_id`, `x_handle`,
   `display_name=@handle`, `avatar_url`, `username=x_<handle>_<rand>`, `accepted_terms_at`.
5. **Wallet**: run the `provision-privy-wallet` body for this `supabase_user_id` → Privy
   custom_auth user + Solana + EVM wallets saved on the profile. (Refactor its core into
   `_shared/provisionWallet.ts` so both the JWT path and this path call it.)
6. **Session**: mint a real Supabase session for the embed. Primary approach:
   `admin.generateLink({ type: 'magiclink', email })` → `verifyOtp` with the returned
   token_hash server-side → return `{ access_token, refresh_token }`. (Fallback: sign a
   Supabase-compatible JWT with the project JWT secret. Validate which Supabase supports
   in the mock test — this is the #1 thing to prove.)
7. Return `{ session, profile, wallet_address, evm_wallet_address }`. The embed stores the
   session; trades then authenticate to `x-exec` as a normal signed-in user.

## 5. Test FIRST with a mock X identity (James's ask — surface the errors)

Before touching real OAuth, prove the HARD half (account+wallet+session creation) with a
gated test hook:
- `x-auth` honors `action=mock` behind an `x-auth-test-key` header: skip steps 1 (OAuth)
  and take `{ x_user_id, x_handle }` from the body, run steps 2–7 verbatim.
- Drive it with the Supabase CLI / an invoke script using a **mock handle** (e.g.
  `x_user_id: "999000001", x_handle: "mocktester"`).
- **Watch for the predictable failures** and fix each: `admin.createUser` duplicate-email
  on re-run (make idempotent), `profiles` NOT NULL / unique constraints we don't satisfy
  server-side (wallet_address is nullable? username unique?), Privy `custom_auth` user
  create + wallet mint errors (app config / auth key), session minting (does
  magiclink/verifyOtp return usable tokens headlessly?), RLS on the service-role inserts.
- Only once the mock run returns a valid session + funded profile + two wallet addresses
  do we wire the real X OAuth + the embed button. Delete/disable `action=mock` before prod
  (same pattern as the `dumpenvtmp` gate [[project_yolo_launchpad]]).

## 6. Embed wiring (trends-mini)

- `wallet.tsx` / a new `XAuthContext`: "Connect X" button → `x-auth start` → popup/redirect
  → callback → store session in localStorage → app is signed in.
- Inside the X iframe, run the OAuth in a `window.open` popup and `postMessage` the session
  back (X iframes restrict top-level redirects — same spike noted in the gated-tokens plan).
- Signed-in state shows the X avatar/handle + the Trends wallet (deposit/withdraw SOL).

## 7. Build order

1. **Migration** (§3) on the Trends Supabase (ref `xtkacuezimrxdgjpxujk`).
2. Refactor `provision-privy-wallet` core → `_shared/provisionWallet.ts` (no behavior change).
3. `x-auth` with **`action=mock`** only → iterate against a mock handle until it returns
   session + profile + 2 wallets cleanly (§5). ← **start here next**
4. Add real X OAuth (`start` + `callback`), reuse @trendsecosystem creds.
5. Embed "Connect X" + popup-session plumbing + browser-verify in a real tweet.
6. Point `x-exec` trade auth at these sessions.

## 8. Open decisions (James)

1. Session strategy: Supabase magiclink/verifyOtp vs signed custom JWT — pick in the mock test.
2. Synthetic email domain (`@users.trends.x`) — fine, or use `phone`/anonymous instead?
3. Upgrade-vs-dup when an `x-launch` placeholder profile already exists for the handle
   (recommend: upgrade in place, keep the coin↔creator link).
4. Does connecting X auto-provision BOTH Solana + EVM (current provision fn does both), or
   Solana-only for the X-coins use case?
