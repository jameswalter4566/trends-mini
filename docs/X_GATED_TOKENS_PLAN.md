# X-Gated Tokens — Implementation Plan

*Written 2026-10-23 from direct inspection of the WORKING yolo-gate system
(`yolo/anchor/programs/yolo-gate/src/lib.rs`, `yolo/supabase/functions/yolo-launch/index.ts`,
`yolo/yolo-exec/server.mjs`, proven by `yolo/scripts/proveGate.mjs` + `proveVenues.mjs`)
and the live trends-mini embed (`/embed/:mint` player card + coin terminal).*

## 0. Product

**Tokens launched through X are ONLY tradeable inside X, with your X account.**
A coin born from a tweet trades exclusively in the trends-mini player card embedded in
that tweet. You sign in with your X account inside the embed; every trade is
authorized per-transaction by our backend ("assigned", YOLO-style). At graduation the
gate auto-detaches (Meteora-native) and the coin becomes tradeable everywhere — the
X-exclusivity window IS the bonding curve.

Why this is a moat: pre-grad there is literally no way to snipe/bundle/bot the curve —
the on-chain hook rejects any trade that didn't come through us, and "us" = one wallet
per verified X account. Volume can only come from humans inside the tweet.

## 1. What already exists (don't rebuild)

| Piece | Where | State |
|---|---|---|
| Venue-gate hook program (`yolo-gate`) | `yolo/anchor/programs/yolo-gate/src/lib.rs`, id `9yqG…rh8T` | BUILT + proven on-chain |
| Gated launch builder | `yolo/supabase/functions/yolo-launch/index.ts` | BUILT (createPoolWithTransferHook + init_cfg + init_eaml, atomic) |
| Co-signed swap engine | `yolo/yolo-exec/server.mjs` (`/swap`) | BUILT (server-side swap2WithTransferHook + Memo-cosign + partialSign) |
| Allow/deny proof scripts | `yolo/scripts/proveGate.mjs`, `proveVenues.mjs` | BUILT |
| X mention→launch pipeline | x-mentions-poll + x-launch + driver on contabo-trends | LIVE (launches on pump.fun today) |
| Embeddable X app | this repo → `/embed/:mint` player route + embed-meta edge fn + coin terminal | BUILT, Netlify |
| Trends DBC launch/trading/candles | tokens_app edge fns + trends-exec VPS | LIVE |

## 2. The one hard product change

**pump.fun coins CANNOT be gated** (their program mints plain SPL — no hook, ever).
Today the X mention→launch flow deploys on pump.fun. X-gated coins require the launch
to move to **Meteora DBC on a hooked Token-2022 config**. Decision for James:
- (a) ALL X-launched coins become gated DBC coins (kills the pump.fun dependency), or
- (b) two modes: default pump.fun + opt-in "X-exclusive" launches (e.g. tag
  `@trendsdotrun launch exclusive`).

Plan assumes (b) — additive, nothing live breaks.

## 3. New on-chain program: `xgate` (fork of yolo-gate)

Why fork instead of reuse: yolo-gate's `approved_venue()` hardcodes **FOMO's co-signer
and the pump-app router as approved venues**. A coin launched on yolo-gate is tradeable
through YOLO, FOMO, *and* the pump app — violates "ONLY through X". The fork is
byte-for-byte identical except:

1. New keypair → new `declare_id!` (generate at build; also new upgrade authority).
2. **Delete** `FOMO_COSIGNER` + `PUMP_APP_ROUTER` consts and their checks —
   `approved_venue()` becomes a single scan: *some instruction references
   `cfg.co_signer` with `is_signer == true`*.
3. Error strings → "this token is only tradeable on X via Trends" (6001/6002).
4. Keep EVERYTHING else identical: `Cfg` layout (bump, co_signer, dev_wallet — 73
   bytes), instruction names (`init_cfg`, `initialize_extra_account_meta_list`,
   fallback→`transfer_hook`), EAML seeds (`["extra-account-metas", mint]`), cfg seeds
   (`["cfg", mint]`), `DBC_POOL_AUTHORITY` const, fail-closed semantics (sell-to-vault
   free, dev-wallet free, all else co-signed-or-reject, wallet↔wallet blocked).

Identical layout+names means `yolo-launch`'s `initCfgIx`/`initEamlIx`/PDA helpers and
`yolo-exec`'s swap builder port with ONLY the program id + key names changed.

