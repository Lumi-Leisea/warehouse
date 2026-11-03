# Warehouse

**Batch Character Export & Import Extension for Lumiverse (Spindle)**

**Warehouse** is a Spindle extension for Lumiverse that lets you batch export any selection of characters in all available single-character export formats (`CHARX`, `PNG`, and `JSON`), package them into a `.zip` archive (with full ZIP64 support), and re-import those `.zip` archives later with folder assignments intact.

---

## Features

### 1. Batch Character Export (`.zip`)
- **All Single-Character Export Formats:**
  - **CHARX (`.charx`)**: Complete Lumiverse character archive containing `card.json`, main & alternate avatars, gallery images, expression sprites & expression groups, landing perspective layers, and `lumiverse_modules.json` (attached World Books in full Lumiverse format, character-bound Regex scripts, alternate fields, and avatar bindings).
  - **PNG Card (`.png`)**: Character avatar PNG with embedded CCSv3 (`ccv3`) base64 metadata and attached World Books.
  - **JSON Card (`.json`)**: Lightweight CCSv3 (`chara_card_v3`) JSON definition with merged `character_book`.
- **Library Filtering & Quick Selection:**
  - LumiTag-style search syntax with prefixes: bare text or `C:` for character name, `T:` for whole-tag match, `F:` for folder (`F:unfiled` for unfiled cards), `A:` for author/creator, spaces for `AND`, commas for `OR`, `-` for negation (`-T:Dark`), and quotes for multi-word values (`F:"My Folder"`). Includes a built-in **Search Syntax Help** reference modal.
  - Filter by **Folder** (`All Folders`, `Unfiled`, or any specific folder) and **Tag**.
  - One-click **Select Shown**, **Select All**, **Invert Shown**, and **Clear**.
- **Folder Structure & Manifest Preservation:**
  - **Subfolder Organization:** Optionally places exported cards into subfolders inside the `.zip` matching their Lumiverse folder (`FolderName/CharacterName.charx`), automatically disambiguating duplicate names (`Name (2).charx`).
  - **Warehouse Manifest (`warehouse-manifest.json`):** Optionally writes a manifest at the root of the `.zip` so re-importing the archive later restores exact folder assignments.
- **High-Performance ZIP / ZIP64 Packaging:**
  - Uses `STORE` (method `0`, no redundant recompression) for already-compressed `.charx` and `.png` files, and `DEFLATE` (method `8`) for `.json` cards.
  - Supports both **Browser Streaming ZIP64** (default, single-pass download) and **Host Disk Staging** (via Spindle's `file-transfers-v1` / `spindle.archives.create` API).

### 2. Batch Character Import (`.zip`)
- **Zero-RAM ZIP / ZIP64 Central Directory Inspection:**
  - Drag and drop (or click to pick) any Warehouse `.zip` archive — or any `.zip` containing `.charx`, `.png`, or `.json` character cards.
  - Reads only the ZIP Central Directory via `File.slice()` so multi-gigabyte archives open immediately without loading the entire `.zip` into memory.
- **Selective Re-Import & Duplicate Handling:**
  - Preview every detected card inside the `.zip` with its format badge, uncompressed size, and folder badge before importing.
  - Select all or cherry-pick specific characters to import.
  - Optional **Skip duplicate characters** toggle.
- **Native Import Pipeline & Folder Restoration:**
  - Extracts selected entries one at a time and streams them into Lumiverse's `/api/v1/characters/import-jobs` pipeline, preserving all CHARX assets, world books, and regex scripts.
  - Automatically restores character folder assignments via `/api/v1/characters/bulk-update` from `warehouse-manifest.json` or the `.zip` subfolder structure.

### 3. UI & Command Palette Shortcuts
- **Sidebar Drawer Tab:** Opens from the **Warehouse** tab in the Lumiverse drawer.
- **Command Palette (`Ctrl+K` / `Cmd+K`):**
  - `Warehouse: Batch Export Characters`
  - `Warehouse: Batch Import Character Archive`

---

## Installation

### Install via Git URL in Lumiverse
1. Open Lumiverse **Settings -> Extensions (Spindle)**.
2. Install from Git URL:
   ```text
   https://github.com/Lumi-Leisea/warehouse
   ```
3. Grant the `characters` permission when prompted.

### Local Development / Building from Source
Prebuilt bundles (`dist/backend.js` and `dist/frontend.js`) are included in the repository. To rebuild after editing `src/`:

```bash
bun install
bun run build
```

