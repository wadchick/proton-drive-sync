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
});