Repo placement: `trends-mini/anchor/programs/xgate/` (this repo becomes the home of
the X-exclusive stack). Build with the same Anchor/deps versions as yolo's
`anchor/Cargo.toml` (known-good).

## 4. New DBC config (one-time, per environment)

Port `yolo/scripts/createYoloConfig.mjs` → `scripts/createXConfig.mjs`:
- `createConfigWithTransferHook`, `transferHookProgram = xgate`.
- Trends economics: mirror live config `2t8izqf…` (4% fee, 50/50 creator/platform,
  treasury `2NKJ…` as feeClaimer/partner) — but Token-2022 base.
- `tokenAuthorityOption: PartnerUpdateAndMintAuthority` (Immutable = invalid 6037).
- **`migratedPoolFee.poolFeeBps` EXPLICITLY SET** (standing rule — we've burned SOL
  forgetting post-bond fees).
- `collectFeeMode: QuoteToken` (fees in SOL → no base-token fee transfers to gate).
- Record `X_DBC_CONFIG`, `XGATE_PROGRAM_ID`, `XGATE_COSIGNER_PUB/PRIV` in Supabase
  secrets + gitignored secrets file. Generate a FRESH co-signer keypair — do not reuse
  YOLO's.

## 5. Launch path: `x-launch` v2 (gated mode)

Clone `yolo-launch/index.ts` → Trends edge fn `x-gated-launch` with the Trends twist —
the X flow is fully server-side (ephemeral dev wallet funded by treasury, like
tiktok-launch), not user-signed:
1. Treasury funds ephemeral dev wallet (existing pattern).
2. One atomic tx: `dbc.creator.createPoolWithTransferHook({ baseMint, config:
   X_DBC_CONFIG, transferHookProgram: XGATE })` + `init_cfg(co_signer =
   XGATE_COSIGNER_PUB, dev_wallet = devWallet)` + `init_eaml` (+ optional dev first-buy
   — passes via dev-wallet whitelist, no co-sign needed).
3. **Simulate before send** (standing rule), send, confirm, record in
   `token_launches` with `gated: true, venue: 'x'`.
4. Wire into the x-mentions driver on contabo-trends behind the "exclusive" trigger.
5. Auto-reply tweet embeds the player-card URL (`trends-mini /embed/:mint`) so the
   tradeable terminal is IN the launch tweet.

SDK pin `@meteora-ag/dynamic-bonding-curve-sdk@1.5.13` (yolo-launch already does).

## 6. Identity: 1 wallet per X account (the off-chain half of the gate)

On-chain enforces "co-signed by us"; WE enforce "co-sign only for a verified X user,
one wallet each" — that's the whole anti-bundle property, same trust model as YOLO.

- Sign-in inside the embed: **Privy "Login with X"** on the shared blockparty app
  (`cmeqs51zk` — enable the Twitter/X login method + add the embed origin to allowed
  origins + OAuth redirect list; remember the redirect-URL gotcha
  [[project_privy_oauth_redirect_list]]).
- Wallet: Privy **server-provisioned Solana wallet** keyed to the X identity
  ([[project_privy_wallet_export]] pattern — app-auth-key owned, backend signs). DB:
  `x_wallets (x_user_id UNIQUE, wallet, privy_user_id, created_at)` — the UNIQUE on
  `x_user_id` IS the 1-wallet-per-account rule.
- X iframes restrict OAuth redirects: run the Privy login in a popup/new tab
  (`window.open`), postMessage the session back to the iframe. Prototype this FIRST
  (step 0 of build order) — it's the only genuinely unknown UX risk.

## 7. Trading path: co-signed swaps (the "assign each transaction" program)

Port `yolo-exec/server.mjs` → **`x-exec` systemd service on contabo-trends** (Trends'
box, NOT the yolo box; own port behind the existing Caddy):
- Holds `XGATE_COSIGNER_PRIVATE_KEY`. Never signs client-supplied bytes — builds every
  tx server-side from parameters (mint, side, amount), exactly like yolo-exec.
- `/swap`: verify Privy JWT → resolve the caller's `x_wallets` row → build
  `swap2WithTransferHook` (+ `getRemainingAccountsForTransferHook`) → for BUYS append
  the Memo ix referencing the co-signer + `partialSign(XGATE_COSIGNER)` → sign with the
  user's Privy server wallet → **simulate → send via Helius → confirm**.
