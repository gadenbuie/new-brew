<script lang="ts">
	import CopyBtn from './CopyBtn.svelte';
	import { brewPageUrl } from '#lib/pkgs.ts';
	import type { Item } from '#lib/types.ts';

	let { item, onopen }: { item: Item; onopen: () => void } = $props();

	const install = $derived(`brew install ${item.t === 'c' ? '--cask ' : ''}${item.n}`);
</script>

<div class="detail">
	<p class="desc">
		<span class="pkg">{item.n}</span>{item.desc ? ` — ${item.desc}` : ''}
	</p>
	{#if item.dep}
		<p class="dep-note">! deprecated or disabled — probably not worth installing</p>
	{/if}
	<div class="actions">
		<code class="install">{install}</code>
		<CopyBtn text={install} />
		<button class="full" onclick={onopen} title="press o">[full details]</button>
		{#if item.url}
			<a href={item.url} target="_blank" rel="noreferrer">↗ project site</a>
		{/if}
		<a href={brewPageUrl(item.t, item.n)} target="_blank" rel="noreferrer">↗ brew.sh page</a>
	</div>
</div>
