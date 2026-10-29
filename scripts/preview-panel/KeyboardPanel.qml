import QtQuick
import Quickshell
import qs.Commons
import qs.Commons as Commons

// Stand-in for the shell's KeyboardPanel, used only by scripts/preview-panel.ts. It draws
// the same card (BorderSurface with the popup colors, border, padding, corner radius and
// size fitting) as a plain item instead of a full-screen layer-shell window, so the panel
// can be rendered offscreen. Everything inside the card is the real panel.
Item {
  id: root

  property Item anchorItem: null
  property QtObject bar: null
  property var owner: null
  property int margin: Style.gapsOut
  property int padding: Style.spacing.popupPadding
  property int contentWidth: Style.space(280)
  property int contentHeight: Style.space(200)
  property var borderSpec: Border.surfaceSpec("popups", "border", Commons.Color.popups.border, Math.max(1, Style.space(2)))
  property bool centerOnBar: false
  property bool open: false
  property int gap: Style.gapsOut
  property Item focusTarget: null

  // The screen the card is fitted to, in logical pixels, with the bar on top.
  readonly property real screenW: Number(Quickshell.env("PANEL_PREVIEW_SCREEN_W")) || 1920
  readonly property real screenH: Number(Quickshell.env("PANEL_PREVIEW_SCREEN_H")) || 1080
  readonly property real barH: bar && bar.barSize ? bar.barSize : 32

  default property alias contentItem: contentHolder.children
  // Found by the harness to take the screenshot.
  readonly property alias previewCard: card

  readonly property real availableCardWidth: Math.max(120, screenW - margin * 2)
  readonly property real availableCardHeight: Math.max(120, screenH - (barH + gap + margin))
  readonly property real verticalContentInset: padding * 2 + Border.top(borderSpec) + Border.bottom(borderSpec)

  function fittedContentWidth(width, cap) {
    var desired = Math.max(1, Number(width) || 1)
    var maxWidth = root.availableCardWidth
    if (cap !== undefined && Number(cap) > 0) maxWidth = Math.min(maxWidth, Number(cap))
    return Math.round(Math.min(desired, maxWidth))
  }

  function fittedContentHeight(implicitHeight, cap) {
    var desired = Math.max(root.verticalContentInset, (Number(implicitHeight) || 0) + root.verticalContentInset)
    var maxHeight = root.availableCardHeight
    if (cap !== undefined && Number(cap) > 0) maxHeight = Math.min(maxHeight, Number(cap))
    return Math.round(Math.min(desired, maxHeight))
  }

  function cappedContentHeight(height) {
    var desired = Math.max(root.padding * 2, Number(height) || root.padding * 2)
    return Math.round(Math.min(desired, root.availableCardHeight))
  }

  width: card.width
  height: card.height
  visible: open

  onOpenChanged: if (open && focusTarget) Qt.callLater(function() { root.focusTarget.forceActiveFocus() })

  BorderSurface {
    id: card
    width: root.contentWidth
    height: root.contentHeight
    color: Commons.Color.popups.background
    borderSpec: root.borderSpec
    padding: root.padding
    radius: Style.cornerRadius

    Item {
      id: contentHolder
      anchors.fill: parent
      anchors.topMargin: card.contentTopInset
      anchors.rightMargin: card.contentRightInset
      anchors.bottomMargin: card.contentBottomInset
      anchors.leftMargin: card.contentLeftInset
    }
  }
}
