#!/usr/bin/env node
// Regenerates static/data/changes.json — the precomputed dataset of
// Homebrew formulae/casks added or updated in the last N days.
// See DESIGN.md ("Precomputed changes"). Run by a scheduled GitHub Action;
// zero external dependencies (Node stdlib + global fetch), Node >= 22.

import { execFile as execFileCb } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);

// ---------------------------------------------------------------------------
// Config (env-overridable for testing)
// ---------------------------------------------------------------------------

const CORE_REPO = process.env.NB_CORE_REPO ?? 'https://github.com/Homebrew/homebrew-core.git';
const CASK_REPO = process.env.NB_CASK_REPO ?? 'https://github.com/Homebrew/homebrew-cask.git';
const FORMULA_API = process.env.NB_FORMULA_API ?? 'https://formulae.brew.sh/api/formula.json';
const CASK_API = process.env.NB_CASK_API ?? 'https://formulae.brew.sh/api/cask.json';
const SINCE_DAYS = Number(process.env.NB_SINCE_DAYS ?? 60);
const OUT = path.resolve(process.cwd(), process.env.NB_OUT ?? 'static/data/changes.json');

/**
 * @typedef {'f' | 'c'} PkgType
 * @typedef {{ name: string, type: PkgType, added: boolean, gone?: boolean, date: string }} Event
 *  `date` is normalized to UTC ISO (git emits committer offsets like +02:00,
 *  which don't compare lexicographically) and carries full second precision —
 *  truncated to a day only when written out as `d`.
 */

main().catch((err) => {
  console.error(err?.message ?? err);
  process.exitCode = 1;
});

async function main() {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'new-brew-'));
  try {
    const coreDir = await clone(CORE_REPO, tmp, 'core');
    const caskDir = await clone(CASK_REPO, tmp, 'cask');

    const events = [
      ...(await collectEvents(coreDir, 'Formula/', 'f')),
      ...(await collectEvents(caskDir, 'Casks/', 'c')),
    ];

    const rows = dedupe(events);
    const { formulae, casks } = await fetchMetadata();

    const items = rows.map((row) => {
      const meta = row.type === 'f' ? formulae.get(row.name) : casks.get(row.name);
      return {
        n: row.name,
        t: row.type,
        k: row.kind,
        d: row.date.slice(0, 10),
        ts: row.date, // full UTC ISO committer timestamp of the latest change
        v: meta?.version ?? '',
        desc: meta?.desc ?? '',
        url: meta?.homepage ?? '',
        dep: meta?.deprecated ?? false,
      };
    });

    // Newest first by precise timestamp, then by name for stable scanning.
    const sortKey = (i) => i.ts ?? i.d;
    items.sort((a, b) =>
      sortKey(a) === sortKey(b) ? a.n.localeCompare(b.n) : sortKey(a) < sortKey(b) ? 1 : -1
    );

    const [coreHeadSha, caskHeadSha] = await Promise.all([
      headSha(coreDir),
      headSha(caskDir),
    ]);

    const data = {
      generated_at: new Date().toISOString(),
      retention_days: SINCE_DAYS,
      core_head_sha: coreHeadSha,
      cask_head_sha: caskHeadSha,
      items,
    };

    await fs.mkdir(path.dirname(OUT), { recursive: true });
    await fs.writeFile(OUT, JSON.stringify(data) + '\n');

    summarize(data);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Git
// ---------------------------------------------------------------------------

async function clone(url, parentDir, name) {
  const dir = path.join(parentDir, name);
  // Blobless + no checkout: we only need commit metadata and name-status
  // diffs, never file contents.
  await git(['clone', '--filter=blob:none', '--no-checkout', url, dir]);
  return dir;
}

/**
 * @param {string} dir local clone
 * @param {string} pathspec e.g. "Formula/" or "Casks/" (matches any depth)
 * @param {PkgType} type
 * @returns {Promise<Event[]>}
 */
async function collectEvents(dir, pathspec, type) {
  // Rename detection stays ON (git's default) so renames surface as `R`
  // lines we can skip — per DESIGN.md, removals/renames are out of scope.
  const { stdout } = await git([
    'log',
    '--name-status',
    `--since=${SINCE_DAYS}.days`,
    '--format=%x1e%H%x1f%cI',
    '--',
    pathspec,
  ], dir);
  return parseLog(stdout, type);
}

/**
 * Parse `git log --name-status` output. Each commit record starts with \x1e
 * ("sha\x1fdate"), followed by name-status lines ("A\tFormula/x.rb").
 * @param {string} out
 * @param {PkgType} type
 * @returns {Event[]}
 */
function parseLog(out, type) {
  /** @type {Event[]} */
  const events = [];
  for (const record of out.split('\x1e')) {
    const trimmed = record.replace(/^\n/, '');
    if (!trimmed.trim()) continue;
    const lines = trimmed.split('\n').filter((l) => l.trim());
    const [header, ...changes] = lines;
    const [sha, rawDate] = header.split('\x1f');
    // Normalize to UTC ISO: committer offsets vary (+01:00, -07:00, ...) and
    // don't sort as strings. Date.parse handles every offset git emits.
    const t = Date.parse(rawDate ?? '');
    if (!sha || !Number.isFinite(t)) continue;
    const committerDate = new Date(t).toISOString();

    // Collect both sides of any renames in this commit so neither the old
    // nor the new name contributes an event (per DESIGN.md, renames are
    // out of scope — otherwise the old name's earlier A event would leak in).
    const renamed = new Set();
    for (const line of changes) {
      const status = line.split('\t')[0];
      if (status.startsWith('R')) {
        for (const p of line.split('\t').slice(1)) {
          renamed.add(path.basename(p).replace(/\.rb$/, ''));
        }
      }
    }

    for (const line of changes) {
      const [status, ...paths] = line.split('\t');
      if (status.startsWith('R')) {
        // Rename: skip both sides entirely (per DESIGN.md). Neither the old
        // nor the new name may appear as a discoverable package.
        for (const p of paths) renamed.add(path.basename(p).replace(/\.rb$/, ''));
        // The old name's last event is a disappearance — record it so dedupe
        // can drop any earlier add/modify of that name.
        events.push({ name: path.basename(paths[0]).replace(/\.rb$/, ''), type, added: false, gone: true, date: committerDate });
        continue;
      }
      if (status === 'D') {
        // Deleted: record the disappearance so an earlier in-window add/modify
        // doesn't surface a package that no longer exists.
        events.push({ name: path.basename(paths[0]).replace(/\.rb$/, ''), type, added: false, gone: true, date: committerDate });
        continue;
      }
      // Keep only additions (A) and modifications (M).
      if (status !== 'A' && status !== 'M') continue;
      const file = paths[paths.length - 1]; // A/M have exactly one path
      const name = path.basename(file).replace(/\.rb$/, '');
      if (renamed.has(name)) continue;
      events.push({ name, type, added: status === 'A', date: committerDate });
    }
  }
  return events;
}

/**
 * Collapse events to one row per package (key = name + type):
 * - `d` is the date of the MOST RECENT event (the last thing that happened);
 * - kind is "n" only if the package's EARLIEST in-window event was an
 *   addition, i.e. it entered the window as a new package (even if it was
 *   then modified again).
 * @param {Event[]} events
 */
function dedupe(events) {
  /** @type {Map<string, Event[]>} */
  const byPkg = new Map();
  for (const ev of events) {
    const key = `${ev.type}\0${ev.name}`;
    const list = byPkg.get(key);
    if (list) list.push(ev);
    else byPkg.set(key, [ev]);
  }

  const rows = [];
  for (const list of byPkg.values()) {
  // Commit order is newest -> oldest in the log output; sort so "earliest"
    // and "latest" below mean what they say. On date ties, in-window
    // appearances must lose to disappearances so `gone` wins.
    list.sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : a.gone ? 1 : b.gone ? -1 : 0
    );
    const latest = list[list.length - 1];
    // Deleted or renamed-away within the window — out of scope entirely
    // (this app is about discovering new things, not tracking removals).
    if (latest.gone) continue;
    rows.push({
      name: latest.name,
      type: latest.type,
      kind: /** @type {'n' | 'u'} */ (list[0].added ? 'n' : 'u'),
      date: latest.date, // full UTC ISO; caller slices the day for `d`
    });
  }
  return rows;
}

