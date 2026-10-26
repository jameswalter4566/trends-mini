# Anti-Bundle Launch — Presale Window + App-Only Gating (full build plan)

*Written 2026-10-26. Mechanism verified in `yolo/docs/HOOKED_REVERSE_ENGINEERING.md`
(~380 Hooked mainnet txs) and implemented in `yolo/anchor/programs/yolo-gate`. DB state
confirmed: `token_launches` has NO gating/presale columns yet (net-new); `x_launch_coins`
is the X-mention record. Venue policy: Trends + FOMO ONLY — **pump.fun is excluded.**

## 0. The lifecycle (what a dev experiences)

1. **Dev launches a coin** on the ANTI-BUNDLE tile. Sets: name/symbol/image, **presale
   window length (60s–300s)**, and **post-window mode** (App-Only or Open).
2. **Presale window opens** immediately. The coin is auto-posted to **@trendsecosystem**
   programmatically, and the **tradeable/contribute card** goes live on THREE surfaces:
   - the X embed (`trendsx.trends.fm/embed/:mint` — sign in with X, fund, contribute)
   - **trends.fm → new "Buy Window" section**
   - the Trends mobile app
3. **During the window:** ANY wallet (via any surface) sends SOL into the **presale
   vault**. No curve trading happens yet — it's a collection. Live raise shown. Contributors
   can withdraw before close.
4. **Window closes (launch + N sec):** the vault executes ONE aggregate buy from the
   bonding curve and **distributes tokens pro-rata** — every contributor gets the SAME
   average price (fair launch; no in-window front-running possible, single buy for all).
5. **Trading opens** per the mode:
   - **App-Only:** buys require a Trends or FOMO co-signature (on-chain hook). Sells +
     sends always free. Until graduation, then tradeable everywhere.
   - **Open:** gate disabled at settle → trades on any DEX immediately.

The presale window is the universal anti-sniper layer (one fair fill for everyone). The
mode decides what happens *after*.

## 1. Two modes (set in the launch spec)

| | **App-Only** (max anti-bundle) | **Open** |
|---|---|---|
| During window | Pro-rata presale vault (any wallet) | Pro-rata presale vault (any wallet) |
| After window | Buys only via **Trends or FOMO** co-sign; sells/sends free | Trades everywhere (gate off) |
| On-chain | `trendsgate` hook stays attached until graduation | hook attached only through settle, then inert/removed-at-grad |
| Bundling | Impossible (no venue = no buy; no in-window sniping) | Window still blocks the launch-snipe; post-window is normal market |

Both are **impossible to bundle at launch** because there is no open-market buy until the
window settles as a single aggregate fill. "Open" just means post-window it trades normally.

## 2. The pro-rata math (fair dispersal)

Let contributors deposit SOL into the presale vault during `[T0, T0+N]`:
- `sol_i` = net SOL from wallet *i* (deposits − withdrawals), after optional per-wallet cap `C`.
- `S = Σ sol_i` = total raised.
- At close the vault buys from the curve with `S` (minus a small fee/priority reserve `r`),
  receiving `T` tokens total at the curve's average fill price for that size.
- **Allocation:** `tokens_i = floor(T × sol_i / S)`. Dust remainder (`T − Σ tokens_i`) →
  treasury (or largest contributor).
- **Effective price is identical for everyone:** `S_net / T`. Nobody who contributed earlier
  or in a bigger tx gets a better price — the single aggregate buy guarantees one clearing
  price. That is the anti-snipe property.
- **Optional per-wallet cap `C`** (set by dev) limits whale domination; excess auto-refunded.
- **Optional hard cap `H`** on `S`: if oversubscribed, scale buys to `H` and refund the
  pro-rata excess (Alpha-Vault behavior). v1: skip `H`, keep optional `C`.
- **Withdraw during window:** allowed; reduces `sol_i` before the snapshot. After close, no
  withdraw — only the token allocation + any capped-excess refund.

Note: "evenly disperse" = **proportional to contribution at one shared price** (the fair-launch
standard), NOT equal tokens per wallet (that would be sybil-gameable by splitting wallets).

## 3. Presale vault: custom vs Meteora Alpha Vault

- **Chosen for v1 — custom app-vault:** a treasury-controlled vault wallet collects SOL;
  contributions tracked in Supabase; at close our server builds the aggregate curve buy +
  pro-rata distribution transfers (reuses our server-signing + custodial infra). Full control
  of UX, timing, the 60–300s window, and multi-surface deposits. Simplest path to live.
- **Alternative (trust-minimized) — Meteora Alpha Vault:** native pro-rata + whitelist + caps,
  audited, buys before the public activation slot. More trustless but adds integration
  constraints (quote token, fixed timing, SDK) and doesn't natively do "deposit from inside
  our app with a custodial wallet." Keep as a v2 upgrade for coins that want on-chain-provable
  fairness. (Docs: Alpha Vault pro-rata + whitelist.)

## 4. On-chain gate program: `trendsgate` (fork of yolo-gate)

Same mechanism Hooked uses (Token-2022 transfer-hook + Instructions-sysvar introspection;
cfg `{bump, co_signer@9, dev_wallet@41}`; buys gated, sells/sends free; auto-revoked at
graduation). Deltas from yolo-gate:
1. New program id / upgrade authority.
2. **Venues = Trends co-signer + FOMO co-signer (`AgmLJB…zN51`). Pump-app router REMOVED**
   (we exclude pump.fun). Trends co-sign is our unforgeable primary; FOMO is passive like Hooked.
