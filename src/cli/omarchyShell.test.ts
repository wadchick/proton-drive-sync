import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');
const service = readFileSync(path.join(root, 'omarchy/Service.qml'), 'utf8');
const bar = readFileSync(path.join(root, 'omarchy/BarWidget.qml'), 'utf8');
const panel = readFileSync(path.join(root, 'omarchy/Panel.qml'), 'utf8');

describe('shell sources', () => {
  it('the service runs the committed engine through the shipped launcher with argument arrays', () => {
    expect(service).not.toMatch(/bash|-c|npm|systemctl/);
    expect(service).toContain('readonly property string launcherPath: pluginDir + "/bin/proton-drive-sync"');
    expect(service).toContain('["doctor", "--json"]');
    expect(service).toContain('engine.command = [root.launcherPath, "run", "--no-tray"]');
    expect(service).toContain('["omarchy-launch-tui", root.launcherPath, "login"]');
    expect(service).not.toContain('sudo');
  });

  it('starts the engine only once signed in and configured, and gives up after a crash budget', () => {
    expect(service).toMatch(/if \(!d \|\| d\.loggedIn !== true \|\| d\.configured !== true \|\| d\.running === true\) return/);
    expect(service).toContain('if (exitCode === 0 && exitStatus === 0) return');
    expect(service).toContain('readonly property int maxRestarts: 5');
    expect(service).toContain('root.engineFailed = true');
    expect(panel).toContain('onClicked: root.service.retryEngine()');
    expect(panel).not.toMatch(/Install engine|install-engine/);
  });

  it('cleans up a pre-0.3.0 engine once, with the marker-checked script only', () => {
    expect(service).toContain('command: [root.pluginDir + "/scripts/remove-engine"]');
    expect(service).toContain('Component.onCompleted: legacyCleanup.running = true');
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

  it('shows at most five conflicts and opens the details page for the rest', () => {
    expect(panel).toContain('readonly property int conflictLimit: 5');
    expect(panel).toContain('Math.min(root.conflictCount, root.conflictLimit)');
    expect(panel).toContain('function offerDetailsForOverflow()');
    expect(panel).toContain('more on the details page');
    expect(panel).not.toContain('root.service.conflicts.length');
  });

  it('shows the full text in a tooltip when a line is cut off', () => {
    expect(panel).toContain('component ElidedText');
    expect(panel).toContain('visible: lineHover.hovered && line.truncated');
    expect(panel).toContain('visible: pairHover.hovered && pairValue.truncated');
    expect(panel).toContain('Style.space(440)');
    expect(panel).toContain('iconSize: Style.font.body');
  });

  it('shows the installed engine version without putting it on the chip', () => {
    const openRow = panel.indexOf('text: "Open config"');
    const version = panel.indexOf('text: "Version " + root.service.doctor.version');
    expect(panel).toContain('Version');
    expect(panel).toContain('doctor.version');
    expect(version).toBeGreaterThan(openRow);
    expect(bar).toContain('root.chip.label');
  });
});
