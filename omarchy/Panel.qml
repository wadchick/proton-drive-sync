import QtQuick
import QtQuick.Controls as QQC
import qs.Commons
import qs.Ui
import "Model.js" as ProtonDriveModel

Panel {
  id: root
  moduleName: "io.github.zakkoo.proton-drive"
  manageIpc: false

  property var anchorItem: null
  property var hostWidget: null
  property var service: null
  property bool needsBuiltinBar: false
  property string localDraft: ""
  property string remoteDraft: ""

  readonly property string fontFamily: root.bar ? root.bar.fontFamily : Style.font.family
  readonly property color dim: Qt.darker(root.barForeground, 1.55)
  readonly property color urgent: root.bar ? root.bar.urgent : Color.urgent
  readonly property string chipState: service && service.chip ? service.chip.state : ""
  readonly property bool busy: chipState === "syncing" || chipState === "scanning" || chipState === "starting"
  readonly property bool heroDimmed: chipState === "paused" || chipState === "offline" || chipState === "not_running" || chipState === "stopped" || chipState === "not_installed"

  readonly property var held: {
    var status = service && service.status
    var attention = status && status.attention
    return attention ? attention.heldPlan : null
  }
  readonly property var transfers: {
    var status = service && service.status
    return status && status.transfers ? status.transfers : []
  }
  readonly property var reading: {
    var status = root.service && root.service.status
    var lines = status && status.summaryLines ? status.summaryLines : []
    return ProtonDriveModel.readingLines(lines)
  }
  readonly property string glance: {
    var status = service && service.status
    if (!status || !status.progress) return ""
    var total = Number(status.progress.total)
    var done = Number(status.progress.done)
    if (!(total > 0)) return ""
    if (status.state === "syncing") return "Sync (" + done + "/" + total + ")"
    if (status.state === "paused") return "Paused (" + done + "/" + total + ")"
    return ""
  }
  // A few hundred conflict rows, each with three buttons, is enough to stall the shell.
  readonly property int conflictLimit: 5
  readonly property int conflictCount: service && service.conflicts ? service.conflicts.length : 0
  property bool detailsOpenedForOverflow: false

  function offerDetailsForOverflow() {
    if (root.conflictCount <= root.conflictLimit) {
      root.detailsOpenedForOverflow = false
      return
    }
    if (root.detailsOpenedForOverflow) return
    if (!(root.service && root.service.doctor && root.service.doctor.detailUrl)) return
    root.detailsOpenedForOverflow = true
    root.service.openExternal(root.service.doctor.detailUrl)
  }

  onConflictCountChanged: root.offerDetailsForOverflow()
  onServiceChanged: root.offerDetailsForOverflow()

  function open() { root.controller.show() }
  function close() { root.controller.hide() }
  function toggle() { root.opened ? root.close() : root.open() }
  function switchPanel(direction) {
    if (root.bar && typeof root.bar.switchPanelFrom === "function")
      return root.bar.switchPanelFrom(root.hostWidget || root, direction)
    return false
  }
  function splitReading(line) {
    var text = String(line)
    var at = text.indexOf(": ")
    if (at < 0) return { label: text, value: "" }
    return { label: text.substring(0, at), value: text.substring(at + 2) }
  }

  onOpenedChanged: if (service) service.panelOpen = root.opened

  Connections {
    target: root.service
    function onConflictsChanged() { root.offerDetailsForOverflow() }
    function onDoctorChanged() { root.offerDetailsForOverflow() }
  }

  KeyboardPanel {
    id: panel
    anchorItem: root.anchorItem
    owner: root.hostWidget || root
    bar: root.bar
    open: root.opened
    focusTarget: keyCatcher
    contentWidth: panel.fittedContentWidth(Style.space(340))
    contentHeight: panel.fittedContentHeight(content.implicitHeight, Style.space(560))

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }

      Flickable {
        id: panelFlick
        anchors.fill: parent
        contentWidth: width
        contentHeight: content.implicitHeight
        clip: true
        boundsBehavior: Flickable.StopAtBounds
        flickableDirection: Flickable.VerticalFlick
        interactive: contentHeight > height
        QQC.ScrollBar.vertical: QQC.ScrollBar { policy: QQC.ScrollBar.AsNeeded }

        Column {
          id: content
          width: panelFlick.width
          spacing: Style.space(12)

          // ------------------------------------------------------------ hero
          PanelHero {
            width: parent.width
            title: "Proton Drive"
            meta: root.needsBuiltinBar || !root.service
              ? "Unavailable"
              : (root.service.chip ? root.service.chip.label : "Drive")
            detail: root.held ? "Waiting" : ""
            foreground: root.barForeground
            fontFamily: root.fontFamily
            iconOpacity: root.heroDimmed ? 0.5 : 1.0
            iconComponent: Component {
              Text {
                textFormat: Text.PlainText
                text: ""
                color: root.service && root.service.chip && root.service.chip.urgent ? root.urgent : root.barForeground
                font.family: root.fontFamily
                font.pixelSize: Style.font.display
              }
            }
          }

          Text {
            width: parent.width
            textFormat: Text.PlainText
            text: root.glance !== ""
              ? root.glance
              : (root.needsBuiltinBar || !root.service
                ? "Proton Drive needs the built-in Omarchy bar."
                : (root.service.chip ? root.service.chip.tooltip : "Proton Drive"))
            color: root.service && root.service.chip && root.service.chip.urgent ? root.urgent : root.dim
            font.family: root.fontFamily
            font.pixelSize: Style.font.body
            wrapMode: Text.WordWrap
          }

          // --------------------------------------------------------- readings
          Column {
            visible: root.reading.length > 0
            width: parent.width
            spacing: Style.spacing.labelGap
            Repeater {
              model: root.reading.length
              delegate: InfoPair {
                required property int index
                readonly property var parts: root.splitReading(root.reading[index])
                label: parts.label
                value: parts.value
              }
            }
          }

          // ------------------------------------------------------ onboarding
          Note {
            visible: root.service && root.service.launcherOk !== true
            text: "Install the engine, then come back:\n~/.config/omarchy/plugins/io.github.zakkoo.proton-drive/scripts/install-engine --service"
          }

          Note {
            visible: root.service && root.service.launcherOk === true && root.service.chip && root.service.chip.state === "not_running"
            text: "The engine is not running. Start it with the user service from the install command above, or run proton-drive-sync in a terminal."
          }

          ActionButton {
            visible: root.service && root.service.chip && root.service.chip.state === "not_signed_in"
            text: "Sign in"
            iconText: "󰌋"
            onClicked: root.service.signIn()
          }

          Column {
            visible: root.service && root.service.chip && root.service.chip.state === "not_configured"
            width: parent.width
            spacing: Style.space(8)
            PanelSectionHeader {
              text: "FOLDERS TO SYNC"
              foreground: root.barForeground
              fontFamily: root.fontFamily
            }
            TextField {
              width: parent.width
              placeholderText: "Local folder"
              foreground: root.barForeground
              onTextEdited: root.localDraft = text
            }
            TextField {
              width: parent.width
              placeholderText: "Remote folder, like /my-files"
              foreground: root.barForeground
              onTextEdited: root.remoteDraft = text
            }
            ActionButton {
              text: "Use these folders"
              onClicked: root.service.submitSetup(root.localDraft, root.remoteDraft)
            }
            Text {
              visible: root.service && root.service.setupError !== ""
              width: parent.width
              textFormat: Text.PlainText
              text: root.service ? root.service.setupError : ""
              color: root.urgent
              wrapMode: Text.WordWrap
              font.family: root.fontFamily
              font.pixelSize: Style.font.bodySmall
            }
          }

          // -------------------------------------------------------- transfers
          Section {
            visible: root.transfers.length > 0
            title: "TRANSFERS"
            Repeater {
              model: root.transfers.length
              delegate: Text {
                required property int index
                width: content.width
                textFormat: Text.PlainText
                text: ProtonDriveModel.transferLine(root.transfers[index])
                color: root.barForeground
                font.family: root.fontFamily
                font.pixelSize: Style.font.bodySmall
                elide: Text.ElideMiddle
              }
            }
          }

          // ---------------------------------------------------------- controls
          Column {
            visible: root.service && root.service.status
            width: parent.width
            spacing: Style.space(6)
            ActionButton {
              text: root.service && root.service.status && root.service.status.state === "paused" ? "Resume" : "Pause"
              iconText: root.service && root.service.status && root.service.status.state === "paused" ? "" : ""
              onClicked: {
                if (root.service.status && root.service.status.state === "paused") root.service.resume()
                else root.service.pause()
              }
            }
            ActionButton {
              text: "Sync now"
              iconText: "󰑐"
              iconSpinning: root.busy
              onClicked: root.service.syncNow()
            }
          }

          // ---------------------------------------------------------- held plan
          Section {
            visible: root.held
            title: "WAITING FOR YOU"
            Text {
              width: content.width
              textFormat: Text.PlainText
              text: root.held ? String(root.held.reason || "") : ""
              color: root.barForeground
              wrapMode: Text.WordWrap
              font.family: root.fontFamily
              font.pixelSize: Style.font.body
            }
            Repeater {
              model: root.held && root.held.affected ? root.held.affected.length : 0
              delegate: Text {
                required property int index
                width: content.width
                textFormat: Text.PlainText
                text: root.held ? String(root.held.affected[index]) : ""
                color: root.dim
                font.family: root.fontFamily
                font.pixelSize: Style.font.bodySmall
                elide: Text.ElideMiddle
              }
            }
            Row {
              width: content.width
              spacing: Style.space(6)
              ActionButton {
                width: (parent.width - parent.spacing) / 2
                text: "Confirm"
                onClicked: if (root.held) root.service.confirmHeld(root.held.id)
              }
              ActionButton {
                width: (parent.width - parent.spacing) / 2
                text: "Reject"
                foreground: root.urgent
                onClicked: if (root.held) root.service.rejectHeld(root.held.id)
              }
            }
          }

          // ---------------------------------------------------------- conflicts
          Section {
            visible: root.conflictCount > 0
            title: "CONFLICTS"
            Repeater {
              model: Math.min(root.conflictCount, root.conflictLimit)
              delegate: Column {
                required property int index
                width: content.width
                spacing: Style.space(4)
                readonly property var row: root.service.conflicts[index]
                Text {
                  width: parent.width
                  textFormat: Text.PlainText
                  text: row ? String(row.relPath || row.id) : ""
                  color: root.barForeground
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.body
                  elide: Text.ElideMiddle
                }
                Row {
                  width: parent.width
                  spacing: Style.space(6)
                  // A delete-versus-edit conflict already kept the edit: only "Keep both" applies.
                  readonly property bool twoSided: row ? row.kind !== "delete_vs_edit" : false
                  readonly property int count: twoSided ? 3 : 1
                  readonly property real each: (width - spacing * (count - 1)) / count
                  ActionButton {
                    visible: parent.twoSided
                    width: parent.each
                    fontSize: Style.font.bodySmall
                    text: "Keep local"
                    onClicked: root.service.resolveConflict(row.id, "keep_local")
                  }
                  ActionButton {
                    visible: parent.twoSided
                    width: parent.each
                    fontSize: Style.font.bodySmall
                    text: "Keep remote"
                    onClicked: root.service.resolveConflict(row.id, "keep_remote")
                  }
                  ActionButton {
                    width: parent.each
                    fontSize: Style.font.bodySmall
                    text: "Keep both"
                    onClicked: root.service.resolveConflict(row.id, "keep_both")
                  }
                }
              }
            }
            ActionButton {
              visible: root.conflictCount > root.conflictLimit && root.service && root.service.doctor && root.service.doctor.detailUrl
              text: (root.conflictCount - root.conflictLimit) + " more on the details page"
              onClicked: root.service.openExternal(root.service.doctor.detailUrl)
            }
          }

          // --------------------------------------------------------- quarantine
          Section {
            visible: root.service && root.service.quarantine && root.service.quarantine.length > 0
            title: "QUARANTINE"
            Repeater {
              model: root.service && root.service.quarantine ? root.service.quarantine.length : 0
              delegate: Item {
                required property int index
                width: content.width
                implicitHeight: Math.max(quarantineName.implicitHeight, releaseButton.implicitHeight)
                readonly property var row: root.service.quarantine[index]
                Text {
                  id: quarantineName
                  anchors.left: parent.left
                  anchors.right: releaseButton.left
                  anchors.rightMargin: Style.space(8)
                  anchors.verticalCenter: parent.verticalCenter
                  textFormat: Text.PlainText
                  text: row ? String(row.relPath || row.nodeUid || row.id) : ""
                  color: root.barForeground
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.bodySmall
                  elide: Text.ElideMiddle
                }
                PanelActionButton {
                  id: releaseButton
                  anchors.right: parent.right
                  anchors.verticalCenter: parent.verticalCenter
                  iconText: "󰄬"
                  tooltipText: "Release"
                  foreground: root.barForeground
                  fontFamily: root.fontFamily
                  onClicked: root.service.releaseQuarantine(row.id)
                }
              }
            }
          }

          // ------------------------------------------------------------- open
          Column {
            visible: root.service && root.service.doctor && (root.service.doctor.localRoot || root.service.doctor.detailUrl || root.service.doctor.configFile)
            width: parent.width
            spacing: Style.space(10)
            PanelSeparator { foreground: root.barForeground }
            Row {
              width: parent.width
              spacing: Style.space(6)
              readonly property int count: (root.service && root.service.doctor && root.service.doctor.localRoot ? 1 : 0)
                + (root.service && root.service.doctor && root.service.doctor.detailUrl ? 1 : 0)
                + (root.service && root.service.doctor && root.service.doctor.configFile ? 1 : 0)
              readonly property real each: count > 0 ? (width - spacing * (count - 1)) / count : width
              ActionButton {
                visible: root.service && root.service.doctor && root.service.doctor.localRoot
                width: parent.each
                text: "Open folder"
                iconText: ""
                onClicked: root.service.openExternal(root.service.doctor.localRoot)
              }
              ActionButton {
                visible: root.service && root.service.doctor && root.service.doctor.detailUrl
                width: parent.each
                text: "Open details"
                iconText: "󰖟"
                onClicked: root.service.openExternal(root.service.doctor.detailUrl)
              }
              ActionButton {
                visible: root.service && root.service.doctor && root.service.doctor.configFile
                width: parent.each
                text: "Open config"
                iconText: ""
                onClicked: root.service.openExternal(root.service.doctor.configFile)
              }
            }
          }

          // ----------------------------------------------------------- footer
          Text {
            visible: root.service && root.service.doctor && root.service.doctor.version
            width: parent.width
            textFormat: Text.PlainText
            text: "Version " + root.service.doctor.version
            color: root.dim
            horizontalAlignment: Text.AlignHCenter
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
          }
        }
      }
    }
  }

  // Full-width bordered button, the panel's one clickable shape.
  component ActionButton: Button {
    width: parent ? parent.width : implicitWidth
    bordered: true
    foreground: root.barForeground
    fontFamily: root.fontFamily
  }

  // Separator, small-caps header, then the rows passed as children.
  component Section: Column {
    id: section
    property string title: ""
    default property alias rows: body.children
    width: parent ? parent.width : implicitWidth
    spacing: Style.space(10)
    PanelSeparator { foreground: root.barForeground }
    PanelSectionHeader {
      text: section.title
      foreground: root.barForeground
      fontFamily: root.fontFamily
    }
    Column {
      id: body
      width: parent.width
      spacing: Style.space(6)
    }
  }

  component Note: Text {
    width: parent ? parent.width : implicitWidth
    textFormat: Text.PlainText
    color: root.dim
    font.family: root.fontFamily
    font.pixelSize: Style.font.bodySmall
    wrapMode: Text.WrapAnywhere
  }

  component InfoPair: Item {
    property string label: ""
    property string value: ""
    width: parent ? parent.width : implicitWidth
    implicitHeight: Math.max(pairLabel.implicitHeight, pairValue.implicitHeight)
    Text {
      id: pairLabel
      anchors.left: parent.left
      anchors.verticalCenter: parent.verticalCenter
      textFormat: Text.PlainText
      text: label
      color: root.barForeground
      opacity: 0.6
      font.family: root.fontFamily
      font.pixelSize: Style.font.bodySmall
    }
    Text {
      id: pairValue
      anchors.left: pairLabel.right
      anchors.leftMargin: Style.space(8)
      anchors.right: parent.right
      anchors.verticalCenter: parent.verticalCenter
      textFormat: Text.PlainText
      text: value
      color: root.barForeground
      horizontalAlignment: Text.AlignRight
      font.family: root.fontFamily
      font.pixelSize: Style.font.bodySmall
      elide: Text.ElideRight
    }
  }
}
