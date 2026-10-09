// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { formatStatus } from '../cli/output.js';
import { initialStatus, type EngineStatus } from '../engine/status.js';
import { advanceStatus, applySnapshot, clientScript, type DetailData } from './detailView.js';

/**
 * The detail page renders the live snapshot into the visible DOM — not just a
 * JSON endpoint (spec: tray-status-ui / Detail page is a live view). A loaded
 * page for a running engine must show state, counts and lists, never a blank
 * shell.
 */

function fixture(): void {
  document.body.innerHTML = `
    <span id="state"></span>
    <button id="sync-toggle" role="switch" aria-checked="true"></button><button id="act-sync"></button>
    <p id="action-error" hidden></p>
    <div id="lines"></div><div id="proton-documents"></div><div id="held"></div>
    <div id="transfers"></div><div id="conflicts"></div>
    <div id="quarantine"></div><div id="recycle"></div>`;
  delete (document as Document & { __detailUi?: unknown }).__detailUi;
}

function statusWith(over: Partial<EngineStatus>): EngineStatus {
  return { ...initialStatus(false, 0), ...over };
}

function el(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`missing #${id}`);
  return node;
}

/** The value shown beside a stats label. */
function stat(label: string): string | null {
  const key = Array.from(el('lines').querySelectorAll('.stats .k')).find((k) => k.textContent === label);
  return key?.nextElementSibling?.textContent ?? null;
}

function control<T extends Element>(id: string, selector: string, kind: new () => T): T {
  const node = el(id).querySelector(selector);
  if (!(node instanceof kind)) throw new Error(`missing ${selector} in #${id}`);
  return node;
}

function dataFor(status: EngineStatus, extra: Partial<DetailData> = {}): DetailData {
  return { status, conflicts: [], quarantine: [], recycle: [], ...extra };
}

