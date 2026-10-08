<script lang="ts">
	import type { Filter, Kind, PkgType } from '#lib/types.ts';

	let {
		activeTypes,
		activeKinds,
		counts,
		ontoggletype,
		ontogglekind,
		oncaughtup
	}: {
		/** empty = both types pass */
		activeTypes: PkgType[];
		/** empty = both kinds pass */
		activeKinds: Kind[];
		counts: Record<Filter, number>;
		ontoggletype: (t: PkgType) => void;
		ontogglekind: (k: Kind) => void;
		oncaughtup: () => void;
	} = $props();

	const typeChips: { t: PkgType; label: string }[] = [
		{ t: 'c', label: 'casks' },
		{ t: 'f', label: 'formulae' }
	];
	const kindChips: { k: Kind; label: string }[] = [
		{ k: 'n', label: 'new' },
		{ k: 'u', label: 'updated' }
	];
</script>

<!-- Each group toggles independently: activating one member excludes the
     other until it's also activated; an all-unset group passes both. -->
<div class="filterbar" role="toolbar" aria-label="filters">
	{#each typeChips as c (c.t)}
		<button
			class="chip"
			class:active={activeTypes.includes(c.t)}
			aria-pressed={activeTypes.includes(c.t)}
			onclick={() => ontoggletype(c.t)}
		>
			[{c.label}]&nbsp;<span class="cnt">{counts[c.t === 'c' ? 'casks' : 'formulae']}</span>
		</button>
	{/each}
	{#each kindChips as c (c.k)}
		<button
			class="chip"
			class:active={activeKinds.includes(c.k)}
			aria-pressed={activeKinds.includes(c.k)}
			onclick={() => ontogglekind(c.k)}
		>
			[{c.label}]&nbsp;<span class="cnt">{counts[c.k === 'n' ? 'new' : 'updated']}</span>
		</button>
	{/each}

	<span class="spacer"></span>

	<button class="caughtup" onclick={oncaughtup} title="mark everything seen; window resets to now">
		⌂ caught up
	</button>
</div>
