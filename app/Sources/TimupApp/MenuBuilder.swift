import AppKit
import TimupCore

/// Closures the menu invokes — keeps menu construction decoupled from the controller.
struct MenuActions {
    var editDescription: () -> Void
    var togglePause: () -> Void
    var stop: () -> Void
    var discard: () -> Void
    var reassign: (Int) -> Void
    var addMinutes: (Double) -> Void
    var customAddTime: () -> Void
    var start: (Int) -> Void
    var openDashboard: () -> Void
    var openSettings: () -> Void
    var quit: () -> Void
}

/// Builds the status-item menu from a snapshot, mirroring the Raycast menu bar.
enum MenuBuilder {
    /// Populate an existing menu in place (called from `menuNeedsUpdate`).
    static func populate(_ menu: NSMenu, snapshot: MenuSnapshot?, reachable: Bool, actions: MenuActions) {
        menu.removeAllItems()

        guard reachable, let snap = snapshot else {
            menu.addDisabled("Brain injoignable")
            menu.addItem(.separator())
            menu.addAction("Réglages…") { actions.openSettings() }
            menu.addAction("Quitter") { actions.quit() }
            return
        }

        if let r = snap.timer.running {
            let client = snap.currentClientName ?? "?"
            let project = snap.currentProject?.name ?? "Projet"
            let status = r.paused ? "en pause" : "en cours"
            menu.addAction("\(client) — \(project) · \(status)") { actions.editDescription() }

            let descTitle = (r.description?.isEmpty == false) ? "📝 \(r.description!)" : "Ajouter une description…"
            menu.addAction(descTitle) { actions.editDescription() }

            if let rem = snap.remainingSeconds {
                menu.addDisabled("Restant forfait : \(Format.hours(rem))")
            }

            menu.addItem(.separator())
            menu.addAction(r.paused ? "Reprendre" : "Pause") { actions.togglePause() }
            menu.addAction("Arrêter") { actions.stop() }
            menu.addAction("Annuler (sans enregistrer)") { actions.discard() }

            menu.addItem(.separator())
            menu.setSubmenu(projectSubmenu(snap, title: "Changer de projet") { actions.reassign($0) },
                            for: menu.addItem(withTitle: "Changer de projet", action: nil, keyEquivalent: ""))
            menu.setSubmenu(addTimeSubmenu(actions), for: menu.addItem(withTitle: "Ajouter du temps", action: nil, keyEquivalent: ""))
        } else {
            menu.addDisabled("Aucun timer en cours")
            if let last = snap.lastProject, let pid = last.projectId {
                menu.addAction("Démarrer le dernier : \(last.projectName ?? "projet")") { actions.start(pid) }
            }
            menu.setSubmenu(projectSubmenu(snap, title: "Démarrer un projet") { actions.start($0) },
                            for: menu.addItem(withTitle: "Démarrer un projet", action: nil, keyEquivalent: ""))
        }

        menu.addItem(.separator())
        menu.addAction("Ouvrir le dashboard") { actions.openDashboard() }
        menu.addAction("Réglages…") { actions.openSettings() }
        menu.addItem(.separator())
        menu.addAction("Quitter") { actions.quit() }
    }

    private static func projectSubmenu(_ snap: MenuSnapshot, title: String,
                                       pick: @escaping (Int) -> Void) -> NSMenu {
        let sub = NSMenu(title: title)
        if snap.activeProjects.isEmpty {
            sub.addDisabled("Aucun projet actif")
        }
        for p in snap.activeProjects {
            let client = snap.clientsById[p.clientId] ?? "?"
            sub.addAction("\(client) — \(p.name)") { pick(p.id) }
        }
        return sub
    }

    private static func addTimeSubmenu(_ actions: MenuActions) -> NSMenu {
        let sub = NSMenu(title: "Ajouter du temps")
        for m in [5, 10, 15, 30] {
            sub.addAction("+\(m) min") { actions.addMinutes(Double(m)) }
        }
        sub.addItem(.separator())
        sub.addAction("Autre… (saisir)") { actions.customAddTime() }
        return sub
    }
}
