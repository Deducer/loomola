# Core Audio Tap system audio capture

## Problem

Loomola's audio note flow has used ScreenCaptureKit for built-in system audio capture. In real calls this can disturb playback routing: Zoom or music briefly switches, volume jumps, and SoundSource or macOS volume control can stop affecting the audio the user hears. That makes the product feel unsafe during the exact moment it needs to feel invisible.

Mic-only capture is not a product answer because meeting notes need the other speakers too. It is only an emergency fallback.

## Apple API direction

Apple's Core Audio Tap API is the right production path for macOS 14.2+. A `CATapDescription` can create a global tap and set `muteBehavior = .unmuted`. Apple's SDK headers define that behavior as capturing audio while still sending it to normal audio hardware. In plain terms: Loomola records the stream without becoming or changing the user's output device.

This is different from virtual-device routing and from ScreenCaptureKit:

- Core Audio Tap: capture system audio without rerouting playback.
- Virtual device: useful fallback for advanced setups, but requires user routing.
- ScreenCaptureKit audio: keep hidden/experimental for now because it has caused playback changes on Ian's Zoom/SoundSource setup.

## Product behavior

- "System audio" should use Core Audio Tap by default on macOS 14.2+.
- Recording should not change the current output device, meeting playback volume, or SoundSource control.
- If Core Audio Tap fails, the app should fail clearly instead of silently recording only the microphone.
- Virtual audio device remains available as a fallback.
- ScreenCaptureKit remains hidden unless the local override `loomola.allowAppleSystemAudioCapture` is enabled.

## Test conditions

1. Start Spotify or YouTube audio, verify macOS volume and SoundSource can adjust it.
2. Start a Loomola audio note with Mic and System audio enabled.
3. Confirm there is no output-device switch, volume jump, or loss of volume control.
4. Stay silent while a remote voice or spoken media plays, stop the note, generate notes, and confirm the transcript contains the external speech.
5. Repeat on a Zoom call with another speaker.

