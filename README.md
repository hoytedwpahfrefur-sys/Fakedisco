# Terminal Browser Android App

This project is a simple Android app that combines:

- A terminal-like command panel
- A built-in browser pane (`WebView`)

## What commands are supported?

- `help`
- `clear`
- `ls` (lists files in `assets/www`)
- `cat <file>`
- `run <file>`
- `rum <file>` (alias for `run`)

Example:

```bash
run index.html
```

## How to build APK

1. Open this folder in Android Studio.
2. Let Gradle sync.
3. Build debug APK:
   - **Build > Build Bundle(s) / APK(s) > Build APK(s)**
4. APK will be in:
   - `app/build/outputs/apk/debug/app-debug.apk`

## Add your own HTML files

Put your files in:

- `app/src/main/assets/www/`

Then run in the app terminal:

```bash
run your-file.html
```
