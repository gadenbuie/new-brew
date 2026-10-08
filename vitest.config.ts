import { defineConfig } from 'vitest/config';

// Standalone config: tests cover pure logic modules only, so the SvelteKit
// plugin (and its browser/SSR machinery) is deliberately not loaded here.
export default defineConfig({
	test: {
		include: ['src/**/*.test.ts'],
		environment: 'node'
	}
});
