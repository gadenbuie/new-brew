import { browser } from '$app/env';
import {
	Budget,
	REPOS,
	SyncAborted,
	collectEvents,
	currentHead,
	makeGh,
	type GapEvent,
	type GapProgress
} from './gap';
import { mergeItems } from './merge';
import type { CacheRecord, Dataset, DatasetIdentity, Item } from './types';

/**
 * Data layer: changes.json fetch → browser gap-fill (GitHub compare API) →
 * merge → localStorage cache. Owns the merged timeline; windowing and UI
 * state live in `state.svelte.ts`.
 */

const CHANGES_URL = 'data/changes.json';
const CACHE_KEY = 'newbrew:cache:v1';
/** Shared across both repos — see the rate-limit math in DESIGN.md. */
const MAX_REQUESTS_PER_VISIT = 20;

function identity(d: DatasetIdentity): string {
	return `${d.generated_at}:${d.core_head_sha}:${d.cask_head_sha}`;
}

function readCache(): CacheRecord | null {
	if (!browser) return null;
	try {
		const raw = localStorage.getItem(CACHE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as CacheRecord;
		if (
			parsed?.v !== 1 ||
			!parsed?.identity?.generated_at ||
			!parsed?.items ||
			!Array.isArray(parsed.items)
		) {
			return null;
		}
		return parsed;
	} catch {
		return null;
	}
}

/** Quota errors are caught and ignored — caching silently degrades to fetch-only. */
function writeCache(record: CacheRecord): void {
	if (!browser) return;
	try {
		localStorage.setItem(CACHE_KEY, JSON.stringify(record));
	} catch {
		/* over quota (~5 MB) or storage disabled — fine */
	}
}

class DataStore {
	/** merged timeline, newest first */
	items = $state<Item[]>([]);
	/** changes.json generation time — drives the "updated HH:MM" header */
	generatedAt = $state('');
	retentionDays = $state(60);
	/** true while changes.json/gap-fill is in flight */
	loading = $state(true);
	/** true while a background gap-fill sync runs (after cache paint) */
	syncing = $state(false);
	/** true when neither cache nor changes.json could be loaded */
	failed = $state(false);

	#started = false;

	/** Browser-only; call once from the page. Idempotent. */
	async init(): Promise<void> {
		if (!browser || this.#started) return;
		this.#started = true;

		// 1. Paint the cached dataset instantly, if any.
		const cache = readCache();
		if (cache) {
			this.items = cache.items;
			this.generatedAt = cache.identity.generated_at;
			this.retentionDays = cache.retentionDays ?? 60;
			this.loading = false;
		}

		// 2. Fetch the precomputed changes.json (cheap static fetch, no rate limits).
		let server: Dataset | null = null;
		try {
			const res = await fetch(CHANGES_URL, { cache: 'no-cache' });
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const parsed = (await res.json()) as Dataset;
			if (!parsed?.items || !Array.isArray(parsed.items)) throw new Error('bad changes.json');
			server = parsed;
		} catch {
			/* offline or malformed — fall through */
		}

		if (!server) {
			// No fresh base → gap-fill is impossible; keep serving the cache, if any.
			if (!cache) this.failed = true;
			this.loading = false;
			return;
		}

		this.generatedAt = server.generated_at;
		this.retentionDays = server.retention_days ?? 60;

		const idMatch = !!cache && identity(cache.identity) === identity(server);

		// 3. Same data window and a completed sync already happened for both
		//    repos → skip the GitHub API entirely (zero requests on cached
		//    revisits; each between-runs window pays for lookups once per browser).
		if (idMatch && cache && cache.synced.core && cache.synced.cask) {
			this.items = cache.items;
			this.loading = false;
			this.syncing = false;
			return;
		}

		// 4. Gap-fill from the cached synced HEAD to current HEAD. Start from
		//    whatever point the last sync actually reached (synced, then partial,
		//    then the precomputed base SHAs for first-ever visits).
		this.syncing = true;
		const budget = new Budget(MAX_REQUESTS_PER_VISIT);
		const gh = makeGh(budget);
		const events: GapEvent[] = [];
		const synced = { core: cache?.synced.core ?? null, cask: cache?.synced.cask ?? null };
		const partial = { core: cache?.partial.core ?? null, cask: cache?.partial.cask ?? null };

		for (const cfg of REPOS) {
			if (idMatch && synced[cfg.key]) continue; // this repo already synced this window
			const serverBase = cfg.key === 'core' ? server.core_head_sha : server.cask_head_sha;
			const start = synced[cfg.key] ?? partial[cfg.key] ?? serverBase;
			const progress: GapProgress = { reached: partial[cfg.key], diverged: false };
			try {
				const head = await currentHead(gh, cfg);
				await collectEvents(gh, cfg, start, head, events, progress);
				if (progress.diverged && start !== serverBase) {
					// Stale cached anchor (force-push?) — retry from the precomputed base.
					const retry: GapProgress = { reached: null, diverged: false };
					await collectEvents(gh, cfg, serverBase, head, events, retry);
					if (retry.diverged) throw new SyncAborted('diverged from precomputed base');
					progress.reached = retry.reached;
				}
				if (progress.reached === null) throw new SyncAborted('no progress');
				synced[cfg.key] = head;
				partial[cfg.key] = null;
			} catch (err) {
				// Rate-limit exhaustion, budget cap, or failure: fall back to what we
				// have. Partial progress is kept so the next visit resumes instead
				// of re-paying for the same chunks.
				if (!(err instanceof SyncAborted)) console.warn(`[new-brew] gap-fill failed:`, err);
				partial[cfg.key] = progress.reached ?? partial[cfg.key];
			}
		}

		// 5. Merge. When the same changes.json generation is live, the cached
		//    items are the right base (they include earlier gap events); when a
		//    new Action run landed, the new server items supersede them.
		const mergeBase = idMatch && cache ? cache.items : server.items;
		const merged = mergeItems(mergeBase, events);

		this.items = merged;
		this.loading = false;
		this.syncing = false;

		// 6. Cache the merged dataset for instant paint + zero-request revisits.
		writeCache({
			v: 1,
			identity: {
				generated_at: server.generated_at,
				core_head_sha: server.core_head_sha,
				cask_head_sha: server.cask_head_sha
			},
			retentionDays: server.retention_days ?? 60,
			synced,
			partial,
			items: merged
		});
	}
}

/** The app-wide dataset. */
export const data = new DataStore();
