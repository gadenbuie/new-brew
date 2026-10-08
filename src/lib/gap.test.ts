import { describe, expect, it } from 'vitest';
import { Budget, collectEvents, makeGh, REPOS, SyncAborted, type GapEvent } from './gap';

const core = REPOS[0];

/** Build a linear history c0 ← c1 ← … ← c(n-1) (c0 is the oldest). */
function chain(n: number): { shas: string[]; commits: Map<string, ReturnType<typeof commit>> } {
	const shas = Array.from({ length: n }, (_, i) => `sha${i}`);
	const commits = new Map<string, ReturnType<typeof commit>>();
	shas.forEach((sha, i) => {
		commits.set(sha, commit(sha, shas[i - 1] ?? null, `2026-10-0${(i % 8) + 1}T10:00:00Z`));
	});
	return { shas, commits };
}

function commit(sha: string, parent: string | null, date: string) {
	return { sha, commit: { committer: { date } }, parents: parent ? [{ sha: parent }] : [] };
}

function fakeGh(routes: Record<string, unknown>) {
	const calls: string[] = [];
	const gh = makeGh(new Budget(100));
	const mocked = async (path: string) => {
		calls.push(path);
		const hit = routes[path] ?? routes[path.replace(/\?.*$/, '')];
		if (!hit) throw new SyncAborted(`unexpected request: ${path}`);
		return typeof hit === 'function' ? hit() : hit;
	};
	return { gh: mocked as unknown as typeof gh, calls };
}

