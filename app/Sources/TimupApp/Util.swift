import AppKit

/// Lightweight stderr logger (visible when launched from a terminal).
func appLog(_ message: String) {
    fputs("[timup-app] \(message)\n", stderr)
}

/// An `NSMenuItem` that runs a closure when selected — avoids a forest of
/// `@objc` selectors for the dozen menu actions.
final class ActionMenuItem: NSMenuItem {
    private let handler: () -> Void

    init(title: String, keyEquivalent: String = "", enabled: Bool = true, handler: @escaping () -> Void) {
        self.handler = handler
        super.init(title: title, action: #selector(invoke), keyEquivalent: keyEquivalent)
        self.target = self
        self.isEnabled = enabled
    }

    @available(*, unavailable)
    required init(coder: NSCoder) { fatalError("init(coder:) is not used") }

    @objc private func invoke() { handler() }
}

extension NSMenu {
    @discardableResult
    func addAction(_ title: String, keyEquivalent: String = "", enabled: Bool = true,
                   handler: @escaping () -> Void) -> NSMenuItem {
        let item = ActionMenuItem(title: title, keyEquivalent: keyEquivalent, enabled: enabled, handler: handler)
        addItem(item)
        return item
    }

    func addDisabled(_ title: String) {
        let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        item.isEnabled = false
        addItem(item)
    }
}
