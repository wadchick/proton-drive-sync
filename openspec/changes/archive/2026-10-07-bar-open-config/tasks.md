## 1. Doctor report

- [x] 1.1 Add `configFile` to `DoctorReport` and to the `doctorReport` allowlist in `src/cli/commands.ts`. Set it to `deps.ctx.paths.configFile` when a config is loaded, and to null otherwise. Add the human line `Config file: <path>` or `Config file: -`. Verify `src/cli/cli.test.ts`: `doctor --json` with no config has `configFile: null`; after `setup`, `configFile` equals `deps.ctx.paths.configFile`; the `doctorReport` fixture includes `configFile` and still drops `session`.

## 2. Bar panel

- [x] 2.1 In `omarchy/Panel.qml`, add Open config immediately after Open details in the existing row. Show it when `doctor.configFile` is a non-empty string, include that field in the row's visibility check, and open it with `openExternal`. Leave Open details visible only when `detailUrl` is set. Do not add a function to `Service.qml`. Verify `src/cli/omarchyShell.test.ts` finds `Open config` and `openExternal(root.service.doctor.configFile)` after the Open details click.

## 3. README

- [x] 3.1 In the Day to day section of `README.md`, replace "Open folder and Open details show up while the engine is running." with "Open folder and Open config show up once a sync pair is saved. Open details shows up while the engine is running." Leave the rest of that section unchanged. Verify the new sentence is present and the old sentence is gone.

## 4. Check

- [x] 4.1 Run `npx vitest run --project unit src/cli/cli.test.ts src/cli/omarchyShell.test.ts src/cli/omarchyReadme.test.ts` and `npx tsc -p tsconfig.json --noEmit`. Confirm both pass, and confirm `src/tray/` is unchanged.
