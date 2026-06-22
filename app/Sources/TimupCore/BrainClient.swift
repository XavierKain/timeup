import Foundation

public struct BrainError: Error, CustomStringConvertible, Equatable {
    public let status: Int
    public let message: String
    public var description: String { "HTTP \(status): \(message)" }
}

/// Async client for the Timup brain HTTP API. Injectable `URLSession` so it can
/// be exercised against a mock `URLProtocol` in tests.
public final class BrainClient: @unchecked Sendable {
    private let config: BrainConfig
    private let session: URLSession

    public init(config: BrainConfig, session: URLSession = .shared) {
        self.config = config
        self.session = session
    }

    // MARK: Timer

    public func getTimer() async throws -> TimerState {
        try await get("/timer")
    }

    @discardableResult
    public func start(projectId: Int) async throws -> TimerState {
        try await post("/timer/start", body: ["projectId": projectId])
    }

    public func stop() async throws -> StopOutcome {
        try await post("/timer/stop", body: [:])
    }

    public func pause() async throws {
        try await postIgnoring("/timer/pause")
    }

    /// Resume a paused timer. `keepIdle` reopens the last segment so the away
    /// time counts toward the duration ("garder l'inactif").
    public func resume(keepIdle: Bool = false) async throws {
        try await postIgnoring("/timer/resume", body: keepIdle ? ["keepIdle": true] : [:])
    }

    public func discard() async throws {
        try await postIgnoring("/timer/discard")
    }

    @discardableResult
    public func reassign(projectId: Int) async throws -> TimerState {
        try await post("/timer/reassign", body: ["projectId": projectId])
    }

    public func addMinutes(_ minutes: Double) async throws {
        try await postIgnoring("/timer/add", body: ["minutes": minutes])
    }

    public func setDescription(_ text: String) async throws {
        try await postIgnoring("/timer/description", body: ["description": text])
    }

    public func getLast() async throws -> LastProject {
        try await get("/timer/last")
    }

    // MARK: Catalog

    public func listProjects(excludeCompleted: Bool = false) async throws -> [Project] {
        try await get(excludeCompleted ? "/projects?excludeCompleted=true" : "/projects")
    }

    public func listClients() async throws -> [Client] {
        try await get("/clients")
    }

    public func stats(projectId: Int) async throws -> ProjectStats {
        try await get("/projects/\(projectId)/stats")
    }

    /// True if the brain answers `/health` with 200.
    public func isHealthy() async -> Bool {
        do {
            let (_, response) = try await rawRequest(method: "GET", path: "/health", body: nil)
            return (response as? HTTPURLResponse)?.statusCode == 200
        } catch {
            return false
        }
    }

    // MARK: Plumbing

    private func get<T: Decodable>(_ path: String) async throws -> T {
        let (data, response) = try await rawRequest(method: "GET", path: path, body: nil)
        try Self.ensureOK(data: data, response: response)
        return try Self.decoder.decode(T.self, from: data)
    }

    private func post<T: Decodable>(_ path: String, body: [String: Any]) async throws -> T {
        let (data, response) = try await rawRequest(method: "POST", path: path, body: body)
        try Self.ensureOK(data: data, response: response)
        return try Self.decoder.decode(T.self, from: data)
    }

    /// POST whose response body we don't need. Defaults to an empty JSON object
    /// body — the brain rejects an empty body when content-type is JSON.
    private func postIgnoring(_ path: String, body: [String: Any] = [:]) async throws {
        let (data, response) = try await rawRequest(method: "POST", path: path, body: body)
        try Self.ensureOK(data: data, response: response)
    }

    private func rawRequest(method: String, path: String, body: [String: Any]?) async throws -> (Data, URLResponse) {
        guard let url = URL(string: path, relativeTo: config.baseURL) else {
            throw BrainError(status: 0, message: "URL invalide: \(path)")
        }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("Bearer \(config.token)", forHTTPHeaderField: "authorization")
        if method != "GET" {
            // Always send a (non-empty) JSON body for writes.
            let payload = body ?? [:]
            req.httpBody = try JSONSerialization.data(withJSONObject: payload)
            req.setValue("application/json", forHTTPHeaderField: "content-type")
        }
        return try await session.data(for: req)
    }

    private static func ensureOK(data: Data, response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse else {
            throw BrainError(status: 0, message: "réponse non-HTTP")
        }
        guard (200...299).contains(http.statusCode) else {
            throw BrainError(status: http.statusCode, message: extractMessage(data) ?? "HTTP \(http.statusCode)")
        }
    }

    private static func extractMessage(_ data: Data) -> String? {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let err = json["error"] as? [String: Any],
              let msg = err["message"] as? String else { return nil }
        return msg
    }

    private static let decoder = JSONDecoder()
}