async function headSha(dir) {
  const { stdout } = await git(['rev-parse', 'HEAD'], dir);
  return stdout.trim();
}

async function git(args, cwd) {
  const { stdout } = await execFile('git', args, { cwd, maxBuffer: 256 * 1024 * 1024 });
  return { stdout };
}

// ---------------------------------------------------------------------------
// Metadata join
// ---------------------------------------------------------------------------

async function fetchMetadata() {
  // Abort on failure rather than writing partial/bad data — the Action
  // should fail loudly instead of committing a broken changes.json.
  const [rawFormulae, rawCasks] = await Promise.all([
    fetchJson(FORMULA_API, 'formula'),
    fetchJson(CASK_API, 'cask'),
  ]);

  /** @type {Map<string, {desc: string, homepage: string, version: string, deprecated: boolean}>} */
  const formulae = new Map();
  for (const f of rawFormulae) {
    formulae.set(f.name, {
      desc: f.desc ?? '',
      homepage: f.homepage ?? '',
      version: f.versions?.stable ?? '',
      deprecated: Boolean(f.deprecated || f.disabled),
    });
  }

  const casks = new Map();
  for (const c of rawCasks) {
    casks.set(c.token, {
      // Cask JSON may lack a short `desc`; fall back to the long name.
      desc: c.desc ?? c.name?.[0] ?? '',
      homepage: c.homepage ?? '',
      version: c.version ?? '',
      deprecated: Boolean(c.deprecated || c.disabled),
    });
  }
  return { formulae, casks };
}

async function fetchJson(url, label) {
  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new Error(`Failed to fetch ${label} API (${url}): ${err?.message ?? err}`);
  }
  if (!res.ok) {
    throw new Error(`${label} API (${url}) returned HTTP ${res.status}`);
  }
  try {
    return await res.json();
  } catch (err) {
    throw new Error(`Failed to parse ${label} API JSON (${url}): ${err?.message ?? err}`);
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function summarize(data) {
  const count = (pred) => data.items.filter(pred).length;
  console.log(`generated_at: ${data.generated_at}`);
  console.log(`core_head_sha: ${data.core_head_sha}`);
  console.log(`cask_head_sha: ${data.cask_head_sha}`);
  console.log(`items: ${data.items.length}`);
  console.log(`  new: ${count((i) => i.k === 'n')}`);
  console.log(`  updated: ${count((i) => i.k === 'u')}`);
  console.log(`  formulae: ${count((i) => i.t === 'f')}`);
  console.log(`  casks: ${count((i) => i.t === 'c')}`);
  console.log(`wrote ${OUT}`);
}
