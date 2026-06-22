import XCTest
@testable import TimupCore

final class IdleDeciderTests: XCTestCase {
    let thresh: Double = 300

    private func input(running: Bool = true, paused: Bool = false, pausedByIdle: Bool = false,
                       locked: Bool = false, idle: Double = 0, returnMax: Double = 5) -> IdleInput {
        IdleInput(running: running, paused: paused, pausedByIdle: pausedByIdle, locked: locked,
                  idleSeconds: idle, idleThreshold: thresh, returnIdleMax: returnMax)
    }

    func testNotRunning() {
        XCTAssertEqual(IdleDecider.decide(input(running: false, locked: true, idle: 9999)), .none)
    }

    func testIdleBelowThreshold() {
        XCTAssertEqual(IdleDecider.decide(input(idle: thresh - 1)), .none)
    }

    func testIdleAtOrOverThreshold() {
        XCTAssertEqual(IdleDecider.decide(input(idle: thresh)), .pause)
        XCTAssertEqual(IdleDecider.decide(input(idle: thresh + 120)), .pause)
    }

    func testLockedWinsOverIdle() {
        XCTAssertEqual(IdleDecider.decide(input(locked: true, idle: thresh + 999)), .stop)
    }

    func testReturnFromIdle() {
        XCTAssertEqual(IdleDecider.decide(input(paused: true, pausedByIdle: true, idle: 2)), .return)
    }

    func testStillAwayStaysPaused() {
        XCTAssertEqual(IdleDecider.decide(input(paused: true, pausedByIdle: true, idle: thresh + 60)), .none)
    }

    func testManualPauseNeverAutoResumed() {
        XCTAssertEqual(IdleDecider.decide(input(paused: true, pausedByIdle: false, idle: 0)), .none)
    }

    func testReturnBoundaryExclusive() {
        XCTAssertEqual(IdleDecider.decide(input(paused: true, pausedByIdle: true, idle: 4)), .return)
        XCTAssertEqual(IdleDecider.decide(input(paused: true, pausedByIdle: true, idle: 5)), .none)
    }
}
