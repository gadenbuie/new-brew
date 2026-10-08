<script lang="ts">
	import FilterBar from '#lib/components/FilterBar.svelte';
	import PkgCard from '#lib/components/PkgCard.svelte';
	import Row from '#lib/components/Row.svelte';
	import SincePicker from '#lib/components/SincePicker.svelte';
	import { data } from '#lib/data.svelte.ts';
	import { brewPageUrl } from '#lib/pkgs.ts';
	import { ui } from '#lib/state.svelte.ts';
	import type { Filter, Item } from '#lib/types.ts';
	import { isoDate, type SinceMode } from '#lib/window.ts';

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
			casks: base.filter((i) => i.t === 'c').length,
			formulae: base.filter((i) => i.t === 'f').length,
			new: base.filter((i) => i.k === 'n').length,
			updated: base.filter((i) => i.k === 'u').length
		} satisfies Record<Filter, number>;
	});

	/** The visible timeline: window + chip toggles + search. Empty chip groups
	 * pass both members; an activated chip excludes its group partner until
	 * that partner is activated too. */
	const visible = $derived.by(() => {
		const q = ui.query.trim().toLowerCase();
		return inWindow.filter((it) => {
			if (q && !it.n.toLowerCase().includes(q) && !it.desc.toLowerCase().includes(q)) {
				return false;
			}
			if (ui.activeTypes.length && !ui.activeTypes.includes(it.t)) return false;
			if (ui.activeKinds.length && !ui.activeKinds.includes(it.k)) return false;
			return true;
		});
	});

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

	/** Below the two-column breakpoint the sidebar lives offcanvas. */
	const narrowMq = typeof window === 'undefined' ? undefined : window.matchMedia('(max-width: 1080px)');
	function isNarrow(): boolean {
		return narrowMq?.matches ?? false;
	}

	/** Row click: select; on narrow screens also open the sidebar offcanvas. */
	function onselectRow(item: Item): void {
		ui.selected = visible.indexOf(item);
		if (isNarrow()) ui.offcanvasOpen = true;
	}

	/** The row the sidebar's current card follows. */
	const current = $derived(visible[ui.selected] ?? null);

	/** Pinned cards other than the current row's (which already shows first). */
	const pinnedCards = $derived(
		current ? ui.pinned.filter((p) => keyOf(p) !== keyOf(current)) : ui.pinned
	);

	function scrollToSelection(): void {
		const item = visible[ui.selected];
		if (!item) return;
		document
			.querySelector(`li[data-key="${CSS.escape(keyOf(item))}"]`)
			?.scrollIntoView({ block: 'nearest' });
	}

	/** Calendar bounds for the since picker: retention floor .. today. */
	const sinceMin = $derived(
		isoDate(new Date(Date.now() - data.retentionDays * 86_400_000))
	);
	const sinceMax = $derived(isoDate(new Date()));

	/** Open every pinned row's page (homepage first, brew.sh as fallback). */
	function openPinned(): void {
		for (const item of ui.pinned) {
			window.open(item.url || brewPageUrl(item.t, item.n), '_blank', 'noopener');
		}
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
			// preventDefault keeps native search-input Esc (which clears the field)
			// from firing alongside the intended step-by-step chain.
			e.preventDefault();
			if (ui.pickerOpen) {
				ui.pickerOpen = false;
				return;
			}
			if (ui.offcanvasOpen) {
				ui.offcanvasOpen = false;
				return;
			}
			if (inInput && ui.query) {
				ui.query = '';
				return;
			}
			if (inInput) searchEl?.blur();
			return;
		}
		if (inInput) return;

		// `p` pins (or unpins) the selected row for the session.
		if ((e.key === 'p' || e.key === 'P') && visible[ui.selected]) {
			e.preventDefault();
			ui.togglePin(visible[ui.selected]);
			return;
		}

		// `o` opens the selected row's homepage in a new tab (falling back to
		// its brew.sh page when the dataset has no URL for it); `O` goes
		// straight to brew.sh. `⌘/ctrl + shift + O` opens every pinned row at
		// once (homepage first, brew.sh as fallback) — checked before the plain
		// `o`/`O` branch, which would otherwise match the same key.
		if (e.key === 'O' && (e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			openPinned();
			return;
		}
		if (e.key === 'o' || e.key === 'O') {
			const item = visible[ui.selected];
			if (item) {
				e.preventDefault();
				const url = e.key === 'o' ? item.url || brewPageUrl(item.t, item.n) : brewPageUrl(item.t, item.n);
				window.open(url, '_blank', 'noopener');
			}
			return;
		}

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
			// On narrow screens Enter/Space opens the sidebar offcanvas for the
			// selected row; on wide screens the card already follows the selection.
			if (visible[ui.selected] && isNarrow()) {
				e.preventDefault();
				ui.offcanvasOpen = true;
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
<div class="main">
	<header class="header">
		<h1>new brew</h1>
		<span class="meta">
			<SincePicker
				mode={ui.sinceMode}
				custom={ui.sinceCustom}
				autoLabel={sinceLabel}
				minIso={sinceMin}
				maxIso={sinceMax}
				open={ui.pickerOpen}
				ontoggle={() => (ui.pickerOpen = !ui.pickerOpen)}
				onpick={(m: SinceMode) => ui.setSince(m)}
				oncustom={(iso: string) => {
					ui.sinceCustom = iso;
					ui.sinceMode = 'custom';
				}}
				onclose={() => (ui.pickerOpen = false)}
			/> · <span aria-live="polite">{visible.length}
			{visible.length === 1 ? 'package' : 'packages'}</span>{#if updatedLabel} · updated {updatedLabel}{/if}
		</span>
		<button
			class="theme-toggle"
			onclick={() => ui.cycleTheme()}
			title="theme — cycles light / dark / system"
		>
			[{ui.theme}]
		</button>
	</header>
	{#if ui.sinceMode === 'auto' && ui.firstVisit}
		<p class="notes" aria-live="polite">first visit — showing the last 7 days. press <b>⌂ caught up</b> when you're done.</p>
	{:else if ui.capped}
		<p class="notes" aria-live="polite">only the last {data.retentionDays} days of data are kept.</p>
	{/if}
	{#if asOfLabel}
		<p class="notes" aria-live="polite">live sync paused — showing data as of {asOfLabel} (reload to retry)</p>
	{/if}
	{#if data.syncing}
		<p class="notes" aria-live="polite">syncing latest changes…</p>
	{/if}

	<div class="rule" aria-hidden="true">{rule}</div>

	<FilterBar
		activeTypes={ui.activeTypes}
		activeKinds={ui.activeKinds}
		{counts}
		ontoggletype={(t) => ui.toggleType(t)}
		ontogglekind={(k) => ui.toggleKind(k)}
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

	<div class="list-scroll">
		{#if data.loading}
			<p class="state">loading packages…</p>
		{:else if data.failed}
			<p class="state">
				couldn't load the package data — <button class="retry" onclick={() => location.reload()}>reload</button> to try
				again, or check your connection if it keeps failing.
			</p>
		{:else if visible.length === 0}
			<p class="state">
				{#if data.items.length === 0}
					no data yet — packages appear after the first data sync.
				{:else if ui.query}
					nothing matches “{ui.query}” — try <kbd>esc</kbd> to clear the filter.
				{:else if ui.activeTypes.length || ui.activeKinds.length}
					<span class="ok">✓ nothing in this window matches the current filters.</span>
					clear one to widen the view, or check back later.
				{:else}
					<span class="ok caughtup-line">✓ all caught up</span><span class="ok caughtup-rest">{#if sinceLabel}{' — nothing new since '}{sinceLabel}{/if}.</span>
					new changes arrive as homebrew taps move; press <b>⌂ caught up</b> to reset the
					window to now.
				{/if}
			</p>
		{:else}
			<ul class="list" aria-label="package timeline">
				{#each visible as item, i (item.t + '/' + item.n)}
					<Row {item} selected={ui.selected === i} onselect={onselectRow} />
				{/each}
			</ul>
		{/if}
	</div>

	<p class="footer">
		<span class="kbd-hints">j/k move · p pin/unpin · o homepage · O brew.sh · ⌘⇧O pinned · / filter · esc close · </span><span class="touch-hints">tap a row for details · pin from its card · </span><a href="https://github.com/gadenbuie/new-brew">source</a>
	</p>
</div>

<div class="panel-slot">
	<aside class="sidebar" class:open={ui.offcanvasOpen} aria-label="package details">
		<div class="sidebar-head">
			details{#if ui.pinned.length} · {ui.pinned.length} pinned{/if}
			<span class="spacer"></span>
			<!-- always rendered (hidden while empty) so the first pin never shifts
			 the header — and every card under it — by the button's height -->
			<button
				class="open-all"
				class:off={!ui.pinned.length}
				onclick={openPinned}
				title="⌘⇧O — open every pinned page in a new tab"
			>
				[open all]
			</button>
			<button class="close" onclick={() => (ui.offcanvasOpen = false)} aria-label="close details">
				[x]
			</button>
		</div>
		{#if current}
			<!-- the current card stays in place when pinned — pinning only changes
			 the card's state, never the order -->
			<PkgCard
				item={current}
				current
				pinned={ui.isPinned(current)}
				onpin={() => ui.togglePin(current)}
			/>
		{/if}
		{#each pinnedCards as p (p.t + '/' + p.n)}
			<PkgCard item={p} pinned onpin={() => ui.togglePin(p)} />
		{/each}
		{#if !current && ui.pinned.length === 0}
			<p class="sidebar-empty">
				click a row (or j/k) to see its details here — pin what you want to revisit (p) and it
				stays for the session.
			</p>
		{/if}
	</aside>
	<div class="backdrop" class:open={ui.offcanvasOpen} aria-hidden="true" onclick={() => (ui.offcanvasOpen = false)}></div>
</div>
</div>
