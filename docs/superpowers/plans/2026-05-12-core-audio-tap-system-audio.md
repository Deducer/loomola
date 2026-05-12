# Core Audio Tap system audio capture plan

## Implementation

1. Add a `CoreAudioTapCaptureCoordinator` that:
   - creates a private global `CATapDescription`;
   - sets `muteBehavior = .unmuted`;
   - wraps the tap in a private aggregate audio device;
   - reads tap buffers through an `AudioDeviceIOProcID`;
   - writes audio through the existing `AudioAssetWriter`.
2. Add `NSAudioCaptureUsageDescription` to the desktop app plist.
3. Make `SystemAudioCaptureMode.coreAudioTap` the default "System audio" mode.
4. Keep virtual audio device fallback.
5. Keep ScreenCaptureKit hidden behind the existing local override.

## Verification

1. `swift test` for the desktop package.
2. `git diff --check`.
3. Install the local app bundle.
4. Manual test with Spotify/SoundSource and then Zoom:
   - no playback routing change;
   - system volume still works;
   - transcript captures non-mic speech.

