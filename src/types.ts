export type CharacterExportFormat = 'charx' | 'png' | 'json';

export type WarehousePackagingMode = 'browser' | 'host';

export type WarehouseDisplaySurface = 'modal' | 'drawer';

export interface WarehousePreferences {
  exportFormat: CharacterExportFormat;
  organizeByFolder: boolean;
  includeManifest: boolean;
  packagingMode: WarehousePackagingMode;
  concurrency: number;
  skipDuplicates: boolean;
  restoreFolders: boolean;
  defaultSurface: WarehouseDisplaySurface;
}

export const DEFAULT_PREFERENCES: WarehousePreferences = {
  exportFormat: 'charx',
  organizeByFolder: true,
  includeManifest: true,
  packagingMode: 'browser',
  concurrency: 3,
  skipDuplicates: false,
  restoreFolders: true,
  defaultSurface: 'modal',
};

export interface CharacterSummaryItem {
  id: string;
  name: string;
  description?: string;
  avatar?: string;
  tags?: string[];
  creator?: string;
  folder?: string;
  chat_date?: number;
  date_added?: number;
}

export interface ImportJobItemResult {
  filename: string;
  success: boolean;
  skipped?: boolean;
  character?: { id: string; name: string };
  lorebook?: { name: string; entryCount: number };
  error?: string;
}

export interface ImportJobStatusResponse {
  jobId: string;
  status: 'accepting' | 'uploading' | 'processing' | 'complete' | 'cancelled' | 'error';
  total: number;
  uploaded: number;
  processed: number;
  results: ImportJobItemResult[];
  summary?: {
    total: number;
    imported: number;
    skipped: number;
    failed: number;
  };
  error?: string;
}

export interface WarehouseManifestEntry {
  /** Path inside the ZIP archive (using forward slashes). */
  archivePath: string;
  /** Original character ID on the exporting instance. */
  characterId: string;
  /** Character display name. */
  name: string;
  /** Creator name, if set. */
  creator: string;
  /** Lumiverse character browser folder ("" if root). */
  folder: string;
  /** Character tags at export time. */
  tags: string[];
  /** Export format of this entry. */
  format: CharacterExportFormat;
  /** Byte size of the exported file. */
  sizeBytes: number;
}

export interface WarehouseBundleManifest {
  schema: 'lumiverse.warehouse.bundle';
  version: 1;
  creator: string;
  exportedAt: string;
  format: CharacterExportFormat;
  totalCharacters: number;
  entries: WarehouseManifestEntry[];
}

export interface StagedArchiveEntryInput {
  name: string;
  uploadId: string;
  store: boolean;
}

export type FrontendToBackendMessage =
  | {
      type: 'load_preferences';
    }
  | {
      type: 'save_preferences';
      preferences: Partial<WarehousePreferences>;
    }
  | {
      type: 'assemble_archive';
      jobId: string;
      fileName: string;
      entries: StagedArchiveEntryInput[];
      manifestJson?: string;
    }
  | {
      type: 'cleanup_uploads';
      uploadIds: string[];
    }
  | {
      type: 'cleanup_archive';
      fileId: string;
    }
  | {
      type: 'notify';
      message: string;
      variant?: 'success' | 'warning' | 'error' | 'info';
    };

export type BackendToFrontendMessage =
  | {
      type: 'preferences_loaded';
      preferences: WarehousePreferences;
    }
  | {
      type: 'open_tab';
      mode: 'export' | 'import';
      surface?: WarehouseDisplaySurface;
    }
  | {
      type: 'archive_ready';
      jobId: string;
      fileId: string;
      fileName: string;
      size: number;
    }
  | {
      type: 'archive_error';
      jobId: string;
      error: string;
    };
