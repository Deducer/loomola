# Loomola Desktop

Native macOS companion app for Loomola.

This app is the capture surface for native screen recordings and Granola-style
audio meeting notes. The web app still owns the broader library, metadata,
comments, AI features, branding, editing, analytics, and share pages.

## Architecture

- Swift + SwiftUI for the main app shell.
- AppKit for menu bar behavior, toolbar/window integration, and floating overlays.
- ScreenCaptureKit for screen/window/system-audio capture.
- AVFoundation for camera, mic, and MP4/M4A encoding.
- supabase-swift for user authentication.
- File-backed Supabase session storage by default at
  `~/Library/Application Support/LoomDesktop/auth-session.json` with `0600`
  permissions. Keychain remains an opt-in backend.
- URLSession for calls to the existing Next.js API and R2 presigned upload URLs.

## Current Status

The local app is production-grade for Ian's single-user workflow. It includes:

- SwiftUI sign-in, session restore, unified title bar, settings, account menu,
  recent recordings/notes, and diagnostics.
- Native video recording with ScreenCaptureKit + camera + mic, encoded through a
  composite recorder and uploaded through the same backend as browser recordings.
- Native audio note recording with mic/system audio, live note workspace,
  markdown editor, attachments, pause/resume, live transcription, upload, and
  manual AI note generation.
- Floating recording status overlays, draggable camera bubble, global hotkeys,
  permission preflight, and source pickers.
- Multipart upload, orphaned-recording recovery, brownout detection, and retry
  UI for failed audio uploads.
- In-app Chrome native messaging bridge installer for Meet/Teams/Zoom web
  meeting detection.
- Realtime Obsidian sync trigger with a polling backup.
- Local installer and local DMG builder.

The implementation spec lives at:

```text
docs/superpowers/specs/2026-04-27-macos-desktop-app-design.md
```

The build plan lives at:

```text
docs/superpowers/plans/2026-04-27-macos-desktop-app.md
```

## Install Locally Like a Mac App

For your own Mac, use the local installer:

```bash
cd desktop
./scripts/install-local-app.sh
```

That script builds a release app bundle, signs it (see below), copies it to
`/Applications/Loomola.app`, removes any local quarantine flag, and launches it.
An app bundle is the normal `.app` folder macOS treats as an application.

### One-time signing identity (avoids the TCC password storm)

By default the installer creates a self-signed code-signing identity called
`Loomola Local Signing` in your login keychain on first run, then signs every
subsequent build with it. Without that, every rebuild gets a fresh ad-hoc code
signature, which macOS TCC treats as a brand-new app — meaning it forgets your
Camera / Microphone / Screen Recording / Accessibility grants and prompts for
your password 4–5 times per launch.

The setup is automatic, but you can also run it standalone:

```bash
./scripts/setup-signing-identity.sh
```

Idempotent: re-running is safe, it'll detect the existing identity and exit.
The first time codesign uses the identity, macOS may ask for your login
password — click *Always Allow* and you'll never see it again.

If the identity is missing for any reason (different machine, deleted
keychain, etc.), the build script falls back to ad-hoc signing and prints a
warning. TCC permissions will reset on every build until you run the setup
again.

The installed app does not read terminal-only environment variables. During the
build, the installer reads public client config from `desktop/.env.local` or the
repo-root `.env.local`, then bundles it into
`Contents/Resources/DesktopConfig.plist`. These values are the Supabase URL,
Supabase anon key, and API base URL. They are public client settings, not
service-role secrets. The installed app defaults to `https://loom.dissonance.cloud`
for API calls. For your own Loomola, set `LOOM_API_BASE_URL` or
`LOOM_DESKTOP_API_BASE_URL` before installing:

```text
LOOM_API_BASE_URL=https://your-domain.com
LOOM_SUPABASE_URL=https://your-project.supabase.co
LOOM_SUPABASE_ANON_KEY=your-anon-key
```

Use `LOOM_API_BASE_URL=http://localhost:3000` only when your local Next.js
server is running and you intentionally want the desktop app to upload to it.

To make a local drag-to-Applications disk image:

