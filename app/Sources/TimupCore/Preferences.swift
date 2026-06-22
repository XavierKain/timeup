import Foundation

/// User-tunable settings, persisted in `UserDefaults`. The idle-related values
/// live here (in Core) so the monitor's behaviour stays testable.
public final class Preferences: @unchecked Sendable {
    private let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        self.defaults.register(defaults: [
            Keys.idleThresholdMinutes: 5,
            Keys.promptOnReturn: true,
        ])
    }

    private enum Keys {
        static let idleThresholdMinutes = "idleThresholdMinutes"
        static let promptOnReturn = "promptOnReturn"
    }

    /// Minutes of inactivity before the timer auto-pauses (default 5, min 1).
    public var idleThresholdMinutes: Int {
        get { max(1, defaults.integer(forKey: Keys.idleThresholdMinutes)) }
        set { defaults.set(max(1, newValue), forKey: Keys.idleThresholdMinutes) }
    }

    public var idleThresholdSeconds: Double { Double(idleThresholdMinutes) * 60 }

    /// Whether to show the native 3-choice dialog on return from idle.
    public var promptOnReturn: Bool {
        get { defaults.bool(forKey: Keys.promptOnReturn) }
        set { defaults.set(newValue, forKey: Keys.promptOnReturn) }
    }
}
