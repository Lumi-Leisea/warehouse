import type {
  SpindleAPI,
  SpindleArchiveEntry,
  SpindleCommandContextDTO,
  SpindleCommandDTO,
} from 'lumiverse-spindle-types';
import {
  DEFAULT_PREFERENCES,
  type BackendToFrontendMessage,
  type CharacterExportFormat,
  type FrontendToBackendMessage,
  type WarehousePreferences,
} from './types';

declare const spindle: SpindleAPI;

const PREFERENCES_KEY = 'preferences.json';
const MAX_CHUNK_BYTES = 512 * 1024; // 512 KiB per chunk (under 1 MiB limit)

function isValidFormat(value: unknown): value is CharacterExportFormat {
  return value === 'json' || value === 'png' || value === 'charx';
}

function sanitizePreferences(
  raw: Partial<WarehousePreferences> | null | undefined,
  fallback: WarehousePreferences = DEFAULT_PREFERENCES
): WarehousePreferences {
  if (!raw || typeof raw !== 'object') {
    return { ...fallback };
  }
  return {
    exportFormat: isValidFormat(raw.exportFormat) ? raw.exportFormat : fallback.exportFormat,
    organizeByFolder:
      typeof raw.organizeByFolder === 'boolean' ? raw.organizeByFolder : fallback.organizeByFolder,
    includeManifest:
      typeof raw.includeManifest === 'boolean' ? raw.includeManifest : fallback.includeManifest,
    packagingMode:
      raw.packagingMode === 'host' || raw.packagingMode === 'browser'
        ? raw.packagingMode
        : fallback.packagingMode,
    concurrency:
      typeof raw.concurrency === 'number' && raw.concurrency >= 1 && raw.concurrency <= 8
        ? Math.floor(raw.concurrency)
        : fallback.concurrency,
    skipDuplicates:
      typeof raw.skipDuplicates === 'boolean' ? raw.skipDuplicates : fallback.skipDuplicates,
    restoreFolders:
      typeof raw.restoreFolders === 'boolean' ? raw.restoreFolders : fallback.restoreFolders,
    defaultSurface:
      raw.defaultSurface === 'modal' || raw.defaultSurface === 'drawer'
        ? raw.defaultSurface
        : fallback.defaultSurface,
  };
}

function sendToSession(
  message: BackendToFrontendMessage,
  userId?: string,
  frontendSessionId?: string
): void {
  if (!userId) return;
  spindle.sendToFrontend(
    message,
    userId,
    frontendSessionId ? { frontendSessionId } : undefined
  );
}

async function writeTextAsStagedFile(
  fileName: string,
  content: string,
  mimeType: string,
  userId?: string
): Promise<string> {
  const bytes = new TextEncoder().encode(content);
  const handle = await spindle.files.create({
    fileName,
    mimeType,
    size: bytes.byteLength,
    userId,
  });

  try {
    for (let offset = 0; offset < bytes.byteLength; offset += MAX_CHUNK_BYTES) {
      const slice = bytes.subarray(offset, Math.min(offset + MAX_CHUNK_BYTES, bytes.byteLength));
      await spindle.files.writeChunk(handle.fileId, offset, slice, userId);
    }
    await spindle.files.finish(handle.fileId, userId);
    return handle.fileId;
  } catch (err) {
    try {
      await spindle.files.delete(handle.fileId, userId);
    } catch {
      // Ignore cleanup errors
    }
    throw err;
  }
}

// Register Command Palette shortcuts for quick access
const WAREHOUSE_COMMANDS: SpindleCommandDTO[] = [
  {
    id: 'open-export-modal',
    label: 'Warehouse: Batch Export Characters (Modal)',
    description: 'Open Warehouse in a large modal to batch export characters into a ZIP archive (JSON, PNG, or CHARX)',
    keywords: ['warehouse', 'batch', 'export', 'modal', 'zip', 'charx', 'png', 'json', 'characters', 'backup'],
    scope: 'global',
  },
  {
    id: 'open-import-modal',
    label: 'Warehouse: Batch Import Character Archive (Modal)',
    description: 'Open Warehouse in a large modal to import characters from a Warehouse or character ZIP bundle',
    keywords: ['warehouse', 'batch', 'import', 'modal', 'zip', 'charx', 'png', 'json', 'characters', 'restore'],
    scope: 'global',
  },
  {
    id: 'open-export',
    label: 'Warehouse: Open Batch Export in Sidebar',
    description: 'Open the Warehouse sidebar drawer tab in Batch Export mode',
    keywords: ['warehouse', 'batch', 'export', 'sidebar', 'drawer', 'zip', 'charx', 'png', 'json', 'characters'],
    scope: 'global',
  },
  {
    id: 'open-import',
    label: 'Warehouse: Open Batch Import in Sidebar',
    description: 'Open the Warehouse sidebar drawer tab in Batch Import mode',
    keywords: ['warehouse', 'batch', 'import', 'sidebar', 'drawer', 'zip', 'charx', 'png', 'json', 'characters'],
    scope: 'global',
  },
];

spindle.commands.register(WAREHOUSE_COMMANDS);

