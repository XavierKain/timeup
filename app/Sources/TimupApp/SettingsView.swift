import AppKit
import SwiftUI
import TimupCore

@MainActor
final class SettingsModel: ObservableObject {
    @Published var launchAtLogin: Bool
    @Published var idleMinutes: Int
    @Published var promptOnReturn: Bool
    @Published var hotKey: HotKeyConfig?
    @Published var brainConnected: Bool?

    private let prefs: Preferences
    var onHotKeyChange: ((HotKeyConfig?) -> Void)?
    var checkConnection: (() async -> Bool)?

    init(prefs: Preferences) {
        self.prefs = prefs
        self.launchAtLogin = LoginItem.isEnabled
        self.idleMinutes = prefs.idleThresholdMinutes
        self.promptOnReturn = prefs.promptOnReturn
        self.hotKey = HotKeyStore.config
        self.brainConnected = nil
    }

    func setLaunch(_ on: Bool) {
        do { try LoginItem.setEnabled(on) } catch { appLog("login item: \(error)") }
        launchAtLogin = LoginItem.isEnabled
    }
    func setIdle(_ m: Int) { prefs.idleThresholdMinutes = m; idleMinutes = prefs.idleThresholdMinutes }
    func setPrompt(_ b: Bool) { prefs.promptOnReturn = b; promptOnReturn = b }
    func setHotKey(_ c: HotKeyConfig?) { HotKeyStore.config = c; hotKey = c; onHotKeyChange?(c) }
    func refreshConnection() {
        Task { @MainActor in self.brainConnected = await checkConnection?() ?? false }
    }
}

struct SettingsView: View {
    @ObservedObject var model: SettingsModel

    var body: some View {
        Form {
            Section("Démarrage") {
                Toggle("Lancer Timup à l'ouverture de session",
                       isOn: Binding(get: { model.launchAtLogin }, set: { model.setLaunch($0) }))
            }

            Section("Inactivité") {
                Stepper(value: Binding(get: { model.idleMinutes }, set: { model.setIdle($0) }), in: 1...120) {
                    Text("Mettre en pause après \(model.idleMinutes) min d'inactivité")
                }
                Toggle("Demander quoi faire du temps inactif au retour",
                       isOn: Binding(get: { model.promptOnReturn }, set: { model.setPrompt($0) }))
            }

            Section("Raccourci global") {
                HStack {
                    Text("Démarrer / arrêter le dernier timer")
                    Spacer()
                    HotKeyRecorder(config: model.hotKey, onChange: { model.setHotKey($0) })
                        .frame(width: 160, height: 24)
                    Button("Effacer") { model.setHotKey(nil) }
                        .disabled(model.hotKey == nil)
                }
            }

            Section("Brain") {
                HStack {
                    switch model.brainConnected {
                    case .some(true): Label("Connecté au brain", systemImage: "checkmark.circle.fill").foregroundColor(.green)
                    case .some(false): Label("Brain injoignable", systemImage: "xmark.circle.fill").foregroundColor(.red)
                    case .none: Label("Vérification…", systemImage: "circle.dashed")
                    }
                    Spacer()
                    Button("Tester") { model.refreshConnection() }
                }
            }
        }
        .formStyle(.grouped)
        .frame(width: 460, height: 360)
        .onAppear { model.refreshConnection() }
    }
}

// MARK: - Hot key recorder (AppKit bridged into SwiftUI)

struct HotKeyRecorder: NSViewRepresentable {
    var config: HotKeyConfig?
    var onChange: (HotKeyConfig?) -> Void

    func makeNSView(context: Context) -> RecorderButton {
        let b = RecorderButton()
        b.onCapture = onChange
        b.refresh(config)
        return b
    }

    func updateNSView(_ nsView: RecorderButton, context: Context) {
        nsView.onCapture = onChange
        nsView.refresh(config)
    }
}

final class RecorderButton: NSButton {
    var onCapture: ((HotKeyConfig?) -> Void)?
    private var monitor: Any?
    private var current: HotKeyConfig?
    private var recording = false

    init() {
        super.init(frame: .zero)
        bezelStyle = .rounded
        setButtonType(.momentaryPushIn)
        target = self
        action = #selector(toggle)
        refresh(nil)
    }
    @available(*, unavailable) required init?(coder: NSCoder) { fatalError() }

    func refresh(_ cfg: HotKeyConfig?) {
        current = cfg
        if !recording { title = cfg?.display ?? "Enregistrer…" }
    }

    @objc private func toggle() {
        recording ? stopRecording(commit: nil) : startRecording()
    }

    private func startRecording() {
        recording = true
        title = "Tapez la combinaison…"
        window?.makeFirstResponder(self)
        monitor = NSEvent.addLocalMonitorForEvents(matching: [.keyDown]) { [weak self] event in
            self?.handle(event)
            return nil // swallow while recording
        }
    }

    private func handle(_ event: NSEvent) {
        if event.keyCode == UInt16(53) { // Escape -> cancel
            stopRecording(commit: current)
            return
        }
        let mods = event.modifierFlags.intersection([.command, .option, .control, .shift])
        guard !mods.isEmpty else { return } // require a modifier
        let cfg = HotKeyConfig(keyCode: event.keyCode, modifiers: mods)
        stopRecording(commit: cfg)
        onCapture?(cfg)
    }

    private func stopRecording(commit: HotKeyConfig?) {
        if let monitor { NSEvent.removeMonitor(monitor) }
        monitor = nil
        recording = false
        refresh(commit ?? current)
    }
}
