import type { Kind, PkgType } from './types';

/** A single package change event collected from the GitHub compare API. */
export interface GapEvent {
	n: string;
	t: PkgType;
	k: Kind;
	/** date of the newest commit in the compare chunk the event came from, YYYY-MM-DD */
	d: string;
}

/** Tap repo configuration for gap-fill. */
export interface RepoCfg {
	/** e.g. 'Homebrew/homebrew-core' */
	repo: string;
	/** path prefix inside the repo, e.g. 'Formula/' */
	dir: string;
	type: PkgType;
	/** cache-record field name: 'core' | 'cask' */
	key: 'core' | 'cask';
}

/** Homebrew's taps. Both default to the `master` branch. */
export const REPOS: readonly RepoCfg[] = [
	{ repo: 'Homebrew/homebrew-core', dir: 'Formula/', type: 'f', key: 'core' },
	{ repo: 'Homebrew/homebrew-cask', dir: 'Casks/', type: 'c', key: 'cask' }
];

/**
 * Aborted (budget exhausted, rate limited, HTTP failure) — the caller falls
 * back gracefully to whatever was collected so far.
 */
export class SyncAborted extends Error {}

/**
 * Shared request budget across both repos so a single visit never hammers
 * the unauthenticated API (60 req/hr per visitor IP; we allow ~20).
 */
export class Budget {
	used = 0;
	constructor(public readonly max: number) {}
	take(): void {
		if (this.used >= this.max) throw new SyncAborted('request budget exhausted');
		this.used++;
	}
}

interface GhCommit {
	sha: string;
	commit: { committer?: { date?: string } | null } | null;
	parents: { sha: string }[];
}

interface GhCompare {
	status: string;
	ahead_by?: number;
	commits?: GhCommit[];
	files?: { status: string; filename: string }[] | null;
}

/** Minimal GitHub REST client with budget accounting and rate-limit awareness. */
export function makeGh(budget: Budget) {
	return async function gh<T>(path: string): Promise<T> {
		budget.take();
		const res = await fetch(`https://api.github.com${path}`, {
			headers: { Accept: 'application/vnd.github+json' }
		});
		// 403/429 = rate limited (or otherwise forbidden) — bail gracefully.
		if (res.status === 403 || res.status === 429) throw new SyncAborted(`rate limited (${res.status})`);
		if (!res.ok) throw new SyncAborted(`HTTP ${res.status} from ${path.split('?')[0]}`);
		return (await res.json()) as T;
	};
}

/** Current HEAD sha of a repo's default branch. */
export async function currentHead(gh: ReturnType<typeof makeGh>, cfg: RepoCfg): Promise<string> {
	const info = await gh<{ default_branch: string }>(`/repos/${cfg.repo}`);
	const head = await gh<{ sha: string }>(`/repos/${cfg.repo}/commits/${info.default_branch}`);
	return head.sha;
}

function basename(path: string): string {
	return path.slice(path.lastIndexOf('/') + 1, -'.rb'.length);
}

/**
 * Turn compare-API files into events.
 *
 * Deleted and renamed packages are out of scope (this app is about discovering
 * new things, not tracking removals), so `removed` / `renamed` — and the
 * `previous_filename` side of a rename — are skipped entirely. `copied` is
 * rare but is effectively an addition, so it counts as one.
 */
export function filesToEvents(
	files: { status: string; filename: string }[] | null | undefined,
	cfg: RepoCfg,
	date: string
): GapEvent[] {
	const out: GapEvent[] = [];
	if (!files) return out;
	for (const f of files) {
		if (!f.filename.startsWith(cfg.dir) || !f.filename.endsWith('.rb')) continue;
		let k: Kind | null = null;
		if (f.status === 'added' || f.status === 'copied') k = 'n';
		else if (f.status === 'modified' || f.status === 'changed') k = 'u';
		if (!k) continue; // removed / renamed / unchanged
		out.push({ n: basename(f.filename), t: cfg.type, k, d: date });
	}
	return out;
}

function newestCommitDate(commits: GhCommit[]): string {
	let max = '';
	for (const c of commits) {
		const d = c.commit?.committer?.date ?? '';
		if (d > max) max = d;
	}
	return max.slice(0, 10); // YYYY-MM-DD
}

/** Progress tracker for partial syncs: everything strictly newer than `reached` is processed. */
export interface GapProgress {
	reached: string | null;
	diverged: boolean;
}

