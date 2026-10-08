<script lang="ts">
	import type { Item } from '#lib/types.ts';

	let {
		item,
		selected = false,
		onselect
	}: {
		item: Item;
		selected?: boolean;
		onselect: (item: Item) => void;
	} = $props();
</script>

<li class="row" class:selected data-key={item.t + '/' + item.n}>
	<button
		class="line"
		onclick={() => onselect(item)}
		aria-current={selected ? 'true' : undefined}
		title={item.desc || item.n}
	>
		<span class="date">{item.d}</span>
		<span class="name">{item.n}</span>
		<span class="summary">{item.desc}</span>
		<span class="type" class:cask={item.t === 'c'}>{item.t === 'c' ? 'cask' : 'formula'}</span>
		<span class="kind" class:new={item.k === 'n'}>{item.k === 'n' ? 'NEW' : 'UPD'}</span>
		<span class="version">{item.v || '—'}</span>
		{#if item.dep}<span class="dep-badge" title="deprecated or disabled">dep</span>{/if}
	</button>
</li>
