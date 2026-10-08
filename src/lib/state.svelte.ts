import { browser } from '$app/env';
import type { Filter, Item } from './types';
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

const FILTERS: readonly Filter[] = ['all', 'casks', 'formulae', 'new', 'updated'];

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
	filter: Filter = $state('all');
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

	/**
	 * Pinned review cards, in pin order (a scan-and-pin reading queue).
	 * Snapshots: pinned rows keep the item as it was when pinned, even if
	 * the live row later re-sorts out of the visible window.
	 */
	pinned: Item[] = $state([]);
	/** Narrow screens: the sidebar offcanvas is open. */
	offcanvasOpen = $state(false);

	#initialized = false;

	/** Browser-only; call once from the page. Registers the leave listeners. */
	init(): void {
		if (!browser || this.#initialized) return;
		this.#initialized = true;

		try {
			const saved = localStorage.getItem(FILTER_KEY);
			if (saved && (FILTERS as readonly string[]).includes(saved)) this.filter = saved as Filter;
		} catch {
			/* storage disabled — default filter is fine */
		}

		const stamp = () => this.#stampVisit();
		window.addEventListener('pagehide', stamp);
		document.addEventListener('visibilitychange', () => {
			if (document.visibilityState === 'hidden') stamp();
		});
	}

	/**
	 * Recompute the visit window. Cheap; also used when retention first
	 * loads or the since-mode changes. Tracks the session-only override.
	 */
	refreshWindow(retentionDays: number): void {
		if (!browser) return;
		const w = presetWindow(
			this.sinceMode,
			readLastVisit(),
			Date.now(),
			retentionDays,
			this.sinceCustom
		);
		this.windowStart = w.start;
		this.firstVisit = w.firstVisit;
		this.capped = w.capped;
	}

	setFilter(f: Filter): void {
		this.filter = f;
		this.selected = 0;
		try {
			localStorage.setItem(FILTER_KEY, f);
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

	/** "caught up" button: back to auto, stamp now, recompute (list collapses). */
	markCaughtUp(retentionDays: number): void {
		this.sinceMode = 'auto';
		this.sinceCustom = '';
		this.pickerOpen = false;
		this.#stampVisit();
		this.refreshWindow(retentionDays);
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
