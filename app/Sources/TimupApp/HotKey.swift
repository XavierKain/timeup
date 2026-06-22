import AppKit
import Carbon.HIToolbox

/// A persisted global shortcut (key code + Cocoa modifier flags).
struct HotKeyConfig: Equatable {
    var keyCode: UInt16
    var modifiers: NSEvent.ModifierFlags

    var carbonModifiers: UInt32 {
        var m: UInt32 = 0
        if modifiers.contains(.command) { m |= UInt32(cmdKey) }
        if modifiers.contains(.option) { m |= UInt32(optionKey) }
        if modifiers.contains(.control) { m |= UInt32(controlKey) }
        if modifiers.contains(.shift) { m |= UInt32(shiftKey) }
        return m
    }

    /// Human display, e.g. "⌃⌥⌘T".
    var display: String {
        var s = ""
        if modifiers.contains(.control) { s += "⌃" }
        if modifiers.contains(.option) { s += "⌥" }
        if modifiers.contains(.shift) { s += "⇧" }
        if modifiers.contains(.command) { s += "⌘" }
        s += Self.keyName(keyCode)
        return s
    }

    static func keyName(_ code: UInt16) -> String {
        let specials: [UInt16: String] = [
            UInt16(kVK_Space): "Space", UInt16(kVK_Return): "↩", UInt16(kVK_Tab): "⇥",
            UInt16(kVK_Escape): "⎋", UInt16(kVK_Delete): "⌫",
            UInt16(kVK_F1): "F1", UInt16(kVK_F2): "F2", UInt16(kVK_F3): "F3", UInt16(kVK_F4): "F4",
            UInt16(kVK_F5): "F5", UInt16(kVK_F6): "F6", UInt16(kVK_F7): "F7", UInt16(kVK_F8): "F8",
            UInt16(kVK_F9): "F9", UInt16(kVK_F10): "F10", UInt16(kVK_F11): "F11", UInt16(kVK_F12): "F12",
        ]
        if let s = specials[code] { return s }
        return characterForKeyCode(code)?.uppercased() ?? "Key\(code)"
    }

    /// Best-effort label of the key's unmodified character via the current layout.
    private static func characterForKeyCode(_ keyCode: UInt16) -> String? {
        guard let layoutData = TISGetInputSourceProperty(
            TISCopyCurrentKeyboardLayoutInputSource().takeRetainedValue(),
            kTISPropertyUnicodeKeyLayoutData) else { return nil }
        let data = unsafeBitCast(layoutData, to: CFData.self)
        let keyLayoutPtr = CFDataGetBytePtr(data)
        return keyLayoutPtr?.withMemoryRebound(to: UCKeyboardLayout.self, capacity: 1) { layout -> String? in
            var deadKeyState: UInt32 = 0
            var chars = [UniChar](repeating: 0, count: 4)
            var length = 0
            let status = UCKeyTranslate(
                layout, keyCode, UInt16(kUCKeyActionDisplay), 0,
                UInt32(LMGetKbdType()), OptionBits(kUCKeyTranslateNoDeadKeysBit),
                &deadKeyState, chars.count, &length, &chars)
            guard status == noErr, length > 0 else { return nil }
            return String(utf16CodeUnits: chars, count: length)
        }
    }
}

/// Persisted shortcut for the one global action (toggle last timer).
enum HotKeyStore {
    private static let codeKey = "hotkeyKeyCode"
    private static let modKey = "hotkeyModifiers"

    static var config: HotKeyConfig? {
        get {
            let d = UserDefaults.standard
            guard d.object(forKey: codeKey) != nil else { return nil }
            let code = UInt16(truncatingIfNeeded: d.integer(forKey: codeKey))
            let mods = NSEvent.ModifierFlags(rawValue: UInt(d.integer(forKey: modKey)))
            return HotKeyConfig(keyCode: code, modifiers: mods)
        }
        set {
            let d = UserDefaults.standard
            if let c = newValue {
                d.set(Int(c.keyCode), forKey: codeKey)
                d.set(Int(c.modifiers.rawValue), forKey: modKey)
            } else {
                d.removeObject(forKey: codeKey)
                d.removeObject(forKey: modKey)
            }
        }
    }
}

/// Registers a single global hot key via Carbon and fires a closure on press.
final class GlobalHotKey {
    static weak var current: GlobalHotKey?

    var onFire: (() -> Void)?
    private var ref: EventHotKeyRef?
    private var handlerInstalled = false

    private let hotKeyID = EventHotKeyID(signature: OSType(0x54494d50), id: 1) // 'TIMP'

    init() { GlobalHotKey.current = self }

    /// (Re)register from the stored config. Removes any existing registration first.
    func apply(_ config: HotKeyConfig?) {
        unregister()
        guard let config else { return }
        installHandlerIfNeeded()
        var newRef: EventHotKeyRef?
        let status = RegisterEventHotKey(
            UInt32(config.keyCode), config.carbonModifiers, hotKeyID,
            GetEventDispatcherTarget(), 0, &newRef)
        if status == noErr {
            ref = newRef
            appLog("hotkey registered: \(config.display)")
        } else {
            appLog("hotkey registration failed (status \(status)) — combo may be taken")
        }
    }

    func unregister() {
        if let ref { UnregisterEventHotKey(ref) }
        ref = nil
    }

    private func installHandlerIfNeeded() {
        guard !handlerInstalled else { return }
        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard),
                                 eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetEventDispatcherTarget(), { _, event, _ -> OSStatus in
            var fired = EventHotKeyID()
            GetEventParameter(event, EventParamName(kEventParamDirectObject),
                              EventParamType(typeEventHotKeyID), nil,
                              MemoryLayout<EventHotKeyID>.size, nil, &fired)
            if fired.id == 1 {
                DispatchQueue.main.async { GlobalHotKey.current?.onFire?() }
            }
            return noErr
        }, 1, &spec, nil, nil)
        handlerInstalled = true
    }

    deinit { unregister() }
}
