import QtQuick
import Quickshell
import qs.Commons
import qs.Commons as Commons
import "plugin/Model.js" as ProtonDriveModel
import "Scenarios.js" as Scenarios

// Harness for scripts/preview-panel.ts, which copies this file next to the panel under
// test (plugin/), the shell's Commons and Ui modules, and the generated Scenarios.js.
// It loads plugin/Panel.qml once per scenario with a stand-in bar and service, saves the
// open card as a PNG, and quits. A card taller than the panel's own height cap scrolls,
// so it gets a second shot scrolled to the bottom.
ShellRoot {
  id: shell
  property string outDir: Quickshell.env("PANEL_PREVIEW_OUT") || "."
  property int index: -1

  // The bar's colors and font, as plugins/bar/Bar.qml sets them.
  QtObject {
    id: mockBar
    property color barForeground: Commons.Color.bar.text
    property color urgent: Commons.Color.bar.active
    property string fontFamily: Style.font.family
    property string position: "top"
    property int barSize: 32
    function switchPanelFrom() { return false }
  }

  // omarchy/Service.qml's properties and actions. The actions only log.
  QtObject {
    id: mockService
    property var doctor: null
    property var status: null
    property var conflicts: []
    property var quarantine: []
    property bool engineFailed: false
    property bool panelOpen: false
    property string launcherPath: Scenarios.LAUNCHER
    readonly property var chip: ProtonDriveModel.chipModel({ doctor: doctor, status: status, engineFailed: engineFailed })
    function pause() { console.log("panel-preview: action pause") }
    function resume() { console.log("panel-preview: action resume") }
    function syncNow() { console.log("panel-preview: action syncNow") }
    function confirmHeld(id) { console.log("panel-preview: action confirmHeld", id) }
    function rejectHeld(id) { console.log("panel-preview: action rejectHeld", id) }
    function resolveConflict(id, choice) { console.log("panel-preview: action resolveConflict", id, choice) }
    function releaseQuarantine(id) { console.log("panel-preview: action releaseQuarantine", id) }
    function configureFolders() { console.log("panel-preview: action configureFolders") }
    function signIn() { console.log("panel-preview: action signIn") }
    function retryEngine() { console.log("panel-preview: action retryEngine") }
    function openExternal(target) { console.log("panel-preview: action openExternal", target) }
  }

  FloatingWindow {
    implicitWidth: 800
    implicitHeight: 1600
    color: "transparent"
    visible: true

    Loader {
      id: loader
      active: false
      source: Qt.resolvedUrl("plugin/Panel.qml")
      onLoaded: {
        item.bar = mockBar
        item.service = mockService
        item.open()
        shotTimer.restart()
      }
    }
  }

  function find(node, test) {
    if (!node) return null
    if (test(node)) return node
    var kids = node.children || []
    for (var i = 0; i < kids.length; i++) {
      var hit = find(kids[i], test)
      if (hit) return hit
    }
    return null
  }

  function next() {
    loader.active = false
    shell.index++
    if (shell.index >= Scenarios.LIST.length) {
      Qt.quit()
      return
    }
    var s = Scenarios.LIST[shell.index]
    mockService.doctor = s.doctor
    mockService.status = s.status
    mockService.conflicts = s.conflicts
    mockService.quarantine = s.quarantine
    mockService.engineFailed = s.engineFailed
    loader.active = true
  }

  function save(result, file) {
    var path = shell.outDir + "/" + file
    console.log("panel-preview:", result.saveToFile(path) ? "saved" : "failed", path)
  }

  Timer {
    id: shotTimer
    interval: 700
    onTriggered: {
      var name = Scenarios.LIST[shell.index].file
      var stub = shell.find(loader.item, function(n) { return n.previewCard !== undefined })
      if (!stub) {
        console.log("panel-preview: failed no card for", name)
        shell.next()
        return
      }
      var card = stub.previewCard
      card.grabToImage(function(result) {
        shell.save(result, name + ".png")
        var flick = shell.find(loader.item, function(n) { return n.contentY !== undefined && n.flickableDirection !== undefined })
        if (!flick || flick.contentHeight <= flick.height + 1) {
          shell.next()
          return
        }
        flick.contentY = flick.contentHeight - flick.height
        scrolledTimer.card = card
        scrolledTimer.name = name
        scrolledTimer.restart()
      })
    }
  }

  Timer {
    id: scrolledTimer
    property var card: null
    property string name: ""
    interval: 300
    onTriggered: card.grabToImage(function(result) {
      shell.save(result, scrolledTimer.name + "-scrolled.png")
      shell.next()
    })
  }

  // Color and Style read the theme and resolve the font asynchronously.
  Timer {
    interval: 1500
    running: true
    onTriggered: shell.next()
  }
}
