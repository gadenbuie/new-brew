import type { GapEvent } from './gap';
import type { Item, Kind, PkgType } from './types';

/** Identity key for a package row: type + name (formulae and casks share one flat namespace). */
export function itemKey(t: PkgType, n: string): string {
	return `${t}/${n}`;
}

/** Newest first, then name ascending for stable, scannable order. */
export function sortItems(items: readonly Item[]): Item[] {
	return [...items].sort((a, b) => (a.d === b.d ? a.n.localeCompare(b.n) : a.d < b.d ? 1 : -1));
}

/**
 * Fold one change into the per-package map with the same dedupe rules the
 * generator uses: one row per package —
 *
 * - keep the newer date (`YYYY-MM-DD` strings compare correctly);
 * - an `added` event upgrades a row to `new`, and a row marked `new` stays
 *   `new` (its earliest in-window event was an addition);
 * - metadata (version/description/homepage) always comes from rows, never
 *   from gap events — and blanks fill in from whichever side has a value.
 */
function upsert(map: Map<string, Item>, ev: GapEvent, meta?: Item): void {
	const key = itemKey(ev.t, ev.n);
	const cur = map.get(key);
	if (!cur) {
		map.set(key, {
			n: ev.n,
			t: ev.t,
			k: ev.k,
			d: ev.d,
			v: meta?.v ?? '',
			desc: meta?.desc ?? '',
			url: meta?.url ?? '',
			dep: meta?.dep ?? false
		});
		return;
	}
	// Metadata attached to a newer row wins outright; for same-or-older
	// rows it only fills blanks. Gap events carry no metadata at all.
	const src = meta && ev.d >= cur.d ? meta : null;
	map.set(key, {
		...cur,
		k: (ev.k === 'n' || cur.k === 'n' ? 'n' : 'u') satisfies Kind,
		d: ev.d > cur.d ? ev.d : cur.d,
		v: src ? (src.v || cur.v) : (cur.v || meta?.v || ''),
		desc: src ? (src.desc || cur.desc) : (cur.desc || meta?.desc || ''),
		url: src ? (src.url || cur.url) : (cur.url || meta?.url || ''),
		dep: src ? (src.dep || cur.dep) : (cur.dep || meta?.dep || false)
	});
}

/**
 * Merge gap-fill events into a base dataset. Base rows fold through the same
 * upsert as events, so duplicate rows in the base (e.g. a stale changes.json)
 * collapse per the same rules instead of silently overwriting each other.
 *
 * Bottle-only rebuilds dedupe naturally: repeated `modified` events for the
 * same package collapse into the single row that already exists.
 */
export function mergeItems(base: readonly Item[], events: readonly GapEvent[]): Item[] {
	const map = new Map<string, Item>();
	for (const item of base) {
		upsert(map, { n: item.n, t: item.t, k: item.k, d: item.d }, item);
	}
	for (const ev of events) {
		upsert(map, ev);
	}
	return sortItems([...map.values()]);
}
