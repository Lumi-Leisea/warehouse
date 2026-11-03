import type { SpindleFrontendContext } from 'lumiverse-spindle-types';
import {
  DEFAULT_PREFERENCES,
  type BackendToFrontendMessage,
  type CharacterExportFormat,
  type CharacterSummaryItem,
  type FrontendToBackendMessage,
  type ImportJobStatusResponse,
  type WarehouseBundleManifest,
  type WarehouseManifestEntry,
  type WarehousePreferences,
} from './types';
import {
  BrowserZipBuilder,
  extractZipEntryAsFile,
  formatByteSize,
  inspectZipArchive,
  sanitizeFilenameComponent,
  type InspectedZipArchive,
  type ParsedZipCardEntry,
} from './zip';

const WAREHOUSE_ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/>
  <path d="m3.3 7 8.7 5 8.7-5"/>
  <path d="M12 22V12"/>
  <path d="m7.5 4.27 9 5.15"/>
</svg>`;

const WAREHOUSE_STYLES = `
.wh-root {
  display: flex;
  flex-direction: column;
  gap: 12px;
  color: var(--lumiverse-text, #f4f4f6);
  font-size: 13px;
  line-height: 1.45;
  padding-bottom: 18px;
}

.wh-mode-bar-wrap {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.wh-mode-bar {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  padding: 4px;
  flex: 1;
  background: var(--lumiverse-fill-subtle, rgba(255, 255, 255, 0.03));
  border: 1px solid var(--lumiverse-border, rgba(255, 255, 255, 0.08));
  border-radius: var(--lumiverse-radius, 10px);
}

.wh-surface-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 11px;
  border-radius: var(--lumiverse-radius, 10px);
  border: 1px solid var(--lumiverse-border, rgba(255, 255, 255, 0.12));
  background: var(--lumiverse-fill, rgba(255, 255, 255, 0.05));
  color: var(--lumiverse-text, #f4f4f6);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s ease;
}

.wh-surface-btn:hover {
  border-color: var(--lumiverse-accent, #8b5cf6);
  background: rgba(139, 92, 246, 0.14);
}

.wh-mode-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 8px 10px;
  border-radius: calc(var(--lumiverse-radius, 10px) - 2px);
  border: 1px solid transparent;
  background: transparent;
  color: var(--lumiverse-text-muted, #a1a1aa);
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.wh-mode-btn:hover {
  color: var(--lumiverse-text, #f4f4f6);
  background: var(--lumiverse-fill, rgba(255, 255, 255, 0.05));
}

.wh-mode-btn.is-active {
  background: var(--lumiverse-accent, #8b5cf6);
  color: var(--lumiverse-accent-fg, #ffffff);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.22);
}

.wh-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  background: var(--lumiverse-fill-subtle, rgba(255, 255, 255, 0.03));
  border: 1px solid var(--lumiverse-border, rgba(255, 255, 255, 0.08));
  border-radius: var(--lumiverse-radius, 10px);
}

.wh-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.wh-panel-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--lumiverse-text, #f4f4f6);
  letter-spacing: 0.01em;
}

.wh-panel-subtitle {
  font-size: 11.5px;
  color: var(--lumiverse-text-muted, #a1a1aa);
}

.wh-format-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.wh-format-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 9px 10px;
  border-radius: 8px;
  border: 1px solid var(--lumiverse-border, rgba(255, 255, 255, 0.08));
  background: var(--lumiverse-fill, rgba(255, 255, 255, 0.03));
  color: var(--lumiverse-text, #f4f4f6);
  text-align: left;
  cursor: pointer;
  transition: all 0.14s ease;
}

.wh-format-card:hover {
  border-color: var(--lumiverse-border-hover, rgba(255, 255, 255, 0.18));
  background: rgba(255, 255, 255, 0.06);
}

.wh-format-card.is-selected {
  border-color: var(--lumiverse-accent, #8b5cf6);
  background: rgba(139, 92, 246, 0.14);
}

.wh-format-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  gap: 4px;
}

.wh-format-name {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.wh-format-ext {
  font-size: 10.5px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.08);
  color: var(--lumiverse-text-muted, #a1a1aa);
}

.wh-format-desc {
  font-size: 11px;
  color: var(--lumiverse-text-muted, #a1a1aa);
  line-height: 1.3;
}

.wh-options-list {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.wh-checkbox-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  cursor: pointer;
  user-select: none;
  font-size: 12px;
  color: var(--lumiverse-text, #f4f4f6);
}

.wh-checkbox-row input[type="checkbox"] {
  margin-top: 2px;
  accent-color: var(--lumiverse-accent, #8b5cf6);
  cursor: pointer;
}

.wh-checkbox-meta {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.wh-checkbox-hint {
  font-size: 11px;
  color: var(--lumiverse-text-muted, #a1a1aa);
}

.wh-filter-bar {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.wh-filter-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 7px;
}

.wh-input,
.wh-select {
  width: 100%;
  box-sizing: border-box;
  padding: 7px 10px;
  border-radius: 8px;
  border: 1px solid var(--lumiverse-border, rgba(255, 255, 255, 0.1));
  background: var(--lumiverse-fill, rgba(255, 255, 255, 0.04));
  color: var(--lumiverse-text, #f4f4f6);
  font-size: 12px;
  outline: none;
  transition: border-color 0.15s ease;
}

.wh-input:focus,
.wh-select:focus {
  border-color: var(--lumiverse-accent, #8b5cf6);
}

.wh-select option {
  background: #18181b;
  color: #f4f4f6;
}

.wh-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 6px;
}

.wh-toolbar-group {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 5px;
}

.wh-mini-btn {
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid var(--lumiverse-border, rgba(255, 255, 255, 0.1));
  background: var(--lumiverse-fill, rgba(255, 255, 255, 0.04));
  color: var(--lumiverse-text-muted, #a1a1aa);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.14s ease;
}

.wh-mini-btn:hover:not(:disabled) {
  color: var(--lumiverse-text, #f4f4f6);
  border-color: var(--lumiverse-border-hover, rgba(255, 255, 255, 0.2));
  background: rgba(255, 255, 255, 0.08);
}

.wh-mini-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.wh-char-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
  max-height: 320px;
  overflow-y: auto;
  padding-right: 2px;
}

.wh-root.is-modal .wh-char-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(275px, 1fr));
  gap: 7px;
  max-height: 460px;
  align-content: start;
}

.wh-pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-top: 6px;
  border-top: 1px solid var(--lumiverse-border, rgba(255, 255, 255, 0.07));
  font-size: 11.5px;
  color: var(--lumiverse-text-muted, #a1a1aa);
}

.wh-pager-controls {
  display: flex;
  align-items: center;
  gap: 5px;
}

.wh-modal-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 24px 14px;
  text-align: center;
}

.wh-char-item {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 6px 8px;
  border-radius: 8px;
  border: 1px solid var(--lumiverse-border, rgba(255, 255, 255, 0.06));
  background: var(--lumiverse-fill, rgba(255, 255, 255, 0.025));
  cursor: pointer;
  user-select: none;
  transition: all 0.12s ease;
}

.wh-char-item:hover {
  border-color: var(--lumiverse-border-hover, rgba(255, 255, 255, 0.16));
  background: rgba(255, 255, 255, 0.05);
}

.wh-char-item.is-selected {
  border-color: rgba(139, 92, 246, 0.55);
  background: rgba(139, 92, 246, 0.11);
}

.wh-char-avatar {
  width: 32px;
  height: 32px;
  border-radius: 6px;
  object-fit: cover;
  background: rgba(255, 255, 255, 0.06);
  flex-shrink: 0;
}

.wh-char-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.wh-char-name {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--lumiverse-text, #f4f4f6);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.wh-char-sub {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--lumiverse-text-muted, #a1a1aa);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.wh-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 600;
  background: rgba(255, 255, 255, 0.08);
  color: var(--lumiverse-text-muted, #a1a1aa);
  flex-shrink: 0;
}

.wh-badge.is-folder {
  background: rgba(139, 92, 246, 0.16);
  color: #c4b5fd;
}

.wh-badge.is-format {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  text-transform: uppercase;
}

.wh-primary-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  padding: 9px 14px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: var(--lumiverse-accent, #8b5cf6);
  color: var(--lumiverse-accent-fg, #ffffff);
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s ease, transform 0.1s ease;
}

.wh-primary-btn:hover:not(:disabled) {
  opacity: 0.93;
}

.wh-primary-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.wh-secondary-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid var(--lumiverse-border, rgba(255, 255, 255, 0.12));
  background: var(--lumiverse-fill, rgba(255, 255, 255, 0.05));
  color: var(--lumiverse-text, #f4f4f6);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
}

.wh-secondary-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.09);
  border-color: var(--lumiverse-border-hover, rgba(255, 255, 255, 0.22));
}

.wh-danger-btn {
  border-color: rgba(239, 68, 68, 0.4);
  background: rgba(239, 68, 68, 0.12);
  color: #fca5a5;
}

.wh-danger-btn:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.2);
}

.wh-progress-box {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 10px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid var(--lumiverse-border, rgba(255, 255, 255, 0.08));
}

.wh-progress-track {
  width: 100%;
  height: 7px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;
}

.wh-progress-fill {
  height: 100%;
  border-radius: 999px;
  background: var(--lumiverse-accent, #8b5cf6);
  transition: width 0.15s ease;
}

.wh-progress-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 11.5px;
  color: var(--lumiverse-text-muted, #a1a1aa);
}

.wh-dropzone {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 20px 14px;
  border-radius: 10px;
  border: 1.5px dashed var(--lumiverse-border-hover, rgba(255, 255, 255, 0.18));
  background: rgba(255, 255, 255, 0.02);
  text-align: center;
  cursor: pointer;
  transition: all 0.15s ease;
}

.wh-dropzone:hover,
.wh-dropzone.is-dragover {
  border-color: var(--lumiverse-accent, #8b5cf6);
  background: rgba(139, 92, 246, 0.08);
}

.wh-empty {
  padding: 18px 10px;
  text-align: center;
  color: var(--lumiverse-text-muted, #a1a1aa);
  font-size: 12px;
}

.wh-log-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 160px;
  overflow-y: auto;
  font-size: 11.5px;
}

.wh-log-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 7px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.025);
}

.wh-status-ok {
  color: #4ade80;
}

.wh-status-skip {
  color: #facc15;
}

.wh-status-err {
  color: #f87171;
}
`;

interface PendingArchiveAssembly {
  resolve: (result: { fileId: string; fileName: string; size: number }) => void;
  reject: (err: Error) => void;
}

interface ExportReadyArtifact {
  fileName: string;
  size: number;
  count: number;
  format: CharacterExportFormat;
  blob?: Blob;
  fileId?: string;
}

export function setup(ctx: SpindleFrontendContext): void {
  ctx.dom.addStyle(WAREHOUSE_STYLES);

  let activeMode: 'export' | 'import' = 'export';
  let preferences: WarehousePreferences = { ...DEFAULT_PREFERENCES };

  // Character library state
  let characters: CharacterSummaryItem[] = [];
  let availableTags: string[] = [];
  let isLoadingLibrary = false;
  let libraryLoadedCount = 0;
  let libraryTotalCount = 0;
  let libraryError: string | null = null;
  let searchQuery = '';
  let folderFilter = '__ALL__';
  let tagFilter = '__ALL__';
  let exportPage = 0;
  let importPage = 0;
  const selectedCharIds = new Set<string>();
  let activeModal: ReturnType<SpindleFrontendContext['ui']['showModal']> | null = null;

  // Export run state
  let isExporting = false;
  let exportCancelRequested = false;
  let exportAbortController: AbortController | null = null;
  let exportStatusText = '';
  let exportSubStatusText = '';
  let exportProgressPct = 0;
  let lastExportArtifact: ExportReadyArtifact | null = null;
  let activeExportTrackingId: string | null = null;

  // Import state
  let selectedZipFile: File | null = null;
  let inspectedZip: InspectedZipArchive | null = null;
  let isInspectingZip = false;
  let zipInspectError: string | null = null;
  const selectedZipEntryPaths = new Set<string>();
  let isImporting = false;
  let importCancelRequested = false;
  let activeImportJobId: string | null = null;
  let importStatusText = '';
  let importSubStatusText = '';
  let importProgressPct = 0;
  let importResultsSummary: {
    imported: number;
    skipped: number;
    failed: number;
    foldersRestored: number;
    items: Array<{ name: string; status: 'imported' | 'skipped' | 'error'; detail?: string }>;
  } | null = null;

  const pendingAssemblies = new Map<string, PendingArchiveAssembly>();
  const supportsFileTransfers = ctx.host?.capabilities?.['file-transfers-v1'] === 1;

  function sendToBackend(msg: FrontendToBackendMessage): void {
    ctx.sendToBackend(msg);
  }

  function showToast(
    message: string,
    variant: 'success' | 'warning' | 'error' | 'info' = 'info'
  ): void {
    sendToBackend({ type: 'notify', message, variant });
  }

  interface DomElementOptions {
    className?: string;
    text?: string;
    style?: Record<string, string>;
    attrs?: Record<string, string>;
    on?: Record<string, (e: Event) => void>;
  }

  function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    opts?: DomElementOptions,
    children?: Array<Node | null | undefined>
  ): HTMLElementTagNameMap[K] {
    const element = ctx.dom.createElement(tag);
    if (opts) {
      if (opts.className) {
        element.className = opts.className;
      }
      if (opts.text !== undefined) {
        element.textContent = opts.text;
      }
      if (opts.style) {
        for (const [k, v] of Object.entries(opts.style)) {
          (element.style as unknown as Record<string, string>)[k] = v;
        }
      }
      if (opts.attrs) {
        for (const [k, v] of Object.entries(opts.attrs)) {
          element.setAttribute(k, v);
        }
      }
      if (opts.on) {
        for (const [eventName, handler] of Object.entries(opts.on)) {
          element.addEventListener(eventName, handler);
        }
      }
    }
    if (children) {
      for (const child of children) {
        if (child) {
          element.appendChild(child);
        }
      }
    }
    return element;
  }

  function encodeBase64Utf8(str: string): string {
    const bytes = new TextEncoder().encode(str);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 1) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  async function uploadStagedBlobToHost(
    blob: Blob,
    fileName: string,
    signal: AbortSignal
  ): Promise<{ uploadId: string }> {
    const metadataPairs = [
      `extension ${encodeBase64Utf8(ctx.extensionName || 'warehouse')}`,
      `filename ${encodeBase64Utf8(fileName)}`,
      `filetype ${encodeBase64Utf8(blob.type || 'application/octet-stream')}`,
    ];
    const createRes = await fetch('/api/v1/spindle-uploads', {
      method: 'POST',
      headers: {
        'Tus-Resumable': '1.0.0',
        'Upload-Length': String(blob.size),
        'Upload-Metadata': metadataPairs.join(','),
      },
      signal,
    });
    if (!createRes.ok) {
      throw new Error(`Failed to create host staging upload (HTTP ${createRes.status})`);
    }
    const location = createRes.headers.get('Location') || '';
    const uploadId = location.split('/').filter(Boolean).pop() || '';
    if (!uploadId) {
      throw new Error('Missing upload ID from host staging endpoint');
    }

    const patchRes = await fetch(`/api/v1/spindle-uploads/${encodeURIComponent(uploadId)}`, {
      method: 'PATCH',
      headers: {
        'Tus-Resumable': '1.0.0',
        'Upload-Offset': '0',
        'Content-Type': 'application/offset+octet-stream',
      },
      body: blob,
      signal,
    });
    if (!patchRes.ok) {
      throw new Error(`Failed to write staged upload bytes (HTTP ${patchRes.status})`);
    }
    return { uploadId };
  }

  function updatePreferences(patch: Partial<WarehousePreferences>): void {
    preferences = { ...preferences, ...patch };
    sendToBackend({ type: 'save_preferences', preferences: patch });
  }

  // Listen for CHARX asset export progress events from Lumiverse WebSocket
  const unsubCharxProgress = ctx.events.on('CHARACTER_EXPORT_PROGRESS', (payload: unknown) => {
    if (!isExporting || !payload || typeof payload !== 'object') return;
    const data = payload as {
      exportId?: string;
      phase?: string;
      processed?: number;
      total?: number;
      detail?: string;
    };
    if (activeExportTrackingId && data.exportId && data.exportId !== activeExportTrackingId) {
      return;
    }
    if (typeof data.processed === 'number' && typeof data.total === 'number' && data.total > 0) {
      exportSubStatusText = `Packaging CHARX assets (${data.processed}/${data.total})${
        data.detail ? ` — ${data.detail}` : ''
      }`;
      renderProgressOnly();
    }
  });
  ctx.onTeardown(unsubCharxProgress);

  const tab = ctx.ui.registerDrawerTab({
    id: 'warehouse',
    title: 'Warehouse — Batch Character Export & Import',
    shortName: 'Warehouse',
    headerTitle: 'Warehouse',
    description:
      'Batch export characters in JSON, PNG, or CHARX format into a .zip bundle and re-import character .zip archives.',
    keywords: [
      'warehouse',
      'batch',
      'bulk',
      'export',
      'import',
      'zip',
      'charx',
      'png',
      'json',
      'backup',
      'characters',
    ],
    iconSvg: WAREHOUSE_ICON_SVG,
    defaultOpen: false,
  });

  const drawerRoot = el('div', { className: 'wh-root' });
  const modalRoot = el('div', { className: 'wh-root is-modal' });
  tab.root.appendChild(drawerRoot);

  function openWarehouseModal(mode?: 'export' | 'import'): void {
    if (mode) {
      activeMode = mode;
    }
    if (activeModal) {
      render();
      return;
    }
    try {
      const modalHandle = ctx.ui.showModal({
        title: `Warehouse — Batch Character ${activeMode === 'export' ? 'Export' : 'Import'} (${characters.length.toLocaleString()} cards)`,
        width: 1120,
        maxHeight: 860,
      });
      activeModal = modalHandle;
      modalHandle.root.appendChild(modalRoot);
      modalHandle.onDismiss(() => {
        if (activeModal === modalHandle) {
          activeModal = null;
          render();
        }
      });
      render();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Could not open modal: ${msg}`, 'error');
    }
  }

  function closeWarehouseModal(): void {
    if (!activeModal) return;
    const handle = activeModal;
    activeModal = null;
    handle.dismiss();
    render();
  }

  // Dynamic progress elements for lightweight updates during loops
  let progressLabelEl: HTMLElement | null = null;
  let progressSubLabelEl: HTMLElement | null = null;
  let progressFillEl: HTMLElement | null = null;
  let progressPctEl: HTMLElement | null = null;
  let charListContainerEl: HTMLElement | null = null;
  let charListPagerEl: HTMLElement | null = null;
  let selectionSummaryEl: HTMLElement | null = null;
  let exportButtonEl: HTMLButtonElement | null = null;

  function renderProgressOnly(): void {
    const statusText = activeMode === 'export' ? exportStatusText : importStatusText;
    const subText = activeMode === 'export' ? exportSubStatusText : importSubStatusText;
    const pct = activeMode === 'export' ? exportProgressPct : importProgressPct;

    if (progressLabelEl) progressLabelEl.textContent = statusText;
    if (progressSubLabelEl) progressSubLabelEl.textContent = subText;
    if (progressFillEl) progressFillEl.style.width = `${Math.max(0, Math.min(100, pct))}%`;
    if (progressPctEl) progressPctEl.textContent = `${Math.round(pct)}%`;
  }

  function getFoldersList(): string[] {
    const folders = new Set<string>();
    for (const c of characters) {
      const f = (c.folder || '').trim();
      if (f) folders.add(f);
    }
    return Array.from(folders).sort((a, b) => a.localeCompare(b));
  }

  function getFilteredCharacters(): CharacterSummaryItem[] {
    const q = searchQuery.trim().toLowerCase();
    return characters.filter((c) => {
      if (folderFilter === '__UNFILED__') {
        if ((c.folder || '').trim() !== '') return false;
      } else if (folderFilter !== '__ALL__') {
        if ((c.folder || '').trim() !== folderFilter) return false;
      }

      if (tagFilter !== '__ALL__') {
        if (!Array.isArray(c.tags) || !c.tags.includes(tagFilter)) return false;
      }

      if (q) {
        const nameMatch = (c.name || '').toLowerCase().includes(q);
        const creatorMatch = (c.creator || '').toLowerCase().includes(q);
        const folderMatch = (c.folder || '').toLowerCase().includes(q);
        const tagMatch = Array.isArray(c.tags) && c.tags.some((t) => t.toLowerCase().includes(q));
        if (!nameMatch && !creatorMatch && !folderMatch && !tagMatch) return false;
      }

      return true;
    });
  }

  async function loadCharacterLibrary(): Promise<void> {
    if (isLoadingLibrary) return;
    isLoadingLibrary = true;
    libraryLoadedCount = 0;
    libraryTotalCount = 0;
    libraryError = null;
    render();

    try {
      const allItems: CharacterSummaryItem[] = [];
      const pageSize = 1000;
      let offset = 0;
      let total = 0;

      do {
        const res = await fetch(
          `/api/v1/characters/summary?limit=${pageSize}&offset=${offset}&sort=name&direction=asc`
        );
        if (!res.ok) {
          throw new Error(`Failed to fetch characters (HTTP ${res.status})`);
        }
        const data = (await res.json()) as {
          data?: CharacterSummaryItem[];
          items?: CharacterSummaryItem[];
          total?: number;
        };
        const pageItems = Array.isArray(data.data)
          ? data.data
          : Array.isArray(data.items)
            ? data.items
            : [];
        allItems.push(...pageItems);
        total = typeof data.total === 'number' ? data.total : allItems.length;
        offset += pageItems.length;
        libraryLoadedCount = allItems.length;
        libraryTotalCount = total;
        if (charListContainerEl && isLoadingLibrary) {
          charListContainerEl.innerHTML = '';
          charListContainerEl.appendChild(
            el('div', {
              className: 'wh-empty',
              text: `Loading character library... (${libraryLoadedCount.toLocaleString()} / ${libraryTotalCount.toLocaleString()})`,
            })
          );
        }
        if (pageItems.length === 0) break;
      } while (offset < total);

      characters = allItems;
      exportPage = 0;

      // Clean up any stale selected IDs that no longer exist
      const validIds = new Set(characters.map((c) => c.id));
      for (const id of Array.from(selectedCharIds)) {
        if (!validIds.has(id)) selectedCharIds.delete(id);
      }

      // Default to selecting all characters on first load if none selected
      if (selectedCharIds.size === 0 && characters.length > 0) {
        for (const c of characters) {
          selectedCharIds.add(c.id);
        }
      }

      // Fetch tags in background
      try {
        const tagRes = await fetch('/api/v1/characters/tags');
        if (tagRes.ok) {
          const tagRaw = (await tagRes.json()) as unknown;
          const rawList = Array.isArray(tagRaw)
            ? tagRaw
            : tagRaw && typeof tagRaw === 'object' && Array.isArray((tagRaw as { tags?: unknown[] }).tags)
              ? (tagRaw as { tags: unknown[] }).tags
              : [];
          const parsedTags: string[] = [];
          for (const entry of rawList) {
            if (typeof entry === 'string' && entry.trim()) {
              parsedTags.push(entry.trim());
            } else if (
              entry &&
              typeof entry === 'object' &&
              typeof (entry as { tag?: unknown }).tag === 'string'
            ) {
              const t = ((entry as { tag: string }).tag || '').trim();
              if (t) parsedTags.push(t);
            }
          }
          availableTags = Array.from(new Set(parsedTags)).sort((a, b) => a.localeCompare(b));
        }
      } catch {
        // Non-fatal
      }
    } catch (err) {
      libraryError = err instanceof Error ? err.message : String(err);
    } finally {
      isLoadingLibrary = false;
      render();
    }
  }

  function triggerBrowserBlobDownload(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 10000);
  }

  async function downloadLastExportArtifact(): Promise<void> {
    if (!lastExportArtifact) return;
    if (lastExportArtifact.blob) {
      triggerBrowserBlobDownload(lastExportArtifact.blob, lastExportArtifact.fileName);
      return;
    }
    if (lastExportArtifact.fileId) {
      await ctx.files.download(lastExportArtifact.fileId);
    }
  }

  function buildArchiveTimestamp(): string {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(
      now.getHours()
    )}-${pad(now.getMinutes())}`;
  }

  function allocateZipEntryPath(
    char: CharacterSummaryItem,
    format: CharacterExportFormat,
    organizeByFolder: boolean,
    usedPathsLower: Set<string>
  ): string {
    const baseName = sanitizeFilenameComponent(char.name || 'character', 'character');
    const folderRaw = organizeByFolder ? (char.folder || '').trim() : '';
    const folderPrefix = folderRaw
      ? `${sanitizeFilenameComponent(folderRaw, 'Folder')}/`
      : '';

    let candidate = `${folderPrefix}${baseName}.${format}`;
    let counter = 2;
    while (usedPathsLower.has(candidate.toLowerCase())) {
      candidate = `${folderPrefix}${baseName} (${counter}).${format}`;
      counter += 1;
    }
    usedPathsLower.add(candidate.toLowerCase());
    return candidate;
  }

  async function runBatchExport(): Promise<void> {
    if (isExporting) return;
    const selectedChars = characters.filter((c) => selectedCharIds.has(c.id));
    if (selectedChars.length === 0) {
      showToast('Select at least one character to export.', 'warning');
      return;
    }

    // Clean up previous host-staged file if any
    if (lastExportArtifact?.fileId) {
      sendToBackend({ type: 'cleanup_archive', fileId: lastExportArtifact.fileId });
    }
    lastExportArtifact = null;

    isExporting = true;
    exportCancelRequested = false;
    exportAbortController = new AbortController();
    const format = preferences.exportFormat;
    const organizeByFolder = preferences.organizeByFolder;
    const includeManifest = preferences.includeManifest;
    const useServerStaging = Boolean(
      preferences.packagingMode === 'host' && supportsFileTransfers
    );
    const storeWithoutCompression = format !== 'json';

    exportStatusText = `Preparing to export ${selectedChars.length} character${
      selectedChars.length === 1 ? '' : 's'
    } (${format.toUpperCase()})...`;
    exportSubStatusText = '';
    exportProgressPct = 0;
    render();

    const usedPathsLower = new Set<string>(['warehouse-manifest.json']);
    const manifestEntries: WarehouseManifestEntry[] = [];
    const stagedUploadEntries: Array<{ name: string; uploadId: string; store: boolean }> = [];
    const zipBuilder = useServerStaging ? null : new BrowserZipBuilder();

    try {
      for (let i = 0; i < selectedChars.length; i += 1) {
        if (exportCancelRequested) {
          throw new Error('Export cancelled by user.');
        }

        const char = selectedChars[i];
        const entryPath = allocateZipEntryPath(char, format, organizeByFolder, usedPathsLower);

        exportStatusText = `Exporting (${i + 1}/${selectedChars.length}): ${char.name}`;
        exportSubStatusText =
          format === 'charx'
            ? 'Building CHARX package with assets & modules...'
            : `Generating .${format} card...`;
        exportProgressPct = (i / selectedChars.length) * 88;
        renderProgressOnly();

        const exportTrackingId =
          format === 'charx'
            ? `wh_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
            : null;
        activeExportTrackingId = exportTrackingId;

        const query = new URLSearchParams({ format });
        if (exportTrackingId) {
          query.set('export_id', exportTrackingId);
        }

        const response = await fetch(`/api/v1/characters/${encodeURIComponent(char.id)}/export?${query.toString()}`, {
          method: 'GET',
          signal: exportAbortController.signal,
        });

        if (!response.ok) {
          let errDetail = `HTTP ${response.status}`;
          try {
            const errJson = (await response.json()) as { error?: string };
            if (errJson?.error) errDetail = errJson.error;
          } catch {
            // Ignore JSON parse error
          }
          throw new Error(`Failed to export "${char.name}": ${errDetail}`);
        }

        const cardBytes = new Uint8Array(await response.arrayBuffer());
        activeExportTrackingId = null;

        if (exportCancelRequested) {
          throw new Error('Export cancelled by user.');
        }

        if (useServerStaging) {
          exportSubStatusText = `Staging ${entryPath} (${formatByteSize(cardBytes.byteLength)}) to host...`;
          renderProgressOnly();

          const baseFileName = entryPath.split('/').pop() || `${char.id}.${format}`;
          const mimeType =
            format === 'json'
              ? 'application/json'
              : format === 'png'
                ? 'image/png'
                : 'application/zip';
          const fileBlob = new Blob([cardBytes], { type: mimeType });
          const uploaded = await uploadStagedBlobToHost(
            fileBlob,
            baseFileName,
            exportAbortController.signal
          );
          stagedUploadEntries.push({
            name: entryPath,
            uploadId: uploaded.uploadId,
            store: storeWithoutCompression,
          });
        } else if (zipBuilder) {
          exportSubStatusText = `Adding ${entryPath} (${formatByteSize(cardBytes.byteLength)}) to ZIP...`;
          renderProgressOnly();
          await zipBuilder.addFile(entryPath, cardBytes, {
            store: storeWithoutCompression,
          });
        }

        manifestEntries.push({
          archivePath: entryPath,
          characterId: char.id,
          name: char.name,
          creator: char.creator || '',
          folder: (char.folder || '').trim(),
          tags: Array.isArray(char.tags) ? char.tags : [],
          format,
          sizeBytes: cardBytes.byteLength,
        });
      }

      const manifestObj: WarehouseBundleManifest = {
        schema: 'lumiverse.warehouse.bundle',
        version: 1,
        creator: 'Eleisea',
        exportedAt: new Date().toISOString(),
        format,
        totalCharacters: manifestEntries.length,
        entries: manifestEntries,
      };
      const manifestJson = includeManifest ? JSON.stringify(manifestObj, null, 2) : undefined;
      const archiveFileName = `warehouse-${format}-${manifestEntries.length}-chars-${buildArchiveTimestamp()}.zip`;

      exportStatusText = 'Finalizing ZIP archive...';
      exportSubStatusText = 'Writing Central Directory & ZIP64 records...';
      exportProgressPct = 94;
      renderProgressOnly();

      if (useServerStaging) {
        const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const archiveResult = await new Promise<{
          fileId: string;
          fileName: string;
          size: number;
        }>((resolve, reject) => {
          pendingAssemblies.set(jobId, { resolve, reject });
          sendToBackend({
            type: 'assemble_archive',
            jobId,
            fileName: archiveFileName,
            entries: stagedUploadEntries,
            manifestJson,
          });
        });

        lastExportArtifact = {
          fileName: archiveResult.fileName || archiveFileName,
          size: archiveResult.size,
          count: manifestEntries.length,
          format,
          fileId: archiveResult.fileId,
        };
      } else if (zipBuilder) {
        if (manifestJson) {
          await zipBuilder.addFile(
            'warehouse-manifest.json',
            new TextEncoder().encode(manifestJson),
            { store: false }
          );
        }
        const zipBlob = zipBuilder.finalize();
        lastExportArtifact = {
          fileName: archiveFileName,
          size: zipBlob.size,
          count: manifestEntries.length,
          format,
          blob: zipBlob,
        };
      }

      exportProgressPct = 100;
      exportStatusText = `Exported ${manifestEntries.length} character${
        manifestEntries.length === 1 ? '' : 's'
      } (${formatByteSize(lastExportArtifact?.size || 0)})`;
      exportSubStatusText = 'Starting download...';
      renderProgressOnly();

      await downloadLastExportArtifact();
      showToast(
        `Exported ${manifestEntries.length} character${
          manifestEntries.length === 1 ? '' : 's'
        } to ${archiveFileName}`,
        'success'
      );
    } catch (err) {
      if (stagedUploadEntries.length > 0) {
        sendToBackend({
          type: 'cleanup_uploads',
          uploadIds: stagedUploadEntries.map((e) => e.uploadId),
        });
      }
      const message = err instanceof Error ? err.message : String(err);
      if (exportCancelRequested || message.toLowerCase().includes('abort')) {
        showToast('Batch export cancelled.', 'info');
      } else {
        showToast(`Export failed: ${message}`, 'error');
      }
    } finally {
      activeExportTrackingId = null;
      exportAbortController = null;
      isExporting = false;
      exportCancelRequested = false;
      render();
    }
  }

  async function handleZipFileSelected(file: File): Promise<void> {
    selectedZipFile = file;
    inspectedZip = null;
    zipInspectError = null;
    importResultsSummary = null;
    importPage = 0;
    selectedZipEntryPaths.clear();

    // If the user selected a single .charx, .png, or .json directly instead of a .zip, explain or handle it
    if (!file.name.toLowerCase().endsWith('.zip')) {
      zipInspectError = `"${file.name}" is not a .zip archive. Please select a Warehouse .zip bundle or any .zip containing .charx, .png, or .json character cards.`;
      render();
      return;
    }

    isInspectingZip = true;
    render();

    try {
      const result = await inspectZipArchive(file);
      inspectedZip = result;
      for (const entry of result.entries) {
        selectedZipEntryPaths.add(entry.archivePath);
      }
      if (result.entries.length === 0) {
        zipInspectError =
          'No .charx, .png, or .json character cards were found inside this .zip archive.';
      }
    } catch (err) {
      zipInspectError = err instanceof Error ? err.message : String(err);
    } finally {
      isInspectingZip = false;
      render();
    }
  }

  async function runBatchImport(): Promise<void> {
    if (isImporting || !selectedZipFile || !inspectedZip) return;

    const chosenCandidates: ParsedZipCardEntry[] = inspectedZip.entries.filter((c) =>
      selectedZipEntryPaths.has(c.archivePath)
    );
    if (chosenCandidates.length === 0) {
      showToast('Select at least one character from the archive to import.', 'warning');
      return;
    }

    isImporting = true;
    importCancelRequested = false;
    activeImportJobId = null;
    importResultsSummary = null;
    importProgressPct = 0;
    importStatusText = `Creating import job for ${chosenCandidates.length} character${
      chosenCandidates.length === 1 ? '' : 's'
    }...`;
    importSubStatusText = '';
    render();

    try {
      const createRes = await fetch('/api/v1/characters/import-jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          total: chosenCandidates.length,
          skip_duplicates: preferences.skipDuplicates,
        }),
      });

      if (!createRes.ok) {
        throw new Error(`Failed to initialize import job (HTTP ${createRes.status})`);
      }

      const { jobId } = (await createRes.json()) as { jobId: string };
      activeImportJobId = jobId;

      // Phase 1: Extract each selected card from the ZIP on the fly and stream to the import job
      for (let i = 0; i < chosenCandidates.length; i += 1) {
        if (importCancelRequested) {
          await fetch(`/api/v1/characters/import-jobs/${encodeURIComponent(jobId)}/cancel`, {
            method: 'POST',
          }).catch(() => {});
          throw new Error('Import cancelled by user.');
        }

        const candidate = chosenCandidates[i];
        importStatusText = `Extracting & staging (${i + 1}/${chosenCandidates.length}): ${candidate.baseName}`;
        importSubStatusText = `${candidate.archivePath} (${formatByteSize(
          candidate.uncompressedSize
        )})`;
        importProgressPct = (i / chosenCandidates.length) * 45;
        renderProgressOnly();

        const extractedFile = await extractZipEntryAsFile(selectedZipFile, candidate);

        const uploadRes = await fetch(
          `/api/v1/characters/import-jobs/${encodeURIComponent(jobId)}/files/${i}?filename=${encodeURIComponent(
            extractedFile.name
          )}`,
          {
            method: 'PUT',
            headers: {
              'Content-Type': extractedFile.type || 'application/octet-stream',
            },
            body: extractedFile,
          }
        );

        if (!uploadRes.ok) {
          throw new Error(
            `Failed to stage "${candidate.baseName}" (HTTP ${uploadRes.status})`
          );
        }
      }

      // Phase 2: Start server-side processing and poll progress
      importStatusText = 'Starting character import pipeline...';
      importSubStatusText = 'Importing cards, avatars, world books, and modules...';
      importProgressPct = 48;
      renderProgressOnly();

      const startRes = await fetch(
        `/api/v1/characters/import-jobs/${encodeURIComponent(jobId)}/start`,
        {
          method: 'POST',
        }
      );
      if (!startRes.ok) {
        throw new Error(`Failed to start import job (HTTP ${startRes.status})`);
      }

      let finalStatus: ImportJobStatusResponse | null = null;
      while (true) {
        if (importCancelRequested) {
          await fetch(`/api/v1/characters/import-jobs/${encodeURIComponent(jobId)}/cancel`, {
            method: 'POST',
          }).catch(() => {});
        }

        const statusRes = await fetch(
          `/api/v1/characters/import-jobs/${encodeURIComponent(jobId)}/status`
        );
        if (!statusRes.ok) {
          throw new Error(`Failed to read import job status (HTTP ${statusRes.status})`);
        }

        const statusData = (await statusRes.json()) as ImportJobStatusResponse;
        const processed = statusData.processed || 0;
        const total = statusData.total || chosenCandidates.length;

        importStatusText = `Importing characters (${processed}/${total})...`;
        importSubStatusText = `${statusData.succeeded || 0} imported, ${
          statusData.skipped || 0
        } skipped, ${statusData.failed || 0} failed`;
        importProgressPct = 48 + (processed / Math.max(1, total)) * 45;
        renderProgressOnly();

        if (
          statusData.status === 'complete' ||
          statusData.status === 'cancelled' ||
          statusData.status === 'error'
        ) {
          finalStatus = statusData;
          break;
        }

        await new Promise((r) => setTimeout(r, 250));
      }

      // Phase 3: Restore folders if enabled
      let foldersRestoredCount = 0;
      if (preferences.restoreFolders && finalStatus && Array.isArray(finalStatus.results)) {
        const folderToCharIds = new Map<string, string[]>();
        for (const itemResult of finalStatus.results) {
          if (itemResult.status === 'imported' && itemResult.character?.id) {
            const candidate = chosenCandidates[itemResult.index];
            const targetFolder = (candidate?.folder || '').trim();
            if (targetFolder) {
              const list = folderToCharIds.get(targetFolder) || [];
              list.push(itemResult.character.id);
              folderToCharIds.set(targetFolder, list);
            }
          }
        }

        if (folderToCharIds.size > 0) {
          importStatusText = 'Restoring character folder assignments...';
          importProgressPct = 96;
          renderProgressOnly();

          for (const [folderName, charIds] of folderToCharIds.entries()) {
            try {
              const bulkRes = await fetch('/api/v1/characters/bulk-update', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  ids: charIds,
                  folder: folderName,
                }),
              });
              if (bulkRes.ok) {
                foldersRestoredCount += charIds.length;
              }
            } catch {
              // Ignore non-fatal folder assignment error
            }
          }
        }
      }

      const logItems: Array<{
        name: string;
        status: 'imported' | 'skipped' | 'error';
        detail?: string;
      }> = [];

      if (finalStatus && Array.isArray(finalStatus.results)) {
        for (const r of finalStatus.results) {
          const candidate = chosenCandidates[r.index];
          const displayName =
            r.character?.name || candidate?.baseName || r.filename || `Entry #${r.index + 1}`;
          logItems.push({
            name: displayName,
            status: r.status,
            detail:
              r.status === 'imported'
                ? candidate?.folder && preferences.restoreFolders
                  ? `Folder: ${candidate.folder}`
                  : 'Imported'
                : r.error || (r.status === 'skipped' ? 'Duplicate skipped' : 'Failed'),
          });
        }
      }

      importResultsSummary = {
        imported: finalStatus?.succeeded || 0,
        skipped: finalStatus?.skipped || 0,
        failed: finalStatus?.failed || 0,
        foldersRestored: foldersRestoredCount,
        items: logItems,
      };

      importProgressPct = 100;
      showToast(
        `Import complete: ${importResultsSummary.imported} imported, ${importResultsSummary.skipped} skipped, ${importResultsSummary.failed} failed.`,
        importResultsSummary.failed > 0 ? 'warning' : 'success'
      );

      // Refresh character library list so newly imported characters show up immediately in Export tab
      loadCharacterLibrary().catch(() => {});
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Import failed: ${msg}`, 'error');
    } finally {
      activeImportJobId = null;
      isImporting = false;
      importCancelRequested = false;
      render();
    }
  }

  const EXPORT_PAGE_SIZE_MODAL = 200;
  const EXPORT_PAGE_SIZE_DRAWER = 100;
  const IMPORT_PAGE_SIZE_MODAL = 200;
  const IMPORT_PAGE_SIZE_DRAWER = 100;

  function updateCharacterListSelectionUI(): void {
    const filtered = getFilteredCharacters();
    if (selectionSummaryEl) {
      selectionSummaryEl.textContent = `${selectedCharIds.size.toLocaleString()} of ${characters.length.toLocaleString()} selected (${filtered.length.toLocaleString()} shown)`;
    }
    if (exportButtonEl) {
      exportButtonEl.disabled = isExporting || selectedCharIds.size === 0;
      exportButtonEl.textContent = isExporting
        ? 'Exporting...'
        : `Export ${selectedCharIds.size.toLocaleString()} Character${
            selectedCharIds.size === 1 ? '' : 's'
          } as .ZIP (${preferences.exportFormat.toUpperCase()})`;
    }
    if (!charListContainerEl) return;

    charListContainerEl.innerHTML = '';
    if (charListPagerEl) {
      charListPagerEl.innerHTML = '';
      charListPagerEl.style.display = 'none';
    }

    if (isLoadingLibrary) {
      const progressDetail =
        libraryTotalCount > 0
          ? ` (${libraryLoadedCount.toLocaleString()} / ${libraryTotalCount.toLocaleString()})`
          : '';
      charListContainerEl.appendChild(
        el('div', {
          className: 'wh-empty',
          text: `Loading character library...${progressDetail}`,
        })
      );
      return;
    }

    if (libraryError) {
      charListContainerEl.appendChild(
        el('div', { className: 'wh-empty wh-status-err', text: libraryError })
      );
      return;
    }

    if (filtered.length === 0) {
      charListContainerEl.appendChild(
        el('div', {
          className: 'wh-empty',
          text:
            characters.length === 0
              ? 'No characters found in your Lumiverse library.'
              : 'No characters match your current search or filter.',
        })
      );
      return;
    }

    const pageSize = activeModal ? EXPORT_PAGE_SIZE_MODAL : EXPORT_PAGE_SIZE_DRAWER;
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    if (exportPage >= totalPages) exportPage = totalPages - 1;
    if (exportPage < 0) exportPage = 0;

    const startIdx = exportPage * pageSize;
    const pageSlice = filtered.slice(startIdx, startIdx + pageSize);

    for (const char of pageSlice) {
      const isSelected = selectedCharIds.has(char.id);
      const row = el('div', {
        className: `wh-char-item${isSelected ? ' is-selected' : ''}`,
      });

      const checkbox = el('input', {
        attrs: { type: 'checkbox' },
      }) as HTMLInputElement;
      checkbox.checked = isSelected;

      const avatar = el('img', {
        className: 'wh-char-avatar',
        attrs: {
          src: `/api/v1/characters/${encodeURIComponent(char.id)}/avatar?size=sm`,
          alt: char.name || 'Character',
          loading: 'lazy',
        },
      });

      const subParts: string[] = [];
      if (char.creator) subParts.push(`by ${char.creator}`);
      if (Array.isArray(char.tags) && char.tags.length > 0) {
        subParts.push(char.tags.slice(0, 3).join(', '));
      }

      const info = el('div', { className: 'wh-char-info' }, [
        el('div', { className: 'wh-char-name', text: char.name || 'Unnamed' }),
        el('div', {
          className: 'wh-char-sub',
          text: subParts.join(' • ') || 'No creator/tags',
        }),
      ]);

      row.appendChild(checkbox);
      row.appendChild(avatar);
      row.appendChild(info);

      if (char.folder && char.folder.trim()) {
        row.appendChild(
          el('span', {
            className: 'wh-badge is-folder',
            text: char.folder.trim(),
          })
        );
      }

      const toggleChar = () => {
        if (isExporting) return;
        if (selectedCharIds.has(char.id)) {
          selectedCharIds.delete(char.id);
          checkbox.checked = false;
          row.classList.remove('is-selected');
        } else {
          selectedCharIds.add(char.id);
          checkbox.checked = true;
          row.classList.add('is-selected');
        }
        if (selectionSummaryEl) {
          selectionSummaryEl.textContent = `${selectedCharIds.size.toLocaleString()} of ${characters.length.toLocaleString()} selected (${filtered.length.toLocaleString()} shown)`;
        }
        if (exportButtonEl) {
          exportButtonEl.disabled = isExporting || selectedCharIds.size === 0;
          exportButtonEl.textContent = `Export ${selectedCharIds.size.toLocaleString()} Character${
            selectedCharIds.size === 1 ? '' : 's'
          } as .ZIP (${preferences.exportFormat.toUpperCase()})`;
        }
      };

      row.addEventListener('click', (e) => {
        if (e.target === checkbox) return;
        toggleChar();
      });
      checkbox.addEventListener('change', () => {
        toggleChar();
      });

      charListContainerEl.appendChild(row);
    }

    if (charListPagerEl && totalPages > 1) {
      charListPagerEl.style.display = 'flex';
      const rangeStart = startIdx + 1;
      const rangeEnd = Math.min(filtered.length, startIdx + pageSlice.length);

      const prevBtn = el('button', {
        className: 'wh-mini-btn',
        text: '← Prev',
        attrs: { type: 'button' },
        on: {
          click: () => {
            if (exportPage > 0) {
              exportPage -= 1;
              updateCharacterListSelectionUI();
            }
          },
        },
      }) as HTMLButtonElement;
      prevBtn.disabled = exportPage <= 0;

      const nextBtn = el('button', {
        className: 'wh-mini-btn',
        text: 'Next →',
        attrs: { type: 'button' },
        on: {
          click: () => {
            if (exportPage < totalPages - 1) {
              exportPage += 1;
              updateCharacterListSelectionUI();
            }
          },
        },
      }) as HTMLButtonElement;
      nextBtn.disabled = exportPage >= totalPages - 1;

      charListPagerEl.appendChild(
        el('span', {
          text: `Showing ${rangeStart.toLocaleString()}–${rangeEnd.toLocaleString()} of ${filtered.length.toLocaleString()} • Page ${exportPage + 1} of ${totalPages}`,
        })
      );
      charListPagerEl.appendChild(
        el('div', { className: 'wh-pager-controls' }, [prevBtn, nextBtn])
      );
    }
  }

  function renderExportView(): HTMLElement {
    const container = el('div', {
      style: { display: 'flex', flexDirection: 'column', gap: '12px' },
    });

    // 1. Format & Packaging Options Panel
    const formatPanel = el('div', { className: 'wh-panel' });
    formatPanel.appendChild(
      el('div', { className: 'wh-panel-header' }, [
        el('span', { className: 'wh-panel-title', text: '1. Export Format & Archive Options' }),
        el('span', { className: 'wh-panel-subtitle', text: 'Bundled as .zip' }),
      ])
    );

    const formats: Array<{
      id: CharacterExportFormat;
      title: string;
      ext: string;
      desc: string;
    }> = [
      {
        id: 'charx',
        title: 'CHARX',
        ext: '.charx',
        desc: 'Full bundle: card, alt avatars, gallery, expressions, world books & regex',
      },
      {
        id: 'png',
        title: 'PNG Card',
        ext: '.png',
        desc: 'Avatar PNG embedded with CCSv3 metadata & attached world books',
      },
      {
        id: 'json',
        title: 'JSON Card',
        ext: '.json',
        desc: 'Lightweight CCSv3 JSON character definition & character_book',
      },
    ];

    const formatGrid = el('div', { className: 'wh-format-grid' });
    for (const fmt of formats) {
      const card = el(
        'button',
        {
          className: `wh-format-card${preferences.exportFormat === fmt.id ? ' is-selected' : ''}`,
          attrs: { type: 'button' },
          on: {
            click: () => {
              if (isExporting) return;
              updatePreferences({ exportFormat: fmt.id });
              render();
            },
          },
        },
        [
          el('div', { className: 'wh-format-card-top' }, [
            el('span', { className: 'wh-format-name', text: fmt.title }),
            el('span', { className: 'wh-format-ext', text: fmt.ext }),
          ]),
          el('span', { className: 'wh-format-desc', text: fmt.desc }),
        ]
      );
      formatGrid.appendChild(card);
    }
    formatPanel.appendChild(formatGrid);

    const optionsList = el('div', { className: 'wh-options-list' });

    const createOptionRow = (
      checked: boolean,
      title: string,
      hint: string,
      onChange: (val: boolean) => void
    ) => {
      const cb = el('input', { attrs: { type: 'checkbox' } }) as HTMLInputElement;
      cb.checked = checked;
      cb.disabled = isExporting;
      cb.addEventListener('change', () => onChange(cb.checked));

      return el('label', { className: 'wh-checkbox-row' }, [
        cb,
        el('div', { className: 'wh-checkbox-meta' }, [
          el('span', { text: title }),
          el('span', { className: 'wh-checkbox-hint', text: hint }),
        ]),
      ]);
    };

    optionsList.appendChild(
      createOptionRow(
        preferences.organizeByFolder,
        'Organize archive into subfolders by character folder',
        'Places characters in FolderName/CharacterName.ext inside the .zip',
        (val) => updatePreferences({ organizeByFolder: val })
      )
    );

    optionsList.appendChild(
      createOptionRow(
        preferences.includeManifest,
        'Include warehouse-manifest.json metadata',
        'Preserves exact folder assignments and export metadata when re-importing later',
        (val) => updatePreferences({ includeManifest: val })
      )
    );

    if (supportsFileTransfers) {
      optionsList.appendChild(
        createOptionRow(
          preferences.packagingMode === 'host',
          'Use host disk staging (Spindle Archives API)',
          'Stages files on the Lumiverse server disk before assembling the ZIP64 archive',
          (val) => updatePreferences({ packagingMode: val ? 'host' : 'browser' })
        )
      );
    }

    formatPanel.appendChild(optionsList);
    container.appendChild(formatPanel);

    // 2. Character Selection Panel
    const selectPanel = el('div', { className: 'wh-panel' });
    selectionSummaryEl = el('span', {
      className: 'wh-panel-subtitle',
      text: `${selectedCharIds.size} of ${characters.length} selected`,
    });

    selectPanel.appendChild(
      el('div', { className: 'wh-panel-header' }, [
        el('span', { className: 'wh-panel-title', text: '2. Select Characters' }),
        selectionSummaryEl,
      ])
    );

    const filterBar = el('div', { className: 'wh-filter-bar' });
    const searchInput = el('input', {
      className: 'wh-input',
      attrs: {
        type: 'search',
        placeholder: 'Search by name, creator, folder, or tag...',
        value: searchQuery,
      },
    }) as HTMLInputElement;
    searchInput.addEventListener('input', () => {
      searchQuery = searchInput.value;
      exportPage = 0;
      updateCharacterListSelectionUI();
    });
    filterBar.appendChild(searchInput);

    const filterRow = el('div', { className: 'wh-filter-row' });

    const folderSelect = el('select', { className: 'wh-select' }) as HTMLSelectElement;
    folderSelect.appendChild(el('option', { attrs: { value: '__ALL__' }, text: 'All Folders' }));
    folderSelect.appendChild(
      el('option', { attrs: { value: '__UNFILED__' }, text: 'Unfiled (No Folder)' })
    );
    for (const f of getFoldersList()) {
      folderSelect.appendChild(el('option', { attrs: { value: f }, text: `Folder: ${f}` }));
    }
    folderSelect.value = folderFilter;
    folderSelect.addEventListener('change', () => {
      folderFilter = folderSelect.value;
      exportPage = 0;
      updateCharacterListSelectionUI();
    });

    const tagSelect = el('select', { className: 'wh-select' }) as HTMLSelectElement;
    tagSelect.appendChild(el('option', { attrs: { value: '__ALL__' }, text: 'All Tags' }));
    for (const t of availableTags) {
      tagSelect.appendChild(el('option', { attrs: { value: t }, text: `Tag: ${t}` }));
    }
    tagSelect.value = tagFilter;
    tagSelect.addEventListener('change', () => {
      tagFilter = tagSelect.value;
      exportPage = 0;
      updateCharacterListSelectionUI();
    });

    filterRow.appendChild(folderSelect);
    filterRow.appendChild(tagSelect);
    filterBar.appendChild(filterRow);
    selectPanel.appendChild(filterBar);

    // Quick selection toolbar
    const toolbar = el('div', { className: 'wh-toolbar' });
    const leftGroup = el('div', { className: 'wh-toolbar-group' }, [
      el('button', {
        className: 'wh-mini-btn',
        text: 'Select Shown',
        attrs: { type: 'button' },
        on: {
          click: () => {
            for (const c of getFilteredCharacters()) selectedCharIds.add(c.id);
            updateCharacterListSelectionUI();
          },
        },
      }),
      el('button', {
        className: 'wh-mini-btn',
        text: 'Select All',
        attrs: { type: 'button' },
        on: {
          click: () => {
            for (const c of characters) selectedCharIds.add(c.id);
            updateCharacterListSelectionUI();
          },
        },
      }),
      el('button', {
        className: 'wh-mini-btn',
        text: 'Invert Shown',
        attrs: { type: 'button' },
        on: {
          click: () => {
            for (const c of getFilteredCharacters()) {
              if (selectedCharIds.has(c.id)) selectedCharIds.delete(c.id);
              else selectedCharIds.add(c.id);
            }
            updateCharacterListSelectionUI();
          },
        },
      }),
      el('button', {
        className: 'wh-mini-btn',
        text: 'Clear',
        attrs: { type: 'button' },
        on: {
          click: () => {
            selectedCharIds.clear();
            updateCharacterListSelectionUI();
          },
        },
      }),
    ]);

    const refreshBtn = el('button', {
      className: 'wh-mini-btn',
      text: isLoadingLibrary ? 'Refreshing...' : 'Refresh List',
      attrs: { type: 'button' },
      on: {
        click: () => {
          loadCharacterLibrary();
        },
      },
    }) as HTMLButtonElement;
    refreshBtn.disabled = isLoadingLibrary || isExporting;

    toolbar.appendChild(leftGroup);
    toolbar.appendChild(refreshBtn);
    selectPanel.appendChild(toolbar);

    charListContainerEl = el('div', { className: 'wh-char-list' });
    charListPagerEl = el('div', { className: 'wh-pager', style: { display: 'none' } });
    selectPanel.appendChild(charListContainerEl);
    selectPanel.appendChild(charListPagerEl);
    container.appendChild(selectPanel);

    // 3. Export Action & Live Progress
    const actionPanel = el('div', { className: 'wh-panel' });

    if (isExporting) {
      progressLabelEl = el('div', {
        className: 'wh-panel-title',
        text: exportStatusText || 'Exporting...',
      });
      progressPctEl = el('span', { text: `${Math.round(exportProgressPct)}%` });
      progressSubLabelEl = el('span', { text: exportSubStatusText });
      progressFillEl = el('div', {
        className: 'wh-progress-fill',
        style: { width: `${exportProgressPct}%` },
      });

      const progressBox = el('div', { className: 'wh-progress-box' }, [
        el('div', { className: 'wh-panel-header' }, [progressLabelEl, progressPctEl]),
        el('div', { className: 'wh-progress-track' }, [progressFillEl]),
        el('div', { className: 'wh-progress-meta' }, [progressSubLabelEl]),
      ]);
      actionPanel.appendChild(progressBox);

      const cancelBtn = el('button', {
        className: 'wh-secondary-btn wh-danger-btn',
        text: 'Cancel Export',
        attrs: { type: 'button' },
        on: {
          click: () => {
            exportCancelRequested = true;
            exportAbortController?.abort();
          },
        },
      });
      actionPanel.appendChild(cancelBtn);
    } else {
      exportButtonEl = el('button', {
        className: 'wh-primary-btn',
        text: `Export ${selectedCharIds.size} Character${
          selectedCharIds.size === 1 ? '' : 's'
        } as .ZIP (${preferences.exportFormat.toUpperCase()})`,
        attrs: { type: 'button' },
        on: {
          click: () => {
            runBatchExport();
          },
        },
      }) as HTMLButtonElement;
      exportButtonEl.disabled = selectedCharIds.size === 0;
      actionPanel.appendChild(exportButtonEl);

      if (lastExportArtifact) {
        const readyRow = el(
          'div',
          {
            className: 'wh-progress-box',
            style: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
          },
          [
            el('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } }, [
              el('span', {
                className: 'wh-status-ok',
                style: { fontWeight: '600', fontSize: '12px' },
                text: `Ready: ${lastExportArtifact.fileName}`,
              }),
              el('span', {
                className: 'wh-panel-subtitle',
                text: `${lastExportArtifact.count} character${
                  lastExportArtifact.count === 1 ? '' : 's'
                } • ${formatByteSize(lastExportArtifact.size)}`,
              }),
            ]),
            el('button', {
              className: 'wh-secondary-btn',
              text: 'Download Again',
              attrs: { type: 'button' },
              on: {
                click: () => {
                  downloadLastExportArtifact();
                },
              },
            }),
          ]
        );
        actionPanel.appendChild(readyRow);
      }
    }

    container.appendChild(actionPanel);
    updateCharacterListSelectionUI();
    return container;
  }

  function renderImportView(): HTMLElement {
    const container = el('div', {
      style: { display: 'flex', flexDirection: 'column', gap: '12px' },
    });

    // 1. Archive Dropzone / Picker
    const pickerPanel = el('div', { className: 'wh-panel' });
    pickerPanel.appendChild(
      el('div', { className: 'wh-panel-header' }, [
        el('span', { className: 'wh-panel-title', text: '1. Select Character .ZIP Archive' }),
        el('span', {
          className: 'wh-panel-subtitle',
          text: 'Supports .charx, .png, and .json inside .zip',
        }),
      ])
    );

    const fileInput = el('input', {
      attrs: {
        type: 'file',
        accept: '.zip,application/zip',
      },
      style: { display: 'none' },
    }) as HTMLInputElement;

    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (file) {
        handleZipFileSelected(file);
      }
    });

    const dropzone = el(
      'div',
      {
        className: 'wh-dropzone',
        on: {
          click: () => {
            if (!isImporting) fileInput.click();
          },
          dragover: (e: Event) => {
            e.preventDefault();
            dropzone.classList.add('is-dragover');
          },
          dragleave: () => {
            dropzone.classList.remove('is-dragover');
          },
          drop: (e: Event) => {
            e.preventDefault();
            dropzone.classList.remove('is-dragover');
            if (isImporting) return;
            const dt = (e as DragEvent).dataTransfer;
            const file = dt?.files?.[0];
            if (file) {
              handleZipFileSelected(file);
            }
          },
        },
      },
      [
        el('div', {
          style: { fontWeight: '600', fontSize: '13px' },
          text: selectedZipFile
            ? `${selectedZipFile.name} (${formatByteSize(selectedZipFile.size)})`
            : 'Click or drag & drop a .zip archive here',
        }),
        el('div', {
          className: 'wh-panel-subtitle',
          text: inspectedZip
            ? `Found ${inspectedZip.entries.length} character card${
                inspectedZip.entries.length === 1 ? '' : 's'
              }${inspectedZip.manifest ? ' • Warehouse Manifest detected' : ''}`
            : 'Reads ZIP & ZIP64 archives directly without loading the entire file into RAM',
        }),
      ]
    );

    pickerPanel.appendChild(fileInput);
    pickerPanel.appendChild(dropzone);

    if (isInspectingZip) {
      pickerPanel.appendChild(
        el('div', { className: 'wh-empty', text: 'Inspecting ZIP central directory...' })
      );
    } else if (zipInspectError) {
      pickerPanel.appendChild(
        el('div', { className: 'wh-empty wh-status-err', text: zipInspectError })
      );
    }

    container.appendChild(pickerPanel);

    // 2. Archive Contents & Import Options
    if (inspectedZip && inspectedZip.entries.length > 0) {
      const contentsPanel = el('div', { className: 'wh-panel' });
      const countSummaryEl = el('span', {
        className: 'wh-panel-subtitle',
        text: `${selectedZipEntryPaths.size} of ${inspectedZip.entries.length} selected`,
      });

      contentsPanel.appendChild(
        el('div', { className: 'wh-panel-header' }, [
          el('span', { className: 'wh-panel-title', text: '2. Archive Contents & Options' }),
          countSummaryEl,
        ])
      );

      // Options checkboxes
      const optionsList = el('div', { className: 'wh-options-list' });

      const skipDupCb = el('input', { attrs: { type: 'checkbox' } }) as HTMLInputElement;
      skipDupCb.checked = preferences.skipDuplicates;
      skipDupCb.disabled = isImporting;
      skipDupCb.addEventListener('change', () => {
        updatePreferences({ skipDuplicates: skipDupCb.checked });
      });

      optionsList.appendChild(
        el('label', { className: 'wh-checkbox-row' }, [
          skipDupCb,
          el('div', { className: 'wh-checkbox-meta' }, [
            el('span', { text: 'Skip duplicate characters' }),
            el('span', {
              className: 'wh-checkbox-hint',
              text: 'Skips characters whose name already exists in your library',
            }),
          ]),
        ])
      );

      const hasAnyFolders = inspectedZip.entries.some((c) => Boolean(c.folder));
      if (hasAnyFolders) {
        const restoreFoldersCb = el('input', {
          attrs: { type: 'checkbox' },
        }) as HTMLInputElement;
        restoreFoldersCb.checked = preferences.restoreFolders;
        restoreFoldersCb.disabled = isImporting;
        restoreFoldersCb.addEventListener('change', () => {
          updatePreferences({ restoreFolders: restoreFoldersCb.checked });
        });

        optionsList.appendChild(
          el('label', { className: 'wh-checkbox-row' }, [
            restoreFoldersCb,
            el('div', { className: 'wh-checkbox-meta' }, [
              el('span', { text: 'Restore character folder assignments' }),
              el('span', {
                className: 'wh-checkbox-hint',
                text: 'Assigns imported characters to their folder from the manifest or ZIP subfolder',
              }),
            ]),
          ])
        );
      }

      contentsPanel.appendChild(optionsList);

      // Selection buttons
      const toolbar = el('div', { className: 'wh-toolbar' }, [
        el('div', { className: 'wh-toolbar-group' }, [
          el('button', {
            className: 'wh-mini-btn',
            text: 'Select All',
            attrs: { type: 'button' },
            on: {
              click: () => {
                if (isImporting || !inspectedZip) return;
                for (const c of inspectedZip.entries) {
                  selectedZipEntryPaths.add(c.archivePath);
                }
                render();
              },
            },
          }),
          el('button', {
            className: 'wh-mini-btn',
            text: 'Clear',
            attrs: { type: 'button' },
            on: {
              click: () => {
                if (isImporting) return;
                selectedZipEntryPaths.clear();
                render();
              },
            },
          }),
        ]),
      ]);
      contentsPanel.appendChild(toolbar);

      // Candidate list (paginated for large archives)
      const importPageSize = activeModal ? IMPORT_PAGE_SIZE_MODAL : IMPORT_PAGE_SIZE_DRAWER;
      const totalImportPages = Math.max(1, Math.ceil(inspectedZip.entries.length / importPageSize));
      if (importPage >= totalImportPages) importPage = totalImportPages - 1;
      if (importPage < 0) importPage = 0;

      const importStartIdx = importPage * importPageSize;
      const importPageSlice = inspectedZip.entries.slice(
        importStartIdx,
        importStartIdx + importPageSize
      );

      const listEl = el('div', { className: 'wh-char-list' });
      for (const candidate of importPageSlice) {
        const isChecked = selectedZipEntryPaths.has(candidate.archivePath);
        const itemRow = el('div', {
          className: `wh-char-item${isChecked ? ' is-selected' : ''}`,
        });

        const cb = el('input', { attrs: { type: 'checkbox' } }) as HTMLInputElement;
        cb.checked = isChecked;
        cb.disabled = isImporting;

        const info = el('div', { className: 'wh-char-info' }, [
          el('div', { className: 'wh-char-name', text: candidate.baseName }),
          el('div', {
            className: 'wh-char-sub',
            text: `${candidate.archivePath} • ${formatByteSize(candidate.uncompressedSize)}`,
          }),
        ]);

        itemRow.appendChild(cb);
        itemRow.appendChild(info);

        if (candidate.folder) {
          itemRow.appendChild(
            el('span', {
              className: 'wh-badge is-folder',
              text: candidate.folder,
            })
          );
        }

        itemRow.appendChild(
          el('span', {
            className: 'wh-badge is-format',
            text: candidate.format,
          })
        );

        const toggleCandidate = () => {
          if (isImporting) return;
          if (selectedZipEntryPaths.has(candidate.archivePath)) {
            selectedZipEntryPaths.delete(candidate.archivePath);
          } else {
            selectedZipEntryPaths.add(candidate.archivePath);
          }
          render();
        };

        itemRow.addEventListener('click', (e) => {
          if (e.target === cb) return;
          toggleCandidate();
        });
        cb.addEventListener('change', () => {
          toggleCandidate();
        });

        listEl.appendChild(itemRow);
      }

      contentsPanel.appendChild(listEl);

      if (totalImportPages > 1) {
        const rangeStart = importStartIdx + 1;
        const rangeEnd = Math.min(
          inspectedZip.entries.length,
          importStartIdx + importPageSlice.length
        );

        const prevBtn = el('button', {
          className: 'wh-mini-btn',
          text: '← Prev',
          attrs: { type: 'button' },
          on: {
            click: () => {
              if (importPage > 0) {
                importPage -= 1;
                render();
              }
            },
          },
        }) as HTMLButtonElement;
        prevBtn.disabled = importPage <= 0;

        const nextBtn = el('button', {
          className: 'wh-mini-btn',
          text: 'Next →',
          attrs: { type: 'button' },
          on: {
            click: () => {
              if (importPage < totalImportPages - 1) {
                importPage += 1;
                render();
              }
            },
          },
        }) as HTMLButtonElement;
        nextBtn.disabled = importPage >= totalImportPages - 1;

        contentsPanel.appendChild(
          el('div', { className: 'wh-pager' }, [
            el('span', {
              text: `Showing ${rangeStart.toLocaleString()}–${rangeEnd.toLocaleString()} of ${inspectedZip.entries.length.toLocaleString()} • Page ${importPage + 1} of ${totalImportPages}`,
            }),
            el('div', { className: 'wh-pager-controls' }, [prevBtn, nextBtn]),
          ])
        );
      }

      // Import action / progress
      if (isImporting) {
        progressLabelEl = el('div', {
          className: 'wh-panel-title',
          text: importStatusText || 'Importing...',
        });
        progressPctEl = el('span', { text: `${Math.round(importProgressPct)}%` });
        progressSubLabelEl = el('span', { text: importSubStatusText });
        progressFillEl = el('div', {
          className: 'wh-progress-fill',
          style: { width: `${importProgressPct}%` },
        });

        contentsPanel.appendChild(
          el('div', { className: 'wh-progress-box' }, [
            el('div', { className: 'wh-panel-header' }, [progressLabelEl, progressPctEl]),
            el('div', { className: 'wh-progress-track' }, [progressFillEl]),
            el('div', { className: 'wh-progress-meta' }, [progressSubLabelEl]),
          ])
        );

        contentsPanel.appendChild(
          el('button', {
            className: 'wh-secondary-btn wh-danger-btn',
            text: 'Cancel Import',
            attrs: { type: 'button' },
            on: {
              click: () => {
                importCancelRequested = true;
                if (activeImportJobId) {
                  fetch(
                    `/api/v1/characters/import-jobs/${encodeURIComponent(activeImportJobId)}/cancel`,
                    { method: 'POST' }
                  ).catch(() => {});
                }
              },
            },
          })
        );
      } else {
        const importBtn = el('button', {
          className: 'wh-primary-btn',
          text: `Import ${selectedZipEntryPaths.size} Character${
            selectedZipEntryPaths.size === 1 ? '' : 's'
          } into Lumiverse`,
          attrs: { type: 'button' },
          on: {
            click: () => {
              runBatchImport();
            },
          },
        }) as HTMLButtonElement;
        importBtn.disabled = selectedZipEntryPaths.size === 0;
        contentsPanel.appendChild(importBtn);
      }

      container.appendChild(contentsPanel);
    }

    // 3. Import Results Summary
    if (importResultsSummary) {
      const summaryPanel = el('div', { className: 'wh-panel' });
      summaryPanel.appendChild(
        el('div', { className: 'wh-panel-header' }, [
          el('span', { className: 'wh-panel-title', text: 'Import Summary' }),
          el('span', {
            className: 'wh-panel-subtitle',
            text: `${importResultsSummary.imported} imported • ${importResultsSummary.skipped} skipped • ${importResultsSummary.failed} failed${
              importResultsSummary.foldersRestored > 0
                ? ` • ${importResultsSummary.foldersRestored} folders restored`
                : ''
            }`,
          }),
        ])
      );

      if (importResultsSummary.items.length > 0) {
        const logList = el('div', { className: 'wh-log-list' });
        for (const item of importResultsSummary.items) {
          const statusClass =
            item.status === 'imported'
              ? 'wh-status-ok'
              : item.status === 'skipped'
                ? 'wh-status-skip'
                : 'wh-status-err';
          logList.appendChild(
            el('div', { className: 'wh-log-item' }, [
              el('span', {
                style: { fontWeight: '500', overflow: 'hidden', textOverflow: 'ellipsis' },
                text: item.name,
              }),
              el('span', {
                className: statusClass,
                text: item.detail || item.status,
              }),
            ])
          );
        }
        summaryPanel.appendChild(logList);
      }

      container.appendChild(summaryPanel);
    }

    return container;
  }

  function render(): void {
    progressLabelEl = null;
    progressSubLabelEl = null;
    progressFillEl = null;
    progressPctEl = null;
    charListContainerEl = null;
    charListPagerEl = null;
    selectionSummaryEl = null;
    exportButtonEl = null;

    const activeRoot = activeModal ? modalRoot : drawerRoot;
    drawerRoot.innerHTML = '';
    modalRoot.innerHTML = '';

    if (activeModal) {
      activeModal.setTitle(
        `Warehouse — Batch Character ${
          activeMode === 'export' ? 'Export' : 'Import'
        } (${characters.length.toLocaleString()} cards)`
      );

      // Render a compact status card inside the sidebar drawer while the modal is open
      drawerRoot.appendChild(
        el('div', { className: 'wh-panel wh-modal-placeholder' }, [
          el('div', {
            className: 'wh-panel-title',
            text: 'Warehouse is open in Modal View',
          }),
          el('div', {
            className: 'wh-panel-subtitle',
            text: 'Using wide multi-column layout for large character libraries.',
          }),
          el('button', {
            className: 'wh-secondary-btn',
            text: 'Switch Back to Sidebar View',
            attrs: { type: 'button' },
            on: {
              click: () => {
                closeWarehouseModal();
              },
            },
          }),
        ])
      );
    }

    // Mode Switcher Bar + Modal / Sidebar Toggle Button
    const modeBar = el('div', { className: 'wh-mode-bar' }, [
      el('button', {
        className: `wh-mode-btn${activeMode === 'export' ? ' is-active' : ''}`,
        text: 'Batch Export (.ZIP)',
        attrs: { type: 'button' },
        on: {
          click: () => {
            if (activeMode !== 'export') {
              activeMode = 'export';
              render();
            }
          },
        },
      }),
      el('button', {
        className: `wh-mode-btn${activeMode === 'import' ? ' is-active' : ''}`,
        text: 'Batch Import (.ZIP)',
        attrs: { type: 'button' },
        on: {
          click: () => {
            if (activeMode !== 'import') {
              activeMode = 'import';
              render();
            }
          },
        },
      }),
    ]);

    const surfaceToggleBtn = el('button', {
      className: 'wh-surface-btn',
      text: activeModal ? 'Dock to Sidebar' : 'Pop Out Modal ⤢',
      attrs: {
        type: 'button',
        title: activeModal
          ? 'Close modal and return to the sidebar drawer'
          : 'Open Warehouse in a large multi-column modal window',
      },
      on: {
        click: () => {
          if (activeModal) {
            closeWarehouseModal();
          } else {
            openWarehouseModal(activeMode);
          }
        },
      },
    });

    const topBarWrap = el('div', { className: 'wh-mode-bar-wrap' }, [
      modeBar,
      surfaceToggleBtn,
    ]);

    activeRoot.appendChild(topBarWrap);

    if (activeMode === 'export') {
      activeRoot.appendChild(renderExportView());
    } else {
      activeRoot.appendChild(renderImportView());
    }
  }

  // Handle messages from the backend
  ctx.onBackendMessage((rawData: unknown) => {
    if (!rawData || typeof rawData !== 'object') return;
    const msg = rawData as BackendToFrontendMessage;

    switch (msg.type) {
      case 'preferences_loaded': {
        preferences = { ...preferences, ...msg.preferences };
        render();
        break;
      }

      case 'open_tab': {
        activeMode = msg.mode === 'import' ? 'import' : 'export';
        const targetSurface = msg.surface || preferences.defaultSurface || 'modal';
        if (targetSurface === 'modal') {
          openWarehouseModal(activeMode);
        } else {
          if (activeModal) {
            closeWarehouseModal();
          }
          tab.activate();
          render();
        }
        break;
      }

      case 'archive_ready': {
        const pending = pendingAssemblies.get(msg.jobId);
        if (pending) {
          pendingAssemblies.delete(msg.jobId);
          pending.resolve({
            fileId: msg.fileId,
            fileName: msg.fileName,
            size: msg.size,
          });
        }
        break;
      }

      case 'archive_error': {
        const pending = pendingAssemblies.get(msg.jobId);
        if (pending) {
          pendingAssemblies.delete(msg.jobId);
          pending.reject(new Error(msg.error || 'Archive creation failed'));
        }
        break;
      }
    }
  });

  // Initial render & fetch preferences + character library
  render();
  sendToBackend({ type: 'load_preferences' });
  loadCharacterLibrary();
}
