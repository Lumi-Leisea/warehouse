# Changelog

All notable changes to the **Warehouse** extension for Lumiverse will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-11-02

### Added
- **Batch Character Export (`.zip`)**:
  - Support for all single-character export formats in Lumiverse:
    - **CHARX (`.charx`)**: Full character package including `card.json`, main & alternate avatars, gallery images, expression sprites & groups, landing perspective layers, and `lumiverse_modules.json` (World Books, character-bound Regex scripts, alternate fields, and avatar bindings).
    - **PNG Card (`.png`)**: Character avatar PNG with embedded base64 CCSv3 (`ccv3`) metadata and attached World Books.
    - **JSON Card (`.json`)**: CCSv3 (`chara_card_v3`) JSON card with merged `character_book`.
  - Live WebSocket progress listener (`CHARACTER_EXPORT_PROGRESS`) for real-time asset packaging feedback during CHARX exports.
  - Character library browser with live search (by name, creator, folder, or tag), Folder filter, Tag filter, and quick selection controls (`Select Shown`, `Select All`, `Invert Shown`, `Clear`).
  - Automatic subfolder organization inside the `.zip` archive (`FolderName/CharacterName.ext`) with filename collision disambiguation.
  - Optional `warehouse-manifest.json` bundle metadata for preserving exact folder assignments and export metadata on re-import.
  - Dual ZIP64 packaging modes:
    - **Browser Streaming ZIP64** (`BrowserZipBuilder`): Zero-concatenation `Blob` assembly using `STORE` (method `0`) for `.charx`/`.png` and `DEFLATE` (method `8`) for `.json`.
    - **Host Disk Staging**: Server-side staging and streaming ZIP64 creation via Spindle's `file-transfers-v1` capability (`ctx.uploads.uploadFile` + `spindle.archives.create`).
- **Batch Character Import (`.zip`)**:
  - Random-access ZIP / ZIP64 Central Directory reader (`inspectZipArchive`) that inspects `.zip` archives via `File.slice()` without loading the entire archive into RAM.
  - Interactive archive preview showing detected `.charx`, `.png`, and `.json` character cards, file sizes, format badges, and folder badges.
  - Streaming extraction (`extractZipEntryAsFile`) directly into Lumiverse's native bulk import job pipeline (`/api/v1/characters/import-jobs`) with live progress polling and cancellation support.
  - Automatic restoration of character folder assignments via `/api/v1/characters/bulk-update` using `warehouse-manifest.json` or ZIP subfolder paths.
- **UI & Command Palette Integration**:
  - Registered the **Warehouse** Drawer Tab (`ctx.ui.registerDrawerTab`).
  - Registered Command Palette commands (`Ctrl+K` / `Cmd+K`):
    - `Warehouse: Batch Export Characters`
    - `Warehouse: Batch Import Character Archive`
  - Persistent per-user preferences via `spindle.userStorage`.

