# Riverside Desktop

Unofficial Windows desktop client for:
- `https://river-side.cc` (Discourse)
- `https://bbs.uestc.edu.cn` (Discuz!)

Core design: **chat-first (QQ-like)**, with a built-in “Discover” feed for browsing / replying / posting topics.

## Features

- Chat (public channels + DMs), reply-to-message, @mentions
- Discover: browse by category (with optional sub-category), infinite scrolling list
- Open topics inside the app (reply / like / quick comment)
- Notifications: replies + mentions (supports new/old/mixed view)
- User card / user space inside the app
- Theme presets, window collapse mode, image paste/upload, emoji packs

## Privacy / Security

- The app uses the forum’s official web login in a popup window.
- Passwords are **not** stored by this repo; auth state relies on the site cookies stored by Electron.

## Development

Requirements: Node.js 20+ (recommended), Windows 10/11.

```bash
npm install
npm run dev
```

> PowerShell tip: if `npm` scripts are blocked, use `npm.cmd`.

## Build

```bash
npm run typecheck
npm run build
```

## Package (Windows)

```bash
npm run dist
```

Output: `release/win-unpacked/Riverside.exe`
