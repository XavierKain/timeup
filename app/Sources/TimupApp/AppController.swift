import AppKit
import TimupCore

/// The central coordinator: owns the status item, polls the brain, builds the
/// menu, wires the global hot key, the in-app idle monitor and the settings.
@MainActor
final class AppController: NSObject, NSMenuDelegate {
    private let prefs = Preferences()
    private let system = SystemIdle()

    private var client: BrainClient?
    private let dashboardURL: URL

    private var statusItem: NSStatusItem!
    private let menu = NSMenu()

    private var idleMonitor: IdleMonitor?
    private let hotKey = GlobalHotKey()
    private var settingsWC: SettingsWindowController?
    private var settingsModel: SettingsModel?

    private var snapshot: MenuSnapshot?
    private var reachable = false
    private var pollTimer: Timer?
    private var tickTimer: Timer?
    private lazy var actions = makeActions()

    override init() {
        if let config = try? BrainConfig.load() {
            self.client = BrainClient(config: config)
            self.dashboardURL = config.baseURL
        } else {
            self.client = nil
            self.dashboardURL = URL(string: "http://127.0.0.1:47823")!
            appLog("config.json introuvable — l'app tournera en mode dégradé")
        }
        super.init()
    }

    func start() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let button = statusItem.button {
            button.image = NSImage(systemSymbolName: "clock", accessibilityDescription: "Timup")
            button.image?.isTemplate = true
            button.imagePosition = .imageLeading
        }
        menu.delegate = self
        statusItem.menu = menu

        // Idle monitor (in-app; replaces the launchd idle-watcher).
        if let client {
            let monitor = IdleMonitor(client: client, prefs: prefs, system: system)
            monitor.onChanged = { [weak self] in Task { @MainActor in await self?.refresh() } }
            monitor.start()
            idleMonitor = monitor
        }

        // Global hot key: toggle the last timer.
        hotKey.onFire = { [weak self] in self?.toggleLast() }
        hotKey.apply(HotKeyStore.config)

        // Settings.
        let model = SettingsModel(prefs: prefs)
        model.onHotKeyChange = { [weak self] cfg in self?.hotKey.apply(cfg) }
        model.checkConnection = { [weak self] in
            guard let client = self?.client else { return false }
            return await client.isHealthy()
        }
        settingsModel = model
        settingsWC = SettingsWindowController(model: model)

        // Polling + ticking clock.
        let poll = Timer(timeInterval: 10, repeats: true) { [weak self] _ in
            Task { @MainActor in await self?.refresh() }
        }
        RunLoop.main.add(poll, forMode: .common)
        pollTimer = poll

