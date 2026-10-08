<script lang="ts">
	import CopyBtn from './CopyBtn.svelte';
	import { brewPageUrl, cachedPkg, fetchPkg, type PkgDetail } from '#lib/pkgs.ts';
	import type { Item } from '#lib/types.ts';

	let {
		item,
		pinned,
		current = false,
		onpin
	}: {
		item: Item;
		pinned: boolean;
		current?: boolean;
		onpin: () => void;
	} = $props();

	const install = $derived(`brew install ${item.t === 'c' ? '--cask ' : ''}${item.n}`);

	let detail = $state<PkgDetail | null>(null);
	let loading = $state(false);
	let error = $state(false);

	// Fetch (via the session cache) whenever the card switches packages.
	// Already-viewed packages render synchronously from the cache — no
	// "fetching…" flicker on revisit. Fresh ones debounce 120ms so scanning
	// with j/k doesn't machine-gun the API.
	let timer: ReturnType<typeof setTimeout> | undefined;
	let dead = false;
	$effect(() => {
		void item.t;
		void item.n;
		clearTimeout(timer);
		const hit = cachedPkg(item.t, item.n);
		if (hit) {
			dead = true; // any in-flight fetch for the previous package is moot
			detail = hit;
			loading = false;
			error = false;
			return;
		}
		dead = false;
		loading = true;
		error = false;
		detail = null;
		timer = setTimeout(() => {
			fetchPkg(item.t, item.n)
				.then((d) => {
					if (!dead) detail = d;
				})
				.catch(() => {
					if (!dead) error = true;
				})
				.finally(() => {
					if (!dead) loading = false;
				});
		}, 120);
		return () => {
			dead = true;
			clearTimeout(timer);
		};
	});

	/** Cap long lists (e.g. ffmpeg's dependency tree) for scanability. */
	function capList(list: string[] | undefined, max: number): string | undefined {
		if (!list?.length) return undefined;
		return list.length > max ? `${list.slice(0, max).join(' ')} … +${list.length - max}` : list.join(' ');
	}

	const rows = $derived.by(() => {
		const d = detail;
		if (!d) return [];
		const rows: [string, string, string?][] = [];
		if (d.version) rows.push(['version', d.version]);
		if (d.license) rows.push(['license', d.license]);
		if (d.kind === 'formula') {
			const deps = capList(d.deps, 12);
			if (deps) rows.push(['deps', deps]);
		} else {
			const apps = capList(d.apps, 4);
			if (apps) rows.push(['installs', apps]);
			const binaries = capList(d.binaries, 4);
			if (binaries) rows.push(['binaries', binaries]);
			if (d.macosReq) rows.push(['requires', d.macosReq]);
			if (d.archReq) rows.push(['arch', d.archReq]);
			if (d.autoUpdates) rows.push(['updates', 'automatic']);
		}
		if (d.tap) rows.push(['tap', d.tap]);
		// row context lives in the table, not the header — keeps the header a
		// stable name + pin affordance that can't wrap
		rows.push(['type', item.t === 'c' ? 'cask' : 'formula']);
		rows.push([
			'status',
			`${item.k === 'n' ? 'new' : 'updated'} · ${item.d}`,
			item.k === 'n' ? 'new' : undefined
		]);
		return rows;
	});
</script>

<article class="card" class:current aria-label="package details">
	<header class="card-head">
		<h2>{item.n}</h2>
		<button class="pin" onclick={onpin} aria-pressed={pinned} title="p">
			{pinned ? '[unpin]' : '[pin]'}
		</button>
	</header>

	{#if loading}
		<p class="card-state">fetching…</p>
	{:else if error}
		<p class="card-state">
			couldn't load full details — <a href={brewPageUrl(item.t, item.n)} target="_blank"
				rel="noreferrer">open on brew.sh</a> instead.
		</p>
	{:else if detail}
		{#if detail.display}<p class="card-display">{detail.display}</p>{/if}
		<p class="card-desc">
			{#if detail.desc}{detail.desc}{:else}<span class="dim">no description</span>{/if}
		</p>

		{#if detail.deprecated || detail.disabled}
			<p class="card-warn">
				! {detail.disabled ? 'disabled' : 'deprecated'}
				{#if detail.deprecationReason}— {detail.deprecationReason}{/if}
			</p>
		{/if}

		<dl class="card-rows">
			{#each rows as [label, value, cls] (label)}
				<div class="row2">
					<dt>{label}</dt>
					<dd class={cls}>{value}</dd>
				</div>
			{/each}
		</dl>

		<div class="card-install">
			<code class="install">{install}</code>
			<CopyBtn text={install} />
		</div>

		{#if detail.caveats}
			<pre class="card-caveats">{detail.caveats}</pre>
		{/if}

		<footer class="card-links">
			{#if detail.homepage || item.url}
				<a href={detail.homepage || item.url} target="_blank" rel="noreferrer">↗ project site</a>
			{/if}
			<a href={brewPageUrl(item.t, item.n)} target="_blank" rel="noreferrer">↗ brew.sh page</a>
		</footer>
	{/if}
</article>
