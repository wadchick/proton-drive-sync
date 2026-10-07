# Tasks

## 1. Package version reader

- [x] 1.1 Add `packageVersion()` in `src/version.ts`, plus a reader that accepts a start directory. Walk up at most six directories from that start. Accept the first `package.json` whose `name` is `proton-drive-sync` and whose `version` is a non-empty string of at most 32 characters matching `[0-9A-Za-z.+-]`. Return null for a missing file, invalid JSON, a different name, or a rejected version. `packageVersion()` starts at the directory of its own module URL. Verify a unit test: the repo `package.json` version is returned, and temp directories cover a missing file, invalid JSON, a wrong `name`, and a version that fails the character rule.

## 2. Doctor report

- [x] 2.1 Add `version: string | null` to `DoctorReport` and to the `doctorReport` allowlist in `src/cli/commands.ts`. Set it from `packageVersion()` on every report, including when no config is loaded. Add the human line `Version: <version>` or `Version: -`. Verify `src/cli/cli.test.ts`: with nothing configured, `doctor --json` has `version` equal to the repo package version and the human output contains that line; the `doctorReport` fixture copies `version` and still drops `session`.

## 3. Bar panel

- [x] 3.1 In `omarchy/Panel.qml`, after the open row, add a `Text` whose text is `Version` plus a space plus `doctor.version`. Show it only when that field is a non-empty string. Use `Style.font.bodySmall` and `barForeground`. Do not change `BarWidget.qml`, `Model.js`, or `Service.qml`. Verify `src/cli/omarchyShell.test.ts` finds `Version` and `doctor.version` in the panel source, and that `BarWidget.qml` still sets the chip text from `root.chip.label`.

## 4. Details page

- [x] 4.1 In `src/tray/detailPage.ts`, export a document builder that takes `string | null`. When the version is a string, put a muted paragraph under the `h1`: `Version` plus a space plus the HTML-escaped version. When it is null, omit that paragraph and keep the title. Serve the document built from `packageVersion()`. Do not add the version to `/api/state`, and do not render it from `src/tray/detailView.ts`. Verify `src/tray/tray.test.ts`: the served HTML contains `Version` and the repo package version after `Proton Drive Sync`. Verify a direct call with null omits the version paragraph and still contains `Proton Drive Sync`, and that `detailView.ts` does not contain `Version`.

## 5. Check

- [x] 5.1 Run `npx vitest run --project unit src/version.test.ts src/cli/cli.test.ts src/cli/omarchyShell.test.ts src/tray/tray.test.ts` and `npx tsc -p tsconfig.json --noEmit`. Confirm both pass. Confirm `APP_VERSION` in `src/remote/proton/bootstrap.ts` is still `external-drive-sdkclijs@0.1.0`.
