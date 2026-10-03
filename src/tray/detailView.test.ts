// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { formatStatus } from '../cli/output.js';
import { glanceText, initialStatus, type EngineStatus } from '../engine/status.js';
import { applySnapshot, clientScript, type DetailData } from './detailView.js';

/**
 * The detail page renders the live snapshot into the visible DOM — not just a
 * JSON endpoint (spec: tray-status-ui / Detail page is a live view). A loaded
 * page for a running engine must show state, counts and lists, never a blank
 * shell.
 */

function fixture(): void {
  document.body.innerHTML = `
    <span id="state"></span><span id="reason"></span><span id="glance"></span>
    <button id="sync-toggle" role="switch" aria-checked="true"></button><button id="act-sync"></button>
    <p id="flags"></p><p id="action-error" hidden></p>
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
    // Proton documents show their full path under the Proton Drive folder.
    applySnapshot(document, { ...data, status: { ...status, protonDocumentPaths: ['Notes/Agenda', 'Undated'], protonDocumentModifiedAt: { 'Notes/Agenda': 1_700_000_000_000 } } });
    const docCells = Array.from(el('proton-documents').querySelectorAll('td')).map((td) => td.textContent);
    expect(Array.from(el('proton-documents').querySelectorAll('th')).map((th) => th.textContent)).toEqual(['Modified', 'Path']);
    expect(docCells).toEqual([shown, '/my-files/Sync/Notes/Agenda', '--', '/my-files/Sync/Undated']);
    applySnapshot(document, data);
    // Each section opens with a line saying what it holds; the recycle bin names its folder.
    expect(el('recycle').querySelector('[data-intro]')?.textContent).toBe('Local files moved aside instead of deleted or overwritten, kept in /home/u/Drive/.proton-sync/recycle. Copy one back to restore it.');
    for (const id of ['conflicts', 'quarantine', 'transfers', 'proton-documents']) expect(el(id).querySelector('[data-intro]')?.textContent).not.toBe('');
    expect(el('proton-documents').querySelector('[data-rows]')?.innerHTML).toBe('');
    expect(el('conflicts').innerHTML).toContain('c.txt');
    expect(el('conflicts').textContent).toContain('1 B');
    expect(el('conflicts').textContent).toContain('"size": 1');
    expect(el('conflicts').innerHTML).toContain("choice:'keep_local'");
    expect(el('conflicts').innerHTML).toContain("choice:'keep_remote'");
    expect(el('conflicts').innerHTML).toContain("choice:'keep_both'");
    const recycled = el('recycle').querySelector('time');
    expect(recycled?.textContent).toBe(shown);
    expect(recycled?.getAttribute('datetime')).toBe('2023-11-14T22:13:20.000Z');
    expect(el('recycle').innerHTML).toContain('old.txt');
    expect(el('quarantine').querySelector('[data-rows]')?.innerHTML).toBe('');
    expect(el('flags').textContent).toBe('');
  });

  it('shows sync on/off on the switch and makes Sync now the call to action only when needed', () => {
    fixture();
    applySnapshot(document, dataFor(statusWith({ state: 'idle' })));
    expect(el('sync-toggle').getAttribute('aria-checked')).toBe('true');
    expect(el('sync-toggle').getAttribute('onclick')).toBe("act('pause')");
    expect(el('act-sync').classList.contains('primary')).toBe(false);
    expect((el('act-sync') as HTMLButtonElement).disabled).toBe(false);
    applySnapshot(document, dataFor(statusWith({ state: 'paused', reason: 'paused by user' })));
    expect(el('sync-toggle').getAttribute('aria-checked')).toBe('false');
    expect(el('reason').textContent).toBe('');
    // The engine ignores sync-now while paused, so the button says so instead of doing nothing.
    expect((el('act-sync') as HTMLButtonElement).disabled).toBe(true);
    expect(el('act-sync').title).toBe('Resume sync to sync now');
    expect(el('sync-toggle').getAttribute('onclick')).toBe("act('resume')");
    applySnapshot(document, dataFor(statusWith({ state: 'offline', reason: 'no network' })));
    expect(el('reason').textContent).toBe('no network');
    expect((el('act-sync') as HTMLButtonElement).disabled).toBe(false);
    expect(el('sync-toggle').getAttribute('aria-checked')).toBe('true');
    expect(el('act-sync').classList.contains('primary')).toBe(true);
  });

  it('never leaves the page a blank shell: even a fresh status fills the fields', () => {
    fixture();
    applySnapshot(document, { status: statusWith({ counts: { baseline: 2, localFiles: 2, remoteFiles: 2, pairedFiles: 2, pairedFolders: 0, protonDocuments: 0, onlyLocal: 0, onlyRemote: 0 } }), conflicts: [], quarantine: [], recycle: [] });
    expect(el('state').textContent).not.toBe('');
    expect(el('proton-documents').querySelector('[data-rows]')?.innerHTML).toBe('');
    expect(el('transfers').querySelector('[data-rows]')?.innerHTML).toBe('');
    // An empty section hides (and disables) its filter and paging; the range sits on its own line.
    expect(control('transfers', '[data-toolbar]', HTMLElement).hidden).toBe(true);
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
    expect(el('proton-documents').querySelector('th')?.textContent).toBe('Modified');
    const human = formatStatus(status).join('\n');
    expect(human).toContain('Proton documents: 2');
    expect(human).not.toContain('Notes/Agenda');
    expect(human).not.toContain('Notes/Budget');
  });

  it('shows the glance string while a file run is moving and a dry-run note only when asked', () => {
    fixture();
    const syncing = statusWith({
      state: 'syncing',
      progress: { done: 34, total: 5685 },
      lastSuccessfulSyncAt: 1_700_000_000_000,
      lastRunFilesCopied: 2,
    });
    applySnapshot(document, dataFor(syncing));
    expect(el('glance').textContent).toBe(glanceText(syncing));
    expect(el('glance').textContent).toBe('Sync (34/5685)');
    expect(stat('Files copied last sync')).toBe('2');
    expect(el('flags').textContent).not.toContain('Dry run');

    const paused = statusWith({ state: 'paused', progress: { done: 34, total: 5685 }, dryRun: true, degraded: true });
    applySnapshot(document, dataFor(paused));
    expect(el('glance').textContent).toBe(glanceText(paused));
    expect(el('glance').textContent).toBe('Paused (34/5685)');
    expect(el('flags').textContent).toContain('Dry run');
    expect(el('flags').textContent).toContain('The event stream is degraded');
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
    expect(control('proton-documents', '[data-toolbar]', HTMLElement).hidden).toBe(false);
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
    const timers = window as unknown as { __detailRefresh?: ReturnType<typeof setInterval>; __detailTheme?: ReturnType<typeof setInterval> };
    if (timers.__detailRefresh !== undefined) window.clearInterval(timers.__detailRefresh);
    if (timers.__detailTheme !== undefined) window.clearInterval(timers.__detailTheme);
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
