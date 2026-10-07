import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');
const service = readFileSync(path.join(root, 'omarchy/Service.qml'), 'utf8');
const bar = readFileSync(path.join(root, 'omarchy/BarWidget.qml'), 'utf8');
const panel = readFileSync(path.join(root, 'omarchy/Panel.qml'), 'utf8');

describe('shell sources', () => {
  it('the service polls with argument arrays and never starts the engine', () => {
    expect(service).not.toMatch(/bash|-c|"run"|'run'/);
    expect(service).toContain('["doctor", "--json"]');
    expect(service).toContain('["omarchy-launch-tui", root.launcherPath, "login"]');
    expect(service).toContain('installed-by=io.github.zakkoo.proton-drive');
    expect(service).not.toContain('sudo');
  });

  it('runs long engine actions in their own process, so pause and polling never wait behind a sync', () => {
    // sync-now answers only after a whole cycle; pause must not queue behind it.
    expect(service).toContain('readonly property var longKinds: ["sync", "held", "resolve"]');
    expect(service).toMatch(/id: longCli[\s\S]*root\.handle\(root\.longKind/);
    expect(service).toContain('function pause() { root.enqueue(["pause", "--json"], "pause") }');
    expect(service).toContain('function resume() { root.enqueue(["resume", "--json"], "resume") }');
    expect(service).toContain('function syncNow() { root.enqueue(["sync-now", "--json"], "sync") }');
  });

  it('the bar widget has no process of its own and names the built-in bar', () => {
    expect(bar).not.toMatch(/\bProcess\b/);
    expect(bar).not.toMatch(/"run"|'run'/);
    expect(bar).toContain('Proton Drive needs the built-in Omarchy bar');
    expect(bar).toContain('serviceFor("io.github.zakkoo.proton-drive")');
  });

  it('opening the panel does not sign in or write a setup', () => {
    expect(panel).not.toMatch(/Component\.onCompleted/);
    const open = /function open\(\) \{[^}]*\}/.exec(panel);
    expect(open?.[0] ?? '').not.toMatch(/signIn|submitSetup/);
    expect(panel).toContain('onClicked: root.service.signIn()');
    expect(panel).toContain('onClicked: root.service.submitSetup(root.localDraft, root.remoteDraft)');
  });

  it('offers Open config immediately after Open details', () => {
    const details = panel.indexOf('onClicked: root.service.openExternal(root.service.doctor.detailUrl)');
    const config = panel.indexOf('onClicked: root.service.openExternal(root.service.doctor.configFile)');
    expect(panel).toContain('Open config');
    expect(details).toBeGreaterThan(-1);
    expect(config).toBeGreaterThan(details);
  });

  it('shows a few conflicts and links to the details page for the rest, opening nothing by itself', () => {
    expect(panel).toContain('readonly property int listLimit: 4');
    expect(panel).toContain('model: Math.min(root.conflicts.length, root.listLimit)');
    expect(panel).toContain('MoreLink { total: root.conflicts.length }');
    // The overflow link opens the details page only when clicked.
    const more = /component MoreLink: Button \{[\s\S]*?\n {2}\}/.exec(panel)?.[0] ?? '';
    expect(more).toContain('" more in details"');
    expect(more).toContain('onClicked: root.openDetails()');
    expect(panel.match(/openExternal\(root\.doctor\.detailUrl\)/g), 'the details page opens from one place').toHaveLength(1);
    expect(panel).not.toMatch(/on[A-Z]\w*Changed:[^\n]*openDetails/);
    expect(panel).not.toContain('root.service.conflicts.length');
  });

  // Upstream's cut-off tooltips (9cc3838) were written for the previous panel. The redesigned
  // panel also cuts text (file names, paths) and still needs the same tooltips before its PR.
  it.todo('shows the full text in a tooltip when a line is cut off (redesigned panel)');

  it('shows the installed engine version without putting it on the chip', () => {
    const openRow = panel.indexOf('text: "Open config"');
    const version = panel.indexOf('text: "Version " + root.service.doctor.version');
    expect(panel).toContain('Version');
    expect(panel).toContain('doctor.version');
    expect(version).toBeGreaterThan(openRow);
    expect(bar).toContain('root.chip.label');
  });
});
