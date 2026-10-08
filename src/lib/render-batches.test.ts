import { describe, expect, it } from 'vitest';
import { RENDER_BATCH, RENDER_BATCH_MAX, nextBatchCount } from './render-batches.ts';

describe('nextBatchCount', () => {
	it('doubles while small', () => {
		expect(nextBatchCount(RENDER_BATCH, 3600)).toBe(RENDER_BATCH * 2);
		expect(nextBatchCount(RENDER_BATCH * 2, 3600)).toBe(RENDER_BATCH * 4);
	});

	it('never steps by more than RENDER_BATCH_MAX', () => {
		for (let n = RENDER_BATCH; n < 2000; n = nextBatchCount(n, 3600)) {
			const step = nextBatchCount(n, 3600) - n;
			expect(step).toBeLessThanOrEqual(RENDER_BATCH_MAX);
			expect(step).toBeGreaterThan(0);
		}
	});

	it('always terminates at exactly total — regression: min(n*2, max) stalls at the cap', () => {
		for (const total of [301, 1000, 3600, 10_000]) {
			let n = RENDER_BATCH;
			let guard = 0;
			while (n < total) {
				n = nextBatchCount(n, total);
				expect(++guard).toBeLessThan(1000); // no infinite chains
			}
			expect(n).toBe(total);
		}
	});

	it('clamps to a total smaller than the first batch', () => {
		expect(nextBatchCount(RENDER_BATCH, 40)).toBe(40);
	});

	it('returns total when already there', () => {
		expect(nextBatchCount(3600, 3600)).toBe(3600);
	});
});
