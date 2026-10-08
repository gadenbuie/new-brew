import type { PkgType } from './types';

/**
 * Per-package details from the public Homebrew API
 * (`formulae.brew.sh/api/{formula|cask}/{name}.json` — CORS open, ~4 KB
 * payloads, served from a CDN with a 10-minute cache). Fetched in the
 * browser when the full-detail panel opens; cached in-memory per session.
 */

export interface PkgDetail {
	/** package name / cask token */
	name: string;
	/** full display name (cask) */
	display?: string;
	kind: 'formula' | 'cask';
	tap: string;
	desc: string;
	homepage: string;
	/** stable version (formula) / version (cask) */
	version: string;
	/** formula only */
	license?: string;
	deps?: string[];
	/** cask only */
	apps?: string[];
	binaries?: string[];
	macosReq?: string;
	archReq?: string;
	autoUpdates?: boolean;
	caveats?: string;
	deprecated: boolean;
	disabled: boolean;
	deprecationReason?: string;
}

/** The brew.sh page URL for a package (fallback link when the API fails). */
export function brewPageUrl(t: PkgType, n: string): string {
	// NB: formulae.brew.sh 404s on a trailing slash — no final '/' here.
	return `https://formulae.brew.sh/${t === 'c' ? 'cask' : 'formula'}/${n}`;
}

const API = 'https://formulae.brew.sh/api';

function pkgUrl(t: PkgType, n: string): string {
	return `${API}/${t === 'c' ? 'cask' : 'formula'}/${n}.json`;
}

/** Promise-level cache: in-flight requests dedupe and successes persist per session. */
const cache = new Map<string, Promise<PkgDetail>>();

export function fetchPkg(t: PkgType, n: string): Promise<PkgDetail> {
	const key = `${t}/${n}`;
	const hit = cache.get(key);
	if (hit) return hit;
	const p = load(t, n).catch((err) => {
		cache.delete(key); // failed lookups are retryable
		throw err;
	});
	cache.set(key, p);
	return p;
}

async function load(t: PkgType, n: string): Promise<PkgDetail> {
	const res = await fetch(pkgUrl(t, n));
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const d = await res.json();
	return t === 'f' ? fromFormula(d) : fromCask(d);
}

function fmtLicense(license: unknown): string | undefined {
	if (typeof license === 'string') return license;
	if (Array.isArray(license)) {
		return license
			.map((l) => (typeof l === 'string' ? l : (l?.spdx ?? l?.name ?? '')))
			.filter(Boolean)
			.join(', ');
	}
	return undefined;
}

function fromFormula(d: Record<string, any>): PkgDetail {
	return {
		name: d.name,
		kind: 'formula',
		tap: d.tap ?? 'homebrew/core',
		desc: d.desc ?? '',
		homepage: d.homepage ?? '',
		version: d.versions?.stable ?? '',
		license: fmtLicense(d.license),
		deps: d.dependencies ?? [],
		caveats: d.caveats || undefined,
		deprecated: Boolean(d.deprecated),
		disabled: Boolean(d.disabled),
		deprecationReason: d.deprecation_reason
	};
}

/** `{"macos": {">=": ["13"]}}` → "macOS 13+". */
function fmtMacos(macos: unknown): string | undefined {
	if (!macos || typeof macos === 'string') return typeof macos === 'string' ? `macOS ${macos}` : undefined;
	const entries = Object.entries(macos as Record<string, unknown>);
	const parts: string[] = [];
	for (const [op, val] of entries) {
		const versions = Array.isArray(val) ? val.join(' or ') : String(val);
		parts.push(`macOS ${versions}${op === '>=' ? '+' : ` ${op}`.trim()}`);
	}
	return parts.join(', ') || undefined;
}

/**
 * `depends_on.arch` arrives as a string, an array of strings or of
 * objects (`[{ type: 'arm', bits: 64 }]`), or occasionally an object —
 * render any of them compactly.
 */
function fmtArch(arch: unknown): string | undefined {
	if (!arch) return undefined;
	const one = (a: unknown): string => {
		if (typeof a === 'string') return a;
		if (a && typeof a === 'object') {
			const { type, bits } = a as Record<string, unknown>;
			return `${type ?? ''}${bits ? ` ${bits}-bit` : ''}`.trim();
		}
		return '';
	};
	const parts = (Array.isArray(arch) ? arch : [arch]).map(one).filter(Boolean);
	return parts.length ? parts.join(' or ') : undefined;
}

function fromCask(d: Record<string, any>): PkgDetail {
	const apps: string[] = [];
	const binaries: string[] = [];
	for (const art of d.artifacts ?? []) {
		if (Array.isArray(art?.app)) apps.push(...art.app);
		if (Array.isArray(art?.binary)) binaries.push(...art.binary);
	}
	return {
		name: d.token,
		display: d.name?.length ? d.name.join(' / ') : undefined,
		kind: 'cask',
		tap: d.tap ?? 'homebrew/cask',
		desc: d.desc ?? '',
		homepage: d.homepage ?? '',
		version: d.version ?? '',
		apps,
		binaries,
		macosReq: fmtMacos(d.depends_on?.macos),
		archReq: fmtArch(d.depends_on?.arch),
		autoUpdates: Boolean(d.auto_updates),
		caveats: d.caveats || undefined,
		deprecated: Boolean(d.deprecated),
		disabled: Boolean(d.disabled),
		deprecationReason: d.deprecation_reason
	};
}
