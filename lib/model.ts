// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and every
// other pre-token protocol the snapshot ranks: the early rows the radar exists to find. A protocol
// is pre-token when its record carries no token (no market cap, no CoinGecko id, no symbol); the
// live-token protocols are kept apart and shown with the market's own values, never mixed into the
// ranked board.
//
// Implied value follows only from the snapshot's own figures:
//
//   base       = tvl_usd x BASE_MULTIPLE
//   growth     = clamp(change_7d, -70, 150) per cent
//   growthMult = 1 + (growth / 100) x GROWTH_WEIGHT
//   maturity   = 0.55 + 0.45 x (1 - exp(-age_days / 730))
//   category   = 0.85 + 0.30 x (min(tvl_usd / category_median_tvl_usd, 2) / 2)
//   implied    = max(1, round(base x growthMult x maturity x category))
//
// Growth is capped because one week of inflow is not a trend, and it is floored because a bad week
// is not a death sentence. Maturity saturates: a protocol that has run two years with no token is
// a seasoned candidate, and a fourth year adds little over a second. Age is the time since the
// protocol was first listed, the best record of how long it has run with no token; an unlisted age
// uses 365 days. The category factor is the snapshot's own yardstick: a protocol is measured
// against the median TVL of its own category, so a protocol that leads a small category is not
// buried under giants from a big one, and a protocol that trails its own category is not carried
// by it. The factor is bounded between 0.85 and 1.15, it is 1.00 exactly at its category's median,
// and it never rescues a small protocol or punishes a large one by more than fifteen per cent.
// No protocol name is ever special-cased: the same function scores every row.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the reader can check them. */
export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_scale_days: number;
  unknown_age_days: number;
  /** The category factor's floor: a protocol far below its category's median still keeps 85%. */
  category_factor_floor: number;
  /** The category factor's range above its floor: at most fifteen points, so the top is 1.15. */
  category_factor_range: number;
  /** The TVL-to-median ratio at which the category factor stops rising: twice the median. */
  category_ratio_cap: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.3,
  growth_weight: 0.8,
  growth_floor: -70,
  growth_cap: 150,
  maturity_floor: 0.55,
  maturity_range: 0.45,
  maturity_scale_days: 730,
  unknown_age_days: 365,
  category_factor_floor: 0.85,
  category_factor_range: 0.3,
  category_ratio_cap: 2,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-3';

/** A safety bound on the early radar's rows; the snapshot's rankable set is smaller, so it never binds. */
export const EARLY_CAP = 400;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    category_factor: number;
    category_median_tvl_usd: number | null;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's view of one row, carrying the farm plan the model wrote for it. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  /** The category factor this row was scored with, 0.85 to 1.15, 1.00 at its category's median. */
  category_factor: number;
  /** The median TVL of the row's own category, in whole dollars; null when the snapshot names none. */
  category_median_tvl_usd: number | null;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  watchlist: string[];
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The middle of a sorted list of whole dollars; the average of the two middle values when even. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

/**
 * The category yardstick, from the snapshot itself: the median TVL of every category the snapshot
 * names, and the median TVL of the whole snapshot for a protocol whose record names no category.
 * A median is used instead of a mean because one giant in a category must not move the yardstick
 * for every other protocol in it; a category of one has its own TVL as its median, so its factor
 * is exactly 1.00. No protocol name is ever special-cased: the same medians score every row.
 */
export interface CategoryContext {
  /** Median TVL per category, keyed by the category's name. */
  medians: Map<string, number>;
  /** Median TVL across every protocol in the snapshot, the fallback for a null category. */
  overallMedian: number | null;
}

export function categoryContext(protocols: SnapshotProtocol[]): CategoryContext {
  const byCategory = new Map<string, number[]>();
  for (const p of protocols) {
    if (p.category === null) continue;
    const list = byCategory.get(p.category);
    if (list === undefined) byCategory.set(p.category, [p.tvl_usd]);
    else list.push(p.tvl_usd);
  }
  const medians = new Map<string, number>();
  for (const [category, tvls] of byCategory) {
    const m = median(tvls);
    if (m !== null) medians.set(category, m);
  }
  return { medians, overallMedian: median(protocols.map((p) => p.tvl_usd)) };
}

/**
 * The category factor for one protocol: how its TVL stands against the median TVL of its own
 * category. A protocol at its category's median scores 1.00; one at twice the median or more
 * scores the top, 1.15; one far below its category's median scores the floor, 0.85. The factor
 * is linear in the ratio between those bounds, so a small lead over the median is a small boost
 * and a large one is a large boost, and the factor never rescues a small protocol or punishes a
 * large one by more than fifteen per cent. A null median (no category and an empty snapshot)
 * scores a neutral 1.00.
 */
