import AppKit

/// Small modal prompts built on `NSAlert` with an accessory view.
enum InputPrompts {
    /// Multiline description editor. Dictation works for free in an `NSTextView`.
    @MainActor
    static func description(initial: String) -> String? {
        let alert = NSAlert()
        alert.messageText = "Description du timer"
        alert.informativeText = "Saisis ou dicte ce sur quoi tu travailles (fn fn pour dicter)."

        let scroll = NSScrollView(frame: NSRect(x: 0, y: 0, width: 340, height: 90))
        scroll.hasVerticalScroller = true
        scroll.borderType = .bezelBorder
        let tv = NSTextView(frame: scroll.bounds)
        tv.isEditable = true
        tv.isRichText = false
        tv.font = .systemFont(ofSize: 13)
        tv.string = initial
        tv.textContainerInset = NSSize(width: 4, height: 6)
        scroll.documentView = tv
        alert.accessoryView = scroll

        alert.addButton(withTitle: "Enregistrer")
        alert.addButton(withTitle: "Annuler")
        NSApp.activate(ignoringOtherApps: true)
        alert.window.initialFirstResponder = tv
        return alert.runModal() == .alertFirstButtonReturn ? tv.string : nil
    }

    /// Numeric minutes prompt for "Ajouter du temps → Autre…".
    @MainActor
    static func minutes() -> Double? {
        let alert = NSAlert()
        alert.messageText = "Ajouter du temps au timer"
        alert.informativeText = "Nombre de minutes à ajouter (antidate le démarrage)."

        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 200, height: 24))
        field.placeholderString = "20"
        alert.accessoryView = field

        alert.addButton(withTitle: "Ajouter")
        alert.addButton(withTitle: "Annuler")
        NSApp.activate(ignoringOtherApps: true)
        alert.window.initialFirstResponder = field
        guard alert.runModal() == .alertFirstButtonReturn else { return nil }
        let value = Double(field.stringValue.replacingOccurrences(of: ",", with: "."))
        guard let v = value, v > 0 else { return nil }
        return v
    }
}
