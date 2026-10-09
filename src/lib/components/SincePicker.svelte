<script lang="ts">
	import type { SinceMode } from '#lib/window.ts';

	let {
		mode,
		custom,
		autoLabel,
		minIso,
		maxIso,
		open,
		ontoggle,
		onpick,
		oncustom,
		onclose
	}: {
		mode: SinceMode;
		custom: string;
		autoLabel: string;
		minIso: string;
		maxIso: string;
		open: boolean;
		ontoggle: () => void;
		onpick: (mode: SinceMode) => void;
		oncustom: (iso: string) => void;
		onclose: () => void;
	} = $props();

	const presets: { id: SinceMode; label: string }[] = [
		{ id: 'auto', label: 'last visit' },
		{ id: 'yesterday', label: 'yesterday' },
		{ id: 'week', label: 'this week' },
		{ id: '30d', label: '30 days' }
	];

	const triggerLabel = $derived.by(() => {
		if (mode === 'yesterday') return 'yesterday';
		if (mode === 'week') return 'this week';
		if (mode === '30d') return '30 days';
		if (mode === 'custom' && custom) {
			return new Date(`${custom}T00:00`).toLocaleDateString(undefined, {
				month: 'short',
				day: 'numeric'
			});
		}
		return autoLabel;
	});

	let wrap: HTMLDivElement | undefined = $state();

	function onDocClick(e: MouseEvent): void {
		if (open && wrap && !wrap.contains(e.target as Node)) onclose();
	}
</script>

<svelte:window onclick={onDocClick} />

<div class="since-wrap" bind:this={wrap}>
	<button class="since-trigger" onclick={ontoggle} aria-expanded={open}>
		since {triggerLabel} <span class="caret" aria-hidden="true">▾</span>
	</button>

	{#if open}
		<div class="since-pop" role="dialog" aria-label="choose window start">
			{#each presets as p (p.id)}
				<button
					class="since-opt"
					class:active={mode === p.id}
					aria-pressed={mode === p.id}
					onclick={() => onpick(p.id)}
				>
					[{p.label}]
				</button>
			{/each}
			<label class="since-date">
				custom
				<input
					type="date"
					value={custom}
					min={minIso}
					max={maxIso}
					oninput={(e) => {
						const v = (e.currentTarget as HTMLInputElement).value;
						if (v) oncustom(v);
					}}
				/>
			</label>
			<p class="since-note">last visit = new since you last opened the app (7-day default)</p>
		</div>
	{/if}
</div>
