import XCTest
@testable import TimupCore

final class FormatTests: XCTestCase {
    func testHours() {
        XCTAssertEqual(Format.hours(0), "0h00")
        XCTAssertEqual(Format.hours(59), "0h00")
        XCTAssertEqual(Format.hours(60), "0h01")
        XCTAssertEqual(Format.hours(3600), "1h00")
        XCTAssertEqual(Format.hours(4980), "1h23")
        XCTAssertEqual(Format.hours(7325), "2h02")
        XCTAssertEqual(Format.hours(-4980), "-1h23")
    }

    func testMenuTitle() {
        XCTAssertEqual(Format.menuTitle(clientName: "Lumio", activeSeconds: 4980), "Lumio · 1h23")
        XCTAssertEqual(Format.menuTitle(clientName: nil, activeSeconds: 0), "Timup · 0h00")
    }
}
