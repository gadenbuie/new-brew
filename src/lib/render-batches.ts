/** Time-sliced list mounting: batch sizes for growing the rendered slice
 * in rAF steps (see the batch effect in `+page.svelte`). Extracted as pure
 * functions because the growth math is easy to get subtly wrong — a capped
 * `min(n * 2, max)` stalls once `n` reaches the cap, freezing the growth
 * chain (and the spinner) forever. */

/** Rows mounted synchronously with a commit, before any yielding. */
export const RENDER_BATCH = 60;

/** Largest step the growth chain may take between frames. */
export const RENDER_BATCH_MAX = 300;

/** Next rendered count: double while small, then grow by at most
 * RENDER_BATCH_MAX per frame. Always strictly increases while below
 * `total`, so the growth chain terminates. */
export function nextBatchCount(n: number, total: number): number {
	return Math.min(n * 2, n + RENDER_BATCH_MAX, total);
}
