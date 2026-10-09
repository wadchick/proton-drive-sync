import QtQuick
import Quickshell
import Quickshell.Io
import "Model.js" as ProtonDriveModel

// Owns the engine process. The engine is the committed bundle next to this file, started
// through bin/proton-drive-sync once the user has signed in and chosen the two folders.
// Nothing is downloaded, built, or written outside the user's own data by loading this
// service. The bar reads this object through the shell's own service.
Item {
  id: root
  visible: false

  property var shell: null
  property bool panelOpen: false
  property var doctor: null
  property var status: null
  property var conflicts: []
  property var quarantine: []
  property string setupError: ""
  property var queue: []
  property string pendingKind: ""
  // Engine actions that answer only once their work is done (a whole sync cycle, a confirmed
  // plan, a resolution). They run in their own process, one at a time, so pause, resume and
  // status polling never wait behind them.
  readonly property var longKinds: ["sync", "held", "resolve"]
  property var longQueue: []
  property string longKind: ""

  // Crash budget for the engine, in the style of the shell's own supervised plugins: a clean
  // exit means another engine already owns the control socket and is not restarted.
  property int restarts: 0
  property double startedAt: 0
  property bool engineFailed: false
  readonly property int maxRestarts: 5
  readonly property int settledMs: 60000

  // file:///…/io.github.zakkoo.proton-drive/omarchy/  ->  /…/io.github.zakkoo.proton-drive/
  readonly property string pluginDir: String(Qt.resolvedUrl("..")).replace(/^file:\/\//, "")
  readonly property string launcherPath: pluginDir + "/bin/proton-drive-sync"
  readonly property var chip: ProtonDriveModel.chipModel({
    doctor: doctor,
    status: status,
    engineFailed: engineFailed
  })

  function parseJson(body) {
    try {
      return JSON.parse(String(body || ""))
    } catch (error) {
      return null
    }
  }

  function enqueue(args, kind) {
    if (root.longKinds.indexOf(kind) !== -1) {
      var pending = root.longQueue.slice()
      pending.push({ args: args, kind: kind })
      root.longQueue = pending
      root.pumpLong()
      return
    }
    var next = root.queue.slice()
    next.push({ args: args, kind: kind })
    root.queue = next
    root.pump()
  }

  function commandFor(args) {
    var cmd = [root.launcherPath]
    for (var i = 0; i < args.length; i++) cmd.push(String(args[i]))
    return cmd
  }

  function pump() {
    if (cli.running || root.queue.length === 0) return
    var next = root.queue.slice()
    var job = next.shift()
    root.queue = next
    root.pendingKind = job.kind
    cli.command = root.commandFor(job.args)
    cli.running = true
  }

  function pumpLong() {
    if (longCli.running || root.longQueue.length === 0) return
    var next = root.longQueue.slice()
    var job = next.shift()
    root.longQueue = next
    root.longKind = job.kind
    longCli.command = root.commandFor(job.args)
    longCli.running = true
  }

  function poll() {
    if (cli.running || root.queue.length > 0) return
    root.enqueue(["doctor", "--json"], "doctor")
  }

  // Start the engine once it has something to do. Before sign-in or setup `run` would only
  // exit with an error, which must not count against the crash budget.
  function ensureEngine() {
    var d = root.doctor
    if (!d || d.loggedIn !== true || d.configured !== true || d.running === true) return
    if (engine.running || root.engineFailed) return
    engine.command = [root.launcherPath, "run", "--no-tray"]
    engine.running = true
  }

  function handle(kind, code, out, err) {
    var parsed = root.parseJson(out)
    if (kind === "doctor") {
      if (code === 0 && parsed) root.doctor = parsed
      if (root.doctor && root.doctor.running === true) {
        root.enqueue(["status", "--json"], "status")
        root.enqueue(["conflicts", "--json"], "conflicts")
        root.enqueue(["quarantine", "--json"], "quarantine")
      } else if (code === 0) {
        root.status = null
        root.conflicts = []
        root.quarantine = []
        root.ensureEngine()
      }
    } else if (kind === "status") {
      root.status = code === 0 && parsed && parsed.state ? parsed : null
    } else if (kind === "conflicts") {
      root.conflicts = code === 0 && parsed instanceof Array ? parsed : []
    } else if (kind === "quarantine") {
      root.quarantine = code === 0 && parsed instanceof Array ? parsed : []
    } else if (kind === "setup") {
      root.setupError = code === 0 ? "" : String(err || "Setup was refused").trim()
      root.enqueue(["doctor", "--json"], "doctor")
    } else if (code === 0 && parsed && parsed.state) {
      root.status = parsed
      root.enqueue(["doctor", "--json"], "doctor")
    }
    root.pump()
  }

  function pause() { root.enqueue(["pause", "--json"], "pause") }
  function resume() { root.enqueue(["resume", "--json"], "resume") }
  function syncNow() { root.enqueue(["sync-now", "--json"], "sync") }
  function confirmHeld(id) { root.enqueue(["held", "confirm", String(id), "--json"], "held") }
  function rejectHeld(id) { root.enqueue(["held", "reject", String(id), "--json"], "held") }
  function resolveConflict(id, choice) { root.enqueue(["conflicts", "resolve", String(id), String(choice), "--json"], "resolve") }
  function releaseQuarantine(id) { root.enqueue(["quarantine", "release", String(id), "--json"], "release") }

  function submitSetup(localPath, remotePath) {
    root.setupError = ""
    root.enqueue(["setup", String(localPath), String(remotePath)], "setup")
  }

  function signIn() {
    if (signInProc.running) return
    signInProc.command = ["omarchy-launch-tui", root.launcherPath, "login"]
    signInProc.running = true
  }

  function retryEngine() {
    root.restarts = 0
    root.engineFailed = false
    root.ensureEngine()
  }

  function openExternal(target) {
    if (!target) return
    // Detached: xdg-open can become the long-lived app process (a fresh
    // browser or file manager), which would otherwise block later clicks.
    Quickshell.execDetached(["xdg-open", String(target)])
  }

  Process {
    id: engine
    onRunningChanged: if (running) root.startedAt = Date.now()
    stdout: SplitParser { onRead: function(line) { console.log("proton-drive-sync:", line) } }
    stderr: SplitParser { onRead: function(line) { console.warn("proton-drive-sync:", line) } }
    onExited: function(exitCode, exitStatus) {
      if (exitCode === 0 && exitStatus === 0) return
      // An engine that ran a good while before dying is an incident, not a broken install.
      if (Date.now() - root.startedAt > root.settledMs) root.restarts = 0
      if (root.restarts >= root.maxRestarts) {
        root.engineFailed = true
        console.warn("proton-drive-sync: engine exited " + root.maxRestarts + " times; run " + root.launcherPath + " run in a terminal to see why")
        return
      }
      root.restarts++
      restartTimer.start()
    }
  }

  Timer {
    id: restartTimer
    interval: 3000
    repeat: false
    onTriggered: root.ensureEngine()
  }

  Process {
    id: cli
    stdout: StdioCollector {
      id: cliOut
      waitForEnd: true
    }
    stderr: StdioCollector {
      id: cliErr
      waitForEnd: true
    }
    onExited: function(code) {
      root.handle(root.pendingKind, code, cliOut.text, cliErr.text)
    }
  }

  Process {
    id: longCli
    stdout: StdioCollector {
      id: longOut
      waitForEnd: true
    }
    stderr: StdioCollector {
      id: longErr
      waitForEnd: true
    }
    onExited: function(code) {
      root.handle(root.longKind, code, longOut.text, longErr.text)
      root.pumpLong()
    }
  }

  Process { id: signInProc }

  // One-time migration from 0.2.x, which built the engine into ~/.local/share and ran it from
  // a user unit. The script touches only files carrying this plugin's marker and is a no-op
  // afterwards; the engine now runs from this checkout.
  Process {
    id: legacyCleanup
    command: [root.pluginDir + "/scripts/remove-engine"]
    onExited: function(code) { root.poll() }
  }

  Timer {
    interval: root.panelOpen || (root.status && (root.status.state === "syncing" || root.status.state === "scanning")) ? 2000 : 5000
    running: true
    repeat: true
    onTriggered: root.poll()
  }

  Component.onCompleted: legacyCleanup.running = true
}
