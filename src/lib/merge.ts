import type { GapEvent } from './gap';
import type { Item, Kind, PkgType } from './types';

/** Identity key for a package row: type + name (formulae and casks live in one namespace-free list). */
export function itemKey(t: PkgType, n: string): string {
	return `${t}/${n}`;
}

/** Newest first, then name ascending for stable, scannable order. */
export function sortItems(items: readonly Item[]): Item[] {
	return [...items].sort((a, b) => (a.d === b.d ? a.n.localeCompare(b.n) : a.d < b.d ? 1 : -1));
}

/**
 * Merge gap-fill events into a base dataset with the same dedupe rules the
 * generator uses: one row per package —
 *
 * - keep the newer date (`YYYY-MM-DD` strings compare correctly);
 * - an `added` event upgrades a row to `new`, and a row marked `new` stays
 *   `new` (its earliest in-window event was an addition);
 * - metadata (version/description/homepage) always comes from the base rows —
 *   gap events are git-log facts only, so keep whatever the base row had.
 *
 * Bottle-only rebuilds dedupe naturally: repeated `modified` events for the
 * same package collapse into the single row that already exists.
 */
export function mergeItems(base: readonly Item[], events: readonly GapEvent[]): Item[] {
	const map = new Map<string, Item>();
	for (const item of base) map.set(itemKey(item.t, item.n), { ...item });
	for (const ev of events) {
		const key = itemKey(ev.t, ev.n);
		const cur = map.get(key);
		if (!cur) {
			// Not in the precomputed data yet — a brand-new package. Metadata
			// arrives with the next Action run; the UI renders blanks as `—`.
			map.set(key, { n: ev.n, t: ev.t, k: ev.k, d: ev.d, v: '', desc: '', url: '', dep: false });
			continue;
		}
		const k: Kind = ev.k === 'n' || cur.k === 'n' ? 'n' : 'u';
		const d = ev.d > cur.d ? ev.d : cur.d;
		if (k !== cur.k || d !== cur.d) map.set(key, { ...cur, k, d });
	}
	return sortItems([...map.values()]);
}
