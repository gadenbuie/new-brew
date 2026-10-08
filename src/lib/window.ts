/**
 * The "since your last visit" window.
 *
 * The window starts at the later of (last visit, 7 days ago) — first visits
 * get the labelled 7-day default, regular visits get exactly what changed
 * since they left, and long absences are never shown more than 7 days back
 * (the gap-fill + seen tracking catch them up going forward).
 *
 * The retention clamp is a safety net: the window can never reach back past
 * the dataset's retention (60 days), so a stale/absent last-visit timestamp
 * can't produce an unfillable request. `capped` reports when it fired.
 */
export interface Window {
	start: Date;
	firstVisit: boolean;
	capped: boolean;
}

const DAY_MS = 86_400_000;

export function computeWindow(lastVisitMs: number | null, nowMs: number, retentionDays: number): Window {
	const sevenDaysAgo = new Date(nowMs - 7 * DAY_MS);
	let start = sevenDaysAgo;
	let firstVisit = true;

	if (lastVisitMs !== null && Number.isFinite(lastVisitMs)) {
		firstVisit = false;
		// a future stamp (clock skew after the last visit) would open an
		// unfillable window — clamp to now so the worst case is "caught up"
		const lastVisit = new Date(Math.min(lastVisitMs, nowMs));
		start = lastVisit > sevenDaysAgo ? lastVisit : sevenDaysAgo;
	}

	const floor = new Date(nowMs - retentionDays * DAY_MS);
	const capped = start < floor;
	if (capped) start = floor;

	return { start, firstVisit, capped };
}

/** Session-scoped window overrides (the "since" picker). */
export type SinceMode = 'auto' | 'yesterday' | 'week' | '30d' | 'custom';

/** Local midnight of `d`. */
function startOfDay(d: Date): Date {
	return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Monday 00:00 (local) of `d`'s week. */
function startOfWeek(d: Date): Date {
	const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
	return monday;
}

/** Parse a `YYYY-MM-DD` string as local midnight. Returns null for garbage. */
function parseIsoDate(iso: string): Date | null {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
	if (!m) return null;
	const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
	return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * The window for a picked "since" mode. `auto` defers to `computeWindow`
 * (last-visit semantics); presets are day-granular like the item dates,
 * all clamped to the dataset's retention with `capped` reporting when it fires.
 */
export function presetWindow(
	mode: SinceMode,
	lastVisitMs: number | null,
	nowMs: number,
	retentionDays: number,
	customIso = ''
): Window {
	if (mode === 'auto') return computeWindow(lastVisitMs, nowMs, retentionDays);

	const now = new Date(nowMs);
	let start: Date;
	if (mode === 'yesterday') start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
	else if (mode === 'week') start = startOfWeek(now);
	else if (mode === '30d') start = new Date(nowMs - 30 * DAY_MS);
	else if (mode === 'custom') start = parseIsoDate(customIso) ?? new Date(nowMs - 7 * DAY_MS);
	else start = new Date(nowMs - 7 * DAY_MS);

	const floor = new Date(nowMs - retentionDays * DAY_MS);
	const capped = start < floor;
	if (capped) start = floor;

	return { start, firstVisit: false, capped };
}

/** Format a Date as the dataset's `YYYY-MM-DD` (item dates are UTC dates). */
export function isoDate(d: Date): string {
	return d.toISOString().slice(0, 10);
}
