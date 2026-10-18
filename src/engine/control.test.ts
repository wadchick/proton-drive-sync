import { describe, expect, it } from 'vitest';

import { forShell, SHELL_LIST_LIMIT } from './control.js';
import { initialStatus, summarize } from './status.js';

/**
 * Nothing the control socket sends grows with what an editor of a shared folder
 * does: every list is cut to SHELL_LIST_LIMIT and the totals survive the cut.
 */
describe('forShell', () => {
  it('cuts the held plan, transfers and Proton document lists and keeps the totals', () => {
    const n = SHELL_LIST_LIMIT + 25;
    const docs = Array.from({ length: n }, (_, i) => `doc-${String(i)}`);
    const base = initialStatus(false, 0);
    const full = {
      ...base,
      transfers: docs.map((relPath) => ({ id: relPath, kind: 'upload' as const, relPath, bytes: 0, total: undefined, startedAt: 0, speed: 0 })),
      attention: { conflicts: 0, quarantined: 0, heldPlan: { id: 'held-1', reason: 'too many', affected: docs.map((d) => `recycle_local ${d}`) } },
      protonDocumentPaths: docs,
      protonDocumentModifiedAt: Object.fromEntries(docs.map((d, i) => [d, i])),
    };
    const shell = forShell({ ...full, summaryLines: summarize(full) });
    expect(shell.attention.heldPlan?.affected).toHaveLength(SHELL_LIST_LIMIT);
    expect(shell.attention.heldPlan?.affectedTotal).toBe(n);
    expect(shell.transfers).toHaveLength(SHELL_LIST_LIMIT);
    expect(shell.protonDocumentPaths).toHaveLength(SHELL_LIST_LIMIT);
    expect(Object.keys(shell.protonDocumentModifiedAt)).toHaveLength(SHELL_LIST_LIMIT);
    // The engine's own status is untouched: in-process readers still see everything.
    expect(full.attention.heldPlan.affected).toHaveLength(n);
  });

  it('leaves a status without a held plan alone', () => {
    const base = initialStatus(false, 0);
    expect(forShell(base)).toEqual(base);
  });
});
