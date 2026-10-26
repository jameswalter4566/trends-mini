# Trends Anti-Bundle Suite — Remotion explainer script

Format: 1920×1080, 30fps, ~45s. Brand: Satoshi font, bg #17181B, cards #202123,
accent cyan #3CC2DD, white→grey gradient "hero" buttons, 1rem radius. Dark, clean,
confident. VO = optional narration; TEXT = on-screen; VISUAL = what animates.

---

## Scene 1 — TITLE (0:00–0:05)
- **TEXT (big, Satoshi 900):** "INTRODUCING" (small, cyan, tracked-out) →
  "The Trends Anti-Bundle Suite" (huge, white).
- **VISUAL:** black→#17181B fade in; Trends logo settles top-center; the title
  words rise + blur-in one at a time; a thin cyan underline sweeps left→right.
- **VO:** "Introducing the Trends Anti-Bundle Suite."

## Scene 2 — THE PROBLEM (0:05–0:12)
- **TEXT:** "Every launch gets bundled." / "Bots grab the supply at block zero."
- **VISUAL:** a fresh coin tile drops in; instantly 20+ little red "BOT" wallets
  swarm it and snap up stacked bars of supply; a human wallet is left with crumbs.
  Red, chaotic, fast.
- **VO:** "The moment a coin launches, bundlers and snipers take the whole supply
  before a real person can click buy."

## Scene 3 — THE PRESALE WINDOW (0:12–0:21)
- **TEXT:** "A fair window." / "60 seconds – 5 minutes." / "One price for everyone."
- **VISUAL:** big circular countdown ticking (cyan ring). Several wallets stream
  SOL into a glowing central "Buy Window" vault. At 0:00 the vault does ONE buy and
  fans tokens back out — each wallet gets a slice **proportional to what they sent**,
  all tagged with the **same price**. Calm, even, satisfying.
- **VO:** "Instead, every anti-bundle coin opens with a presale window. Any wallet
  sends SOL during the window — then everyone is filled at the exact same average
  price. No front-running. No snipe."

## Scene 4 — TRADE IT ANYWHERE: IN-APP (0:21–0:28)
- **TEXT:** "Tradeable inside Trends." / "Built-in wallet. One tap."
- **VISUAL:** Trends mobile app shell (header + tiles). A coin tile is tapped → coin
  page with live chart + a white "Buy" button; a buy animates, balance updates.
  Smooth, native.
- **VO:** "After the window, trade right inside the Trends app — chart, wallet, and
  buy button, all in one place."

## Scene 5 — TRADE IT INSIDE THE TWEET: X (0:28–0:35)
- **TEXT:** "Trade inside the tweet." / "Sign in with X. Fund. Buy. Never leave the timeline."
- **VISUAL:** an X timeline; a @trendsecosystem tweet with the player card + PLAY
  button; tap PLAY → the coin's trade terminal expands *inside the tweet*; "Sign in
  with X" → wallet appears → a buy fills. Show it living in the feed.
- **VO:** "Or trade it without ever leaving X. The tweet itself becomes the
  terminal — sign in with your X account, fund your wallet, and buy, right there in
  the timeline."

## Scene 6 — THE GATE / TWO MODES (0:35–0:42)
- **TEXT:** "You choose the rules." Two cards side by side:
  - **APP-ONLY** — "Buyable only through Trends & FOMO. Unbundleable. Pump.fun locked out."
  - **OPEN** — "Fair window, then trades everywhere."
- **VISUAL:** the coin sits behind a cyan shield; a Trends buy and a FOMO buy pass
  through (green check), a pump.fun/raw-bot buy bounces off (red X). Then flip to the
  OPEN card: shield dissolves, coin trades freely.
- **VO:** "You pick the mode at launch. App-Only keeps it tradeable only through
  Trends and FOMO — impossible to bundle. Or Open: the fair window, then trade
  everywhere."

## Scene 7 — OUTRO / CTA (0:42–0:46)
- **TEXT:** "Launch unbundleable." / "Only on Trends." + trends.fm + Trends logo.
- **VISUAL:** everything collapses into the logo on #17181B; cyan underline sweep;
  "trends.fm" fades in under it.
- **VO:** "Launch unbundleable. Only on Trends."

---

### Build notes for the Remotion instance
- Reuse the brand tokens above (same as trends-onboarding-remotion: bg #17181b, Satoshi).
- One `<Series>` of 7 `<Series.Sequence>` scenes; per-scene spring entrances
  (`spring({fps, frame})`), `interpolate` for fades/slides, cyan underline via a
  scaleX transform.
- Assets: Trends logo at `trends-mini/public/trends-logo.jpg`. Mock the app shell and
  the X tweet as styled divs (no need to mount the real app for an explainer).
- Suggested comp id `AntiBundleFilm`, 1920×1080, 30fps, ~1380 frames.
