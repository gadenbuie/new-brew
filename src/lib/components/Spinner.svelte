<script lang="ts">
	/** Terminal-style braille spinner for "waiting on something" states —
	 * fetches, loads, anything the main thread isn't blocking on (a CSS
	 * animation keeps spinning during sync work; this doesn't, so keep it
	 * for async waits). */
	const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

	let { label = 'loading' }: { label?: string } = $props();

	let frame = $state(FRAMES[0]);
	$effect(() => {
		let i = 0;
		const timer = setInterval(() => {
			i = (i + 1) % FRAMES.length;
			frame = FRAMES[i];
		}, 80);
		return () => clearInterval(timer);
	});
</script>

<!-- role="img" so the label is announced once, not on every frame change -->
<span class="spinner" role="img" aria-label={label}>{frame}</span>
