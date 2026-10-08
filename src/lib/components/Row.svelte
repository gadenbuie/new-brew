<script lang="ts">
	import Detail from './Detail.svelte';
	import type { Item } from '#lib/types.ts';

	let {
		item,
		expanded = false,
		selected = false,
		ontoggle,
		onopen
	}: {
		item: Item;
		expanded?: boolean;
		selected?: boolean;
		ontoggle: () => void;
		onopen: () => void;
	} = $props();
</script>

<li class="row" class:selected data-key={item.t + '/' + item.n}>
	<button
		class="line"
		onclick={ontoggle}
		aria-expanded={expanded}
		title={item.desc || item.n}
	>
		<span class="marker" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
		<span class="date">{item.d}</span>
		<span class="name">{item.n}</span>
		<span class="type" class:cask={item.t === 'c'}>{item.t === 'c' ? 'cask' : 'formula'}</span>
		<span class="kind" class:new={item.k === 'n'}>{item.k === 'n' ? 'NEW' : 'UPD'}</span>
		<span class="version">{item.v || '—'}</span>
		{#if item.dep}<span class="dep-badge" title="deprecated or disabled">dep</span>{/if}
	</button>
	{#if expanded}<Detail {item} {onopen} />{/if}
</li>
