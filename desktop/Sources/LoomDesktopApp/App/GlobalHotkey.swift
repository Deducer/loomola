import AppKit
import Carbon.HIToolbox

/// Wrapper around Carbon's `RegisterEventHotKey` — the only public macOS
/// API for true global keyboard shortcuts (always delivered to your app
/// regardless of which app has focus). NSMenuItem `keyEquivalent` only
/// fires when the app is frontmost, which for a status-bar app is rare,
/// so the user hears the system "function not available" beep instead.
///
/// Usage:
///
///     let hotkey = GlobalHotkey(
///         keyCode: UInt32(kVK_ANSI_B),
///         modifiers: UInt32(optionKey | shiftKey),
///         handler: { /* do something */ }
///     )
///
/// One instance per shortcut. Releases the registration on deinit.
/// Not MainActor-isolated so deinit can free the Carbon resources
/// without bouncing through the actor — the handler closure dispatches
/// to the main queue itself before invoking caller code.
final class GlobalHotkey: @unchecked Sendable {
    nonisolated(unsafe) private var hotKeyRef: EventHotKeyRef?
    private let handler: () -> Void
    private let id: UInt32

    /// Per-process singleton dispatch table. Carbon's event handler is a
    /// C callback with a void* userData; we use a UInt32 ID into this
    /// table instead so we can match incoming events to Swift closures
    /// without lifetime gymnastics.
    nonisolated(unsafe) private static var handlers: [UInt32: () -> Void] = [:]
    nonisolated(unsafe) private static var nextID: UInt32 = 1
    nonisolated(unsafe) private static var sharedEventHandler: EventHandlerRef?
    private static let signature: OSType = 0x4C4D4C4F  // 'LMLO'

    init?(keyCode: UInt32, modifiers: UInt32, handler: @escaping () -> Void) {
        self.handler = handler
        self.id = Self.nextID
        Self.nextID += 1
        Self.handlers[id] = handler

        Self.installSharedHandlerIfNeeded()

        var ref: EventHotKeyRef?
        let hotKeyID = EventHotKeyID(signature: Self.signature, id: id)
        let status = RegisterEventHotKey(
            keyCode,
            modifiers,
            hotKeyID,
            GetEventDispatcherTarget(),
            0,
            &ref
        )
        guard status == noErr, let ref else {
            Self.handlers.removeValue(forKey: id)
            print("[hotkey] RegisterEventHotKey failed (status=\(status))")
            return nil
        }
        self.hotKeyRef = ref
    }

    deinit {
        if let hotKeyRef {
            UnregisterEventHotKey(hotKeyRef)
        }
        Self.handlers.removeValue(forKey: id)
    }

    private static func installSharedHandlerIfNeeded() {
        if sharedEventHandler != nil { return }
        var eventType = EventTypeSpec(
            eventClass: OSType(kEventClassKeyboard),
            eventKind: OSType(kEventHotKeyPressed)
        )
        // C function pointer: must not capture context. References to
        // GlobalHotkey.signature / GlobalHotkey.handlers go through the
        // type name so the compiler can form a C function pointer
        // without an environment.
        let status = InstallEventHandler(
            GetEventDispatcherTarget(),
            globalHotkeyCallback,
            1,
            &eventType,
            nil,
            &sharedEventHandler
        )
        if status != noErr {
            print("[hotkey] InstallEventHandler failed (status=\(status))")
        }
    }
}

/// File-scope C-callable function (no captured context). Looks up the
/// closure registered for the incoming hotkey ID and dispatches it on
/// the main queue.
private func globalHotkeyCallback(
    _ handlerCallRef: EventHandlerCallRef?,
    _ eventRef: EventRef?,
    _ userData: UnsafeMutableRawPointer?
) -> OSStatus {
    guard let eventRef else { return OSStatus(eventNotHandledErr) }
    var hotKeyID = EventHotKeyID()
    let extractStatus = GetEventParameter(
        eventRef,
        EventParamName(kEventParamDirectObject),
        EventParamType(typeEventHotKeyID),
        nil,
        MemoryLayout<EventHotKeyID>.size,
        nil,
        &hotKeyID
    )
    guard extractStatus == noErr,
          hotKeyID.signature == GlobalHotkey.signatureForCallback
    else {
        return OSStatus(eventNotHandledErr)
    }
    if let handler = GlobalHotkey.handlersForCallback[hotKeyID.id] {
        DispatchQueue.main.async { handler() }
        return noErr
    }
    return OSStatus(eventNotHandledErr)
}

extension GlobalHotkey {
    /// Public read access for the file-scope C callback. Wraps the
    /// private static state without exposing it to other files.
    nonisolated static var signatureForCallback: OSType { signature }
    nonisolated static var handlersForCallback: [UInt32: () -> Void] {
        handlers
    }
}
