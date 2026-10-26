# Anti-Bundle presale-window UX + trading — implementation plan (trends.fm)

Written 2026-10-26. Context: the anti-bundle backend is LIVE and proven on mainnet
(trendsgate 7VMUCak, 4 edge fns, auto-settle cron). The main trends.fm terminal
(tokens_app/web) launches gated coins but (a) shows no presale window and (b) has no
working buy/sell for gated coins. This plan closes both, + the X announce.

## The target experience
Dev launches an anti-bundle coin on trends.fm → lands on `/tokens/<mint>` → sees a
**live countdown + a custom Buy (contribute) section** (the presale window) → the window
is auto-posted to @trendsecosystem ("New anti-bundle presale window is LIVE!" + trade
link) → at close it settles pro-rata → the page flips to normal Buy/Sell, which now
works through our co-sign path (and through FOMO passively).

## Phase 1 — Presale Window panel on the terminal coin page  `/tokens/:mint`
The trade rail (`TradeRail` in TokensTerminalPage.tsx) becomes window-aware. Port the
exact logic already shipped in trends-mini `src/pages/Coin.tsx`:
- Fetch the selected coin's presale fields from `token_launches` on select (immediate,
  not waiting for the 15s `gatedMints` poll) + a 1s countdown tick.
- Derive: `windowOpen = gated && presale_status==='open' && now < presale_end`,
  `windowSettling = gated && (settling || (open && now>=end))`.
- **windowOpen →** render the **Presale Window** card INSTEAD of Buy/Sell:
  - big countdown mm:ss to `presale_end`
  - live "Raised X SOL · N contributors · after window: App-only/Open"
  - custom buy: SOL input + presets + **Join the window** → `presale-contribute`
    (carries the user JWT); + **Withdraw** → `presale-withdraw` (before close)
  - copy: "Everyone who joins fills at the same price when the window closes."
- **windowSettling →** "Window closed — distributing pro-rata…" (no inputs).
- **settled / not gated →** the normal Buy/Sell panel (Phase 4 routing).
- Styling: the on-brand cyan card already used for the rules banner (#3CC2DD), our font.
- Net-new: a `PresaleRail` subcomponent (or inline in TradeRail); reuse the trends-mini
  handlers 1:1. No backend changes — `presale-contribute/withdraw` already exist + are
  deployed.

## Phase 2 — Launch → land on the live window
- `antiBundleLaunch` already returns the mint; `onLaunched(mint)` already navigates to
  `/tokens/<mint>`. With Phase 1, that page now shows the countdown immediately because
  `presale_status==='open'`.
- Add an immediate single-coin presale fetch on select so the window appears with no lag
  (don't wait for the batch `gatedMints` refresh).

## Phase 3 — Announce on @trendsecosystem
- At launch, post: "🛡 New anti-bundle presale window is LIVE! $SYMBOL — fair launch,
  one price for everyone. {windowMin}-min window. Trade 👉 {link}" + the coin image.
- **Link = the trendsx embed** `https://trendsx.trends.fm/t/<mint>` (X player-card =
  in-tweet Buy Window) — falls back to `https://trends.fm/tokens/<mint>`.
- Implementation: a dedicated `post-antibundle-window-to-x` edge fn reusing the existing
  @trendsecosystem OAuth1.0a poster (the one that auto-tweets TikTok coin launches).
  anti-bundle-launch currently calls `post-tiktok-coin-to-x` with kind="anti_bundle_window"
  — replace that call with the new fn (or teach post-tiktok-coin-to-x this kind + copy).
- Fire-and-forget (non-fatal), right after the launch tx confirms.

## Phase 4 — Gated swap = working Buy/Sell after the window (all surfaces)
New edge fn **`trends-gated-swap`** (the co-sign signer):
- **Security first:** verify the mint is `is_gated` in `token_launches` before doing
  anything — only ever co-sign OUR gated coins (never a blank-check signer).
- Build the swap via Meteora `swap2WithTransferHook` (includes the hook's extra accounts
  — required for ANY transfer of a hooked Token-2022 mint, buy or sell).
- **Buy:** append the co-sign Memo (`cosignMemoIx`, lists Trends co-signer BfqTs1…) +
  `partialSign` with `TRENDS_GATE_COSIGNER_SECRET` (already a Supabase secret) → the hook
  sees the approved-venue signature → buy passes. **Sell:** hook-aware swap, no co-sign.
- Return the partially-signed tx; the user signs the payer in Privy + sends (same
  non-custodial flow). Works for trends.fm terminal, trendsx, and later the mobile app.
- **Terminal routing:** in `execute()`, `if (sel.gated) → trends-gated-swap else →
  buildSwapTx`. We already have `sel.gated` on the row. Mirror in trends-mini's swap path.
- FOMO: no work — its co-signer is already an approved venue in the program.

## Build order
1. Phase 1 + 2 (window UI on the terminal + instant load) — the visible fix.
2. Phase 3 (X announce).
3. Phase 4 (gated swap) — makes post-window + FOMO trading actually execute.

All backend for Phases 1–2 already exists; only Phase 3 (one small edge fn) + Phase 4
(one edge fn) are net-new server code. Everything else is terminal UI.