- Sells need no co-sign on-chain (vault-destination is free) but still route here —
  the wallet is custodial, so every trade is server-executed regardless.
- Per-X-account rate limits (penguin withdrawal-security patterns) to keep one human ≈
  one account.

## 8. trends-mini embed changes (this repo)

- `Coin.tsx` terminal: for `gated: true` coins, trade panel = X-login state + buy/sell
  via `x-exec /swap` (replaces the wallet-signing path); "🔒 Only tradeable on X —
  graduates at $XX" badge + curve progress.
- `Profile.tsx`: show the X-wallet (deposit SOL in / withdraw SOL out — base-token
  withdrawals are impossible pre-grad BY CONSTRUCTION; say so in UX copy).
- Post-graduation flip: badge → "tradeable everywhere", switch terminal to the normal
  DAMM v2 swap path.
- embed-meta already renders the player card — add gated-coin branding.

## 9. Ingest/candles

trends-exec decodes Meteora DBC swaps today ([[project_trends_dbc_candles]]). Hooked
pools emit the `swap2WithTransferHook` event variant — add its discriminator to the
ingest decode so gated coins chart identically. (Also: graduation listener —
`EvtCurveCompleteWithTransferHook` → flip `gated_live → graduated` in DB.)

## 10. Fees

Hook pools require **v2 claim instructions** (`claim_trading_fee2` /
`claim_creator_trading_fee2`). Trends' claim fns use v1 — add the v2 path for coins on
the X config (creator fee claiming + platform sweep).

## 11. Build order (devnet gates everything)

0. **Popup-auth spike in the X iframe** (Privy X-login popup → session in embed). Half
   a day; de-risks the only real unknown.
1. Fork program → `xgate`, new id; port proveGate/proveVenues matrix; **devnet**:
   launch → co-signed buy ✅ → un-co-signed buy ❌ → wallet↔wallet ❌ → FOMO/pump-style
   tx ❌ (must now FAIL — the fork's whole point) → tiny-threshold graduation → hook
   revoked on-chain ✅ → free swap post-grad ✅.
2. `createXConfig.mjs` devnet → mainnet config.
3. `x-gated-launch` edge fn + first mainnet gated coin with 2–3 test X accounts.
4. `x-exec` on contabo-trends + `x_wallets` schema + Privy X-login enablement.
5. trends-mini terminal wiring + embed badge + deploy + **browser-verify inside a real
   tweet** (standing rule).
6. Wire the mention-driver "exclusive" trigger + auto-reply with the embed URL.
7. Ingest discriminator + graduation listener + v2 fee claims.

## 12. Open decisions (James)

1. §2: all X launches gated, or opt-in "exclusive" mode? (plan assumes opt-in)
2. Graduation threshold for gated coins (lower = shorter exclusivity window, faster
   "everywhere" moment; it's a marketing knob).
3. Does the YOLO partnership care that Trends ships venue-gating first? (Karsten
   exclusivity concern from the YOLO doc — same mechanism, different venue.)
4. Mint-authority optics: hook configs force partner-held mint authority pre-grad —
   rug-checkers will flag it. Comms line needed ("revokes at graduation, enforced by
   Meteora's program").

## 13. DECIDED (2026-10-26): two launch tiers (Hooked-style, per HOOKED_REVERSE_ENGINEERING.md)

Mechanism = Hooked's FOMO gate (verified): Token-2022 hook + Instructions-sysvar introspection
demanding the venue co-signer's signature; cfg {bump, co_signer@9, dev_wallet@41}; buys gated,
sells free; dev wallet whitelisted (required dev buy opens the pool); hook auto-revoked at
graduation. yolo-gate already implements this; fork = trendsgate.

Delta: add `gate_start: i64` to cfg (73->81 bytes) + clock branch in Execute:
- V1 "ANTI-BUNDLE": gate_start=0 — app-only from the first slot, block-zero bundling impossible.
  Also blocks wallet-to-wallet sends pre-grad (no bundler consolidation). Trends co-sign ONLY.
- V2 "OPEN PRESALE -> APP-ONLY": gate_start = launch+N min — any wallet/DEX during the window,
  then app-only until graduation. Sells+sends always free. V2 config bakes Meteora fee scheduler
  (~50% decaying to normal across the presale window) to tax window snipers.

Venue policy: Trends co-signer only for both tiers (cryptographic, FOMO-class). FOMO/pump
multi-venue = possible later tier; pump route-fingerprint is spoofable (Hooked admits it).
