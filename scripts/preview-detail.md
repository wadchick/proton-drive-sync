# Details page previews

A preview tool that shows the Proton Drive Sync details page in any state (a held plan, each kind of conflict, paging, offline, and so on) without a running sync engine and without touching any files.

The page, its script, its server and the Omarchy theme are the real ones. Only the engine behind them is fake, so what you see is what users see.

## Run it

From the repository root:

```bash
npx vite-node scripts/preview-detail.ts                # all 13 scenarios
npx vite-node scripts/preview-detail.ts held paging    # only the ones named
```

It prints one address per scenario and keeps running until you press **Ctrl+C**.

- Each scenario always uses the same port, 47800–47812 in the order below. The secret part of the address changes on every run, so copy the addresses from the output.
- The previews follow the current Omarchy theme and icon set, like the real page.
- `vite-node` is one of the project's dev dependencies. If `node_modules` is missing, run `npm ci` first.

## Scenarios

| Name         | Port  | Shows                                                                                    |
| ------------ | ----- | ---------------------------------------------------------------------------------------- |
| `idle`       | 47800 | In sync, with some skipped and recycled files                                            |
| `held`       | 47801 | A 63-file held plan (mass-deletion brake), with paging, Proceed and Reject               |
| `conflicts`  | 47802 | One conflict of each kind, including both delete-vs-edit directions and a very long path |
| `quarantine` | 47803 | Two quarantined items (failed integrity check, unclear after a crash)                    |
| `transfers`  | 47804 | Uploads and downloads in progress, with the sync progress line                           |
| `paging`     | 47805 | 60 recycled and 30 skipped items, so Previous/Next become active                         |
| `paused`     | 47806 | Paused by the user                                                                       |
| `offline`    | 47807 | No network connection                                                                    |
| `error`      | 47808 | The sync folder is missing                                                               |
| `login`      | 47809 | The Proton session expired                                                               |
| `dryrun`     | 47810 | Dry-run mode with a degraded event stream                                                |
| `empty`      | 47811 | A fresh install: nothing synced yet, no paths                                            |
| `lost`       | 47812 | The engine stops 6 seconds after you open the page, to show the "Lost connection" notice |

## What the buttons do

They act on the fake data only:

- **Proceed / Reject** (held plan) clears the held plan.
- **Resolve icons** (conflicts) remove that conflict. The terminal logs which choice was picked.
- **Release** (quarantine) removes that item.
- **Sync switch** pauses and resumes.
- **Sync now** updates "Last sync".

To start a scenario over, stop the tool with Ctrl+C and run it again.

## Troubleshooting

**"Port 478xx is already in use"**: another preview is still running, perhaps in another terminal or left from an earlier session. Stop it with Ctrl+C in its terminal. If you can't find it, `ss -ltnp | grep 478` shows which process holds the ports (the `pid=` value), and `kill <pid>` stops it.

## Changing or adding scenarios

The scenarios are defined in [`preview-detail.ts`](preview-detail.ts), in the `SCENARIOS` list near the top. Each one sets the engine status plus any conflicts, quarantine items and recycled files. Copy an existing entry to add a new one. The new scenario gets the next port after the last one.
