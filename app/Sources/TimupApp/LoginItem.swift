import Foundation
import ServiceManagement

/// Launch-at-login via the modern ServiceManagement API (macOS 13+).
/// Only works for a bundled, signed `.app` — a no-op feel in raw dev runs.
enum LoginItem {
    static var isEnabled: Bool { SMAppService.mainApp.status == .enabled }

    static func setEnabled(_ on: Bool) throws {
        if on {
            if SMAppService.mainApp.status != .enabled { try SMAppService.mainApp.register() }
        } else {
            if SMAppService.mainApp.status == .enabled { try SMAppService.mainApp.unregister() }
        }
    }
}
