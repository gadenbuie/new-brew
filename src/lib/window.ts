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
		const lastVisit = new Date(lastVisitMs);
		start = lastVisit > sevenDaysAgo ? lastVisit : sevenDaysAgo;
	}

	const floor = new Date(nowMs - retentionDays * DAY_MS);
	const capped = start < floor;
	if (capped) start = floor;

	return { start, firstVisit, capped };
}

/** Format a Date as the dataset's `YYYY-MM-DD` (item dates are UTC dates). */
export function isoDate(d: Date): string {
	return d.toISOString().slice(0, 10);
}
