import Foundation
import IOKit

/// Reads macOS HID idle time and tracks screen-lock state — the native
/// equivalents of the old idle-watcher's `ioreg` shell-outs.
final class SystemIdle {
    private(set) var locked = false

    init() {
        let dnc = DistributedNotificationCenter.default()
        dnc.addObserver(self, selector: #selector(screenLocked),
                        name: NSNotification.Name("com.apple.screenIsLocked"), object: nil)
        dnc.addObserver(self, selector: #selector(screenUnlocked),
                        name: NSNotification.Name("com.apple.screenIsUnlocked"), object: nil)
    }

    deinit { DistributedNotificationCenter.default().removeObserver(self) }

    @objc private func screenLocked() { locked = true }
    @objc private func screenUnlocked() { locked = false }

    /// Seconds since the last keyboard/mouse event (HID idle time).
    func idleSeconds() -> Double {
        let service = IOServiceGetMatchingService(kIOMainPortDefault, IOServiceMatching("IOHIDSystem"))
        guard service != 0 else { return 0 }
        defer { IOObjectRelease(service) }

        var unmanaged: Unmanaged<CFMutableDictionary>?
        guard IORegistryEntryCreateCFProperties(service, &unmanaged, kCFAllocatorDefault, 0) == KERN_SUCCESS,
              let props = unmanaged?.takeRetainedValue() as? [String: Any] else { return 0 }

        if let number = props["HIDIdleTime"] as? NSNumber {
            return number.doubleValue / 1_000_000_000 // nanoseconds -> seconds
        }
        return 0
    }
}
