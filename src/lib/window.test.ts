import { describe, expect, it } from 'vitest';
import { computeWindow, isoDate, presetWindow } from './window';

const DAY = 86_400_000;

describe('computeWindow', () => {
	it('defaults to 7 days on first visit', () => {
		const now = Date.UTC(2026, 9, 8, 12);
		const w = computeWindow(null, now, 60);
		expect(w.firstVisit).toBe(true);
		expect(w.start.getTime()).toBe(now - 7 * DAY);
		expect(w.capped).toBe(false);
	});

	it('starts at the last visit when it is more recent than 7 days ago', () => {
		const now = Date.UTC(2026, 9, 8, 12);
		const lastVisit = now - 2 * DAY;
		const w = computeWindow(lastVisit, now, 60);
		expect(w.firstVisit).toBe(false);
		expect(w.start.getTime()).toBe(lastVisit);
	});

	it('falls back to 7 days after a long absence', () => {
		const now = Date.UTC(2026, 9, 8, 12);
		const w = computeWindow(now - 30 * DAY, now, 60);
		expect(w.start.getTime()).toBe(now - 7 * DAY);
	});

	it('caps to retention if the window would reach past it', () => {
		const now = Date.UTC(2026, 9, 8, 12);
		// tiny retention (3 days) — the 7-day default overreaches it
		const w = computeWindow(null, now, 3);
		expect(w.capped).toBe(true);
		expect(w.start.getTime()).toBe(now - 3 * DAY);
	});

	it('ignores invalid last-visit values', () => {
		const now = Date.UTC(2026, 9, 8, 12);
		const w = computeWindow(Number.NaN, now, 60);
		expect(w.firstVisit).toBe(true);
	});
});

describe('isoDate', () => {
	it('formats as YYYY-MM-DD', () => {
		expect(isoDate(new Date('2026-10-08T23:30:00Z'))).toBe('2026-10-08');
	});
});

describe('presetWindow', () => {
	// Friday 2026-10-09, 14:30 local (fixed reference for preset math)
	const now = new Date(2026, 9, 9, 14, 30).getTime();

	it('yesterday starts at local midnight of the previous day', () => {
		const w = presetWindow('yesterday', null, now, 60);
		expect(w.start.getFullYear()).toBe(2026);
		expect(w.start.getMonth()).toBe(9);
		expect(w.start.getDate()).toBe(8);
		expect(w.start.getHours()).toBe(0);
		expect(w.firstVisit).toBe(false);
		expect(w.capped).toBe(false);
	});

	it('this week starts at Monday midnight', () => {
		const w = presetWindow('week', null, now, 60);
		expect(w.start.getDay()).toBe(1); // Monday
		expect(w.start.getDate()).toBe(5); // 2026-10-05
	});

	it('this week on a Monday is today at midnight', () => {
		const monday = new Date(2026, 9, 5, 9, 0).getTime();
		const w = presetWindow('week', null, monday, 60);
		expect(w.start.getDay()).toBe(1);
		expect(w.start.getDate()).toBe(5);
	});

	it('30 days starts 30 days back', () => {
		const w = presetWindow('30d', null, now, 60);
		expect(w.start.getTime()).toBe(now - 30 * DAY);
	});

	it('custom parses a local YYYY-MM-DD date', () => {
		const w = presetWindow('custom', null, now, 60, '2026-10-02');
		expect(w.start.getDate()).toBe(2);
		expect(w.start.getHours()).toBe(0);
	});

	it('custom beyond retention clamps and reports capped', () => {
		const w = presetWindow('custom', null, now, 60, '2026-06-01');
		expect(w.capped).toBe(true);
		expect(w.start.getTime()).toBe(now - 60 * DAY);
	});

	it('invalid custom input falls back to the 7-day default instead of exploding', () => {
		const w = presetWindow('custom', null, now, 60, 'garbage');
		expect(w.start.getTime()).toBe(now - 7 * DAY);
	});

	it('auto defers to computeWindow', () => {
		const now2 = Date.UTC(2026, 9, 8, 12);
		const w = presetWindow('auto', null, now2, 60);
		expect(w.firstVisit).toBe(true);
		expect(w.start.getTime()).toBe(now2 - 7 * DAY);
	});
});