export function categoryFactor(tvlUsd: number, medianTvl: number | null, model: ModelConstants): number {
  if (medianTvl === null || medianTvl <= 0) return 1;
  const ratio = Math.max(0, tvlUsd / medianTvl);
  const capped = Math.min(ratio, model.category_ratio_cap);
  return model.category_factor_floor + model.category_factor_range * (capped / model.category_ratio_cap);
}

/** The three multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  context?: CategoryContext,
): {
  implied: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  categoryFactorValue: number;
  categoryMedian: number | null;
  age: number | null;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor + model.maturity_range * (1 - Math.exp(-Math.max(ageForModel, 0) / model.maturity_scale_days));
  const categoryMedian =
    context === undefined ? null : protocol.category === null ? context.overallMedian : (context.medians.get(protocol.category) ?? context.overallMedian);
  const categoryFactorValue = categoryFactor(protocol.tvl_usd, categoryMedian, model);
  const base = protocol.tvl_usd * model.base_multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * categoryFactorValue));
  return { implied, growthPct, growthMult, maturityMult, categoryFactorValue, categoryMedian, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/**
 * The house's own watchlist rule for a wrapped, staked or bridged product of a token that already
 * trades: its category is a bridge or a staking wrapper, its name carries a whole word wrapped,
 * staked or staking, or it begins with an exchange's name. The snapshot carries no parent protocol,
 * so the rule is the only record of it, and a board that ranks WBTC or a staked-ETH wrapper as a
 * pre-token launch is ranking a token that already trades.
 */
