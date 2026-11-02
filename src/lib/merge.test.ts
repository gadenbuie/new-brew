import { describe, expect, it } from 'vitest';
import type { GapEvent } from './gap';
import { itemKey, mergeItems, sortItems } from './merge';
import type { Item } from './types';

function item(partial: Partial<Item> & { n: string }): Item {
	return { t: 'f', k: 'u', d: '2026-10-08', v: '1.0.0', desc: '', url: '', dep: false, ...partial };
}

function ev(partial: Partial<GapEvent> & { n: string }): GapEvent {
	const d = partial.d ?? '2026-10-08';
	return { t: 'f', k: 'u', d, ts: partial.ts ?? `${d}T12:00:00.000Z`, ...partial };
}

describe('itemKey', () => {
	it('distinguishes formulae and casks with the same name', () => {
		expect(itemKey('f', 'ghostty')).not.toEqual(itemKey('c', 'ghostty'));
	});
});

describe('sortItems', () => {
	it('sorts newest first, then name ascending', () => {
		const sorted = sortItems([
			item({ n: 'b', d: '2026-10-07' }),
			item({ n: 'a', d: '2026-10-07' }),
			item({ n: 'z', d: '2026-10-08' })
		]);
		expect(sorted.map((i) => i.n)).toEqual(['z', 'a', 'b']);
	});

	it('sorts by precise ts within the same day', () => {
		const sorted = sortItems([
			item({ n: 'late', d: '2026-10-08', ts: '2026-10-08T20:00:00.000Z' }),
			item({ n: 'early', d: '2026-10-08', ts: '2026-10-08T06:00:00.000Z' }),
			item({ n: 'noon', d: '2026-10-08', ts: '2026-10-08T12:00:00.000Z' })
		]);
		expect(sorted.map((i) => i.n)).toEqual(['late', 'noon', 'early']);
	});

	it('treats a missing ts as the day at UTC midnight (legacy cached rows)', () => {
		const sorted = sortItems([
			item({ n: 'legacy', d: '2026-10-08' }),
			item({ n: 'precise', d: '2026-10-08', ts: '2026-10-08T00:00:01.000Z' })
		]);
		expect(sorted.map((i) => i.n)).toEqual(['precise', 'legacy']);
	});

	it('does not mutate the input', () => {
		const input = [item({ n: 'b', d: '2026-10-01' }), item({ n: 'a', d: '2026-10-02' })];
		sortItems(input);
		expect(input.map((i) => i.n)).toEqual(['b', 'a']);
	});
});

