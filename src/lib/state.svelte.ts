import { browser } from '$app/env';
import type { Filter, Item, Kind, PkgType } from './types';
import { presetWindow, isoDate, type SinceMode } from './window';

/**
 * UI state: last-visit timestamp, scope filter, search query, keyboard
 * selection, the session-scoped "since" override, and the sidebar's pinned
 * review cards. localStorage-backed bits live here (except the dataset
 * cache, which `data.svelte.ts` owns). Pins and the since override are
 * deliberately session-only — new visits return to the settled
 * since-last-visit behavior with an empty review stack.
 */

const LAST_VISIT_KEY = 'newbrew:lastVisit';
const FILTER_KEY = 'newbrew:filter';
const THEME_KEY = 'newbrew:theme';

/** Light/dark/system — persisted only while it contradicts the OS setting;
 * a choice that agrees with the system is redundant and forgotten. */
export type ThemeMode = 'dark' | 'light' | 'system';

function systemPrefersLight(): boolean {
	return window.matchMedia('(prefers-color-scheme: light)').matches;
}

function readTheme(): ThemeMode {
	if (!browser) return 'system';
	try {
		const saved = localStorage.getItem(THEME_KEY);
		if (saved === 'dark' || saved === 'light') {
			// a saved choice that now agrees with the OS is redundant — forget
			// it and follow the system (they render identically anyway)
			if ((saved === 'light') === systemPrefersLight()) {
				localStorage.removeItem(THEME_KEY);
				return 'system';
			}
			return saved;
		}
	} catch {
		/* fine */
	}
	return 'system';
}

/** Persisted chip state: { types: PkgType[], kinds: Kind[] } — empty = both. */
function readChips(): { types: PkgType[]; kinds: Kind[] } {
	if (!browser) return { types: [], kinds: [] };
	try {
		const raw = localStorage.getItem(FILTER_KEY);
		if (!raw) return { types: [], kinds: [] };
		const parsed = JSON.parse(raw);
		const types = Array.isArray(parsed?.types)
			? parsed.types.filter((t: unknown) => t === 'f' || t === 'c')
			: [];
		const kinds = Array.isArray(parsed?.kinds)
			? parsed.kinds.filter((k: unknown) => k === 'n' || k === 'u')
			: [];
		return { types, kinds };
	} catch {
		// legacy single-chip values or corrupt JSON — start fresh
		return { types: [], kinds: [] };
	}
}

function readLastVisit(): number | null {
	if (!browser) return null;
	try {
		return Number(localStorage.getItem(LAST_VISIT_KEY)) || null;
	} catch {
		return null;
	}
}

function keyOf(item: Item): string {
	return `${item.t}/${item.n}`;
}

class UIState {
	/** active type chips (empty = both pass) — choosing one excludes the other
	 * until it's also activated, per the group interaction */
	activeTypes: PkgType[] = $state([]);
	/** active kind chips (empty = both pass) */
	activeKinds: Kind[] = $state([]);
	query = $state('');
	/** keyboard-selected index into the visible list */
	selected = $state(0);
	/** start of the "since your last visit" window */
	windowStart: Date | null = $state(null);
	firstVisit = $state(false);
	capped = $state(false);

	// Session-scoped "since" override (not persisted — see class comment).
	sinceMode: SinceMode = $state('auto');
	sinceCustom = $state('');
	pickerOpen = $state(false);

	/** Light/dark/system — stored only while it contradicts the OS setting. */
	theme: ThemeMode = $state('system');

	/**
	 * Pinned review cards, in pin order (a scan-and-pin reading queue).
	 * Snapshots: pinned rows keep the item as it was when pinned, even if
	 * the live row later re-sorts out of the visible window.
	 */
	pinned: Item[] = $state([]);
	/** Narrow screens: the sidebar offcanvas is open. */
	offcanvasOpen = $state(false);

	#initialized = false;

