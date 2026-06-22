import Foundation

/// The single action the idle monitor should take this tick. Mirrors the
/// pure `decideAction` from `macos/idle-watcher.mjs`, ported to Swift so the
/// in-app monitor reuses the exact, tested decision logic.
public enum IdleAction: String, Sendable, Equatable {
    case none
    case stop    // screen locked while a timer runs -> stop & write the entry
    case pause   // idle past the threshold while running & active -> pause
    case `return` // user is back after an idle-pause -> resolve the away time
}

public struct IdleInput: Sendable, Equatable {
    public let running: Bool
    public let paused: Bool
    public let pausedByIdle: Bool
    public let locked: Bool
    public let idleSeconds: Double
    public let idleThreshold: Double
    public let returnIdleMax: Double

    public init(running: Bool, paused: Bool, pausedByIdle: Bool, locked: Bool,
                idleSeconds: Double, idleThreshold: Double, returnIdleMax: Double = 5) {
        self.running = running
        self.paused = paused
        self.pausedByIdle = pausedByIdle
        self.locked = locked
        self.idleSeconds = idleSeconds
        self.idleThreshold = idleThreshold
        self.returnIdleMax = returnIdleMax
    }
}

public enum IdleDecider {
    public static func decide(_ i: IdleInput) -> IdleAction {
        if !i.running { return .none }
        if i.locked { return .stop }
        if !i.paused && i.idleSeconds >= i.idleThreshold { return .pause }
        if i.paused && i.pausedByIdle && i.idleSeconds < i.returnIdleMax { return .return }
        return .none
    }
}