describe('mergeItems', () => {
	it('adds new gap packages with empty metadata', () => {
		const merged = mergeItems([], [ev({ n: 'fresh', k: 'n' })]);
		expect(merged).toHaveLength(1);
		expect(merged[0]).toMatchObject({
			n: 'fresh',
			k: 'n',
			ts: '2026-10-08T12:00:00.000Z',
			v: '',
			desc: '',
			url: '',
			dep: false
		});
	});

	it('keeps newer date on re-modified packages', () => {
		const merged = mergeItems(
			[item({ n: 'rg', d: '2026-10-05', ts: '2026-10-05T09:00:00.000Z' })],
			[ev({ n: 'rg', k: 'u', d: '2026-10-08' })]
		);
		expect(merged[0].d).toBe('2026-10-08');
		expect(merged[0].ts).toBe('2026-10-08T12:00:00.000Z');
		expect(merged[0].v).toBe('1.0.0'); // metadata survives
	});

	it('keeps the precomputed date when the gap event is older', () => {
		const merged = mergeItems(
			[item({ n: 'rg', d: '2026-10-08', ts: '2026-10-08T18:00:00.000Z' })],
			[ev({ n: 'rg', k: 'u', d: '2026-10-01' })]
		);
		expect(merged[0].d).toBe('2026-10-08');
		expect(merged[0].ts).toBe('2026-10-08T18:00:00.000Z');
	});

	it('upgrades to new on an added gap event', () => {
		const merged = mergeItems([item({ n: 'rg', k: 'u' })], [ev({ n: 'rg', k: 'n' })]);
		expect(merged[0].k).toBe('n');
	});

	it('demotes new to updated once a later release lands outside the grace window', () => {
		// the gloomberb case: added in-window, then bumped 43 days later
		const merged = mergeItems(
			[
				item({
					n: 'gloomberb',
					t: 'c',
					k: 'n',
					d: '2026-09-20',
					ts: '2026-09-20T14:49:17.000Z',
					ad: '2026-09-20'
				})
			],
			[ev({ n: 'gloomberb', t: 'c', k: 'u', d: '2026-11-01', ts: '2026-11-01T18:52:01.000Z' })],
			Date.parse('2026-11-02T00:00:00.000Z')
		);
		expect(merged[0]).toMatchObject({ k: 'u', d: '2026-11-01', ts: '2026-11-01T18:52:01.000Z' });
	});

	it('keeps new through the grace window, so a same-day follow-up does not erase it', () => {
		const now = Date.parse('2026-10-05T00:00:00.000Z');
		const merged = mergeItems(
			[item({ n: 'font-x', t: 'c', k: 'n', d: '2026-10-01', ad: '2026-10-01' })],
			[ev({ n: 'font-x', t: 'c', k: 'u', d: '2026-10-01', ts: '2026-10-01T23:00:00.000Z' })],
			now
		);
		expect(merged[0]).toMatchObject({ k: 'n', d: '2026-10-01', ad: '2026-10-01' });
	});

	it('lets the grace window expire', () => {
		const now = Date.parse('2026-10-09T00:00:00.000Z'); // day 8
		const merged = mergeItems(
			[item({ n: 'font-x', t: 'c', k: 'n', d: '2026-10-01', ad: '2026-10-01' })],
			[ev({ n: 'font-x', t: 'c', k: 'u', d: '2026-10-02', ts: '2026-10-02T09:00:00.000Z' })],
			now
		);
		expect(merged[0].k).toBe('u');
	});

	it('records the creation date when an added event introduces a package', () => {
		const merged = mergeItems([], [ev({ n: 'fresh', k: 'n', d: '2026-10-08' })], Date.now());
		expect(merged[0]).toMatchObject({ k: 'n', ad: '2026-10-08' });
	});

	it('keeps new when the gap event is older than the row', () => {
		const merged = mergeItems(
			[item({ n: 'rg', k: 'n', d: '2026-10-08', ts: '2026-10-08T18:00:00.000Z' })],
			[ev({ n: 'rg', k: 'u', d: '2026-10-02', ts: '2026-10-02T09:00:00.000Z' })]
		);
		expect(merged[0]).toMatchObject({ k: 'n', d: '2026-10-08' });
	});

	it('keeps the current kind when a replayed event ties on time', () => {
		// the precomputed row is folded in first, so it wins a same-instant tie
		const merged = mergeItems(
			[item({ n: 'rg', k: 'u', d: '2026-10-08', ts: '2026-10-08T12:00:00.000Z' })],
			[ev({ n: 'rg', k: 'n', d: '2026-10-08', ts: '2026-10-08T12:00:00.000Z' })]
		);
		expect(merged[0].k).toBe('u');
	});

	it('dedupes bottle-only rebuilds into one row', () => {
		const merged = mergeItems([item({ n: 'rg' })], [
			ev({ n: 'rg', k: 'u', d: '2026-10-07' }),
			ev({ n: 'rg', k: 'u', d: '2026-10-08' }),
			ev({ n: 'rg', k: 'u', d: '2026-10-08' })
		]);
		expect(merged).toHaveLength(1);
		expect(merged[0].d).toBe('2026-10-08');
	});

	it('merges casks and formulae under separate keys', () => {
		const merged = mergeItems(
			[item({ n: 'ghostty', t: 'c' })],
			[ev({ n: 'ghostty', t: 'f', k: 'n' })]
		);
		expect(merged).toHaveLength(2);
	});

	it('keeps the more precise ts when a same-day gap event lands on a day-level row', () => {
		const merged = mergeItems([item({ n: 'day', d: '2026-10-08' })], [
			ev({ n: 'day', k: 'u', d: '2026-10-08', ts: '2026-10-08T15:30:00.000Z' })
		]);
		expect(merged[0]).toMatchObject({ d: '2026-10-08', ts: '2026-10-08T15:30:00.000Z' });
	});

	it('collapses duplicate base rows per the dedupe rules (no silent overwrite)', () => {
		const merged = mergeItems(
			[
				item({ n: 'ghostty', t: 'c', k: 'u', d: '2026-10-07', v: '1.0.1' }),
				item({ n: 'ghostty', t: 'c', k: 'n', d: '2026-10-08', v: '1.1.0' })
			],
			[]
		);
		expect(merged).toHaveLength(1);
		expect(merged[0]).toMatchObject({ k: 'n', d: '2026-10-08', v: '1.1.0' });
	});

	it('fills metadata blanks from whichever side has a value', () => {
		const merged = mergeItems(
			[
				item({ n: 'sparse', v: '', desc: '', url: '' }),
				item({ n: 'sparse', d: '2026-10-09', v: '2.0.0', desc: 'now with metadata', url: 'https://x' })
			],
			[]
		);
		expect(merged[0]).toMatchObject({ d: '2026-10-09', v: '2.0.0', desc: 'now with metadata' });
	});
});
