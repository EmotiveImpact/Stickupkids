// What a job pays once the fence has had a look at it. Clean money is worth
// more: no bodies and hold-ups instead of kills raise the price, bodies and
// hurt civilians bring heat that the fence charges for.

export interface PayoutLine {
  label: string;
  /** Share of the take added (or taken off, when negative). */
  pct: number;
}

export interface Payout {
  /** Loot value carried out. */
  base: number;
  lines: PayoutLine[];
  multiplier: number;
  /** What the crew banks, rounded to £10. */
  total: number;
}

export const CLEAN_BONUS = 0.25;
export const HOLD_UP_BONUS = 0.05;
export const HOLD_UP_CAP = 0.2;
export const BODY_COST = 0.15;
export const CIVILIAN_COST = 0.3;
/** Never pays less than this share of the take. */
const FLOOR = 0.3;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function payoutFor(base: number, bodies: number, holdUps: number, civiliansHurt: number): Payout {
  const lines: PayoutLine[] = [];
  if (base > 0) {
    if (bodies === 0) lines.push({ label: 'No bodies', pct: CLEAN_BONUS });
    if (holdUps > 0) lines.push({ label: plural(holdUps, 'hold-up', 'hold-ups'), pct: Math.min(HOLD_UP_CAP, holdUps * HOLD_UP_BONUS) });
    if (bodies > 0) lines.push({ label: `${plural(bodies, 'body', 'bodies')}: hot money`, pct: -bodies * BODY_COST });
    if (civiliansHurt > 0) lines.push({ label: `${plural(civiliansHurt, 'civilian', 'civilians')} hurt`, pct: -civiliansHurt * CIVILIAN_COST });
  }
  const multiplier = Math.max(FLOOR, 1 + lines.reduce((s, l) => s + l.pct, 0));
  return { base, lines, multiplier, total: Math.round((base * multiplier) / 10) * 10 };
}

/** Chance, in per cent, that the firm comes looking for the crew. */
export function revengeRisk(bodies: number, rivalHeat: number): number {
  return Math.max(0, Math.min(95, Math.round(bodies * 18 + Math.max(0, rivalHeat - 20) * 0.5)));
}

/** Ride Out: every one the crew touched, their side are coming back for. */
export function rideOutRisk(caught: number, bodies: number): number {
  return Math.max(0, Math.min(95, Math.round(caught * 16 + bodies * 10)));
}
