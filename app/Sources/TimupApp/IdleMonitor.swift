import AppKit
import TimupCore

/// In-app inactivity/lock watcher (US-4). Replaces the standalone
/// `macos/idle-watcher.mjs` launchd agent: polls HID idle + lock state every
/// 15s and applies the shared `IdleDecider` logic against the brain.
@MainActor
final class IdleMonitor {
    private let client: BrainClient
    private let prefs: Preferences
    private let system: SystemIdle

    /// Called after the monitor changes the timer, so the menu refreshes.
    var onChanged: (() -> Void)?

    private var timer: Timer?
    private var ticking = false
    private var pausedByIdle = false
    private var idleStartMs: Double?

    private let pollInterval: TimeInterval = 15

    init(client: BrainClient, prefs: Preferences, system: SystemIdle) {
        self.client = client
        self.prefs = prefs
        self.system = system
    }

    func start() {
        let t = Timer(timeInterval: pollInterval, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tick() }
        }
        RunLoop.main.add(t, forMode: .common)
        timer = t
        appLog("idle monitor started (threshold \(prefs.idleThresholdMinutes) min, poll \(Int(pollInterval))s)")
    }

    func stop() { timer?.invalidate(); timer = nil }

    private func tick() {
        guard !ticking else { return }
        ticking = true
        Task { @MainActor in
            await doTick()
            ticking = false
        }
    }

    private func doTick() async {
        let state: TimerState
        do { state = try await client.getTimer() } catch { return } // brain not up
        guard let r = state.running else {
            pausedByIdle = false; idleStartMs = nil; return
        }

        let locked = system.locked
        let idle = locked ? 0 : system.idleSeconds()
        let action = IdleDecider.decide(IdleInput(
            running: true, paused: r.paused, pausedByIdle: pausedByIdle, locked: locked,
            idleSeconds: idle, idleThreshold: prefs.idleThresholdSeconds))

        switch action {
        case .stop:
            _ = try? await client.stop()
            appLog("screen locked -> timer stopped")
            pausedByIdle = false; idleStartMs = nil
            onChanged?()

        case .pause:
            idleStartMs = Date().timeIntervalSince1970 * 1000 - idle * 1000
            try? await client.pause()
            pausedByIdle = true
            appLog("idle \(Int(idle))s -> paused")
            onChanged?()

        case .return:
            let nowMs = Date().timeIntervalSince1970 * 1000
            let awayMin = max(1, Int(((nowMs - (idleStartMs ?? nowMs)) / 60_000).rounded()))
            let decision = prefs.promptOnReturn ? promptIdle(awayMinutes: awayMin) : .remove
            switch decision {
            case .stop:
                _ = try? await client.stop()
                appLog("return -> stopped (idle discarded)")
            case .keep:
                try? await client.resume(keepIdle: true)
                appLog("return -> resumed, kept ~\(awayMin) min idle")
            case .remove:
                try? await client.resume()
                appLog("return -> resumed, removed ~\(awayMin) min idle")
            }
            pausedByIdle = false; idleStartMs = nil
            onChanged?()

        case .none:
            // Keep flags consistent if the user resumed by hand.
            if !r.paused { pausedByIdle = false; idleStartMs = nil }
        }
    }

    private enum IdleDecision { case keep, remove, stop }

    /// Native 3-choice dialog. Default (Enter) = "Retirer l'inactif".
    private func promptIdle(awayMinutes: Int) -> IdleDecision {
        let alert = NSAlert()
        alert.messageText = "Timup — inactivité détectée"
        alert.informativeText = "Tu étais inactif ~\(awayMinutes) min pendant que le timer tournait. Que faire de ce temps inactif ?"
        alert.alertStyle = .warning
        alert.addButton(withTitle: "Retirer l'inactif")  // .alertFirstButtonReturn (default)
        alert.addButton(withTitle: "Garder l'inactif")   // .alertSecondButtonReturn
        alert.addButton(withTitle: "Arrêter le timer")   // .alertThirdButtonReturn
        NSApp.activate(ignoringOtherApps: true)
        switch alert.runModal() {
        case .alertSecondButtonReturn: return .keep
        case .alertThirdButtonReturn: return .stop
        default: return .remove
        }
    }
}
