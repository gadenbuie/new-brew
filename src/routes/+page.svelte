<script lang="ts">
	import Detail from '#lib/components/Detail.svelte';
	import FilterBar from '#lib/components/FilterBar.svelte';
	import Row from '#lib/components/Row.svelte';
	import { data } from '#lib/data.svelte.ts';
	import { ui } from '#lib/state.svelte.ts';
	import type { Filter, Item } from '#lib/types.ts';

	const rule = '─'.repeat(200);

	// Bootstrapping — effects only run in the browser, so the prerendered
	// shell stays static and the client hydrates into the live dataset.
	$effect(() => {
		void data.init();
		ui.init();
	});
	$effect(() => {
		ui.refreshWindow(data.retentionDays);
	});

	/** Items inside the visit window (and the dataset's retention floor). */
	const inWindow = $derived.by(() => {
		const start = ui.windowStartIso;
		if (!start) return [] as Item[];
		const floor = new Date(Date.now() - data.retentionDays * 86_400_000).toISOString().slice(0, 10);
		return data.items.filter((it) => it.d >= start && it.d >= floor);
	});

	/** Per-chip counts over the windowed (but not chip-filtered) items. */
	const counts = $derived.by(() => {
		const q = ui.query.trim().toLowerCase();
		const base = inWindow.filter(
			(it) => !q || it.n.toLowerCase().includes(q) || it.desc.toLowerCase().includes(q)
		);
		return {
			all: base.length,
			casks: base.filter((i) => i.t === 'c').length,
			formulae: base.filter((i) => i.t === 'f').length,
			new: base.filter((i) => i.k === 'n').length,
			updated: base.filter((i) => i.k === 'u').length
		} satisfies Record<Filter, number>;
	});

	/** The visible timeline: window + chip filter + search. */
	const visible = $derived(
		inWindow.filter((it) => {
			if (ui.filter === 'casks' && it.t !== 'c') return false;
			if (ui.filter === 'formulae' && it.t !== 'f') return false;
			if (ui.filter === 'new' && it.k !== 'n') return false;
			if (ui.filter === 'updated' && it.k !== 'u') return false;
			return true;
		})
	);

	// Keep the keyboard selection in range as filters shrink the list.
	$effect(() => {
		void visible.length;
		if (ui.selected >= visible.length) ui.selected = Math.max(0, visible.length - 1);
	});

	const sinceLabel = $derived.by(() => {
		if (!ui.windowStart) return '';
		return ui.windowStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	});

	const updatedLabel = $derived.by(() => {
		if (!data.generatedAt) return '';
		const d = new Date(data.generatedAt);
		if (Number.isNaN(d.getTime())) return '';
		return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
	});

	const asOfLabel = $derived.by(() => {
		if (!data.asOf) return '';
		const d = new Date(data.asOf);
		if (Number.isNaN(d.getTime())) return '';
		return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
	});

	let searchEl: HTMLInputElement | undefined = $state();

	function keyOf(item: Item): string {
		return `${item.t}/${item.n}`;
	}

	function toggle(item: Item): void {
		const key = keyOf(item);
		ui.selected = visible.indexOf(item);
		ui.expanded = ui.expanded === key ? null : key;
	}

	function scrollToSelection(): void {
		const item = visible[ui.selected];
		if (!item) return;
		document
			.querySelector(`li[data-key="${CSS.escape(keyOf(item))}"]`)
			?.scrollIntoView({ block: 'nearest' });
	}

	function onkeydown(e: KeyboardEvent): void {
		const target = e.target as HTMLElement | null;
		const inInput = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA';

		if (e.key === '/' && !inInput) {
			e.preventDefault();
			searchEl?.focus();
			return;
		}
		if (e.key === 'Escape') {
			if (inInput && ui.query) {
				ui.query = '';
				return;
			}
			if (ui.expanded) {
				ui.expanded = null;
				return;
			}
			if (inInput) searchEl?.blur();
			return;
		}
		if (inInput) return;

		// Let Enter/Space activate a focused button or link (row toggles, chips,
		// copy…) — the native click already does the right thing.
		const tag = target?.tagName;
		if ((e.key === 'Enter' || e.key === ' ') && (tag === 'BUTTON' || tag === 'A')) return;

		if (e.key === 'j' || e.key === 'ArrowDown') {
			e.preventDefault();
			if (ui.selected < visible.length - 1) {
				ui.selected++;
				scrollToSelection();
			}
		} else if (e.key === 'k' || e.key === 'ArrowUp') {
			e.preventDefault();
			if (ui.selected > 0) {
				ui.selected--;
				scrollToSelection();
			}
		} else if (e.key === 'Enter' || e.key === ' ') {
			const item = visible[ui.selected];
			if (item) {
				e.preventDefault();
				toggle(item);
			}
		}
	}
</script>

<svelte:window onkeydown={onkeydown} />

<svelte:head>
	<title>new brew</title>
	<meta
		name="description"
		content="New and updated Homebrew packages since your last visit."
	/>
</svelte:head>

<div class="shell">
	<header class="header">
		<h1>new brew</h1>
		<span class="meta">
			{#if sinceLabel}since {sinceLabel} · {/if}{visible.length}
			{visible.length === 1 ? 'package' : 'packages'}{#if updatedLabel} · updated {updatedLabel}{/if}
		</span>
	</header>
	{#if ui.firstVisit}
		<p class="notes">first visit — showing the last 7 days. press <b>⌂ caught up</b> when you're done.</p>
	{:else if ui.capped}
		<p class="notes">only the last {data.retentionDays} days of data are kept.</p>
	{/if}
	{#if asOfLabel}
		<p class="notes">live sync paused — showing data as of {asOfLabel}</p>
	{/if}
	{#if data.syncing}
		<p class="notes">syncing…</p>
	{/if}

	<div class="rule" aria-hidden="true">{rule}</div>

	<FilterBar
		filter={ui.filter}
		{counts}
		onfilter={(f) => ui.setFilter(f)}
		oncaughtup={() => ui.markCaughtUp(data.retentionDays)}
	/>
	<input
		class="search"
		type="search"
		placeholder="/ to filter — type a name"
		bind:this={searchEl}
		bind:value={ui.query}
		aria-label="filter packages by name or description"
		oninput={() => (ui.selected = 0)}
	/>

	<div class="rule" aria-hidden="true">{rule}</div>

	{#if data.loading}
		<p class="state">loading…</p>
	{:else if data.failed}
		<p class="state">
			couldn't load data. <button class="retry" onclick={() => location.reload()}>reload</button> to retry.
		</p>
	{:else if visible.length === 0}
		<p class="state">
			{#if data.items.length === 0}
				no data yet — the scheduled job fills in <code>data/changes.json</code> soon.
			{:else if ui.query}
				nothing matches “{ui.query}” — try <kbd>esc</kbd> to clear the filter.
			{:else}
				<span class="ok">✓ all caught up{#if sinceLabel} since {sinceLabel}{/if}.</span> new
				changes appear as homebrew taps move — check back later or press <b>⌂ caught up</b>.
			{/if}
		</p>
	{:else}
		<ul class="list" aria-label="package timeline">
			{#each visible as item, i (item.t + '/' + item.n)}
				<Row
					{item}
					expanded={ui.expanded === item.t + '/' + item.n}
					selected={ui.selected === i}
					ontoggle={() => toggle(item)}
				/>
			{/each}
		</ul>
	{/if}

	<p class="footer">
		j/k move · enter expand · / filter · esc collapse · data: homebrew-core + homebrew-cask git
		history, refreshed 3× daily
	</p>
</div>
