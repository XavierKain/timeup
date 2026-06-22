import Foundation
import TimupCore

// Functional smoke test against the LIVE brain. Exercises every BrainClient
// write path on a throwaway timer, then discards it (no entry is ever written).
// Safety: if a real timer is already running, it aborts without touching it.

var failures = 0
func check(_ cond: Bool, _ label: String) {
    print("\(cond ? "✓" : "✗") \(label)")
    if !cond { failures += 1 }
}

do {
    let config = try BrainConfig.load()
    let client = BrainClient(config: config)
    print("== Timup smoke — \(config.baseURL.absoluteString) ==")

    let healthy = await client.isHealthy()
    check(healthy, "brain /health 200")
    guard healthy else { exit(1) }

    // Safety gate: never disturb a real running timer.
    let initial = try await client.getTimer()
    if initial.isRunning {
        print("⚠️  un timer tourne déjà — ABANDON (on ne touche pas aux vraies données).")
        exit(0)
    }

    let projects = try await client.listProjects(excludeCompleted: true)
    check(!projects.isEmpty, "au moins un projet actif")
    guard let p0 = projects.first else { exit(failures == 0 ? 0 : 1) }
    let p1 = projects.dropFirst().first

    // start
    _ = try await client.start(projectId: p0.id)
    var st = try await client.getTimer()
    check(st.running?.projectId == p0.id, "start -> running sur projet \(p0.id)")

    // description
    try await client.setDescription("smoke test (auto, à ignorer)")
    st = try await client.getTimer()
    check(st.running?.description == "smoke test (auto, à ignorer)", "setDescription appliquée")

    // pause / resume
    try await client.pause()
    st = try await client.getTimer()
    check(st.running?.paused == true, "pause -> paused")

    try await client.resume()
    st = try await client.getTimer()
    check(st.running?.paused == false, "resume -> actif")

    // add time (backdates start; just assert it doesn't throw)
    try await client.addMinutes(5)
    print("✓ addMinutes(5) ok")

    // stats
    if let stats = try? await client.stats(projectId: p0.id) {
        print("ℹ︎ stats: mode=\(stats.mode) restant=\(stats.remainingSeconds.map(String.init) ?? "n/a")")
    }

    // reassign (to a second active project when available)
    if let p1 {
        _ = try await client.reassign(projectId: p1.id)
        st = try await client.getTimer()
        check(st.running?.projectId == p1.id, "reassign -> projet \(p1.id)")
    }

    // discard: removes the timer with NO entry written
    try await client.discard()
    st = try await client.getTimer()
    check(st == .stopped, "discard -> stopped (aucune entrée écrite)")

    // toggle-last building block
    let last = try await client.getLast()
    check(last.projectId != nil, "getLast renvoie le dernier projet")

    print(failures == 0 ? "\nSMOKE OK ✅" : "\n\(failures) échec(s) ❌")
    exit(failures == 0 ? 0 : 1)
} catch {
    print("✗ exception: \(error)")
    exit(1)
}
