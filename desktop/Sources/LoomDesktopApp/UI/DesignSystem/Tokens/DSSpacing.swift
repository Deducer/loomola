import CoreGraphics

/// 4pt-based spacing rhythm. Granola is on 4pt; we follow them so cards
/// breathe at the smaller window sizes our desktop app uses.
enum DSSpacing {
    static let xs: CGFloat = 4
    static let sm: CGFloat = 8
    static let md: CGFloat = 12
    static let lg: CGFloat = 16
    static let xl: CGFloat = 24
    static let xxl: CGFloat = 32
    static let xxxl: CGFloat = 48
}
