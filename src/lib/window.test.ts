import { describe, expect, it } from 'vitest';
import { computeWindow, isoDate } from './window';

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
