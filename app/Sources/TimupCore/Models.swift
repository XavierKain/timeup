import Foundation

/// A billing mode for a project, mirroring the brain's `projects.mode`.
public enum ProjectMode: String, Codable, Sendable {
    case forfait
    case horaire
    case prix_fixe
}

public struct Project: Codable, Sendable, Identifiable, Equatable {
    public let id: Int
    public let clientId: Int
    public let name: String
    public let mode: ProjectMode
    public let archived: Bool
    public let completed: Bool

    public init(id: Int, clientId: Int, name: String, mode: ProjectMode,
                archived: Bool = false, completed: Bool = false) {
        self.id = id
        self.clientId = clientId
        self.name = name
        self.mode = mode
        self.archived = archived
        self.completed = completed
    }

    // `archived`/`completed` may be absent in older payloads → default to false.
    enum CodingKeys: String, CodingKey {
        case id, clientId, name, mode, archived, completed
    }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        clientId = try c.decode(Int.self, forKey: .clientId)
        name = try c.decode(String.self, forKey: .name)
        mode = try c.decode(ProjectMode.self, forKey: .mode)
        archived = try c.decodeIfPresent(Bool.self, forKey: .archived) ?? false
        completed = try c.decodeIfPresent(Bool.self, forKey: .completed) ?? false
    }

    /// Active = bookable from the pickers (not archived, not finished).
    public var isActive: Bool { !archived && !completed }
}

public struct Client: Codable, Sendable, Identifiable, Equatable {
    public let id: Int
    public let name: String

    public init(id: Int, name: String) {
        self.id = id
        self.name = name
    }
}

public struct ProjectStats: Codable, Sendable, Equatable {
    public let projectId: Int
    public let mode: String
    public let remainingSeconds: Int?

    public init(projectId: Int, mode: String, remainingSeconds: Int?) {
        self.projectId = projectId
        self.mode = mode
        self.remainingSeconds = remainingSeconds
    }
}

/// The most recently active project (for "start the last one").
public struct LastProject: Codable, Sendable, Equatable {
    public let projectId: Int?
    public let projectName: String?

    public init(projectId: Int?, projectName: String? = nil) {
        self.projectId = projectId
        self.projectName = projectName
    }
}

/// The live timer, mirroring the brain's discriminated union on `running`.
public enum TimerState: Sendable, Equatable {
    case stopped
    case running(Running)

    public struct Running: Sendable, Equatable {
        public let projectId: Int
        public let startedAt: Int
        public let tz: String
        public let paused: Bool
        public let elapsedRawSeconds: Int
        public let elapsedActiveSeconds: Int
        public let description: String?

        public init(projectId: Int, startedAt: Int, tz: String, paused: Bool,
                    elapsedRawSeconds: Int, elapsedActiveSeconds: Int, description: String?) {
            self.projectId = projectId
            self.startedAt = startedAt
            self.tz = tz
            self.paused = paused
            self.elapsedRawSeconds = elapsedRawSeconds
            self.elapsedActiveSeconds = elapsedActiveSeconds
            self.description = description
        }
    }

    public var isRunning: Bool { if case .running = self { return true } else { return false } }
    public var running: Running? { if case let .running(r) = self { return r } else { return nil } }
}

extension TimerState: Decodable {
    enum CodingKeys: String, CodingKey {
        case running, projectId, startedAt, tz, paused
        case elapsedRawSeconds, elapsedActiveSeconds, description
    }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let running = try c.decode(Bool.self, forKey: .running)
        guard running else { self = .stopped; return }
        self = .running(Running(
            projectId: try c.decode(Int.self, forKey: .projectId),
            startedAt: try c.decode(Int.self, forKey: .startedAt),
            tz: try c.decode(String.self, forKey: .tz),
            paused: try c.decode(Bool.self, forKey: .paused),
            elapsedRawSeconds: try c.decode(Int.self, forKey: .elapsedRawSeconds),
            elapsedActiveSeconds: try c.decode(Int.self, forKey: .elapsedActiveSeconds),
            description: try c.decodeIfPresent(String.self, forKey: .description)
        ))
    }
}

/// Result of stopping a timer: either a written entry, or a discard (too short).
public struct StopOutcome: Codable, Sendable, Equatable {
    public let discarded: Bool
    public let durationSeconds: Int
    public let reason: String?

    public init(discarded: Bool, durationSeconds: Int, reason: String? = nil) {
        self.discarded = discarded
        self.durationSeconds = durationSeconds
        self.reason = reason
    }

    enum CodingKeys: String, CodingKey { case discarded, durationSeconds, reason }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        discarded = try c.decodeIfPresent(Bool.self, forKey: .discarded) ?? false
        durationSeconds = try c.decodeIfPresent(Int.self, forKey: .durationSeconds) ?? 0
        reason = try c.decodeIfPresent(String.self, forKey: .reason)
    }
}
