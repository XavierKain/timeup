import Foundation

public enum Format {
    /// `4980 -> "1h23"`, `-4980 -> "-1h23"`. Mirrors the Raycast `fmtH`.
    public static func hours(_ seconds: Int) -> String {
        let s = abs(seconds)
        let h = s / 3600
        let m = (s % 3600) / 60
        let sign = seconds < 0 ? "-" : ""
        return "\(sign)\(h)h\(String(format: "%02d", m))"
    }

    /// Menu-bar title: `"Lumio · 1h23"` while running, `nil` (icon only) when idle.
    public static func menuTitle(clientName: String?, activeSeconds: Int) -> String {
        "\(clientName ?? "Timup") · \(hours(activeSeconds))"
    }
}
