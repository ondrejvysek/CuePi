# Presenter DSK App

Electron prototype for Presenter Out / DSK control.

## What it does

- Keeps Raspberry Pi output controls in the main Output section.
- Detects local computer displays.
- Shows a visual display picker.
- Blue display means the moderator window is on that screen.
- Gray display means an available screen.
- Green display means DSK is currently live on that screen.
- Click a display tile to start or stop the local green DSK output on that display.
- Multiple displays can be live at the same time.
- The DSK window is frameless and pure green.

## Run

```bash
npm install
npm start
```

## Build

```bash
npm run build:win
npm run build:mac
```

For production, build Windows installers on Windows and macOS DMG files on macOS.

## Shortcut

Windows and Linux

```text
Ctrl Shift D
```

macOS

```text
Cmd Shift D
```

The shortcut toggles DSK on the first non-moderator display. If only one display exists, it toggles DSK on the primary display for testing.
