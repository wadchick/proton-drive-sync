# Design

## Context

See proposal.md for why the version should be visible. The chip label in `omarchy/BarWidget.qml` is the glance string from `omarchy/Model.js` (`Sync (done/total)`, the idle word, and the other state words). The panel in `omarchy/Panel.qml` already polls `doctor --json` and keeps the whole report on `service.doctor`. `doctorReport` is an allowlist: `nodeOk`, `configured`, `loggedIn`, `running`, `localRoot`, `remoteRoot`, `configFile`, `detailUrl`. The details page is the HTML document in `src/tray/detailPage.ts`, served by the running engine. Its header is a card whose title is `Proton Drive Sync`. The client script refreshes the snapshot into the page and does not replace that document.

The production build is one esbuild bundle, `dist/cli/main.js`. `scripts/install-engine` copies `package.json` to the runtime root, next to `dist/`, and the launcher runs that bundle. Vitest runs the TypeScript sources, where `package.json` is the repo root. `manifest.json` is not copied into the runtime. `APP_VERSION` in `src/remote/proton/bootstrap.ts` is the Proton API client identity and stays `external-drive-sdkclijs@0.1.0`.

## Goals / Non-Goals

**Goals:**

- One reader for the package version, used by `doctor` and by the details page.
- A panel line bound to the doctor field, with no new function on `Service.qml`.
- A version line in the details-page header that survives a snapshot refresh.

**Non-Goals:**

- Putting the version on the chip label, in the chip tooltip, or in the tray menu.
- Adding the version to the shared live snapshot, human CLI status, or the README.
- Showing the plugin manifest version when it differs from the installed engine.
- Changing `APP_VERSION`.

## Decisions

1. **Walk up from the running module to this package's `package.json`.** Add `packageVersion()` in `src/version.ts`. Start at the directory of `import.meta.url` and walk up at most six directories. Accept the first `package.json` whose `name` is `proton-drive-sync` and whose `version` is a non-empty string of at most 32 characters matching `[0-9A-Za-z.+-]`. Otherwise return null. That walk finds the repo root from a source module under Vitest, and the runtime root from the bundled `dist/cli/main.js`. A missing file, invalid JSON, or a rejected version is null.

   Alternative: a path fixed at `../../package.json` from the source file. Rejected because the bundle collapses every module into `dist/cli/main.js`, so a source-relative path would miss the runtime `package.json`.

   Alternative: bake the version with an esbuild `define`. Rejected because Vitest would not see that define, so the tests and the installed engine could disagree about where the number comes from.

   Alternative: read `manifest.json`. Rejected because the runtime copy does not include it.

2. **`doctor` reports that value, whether or not a config exists.** Add `version: string | null` to `DoctorReport` and copy it in `doctorReport`. Set it from `packageVersion()` on every report. The human line is `Version: 0.2.1` or `Version: -`, beside the existing lines. The allowlist still drops `session`.

   Alternative: hardcode the number in `Panel.qml` from the plugin manifest. Rejected because a plugin update does not rebuild the engine, so the panel would show a version the running tool does not have. `doctor` runs through the installed launcher, so it names the engine that is installed.

3. **The panel binds `doctor.version` and leaves the chip alone.** After the open row in `omarchy/Panel.qml`, add a `Text` whose text is `Version` plus a space plus `doctor.version`. Show it only when that field is a non-empty string. Use `Style.font.bodySmall` and `barForeground`. Do not change `BarWidget.qml`, `Model.js`, or `Service.qml`.

4. **The details page writes the line into the document, not into the snapshot.** When `packageVersion()` returns a string, the header card in `src/tray/detailPage.ts` contains a muted paragraph under the `h1`: `Version` plus a space plus that version. Escape the version for HTML. When it returns null, omit the paragraph. The client script does not render this line, so a snapshot refresh cannot remove it. Do not add a version field to `/api/state`.

5. **Tests lock the number, the allowlist, and the two surfaces.** A unit test of `packageVersion()` reads the repo `package.json` and returns its `version`, and returns null for a missing file, invalid JSON, a wrong `name`, and a version that fails the character rule. Extend the doctor test in `src/cli/cli.test.ts`: `doctor --json` includes `version` equal to that package version even when nothing is configured, the human line contains it, and the `doctorReport` fixture copies `version` and still drops `session`. `src/cli/omarchyShell.test.ts` asserts the panel source contains `Version` and `doctor.version`, and that `BarWidget.qml` still sets the chip text from `root.chip.label`. The details-page test in `src/tray/tray.test.ts` asserts the served HTML contains `Version` and the package version under the title text. A direct call that builds the document with a null version asserts the version paragraph is absent and `Proton Drive Sync` remains.

## Risks / Trade-offs

- [The panel is newer than the installed engine, so `doctor` has no `version`] → The line stays hidden. An older panel ignores the extra field.
- [The user installs a new engine and does not restart the service] → The panel shows the installed package, because `doctor` runs the new launcher. The details page shows the process that is still serving it. The two lines can differ until `systemctl --user restart proton-drive-sync.service`. That difference is the signal that the running process is old.
- [A parent directory also has a `package.json`] → The walk accepts only `name` equal to `proton-drive-sync`, and it stops after six directories.
- [The version is interpolated into HTML] → The character rule rejects `<`, quotes, and whitespace, and the page escapes the string anyway.

## Migration Plan

No stored data changes. Rollback is removing the panel line and the header paragraph. A newer panel treats a missing `version` as no line.