/**
 * Collect change events for `(base, head]` in one repo, chunking at ≤75
 * commits per compare request to stay well under the API's 250-commit and
 * 300-file response caps (a compare's `files` array is only trustworthy for
 * small ranges).
 *
 * Chunk anchors are derived by walking the parent chain from `head` within
 * the compare's own commit list — immune to response ordering. When the gap
 * exceeds the 250-commit response cap (long overnight gaps), the commit
 * listing API is paged for anchors instead.
 *
 * On failure (budget/rate-limit/network) throws SyncAborted; events collected
 * so far and `progress.reached` remain valid for a partial sync.
 */
export async function collectEvents(
	gh: ReturnType<typeof makeGh>,
	cfg: RepoCfg,
	base: string,
	head: string,
	out: GapEvent[],
	progress: GapProgress
): Promise<void> {
	const cmp = await gh<GhCompare>(`/repos/${cfg.repo}/compare/${base}...${head}`);

	if (cmp.status === 'identical' || cmp.status === 'behind') {
		progress.reached = base; // nothing new — the range is (vacuously) covered
		return;
	}
	if (cmp.status !== 'ahead') {
		// 'diverged' — `base` is not an ancestor of `head` (force-push, stale cache).
		// Signal the caller; it can retry from the precomputed base.
		progress.diverged = true;
		return;
	}

	const commits = cmp.commits ?? [];
	if (commits.length === 0) return;

	if (commits.length <= 75) {
		out.push(...filesToEvents(cmp.files, cfg, newestCommitDate(commits)));
		progress.reached = base; // whole range processed
		return;
	}

	// Walk the parent chain from `head` to find the 75th ancestor as an anchor.
	const bySha = new Map(commits.map((c) => [c.sha, c]));
	let steps = 0;
	let cur: GhCommit | undefined = bySha.get(head);
	while (cur && steps < 75) {
		steps++;
		cur = bySha.get(cur.parents[0]?.sha ?? '');
	}
	if (!cur || steps < 75) {
		// `head` isn't in the response (or the chain breaks): the gap exceeded the
		// compare API's 250-commit response cap. Page the commit listing instead.
		await collectEventsViaListing(gh, cfg, base, head, out, progress);
		return;
	}

	const anchor = cur.sha;
	const chunk = await gh<GhCompare>(`/repos/${cfg.repo}/compare/${anchor}...${head}`);
	if (chunk.status === 'ahead' && chunk.commits?.length) {
		out.push(...filesToEvents(chunk.files, cfg, newestCommitDate(chunk.commits)));
	}
	progress.reached = anchor; // everything above `anchor` is processed
	// Recurse for the remainder between `base` and the anchor.
	await collectEvents(gh, cfg, base, anchor, out, progress);
}

/** Fallback for gaps larger than the compare API's 250-commit response cap. */
async function collectEventsViaListing(
	gh: ReturnType<typeof makeGh>,
	cfg: RepoCfg,
	base: string,
	head: string,
	out: GapEvent[],
	progress: GapProgress
): Promise<void> {
	// Page the commit listing newest-first until we reach `base` (or run out).
	// Consecutive pages share one commit (the cursor), so dedupe as we go.
	const shas: string[] = [];
	const seen = new Set<string>();
	let cursor = head;
	let reachedBase = false;
	let totalCommits = 0;
	outer: while (true) {
		const page = await gh<GhCommit[]>(`/repos/${cfg.repo}/commits?sha=${cursor}&per_page=100`);
		if (!page.length) break;
		for (const c of page) {
			if (c.sha === base) {
				reachedBase = true;
				break outer;
			}
			if (!seen.has(c.sha)) {
				seen.add(c.sha);
				shas.push(c.sha);
				totalCommits++;
			}
		}
		if (page.length < 100) break;
		cursor = page[page.length - 1].sha;
		if (totalCommits > 10_000) break; // hard stop — something is off
	}

	// Chunk newest-first: commits (shas[i+75], shas[i]] per compare request.
	for (let i = 0; i < shas.length; i += 75) {
		const chunkHead = shas[i];
		const anchor = shas.length > i + 75 ? shas[i + 75] : base;
		const cmp = await gh<GhCompare>(`/repos/${cfg.repo}/compare/${anchor}...${chunkHead}`);
		if (cmp.status === 'ahead' && cmp.commits?.length) {
			out.push(...filesToEvents(cmp.files, cfg, newestCommitDate(cmp.commits)));
		}
		progress.reached = anchor; // chunk covered (anchor, chunkHead]; everything above is done
		if (anchor === base) return; // covered the full range
	}
	if (reachedBase) progress.reached = base;
	else if (!shas.length) progress.reached = null;
}