spindle.commands.onInvoked(
  (
    commandId: string,
    _context: SpindleCommandContextDTO,
    origin?: { userId: string; frontendSessionId?: string }
  ) => {
    if (commandId === 'open-export-modal') {
      sendToSession(
        { type: 'open_tab', mode: 'export', surface: 'modal' },
        origin?.userId,
        origin?.frontendSessionId
      );
    } else if (commandId === 'open-import-modal') {
      sendToSession(
        { type: 'open_tab', mode: 'import', surface: 'modal' },
        origin?.userId,
        origin?.frontendSessionId
      );
    } else if (commandId === 'open-export') {
      sendToSession(
        { type: 'open_tab', mode: 'export', surface: 'drawer' },
        origin?.userId,
        origin?.frontendSessionId
      );
    } else if (commandId === 'open-import') {
      sendToSession(
        { type: 'open_tab', mode: 'import', surface: 'drawer' },
        origin?.userId,
        origin?.frontendSessionId
      );
    }
  }
);

spindle.onFrontendMessage(async (rawData: unknown, userId: string, frontendSessionId?: string) => {
  if (!rawData || typeof rawData !== 'object') return;
  const msg = rawData as FrontendToBackendMessage;

  switch (msg.type) {
    case 'load_preferences': {
      try {
        const stored = await spindle.userStorage.getJson<Partial<WarehousePreferences>>(
          PREFERENCES_KEY,
          {
            fallback: DEFAULT_PREFERENCES,
            userId,
          }
        );
        const preferences = sanitizePreferences(stored, DEFAULT_PREFERENCES);
        sendToSession({ type: 'preferences_loaded', preferences }, userId, frontendSessionId);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        spindle.log.warn(`Failed to load Warehouse preferences, using defaults: ${errMsg}`);
        sendToSession(
          { type: 'preferences_loaded', preferences: { ...DEFAULT_PREFERENCES } },
          userId,
          frontendSessionId
        );
      }
      break;
    }

    case 'save_preferences': {
      try {
        const existing = await spindle.userStorage.getJson<Partial<WarehousePreferences>>(
          PREFERENCES_KEY,
          {
            fallback: DEFAULT_PREFERENCES,
            userId,
          }
        );
        const current = sanitizePreferences(existing, DEFAULT_PREFERENCES);
        const merged = sanitizePreferences(
          { ...current, ...(msg.preferences || {}) },
          current
        );
        await spindle.userStorage.setJson(PREFERENCES_KEY, merged, {
          indent: 2,
          userId,
        });
        sendToSession({ type: 'preferences_loaded', preferences: merged }, userId, frontendSessionId);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        spindle.log.warn(`Failed to save Warehouse preferences: ${errMsg}`);
      }
      break;
    }

    case 'assemble_archive': {
      const { jobId, fileName, entries, manifestJson } = msg;
      let manifestFileId: string | null = null;

      try {
        const archiveEntries: SpindleArchiveEntry[] = [];

        if (manifestJson && typeof manifestJson === 'string') {
          manifestFileId = await writeTextAsStagedFile(
            'warehouse-manifest.json',
            manifestJson,
            'application/json',
            userId
          );
          archiveEntries.push({
            name: 'warehouse-manifest.json',
            source: { fileId: manifestFileId },
            store: false,
          });
        }

        for (const item of entries || []) {
          archiveEntries.push({
            name: item.name,
            source: { uploadId: item.uploadId },
            store: Boolean(item.store),
          });
        }

        const archive = await spindle.archives.create(archiveEntries, {
          userId,
          fileName: fileName || 'warehouse-characters.zip',
        });

        sendToSession(
          {
            type: 'archive_ready',
            jobId,
            fileId: archive.fileId,
            fileName: archive.fileName,
            size: archive.size,
          },
          userId,
          frontendSessionId
        );
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        spindle.log.error(`Host-staged ZIP assembly failed: ${errorMessage}`);
        sendToSession(
          {
            type: 'archive_error',
            jobId,
            error: errorMessage,
          },
          userId,
          frontendSessionId
        );
      } finally {
        if (manifestFileId) {
          try {
            await spindle.files.delete(manifestFileId, userId);
          } catch {
            // Ignore cleanup errors
          }
        }
        for (const item of entries || []) {
          try {
            await spindle.uploads.delete(item.uploadId, userId);
          } catch {
            // Ignore cleanup errors
          }
        }
      }
      break;
    }

    case 'cleanup_uploads': {
      for (const uploadId of msg.uploadIds || []) {
        try {
          await spindle.uploads.delete(uploadId, userId);
        } catch {
          // Ignore cleanup errors
        }
      }
      break;
    }

    case 'cleanup_archive': {
      if (msg.fileId) {
        try {
          await spindle.files.delete(msg.fileId, userId);
        } catch {
          // Ignore cleanup errors
        }
      }
      break;
    }

    case 'notify': {
      const text = typeof msg.message === 'string' ? msg.message.trim() : '';
      if (!text) break;
      const variant = msg.variant || 'info';
      if (variant === 'success') spindle.toast.success(text, { title: 'Warehouse', userId });
      else if (variant === 'warning') spindle.toast.warning(text, { title: 'Warehouse', userId });
      else if (variant === 'error') spindle.toast.error(text, { title: 'Warehouse', userId });
      else spindle.toast.info(text, { title: 'Warehouse', userId });
      break;
    }
  }
});

spindle.log.info('Warehouse backend initialized.');
export {};
