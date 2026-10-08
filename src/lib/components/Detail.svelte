<script lang="ts">
	import type { Item } from '#lib/types.ts';

	let { item }: { item: Item } = $props();

	let copied = $state(false);

	const install = $derived(
		`brew install ${item.t === 'c' ? '--cask ' : ''}${item.n}`
	);
	const brewPage = $derived(
		`https://formulae.brew.sh/${item.t === 'c' ? 'cask' : 'formula'}/${item.n}/`
	);

	async function copy() {
		try {
			await navigator.clipboard.writeText(install);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch {
			/* clipboard unavailable — the text is right there to select */
		}
	}
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
		<button class="copy" class:ok={copied} onclick={copy} aria-label="copy install command to clipboard">
			{copied ? '✓ copied' : '[copy]'}
		</button>
		{#if item.url}
			<a href={item.url} target="_blank" rel="noreferrer">↗ project site</a>
		{/if}
		<a href={brewPage} target="_blank" rel="noreferrer">↗ brew.sh page</a>
	</div>
</div>
