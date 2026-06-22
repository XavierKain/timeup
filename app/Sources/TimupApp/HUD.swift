import AppKit

/// A transient, good-looking HUD shown at the top-center of the screen — the
/// native successor to Raycast's `showHUD`. Always dark (legible in light or
/// dark mode), rounded, with a soft shadow and a subtle slide+fade.
@MainActor
final class HUD {
    static let shared = HUD()

    private var window: NSWindow?
    private var capsule: NSVisualEffectView?
    private var label: NSTextField?
    private var dismissWork: DispatchWorkItem?

    // Geometry
    private let hPad: CGFloat = 24      // text inset, left/right
    private let vPad: CGFloat = 13      // text inset, top/bottom
    private let margin: CGFloat = 22    // transparent room around the capsule for the shadow
    private let maxCapsuleWidth: CGFloat = 600
    private let topGap: CGFloat = 8     // gap below the menu bar

    func show(_ text: String, duration: TimeInterval = 2.4) {
        let window = ensureWindow()
        label?.stringValue = text

        let frame = layout(window)              // final, on-screen frame
        var start = frame
        start.origin.y += 10                    // start slightly higher, slide down

        dismissWork?.cancel()
        window.setFrame(start, display: false)
        window.alphaValue = 0
        window.orderFrontRegardless()
        NSAnimationContext.runAnimationGroup { ctx in
            ctx.duration = 0.18
            ctx.timingFunction = CAMediaTimingFunction(name: .easeOut)
            window.animator().setFrame(frame, display: true)
            window.animator().alphaValue = 1
        }

        let work = DispatchWorkItem { [weak window] in
            guard let window else { return }
            var up = window.frame
            up.origin.y += 10
            NSAnimationContext.runAnimationGroup({ ctx in
                ctx.duration = 0.28
                ctx.timingFunction = CAMediaTimingFunction(name: .easeIn)
                window.animator().setFrame(up, display: true)
                window.animator().alphaValue = 0
            }, completionHandler: { window.orderOut(nil) })
        }
        dismissWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + duration, execute: work)
    }

    private func ensureWindow() -> NSWindow {
        if let window { return window }

        let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 240, height: 80),
                         styleMask: .borderless, backing: .buffered, defer: false)
        w.isOpaque = false
        w.backgroundColor = .clear
        w.hasShadow = false                 // we draw our own (rounded) shadow
        w.level = .statusBar
        w.ignoresMouseEvents = true
        w.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]

        // Container holds the (rounded, clipped) shadow around the capsule.
        let container = NSView()
        container.wantsLayer = true
        container.layer?.masksToBounds = false
        container.layer?.shadowColor = NSColor.black.cgColor
        container.layer?.shadowOpacity = 0.30
        container.layer?.shadowRadius = 16
        container.layer?.shadowOffset = CGSize(width: 0, height: -5)

        // The dark capsule itself.
        let capsule = NSVisualEffectView()
        capsule.material = .hudWindow
        capsule.state = .active
        capsule.blendingMode = .behindWindow
        capsule.appearance = NSAppearance(named: .darkAqua)   // force dark -> white text legible
        capsule.wantsLayer = true
        capsule.layer?.cornerRadius = 16
        capsule.layer?.cornerCurve = .continuous
        capsule.layer?.masksToBounds = true
        capsule.layer?.borderWidth = 1
        capsule.layer?.borderColor = NSColor.white.withAlphaComponent(0.10).cgColor

        let text = NSTextField(labelWithString: "")
        text.font = .systemFont(ofSize: 15, weight: .semibold)
        text.textColor = .white
        text.alignment = .center
        text.backgroundColor = .clear
        text.isBezeled = false
        text.isEditable = false
        text.lineBreakMode = .byTruncatingTail
        text.cell?.usesSingleLineMode = true

        capsule.addSubview(text)
        container.addSubview(capsule)
        w.contentView = container

        window = w
        self.capsule = capsule
        label = text
        return w
    }

    /// Size to the text, place the capsule top-center under the menu bar, and
    /// return the final window frame.
    @discardableResult
    private func layout(_ window: NSWindow) -> NSRect {
        guard let label, let capsule else { return window.frame }
        label.sizeToFit()
        let textSize = label.frame.size

        let capsuleW = min(textSize.width + hPad * 2, maxCapsuleWidth)
        let capsuleH = max(textSize.height + vPad * 2, 40)
        let winW = capsuleW + margin * 2
        let winH = capsuleH + margin * 2

        capsule.frame = NSRect(x: margin, y: margin, width: capsuleW, height: capsuleH)
        capsule.layer?.shadowPath = nil
        // Round-rect shadow matches the capsule.
        capsule.superview?.layer?.shadowPath =
            CGPath(roundedRect: capsule.frame, cornerWidth: 16, cornerHeight: 16, transform: nil)
        label.frame = NSRect(x: hPad, y: (capsuleH - textSize.height) / 2,
                             width: capsuleW - hPad * 2, height: textSize.height)

        let screen = NSScreen.main ?? NSScreen.screens.first
        let visible = screen?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let x = visible.midX - winW / 2
        // visible.maxY is just under the menu bar; capsule top sits topGap below it.
        let y = visible.maxY + margin - winH - topGap
        return NSRect(x: x, y: y, width: winW, height: winH)
    }
}
