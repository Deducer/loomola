import CoreGraphics

/// Corner radius tokens. Cards use `lg`. Buttons use `md` (regular)
/// or `pill` (CTA).
enum DSRadius {
    static let sm: CGFloat = 6
    static let md: CGFloat = 10
    static let lg: CGFloat = 14
    static let xl: CGFloat = 20
    /// Effectively unbounded — use on pill buttons to get fully rounded ends.
    static let pill: CGFloat = 9999
}