3. Add `gate_active: bool` (or `gate_mode: u8`) to cfg so "Open" mode can leave the gate
   inert after settle, and "App-Only" keeps it enforcing until graduation. (We do NOT need the
   earlier `gate_start` clock — the presale vault handles the window; the gate only governs
   POST-settle trading.)
4. App-Only also blocks wallet↔wallet sends pre-grad (stops bundler consolidation); Open allows.

Launch tx still atomic: `createPoolWithTransferHook` + `init_cfg` + `init_eaml` (+ the vault/dev
first-buy happens at settle, not launch). Build in `trends-mini/anchor/programs/trendsgate/`.

## 5. Database schema (the distinctions)

Extend `token_launches`:
```
is_gated            boolean   default false      -- anti-bundle launch?
post_window_mode    text                          -- 'app_only' | 'open'
window_seconds      int                           -- 60..300
presale_start       timestamptz
presale_end         timestamptz                   -- presale_start + window_seconds
presale_status      text      default 'pending'   -- pending|open|settling|settled|failed
presale_vault       text                          -- vault wallet pubkey
presale_raised_sol  numeric   default 0
presale_contributors int      default 0
tokens_distributed  numeric
gate_program        text
gate_cfg            text
cosigner_pubkey     text
per_wallet_cap_sol  numeric                        -- optional C (nullable = no cap)
```
New table `presale_contributions`:
```
id uuid pk · token_mint text · contributor_profile_id uuid · contributor_wallet text
· sol_net numeric · tokens_allocated numeric · status text (pending|allocated|refunded)
· first_deposit_at · updated_at · unique(token_mint, contributor_wallet)
```
RLS: contributions readable by owner + service role; `token_launches` presale fields public-read
(the Buy Window UI needs live raise). Updates service-role only (edge fns), no SQL triggers.

## 6. Edge functions / services

- `anti-bundle-launch` (edge fn): build the atomic gated launch (createPoolWithTransferHook +
  init_cfg + init_eaml), create the vault wallet, write `token_launches` row with presale
  fields, kick the @trendsecosystem post. Treasury-funded dev wallet (tiktok-launch pattern).
- `presale-contribute` (edge fn): verify caller (X/Privy session), move SOL from the user's
  custodial wallet → vault, upsert `presale_contributions` (accumulate `sol_net`), enforce cap.
- `presale-withdraw` (edge fn): before close, refund `sol_net` from vault → user.
- `presale-settle` (cron/driver on contabo-trends): at `presale_end`, snapshot contributions,
  build the aggregate curve buy from the vault (simulate → send), compute pro-rata, distribute
  tokens to each contributor wallet, set `tokens_allocated`, flip `presale_status='settled'`,
  then flip the gate per mode (App-Only: leave enforcing; Open: set gate inert). Record sigs.
- `trends-exec` → **`trendsgate` co-sign swap path** for App-Only post-window trading
  (port yolo-exec: `swap2WithTransferHook` + Memo-cosign + partialSign). Sells free.

## 7. The three surfaces (all read the same DB)

1. **X embed** (`trendsx.trends.fm/embed/:mint`): during window → "⏳ Buy Window — 2:34 left,
   X SOL raised" + Contribute (sign in with X, fund, send SOL). After settle → trade terminal.
2. **trends.fm "Buy Window" section** (new center view in the web shell, per the persistent-shell
   rule — header + left sidebar stay): live list of open windows + a contribute panel each.
3. **Trends mobile app**: same Buy Window surface as a center view under the top-header nav.

All three call `presale-contribute` / the trade path; countdown + raise come from `token_launches`.

## 8. Build order

1. **Schema** (§5) applied via Mgmt API (Trends migration history is unsynced — never `db push`).
2. **`trendsgate`** fork (Trends+FOMO venues, `gate_active`), devnet allow/deny matrix
   (co-signed buy ✅ / raw buy ❌ / FOMO-cosigned ✅ / sell ✅ / open-mode trades-everywhere ✅ /
   graduate → gate gone ✅).
3. **New hooked DBC config** (Trends economics, Token-2022, PartnerUpdateAndMintAuthority,
   migratedPoolFeeBps set, QuoteToken fees) — devnet then mainnet.
4. **Presale vault + settle math** on devnet: 3 test contributors → settle → verify identical
   avg price + pro-rata allocations + dust handling + withdraw path.
5. **Edge fns** (`anti-bundle-launch`, `presale-contribute/withdraw`, `presale-settle` driver).
6. **Surfaces**: X embed Buy Window + trends.fm Buy Window section + app; countdown + live raise.
7. **trendsgate co-sign swap** in trends-exec for App-Only post-window; VPS ingest the hook-swap
   event for candles. Auto-post window tweet from @trendsecosystem.

## 9. Open decisions (James)

1. Per-wallet cap `C` default (e.g. 2 SOL) or off by default?
2. If a window raises ~0 (no contributors) → auto-cancel + refund dev buy, or settle tiny?
3. App-Only post-window: Trends + FOMO both, or Trends-only first (FOMO is passive, costs
   nothing to include, but means an external app can trade it)?
4. Graduation threshold for gated coins (length of the exclusivity window).
5. Dust remainder → treasury or largest contributor?