describe('collectEvents', () => {
	it('uses the compare response directly when the gap fits one chunk', async () => {
		const { shas, commits } = chain(3);
		const base = shas[0];
		const head = shas[2];
		const { gh, calls } = fakeGh({
			[`/repos/Homebrew/homebrew-core/compare/${base}...${head}`]: {
				status: 'ahead',
				commits: [...commits.values()],
				files: [{ status: 'added', filename: 'Formula/zot.rb' }]
			}
		});
		const events: GapEvent[] = [];
		const progress = { reached: null, diverged: false };
		await collectEvents(gh, core, base, head, events, progress);
		expect(events).toEqual([{ n: 'zot', t: 'f', k: 'n', d: '2026-10-03' }]);
		expect(progress.reached).toBe(base);
		expect(progress.diverged).toBe(false);
		expect(calls).toHaveLength(1);
	});

	it('marks identical ranges as covered with zero events', async () => {
		const { gh } = fakeGh({
			'/repos/Homebrew/homebrew-core/compare/A...A': { status: 'identical', commits: [] }
		});
		const events: GapEvent[] = [];
		const progress = { reached: null, diverged: false };
		await collectEvents(gh, core, 'A', 'A', events, progress);
		expect(events).toEqual([]);
		expect(progress.reached).toBe('A');
	});

	it('flags diverged bases so the caller can retry from the precomputed base', async () => {
		const { gh } = fakeGh({
			'/repos/Homebrew/homebrew-core/compare/stale...head': { status: 'diverged' }
		});
		const events: GapEvent[] = [];
		const progress = { reached: null, diverged: false };
		await collectEvents(gh, core, 'stale', 'head', events, progress);
		expect(progress.diverged).toBe(true);
		expect(progress.reached).toBeNull();
	});

	it('chunks at 75 commits when the gap is larger', async () => {
		const { shas, commits } = chain(160); // base..head inclusive = 160 commits
		const base = shas[0];
		const head = shas[159];
		const { gh, calls } = fakeGh({
			// top-level compare — too big for one chunk; anchor lands on shas[84]
			[`/repos/Homebrew/homebrew-core/compare/${base}...${head}`]: {
				status: 'ahead',
				commits: [...commits.values()]
			},
			// chunk 1: (shas[84], head]
			[`/repos/Homebrew/homebrew-core/compare/${shas[84]}...${head}`]: {
				status: 'ahead',
				commits: [commits.get(head)!],
				files: [{ status: 'added', filename: 'Formula/recent.rb' }]
			},
			// recursion: (base, shas[84]] still > 75 — anchor lands on shas[9]
			[`/repos/Homebrew/homebrew-core/compare/${base}...${shas[84]}`]: {
				status: 'ahead',
				commits: [...commits.values()].slice(0, 85)
			},
			// chunk 2: (shas[9], shas[84]]
			[`/repos/Homebrew/homebrew-core/compare/${shas[9]}...${shas[84]}`]: {
				status: 'ahead',
				commits: [commits.get(shas[84])!],
				files: [{ status: 'modified', filename: 'Formula/mid.rb' }]
			},
			// recursion: (base, shas[9]] fits one chunk
			[`/repos/Homebrew/homebrew-core/compare/${base}...${shas[9]}`]: {
				status: 'ahead',
				commits: [...commits.values()].slice(0, 10),
				files: [{ status: 'modified', filename: 'Formula/old.rb' }]
			}
		});
		const events: GapEvent[] = [];
		const progress = { reached: null, diverged: false };
		await collectEvents(gh, core, base, head, events, progress);
		expect(events.map((e) => e.n).sort()).toEqual(['mid', 'old', 'recent']);
		expect(progress.reached).toBe(base);
		expect(calls.length).toBe(5); // 2 range compares + 2 chunk compares + 1 leaf compare
	});

	it('keeps collected events and progress when the budget dies mid-way', async () => {
		const { shas, commits } = chain(160);
		const base = shas[0];
		const head = shas[159];
		const budget = new Budget(2); // dies after the chunk compare
		const realGh = makeGh(budget);
		let called = 0;
		const gh = (async (path: string) => {
			called++;
			budget.take();
			if (called === 1) {
				return { status: 'ahead', commits: [...commits.values()] };
			}
			return {
				status: 'ahead',
				commits: [commit(`x${called}`, null, '2026-10-08T14:00:00Z')],
				files: [{ status: 'added', filename: 'Formula/recent.rb' }]
			};
		}) as typeof realGh;
		const events: GapEvent[] = [];
		const progress = { reached: null, diverged: false };
		await expect(collectEvents(gh, core, base, head, events, progress)).rejects.toThrow(SyncAborted);
		expect(events).toEqual([{ n: 'recent', t: 'f', k: 'n', d: '2026-10-08' }]);
		expect(progress.reached).toBe(shas[84]); // resume point for the next visit
	});

	it('falls back to the commit listing when the compare response is truncated (head missing)', async () => {
		// 161 commits; the compare response drops `head` as if GitHub truncated
		// the 250-commit window — the parent-chain walk fails and the listing path kicks in.
		const { shas, commits } = chain(161);
		const base = shas[0];
		const head = shas[160];
		const descending = (from: number, to: number) =>
			Array.from({ length: from - to + 1 }, (_, i) => commits.get(shas[from - i])!);

		const { gh, calls } = fakeGh({
			// truncated: everything except head
			[`/repos/Homebrew/homebrew-core/compare/${base}...${head}`]: {
				status: 'ahead',
				commits: [...commits.values()].filter((c) => c.sha !== head)
			},
			// listing page 1: head..shas[61] (100 commits, none is base)
			[`/repos/Homebrew/homebrew-core/commits?sha=${head}&per_page=100`]: descending(160, 61),
			// listing page 2: shas[61]..shas[0] — ends at base
			[`/repos/Homebrew/homebrew-core/commits?sha=${shas[61]}&per_page=100`]: descending(61, 0),
			// chunk compares over the listed range (index 75 of the combined
			// newest-first listing = shas[85]; index 150 = shas[10])
			[`/repos/Homebrew/homebrew-core/compare/${shas[85]}...${head}`]: {
				status: 'ahead',
				commits: [commits.get(head)!],
				files: [{ status: 'added', filename: 'Formula/newest.rb' }]
			},
			[`/repos/Homebrew/homebrew-core/compare/${shas[10]}...${shas[85]}`]: {
				status: 'ahead',
				commits: [commits.get(shas[85])!],
				files: [{ status: 'modified', filename: 'Formula/middle.rb' }]
			},
			[`/repos/Homebrew/homebrew-core/compare/${base}...${shas[10]}`]: {
				status: 'ahead',
				commits: [commits.get(shas[10])!],
				files: [{ status: 'modified', filename: 'Formula/oldest.rb' }]
			}
		});

		const events: GapEvent[] = [];
		const progress = { reached: null, diverged: false };
		await collectEvents(gh, core, base, head, events, progress);
		expect(events.map((e) => e.n).sort()).toEqual(['middle', 'newest', 'oldest']);
		expect(progress.reached).toBe(base);
		expect(calls.length).toBe(6); // 1 compare + 2 listing pages + 3 chunk compares
	});
});
