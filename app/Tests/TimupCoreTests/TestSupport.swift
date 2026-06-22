import Foundation
@testable import TimupCore

/// Captures outgoing requests and returns canned responses, so `BrainClient`
/// can be exercised without a live brain.
final class MockURLProtocol: URLProtocol {
    struct Stub { let status: Int; let json: String }

    /// Maps "METHOD PATH" (path includes query) -> stub. Set per test.
    static var routes: [String: Stub] = [:]
    /// Records the requests seen, in order, with their decoded body.
    static var recorded: [(method: String, path: String, body: Data?)] = []

    static func reset() {
        routes = [:]
        recorded = []
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func stopLoading() {}

    override func startLoading() {
        let method = request.httpMethod ?? "GET"
        let path = (request.url?.path ?? "") + (request.url?.query.map { "?\($0)" } ?? "")
        MockURLProtocol.recorded.append((method, path, request.bodyData))

        let key = "\(method) \(path)"
        let stub = MockURLProtocol.routes[key] ?? Stub(status: 404, json: #"{"error":{"message":"no route \#(key)"}}"#)
        let response = HTTPURLResponse(
            url: request.url!, statusCode: stub.status,
            httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(stub.json.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
}

extension URLRequest {
    /// URLSession often moves `httpBody` into `httpBodyStream`; read whichever exists.
    var bodyData: Data? {
        if let b = httpBody { return b }
        guard let stream = httpBodyStream else { return nil }
        stream.open()
        defer { stream.close() }
        var data = Data()
        let bufSize = 4096
        var buf = [UInt8](repeating: 0, count: bufSize)
        while stream.hasBytesAvailable {
            let read = stream.read(&buf, maxLength: bufSize)
            if read <= 0 { break }
            data.append(buf, count: read)
        }
        return data
    }
}

func makeTestClient() -> BrainClient {
    let cfg = URLSessionConfiguration.ephemeral
    cfg.protocolClasses = [MockURLProtocol.self]
    let session = URLSession(configuration: cfg)
    let config = BrainConfig(baseURL: URL(string: "http://127.0.0.1:47823")!, token: "test-token")
    return BrainClient(config: config, session: session)
}
