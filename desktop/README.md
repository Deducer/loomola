# Loom Desktop

Native macOS companion app scaffold for Loom Clone.

This app is intentionally a thin record-and-upload client. It should not own metadata, comments, AI features, branding, editing, or analytics. Those stay in the existing web app at `https://loom.dissonance.cloud`.

## Architecture

- Swift + SwiftUI for the main app shell.
- AppKit for menu bar behavior and the transparent draggable camera bubble.
- ScreenCaptureKit for screen/window/system-audio capture.
- AVFoundation for camera, mic, and MP4/M4A encoding.
- supabase-swift for user authentication.
- macOS Keychain for saved sessions.
- URLSession for calls to the existing Next.js API and R2 presigned upload URLs.

## Current Status

This directory is a development app, not a finished recorder. It includes:

- `Package.swift` with the initial app target and Supabase dependency.
- `AppDelegate` menu bar stub.
- SwiftUI main window with Supabase email/password sign-in.
- File-backed dev session storage for raw SwiftPM runs, avoiding repeated Keychain prompts from unsigned rebuilds.
- Backend start/abort handshake against the existing `/api/recordings/*` routes.
- Granola `type='audio'` start/abort handshake against the same backend when `ENABLE_GRANOLA=true`.
- Granola manual audio note dev flow: session model, AAC `.m4a` writer, mic capture, system-audio capture, multipart upload, complete, and discard.
- ScreenCaptureKit source listing for displays/windows.
- ScreenCaptureKit first-display MP4 recording path on macOS 15+.
- Upload of that local MP4 as the `composite` track through the existing backend.
- Bubble overlay `NSPanel` with a live camera preview clipped into a circle.
- In-app Chrome native messaging bridge installer for Granola meeting signals from the extension.
- Realtime Obsidian sync trigger, with a 30-second polling backup.
- Capture/composite/upload organization sketches for the remaining work.
- API model types matching the existing `/api/recordings/*` routes.
- Xcode signing/notarization placeholders.

It does **not** yet composite the camera bubble into the exported video, and the Granola manual audio recorder still needs Ian's hardware smoke test on a real signed-in app session. The current Loom desktop recording path is first-display screen + ScreenCaptureKit audio to a local MP4, uploaded as the `composite` track. The next major Loom implementation slice is `AVAssetWriter` compositing for screen + bubble + raw tracks; the next Granola slice is manual verification plus hardening around permissions, retry, and recovery.

The implementation spec lives at:

```text
docs/superpowers/specs/2026-04-27-macos-desktop-app-design.md
```

The build plan lives at:

```text
docs/superpowers/plans/2026-04-27-macos-desktop-app.md
```

## Build and Run for Development

From this directory:

```bash
swift package resolve
swift run LoomDesktop
```

Or use the helper script:

```bash
cp .env.example .env.local
# Fill in LOOM_SUPABASE_URL and LOOM_SUPABASE_ANON_KEY
./scripts/run-dev.sh
```

The helper also falls back to the repo-root `.env.local` Supabase names used by the web app (`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`), so an existing local web-app env file is enough for a development run. API calls default to `https://loom.dissonance.cloud`; set `LOOM_API_BASE_URL=http://localhost:3000` only when you intentionally want the desktop app to talk to a locally running Next.js server.

The runnable dev app can currently test:

- Email/password sign-in to Supabase.
- Saved session restore from the local dev session file.
- `Test Backend`: creates a desktop-shaped `media_objects` upload row, then aborts it.
- `Test Audio Backend`: creates a Granola audio upload row with mic + system-audio tracks, then aborts it.
- `Refresh Sources`: lists displays, windows, cameras, and microphones.
- `Start Recording`: records the first display to a local MP4 on macOS 15+, then `Stop` uploads it through the existing backend as the composite track.
- `Start Audio Note`: records selected mic/system audio to `.m4a`, then `Stop Audio` uploads it through the Granola audio backend.
- `Discard Audio`: stops the active audio note, aborts the backend row, and deletes local temp files.
- Browser meeting detection: after installing the native messaging host, Meet/Teams/Zoom web calls can trigger the same consent-first "Meeting ready" prompt.
- Menu bar `Show Bubble Overlay`: shows a draggable circular camera bubble.

