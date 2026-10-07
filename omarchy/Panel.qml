import QtQuick
import QtQuick.Layouts
import Quickshell
import qs.Commons
import qs.Ui
import "Model.js" as ProtonDriveModel

// Laid out like the shell's own panels (Wi-Fi, Bluetooth): a hero with the
// state and the sync controls, a stats grid, sections for what needs the user,
// and the open actions. The details page holds the full lists.
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

  // Rows shown per list before "more in details".
  readonly property int listLimit: 4

  readonly property var status: service ? service.status : null
  readonly property var chip: service ? service.chip : null
  readonly property var doctor: service ? service.doctor : null
  readonly property bool running: !!status
  readonly property bool paused: !!status && status.state === "paused"
  readonly property bool busy: !!status && (status.state === "syncing" || status.state === "scanning")
  readonly property var held: status && status.attention ? status.attention.heldPlan : null
  readonly property var conflicts: service && service.conflicts ? service.conflicts : []
  readonly property var quarantine: service && service.quarantine ? service.quarantine : []
  readonly property var transfers: status && status.transfers ? status.transfers : []
  readonly property int skipped: status && status.counts ? Number(status.counts.protonDocuments) || 0 : 0
  readonly property string fontFamily: root.bar ? root.bar.fontFamily : Style.font.family
  readonly property color fg: root.barForeground
  readonly property color dim: Qt.darker(root.fg, 1.4)
  readonly property color urgent: root.bar ? root.bar.urgent : root.fg
  // Refreshed while the panel is open so "2 min ago" keeps moving.
  property real now: Date.now()

  readonly property string meta: root.needsBuiltinBar || !root.service
    ? "Needs the built-in Omarchy bar"
    : ProtonDriveModel.heroMeta(root.chip, root.status)

  function open() { root.controller.show() }
  function close() { root.controller.hide() }
  function toggle() { root.opened ? root.close() : root.open() }
  function switchPanel(direction) {
    if (root.bar && typeof root.bar.switchPanelFrom === "function")
      return root.bar.switchPanelFrom(root.hostWidget || root, direction)
    return false
  }
  function when(ms) {
    if (typeof ms !== "number") return "--"
    var rel = ProtonDriveModel.ago(ms, root.now)
    return rel !== "" ? rel : Qt.formatDateTime(new Date(ms), Qt.locale().dateTimeFormat(Locale.ShortFormat))
  }
  function count(n) { return typeof n === "number" ? Number(n).toLocaleString(Qt.locale(), "f", 0) : "--" }
  function openDetails() { if (root.doctor && root.doctor.detailUrl) root.service.openExternal(root.doctor.detailUrl) }

  onOpenedChanged: {
    if (service) service.panelOpen = root.opened
    root.now = Date.now()
  }

  Timer {
    interval: 30000
    running: root.opened
    repeat: true
    onTriggered: root.now = Date.now()
  }

  // Shell panel text styles: labels at 60%, values full strength (Wi-Fi's InfoLabel/InfoValue).
  component InfoLabel: Text {
    textFormat: Text.PlainText
    color: root.fg
    opacity: 0.6
    font.family: root.fontFamily
    font.pixelSize: Style.font.bodySmall
  }
  component InfoValue: Text {
    textFormat: Text.PlainText
    color: root.fg
    font.family: root.fontFamily
    font.pixelSize: Style.font.bodySmall
    horizontalAlignment: Text.AlignRight
    elide: Text.ElideLeft
    Layout.fillWidth: true
  }
  component BodyText: Text {
    textFormat: Text.PlainText
    width: parent ? parent.width : implicitWidth
    color: root.fg
    font.family: root.fontFamily
    font.pixelSize: Style.font.body
    wrapMode: Text.WordWrap
  }
  // Section labels are uppercase, like the shell's ("KNOWN NETWORKS").
  component SectionHeader: PanelSectionHeader {
    property string label: ""
    text: label.toUpperCase()
    foreground: root.fg
    fontFamily: root.fontFamily
  }
  component MoreLink: Button {
    property int total: 0
    visible: total > root.listLimit
    text: String(total - root.listLimit) + " more in details"
    foreground: root.fg
    fontFamily: root.fontFamily
    fontSize: Style.font.bodySmall
    horizontalPadding: 0
    onClicked: root.openDetails()
  }
  // An icon action like the Wi-Fi panel's QR code and speed test buttons.
  component IconAction: Button {
    foreground: root.fg
    fontFamily: root.fontFamily
    iconSize: Style.font.subtitle * 1.5
    horizontalPadding: Style.space(5)
    verticalPadding: Style.space(2)
  }

  KeyboardPanel {
    id: panel
    anchorItem: root.anchorItem
    owner: root.hostWidget || root
    bar: root.bar
    open: root.opened
    focusTarget: keyCatcher
    contentWidth: panel.fittedContentWidth(Style.space(360))
    contentHeight: panel.fittedContentHeight(content.implicitHeight)

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }

      Column {
        id: content
        width: parent.width
        spacing: Style.space(12)

        // ---------- Hero: folder icon · Proton Drive + state · sync controls ----------
        Item {
          width: parent.width
          implicitHeight: Math.max(heroIcon.height, heroLabels.implicitHeight, heroActions.implicitHeight)

          // The icon theme's folder, as on the details page; a glyph when there is none.
          Image {
            id: heroIcon
            readonly property string themed: Quickshell.iconPath("folder", true)
            visible: themed !== ""
            source: themed
            width: Style.font.display * 1.25
            height: width
            sourceSize.width: width * 2
            sourceSize.height: height * 2
            fillMode: Image.PreserveAspectFit
            anchors.left: parent.left
            anchors.verticalCenter: parent.verticalCenter
            opacity: root.running ? 1.0 : 0.5
          }
          Text {
            visible: !heroIcon.visible
            textFormat: Text.PlainText
            text: "󰉋"
            color: root.fg
            font.family: root.fontFamily
            font.pixelSize: Style.font.display
            anchors.left: parent.left
            anchors.verticalCenter: parent.verticalCenter
          }

          RowLayout {
            id: heroActions
            visible: root.running
            spacing: Style.space(8)
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter

            IconAction {
              id: syncAction
              iconText: "󰑐"
              iconSpinning: root.busy
              // Pause stops all syncing in the engine, so Sync now waits for resume.
              enabled: !root.paused
              opacity: enabled ? 1.0 : 0.45
              tooltipText: root.paused ? "Resume sync to sync now" : "Sync now"
              Layout.alignment: Qt.AlignVCenter
              onClicked: root.service.syncNow()
            }

            ToggleSwitch {
              id: syncSwitch
              checked: !root.paused
              foreground: root.fg
              Layout.alignment: Qt.AlignVCenter
              onToggled: root.paused ? root.service.resume() : root.service.pause()

              PanelToolTip {
                visible: syncSwitch.containsMouse
                text: root.paused ? "Sync is paused. Click to resume" : "Sync is on. Click to pause"
                fontFamily: root.fontFamily
              }
            }
          }

          Column {
            id: heroLabels
            anchors.left: parent.left
            anchors.leftMargin: heroIcon.width + Style.space(14)
            anchors.right: parent.right
            anchors.rightMargin: heroActions.visible ? heroActions.width + Style.space(12) : 0
            anchors.verticalCenter: parent.verticalCenter
            spacing: Style.space(2)

            Text {
              textFormat: Text.PlainText
              width: parent.width
              text: "Proton Drive"
              color: root.fg
              font.family: root.fontFamily
              font.pixelSize: Style.font.title
              font.bold: true
              elide: Text.ElideRight
            }
            Text {
              textFormat: Text.PlainText
              width: parent.width
              text: root.meta.toUpperCase()
              visible: text !== ""
              color: root.chip && root.chip.urgent ? root.urgent : root.dim
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
              font.bold: true
              font.letterSpacing: 1.2
              elide: Text.ElideRight
            }
          }
        }

        // ---------- Before the engine runs: install, sign in, choose folders ----------
        BodyText {
          visible: root.service && root.service.launcherOk !== true
          text: "Install the engine, then come back:\n~/.config/omarchy/plugins/io.github.zakkoo.proton-drive/scripts/install-engine --service"
          color: root.dim
        }

        BodyText {
          visible: root.service && root.service.launcherOk === true && root.chip && root.chip.state === "not_running"
          text: "The engine is not running. Start it with the user service from the install command, or run proton-drive-sync in a terminal."
          color: root.dim
        }

        Column {
          visible: root.service && root.chip && root.chip.state === "not_signed_in"
          width: parent.width
          spacing: Style.space(8)
          BodyText {
            text: "Sign in on Proton's own page; your password never reaches this plugin."
            color: root.dim
          }
          Button {
            text: "Sign in"
            bordered: true
            foreground: root.fg
            fontFamily: root.fontFamily
            onClicked: root.service.signIn()
          }
        }

        Column {
          visible: root.service && root.chip && root.chip.state === "not_configured"
          width: parent.width
          spacing: Style.space(8)
          BodyText {
            text: "Choose a local folder and one in Proton Drive to keep in sync."
            color: root.dim
          }
          TextField {
            width: parent.width
            placeholderText: "Local folder, like ~/Drive"
            foreground: root.fg
            onTextEdited: root.localDraft = text
          }
          TextField {
            width: parent.width
            placeholderText: "Proton Drive folder, like /my-files"
            foreground: root.fg
            onTextEdited: root.remoteDraft = text
          }
          Button {
            text: "Use these folders"
            bordered: true
            foreground: root.fg
            fontFamily: root.fontFamily
            onClicked: root.service.submitSetup(root.localDraft, root.remoteDraft)
          }
          BodyText {
            visible: root.service && root.service.setupError !== ""
            text: root.service ? root.service.setupError : ""
            color: root.urgent
            font.pixelSize: Style.font.bodySmall
          }
        }

        // ---------- Stats, two to a row like the Wi-Fi panel ----------
        GridLayout {
          visible: root.running
          width: parent.width
          columns: 4
          columnSpacing: Style.space(20)
          rowSpacing: Style.spacing.labelGap

          InfoLabel { text: "Last sync" }
          InfoValue { text: root.status ? root.when(root.status.lastSuccessfulSyncAt) : "--" }
          InfoLabel { text: "Copied" }
          InfoValue { text: root.status ? root.count(root.status.lastRunFilesCopied) : "--" }

          InfoLabel { text: "Full sync" }
          InfoValue { text: root.status ? root.when(root.status.lastFullSyncAt) : "--" }
          InfoLabel { text: "Pending" }
          InfoValue { text: root.status ? ProtonDriveModel.pendingText(root.status.pending) : "--" }

          InfoLabel { text: "Local" }
          InfoValue { text: root.status && root.status.counts ? root.count(root.status.counts.localFiles) : "--" }
          InfoLabel { text: "Proton" }
          InfoValue { text: root.status && root.status.counts ? root.count(root.status.counts.remoteFiles) : "--" }

          InfoLabel { text: "In sync" }
          InfoValue { text: root.status && root.status.counts ? root.count(root.status.counts.pairedFiles) : "--" }
          // Proton Docs and Sheets: on Proton only, never copied here.
          InfoLabel { text: "Skipped"; visible: root.skipped > 0 }
          InfoValue { text: root.count(root.skipped); visible: root.skipped > 0 }
        }

        // ---------- A held plan: the mass-deletion brake waits for the user ----------
        PanelSeparator { visible: !!root.held; foreground: root.fg }
        Column {
          visible: !!root.held
          width: parent.width
          spacing: Style.space(6)
          SectionHeader { label: "Confirmation required" }
          BodyText { text: root.held ? String(root.held.reason || "") : "" }
          // The affected files as a tight list.
          Column {
            width: parent.width
            Repeater {
              model: root.held && root.held.affected ? Math.min(root.held.affected.length, root.listLimit) : 0
              delegate: Text {
                required property int index
                textFormat: Text.PlainText
                width: parent ? parent.width : 0
                text: root.held ? String(root.held.affected[index]) : ""
                color: root.dim
                font.family: root.fontFamily
                font.pixelSize: Style.font.bodySmall
                elide: Text.ElideLeft
              }
            }
          }
          MoreLink { total: root.held && root.held.affected ? root.held.affected.length : 0 }
          Row {
            spacing: Style.space(8)
            topPadding: Style.space(4)
            Button {
              text: "Proceed"
              bordered: true
              selected: true
              foreground: root.fg
              fontFamily: root.fontFamily
              onClicked: if (root.held) root.service.confirmHeld(root.held.id)
            }
            Button {
              text: "Reject"
              bordered: true
              foreground: root.fg
              fontFamily: root.fontFamily
              onClicked: if (root.held) root.service.rejectHeld(root.held.id)
            }
          }
        }

        // ---------- Conflicts ----------
        PanelSeparator { visible: root.conflicts.length > 0; foreground: root.fg }
        Column {
          visible: root.conflicts.length > 0
          width: parent.width
          spacing: Style.space(6)
          SectionHeader { label: "Conflicts (" + root.conflicts.length + ")" }
          Repeater {
            model: Math.min(root.conflicts.length, root.listLimit)
            delegate: Item {
              id: conflictRow
              required property int index
              readonly property var row: root.conflicts[index]
              width: parent ? parent.width : 0
              implicitHeight: Math.max(conflictText.implicitHeight, conflictActions.implicitHeight)

              Column {
                id: conflictText
                anchors.left: parent.left
                anchors.right: conflictActions.left
                anchors.rightMargin: Style.space(8)
                anchors.verticalCenter: parent.verticalCenter
                Text {
                  textFormat: Text.PlainText
                  width: parent.width
                  text: conflictRow.row ? String(conflictRow.row.relPath || conflictRow.row.id) : ""
                  color: root.fg
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.body
                  elide: Text.ElideLeft
                }
                Text {
                  textFormat: Text.PlainText
                  width: parent.width
                  text: ProtonDriveModel.happened(conflictRow.row)
                  color: root.dim
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.caption
                  elide: Text.ElideRight
                }
              }
              Row {
                id: conflictActions
                anchors.right: parent.right
                anchors.verticalCenter: parent.verticalCenter
                spacing: Style.space(2)
                IconAction {
                  visible: ProtonDriveModel.canChooseSide(conflictRow.row)
                  iconText: "󰌢"
                  tooltipText: "Keep the local version"
                  onClicked: root.service.resolveConflict(conflictRow.row.id, "keep_local")
                }
                IconAction {
                  visible: ProtonDriveModel.canChooseSide(conflictRow.row)
                  iconText: "󰅣"
                  tooltipText: "Keep the Proton version"
                  onClicked: root.service.resolveConflict(conflictRow.row.id, "keep_remote")
                }
                IconAction {
                  iconText: "󰆏"
                  tooltipText: "Keep both versions"
                  onClicked: root.service.resolveConflict(conflictRow.row.id, "keep_both")
                }
              }
            }
          }
          MoreLink { total: root.conflicts.length }
        }

        // ---------- Quarantine ----------
        PanelSeparator { visible: root.quarantine.length > 0; foreground: root.fg }
        Column {
          visible: root.quarantine.length > 0
          width: parent.width
          spacing: Style.space(6)
          SectionHeader { label: "Quarantine (" + root.quarantine.length + ")" }
          Repeater {
            model: Math.min(root.quarantine.length, root.listLimit)
            delegate: Item {
              id: quarantineRow
              required property int index
              readonly property var row: root.quarantine[index]
              width: parent ? parent.width : 0
              implicitHeight: Math.max(quarantineName.implicitHeight, releaseAction.implicitHeight)
              Text {
                id: quarantineName
                textFormat: Text.PlainText
                anchors.left: parent.left
                anchors.right: releaseAction.left
                anchors.rightMargin: Style.space(8)
                anchors.verticalCenter: parent.verticalCenter
                text: quarantineRow.row ? String(quarantineRow.row.relPath || quarantineRow.row.nodeUid || quarantineRow.row.id) : ""
                color: root.fg
                font.family: root.fontFamily
                font.pixelSize: Style.font.body
                elide: Text.ElideLeft
              }
              Button {
                id: releaseAction
                anchors.right: parent.right
                anchors.verticalCenter: parent.verticalCenter
                text: "Release"
                tooltipText: "Let sync handle this file again"
                foreground: root.fg
                fontFamily: root.fontFamily
                onClicked: root.service.releaseQuarantine(quarantineRow.row.id)
              }
            }
          }
          MoreLink { total: root.quarantine.length }
        }

        // ---------- Transfers in progress ----------
        PanelSeparator { visible: root.transfers.length > 0; foreground: root.fg }
        Column {
          visible: root.transfers.length > 0
          width: parent.width
          spacing: Style.space(4)
          SectionHeader { label: "Transfers (" + root.transfers.length + ")" }
          Repeater {
            model: Math.min(root.transfers.length, root.listLimit)
            delegate: RowLayout {
              required property int index
              readonly property var row: root.transfers[index]
              width: parent ? parent.width : 0
              spacing: Style.space(8)
              Text {
                textFormat: Text.PlainText
                text: row && row.kind === "upload" ? "↑" : "↓"
                color: root.dim
                font.family: root.fontFamily
                font.pixelSize: Style.font.body
              }
              Text {
                textFormat: Text.PlainText
                text: row ? String(row.relPath || "") : ""
                color: root.fg
                font.family: root.fontFamily
                font.pixelSize: Style.font.body
                elide: Text.ElideLeft
                Layout.fillWidth: true
              }
              Text {
                textFormat: Text.PlainText
                text: ProtonDriveModel.transferPercent(row)
                color: root.dim
                font.family: root.fontFamily
                font.pixelSize: Style.font.bodySmall
              }
            }
          }
          MoreLink { total: root.transfers.length }
        }

        // ---------- Open actions ----------
        PanelSeparator {
          visible: openRow.visible
          foreground: root.fg
        }
        // Shifted left by a button's padding so the first label lines up with the text above.
        Row {
          id: openRow
          visible: root.doctor && (root.doctor.localRoot || root.doctor.detailUrl || root.doctor.configFile)
          x: -Style.spacing.controlPaddingX
          spacing: Style.space(4)
          Button {
            visible: root.doctor && root.doctor.localRoot
            text: "Open folder"
            foreground: root.fg
            fontFamily: root.fontFamily
            onClicked: root.service.openExternal(root.service.doctor.localRoot)
          }
          Button {
            visible: root.doctor && root.doctor.detailUrl
            text: "Open details"
            foreground: root.fg
            fontFamily: root.fontFamily
            onClicked: root.service.openExternal(root.service.doctor.detailUrl)
          }
          Button {
            visible: root.doctor && root.doctor.configFile
            text: "Open config"
            foreground: root.fg
            fontFamily: root.fontFamily
            onClicked: root.service.openExternal(root.service.doctor.configFile)
          }
        }

        InfoLabel {
          visible: !!(root.service && root.service.doctor && root.service.doctor.version)
          text: "Version " + root.service.doctor.version
        }
      }
    }
  }
}