```bash
cd desktop
./scripts/package-local-dmg.sh
```

The DMG is written to `output/desktop/`. DMG means "disk image," the standard
Mac installer window where you drag the app into Applications.

This is still a local build. A public downloadable DMG needs an Apple Developer
ID certificate and notarization; notarization is Apple's automated malware check
that lets other Macs open the app without scary warnings.

## Build and Run for Development

From this directory:

```bash
swift package resolve
swift run LoomDesktop
```

That direct `swift run` path is useful for quick compile checks, but the
recommended development path is the helper script:

```bash
cp .env.example .env.local
# Fill in LOOM_SUPABASE_URL and LOOM_SUPABASE_ANON_KEY
./scripts/run-dev.sh
```

The helper builds `desktop/.build/LoomDesktop.app`, copies the SwiftPM binaries
into that app bundle, includes `App/Info.plist`, bundles the Chrome bridge
resources, ad-hoc signs it with `App/LoomDesktop.entitlements`, and launches the
bundled executable with your environment variables intact. That gives macOS a
stable bundle identifier and privacy usage strings during development, while
still letting Doppler/env config flow into the process.

The helper also falls back to the repo-root `.env.local` Supabase names used by the web app (`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`), so an existing local web-app env file is enough for a development run. API calls default to `https://loom.dissonance.cloud`; set `LOOM_API_BASE_URL=http://localhost:3000` only when you intentionally want the desktop app to talk to a locally running Next.js server.

The runnable dev app can currently test:

- Email/password sign-in to Supabase.
- Saved session restore from the current-user auth file.
- `Test video backend`: creates a desktop-shaped `media_objects` upload row, then aborts it.
- `Test audio backend`: creates a Granola audio upload row with mic + system-audio tracks, then aborts it.
- `Refresh Sources`: lists displays, windows, cameras, and microphones.
- `Start Recording`: records native video, then `Stop` uploads it through the existing backend as the composite track.
- `Start audio note`: records selected mic/system audio to `.m4a`, streams live transcription, then `Stop` uploads it through the Granola audio backend.
- `Discard recording`: stops the active audio note, aborts the backend row, and deletes local temp files.
- `Generate notes`: manually spends AI credits after the user has finished writing/editing manual notes.
- Browser meeting detection: after installing the native messaging host, Meet/Teams/Zoom web calls can trigger the same consent-first "Meeting ready" prompt.
- Menu bar `Show Bubble Overlay`: shows a draggable circular camera bubble.

For serious ScreenCaptureKit work, prefer `./scripts/run-dev.sh` over `swift run`
so `Info.plist`, entitlements, signing, and privacy prompts behave more like a
real app bundle. A proper Xcode archive is still needed for distribution.

### Saved desktop auth

The default desktop session store is a current-user-only file at
`~/Library/Application Support/LoomDesktop/auth-session.json`, written with
`0600` permissions. It stores Supabase access and refresh tokens so local
reinstalls do not trigger repeated macOS Keychain prompts. If the access token
expires, the app and desktop smoke harness refresh it with the saved refresh
token. If the refresh token is missing or revoked, sign in once from the app.

The legacy Keychain backend still exists as an opt-in path, but the file store
is the normal local-development answer. Do not commit this auth file.

### Desktop smoke

From the repo root:

```bash
npm run desktop-smoke
```

The read-only smoke verifies the installed `/Applications/Loomola.app` build
stamp, launches the app, finds a real onscreen recorder window via
CoreGraphics, refreshes saved desktop auth if needed, checks production API
responses are JSON rather than login HTML, and verifies the known long
documentary note still has its manual title and normalized generated notes.

To also verify the desktop Bearer-token title update path, run:

```bash
npm run desktop-smoke:write
```

Write mode sends a `PATCH` with the same title already on the fixture note. It
should not change visible content, but it does touch that row's `updated_at`.

## Chrome Meeting Bridge

The Chrome extension can detect active Meet/Teams/Zoom web tabs. To let Chrome
deliver those signals to this SwiftPM dev app, load the unpacked extension once,
then click `Install Chrome Bridge` inside the desktop app.

The same installer is still available from the terminal:

