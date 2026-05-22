# Changelog

Loomola uses date-based release notes while the product is still moving quickly.
Each entry calls out user-visible changes first, then reliability or developer
notes when they matter.

## 2026-05-21

### Added

- Loomola recording share links now include Slack/Discord-friendly Open Graph and Twitter card metadata with per-recording title, summary, and thumbnail.
- Added a stable public thumbnail route for link unfurls. Public, ready recordings serve the generated video thumbnail; locked, missing, not-ready, or thumbnail-less links show a generic Loomola image instead.

### Notes

- Slack and Discord cache previews by exact URL. Add a query string when retesting a link that was pasted before this release.

## 2026-05-13

### Added

- Real-time Deepgram transcription for desktop audio notes, with the transcript ready when recording stops.
- Manual `Generate notes` / `Regenerate notes` flow for audio notes so AI credits are spent only when the user asks.
- Granola-style live transcript drawer in the desktop note workspace, including copy, collapse, search affordance, speaker-side layout, word count, and transcript-updated note regeneration state.
- Desktop note workspace polish: top chrome alignment, refined transcript cards, cleaner typography, fixed ellipsis hover/click target, wider generated-note editor, and smoother recording controls.
- Changelog for product-style release tracking.

### Changed

- The desktop app now syncs server-backed preferences on sign-in, not only when Settings is opened.
- Settings now only exposes controls that are currently wired to behavior. Deferred transcript-retention, product-update, calendar connector, desktop-only connector, and team-settings placeholders are hidden for now.
- Share-page mobile player overlay now centers the large play button over the visible video area without changing desktop behavior.
- The local desktop installer ignores local Codex settings when deciding whether the installed app build should be stamped as dirty.

### Fixed

- Video recording stop now auto-hides the floating camera bubble.
- Quitting during a recording now offers a clear discard-and-quit path.
- Live transcription startup now uses server-minted Deepgram live tokens and handles refreshed credentials cleanly.
