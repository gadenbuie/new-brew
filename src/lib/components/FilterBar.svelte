<script lang="ts">
	import type { Filter } from '#lib/types.ts';

	let {
		filter,
		counts,
		onfilter,
		oncaughtup
	}: {
		filter: Filter;
		counts: Record<Filter, number>;
		onfilter: (f: Filter) => void;
		oncaughtup: () => void;
	} = $props();

	const chips: { id: Filter; label: string }[] = [
		{ id: 'all', label: 'all' },
		{ id: 'casks', label: 'casks' },
		{ id: 'formulae', label: 'formulae' },
		{ id: 'new', label: 'new' },
		{ id: 'updated', label: 'updated' }
	];
</script>

<div class="filterbar" role="toolbar" aria-label="filters">
	{#each chips as c (c.id)}
		<button
			class="chip"
			class:active={filter === c.id}
			aria-pressed={filter === c.id}
			onclick={() => onfilter(c.id)}
		>
			[{c.label}]{#if c.id !== filter}&nbsp;<span class="cnt">{counts[c.id]}</span>{/if}
		</button>
	{/each}

	<span class="spacer"></span>

	<button class="caughtup" onclick={oncaughtup} title="mark everything seen; window resets to now">
		⌂ caught up
	</button>
</div>
