/**
 * The detail page's snapshot-to-DOM renderer, extracted so the exact code that
 * runs in the browser is also unit-tested against a DOM (happy-dom). It is
 * self-contained (no imports, no closures) so `applySnapshot.toString()` can be
 * inlined verbatim into the served page.
 */
import type { EngineStatus } from '../engine/status.js';

export interface DetailData {
  status: EngineStatus;
  conflicts: { id: number; relPath: string; kind: string; local: unknown; remote: unknown }[];
  quarantine: { id: number; relPath: string | null; nodeUid: string | null; reason: string }[];
  recycle: { bucket: number; relPath: string; size?: number }[];
  /** The configured sync pair, when the server knows it. */
  roots?: { local: string; remote: string } | null;
  /** The system's date locale (BCP 47); absent or null uses the browser's. */
  locale?: string | null;
}

/**
 * Render the live snapshot into the page. Must stay a pure function of
 * (document, data) with everything it needs defined inside it.
 */
export function applySnapshot(doc: Document, data: DetailData): void {
  const PAGE_SIZE = 25;
  interface SectionUi { page: number; query: string }
  interface DetailUi { actionError: string; sections: Record<string, SectionUi> }
  interface DetailWindow extends Window {
    detailNav?: (id: string, dir: number) => void;
    detailQuery?: (id: string, value: string) => void;
  }
  interface PageWindow<T> {
    shown: T[];
    total: number;
    filtered: number;
    page: number;
    pages: number;
    query: string;
    from: number;
    to: number;
  }

  const s = data.status;
  const host = doc as Document & { __detailUi?: DetailUi };
  host.__detailUi ??= { actionError: '', sections: {} };
  const ui = host.__detailUi;

  // Dates and counts follow the system locale the server reports, not the browser's.
  const locale = data.locale ?? undefined;
  const when = (ms: number): string => new Date(ms).toLocaleString(locale);
  const num = (n: number): string => n.toLocaleString(locale);
  const esc = (v: unknown): string => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
  const js = (v: string): string => v.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const set = (id: string, text: string): void => {
    const el = doc.getElementById(id);
    if (el !== null) el.textContent = text;
  };
  const sectionState = (id: string): SectionUi => {
    ui.sections[id] ??= { page: 1, query: '' };
    return ui.sections[id];
  };
  const windowOf = <T>(id: string, items: readonly T[], pathOf: (item: T) => string): PageWindow<T> => {
    const st = sectionState(id);
    const q = st.query.trim().toLowerCase();
    const matched = q === '' ? items.slice() : items.filter((item) => pathOf(item).toLowerCase().includes(q));
    const pages = Math.max(1, Math.ceil(matched.length / PAGE_SIZE));
    if (st.page > pages) st.page = pages;
    if (st.page < 1) st.page = 1;
    const fromIndex = (st.page - 1) * PAGE_SIZE;
    const shown = matched.slice(fromIndex, fromIndex + PAGE_SIZE);
    return {
      shown,
      total: items.length,
      filtered: matched.length,
      page: st.page,
      pages,
      query: st.query,
      from: matched.length === 0 ? 0 : fromIndex + 1,
      to: fromIndex + shown.length,
    };
  };
  const paint = (id: string, title: string, body: string, meta: PageWindow<unknown>, intro: string): void => {
    const el = doc.getElementById(id);
    if (el === null) return;
    const existing = el.querySelector('input[data-filter]');
    const focused = existing !== null && doc.activeElement === existing;
    if (existing === null) {
      el.innerHTML =
        '<div class="section-head"><h2>' + esc(title) + ' <span data-count></span></h2></div>' +
        // Body: what the section holds, the filter, the list, then the range and paging.
        '<div class="section-body"><p class="intro" data-intro></p>' +
        '<div class="toolbar" data-toolbar>' + search(title + ' filter') + '</div>' +
        '<div class="scroll" data-rows></div>' + footer() + '</div>';
      const created = el.querySelector('[data-filter]');
      const goPrev = el.querySelector('[data-prev]');
      const goNext = el.querySelector('[data-next]');
      if (created instanceof HTMLInputElement) created.addEventListener('input', () => { view.detailQuery?.(id, created.value); });
      if (goPrev !== null) goPrev.addEventListener('click', () => { view.detailNav?.(id, -1); });
      if (goNext !== null) goNext.addEventListener('click', () => { view.detailNav?.(id, 1); });
    }
    const introLine = el.querySelector('[data-intro]');
    if (introLine !== null) introLine.textContent = intro;
    const count = el.querySelector('[data-count]');
    if (count !== null) count.textContent = '(' + String(meta.total) + ')';
    const pager = el.querySelector('[data-pager]');
    // No range to show for an empty list: the line is hidden rather than reading 0.
    if (pager instanceof HTMLElement) {
      pager.hidden = meta.filtered === 0;
      pager.textContent = meta.filtered === 0 ? '' : String(meta.from) + '–' + String(meta.to) + ' of ' + String(meta.filtered);
    }
    const prev = el.querySelector('[data-prev]');
    const next = el.querySelector('[data-next]');
    // Nothing to filter or page through: the controls are hidden (and disabled).
    const empty = meta.total === 0;
    const toolbar = el.querySelector('[data-toolbar]');
    if (toolbar instanceof HTMLElement) toolbar.hidden = empty;
    const foot = el.querySelector('[data-footer]');
    if (foot instanceof HTMLElement) foot.hidden = empty;
    if (prev instanceof HTMLButtonElement) prev.disabled = empty || meta.page <= 1;
    if (next instanceof HTMLButtonElement) next.disabled = empty || meta.page >= meta.pages;
    const input = el.querySelector('[data-filter]');
    if (input instanceof HTMLInputElement) input.disabled = empty;
    if (input instanceof HTMLInputElement && !focused && input.value !== meta.query) input.value = meta.query;
    const rows = el.querySelector('[data-rows]');
    if (rows !== null) rows.innerHTML = body;
  };
  // An empty section shows nothing; only a filter that hides every item says so.
  const emptyBody = (meta: PageWindow<unknown>): string => (meta.total === 0 ? '' : '<p class="empty">nothing matches</p>');
  // A path cell takes the room the other columns leave and truncates at the start, so the
  // file name stays visible; the full path is in the tooltip.
  // An optional second line goes under the path in the smaller, dimmed style; the tooltip
  // can carry a fuller path than the one shown.
  const pathCell = (path: string, sub = '', full = path): string => '<td class="fill"><div class="trunc-start" title="' + esc(full) + '"><bdi>' + esc(path) + '</bdi></div>' + sub + '</td>';
  const bytes = (n: number): string => {
    if (n < 1024) return num(n) + ' B';
    const kb = n / 1024;
    return kb < 1024 ? kb.toLocaleString(locale, { maximumFractionDigits: 1 }) + ' KB' : (kb / 1024).toLocaleString(locale, { maximumFractionDigits: 1 }) + ' MB';
  };
  // One side of a conflict: a readable size (and modified time when known), with the
  // details on hover. The local side keeps its file details under `fingerprint`.
  // `where` and `kind` name a recorded path: a move's destination on that side, or the kept local copy.
  const side = (value: unknown, where: 'local' | 'remote', kind: string): string => {
    if (typeof value !== 'object' || value === null) return '--';
    const record = value as Record<string, unknown>;
    if (record['deleted'] === true) return 'Deleted';
    if (record['deleted'] === false) return 'Kept';
    const fingerprint = record['fingerprint'];
    const fp = typeof fingerprint === 'object' && fingerprint !== null ? (fingerprint as Record<string, unknown>) : record;
    const size = typeof fp['size'] === 'number' ? fp['size'] : null;
    const mtime = fp['mtimeMs'] ?? fp['mtime'];
    const modified = typeof mtime === 'number' ? when(mtime) : null;
    const tip: string[] = [];
    if (typeof record['path'] === 'string') {
      const label = kind === 'divergent_move' ? (where === 'local' ? 'Local destination' : 'Proton destination') : where === 'local' ? 'Local copy' : 'Proton path';
      tip.push(label + ': ' + record['path']);
    }
    if (size !== null) tip.push('Size: ' + num(size) + ' bytes');
    if (modified !== null) tip.push('Modified: ' + modified);
    if (typeof record['sha1'] === 'string' && record['sha1'] !== '') tip.push('SHA-1: ' + record['sha1']);
    return '<span title="' + esc(tip.join('\n')) + '">' + esc(size === null ? 'Details' : bytes(size)) + (modified === null ? '' : '<br><span class="sub">' + esc(modified) + '</span>') + '</span>';
  };
  // Resolve actions as icon buttons (inline SVG, so any font works), named in their tooltips.
  const icon = (paths: string): string => '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
  // Filter box: a magnifier inside it and the placeholder Omarchy's search fields use.
  // The filter matches anywhere in the path shown in the Name column.
  const search = (label: string): string =>
    '<label class="search">' + icon('<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/>') +
    '<input data-filter type="search" placeholder="Search by name…" aria-label="' + esc(label) + '"></label>';
  // Under a table: the item range on the left, Previous/Next as link text on the right.
  const footer = (): string =>
    '<div class="table-foot" data-footer><p data-pager class="pager"></p><span class="pages">' +
    '<button type="button" class="link" data-prev>&lt; Previous</button>' +
    '<button type="button" class="link" data-next>Next &gt;</button></span></div>';
  const RESOLVE: [string, string, string][] = [
    ['keep_local', 'Keep the local version', icon('<rect x="2" y="2.5" width="12" height="8.5" rx="1"/><path d="M1 13.5h14"/>')],
    ['keep_remote', 'Keep the Proton version', icon('<path d="M3.85 13H12.25A2.8 2.8 0 0 0 12.4 7.4A4.2 4.2 0 1 0 4.03 7.91A2.55 2.55 0 1 0 3.85 13Z"/>')],
    ['keep_both', 'Keep both versions', icon('<rect x="5.5" y="1.5" width="8" height="10" rx="1"/><path d="M3 4.5v9a1 1 0 0 0 1 1h6.5"/>')],
  ];

  const view: DetailWindow = doc.defaultView ?? (globalThis as unknown as DetailWindow);
  view.detailNav = (id: string, dir: number): void => {
    const st = sectionState(id);
    st.page += dir;
    if (st.page < 1) st.page = 1;
    applySnapshot(doc, data);
  };
  view.detailQuery = (id: string, value: string): void => {
    const st = sectionState(id);
    st.query = value;
    st.page = 1;
    applySnapshot(doc, data);
  };

  set('state', s.state.replace(/_/g, ' '));
  // Paused needs no explanation: the sync switch already shows it.
  set('reason', s.state === 'paused' ? '' : s.reason ?? '');
  const progress = s.progress;
  let glance = '';
  if (progress !== null && progress.total > 0 && s.state === 'syncing') glance = 'Sync (' + String(progress.done) + '/' + String(progress.total) + ')';
  if (progress !== null && progress.total > 0 && s.state === 'paused') glance = 'Paused (' + String(progress.done) + '/' + String(progress.total) + ')';
  set('glance', glance);
  // Sync now is the call to action only when sync needs a nudge.
  const syncButton = doc.getElementById('act-sync');
  if (syncButton !== null) syncButton.classList.toggle('primary', s.state === 'needs_login' || s.state === 'stopped' || s.state === 'error' || s.state === 'offline');
  // Pause stops all syncing in the engine (sync-now included), so the button is off while paused.
  if (syncButton instanceof HTMLButtonElement) {
    syncButton.disabled = s.state === 'paused';
    syncButton.title = s.state === 'paused' ? 'Resume sync to sync now' : 'Sync now';
  }
  // The switch is on while syncing is allowed; flipping it pauses or resumes.
  const toggle = doc.getElementById('sync-toggle');
  if (toggle !== null) {
    const on = s.state !== 'paused';
    toggle.setAttribute('aria-checked', on ? 'true' : 'false');
    toggle.setAttribute('title', on ? 'Sync is on. Click to pause' : 'Sync is paused. Click to resume');
    toggle.setAttribute('onclick', on ? "act('pause')" : "act('resume')");
  }
  const flags = doc.getElementById('flags');
  if (flags !== null) {
    const notes: string[] = [];
    if (s.dryRun) notes.push('Dry run');
    if (s.degraded) notes.push('The event stream is degraded');
    flags.innerHTML = notes.map((note) => '<span class="note">' + esc(note) + '</span>').join('');
  }
  const lines = doc.getElementById('lines');
  if (lines !== null) {
    // Label/value pairs, two to a row like the Wi-Fi panel; "--" until there is a value.
    // Each half is its own grid inside two equal columns, so the halves stay the same
    // width whatever their labels; every row is one line, so the rows still line up.
    const pair = (k: string, v: string): string => '<span class="k">' + esc(k) + '</span><span class="v" title="' + esc(v) + '">' + esc(v) + '</span>';
    const gap = '<span class="gap"></span>';
    const c = s.counts;
    const p = s.pending;
    // Rows as [left, right]: each side's path and file count, a blank row, then the activity.
    const roots = data.roots ?? null;
    const rows: [string, string][] = roots === null ? [] : [[pair('Local path', roots.local), pair('Proton Drive path', roots.remote)]];
    rows.push([pair('Local files', num(c.localFiles)), pair('Proton Drive files', num(c.remoteFiles))], [gap, gap]);
    rows.push(
      [pair('Last sync', s.lastSuccessfulSyncAt === null ? '--' : when(s.lastSuccessfulSyncAt)), pair('Files copied last sync', s.lastRunFilesCopied === null ? '--' : num(s.lastRunFilesCopied))],
      [pair('Last full sync', s.lastFullSyncAt === null ? '--' : when(s.lastFullSyncAt)), pair('Pending', p.uploads + p.downloads + p.other === 0 ? 'None' : num(p.uploads) + ' up, ' + num(p.downloads) + ' down, ' + num(p.other) + ' other')],
      [pair('Files in sync', num(c.pairedFiles)), pair('Folders in sync', num(c.pairedFolders))],
    );
    if (c.onlyLocal > 0 || c.onlyRemote > 0) rows.push([pair('Only on this computer', num(c.onlyLocal)), pair('Only on Proton', num(c.onlyRemote))]);
    // Skipped files (Proton Docs and Sheets) take the left half; a blank cell keeps the
    // right half's rows level with it.
    if (c.protonDocuments > 0) rows.push([pair('Files skipped', num(c.protonDocuments)), '<span class="k">&nbsp;</span><span class="v"></span>']);
    const half = (side: 0 | 1): string => '<div class="half">' + rows.map((row) => row[side]).join('') + '</div>';
    lines.innerHTML = '<div class="stats">' + half(0) + half(1) + '</div>';
  }
  const actionError = doc.getElementById('action-error');
  if (actionError !== null) {
    actionError.textContent = ui.actionError;
    actionError.hidden = ui.actionError === '';
  }

  const held = s.attention.heldPlan;
  const heldEl = doc.getElementById('held');
  if (heldEl !== null) {
    if (held === null) {
      heldEl.innerHTML = '';
      heldEl.hidden = true;
    } else {
      heldEl.hidden = false;
      if (heldEl.querySelector('[data-rows]') === null) {
        heldEl.innerHTML =
          '<div class="warn"><div class="section-head"><h2>Held plan <span data-count></span></h2></div>' +
          '<p><strong>Confirmation required:</strong> <span data-reason></span></p>' +
          '<div class="toolbar">' + search('Held plan filter') + '</div>' +
          '<div class="scroll" data-rows></div>' + footer() +
          '<p class="actions"><button type="button" class="btn primary" data-confirm>Proceed</button><button type="button" class="btn" data-reject>Reject</button></p></div>';
        const heldFilter = heldEl.querySelector('[data-filter]');
        const heldGoPrev = heldEl.querySelector('[data-prev]');
        const heldGoNext = heldEl.querySelector('[data-next]');
        if (heldFilter instanceof HTMLInputElement) heldFilter.addEventListener('input', () => { view.detailQuery?.('held', heldFilter.value); });
        if (heldGoPrev !== null) heldGoPrev.addEventListener('click', () => { view.detailNav?.('held', -1); });
        if (heldGoNext !== null) heldGoNext.addEventListener('click', () => { view.detailNav?.('held', 1); });
      }
      const reason = heldEl.querySelector('[data-reason]');
      if (reason !== null) reason.textContent = held.reason;
      const confirm = heldEl.querySelector('[data-confirm]');
      const reject = heldEl.querySelector('[data-reject]');
      if (confirm !== null) confirm.setAttribute('onclick', "act('confirm', {id:'" + js(held.id) + "'})");
      if (reject !== null) reject.setAttribute('onclick', "act('reject', {id:'" + js(held.id) + "'})");
      const heldPage = windowOf('held', held.affected, (path) => path);
      const heldInput = heldEl.querySelector('[data-filter]');
      const heldFocused = heldInput !== null && doc.activeElement === heldInput;
      const heldCount = heldEl.querySelector('[data-count]');
      if (heldCount !== null) heldCount.textContent = '(' + String(heldPage.total) + ')';
      const heldPager = heldEl.querySelector('[data-pager]');
      if (heldPager instanceof HTMLElement) {
        heldPager.hidden = heldPage.filtered === 0;
        heldPager.textContent = heldPage.filtered === 0 ? '' : String(heldPage.from) + '–' + String(heldPage.to) + ' of ' + String(heldPage.filtered);
      }
      const heldPrev = heldEl.querySelector('[data-prev]');
      const heldNext = heldEl.querySelector('[data-next]');
      const heldEmpty = heldPage.total === 0;
      if (heldPrev instanceof HTMLButtonElement) heldPrev.disabled = heldEmpty || heldPage.page <= 1;
      if (heldNext instanceof HTMLButtonElement) heldNext.disabled = heldEmpty || heldPage.page >= heldPage.pages;
      if (heldInput instanceof HTMLInputElement) heldInput.disabled = heldEmpty;
      if (heldInput instanceof HTMLInputElement && !heldFocused && heldInput.value !== heldPage.query) heldInput.value = heldPage.query;
      const heldRows = heldEl.querySelector('[data-rows]');
      if (heldRows !== null) {
        heldRows.innerHTML = heldPage.filtered === 0
          ? emptyBody(heldPage)
          : '<ul>' + heldPage.shown.map((path) => '<li>' + esc(path) + '</li>').join('') + '</ul>';
      }
    }
  }

  const docs = windowOf('proton-documents', s.protonDocumentPaths, (path) => path);
  // Proton documents live only on Proton; their full path is under the Proton Drive folder.
  const remoteRoot = data.roots ? data.roots.remote.replace(/\/+$/, '') + '/' : '';
  const docRows = docs.shown.map((path) => {
    // Only an own, finite time counts: a name like "__proto__" must not pick up an inherited member.
    const times = s.protonDocumentModifiedAt as Record<string, unknown> | undefined;
    const raw = times !== undefined && Object.prototype.hasOwnProperty.call(times, path) ? times[path] : undefined;
    const modified = typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
    // Shown inside the sync folder like the other tables; the full Proton path is on hover.
    return '<tr>' + pathCell(path, '', remoteRoot + path) + '<td class="nowrap">' + (modified === undefined ? '--' : '<time datetime="' + esc(new Date(modified).toISOString()) + '">' + esc(when(modified)) + '</time>') + '</td></tr>';
  }).join('');
  paint('proton-documents', 'Skipped', docs.filtered === 0 ? emptyBody(docs) : '<table><tr><th>Name</th><th>Modified</th></tr>' + docRows + '</table>', docs,
    'Proton Docs and Sheets are skipped: they exist only on Proton and open in the browser, so there is no file to copy to this computer.');

  const transfers = windowOf('transfers', s.transfers, (row) => row.relPath);
  const transferRows = transfers.shown.map((row) => {
    const pct = row.total !== undefined && row.total > 0 ? Math.round((row.bytes / row.total) * 100) : 0;
    return '<tr>' + pathCell(row.relPath) + '<td class="nowrap">' + (row.kind === 'upload' ? '↑ upload' : '↓ download') + '</td><td><div class="bar"><div style="width:' + String(pct) + '%"></div></div></td><td class="nowrap">' + String(Math.round(row.speed / 1024)) + ' KiB/s</td></tr>';
  }).join('');
  paint('transfers', 'Transfers', transfers.filtered === 0 ? emptyBody(transfers) : '<table><tr><th>Name</th><th>Direction</th><th>Progress</th><th>Speed</th></tr>' + transferRows + '</table>', transfers,
    'Uploads and downloads in progress.');

  const conflicts = windowOf('conflicts', data.conflicts, (row) => row.relPath);
  // The engine's conflict kinds in plain words; the raw kind stays in the tooltip.
  const deleted = (v: unknown): boolean => typeof v === 'object' && v !== null && (v as Record<string, unknown>)['deleted'] === true;
  const happened = (row: DetailData['conflicts'][number]): string => {
    if (row.kind === 'content') return 'Edited on both sides';
    if (row.kind === 'divergent_move') return 'Moved to different places';
    if (row.kind === 'create_create') return 'Created on both sides';
    if (row.kind === 'delete_vs_edit') {
      if (deleted(row.local)) return 'Deleted here, edited on Proton';
      if (deleted(row.remote)) return 'Edited here, deleted on Proton';
      return 'Deleted on one side, edited on the other';
    }
    return row.kind;
  };
  const conflictRows = conflicts.shown.map((row) =>
    '<tr>' + pathCell(row.relPath, '<div class="sub" title="' + esc(row.kind) + '">' + esc(happened(row)) + '</div>') +
    '<td class="nowrap">' + side(row.local, 'local', row.kind) + '</td><td class="nowrap">' + side(row.remote, 'remote', row.kind) + '</td>' +
    '<td class="nowrap actions-cell">' + RESOLVE.map(([choice, label, svg]) =>
      '<button type="button" class="btn icon" title="' + label + '" aria-label="' + label + '" onclick="act(\'resolve\', {id:' + String(row.id) + ", choice:'" + choice + "'})\">" + svg + '</button>').join('') +
    '</td></tr>').join('');
  paint('conflicts', 'Conflicts', conflicts.filtered === 0 ? emptyBody(conflicts) : '<table><tr><th>Name</th><th>Local</th><th>Remote</th><th>Resolve</th></tr>' + conflictRows + '</table>', conflicts,
    'Files changed on both sides since the last sync. Choose the version to keep, or keep both.');

  const quarantine = windowOf('quarantine', data.quarantine, (row) => row.relPath ?? '');
  const quarantineRows = quarantine.shown.map((row) =>
    '<tr>' + pathCell(row.relPath ?? '-') + '<td class="nowrap"><div class="trunc-end" title="' + esc(row.nodeUid ?? '-') + '">' + esc(row.nodeUid ?? '-') + '</div></td><td>' + esc(row.reason) + '</td><td class="nowrap"><button type="button" class="btn" onclick="act(\'release\', {id:' + String(row.id) + '})">Release</button></td></tr>').join('');
  paint('quarantine', 'Quarantine', quarantine.filtered === 0 ? emptyBody(quarantine) : '<table><tr><th>Name</th><th>Node</th><th>Reason</th><th></th></tr>' + quarantineRows + '</table>', quarantine,
    'Files sync stopped touching because a transfer failed its integrity check or its result was unclear after a crash. Release one to let sync handle it again.');

  const recycle = windowOf('recycle', data.recycle, (row) => row.relPath);
  const recycleRows = recycle.shown.map((row) => {
    const iso = new Date(row.bucket).toISOString();
    return '<tr>' + pathCell(row.relPath) + '<td class="nowrap">' + (row.size === undefined ? '--' : esc(bytes(row.size))) + '</td><td class="nowrap"><time datetime="' + esc(iso) + '">' + esc(when(row.bucket)) + '</time></td></tr>';
  }).join('');
  paint('recycle', 'Recycled', recycle.filtered === 0 ? emptyBody(recycle) : '<table><tr><th>Name</th><th>Size</th><th>Recycled at</th></tr>' + recycleRows + '</table>', recycle,
    'Local files moved aside instead of deleted or overwritten, kept in ' + (data.roots ? data.roots.local + '/.proton-sync/recycle' : 'the sync folder under .proton-sync/recycle') + '. Copy one back to restore it.');
}

