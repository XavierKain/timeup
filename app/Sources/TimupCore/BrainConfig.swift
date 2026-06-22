import Foundation

/// Locates the brain and its auth token the same way the rest of Timup does:
/// `<dataDir>/config.json`, where dataDir defaults to
/// `~/Library/Application Support/Timup` (overridable via `TIMUP_DATA_DIR`).
public struct BrainConfig: Sendable, Equatable {
    public let baseURL: URL
    public let token: String

    public init(baseURL: URL, token: String) {
        self.baseURL = baseURL
        self.token = token
    }

    public enum ConfigError: Error, CustomStringConvertible {
        case missingFile(String)
        case unreadable(String)
        case missingToken

        public var description: String {
            switch self {
            case .missingFile(let p): return "config.json introuvable : \(p)"
            case .unreadable(let p): return "config.json illisible : \(p)"
            case .missingToken: return "config.json sans token"
            }
        }
    }

    public static func defaultDataDir(env: [String: String] = ProcessInfo.processInfo.environment,
                                      home: URL = FileManager.default.homeDirectoryForCurrentUser) -> URL {
        if let dir = env["TIMUP_DATA_DIR"], !dir.isEmpty {
            return URL(fileURLWithPath: dir, isDirectory: true)
        }
        return home
            .appendingPathComponent("Library", isDirectory: true)
            .appendingPathComponent("Application Support", isDirectory: true)
            .appendingPathComponent("Timup", isDirectory: true)
    }

    /// Load from `<dataDir>/config.json`. Port resolution order:
    /// `TIMUP_PORT` env → `config.json` `port` → 47823.
    public static func load(env: [String: String] = ProcessInfo.processInfo.environment,
                            home: URL = FileManager.default.homeDirectoryForCurrentUser) throws -> BrainConfig {
        let dir = defaultDataDir(env: env, home: home)
        let file = dir.appendingPathComponent("config.json")
        guard FileManager.default.fileExists(atPath: file.path) else {
            throw ConfigError.missingFile(file.path)
        }
        guard let data = try? Data(contentsOf: file),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw ConfigError.unreadable(file.path)
        }
        guard let token = json["token"] as? String, !token.isEmpty else {
            throw ConfigError.missingToken
        }
        let port = resolvePort(env: env, json: json)
        guard let url = URL(string: "http://127.0.0.1:\(port)") else {
            throw ConfigError.unreadable(file.path)
        }
        return BrainConfig(baseURL: url, token: token)
    }

    static func resolvePort(env: [String: String], json: [String: Any]) -> Int {
        if let raw = env["TIMUP_PORT"], let p = Int(raw) { return p }
        if let p = json["port"] as? Int { return p }
        if let s = json["port"] as? String, let p = Int(s) { return p }
        return 47823
    }
}