describe('applySnapshot', () => {
  it('shows state, non-empty file counts and last sync, and fills the lists', () => {
    fixture();
    const status = statusWith({
      state: 'idle',
      counts: { baseline: 5, localFiles: 5, remoteFiles: 4, pairedFiles: 5, pairedFolders: 0, protonDocuments: 0, onlyLocal: 0, onlyRemote: 0 },
      lastSuccessfulSyncAt: 1_700_000_000_000,
      lastRunFilesCopied: 2,
      summaryLines: ['In sync', 'Last sync: 2023-11-14T22:13:20.000Z, 2 files copied', 'Files: 5 on this computer, 4 on Proton, 5 in sync'],
      protonDocumentPaths: [],
    });
    const data: DetailData = {
      status,
      conflicts: [{ id: 1, relPath: 'c.txt', kind: 'content', local: { size: 1, mtimeMs: 1_700_000_000_000 }, remote: { size: 2 } }],
      quarantine: [],
      recycle: [{ bucket: 1_700_000_000_000, relPath: 'old.txt' }],
      roots: { local: '/home/u/Drive', remote: '/my-files/Sync' },
      locale: 'en-US',
    };
    const shown = new Date(1_700_000_000_000).toLocaleString('en-US');

    applySnapshot(document, data);

    expect(el('state').textContent).toBe('idle');
    // Stats are label/value pairs, dates in the system locale, with the sync pair's paths.
    expect(stat('Last sync')).toBe(shown);
    expect(stat('Files copied last sync')).toBe('2');
    expect(stat('Last full sync')).toBe('--');
    // Last full sync sits under Last sync on the left; Pending under Files copied on the right.
    const keys = (side: number): (string | null)[] => Array.from(el('lines').querySelectorAll('.stats > .half')[side]?.querySelectorAll('.k') ?? []).map((k) => k.textContent);
    expect(keys(0)).toEqual(['Local path', 'Local files', 'Last sync', 'Last full sync', 'Files in sync']);
    expect(keys(1)).toEqual(['Proton Drive path', 'Proton Drive files', 'Files copied last sync', 'Pending', 'Folders in sync']);
    expect(stat('Local files')).toBe('5');
    expect(stat('Proton Drive files')).toBe('4');
    expect(stat('Files in sync')).toBe('5');
    expect(stat('Proton Drive path')).toBe('/my-files/Sync');
    expect(stat('Local path')).toBe('/home/u/Drive');
    // Two halves: paths and file counts lead (local left, Proton right), then a blank row, then the activity.
    const halves = Array.from(el('lines').querySelectorAll('.stats > .half')).map((h) =>
      Array.from(h.children).map((n) => (n.className === 'gap' ? '|' : n.textContent)));
    expect(halves).toHaveLength(2);
    expect(halves[0]?.slice(0, 7)).toEqual(['Local path', '/home/u/Drive', 'Local files', '5', '|', 'Last sync', shown]);
    expect(halves[1]?.slice(0, 7)).toEqual(['Proton Drive path', '/my-files/Sync', 'Proton Drive files', '4', '|', 'Files copied last sync', '2']);
    expect(el('lines').textContent).not.toContain('2023-11-14T');
    expect(el('lines').textContent).not.toContain('synced');
    expect(el('conflicts').textContent).toContain(shown);
    // Conflict kinds read as plain words under the path, with the raw kind on hover.
    const kindCell = el('conflicts').querySelector('td.fill .sub');
    expect(kindCell?.textContent).toBe('Edited on both sides');
    expect(kindCell?.getAttribute('title')).toBe('content');
    const kinds = (rows: DetailData['conflicts']): (string | null)[] => {
      applySnapshot(document, { ...data, conflicts: rows });
      return Array.from(el('conflicts').querySelectorAll('td.fill .sub')).map((sub) => sub.textContent);
    };
    expect(kinds([
      { id: 2, relPath: 'a', kind: 'delete_vs_edit', local: { deleted: true }, remote: { deleted: false } },
      { id: 3, relPath: 'b', kind: 'delete_vs_edit', local: { deleted: false }, remote: { deleted: true } },
      { id: 4, relPath: 'c', kind: 'divergent_move', local: {}, remote: {} },
      { id: 5, relPath: 'd', kind: 'create_create', local: {}, remote: {} },
    ])).toEqual(['Deleted here, edited on Proton', 'Edited here, deleted on Proton', 'Moved to different places', 'Created on both sides']);
    // A move records each side's destination; the tooltips say which is which.
    applySnapshot(document, { ...data, conflicts: [{ id: 6, relPath: 'site/index.html', kind: 'divergent_move', local: { path: 'www/index.html' }, remote: { path: 'public/index.html' } }] });
    const moveTips = Array.from(el('conflicts').querySelectorAll('td span[title]')).map((span) => span.getAttribute('title'));
    expect(moveTips).toEqual(['Local destination: www/index.html', 'Proton destination: public/index.html']);
    applySnapshot(document, data);
    // Proton documents show their full path under the Proton Drive folder.
    applySnapshot(document, { ...data, status: { ...status, protonDocumentPaths: ['Notes/Agenda', 'Undated'], protonDocumentModifiedAt: { 'Notes/Agenda': 1_700_000_000_000 } } });
    const docCells = Array.from(el('proton-documents').querySelectorAll('td')).map((td) => td.textContent);
    expect(Array.from(el('proton-documents').querySelectorAll('th')).map((th) => th.textContent)).toEqual(['Name', 'Modified']);
    // Names read inside the sync folder like the other tables; the full Proton path is the tooltip.
    expect(docCells).toEqual(['Notes/Agenda', shown, 'Undated', '--']);
    expect(el('proton-documents').querySelector('.trunc-start')?.getAttribute('title')).toBe('/my-files/Sync/Notes/Agenda');
    // A document named "__proto__" renders with its own time, and a missing or bad time reads "--",
    // never an inherited member (which used to throw on every refresh).
    const odd = JSON.parse('{"__proto__": 1700000000000, "Bad": "soon"}') as Record<string, number>;
    applySnapshot(document, { ...data, status: { ...status, protonDocumentPaths: ['__proto__', 'Bad', 'constructor'], protonDocumentModifiedAt: odd } });
    expect(Array.from(el('proton-documents').querySelectorAll('td')).map((td) => td.textContent)).toEqual(['__proto__', shown, 'Bad', '--', 'constructor', '--']);
    applySnapshot(document, data);
    // Each section opens with a line saying what it holds; the recycle bin names its folder.
    expect(el('recycle').querySelector('[data-intro]')?.textContent).toBe('Local files moved aside instead of deleted or overwritten, kept in /home/u/Drive/.proton-sync/recycle. Copy one back to restore it.');
    for (const id of ['conflicts', 'quarantine', 'transfers', 'proton-documents']) expect(el(id).querySelector('[data-intro]')?.textContent).not.toBe('');
    // Conflicts says nothing is lost while it waits, and why a deleted-and-edited file only needs dismissing.
    expect(el('conflicts').querySelector('[data-intro]')?.textContent).toBe('Files changed on both sides since the last sync. Both versions are safe until you choose: keep one, or keep both. Where a file was deleted on one side and edited on the other, the edit is already kept, so just dismiss it.');
    expect(el('proton-documents').querySelector('[data-rows]')?.innerHTML).toBe('');
    expect(el('conflicts').innerHTML).toContain('c.txt');
    expect(el('conflicts').textContent).toContain('1 B');
    // Each side reads as a size with details on hover; the local side's details are nested
    // under `fingerprint` with the path of the kept local copy.
    expect(el('conflicts').querySelector('td:nth-child(2) span')?.getAttribute('title')).toContain('Size: 1 bytes');
    applySnapshot(document, { ...data, conflicts: [{ id: 9, relPath: 'Notes/Long/Path/To/plan.md', kind: 'content', local: { path: 'Notes/Long/Path/To/plan.conflict-x.md', fingerprint: { size: 6443, mtimeMs: 1_700_000_000_000 } }, remote: { sha1: 'abcdef0123', size: 6475, mtimeMs: 1_700_000_000_000 } }] });
    const cells = el('conflicts').querySelectorAll('td');
    expect(cells[1]?.textContent).toBe('6.3 KB' + shown);
    expect(cells[1]?.querySelector('span')?.getAttribute('title')).toBe('Local copy: Notes/Long/Path/To/plan.conflict-x.md\nSize: 6,443 bytes\nModified: ' + shown);
    // The remote side shows its modified time too, once the engine adds it.
    expect(cells[2]?.textContent).toBe('6.3 KB' + shown);
    expect(cells[2]?.querySelector('span')?.getAttribute('title')).toContain('SHA-1: abcdef0123');
    // The path truncates with the full path on hover; resolve actions are labelled icon buttons.
    expect(cells[0]?.querySelector('.trunc-start')?.getAttribute('title')).toBe('Notes/Long/Path/To/plan.md');
    expect(Array.from(cells[3]?.querySelectorAll('button') ?? []).map((b) => b.getAttribute('aria-label'))).toEqual(['Keep the local version', 'Keep the Proton version', 'Keep both versions']);
    applySnapshot(document, data);
    expect(el('conflicts').innerHTML).toContain("choice:'keep_local'");
    expect(el('conflicts').innerHTML).toContain("choice:'keep_remote'");
    expect(el('conflicts').innerHTML).toContain("choice:'keep_both'");
    const recycled = el('recycle').querySelector('time');
    expect(recycled?.textContent).toBe(shown);
    expect(recycled?.getAttribute('datetime')).toBe('2023-11-14T22:13:20.000Z');
    expect(el('recycle').innerHTML).toContain('old.txt');
    // Every table's path cell truncates at the start with the full path on hover.
    expect(el('recycle').querySelector('td.fill .trunc-start')?.getAttribute('title')).toBe('old.txt');
    // Recycled reads Name, Size, Recycled at; an unknown size shows as "--".
    expect(Array.from(el('recycle').querySelectorAll('th')).map((th) => th.textContent)).toEqual(['Name', 'Size', 'Recycled at']);
    expect(el('recycle').querySelectorAll('td')[1]?.textContent).toBe('--');
    applySnapshot(document, { ...data, recycle: [{ bucket: 1_700_000_000_000, relPath: 'old.txt', size: 2_048 }] });
    expect(el('recycle').querySelectorAll('td')[1]?.textContent).toBe('2 KB');
    applySnapshot(document, data);
    expect(el('conflicts').querySelector('td.fill .trunc-start')?.getAttribute('title')).toBe('c.txt');
    expect(el('quarantine').querySelector('[data-rows]')?.innerHTML).toBe('');
    // Nothing unusual: the state line is one message, in the normal tone.
    expect(el('state').getAttribute('data-tone')).toBe('normal');
  });

  it('shows sync on/off on the switch and makes Sync now the call to action only when needed', () => {
    fixture();
    applySnapshot(document, dataFor(statusWith({ state: 'idle' })));
    expect(el('sync-toggle').getAttribute('aria-checked')).toBe('true');
    expect(el('sync-toggle').getAttribute('onclick')).toBe("act('pause')");
    expect(el('act-sync').classList.contains('primary')).toBe(false);
    expect((el('act-sync') as HTMLButtonElement).disabled).toBe(false);
    expect(el('act-sync').title).toBe('Sync now');
    applySnapshot(document, dataFor(statusWith({ state: 'paused', reason: 'paused by user' })));
    expect(el('sync-toggle').getAttribute('aria-checked')).toBe('false');
    // Paused needs no reason: the switch already shows it.
    expect(el('state').getAttribute('title')).toBe('paused');
    // The engine ignores sync-now while paused, so the button says so instead of doing nothing.
    expect((el('act-sync') as HTMLButtonElement).disabled).toBe(true);
    expect(el('act-sync').title).toBe('Resume sync to sync now');
    expect(el('sync-toggle').getAttribute('onclick')).toBe("act('resume')");
    applySnapshot(document, dataFor(statusWith({ state: 'offline', reason: 'no network' })));
    expect(el('state').getAttribute('title')).toBe('offline\nno network');
    expect((el('act-sync') as HTMLButtonElement).disabled).toBe(false);
    expect(el('sync-toggle').getAttribute('aria-checked')).toBe('true');
    expect(el('act-sync').classList.contains('primary')).toBe(true);
  });

  it('shows a readable recycle time with the ISO instant as its tooltip', () => {
    fixture();
    applySnapshot(document, dataFor(statusWith({ state: 'idle' }), { recycle: [{ bucket: 1_700_000_000_000, relPath: 'old.txt' }] }));
    const time = el('recycle').querySelector('time');
    expect(time?.getAttribute('title')).toBe('2023-11-14T22:13:20.000Z');
    expect(time?.getAttribute('datetime')).toBe('2023-11-14T22:13:20.000Z');
  });

  it('shows the plugin version below Folders in sync, like the other stats, and leaves it out when unknown', () => {
    fixture();
    const keys = (side: number): string[] => Array.from(el('lines').querySelectorAll('.half')[side]?.querySelectorAll('.k') ?? []).map((k) => k.textContent).filter((k) => k.trim() !== '');
    const value = (label: string): string | undefined => {
      const k = Array.from(el('lines').querySelectorAll('.k')).find((e) => e.textContent === label);
      return k?.nextElementSibling?.textContent ?? undefined;
    };
    applySnapshot(document, dataFor(statusWith({ state: 'idle' }), { version: '0.2.6' }));
    expect(keys(1).slice(-2)).toEqual(['Folders in sync', 'Plugin']);
    expect(value('Plugin')).toBe('v0.2.6');
    // Beside Files skipped when that row is there.
    applySnapshot(document, dataFor(statusWith({ state: 'idle', counts: { ...statusWith({}).counts, protonDocuments: 2 } }), { version: '1<2&3' }));
    expect(keys(1).at(-1)).toBe('Plugin');
    expect(keys(0).at(-1)).toBe('Files skipped');
    expect(value('Plugin')).toBe('v1<2&3');
    expect(el('lines').innerHTML).toContain('v1&lt;2&amp;3');
    applySnapshot(document, dataFor(statusWith({ state: 'idle' }), { version: null }));
    expect(keys(1)).not.toContain('Plugin');
  });

  it('offers only dismiss for a delete-versus-edit conflict, sent as keep both', () => {
    fixture();
    applySnapshot(document, dataFor(statusWith({ state: 'attention' }), {
      conflicts: [{ id: 7, relPath: 'kept.txt', kind: 'delete_vs_edit', local: { deleted: true }, remote: { size: 2 } }],
    }));
    const html = el('conflicts').innerHTML;
    expect(html).toContain("choice:'keep_both'");
    expect(html).not.toContain("choice:'keep_local'");
    expect(html).not.toContain("choice:'keep_remote'");
    // The edit is already on both sides, so the one button just clears the row.
    const buttons = Array.from(el('conflicts').querySelectorAll<HTMLButtonElement>('td.actions-cell button'));
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['Dismiss']);
  });

  it('never leaves the page a blank shell: even a fresh status fills the fields', () => {
    fixture();
    applySnapshot(document, { status: statusWith({ counts: { baseline: 2, localFiles: 2, remoteFiles: 2, pairedFiles: 2, pairedFolders: 0, protonDocuments: 0, onlyLocal: 0, onlyRemote: 0 } }), conflicts: [], quarantine: [], recycle: [] });
    expect(el('state').textContent).not.toBe('');
    expect(el('proton-documents').querySelector('[data-rows]')?.innerHTML).toBe('');
    expect(el('transfers').querySelector('[data-rows]')?.innerHTML).toBe('');
    // An empty section hides (and disables) its filter and paging; the range sits on its own line.
    expect(control('transfers', '[data-toolbar]', HTMLElement).hidden).toBe(true);
    expect(control('transfers', '[data-footer]', HTMLElement).hidden).toBe(true);
    expect(control('transfers', '[data-filter]', HTMLInputElement).disabled).toBe(true);
    expect(control('transfers', '[data-prev]', HTMLButtonElement).disabled).toBe(true);
    expect(control('transfers', '[data-next]', HTMLButtonElement).disabled).toBe(true);
    expect(el('transfers').querySelector('.toolbar [data-pager]')).toBeNull();
    const pager = el('transfers').querySelector('[data-pager]');
    expect(pager instanceof HTMLElement && pager.hidden).toBe(true);
    expect(pager?.textContent).toBe('');
    expect(el('transfers').querySelector('h2')?.textContent).toBe('Transfers (0)');
  });

  it('lists Proton document paths on the page and leaves them out of human CLI status', () => {
    fixture();
    const status = statusWith({
      state: 'idle',
      summaryLines: ['In sync', 'Proton documents: 2 on Proton only (Docs and Sheets stay in the browser)'],
      protonDocumentPaths: ['Notes/Agenda', 'Notes/Budget'],
    });
    applySnapshot(document, dataFor(status));
    expect(el('proton-documents').textContent).toContain('Notes/Agenda');
    expect(el('proton-documents').textContent).toContain('Notes/Budget');
    // A table with a header, like the recycle bin.
    expect(el('proton-documents').querySelector('th')?.textContent).toBe('Name');
    const human = formatStatus(status).join('\n');
    expect(human).toContain('Proton documents: 2');
    expect(human).not.toContain('Notes/Agenda');
    expect(human).not.toContain('Notes/Budget');
  });

  it('shows file-run progress on the state line and a dry-run note only when asked', () => {
    fixture();
    const syncing = statusWith({
      state: 'syncing',
      progress: { done: 34, total: 5685 },
      lastSuccessfulSyncAt: 1_700_000_000_000,
      lastRunFilesCopied: 2,
    });
    applySnapshot(document, dataFor(syncing));
    // The run's fraction joins the state (shown in capitals: SYNCING (34/5685)); there is no separate line.
    expect(el('state').textContent).toBe('syncing (34/5685)');
    expect(document.getElementById('glance')).toBeNull();
    expect(stat('Files copied last sync')).toBe('2');
    expect(el('state').getAttribute('title')).not.toContain('Dry run');

    const paused = statusWith({ state: 'paused', progress: { done: 34, total: 5685 }, dryRun: true, degraded: true });
    applySnapshot(document, dataFor(paused));
    expect(el('state').textContent).toBe('paused (34/5685)');
    // Without a file run, the state stands alone.
    applySnapshot(document, dataFor(statusWith({ state: 'syncing', progress: null })));
    expect(el('state').textContent).toBe('syncing');
    applySnapshot(document, dataFor(paused));
    expect(el('state').getAttribute('title')).toContain('Dry run');
    expect(el('state').getAttribute('title')).toContain('The event stream is degraded');
  });

  it('alternates the state line between the state and its details, like the Wi-Fi panel', () => {
    fixture();
    const shown = (): [string | null, string | null] => [el('state').textContent, el('state').getAttribute('data-tone')];
    // An error: the state, then the reason as a short phrase without the path. Both in the error tone.
    applySnapshot(document, dataFor(statusWith({ state: 'error', reason: 'sync_root_missing: Sync root is unavailable: /home/u/Drive' })));
    expect(shown()).toEqual(['error', 'danger']);
    advanceStatus(document);
    expect(shown()).toEqual(['sync folder is missing', 'danger']);
    advanceStatus(document);
    expect(shown()).toEqual(['error', 'danger']);
    // The engine's exact words, path and all, are on hover.
    expect(el('state').getAttribute('title')).toBe('error\nsync_root_missing: Sync root is unavailable: /home/u/Drive');
    // A refresh with the same messages keeps the current one; a change starts over.
    advanceStatus(document);
    applySnapshot(document, dataFor(statusWith({ state: 'error', reason: 'sync_root_missing: Sync root is unavailable: /home/u/Drive' })));
    expect(shown()).toEqual(['sync folder is missing', 'danger']);
    applySnapshot(document, dataFor(statusWith({ state: 'needs_login', reason: 'session rejected' })));
    expect(shown()).toEqual(['needs login', 'danger']);
    advanceStatus(document);
    expect(shown()).toEqual(['sign in to proton again', 'danger']);
    // Warnings take the warning tone; offline never shows the engine's IDs, only on hover.
    applySnapshot(document, dataFor(statusWith({ state: 'offline', reason: 'getaddrinfo ENOTFOUND drive-api.proton.me' })));
    expect(shown()).toEqual(['offline', 'warn']);
    advanceStatus(document);
    expect(shown()).toEqual(["can't reach proton", 'warn']);
    expect(el('state').getAttribute('title')).toBe('offline\ngetaddrinfo ENOTFOUND drive-api.proton.me');
    // Outside offline, a reason the page does not know shows as sent.
    applySnapshot(document, dataFor(statusWith({ state: 'error', reason: 'something unexpected' })));
    advanceStatus(document);
    expect(shown()).toEqual(['something unexpected', 'danger']);
    // Dry run and a degraded stream join the rotation, in the warning tone, after a normal state.
    applySnapshot(document, dataFor(statusWith({ state: 'idle', dryRun: true, degraded: true })));
    expect(shown()).toEqual(['idle', 'normal']);
    advanceStatus(document);
    expect(shown()).toEqual(['dry run', 'warn']);
    advanceStatus(document);
    expect(shown()).toEqual(['event stream degraded', 'warn']);
    advanceStatus(document);
    expect(shown()).toEqual(['idle', 'normal']);
    // One message: nothing to alternate.
    applySnapshot(document, dataFor(statusWith({ state: 'syncing', progress: { done: 3, total: 10 } })));
    advanceStatus(document);
    expect(shown()).toEqual(['syncing (3/10)', 'normal']);
  });

  it('turns each engine reason it knows into a short phrase', () => {
    // A fresh page each time: the same messages twice in a row would keep their place.
    const phrase = (state: EngineStatus['state'], reason: string): string | null => {
      fixture();
      applySnapshot(document, dataFor(statusWith({ state, reason })));
      advanceStatus(document);
      return el('state').textContent;
    };
    expect(phrase('error', 'sync root unavailable')).toBe('sync folder is missing');
    expect(phrase('error', 'sync_root_changed: sync root /x is a different directory than at setup (dev/ino 1/2 vs 3/4)')).toBe('sync folder was replaced');
    expect(phrase('error', 'remote_root_missing: remote root abc cannot be found')).toBe('proton drive folder is missing');
    expect(phrase('error', 'remote_root_changed: remote root abc is trashed')).toBe('proton drive folder was trashed or replaced');
    expect(phrase('error', 'disk_space_low: 5 bytes free, plan needs 9 plus 1 margin')).toBe('not enough disk space');
    expect(phrase('error', 'disk full')).toBe('not enough disk space');
    expect(phrase('error', 'store_corrupt: page 4 is bad')).toBe('sync database is damaged');
    expect(phrase('needs_login', 'no stored session')).toBe('sign in to proton again');
    expect(phrase('throttled', 'server asked us to slow down')).toBe('proton asked us to slow down');
    // Remote errors, by how they end: the operation and IDs in front are left out.
    expect(phrase('offline', 'events for scope Y2xr: connection failed')).toBe("can't reach proton");
    expect(phrase('offline', 'get node -00Y~o8: timed out')).toBe("can't reach proton");
    expect(phrase('offline', 'upload Notes/today.md: server error 503')).toBe('proton is having trouble');
    expect(phrase('offline', 'list folder abc: rate limited')).toBe('proton asked us to slow down');
    expect(phrase('offline', 'get node abc: response exceeded the size limit')).toBe('unexpected response from proton');
    expect(phrase('error', 'move abc: server error 502')).toBe('proton is having trouble');
  });

  it('formats dates in the locale it is given, not the browser\'s', () => {
    fixture();
    const status = statusWith({ lastSuccessfulSyncAt: 1_700_000_000_000, lastRunFilesCopied: 1_234 });
    applySnapshot(document, { ...dataFor(status), locale: 'en-GB' });
    expect(stat('Last sync')).toBe(new Date(1_700_000_000_000).toLocaleString('en-GB'));
    applySnapshot(document, { ...dataFor(status), locale: 'de-DE' });
    expect(stat('Files copied last sync')).toBe('1.234');
    // No paths known: no path rows.
    expect(stat('Local path')).toBeNull();
    // Skipped files: just the count, in the left half, only when there are some.
    expect(stat('Files skipped')).toBeNull();
    applySnapshot(document, dataFor(statusWith({ counts: { ...status.counts, protonDocuments: 3 } })));
    expect(stat('Files skipped')).toBe('3');
    const left = el('lines').querySelectorAll('.stats > .half')[0];
    expect(Array.from(left?.querySelectorAll('.k') ?? []).map((k) => k.textContent)).toContain('Files skipped');
  });

  it('formats section counts and page ranges in that locale too', () => {
    fixture();
    const paths = Array.from({ length: 1_234 }, (_, i) => `doc-${String(i).padStart(4, '0')}`);
    const status = statusWith({ protonDocumentPaths: paths, counts: { ...statusWith({}).counts, protonDocuments: 1_234 } });
    applySnapshot(document, { ...dataFor(status), locale: 'de-DE' });
    expect(el('proton-documents').querySelector('h2')?.textContent).toBe('Skipped (1.234)');
    expect(el('proton-documents').querySelector('[data-pager]')?.textContent).toBe('1–25 of 1.234');
    const plan = { id: 'p1', reason: 'mass deletion', affected: paths };
    applySnapshot(document, { ...dataFor(statusWith({ attention: { conflicts: 0, quarantined: 0, heldPlan: plan } })), locale: 'de-DE' });
    expect(el('held').querySelector('h2')?.textContent).toBe('Held plan (1.234)');
    expect(el('held').querySelector('[data-pager]')?.textContent).toBe('1–25 of 1.234');
    const transfer = { id: 't1', kind: 'upload' as const, relPath: 'big.iso', bytes: 0, total: 10, startedAt: 0, speed: 1_234 * 1024 };
    applySnapshot(document, { ...dataFor(statusWith({ transfers: [transfer] })), locale: 'de-DE' });
    expect(el('transfers').textContent).toContain('1.234 KiB/s');
  });

  it('lists a held plan in a table like the other sections, with the full item on hover', () => {
    fixture();
    const affected = ['trash_remote Photos/2024/Trip/IMG_4100.jpg', 'recycle_local Notes/old.md'];
    applySnapshot(document, dataFor(statusWith({ attention: { conflicts: 0, quarantined: 0, heldPlan: { id: 'h1', reason: 'too many', affected } } })));
    expect(el('held').querySelector('ul')).toBeNull();
    expect(Array.from(el('held').querySelectorAll('th')).map((th) => th.textContent)).toEqual(['Name']);
    const cells = Array.from(el('held').querySelectorAll('td.fill .trunc-start'));
    expect(cells.map((c) => c.textContent)).toEqual(affected);
    expect(cells.map((c) => c.getAttribute('title'))).toEqual(affected);
    // Proceed and Reject share the filter's row, at its right end, above the list.
    const toolbar = el('held').querySelector('.toolbar');
    expect(Array.from(toolbar?.querySelectorAll('.held-actions button') ?? []).map((b) => b.textContent)).toEqual(['Proceed', 'Reject']);
    expect(toolbar?.lastElementChild?.classList.contains('held-actions')).toBe(true);
    expect(el('held').querySelectorAll('button[data-confirm], button[data-reject]')).toHaveLength(2);
    // The filter still narrows the rows.
    const input = el('held').querySelector('input[data-filter]');
    if (!(input instanceof HTMLInputElement)) throw new Error('no filter');
    input.value = 'notes';
    input.dispatchEvent(new Event('input'));
    expect(Array.from(el('held').querySelectorAll('td.fill .trunc-start')).map((c) => c.textContent)).toEqual(['recycle_local Notes/old.md']);
  });

  it('says in plain words why an item is quarantined and when, with the details on hover', () => {
    fixture();
    const at = 1_700_000_000_000;
    applySnapshot(document, dataFor(statusWith({ state: 'attention' }), {
      locale: 'en-US',
      quarantine: [
        { id: 1, relPath: 'Videos/holiday.mp4', nodeUid: 'node~1', reason: 'verification_failed', details: { error: 'SHA-1 mismatch', op: 'download' }, createdAt: at },
        { id: 2, relPath: 'Backups/db.sqlite', nodeUid: null, reason: 'unknown_outcome', details: { journalId: 4, op: 'upload', note: 'interrupted' }, createdAt: at },
        { id: 3, relPath: 'odd.bin', nodeUid: null, reason: 'something_new', details: null },
      ],
    }));
    expect(Array.from(el('quarantine').querySelectorAll('th')).map((th) => th.textContent)).toEqual(['Name', 'Quarantined', 'Release']);
    const rows = Array.from(el('quarantine').querySelectorAll('tr')).slice(1).map((tr) => Array.from(tr.querySelectorAll('td')));
    // What happened sits under the path in the dimmed second line, as in Conflicts.
    expect(rows.map((cells) => cells[0]?.querySelector('.sub')?.textContent)).toEqual(['Failed its integrity check', 'Unclear after a crash', 'something_new']);
    expect(rows.map((cells) => cells[0]?.querySelector('.trunc-start')?.textContent)).toEqual(['Videos/holiday.mp4', 'Backups/db.sqlite', 'odd.bin']);
    expect(rows.map((cells) => cells[1]?.textContent)).toEqual([new Date(at).toLocaleString('en-US'), new Date(at).toLocaleString('en-US'), '--']);
    // The node ID is no longer a column: it is with the other details, on hover.
    expect(el('quarantine').textContent).not.toContain('node~1');
    const tip = (row: number): string | null => rows[row]?.[0]?.querySelector('.sub')?.getAttribute('title') ?? null;
    expect(tip(0)).toBe('Step: Download\nError: SHA-1 mismatch\nNode: node~1\nReason: verification_failed');
    expect(tip(1)).toBe('Step: Upload\nNote: interrupted\nReason: unknown_outcome');
    expect(tip(2)).toBe('Reason: something_new');
    expect(rows[0]?.[1]?.querySelector('time')?.getAttribute('datetime')).toBe('2023-11-14T22:13:20.000Z');
    // Release is an icon button, named in its tooltip, like the conflict actions.
    const release = rows[0]?.[2]?.querySelector('button');
    expect(rows[0]?.[2]?.classList.contains('actions-cell')).toBe(true);
    // A lone action sits flush right in its column.
    expect(rows[0]?.[2]?.classList.contains('end')).toBe(true);
    expect(release?.classList.contains('icon')).toBe(true);
    expect(release?.querySelector('svg')).not.toBeNull();
    expect(release?.getAttribute('aria-label')).toBe('Release');
    expect(release?.getAttribute('title')).toBe('Release: let sync handle it again');
    expect(el('quarantine').innerHTML).toContain("act('release', {id:1})");
  });

  it('pages a long Proton document list, filters it, and keeps that place across a refresh', () => {
    fixture();
    const paths = Array.from({ length: 30 }, (_, i) => `notes/file-${String(i).padStart(2, '0')}`);
    paths[29] = 'Notes/Agenda';
    const status = statusWith({ protonDocumentPaths: paths });
    const data = dataFor(status);
    applySnapshot(document, data);

    expect(el('proton-documents').textContent).toContain('30');
    expect(el('proton-documents').textContent).toContain('notes/file-00');
    expect(el('proton-documents').textContent).toContain('notes/file-24');
    expect(el('proton-documents').textContent).not.toContain('notes/file-25');

    control('proton-documents', '[data-next]', HTMLButtonElement).click();
    expect(el('proton-documents').textContent).toContain('notes/file-25');
    expect(el('proton-documents').textContent).toContain('Notes/Agenda');
    expect(el('proton-documents').textContent).not.toContain('notes/file-00');

    const filter = control('proton-documents', '[data-filter]', HTMLInputElement);
    expect(filter.disabled).toBe(false);
    // The filter box carries a magnifier and the "Search by name…" placeholder.
    expect(filter.placeholder).toBe('Search by name…');
    expect(filter.closest('label.search')?.querySelector('svg')).not.toBeNull();
    expect(control('proton-documents', '[data-toolbar]', HTMLElement).hidden).toBe(false);
    // Under the table: the range on the left, link-style paging on the right.
    expect(control('proton-documents', '[data-footer]', HTMLElement).hidden).toBe(false);
    expect(control('proton-documents', '[data-footer] [data-pager]', HTMLElement).textContent).toBe('26–30 of 30');
    expect(control('proton-documents', '[data-prev]', HTMLButtonElement).textContent).toBe('< Previous');
    expect(control('proton-documents', '[data-next]', HTMLButtonElement).textContent).toBe('Next >');
    filter.value = 'agenda';
    filter.dispatchEvent(new Event('input'));
    expect(el('proton-documents').textContent).toContain('Notes/Agenda');
    expect(el('proton-documents').textContent).toContain('1–1 of 1');
    // The heading counts every item, not just the ones the filter shows.
    expect(el('proton-documents').querySelector('h2')?.textContent).toBe('Skipped (30)');
    expect(el('proton-documents').textContent).not.toContain('notes/file-00');
    filter.value = 'no-such-path';
    filter.dispatchEvent(new Event('input'));
    expect(el('proton-documents').textContent).toContain('nothing matches');

    filter.value = '';
    filter.dispatchEvent(new Event('input'));
    expect(el('proton-documents').textContent).toContain('notes/file-00');
    expect(el('proton-documents').textContent).not.toContain('notes/file-25');

    const broad = control('proton-documents', '[data-filter]', HTMLInputElement);
    broad.value = 'file';
    broad.dispatchEvent(new Event('input'));
    control('proton-documents', '[data-next]', HTMLButtonElement).click();
    expect(el('proton-documents').textContent).toContain('notes/file-25');
    const kept = control('proton-documents', '[data-filter]', HTMLInputElement);
    kept.focus();
    applySnapshot(document, data);
    expect(el('proton-documents').querySelector('[data-filter]')).toBe(kept);
    expect(kept.value).toBe('file');
    expect(el('proton-documents').textContent).toContain('notes/file-25');
    expect(el('proton-documents').textContent).not.toContain('notes/file-00');
  });
});

