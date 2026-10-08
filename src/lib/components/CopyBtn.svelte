<script lang="ts">
	let { text, label = '[copy]' }: { text: string; label?: string } = $props();

	let copied = $state(false);

	async function copy(): Promise<void> {
		try {
			await navigator.clipboard.writeText(text);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch {
			/* clipboard unavailable — the text is right there to select */
		}
	}
</script>

<button class="copy" class:ok={copied} onclick={copy} aria-label="copy to clipboard">
	{copied ? '✓ copied' : label}
</button>
