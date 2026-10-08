import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// Static site for GitHub Pages: everything is prerendered at build time.
			// No explicit base path — asset URLs are relative so the site works under
			// any subpath (e.g. username.github.io/new-brew/).
			adapter: adapter({
				pages: 'build',
				assets: 'build',
				strict: true
			}),
			paths: {
				base: '',
				relative: true
			}
		})
	]
});
