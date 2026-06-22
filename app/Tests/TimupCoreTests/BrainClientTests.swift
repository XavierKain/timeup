import XCTest
@testable import TimupCore

final class BrainClientTests: XCTestCase {
    override func setUp() { MockURLProtocol.reset() }

    func testDecodesRunningTimer() async throws {
        MockURLProtocol.routes["GET /timer"] = .init(status: 200, json: """
        {"running":true,"projectId":13,"startedAt":1781982755092,"tz":"Europe/Paris",
         "paused":false,"elapsedRawSeconds":42,"elapsedActiveSeconds":40,
         "segments":[{"startAt":1,"endAt":null}],"description":"refacto"}
        """)
        let state = try await makeTestClient().getTimer()
        guard case let .running(r) = state else { return XCTFail("expected running") }
        XCTAssertEqual(r.projectId, 13)
        XCTAssertEqual(r.elapsedActiveSeconds, 40)
        XCTAssertEqual(r.description, "refacto")
        XCTAssertFalse(r.paused)
    }

    func testDecodesStoppedTimer() async throws {
        MockURLProtocol.routes["GET /timer"] = .init(status: 200, json: #"{"running":false}"#)
        let state = try await makeTestClient().getTimer()
        XCTAssertEqual(state, .stopped)
        XCTAssertFalse(state.isRunning)
    }

    func testStartSendsProjectId() async throws {
        MockURLProtocol.routes["POST /timer/start"] = .init(status: 201, json: #"{"running":false}"#)
        _ = try await makeTestClient().start(projectId: 7)
        let rec = MockURLProtocol.recorded.first { $0.path == "/timer/start" }
        XCTAssertEqual(rec?.method, "POST")
        let body = try XCTUnwrap(rec?.body)
        let json = try JSONSerialization.jsonObject(with: body) as? [String: Any]
        XCTAssertEqual(json?["projectId"] as? Int, 7)
    }

    func testStopDecodesEntry() async throws {
        MockURLProtocol.routes["POST /timer/stop"] = .init(status: 201, json: """
        {"id":1,"durationSeconds":3600,"rawSeconds":3600,"idleSeconds":0}
        """)
        let out = try await makeTestClient().stop()
        XCTAssertFalse(out.discarded)
        XCTAssertEqual(out.durationSeconds, 3600)
    }

    func testStopDecodesDiscarded() async throws {
        MockURLProtocol.routes["POST /timer/stop"] = .init(status: 200, json: """
        {"discarded":true,"reason":"too_short","durationSeconds":42}
        """)
        let out = try await makeTestClient().stop()
        XCTAssertTrue(out.discarded)
        XCTAssertEqual(out.durationSeconds, 42)
        XCTAssertEqual(out.reason, "too_short")
    }

    /// The bug we hit: a POST with content-type JSON must carry a non-empty body.
    func testWritesAlwaysSendNonEmptyJSONBody() async throws {
        MockURLProtocol.routes["POST /timer/pause"] = .init(status: 200, json: #"{"running":false}"#)
        try await makeTestClient().pause()
        let rec = try XCTUnwrap(MockURLProtocol.recorded.first { $0.path == "/timer/pause" })
        let body = try XCTUnwrap(rec.body)
        XCTAssertFalse(body.isEmpty, "POST body must not be empty")
        XCTAssertEqual(String(data: body, encoding: .utf8), "{}")
    }

    func testResumeKeepIdleSendsFlag() async throws {
        MockURLProtocol.routes["POST /timer/resume"] = .init(status: 200, json: #"{"running":false}"#)
        try await makeTestClient().resume(keepIdle: true)
        let rec = try XCTUnwrap(MockURLProtocol.recorded.first { $0.path == "/timer/resume" })
        let json = try JSONSerialization.jsonObject(with: XCTUnwrap(rec.body)) as? [String: Any]
        XCTAssertEqual(json?["keepIdle"] as? Bool, true)
    }

    func testExcludeCompletedQuery() async throws {
        MockURLProtocol.routes["GET /projects?excludeCompleted=true"] = .init(status: 200, json: """
        [{"id":1,"clientId":2,"name":"P","mode":"horaire","archived":false,"completed":false}]
        """)
        let ps = try await makeTestClient().listProjects(excludeCompleted: true)
        XCTAssertEqual(ps.count, 1)
        XCTAssertEqual(ps.first?.mode, .horaire)
        XCTAssertTrue(ps.first!.isActive)
    }

    func testErrorPropagation() async throws {
        MockURLProtocol.routes["POST /timer/stop"] = .init(status: 409, json: """
        {"error":{"code":"NO_RUNNING_TIMER","message":"No timer is running"}}
        """)
        do {
            _ = try await makeTestClient().stop()
            XCTFail("expected throw")
        } catch let e as BrainError {
            XCTAssertEqual(e.status, 409)
            XCTAssertEqual(e.message, "No timer is running")
        }
    }

    func testLastProjectNullable() async throws {
        MockURLProtocol.routes["GET /timer/last"] = .init(status: 200, json: #"{"projectId":null}"#)
        let last = try await makeTestClient().getLast()
        XCTAssertNil(last.projectId)
    }
}
