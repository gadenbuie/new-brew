/** Shared types for the new-brew dataset. */

/** Package type: `f` formula, `c` cask. */
export type PkgType = 'f' | 'c';

/** Change kind: `n` new (added in window), `u` updated. */
export type Kind = 'n' | 'u';

/** One row in the timeline — exact on-the-wire schema of changes.json items. */
export interface Item {
	/** package name / cask token */
	n: string;
	/** formula or cask */
	t: PkgType;
	/** new or updated */
	k: Kind;
	/** date of most recent change, YYYY-MM-DD */
	d: string;
	/**
	 * UTC ISO 8601 timestamp of the most recent change (committer time) —
	 * precise ordering. Absent in datasets/cache rows from before this field
	 * existed; sort code falls back to `d` at UTC midnight.
	 */
	ts?: string;
	/** current stable version ('' when unknown, e.g. gap-fill only rows) */
	v: string;
	/** short description */
	desc: string;
	/** project homepage */
	url: string;
	/** deprecated or disabled */
	dep: boolean;
}

/** The precomputed changes.json document. */
export interface Dataset {
	generated_at: string;
	retention_days: number;
	core_head_sha: string;
	cask_head_sha: string;
	items: Item[];
}

/** Identity of a changes.json generation: if this changes, a new Action run landed. */
export interface DatasetIdentity {
	generated_at: string;
	core_head_sha: string;
	cask_head_sha: string;
}

/** localStorage cache of the last successful sync. */
export interface CacheRecord {
	v: 1;
	/** the changes.json generation this cache was built from */
	identity: DatasetIdentity;
	retentionDays: number;
	/** tap HEAD sha actually gap-filled to, per repo — null if that repo never completed */
	synced: { core: string | null; cask: string | null };
	/** oldest sha whose newer commits were fully processed when a sync bailed mid-way */
	partial: { core: string | null; cask: string | null };
	items: Item[];
}

/** Scope filter chips. */
export type Filter = 'all' | 'casks' | 'formulae' | 'new' | 'updated';