/** The browser script for the served page: the tested renderer plus the fetch/refresh glue. */
export function clientScript(): string {
  return `${applySnapshot.toString()}
function detailUi() {
  document.__detailUi ??= { actionError: '', sections: {} };
  return document.__detailUi;
}
const base = location.pathname.replace(/\\/$/, '');
async function act(name, body) {
  let message = '';
  try {
    const response = await fetch(base + '/api/' + name, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
    const payload = await response.json();
    if (!response.ok || payload.ok === false) message = String(payload.error ?? 'Action failed');
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  detailUi().actionError = message;
  await refresh();
}
// Each engine run serves the page at a new secret address, so a page left open across a
// restart can no longer reach it. Say so instead of quietly showing old data.
let missedRefreshes = 0;
function setConnected(connected) {
  const notice = document.getElementById('connection-lost');
  if (notice !== null) notice.hidden = connected;
  document.body.classList.toggle('stale', !connected);
}
async function refresh() {
  let data;
  try {
    const response = await fetch(base + '/api/state');
    if (!response.ok) throw new Error('HTTP ' + response.status);
    data = await response.json();
  } catch {
    // Two misses in a row (about 4 seconds) before the notice, so one hiccup does not flash it.
    missedRefreshes += 1;
    if (missedRefreshes >= 2) setConnected(false);
    return;
  }
  missedRefreshes = 0;
  setConnected(true);
  applySnapshot(document, data);
}
async function refreshTheme() {
  try {
    const response = await fetch(base + '/api/theme');
    const theme = await response.json();
    const css = String(theme.css ?? '');
    const style = document.getElementById('omarchy-theme');
    if (style !== null && style.textContent !== css) style.textContent = css;
    document.documentElement.classList.toggle('omarchy', css !== '');
    const icon = encodeURIComponent(String(theme.icon ?? ''));
    const img = document.getElementById('title-icon');
    if (img !== null && img.dataset.icon !== icon) {
      img.dataset.icon = icon;
      img.hidden = icon === '';
      if (icon !== '') img.src = 'icon/folder?v=' + icon;
    }
  } catch {
    // Keep the current look; the next tick retries.
  }
}
refresh();
window.__detailRefresh = setInterval(refresh, 2000);
window.__detailTheme = setInterval(refreshTheme, 2000);`;
}