describe('clientScript', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    const timers = window as unknown as { __detailRefresh?: ReturnType<typeof setInterval>; __detailTheme?: ReturnType<typeof setInterval>; __detailStatus?: ReturnType<typeof setInterval> };
    if (timers.__detailRefresh !== undefined) window.clearInterval(timers.__detailRefresh);
    if (timers.__detailTheme !== undefined) window.clearInterval(timers.__detailTheme);
    if (timers.__detailStatus !== undefined) window.clearInterval(timers.__detailStatus);
    document.documentElement.classList.remove('omarchy');
  });

  it('shows an action error and clears it after the next success', async () => {
    fixture();
    let pauses = 0;
    const snapshot = dataFor(statusWith({ state: 'idle' }));
    vi.stubGlobal('fetch', (input: string) => {
      const url = input;
      if (url.endsWith('/api/state')) return Promise.resolve({ ok: true, json: () => Promise.resolve(snapshot) });
      if (url.endsWith('/api/theme')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ css: '' }) });
      pauses += 1;
      if (pauses === 1) return Promise.resolve({ ok: false, json: () => Promise.resolve({ ok: false, error: 'refused' }) });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
    });
    window.eval(clientScript());
    await new Promise((resolve) => setTimeout(resolve, 0));
    await (window as unknown as { act: (name: string) => Promise<void> }).act('pause');
    expect(el('action-error').textContent).toBe('refused');
    expect(el('action-error').hidden).toBe(false);
    await (window as unknown as { act: (name: string) => Promise<void> }).act('pause');
    expect(el('action-error').textContent).toBe('');
    expect(el('action-error').hidden).toBe(true);
  });

  it('says when the engine stops answering, and recovers when it answers again', async () => {
    fixture();
    document.body.insertAdjacentHTML('afterbegin', '<p id="connection-lost" hidden></p>');
    let up = true;
    vi.stubGlobal('fetch', (url: string) => {
      if (!up) return Promise.reject(new TypeError('Failed to fetch'));
      return Promise.resolve({ ok: true, json: () => Promise.resolve(url.endsWith('/api/theme') ? { css: '' } : dataFor(statusWith({ state: 'idle' }))) });
    });
    window.eval(clientScript());
    const refresh = (window as unknown as { refresh: () => Promise<void> }).refresh;
    await refresh();
    expect(el('connection-lost').hidden).toBe(true);
    up = false;
    // One miss is not enough to raise the notice; two are.
    await refresh();
    expect(el('connection-lost').hidden).toBe(true);
    await refresh();
    expect(el('connection-lost').hidden).toBe(false);
    expect(document.body.classList.contains('stale')).toBe(true);
    up = true;
    await refresh();
    expect(el('connection-lost').hidden).toBe(true);
    expect(document.body.classList.contains('stale')).toBe(false);
  });

  it('fades the state line to its next message on a timer, and just swaps it with reduced motion', async () => {
    fixture();
    const snapshot = dataFor(statusWith({ state: 'error', reason: 'sync root unavailable' }));
    vi.stubGlobal('fetch', (url: string) => Promise.resolve({ ok: true, json: () => Promise.resolve(url.endsWith('/api/theme') ? { css: '' } : snapshot) }));
    window.eval(clientScript());
    const page = window as unknown as { refresh: () => Promise<void>; rotateStatus: () => void; __detailStatus?: unknown };
    await page.refresh();
    expect(page.__detailStatus).toBeDefined();
    expect(el('state').textContent).toBe('error');
    // Fade out, swap after 180ms, fade back in.
    page.rotateStatus();
    expect(el('state').classList.contains('fading')).toBe(true);
    expect(el('state').textContent).toBe('error');
    await new Promise((r) => setTimeout(r, 220));
    expect(el('state').textContent).toBe('sync folder is missing');
    expect(el('state').classList.contains('fading')).toBe(false);
    // Reduced motion: the message changes at once, with no fade.
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(prefers-reduced-motion: reduce)' }));
    page.rotateStatus();
    expect(el('state').classList.contains('fading')).toBe(false);
    expect(el('state').textContent).toBe('error');
  });

  it('follows a theme switch and drops the theme when it goes away', async () => {
    fixture();
    document.head.innerHTML = '<style id="omarchy-theme"></style>';
    let css = ':root { color-scheme: dark; --om-background: #2e3440; }';
    const snapshot = dataFor(statusWith({ state: 'idle' }));
    vi.stubGlobal('fetch', (url: string) =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(url.endsWith('/api/theme') ? { css } : snapshot) }));
    window.eval(clientScript());
    const refreshTheme = (window as unknown as { refreshTheme: () => Promise<void> }).refreshTheme;
    await refreshTheme();
    expect(document.getElementById('omarchy-theme')?.textContent).toBe(css);
    expect(document.documentElement.classList.contains('omarchy')).toBe(true);
    css = '';
    await refreshTheme();
    expect(document.getElementById('omarchy-theme')?.textContent).toBe('');
    expect(document.documentElement.classList.contains('omarchy')).toBe(false);
  });
});