const WRAPPED_CATEGORY = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const WRAPPED_WORD = /\bwrapped\b|\bstaked\b|\bstaking\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is one the board may rank: pre-token, and not a wrapped, staked or bridged
 * product of a protocol whose token already trades, by the house's rule above.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !WRAPPED_CATEGORY.has(p.category ?? '') &&
    !WRAPPED_WORD.test(p.name) &&
    !EXCHANGE_PREFIX.test(p.name) &&
    !VERSIONED.test(p.name)
  );
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The headline sentence's figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but
  // the board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other pre-token protocol the snapshot ranks, by TVL, capped. Never a
  // replacement for a watchlist row: a chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_CAP);
  for (const p of early) chosen.set(p.slug, p);

  const context = categoryContext(snapshot.protocols);
  const scored = [...chosen.values()].map((p) => {
    const { implied, growthPct, growthMult, maturityMult, categoryFactorValue, categoryMedian, age } = impliedValue(p, snapshot.as_of, model, context);
    return { p, implied, growthPct, growthMult, maturityMult, categoryFactorValue, categoryMedian, age };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      base_multiple: model.base_multiple,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      // The category factor is carried at full precision, never rounded: the dashboard recomputes
      // the row from this figure, and a rounded factor would move the recomputed value by dollars
      // and make the page call its own board stale. It is formatted to four decimals for display.
      category_factor: s.categoryFactorValue,
      category_median_tvl_usd: s.categoryMedian,
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/**
 * What one transaction costs on a chain, in whole dollars, from the chain's own fee level. Ethereum
 * is dear, Bitcoin is dearer than an L2, the cheap L2s and the fast L1s are cents, and anything
 * unlisted is priced as a dollar.
 */
function gasPerTx(chain: string): number {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return 6;
  if (c === 'bitcoin') return 3;
  if (c === 'solana' || c === 'sui' || c === 'aptos' || c === 'movement') return 0.02;
  if (
    c === 'arbitrum' ||
    c === 'optimism' ||
    c === 'base' ||
    c === 'unichain' ||
    c === 'linea' ||
    c === 'sonic' ||
    c === 'zksync' ||
    c === 'scroll' ||
    c === 'blast' ||
    c === 'mode' ||
    c === 'fraxtal' ||
    c === 'ink' ||
    c === 'abstract' ||
    c === 'worldchain'
  ) {
    return 0.25;
  }
  if (
    c === 'binance' ||
    c === 'polygon' ||
    c === 'avalanche' ||
    c === 'berachain' ||
    c === 'monad' ||
    c === 'plasma' ||
    c === 'flare' ||
    c === 'plume mainnet' ||
    c === 'hyperliquid l1' ||
    c === 'tron' ||
    c === 'fantom' ||
    c === 'gnosis' ||
    c === 'celo' ||
    c === 'kava' ||
    c === 'cronos' ||
    c === 'mantle' ||
    c === 'sei' ||
    c === 'ton' ||
    c === 'near' ||
    c === 'injective' ||
    c === 'osmosis'
  ) {
    return 0.5;
  }
  return 1;
}

/** A gas figure in words: cents stay cents, dollars stay dollars. */
function gasText(gas: number): string {
  if (gas < 1) return `about $${gas.toFixed(2)}`;
  return `about $${Math.round(gas)}`;
}

/** The category's first action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral') || c.includes('uncollateralized')) {
    return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  }
  if (c.includes('dex') || c.includes('liquidity manager')) {
    return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  }
  if (c.includes('yield') || c.includes('farm') || c.includes('leveraged')) {
    return `Deposit $${capital} of USDC into ${name}'s yield position on ${chain} and keep it open.`;
  }
  if (c.includes('bridge') || c.includes('cross chain')) {
    return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  }
  if (c.includes('stak') || c.includes('restak') || c.includes('btc')) {
    return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis') || c.includes('interest rate')) {
    return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  }
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) {
    return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  }
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('chain') && c === 'chain') return `Bridge $${capital} of USDC to ${chain} and use its native app once.`;
  if (c.includes('cedefi')) return `Deposit $${capital} into the ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('card')) return `Load $${capital} onto the ${name} card and spend $25 through it.`;
  if (c.includes('payment')) return `Make one $25 payment through ${name} on ${chain}.`;
  if (c.includes('governance')) return `Deposit $${capital} into ${name} on ${chain} and vote once on a proposal.`;
  if (c.includes('index')) return `Buy $${capital} of the ${name} index on ${chain} and hold it.`;
  if (c.includes('otc')) return `Fill one small $25 order on the ${name} marketplace on ${chain}.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The category's second qualifying action, a different kind from the first. */
function secondActionFor(p: SnapshotProtocol, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral') || c.includes('uncollateralized')) {
    return `Borrow $20 against the deposit and repay it the same week, so the position shows both sides.`;
  }
  if (c.includes('dex') || c.includes('liquidity manager')) {
    return `Swap $25 through the pool once, so the position shows a trade as well as liquidity.`;
  }
  if (c.includes('yield') || c.includes('farm') || c.includes('leveraged')) {
    return `Harvest or compound the yield once, so the position shows an active claim.`;
  }
  if (c.includes('bridge') || c.includes('cross chain')) {
    return `Use the bridged funds in one of ${chain}'s apps, so the bridge is not the only action.`;
  }
  if (c.includes('stak') || c.includes('restak') || c.includes('btc')) {
    return `Stake a second small amount, or restake the receipt once, so the position shows repeat activity.`;
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis') || c.includes('interest rate')) {
    return `Close the hedge and open a second small one, so the position shows repeat trading.`;
  }
  if (c.includes('prediction')) return `Settle one market and place a second small position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) {
    return `Move $25 between two of the vault's allocations, so the position shows active curation.`;
  }
  if (c.includes('stable')) return `Redeem a small amount and mint it again, so the position shows both directions.`;
  if (c.includes('rwa')) return `Mint a second small amount of the yield asset a week later.`;
  if (c.includes('insurance')) return `Top up the cover by $10, so the policy shows repeat activity.`;
  if (c.includes('chain') && c === 'chain') return `Use the chain's native app a second time, a week after the first.`;
  if (c.includes('cedefi')) return `Move $25 between two of the vault's strategies.`;
  if (c.includes('card')) return `Spend a second $25 through the card a week later.`;
  if (c.includes('payment')) return `Make a second small payment a week later.`;
  if (c.includes('governance')) return `Vote on a second proposal a week later.`;
  if (c.includes('index')) return `Rebalance the index holding once, a week after buying it.`;
  if (c.includes('otc')) return `Fill a second small order a week later.`;
  return `Do one more qualifying action, such as a swap or a vote, a week after the first.`;
}

/**
 * A protocol's farm plan: eight steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of
 * names, and it never invents a contract address or a token detail the snapshot does not carry.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasPerTx(chain);
  const action = actionFor(p, capital, chain);
  const second = secondActionFor(p, chain);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: `${gasText(gas)} of gas for the first transaction`,
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and ${gasText(gas)} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: second,
      cost: `${gasText(gas)} of gas`,
      time: '10 minutes',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: `${gasText(gas)} of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Watch the protocol's own announcements for a points or token update, and note the date of each one.`,
      cost: 'nothing',
      time: '5 minutes a week',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's form for data.js, carrying the farm plan the model wrote for it. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    category_factor: row.model.category_factor,
    category_median_tvl_usd: row.model.category_median_tvl_usd,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    watchlist: snapshot.watchlist.slice(),
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
