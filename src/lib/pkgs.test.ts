import { afterEach, describe, expect, it, vi } from 'vitest';
import { brewPageUrl, fetchPkg } from './pkgs';

const realFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = realFetch;
	vi.restoreAllMocks();
});

function stubFetch(json: unknown, ok = true) {
	return vi.fn(async () =>
		ok
			? new Response(JSON.stringify(json), { status: 200, headers: { 'content-type': 'application/json' } })
			: new Response('nope', { status: 404 })
	) as unknown as typeof fetch;
}

describe('brewPageUrl', () => {
	it('builds formula and cask URLs', () => {
		expect(brewPageUrl('f', 'ripgrep')).toBe('https://formulae.brew.sh/formula/ripgrep/');
		expect(brewPageUrl('c', 'ghostty')).toBe('https://formulae.brew.sh/cask/ghostty/');
	});
});

describe('fetchPkg', () => {
	it('maps formula JSON to PkgDetail', async () => {
		globalThis.fetch = stubFetch({
			name: 'ripgrep',
			tap: 'homebrew/core',
			desc: 'Search tool',
			homepage: 'https://x',
			versions: { stable: '15.2.0' },
			license: 'MIT',
			dependencies: ['pcre2'],
			deprecated: false
		});
		const d = await fetchPkg('f', 'ripgrep');
		expect(d).toMatchObject({
			name: 'ripgrep',
			kind: 'formula',
			version: '15.2.0',
			license: 'MIT',
			deps: ['pcre2'],
			deprecated: false
		});
	});

	it('maps cask JSON — apps, binaries, macOS requirement, display name', async () => {
		globalThis.fetch = stubFetch({
			token: 'ghostty',
			name: ['Ghostty'],
			desc: 'Terminal',
			homepage: 'https://ghostty.org',
			version: '1.3.1',
			auto_updates: true,
			depends_on: { macos: { '>=': ['13'] } },
			artifacts: [{ app: ['Ghostty.app'], target: '/Applications/Ghostty.app' }, { binary: ['ghostty'] }],
			deprecated: false
		});
		const d = await fetchPkg('c', 'ghostty-test');
		expect(d.kind).toBe('cask');
		expect(d.display).toBe('Ghostty');
		expect(d.apps).toEqual(['Ghostty.app']);
		expect(d.binaries).toEqual(['ghostty']);
		expect(d.macosReq).toBe('macOS 13+');
		expect(d.autoUpdates).toBe(true);
	});

	it('handles array licenses (formula) and string macOS requirements (cask)', async () => {
		globalThis.fetch = stubFetch({
			name: 'lic-test',
			license: [{ spdx: 'MIT' }, { spdx: 'Apache-2.0' }]
		});
		const f = await fetchPkg('f', 'lic-test');
		expect(f.license).toBe('MIT, Apache-2.0');

		globalThis.fetch = stubFetch({
			token: 'ventura-cask',
			name: [],
			depends_on: { macos: 'ventura' }
		});
		const c = await fetchPkg('c', 'ventura-cask');
		expect(c.macosReq).toBe('macOS ventura');
	});

	it('caches per session — one fetch for repeated lookups', async () => {
		const f = stubFetch({ name: 'once', token: undefined, desc: '' });
		globalThis.fetch = f;
		await fetchPkg('f', 'cached-pkg');
		await fetchPkg('f', 'cached-pkg');
		expect(f).toHaveBeenCalledTimes(1);
	});

	it('failed lookups are retryable (not cached)', async () => {
		const f = stubFetch({}, false);
		globalThis.fetch = f;
		await expect(fetchPkg('f', 'flaky')).rejects.toThrow('HTTP 404');
		await expect(fetchPkg('f', 'flaky')).rejects.toThrow('HTTP 404');
		expect(f).toHaveBeenCalledTimes(2);
	});

	it('does not share cache between formula and cask of the same name', async () => {
		const formulaStub = stubFetch({ name: 'dual', desc: '' });
		globalThis.fetch = formulaStub;
		await fetchPkg('f', 'dual');
		expect(formulaStub).toHaveBeenCalledTimes(1);

		const caskStub = stubFetch({ token: 'dual', name: [], desc: '' });
		globalThis.fetch = caskStub;
		const c = await fetchPkg('c', 'dual');
		// if the cache wrongly shared keys across kinds, this stub would never run
		expect(caskStub).toHaveBeenCalledTimes(1);
		expect(c.kind).toBe('cask');
	});
});