        let tick = Timer(timeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.updateTitle() }
        }
        RunLoop.main.add(tick, forMode: .common)
        tickTimer = tick

        Task { @MainActor in await refresh() }

        // Diagnostic: TIMUP_HUD_TEST=1 re-flashes a sample HUD every 3s.
        if ProcessInfo.processInfo.environment["TIMUP_HUD_TEST"] != nil {
            let t = Timer(timeInterval: 3, repeats: true) { _ in
                Task { @MainActor in HUD.shared.show("⏹ Arrêté — enregistré · 1h23") }
            }
            RunLoop.main.add(t, forMode: .common)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                HUD.shared.show("⏹ Arrêté — enregistré · 1h23")
            }
        }

        appLog("status item ready")
    }

    // MARK: NSMenuDelegate

    func menuNeedsUpdate(_ menu: NSMenu) {
        MenuBuilder.populate(menu, snapshot: snapshot, reachable: reachable, actions: actions)
        Task { @MainActor in await refresh() } // freshen the cache for next open
    }

    // MARK: Refresh / title

    private func refresh() async {
        guard let client else { reachable = false; updateTitle(); return }
        do {
            snapshot = try await MenuSnapshot.load(client)
            reachable = true
        } catch {
            reachable = false
        }
        updateTitle()
    }

    private func updateTitle() {
        guard let button = statusItem?.button else { return }
        if reachable, let snap = snapshot, snap.isRunning {
            button.title = " " + Format.menuTitle(clientName: snap.currentClientName,
                                                  activeSeconds: snap.liveActiveSeconds())
        } else {
            button.title = ""
        }
    }

    // MARK: Actions

    private func makeActions() -> MenuActions {
        MenuActions(
            editDescription: { [weak self] in self?.editDescription() },
            togglePause: { [weak self] in self?.togglePause() },
            stop: { [weak self] in self?.stop() },
            discard: { [weak self] in self?.discard() },
            reassign: { [weak self] pid in self?.reassign(pid) },
            addMinutes: { [weak self] m in self?.addMinutes(m) },
            customAddTime: { [weak self] in self?.customAddTime() },
            start: { [weak self] pid in self?.start(pid) },
            openDashboard: { [weak self] in
                guard let self else { return }
                NSWorkspace.shared.open(self.dashboardURL)
            },
            openSettings: { [weak self] in self?.settingsWC?.show() },
            quit: { NSApp.terminate(nil) }
        )
    }

    /// Run a brain write, show a HUD (success message or error), then refresh.
    private func run(success: @escaping () -> String?, _ op: @escaping (BrainClient) async throws -> Void) {
        guard let client else { return }
        Task { @MainActor in
            do {
                try await op(client)
                if let msg = success() { HUD.shared.show(msg) }
            } catch {
                HUD.shared.show("⚠️ " + Self.errorText(error))
            }
            await refresh()
        }
    }

    private func projectName(_ id: Int) -> String {
        snapshot?.activeProjects.first { $0.id == id }?.name ?? "projet"
    }

    private static func errorText(_ error: Error) -> String {
        if let e = error as? BrainError { return e.message }
        return String(describing: error)
    }

    // The HUD messages mirror the old Raycast HUDs, and spell out recorded-vs-discarded.

    func toggleLast() {
        guard let client else { return }
        Task { @MainActor in
            do {
                let st = try await client.getTimer()
                if st.isRunning {
                    let outcome = try await client.stop()
                    HUD.shared.show(Self.stopMessage(outcome))
                } else {
                    let last = try await client.getLast()
                    guard let pid = last.projectId else {
                        HUD.shared.show("Aucun timer récent à relancer"); return
                    }
                    try await client.start(projectId: pid)
                    HUD.shared.show("▶︎ Relancé — \(last.projectName ?? projectName(pid))")
                }
            } catch { HUD.shared.show("⚠️ " + Self.errorText(error)) }
            await refresh()
        }
    }

    private func stop() {
        guard let client else { return }
        Task { @MainActor in
            do {
                let outcome = try await client.stop()
                HUD.shared.show(Self.stopMessage(outcome))
            } catch { HUD.shared.show("⚠️ " + Self.errorText(error)) }
            await refresh()
        }
    }

    private static func stopMessage(_ outcome: StopOutcome) -> String {
        outcome.discarded
            ? "⏱ Trop court — annulé (non enregistré)"
            : "⏹ Arrêté — enregistré · \(Format.hours(outcome.durationSeconds))"
    }

    private func start(_ pid: Int) {
        let name = projectName(pid)
        run(success: { "▶︎ Timer lancé — \(name)" }) { try await $0.start(projectId: pid) }
    }

    private func reassign(_ pid: Int) {
        let name = projectName(pid)
        run(success: { "↪ Réassigné — \(name)" }) { _ = try await $0.reassign(projectId: pid) }
    }

    private func addMinutes(_ minutes: Double) {
        let label = minutes.rounded() == minutes ? String(Int(minutes)) : String(minutes)
        run(success: { "＋\(label) min ajoutées" }) { try await $0.addMinutes(minutes) }
    }

    private func discard() {
        run(success: { "🗑 Timer annulé (non enregistré)" }) { try await $0.discard() }
    }

    private func togglePause() {
        guard let client else { return }
        Task { @MainActor in
            do {
                let st = try await client.getTimer()
                guard let r = st.running else { return }
                if r.paused {
                    try await client.resume(); HUD.shared.show("▶︎ Timer repris")
                } else {
                    try await client.pause(); HUD.shared.show("⏸ Timer en pause")
                }
            } catch { HUD.shared.show("⚠️ " + Self.errorText(error)) }
            await refresh()
        }
    }

    private func editDescription() {
        let initial = snapshot?.timer.running?.description ?? ""
        guard let text = InputPrompts.description(initial: initial) else { return }
        let empty = text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        run(success: { empty ? "📝 Description effacée" : "📝 Description enregistrée" }) {
            try await $0.setDescription(text)
        }
    }

    private func customAddTime() {
        guard let minutes = InputPrompts.minutes() else { return }
        addMinutes(minutes)
    }
}
