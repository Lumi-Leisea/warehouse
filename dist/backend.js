// @bun
// Lumi/Extensions/warehouse/src/types.ts
var DEFAULT_PREFERENCES = {
  exportFormat: "charx",
  organizeByFolder: true,
  includeManifest: true,
  packagingMode: "browser",
  concurrency: 3,
  skipDuplicates: false,
  restoreFolders: true
};

// Lumi/Extensions/warehouse/src/backend.ts
var PREFERENCES_KEY = "preferences.json";
var MAX_CHUNK_BYTES = 512 * 1024;
function isValidFormat(value) {
  return value === "json" || value === "png" || value === "charx";
}
function sanitizePreferences(raw, fallback = DEFAULT_PREFERENCES) {
  if (!raw || typeof raw !== "object") {
    return { ...fallback };
  }
  return {
    exportFormat: isValidFormat(raw.exportFormat) ? raw.exportFormat : fallback.exportFormat,
    organizeByFolder: typeof raw.organizeByFolder === "boolean" ? raw.organizeByFolder : fallback.organizeByFolder,
    includeManifest: typeof raw.includeManifest === "boolean" ? raw.includeManifest : fallback.includeManifest,
    packagingMode: raw.packagingMode === "host" || raw.packagingMode === "browser" ? raw.packagingMode : fallback.packagingMode,
    concurrency: typeof raw.concurrency === "number" && raw.concurrency >= 1 && raw.concurrency <= 8 ? Math.floor(raw.concurrency) : fallback.concurrency,
    skipDuplicates: typeof raw.skipDuplicates === "boolean" ? raw.skipDuplicates : fallback.skipDuplicates,
    restoreFolders: typeof raw.restoreFolders === "boolean" ? raw.restoreFolders : fallback.restoreFolders
  };
}
function sendToSession(message, userId, frontendSessionId) {
  if (!userId)
    return;
  spindle.sendToFrontend(message, userId, frontendSessionId ? { frontendSessionId } : undefined);
}
async function writeTextAsStagedFile(fileName, content, mimeType, userId) {
  const bytes = new TextEncoder().encode(content);
  const handle = await spindle.files.create({
    fileName,
    mimeType,
    expectedSize: bytes.byteLength,
    userId
  });
  try {
    for (let offset = 0;offset < bytes.byteLength; offset += MAX_CHUNK_BYTES) {
      const slice = bytes.subarray(offset, Math.min(offset + MAX_CHUNK_BYTES, bytes.byteLength));
      await spindle.files.writeChunk(handle.fileId, slice, { userId });
    }
    await spindle.files.finish(handle.fileId, { userId });
    return handle.fileId;
  } catch (err) {
    try {
      await spindle.files.delete(handle.fileId, { userId });
    } catch {}
    throw err;
  }
}
spindle.commands.register({
  id: "open-export",
  title: "Warehouse: Batch Export Characters",
  description: "Open Warehouse to batch export characters into a ZIP archive (JSON, PNG, or CHARX)",
  category: "Characters",
  keywords: ["warehouse", "batch", "export", "zip", "charx", "png", "json", "characters", "backup"]
}, (ctx) => {
  sendToSession({ type: "open_tab", mode: "export" }, ctx.userId, ctx.frontendSessionId);
});
spindle.commands.register({
  id: "open-import",
  title: "Warehouse: Batch Import Character Archive",
  description: "Open Warehouse to import characters from a Warehouse or character ZIP bundle",
  category: "Characters",
  keywords: ["warehouse", "batch", "import", "zip", "charx", "png", "json", "characters", "restore"]
}, (ctx) => {
  sendToSession({ type: "open_tab", mode: "import" }, ctx.userId, ctx.frontendSessionId);
});
spindle.onFrontendMessage(async (rawData, userId, frontendSessionId) => {
  if (!rawData || typeof rawData !== "object")
    return;
  const msg = rawData;
  switch (msg.type) {
    case "load_preferences": {
      try {
        const stored = await spindle.userStorage.getJson(PREFERENCES_KEY, {
          fallback: DEFAULT_PREFERENCES,
          userId
        });
        const preferences = sanitizePreferences(stored, DEFAULT_PREFERENCES);
        sendToSession({ type: "preferences_loaded", preferences }, userId, frontendSessionId);
      } catch (err) {
        spindle.log.warn("Failed to load Warehouse preferences, using defaults:", err);
        sendToSession({ type: "preferences_loaded", preferences: { ...DEFAULT_PREFERENCES } }, userId, frontendSessionId);
      }
      break;
    }
    case "save_preferences": {
      try {
        const existing = await spindle.userStorage.getJson(PREFERENCES_KEY, {
          fallback: DEFAULT_PREFERENCES,
          userId
        });
        const current = sanitizePreferences(existing, DEFAULT_PREFERENCES);
        const merged = sanitizePreferences({ ...current, ...msg.preferences || {} }, current);
        await spindle.userStorage.setJson(PREFERENCES_KEY, merged, {
          indent: 2,
          userId
        });
        sendToSession({ type: "preferences_loaded", preferences: merged }, userId, frontendSessionId);
      } catch (err) {
        spindle.log.warn("Failed to save Warehouse preferences:", err);
      }
      break;
    }
    case "assemble_archive": {
      const { jobId, fileName, entries, manifestJson } = msg;
      let manifestFileId = null;
      try {
        const archiveEntries = [];
        if (manifestJson && typeof manifestJson === "string") {
          manifestFileId = await writeTextAsStagedFile("warehouse-manifest.json", manifestJson, "application/json", userId);
          archiveEntries.push({
            name: "warehouse-manifest.json",
            source: { fileId: manifestFileId },
            store: false
          });
        }
        for (const item of entries || []) {
          archiveEntries.push({
            name: item.name,
            source: { uploadId: item.uploadId },
            store: Boolean(item.store)
          });
        }
        const archive = await spindle.archives.create(archiveEntries, {
          userId,
          fileName: fileName || "warehouse-characters.zip"
        });
        sendToSession({
          type: "archive_ready",
          jobId,
          fileId: archive.fileId,
          fileName: archive.fileName,
          size: archive.size
        }, userId, frontendSessionId);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        spindle.log.error("Host-staged ZIP assembly failed:", errorMessage);
        sendToSession({
          type: "archive_error",
          jobId,
          error: errorMessage
        }, userId, frontendSessionId);
      } finally {
        if (manifestFileId) {
          try {
            await spindle.files.delete(manifestFileId, { userId });
          } catch {}
        }
        for (const item of entries || []) {
          try {
            await spindle.uploads.delete(item.uploadId, { userId });
          } catch {}
        }
      }
      break;
    }
    case "cleanup_uploads": {
      for (const uploadId of msg.uploadIds || []) {
        try {
          await spindle.uploads.delete(uploadId, { userId });
        } catch {}
      }
      break;
    }
    case "cleanup_archive": {
      if (msg.fileId) {
        try {
          await spindle.files.delete(msg.fileId, { userId });
        } catch {}
      }
      break;
    }
  }
});
spindle.log.info("Warehouse backend initialized.");
