import { describe, expect, it } from 'vitest';
import { itemKey, mergeItems, sortItems } from './merge';
import type { Item } from './types';

function item(partial: Partial<Item> & { n: string }): Item {
	return { t: 'f', k: 'u', d: '2026-10-08', v: '1.0.0', desc: '', url: '', dep: false, ...partial };
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

	it('does not mutate the input', () => {
		const input = [item({ n: 'b', d: '2026-10-01' }), item({ n: 'a', d: '2026-10-02' })];
		sortItems(input);
		expect(input.map((i) => i.n)).toEqual(['b', 'a']);
	});
});

describe('mergeItems', () => {
	it('adds new gap packages with empty metadata', () => {
		const merged = mergeItems([], [{ n: 'fresh', t: 'f', k: 'n', d: '2026-10-08' }]);
		expect(merged).toHaveLength(1);
		expect(merged[0]).toMatchObject({ n: 'fresh', k: 'n', v: '', desc: '', url: '', dep: false });
	});

	it('keeps newer date on re-modified packages', () => {
		const merged = mergeItems([item({ n: 'rg', d: '2026-10-05' })], [
			{ n: 'rg', t: 'f', k: 'u', d: '2026-10-08' }
		]);
		expect(merged[0].d).toBe('2026-10-08');
		expect(merged[0].v).toBe('1.0.0'); // metadata survives
	});

	it('keeps the precomputed date when the gap event is older', () => {
		const merged = mergeItems([item({ n: 'rg', d: '2026-10-08' })], [
			{ n: 'rg', t: 'f', k: 'u', d: '2026-10-01' }
		]);
		expect(merged[0].d).toBe('2026-10-08');
	});

	it('upgrades to new on an added gap event', () => {
		const merged = mergeItems([item({ n: 'rg', k: 'u' })], [
			{ n: 'rg', t: 'f', k: 'n', d: '2026-10-08' }
		]);
		expect(merged[0].k).toBe('n');
	});

	it('keeps new when later gap events are updates (earliest in-window event was an addition)', () => {
		const merged = mergeItems([item({ n: 'rg', k: 'n' })], [
			{ n: 'rg', t: 'f', k: 'u', d: '2026-10-08' }
		]);
		expect(merged[0].k).toBe('n');
	});

	it('dedupes bottle-only rebuilds into one row', () => {
		const merged = mergeItems([item({ n: 'rg' })], [
			{ n: 'rg', t: 'f', k: 'u', d: '2026-10-07' },
			{ n: 'rg', t: 'f', k: 'u', d: '2026-10-08' },
			{ n: 'rg', t: 'f', k: 'u', d: '2026-10-08' }
		]);
		expect(merged).toHaveLength(1);
		expect(merged[0].d).toBe('2026-10-08');
	});

	it('merges casks and formulae under separate keys', () => {
		const merged = mergeItems([item({ n: 'ghostty', t: 'c' })], [
			{ n: 'ghostty', t: 'f', k: 'n', d: '2026-10-08' }
		]);
		expect(merged).toHaveLength(2);
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