```bash
cd /path/to/loomola
desktop/scripts/install-native-messaging-host.sh
```

The extension has a stable unpacked-extension ID, so the script can register
the host even when Chrome's profile metadata has not been flushed to disk. The
host writes the latest meeting signal to
`~/Library/Application Support/LoomDesktop/chrome-meeting-signal.json`; the
desktop app reads it during the existing 15-second meeting watch.

`./scripts/run-dev.sh` creates an ad-hoc signed `.app` bundle for development.
That is not a distributable build, but it is much closer to the real recorder
shape than a raw command-line executable.

Recommended app settings:

- Product name: `Loomola`
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

## Signed Release DMG (GitHub Actions)

The `Desktop Release` workflow (`.github/workflows/desktop-release.yml`) runs on
`v*` tags and produces a signed, notarized, stapled DMG attached to the GitHub
Release. Until the signing secrets are configured, the workflow degrades to a
clearly-named `Loomola-<version>-unsigned.zip` — still usable (right-click →
Open to bypass Gatekeeper), just not Gatekeeper-green without the extra step.

**Honest constraint:** the published DMG bakes the Supabase URL, anon key, and
API base URL from this repo's Actions variables (i.e., it talks to
`loom.dissonance.cloud`). The desktop app has no in-app server picker — it reads
`Contents/Resources/DesktopConfig.plist`, which is written at build time by
`build-dev-app.sh`. Self-hosters have two options:

- **Build from source** with your own `.env.local` (the existing
  `./scripts/install-local-app.sh` path above).
- **Fork the repo**, set the three repo variables (see below), and run the
  Desktop Release workflow to mint a DMG for your own instance.

Mac App Store distribution is intentionally out of scope for v1 because review
and sandbox restrictions slow down iteration on recorder behavior.

### One-time release credentials (repo admin)

Requires an Apple Developer Program membership (~$99/yr).

1. **Developer ID Application certificate.** Xcode → Settings → Accounts →
   (your team) → Manage Certificates… → "+" → Developer ID Application.
   Then in Keychain Access → login → My Certificates, right-click
   "Developer ID Application: \<name\> (\<TEAMID\>)" → Export… → `developer-id.p12`
   with a strong export password.

2. **App Store Connect API key** (preferred over Apple-ID/app-specific
   password for notarytool). appstoreconnect.apple.com → Users and Access →
   Integrations → App Store Connect API → Team Keys → Generate API Key,
   role **Developer**. Note the Key ID and Issuer ID; download
   `AuthKey_<KEYID>.p8` (downloadable exactly once).

3. **Set the secrets and variables:**

   ```bash
   base64 -i developer-id.p12 | gh secret set MACOS_CERT_P12_BASE64 -R Deducer/loomola
   gh secret set MACOS_CERT_PASSWORD -R Deducer/loomola        # the p12 export password
   gh secret set KEYCHAIN_PASSWORD -R Deducer/loomola --body "$(openssl rand -hex 24)"
   gh secret set NOTARY_KEY_ID -R Deducer/loomola              # e.g. ABC123DEF4
   gh secret set NOTARY_ISSUER_ID -R Deducer/loomola           # UUID from the Integrations page
   base64 -i AuthKey_<KEYID>.p8 | gh secret set NOTARY_KEY_BASE64 -R Deducer/loomola

   gh variable set LOOM_API_BASE_URL -R Deducer/loomola --body "https://loom.dissonance.cloud"
   gh variable set LOOM_SUPABASE_URL -R Deducer/loomola --body "https://<project>.supabase.co"
   gh variable set LOOM_SUPABASE_ANON_KEY -R Deducer/loomola --body "<anon key>"
   ```

   Then delete the local `developer-id.p12` and `AuthKey_*.p8` copies.

Until these secrets exist, tag builds still succeed and attach
`Loomola-<version>-unsigned.zip` to the release.

**Dry-run validation (no secrets needed):** Actions → Desktop Release →
Run workflow (dry_run: true) — expected: green build on the runner, an uploaded
`Loomola-0.0.0-dev.N-unsigned.zip` artifact, no GitHub Release created.

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
