# Cursor Hiding Fix - Screen Share Stealth Mode

## Overview
This fix adds automatic system cursor hiding when the overlay enters stealth mode (screen sharing). The mouse pointer will no longer be visible on shared screens, providing complete stealth during video calls and meetings.

## Problem Solved
When screen sharing during interviews or meetings, the user's mouse cursor was still visible on the shared screen, revealing that the Nexus Echo overlay was being used as a reference tool.

## Solution Architecture

### Platform Support
- **Windows**: Uses Windows API `ShowCursor()` function
- **macOS**: Uses Objective-C `NSCursor.hide()` and `NSCursor.unhide()` methods
- **Linux**: Placeholder implementation (requires X11/Wayland window manager support - future enhancement)

### How It Works

#### 1. **Automatic Stealth Mode** (`stealth.rs`)
When the overlay enters stealth mode (click-through enabled):
```rust
pub fn apply(window: &WebviewWindow, cfg: &StealthConfig) -> tauri::Result<()> {
    // ... other stealth settings ...
    
    if cfg.click_through {
        hide_cursor();  // Hide cursor for screen sharing
    } else {
        show_cursor();  // Show cursor for normal editing
    }
}
```

#### 2. **Manual Click-Through Toggle** (`commands.rs`)
When user toggles click-through via UI:
```rust
pub fn set_click_through(app: AppHandle, payload: bool, ...) -> CmdResult<()> {
    // ... window settings ...
    
    if payload {
        stealth::hide_cursor();     // Entering stealth
    } else {
        stealth::show_cursor();     // Exiting stealth
    }
}
```

#### 3. **Resize Mode Toggle** (`commands.rs`)
When user presses `Ctrl+Shift+R` to toggle resize mode:
```rust
pub fn toggle_resize_mode_inner(...) -> CmdResult<bool> {
    let interactive = !state.overlay_interactive.fetch_xor(true, Ordering::SeqCst);
    
    if !interactive {
        stealth::hide_cursor();     // Exiting resize → entering stealth
    } else {
        stealth::show_cursor();     // Entering resize → exiting stealth
    }
}
```

#### 4. **Panic Hide/Show** (`stealth.rs`)
When user presses panic hotkey (`Cmd+Shift+\` / `Ctrl+Shift+\`):
```rust
pub fn panic_hide(app: &AppHandle) {
    if visible {
        overlay.hide();
        show_cursor();              // Always show when hiding overlay
    } else {
        overlay.show();
        // Cursor visibility will be set by apply_stealth
    }
}
```

## User Experience

### Behavior Timeline
1. **App starts** → If stealth mode enabled in settings, cursor is hidden
2. **User enters screen share** → Click-through mode activates → Cursor hides automatically
3. **User presses Ctrl+Shift+R** → Resize mode activates → Cursor shows for editing
4. **User presses Ctrl+Shift+R again** → Back to stealth mode → Cursor hides again
5. **User presses Cmd+Shift+\ / Ctrl+Shift+\** → Overlay hides → Cursor always shown
6. **User exits screen share** → Disables click-through → Cursor shows

### Settings Panel
The "Stealth & privacy" panel shows:
- Click-through toggle
- Opacity slider (affects background transparency only)
- Other stealth settings

All cursor management is automatic - no manual cursor control needed!

## Technical Details

### Cursor Hiding References
- **Windows**: [ShowCursor function](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-showcursor)
  - Uses internal counter: `ShowCursor(FALSE)` decrements, `ShowCursor(TRUE)` increments
  - Cursor visible when counter ≥ 0
  
- **macOS**: [NSCursor documentation](https://developer.apple.com/documentation/appkit/nscursor)
  - `NSCursor.hide()` - Hides the cursor until unhide/mouse move
  - `NSCursor.unhide()` - Shows the cursor again

### Integration Points
```
UI (React)
    ↓
bridge.ts (IPC)
    ↓
commands.rs
    ├→ set_click_through()
    ├→ toggle_resize_mode()
    └→ apply_stealth()
         ↓
stealth.rs
    ├→ hide_cursor()  (Windows/macOS implementation)
    └→ show_cursor()  (Windows/macOS implementation)
         ↓
OS APIs
    ├→ Windows: ShowCursor()
    ├→ macOS: NSCursor.hide/unhide()
    └→ Linux: No-op placeholder
```

## Testing Checklist

- [ ] Start app → Verify cursor is hidden if stealth enabled
- [ ] Toggle click-through in settings → Cursor should toggle visibility
- [ ] Enable stealth mode before screen share → Cursor hides
- [ ] Press Ctrl+Shift+R → Cursor shows for resizing
- [ ] Press Ctrl+Shift+R again → Cursor hides
- [ ] Press panic hotkey → Cursor shows when overlay hides
- [ ] Test on Windows and macOS
- [ ] Verify cursor behavior doesn't affect overlay functionality
- [ ] Screen share test → Confirm cursor doesn't appear in recording

## Future Enhancements

1. **Linux Support**: Implement X11/Wayland cursor hiding using appropriate window manager APIs
2. **Custom Cursor**: Option to show a custom invisible/transparent cursor
3. **Cursor Tracking**: Log when cursor is hidden/shown for audit purposes
4. **Advanced Hiding**: Hide cursor only when mouse is over certain UI regions
5. **Cursor Animation**: Smooth fade instead of instant hide/show

## File Changes Summary

| File | Changes |
|------|---------|
| `apps/desktop/src-tauri/src/stealth.rs` | Added `hide_cursor()` and `show_cursor()` functions for Windows, macOS, and Linux |
| `apps/desktop/src-tauri/src/stealth.rs` | Modified `apply()` to call cursor hiding/showing based on `click_through` setting |
| `apps/desktop/src-tauri/src/stealth.rs` | Modified `panic_hide()` to show cursor when overlay is hidden |
| `apps/desktop/src-tauri/src/commands.rs` | Modified `set_click_through()` to toggle cursor visibility |
| `apps/desktop/src-tauri/src/commands.rs` | Modified `toggle_resize_mode_inner()` to toggle cursor visibility |

## No Breaking Changes
- All changes are backward compatible
- Existing settings and configurations work as before
- Only adds new cursor hiding behavior to stealth mode
