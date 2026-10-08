import type { GapEvent } from './gap';
import type { Item, Kind, PkgType } from './types';
/** Identity key for a package row: type + name (formulae and casks share one flat namespace). */
export function itemKey(t: PkgType, n: string): string {
	return `${t}/${n}`;
}

/**
 * Sortable change time: precise UTC ISO `ts` when known, else the day at UTC
 * midnight. All inputs are UTC-normalized ISO strings, so lexicographic
 * compare is chronological compare.
 */
function changeKey(x: { ts?: string; d: string }): string {
	return x.ts ?? `${x.d}T00:00:00.000Z`;
}

/** Newest first by precise change time, then name ascending as the tie-break. */
export function sortItems(items: readonly Item[]): Item[] {
	return [...items].sort((a, b) => {
		const ka = changeKey(a);
		const kb = changeKey(b);
		return ka === kb ? a.n.localeCompare(b.n) : ka < kb ? 1 : -1;
	});
}

/** Minimal event shape upsert accepts — GapEvent, or a base row folded back through. */
type ChangeEvent = { n: string; t: PkgType; k: Kind; d: string; ts?: string };

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
function upsert(map: Map<string, Item>, ev: ChangeEvent, meta?: Item): void {
	const key = itemKey(ev.t, ev.n);
	const cur = map.get(key);
	if (!cur) {
		map.set(key, {
			n: ev.n,
			t: ev.t,
			k: ev.k,
			d: ev.d,
			ts: ev.ts,
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
	// `ts` follows the same rule as `d`: keep whichever is newer (a day-level
	// row can predate a precise one; Date.parse handles both since both are ISO).
	const ts = ev.ts && (!cur.ts || Date.parse(ev.ts) >= Date.parse(cur.ts)) ? ev.ts : cur.ts;
	map.set(key, {
		...cur,
		k: (ev.k === 'n' || cur.k === 'n' ? 'n' : 'u') satisfies Kind,
		d: ev.d > cur.d ? ev.d : cur.d,
		ts,
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
		upsert(map, { n: item.n, t: item.t, k: item.k, d: item.d, ts: item.ts }, item);
	}
	for (const ev of events) {
		upsert(map, ev);
	}
	return sortItems([...map.values()]);
}
