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

/**
 * Change time in epoch ms. Parsed rather than compared as strings so a `ts`
 * without milliseconds still orders correctly against one with them.
 */
function changeTime(x: { ts?: string; d: string }): number {
	return Date.parse(changeKey(x));
}

/**
 * A package keeps `new` for this long after its creation, follow-up commits or
 * not — mirrors `GRACE_DAYS` in scripts/build-data.mjs. A same-day "fix
 * livecheck" shouldn't erase that the thing just appeared.
 */
export const GRACE_DAYS = 7;

/** Is the creation recent enough to still count as new? (No `ad` = unknown/older.) */
function inGrace(ad: string | undefined, nowMs: number): boolean {
	if (!ad) return false;
	const t = Date.parse(`${ad}T00:00:00.000Z`);
	return Number.isFinite(t) && nowMs - t <= GRACE_DAYS * 86_400_000;
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
 * - `k` describes the newest event, never the package's lifetime: an `added`
 *   event makes the row `new`, and a later `modified` event makes it
 *   `updated` again — unless the creation date `ad` is still inside its
 *   grace window, in which case it stays `new` (see DESIGN.md). On a tie the
 *   newest-event verdict is taken from the existing row — precomputed rows
 *   fold in before gap events, so the generator wins over a replayed
 *   duplicate;
 * - metadata (version/description/homepage) always comes from rows, never
 *   from gap events — and blanks fill in from whichever side has a value.
 */
function upsert(map: Map<string, Item>, ev: ChangeEvent, meta: Item | undefined, nowMs: number): void {
	const key = itemKey(ev.t, ev.n);
	const cur = map.get(key);
	if (!cur) {
		const ad = ev.k === 'n' ? ev.d : meta?.ad;
		map.set(key, {
			n: ev.n,
			t: ev.t,
			k: ev.k === 'n' || inGrace(ad, nowMs) ? 'n' : 'u',
			d: ev.d,
			ts: ev.ts,
			ad,
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
	// The newest event owns the kind — the row is `new` only while its latest
	// change is the creation, or while the creation is still inside the grace
	// window (a package that ships a follow-up the same day it lands).
	const newest = changeTime(ev) > changeTime(cur);
	const ad = cur.ad ?? (ev.k === 'n' ? ev.d : meta?.ad);
	const verdict = newest ? ev.k : cur.k;
	// `ts` follows the same rule as `d`: keep whichever is newer (a day-level
	// row can predate a precise one; Date.parse handles both since both are ISO).
	const ts = ev.ts && (!cur.ts || Date.parse(ev.ts) >= Date.parse(cur.ts)) ? ev.ts : cur.ts;
	map.set(key, {
		...cur,
		k: (verdict === 'n' || inGrace(ad, nowMs) ? 'n' : 'u') satisfies Kind,
		d: ev.d > cur.d ? ev.d : cur.d,
		ts,
		ad,
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
export function mergeItems(
	base: readonly Item[],
	events: readonly GapEvent[],
	/** injectable for tests — decides whether a grace period is still running */
	nowMs: number = Date.now()
): Item[] {
	const map = new Map<string, Item>();
	for (const item of base) {
		upsert(map, { n: item.n, t: item.t, k: item.k, d: item.d, ts: item.ts }, item, nowMs);
	}
	for (const ev of events) {
		upsert(map, ev, undefined, nowMs);
	}
	return sortItems([...map.values()]);
}