	/** Browser-only; call once from the page. Idempotent. */
	init(): void {
		if (!browser || this.#initialized) return;
		this.#initialized = true;

		const chips = readChips();
		this.activeTypes = chips.types;
		this.activeKinds = chips.kinds;

		this.theme = readTheme();
		this.#applyTheme();
		// while in `system` mode, follow the OS preference as it changes
		window
			.matchMedia('(prefers-color-scheme: light)')
			.addEventListener('change', () => this.#onSystemChange());
	}

	/**
	 * The since-last-visit window. Cheap; also recomputes when retention
	 * first loads or the since-mode changes. Tracks the session-only override.
	 */
	#windowSeeded = false;
	#lastVisitMs: number | null = null;

	refreshWindow(retentionDays: number): void {
		if (!browser) return;
		// Seed once per session: capture the previous visit's open, then stamp
		// this one. Every later call (retention load, since changes) recomputes
		// from the captured value — storage is never re-read, so the window
		// can't shift under a running session.
		if (!this.#windowSeeded) {
			this.#windowSeeded = true;
			this.#lastVisitMs = readLastVisit();
			this.#stampVisit();
		}
		const w = presetWindow(
			this.sinceMode,
			this.#lastVisitMs,
			Date.now(),
			retentionDays,
			this.sinceCustom
		);
		this.windowStart = w.start;
		this.firstVisit = w.firstVisit;
		this.capped = w.capped;
	}

	/** Toggle a type chip: activating `c` excludes `f` until `f` is also
	 * activated (and vice-versa); an empty set passes both. */
	toggleType(t: PkgType): void {
		const i = this.activeTypes.indexOf(t);
		if (i >= 0) this.activeTypes.splice(i, 1);
		else this.activeTypes.push(t);
		this.selected = 0;
		this.#persistChips();
	}

	/** Same group interaction for the new/updated kind chips. */
	toggleKind(k: Kind): void {
		const i = this.activeKinds.indexOf(k);
		if (i >= 0) this.activeKinds.splice(i, 1);
		else this.activeKinds.push(k);
		this.selected = 0;
		this.#persistChips();
	}

	#persistChips(): void {
		try {
			localStorage.setItem(
				FILTER_KEY,
				JSON.stringify({ types: this.activeTypes, kinds: this.activeKinds })
			);
		} catch {
			/* fine */
		}
	}

	setSince(mode: SinceMode, customIso = ''): void {
		this.sinceMode = mode;
		if (customIso) this.sinceCustom = customIso;
		this.pickerOpen = false;
		this.selected = 0;
	}

	isPinned(item: Item): boolean {
		return this.pinned.some((p) => keyOf(p) === keyOf(item));
	}

	/** Pin the item for the session, or unpin it if it already is. */
	togglePin(item: Item): void {
		const i = this.pinned.findIndex((p) => keyOf(p) === keyOf(item));
		if (i >= 0) this.pinned.splice(i, 1);
		else this.pinned.push({ ...item });
	}

	/** Window start as a `YYYY-MM-DD` comparable to item dates. */
	get windowStartIso(): string {
		return this.windowStart ? isoDate(this.windowStart) : '';
	}

	/** Toggle: from system, jump to the opposite of what the system shows;
	 * from an explicit choice, return to system. */
	cycleTheme(): void {
		const next: ThemeMode =
			this.theme === 'system'
				? systemPrefersLight()
				? 'dark'
				: 'light'
				: 'system';
		this.setTheme(next);
	}

	setTheme(mode: ThemeMode): void {
		this.theme = mode;
		this.#persistTheme();
		this.#applyThemeWiped();
	}

	/** The stored key is exactly "a choice that contradicts the system" —
	 * written while the contradiction exists, dropped the moment it ends. */
	#persistTheme(): void {
		if (!browser) return;
		try {
			const contradicts =
				this.theme !== 'system' && (this.theme === 'light') !== systemPrefersLight();
			if (contradicts) localStorage.setItem(THEME_KEY, this.theme);
			else localStorage.removeItem(THEME_KEY);
		} catch {
			/* fine */
		}
	}

	/** Apply the theme with the toggle's authored moment: the new theme
	 * wipes in top-to-bottom like a monitor refresh (View Transitions
	 * snapshot pair, default cross-fade disabled in app.css). Falls back to
	 * an instant apply where the API is missing or motion is reduced. */
	#applyThemeWiped(): void {
		if (!browser) return;
		if (
			typeof document.startViewTransition !== 'function' ||
			window.matchMedia('(prefers-reduced-motion: reduce)').matches
		) {
			this.#applyTheme();
			return;
		}
		const transition = document.startViewTransition(() => this.#applyTheme());
		void transition.ready
			.then(() => {
				// a monitor refresh: the beam starts at once (1.4× linear — an
				// instant start acknowledges the click), holds a steady sweep
				// through the middle, and only eases into the bottom edge
				document.documentElement.animate(
					{ clipPath: ['inset(0 0 100% 0)', 'inset(0 0 0% 0)'] },
					{
						duration: 550,
						easing: 'cubic-bezier(0.4, 0.55, 0.65, 1)',
						pseudoElement: '::view-transition-new(root)'
					}
				);
			})
			.catch(() => {
				/* skipped or aborted (rapid toggling) — the theme still applied */
			});
	}

	/** OS preference changed: re-evaluate the contract. A choice that now
	 * agrees with the system is redundant — drop it and follow the system;
	 * one that now contradicts is (re)affirmed in storage. */
	#onSystemChange(): void {
		if (
				this.theme !== 'system' &&
				(this.theme === 'light') === systemPrefersLight()
		) {
			this.theme = 'system';
		}
		this.#persistTheme();
		this.#applyTheme();
	}

	#applyTheme(): void {
		if (!browser) return;
		const light =
			this.theme === 'light' ||
			(this.theme === 'system' &&
				window.matchMedia('(prefers-color-scheme: light)').matches);
		document.documentElement.dataset.theme = light ? 'light' : 'dark';
	}

	#stampVisit(): void {
		try {
			localStorage.setItem(LAST_VISIT_KEY, String(Date.now()));
		} catch {
			/* fine */
		}
	}
}

/** The app-wide UI state. */
export const ui = new UIState();