For serious ScreenCaptureKit work, create an Xcode macOS App target from this scaffold so `Info.plist`, entitlements, signing, and privacy prompts behave like a real app bundle.

## Chrome Meeting Bridge

The Chrome extension can detect active Meet/Teams/Zoom web tabs. To let Chrome
deliver those signals to this SwiftPM dev app, load the unpacked extension once,
then click `Install Chrome Bridge` inside the desktop app.

The same installer is still available from the terminal:

```bash
cd /Users/iancross/Development/03Utilities/Loom_Clone
desktop/scripts/install-native-messaging-host.sh
```

The extension has a stable unpacked-extension ID, so the script can register
the host even when Chrome's profile metadata has not been flushed to disk. The
host writes the latest meeting signal to
`~/Library/Application Support/LoomDesktop/chrome-meeting-signal.json`; the
desktop app reads it during the existing 15-second meeting watch.

SwiftPM can build and run the dev app, but a proper `.app` bundle is still needed for the real recorder because macOS privacy prompts, usage strings, entitlements, signing, and notarization all behave more predictably from an app bundle than from a raw command-line executable.

Recommended app settings:

- Product name: `Loom Desktop`
- Bundle identifier: `cloud.dissonance.loom.desktop`
- Minimum macOS: `14.0`
- Team: Ian's Apple Developer team once available
- Hardened Runtime: enabled for distribution
- App Sandbox: disabled for direct distribution unless testing proves it does not interfere with capture

## Required Build Configuration

Development builds need public client configuration only:

```text
LOOM_API_BASE_URL=https://loom.dissonance.cloud
LOOM_SUPABASE_URL=<existing Supabase URL>
LOOM_SUPABASE_ANON_KEY=<existing Supabase anon key>
```

Do not place service-role keys, R2 credentials, Deepgram keys, Anthropic keys, Mailgun keys, or Doppler tokens in the desktop app. The app should authenticate as the user, call the existing backend, and receive short-lived upload URLs.

## Privacy Permissions

The eventual Xcode app target must include usage descriptions for:

- Camera
- Microphone
- Screen Recording / Screen & System Audio Recording

The placeholder `App/Info.plist` contains starter strings. macOS may require the app to be restarted after Screen Recording permission changes.

## Signing and Notarization

Direct DMG distribution requires an Apple Developer Program membership, currently about `$99/year`.

Release path:

1. Archive the app in Xcode.
2. Sign with Developer ID Application.
3. Create a DMG.
4. Sign the DMG.
5. Submit to Apple notarization with `xcrun notarytool`.
6. Staple the notarization ticket with `xcrun stapler`.
7. Host the DMG from `https://loom.dissonance.cloud/desktop/`.

Mac App Store distribution is intentionally out of scope for v1 because review and sandbox restrictions slow down iteration on recorder behavior.

## Auto-updates

Use Sparkle 2 after the signed DMG flow works.

Expected hosting:

```text
https://loom.dissonance.cloud/desktop/appcast.xml
https://loom.dissonance.cloud/desktop/LoomDesktop-<version>.dmg
```

Sparkle keys must be generated and stored outside the repo.

## First Implementation Slice

Start with the backend compatibility tasks in the plan:

1. Add bearer-token auth support for desktop API calls.
2. Let `/api/recordings/start` use `.mp4` / `.m4a` keys when desktop sends MP4/M4A MIME types.
3. Add tests for desktop-shaped start/part-url/complete requests.

Then build the native app in small vertical slices: auth, permissions, capture preview, bubble overlay, local recording, multipart upload, final smoke test.
