import Foundation
import TimupCore

/// Everything the menu needs in one fetch, mirroring the Raycast menu-bar `load()`.
struct MenuSnapshot {
    var timer: TimerState = .stopped
    var activeProjects: [Project] = []          // not archived, not completed
    var clientsById: [Int: String] = [:]
    var currentProject: Project?                // when running
    var currentClientName: String?
    var remainingSeconds: Int?                  // forfait remaining for the running project
    var lastProject: LastProject?
    var fetchedAt: Date = Date()

    var isRunning: Bool { timer.isRunning }

    static func load(_ client: BrainClient) async throws -> MenuSnapshot {
        let timer = try await client.getTimer()
        async let projectsCall = client.listProjects()
        async let clientsCall = client.listClients()
        let projects = try await projectsCall
        let clients = try await clientsCall

        var snap = MenuSnapshot()
        snap.timer = timer
        snap.activeProjects = projects.filter { $0.isActive }
        snap.clientsById = Dictionary(uniqueKeysWithValues: clients.map { ($0.id, $0.name) })

        if let r = timer.running {
            // Current project may be archived/completed yet still running — look in the full list.
            snap.currentProject = projects.first { $0.id == r.projectId }
            snap.currentClientName = snap.currentProject.flatMap { snap.clientsById[$0.clientId] }
            snap.remainingSeconds = (try? await client.stats(projectId: r.projectId))?.remainingSeconds
        } else {
            snap.lastProject = try? await client.getLast()
        }
        snap.fetchedAt = Date()
        return snap
    }

    /// Ticking title: server `elapsedActiveSeconds` plus wall time since the
    /// fetch, but only while actively running (frozen while paused).
    func liveActiveSeconds(now: Date = Date()) -> Int {
        guard let r = timer.running else { return 0 }
        if r.paused { return r.elapsedActiveSeconds }
        return r.elapsedActiveSeconds + Int(now.timeIntervalSince(fetchedAt))
    }
}
