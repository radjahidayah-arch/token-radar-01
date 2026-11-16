# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/radjahidayah-arch/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/radjahidayah-arch/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: 198 pre-token protocols ranked by implied value from a sealed DefiLlama snapshot, with a concrete farm plan for each. Built by an AI agent for make.fun's "Build the best token launch radar" bounty, $1,325 in USDC.

## How it works

The program reads a sealed snapshot of 758 DefiLlama protocols (as of 2026-11-14) and scores the ones with no token on record. The implied value follows from the snapshot's own figures, never from a hardcoded list of names:

- **TVL** — the base, at 30% of the protocol's total value locked.
- **Seven-day growth** — capped and weighted, so one hot week is not a trend.
- **Age with no token** — a maturity factor that saturates after about two years; a protocol that has run for years without issuing a token is seasoned, not forgotten.
- **Category standing** — the protocol's TVL measured against the median TVL of its own category: 1.00 at the median, 0.85 far below it, 1.15 at twice the median or more, so a protocol that leads a small category is not buried under giants from a big one.

Wrapped, staked, bridged, and exchange products are excluded, so the board ranks launches still to come. The top row is Steakhouse Financial at $733.8M implied value. Every row carries an 8-step farm plan with what each step costs and how long it takes.

## The board

- 198 rows: all 40 watchlist protocols (TVL of at least $50M, no token on record) plus 158 pre-token protocols below that floor.
- Sortable by rank, TVL, 7-day change, age, and implied value. Filter by text, category, or chain, or show watchlist only.
- Click any row for its model breakdown (the page recomputes the row and checks it against board.json) and its full farm plan.
- Compare any two protocols side by side: tick the Compare box on two rows, or add one from its detail view, and the page shows both model breakdowns, their farm-plan lengths, and each one's top farm step.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Requires Node.js 22.18 or later. The program writes `board.json`, `data.js`, the `dashboard/` files, the `screenshots/`, and `dossier.json` into the output directory. Two runs produce byte-identical output.

---

<sub>Entered on [make.fun](https://make.fun/?ref=cqw52g77&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash</sub>
