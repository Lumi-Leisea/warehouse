import type { CharacterExportFormat, WarehouseBundleManifest } from './types'

// ── CRC-32 Lookup Table ─────────────────────────────────────────────────────

const CRC_TABLE = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  }
  CRC_TABLE[n] = c >>> 0
}

export function crc32Update(crc: number, chunk: Uint8Array): number {
  let c = crc ^ 0xffffffff
  for (let i = 0; i < chunk.byteLength; i++) {
    c = CRC_TABLE[(c ^ chunk[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

export async function crc32FromBlob(blob: Blob): Promise<number> {
  let crc = 0
  const reader = blob.stream().getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) crc = crc32Update(crc, value)
    }
  } finally {
    reader.releaseLock()
  }
  return crc >>> 0
}

// ── DOS Date/Time Encoding ──────────────────────────────────────────────────

function toDosDateTime(date = new Date()): { dosTime: number; dosDate: number } {
  const year = Math.max(1980, date.getFullYear())
  const month = date.getMonth() + 1
  const day = date.getDate()
  const hours = date.getHours()
  const minutes = date.getMinutes()
  const seconds = Math.floor(date.getSeconds() / 2)

  const dosTime = ((hours & 0x1f) << 11) | ((minutes & 0x3f) << 5) | (seconds & 0x1f)
  const dosDate = (((year - 1980) & 0x7f) << 9) | ((month & 0x0f) << 5) | (day & 0x1f)
  return { dosTime, dosDate }
}

// ── DEFLATE Helpers (Web CompressionStream / DecompressionStream) ───────────

async function deflateRawBlob(input: Blob): Promise<Blob | null> {
  if (typeof CompressionStream === 'undefined') return null
  try {
    const cs = new CompressionStream('deflate-raw')
    const compressedStream = input.stream().pipeThrough(cs)
    return await new Response(compressedStream).blob()
  } catch {
    return null
  }
}

async function inflateRawBlob(input: Blob): Promise<Blob> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser does not support DecompressionStream("deflate-raw")')
  }
  const ds = new DecompressionStream('deflate-raw')
  const decompressedStream = input.stream().pipeThrough(ds)
  return await new Response(decompressedStream).blob()
}

// ── Streaming Browser ZIP / ZIP64 Builder ───────────────────────────────────

const ZIP32_MAX_VALUE = 0xffffffff
const ZIP32_MAX_ENTRIES = 0xffff
const UTF8_FLAG = 0x0800

interface BuilderEntryRecord {
  nameBytes: Uint8Array
  method: 0 | 8
  crc32: number
  compressedSize: number
  uncompressedSize: number
  localHeaderOffset: number
  dosTime: number
  dosDate: number
  usesZip64Local: boolean
}

/**
 * Assembles a standard ZIP or ZIP64 archive as a composite `Blob` without
 * concatenating entry payloads in JavaScript RAM. Each added `Blob` stays as
 * a browser-managed `BlobPart` reference alongside small header `Uint8Array`s.
 */
export class BrowserZipBuilder {
  private parts: BlobPart[] = []
  private entries: BuilderEntryRecord[] = []
  private offset = 0
  private encoder = new TextEncoder()

  /**
   * Add a file to the ZIP archive.
   * @param archivePath Forward-slash relative path inside the archive
   * @param data Blob or Uint8Array payload
   * @param options.store When true, stores uncompressed (method 0) — ideal for .png and .charx
   */
  async addFile(
    archivePath: string,
    data: Blob | Uint8Array,
    options: { store?: boolean } = {},
  ): Promise<void> {
    const cleanPath = archivePath.replace(/^\/+/, '').replace(/\\/g, '/')
    const nameBytes = this.encoder.encode(cleanPath)
    const rawBlob = data instanceof Blob ? data : new Blob([data])
    const uncompressedSize = rawBlob.size
    const crc32 = data instanceof Uint8Array ? crc32Update(0, data) : await crc32FromBlob(rawBlob)

    let method: 0 | 8 = 0
    let payloadBlob = rawBlob

    if (!options.store && uncompressedSize > 64) {
      const deflated = await deflateRawBlob(rawBlob)
      if (deflated && deflated.size < uncompressedSize) {
        method = 8
        payloadBlob = deflated
      }
    }

    const compressedSize = payloadBlob.size
    const localHeaderOffset = this.offset
    const { dosTime, dosDate } = toDosDateTime()

    const usesZip64Local =
      uncompressedSize >= ZIP32_MAX_VALUE || compressedSize >= ZIP32_MAX_VALUE

    const localExtra = usesZip64Local ? new Uint8Array(20) : new Uint8Array(0)
    if (usesZip64Local) {
      const ev = new DataView(localExtra.buffer)
      ev.setUint16(0, 0x0001, true) // ZIP64 extra field tag
      ev.setUint16(2, 16, true) // 16 bytes (uncompressed + compressed 64-bit sizes)
      ev.setBigUint64(4, BigInt(uncompressedSize), true)
      ev.setBigUint64(12, BigInt(compressedSize), true)
    }

    const localHeader = new Uint8Array(30 + nameBytes.byteLength + localExtra.byteLength)
    const lv = new DataView(localHeader.buffer)
    lv.setUint32(0, 0x04034b50, true) // Local file header signature
    lv.setUint16(4, usesZip64Local ? 45 : 20, true) // Version needed (4.5 for ZIP64, 2.0 otherwise)
    lv.setUint16(6, UTF8_FLAG, true) // General purpose bit flag (UTF-8)
    lv.setUint16(8, method, true) // Compression method
    lv.setUint16(10, dosTime, true)
    lv.setUint16(12, dosDate, true)
    lv.setUint32(14, crc32, true)
    lv.setUint32(18, usesZip64Local ? ZIP32_MAX_VALUE : compressedSize, true)
    lv.setUint32(22, usesZip64Local ? ZIP32_MAX_VALUE : uncompressedSize, true)
    lv.setUint16(26, nameBytes.byteLength, true)
    lv.setUint16(28, localExtra.byteLength, true)
    localHeader.set(nameBytes, 30)
    if (localExtra.byteLength > 0) {
      localHeader.set(localExtra, 30 + nameBytes.byteLength)
    }

    this.parts.push(localHeader, payloadBlob)
    this.offset += localHeader.byteLength + compressedSize

    this.entries.push({
      nameBytes,
      method,
      crc32,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      dosTime,
      dosDate,
      usesZip64Local,
    })
  }

  /**
   * Finalize the Central Directory (and ZIP64 trailers if needed) and return a
   * composite `Blob` ready for download.
   */
  finalize(): Blob {
    const cdOffset = this.offset
    let cdSize = 0
    let needsZip64 =
      this.entries.length >= ZIP32_MAX_ENTRIES || cdOffset >= ZIP32_MAX_VALUE

    for (const entry of this.entries) {
      const needUncomp64 = entry.uncompressedSize >= ZIP32_MAX_VALUE
      const needComp64 = entry.compressedSize >= ZIP32_MAX_VALUE
      const needOffset64 = entry.localHeaderOffset >= ZIP32_MAX_VALUE
      const extraDataLen =
        (needUncomp64 ? 8 : 0) + (needComp64 ? 8 : 0) + (needOffset64 ? 8 : 0)
      const cdExtra = extraDataLen > 0 ? new Uint8Array(4 + extraDataLen) : new Uint8Array(0)

      if (extraDataLen > 0) {
        needsZip64 = true
        const ev = new DataView(cdExtra.buffer)
        ev.setUint16(0, 0x0001, true)
        ev.setUint16(2, extraDataLen, true)
        let pos = 4
        if (needUncomp64) {
          ev.setBigUint64(pos, BigInt(entry.uncompressedSize), true)
          pos += 8
        }
        if (needComp64) {
          ev.setBigUint64(pos, BigInt(entry.compressedSize), true)
          pos += 8
        }
        if (needOffset64) {
          ev.setBigUint64(pos, BigInt(entry.localHeaderOffset), true)
        }
      }

      const cdHeader = new Uint8Array(46 + entry.nameBytes.byteLength + cdExtra.byteLength)
      const cv = new DataView(cdHeader.buffer)
      const versionNeeded = extraDataLen > 0 || entry.usesZip64Local ? 45 : 20
      cv.setUint32(0, 0x02014b50, true) // Central directory file header signature
      cv.setUint16(4, 45, true) // Version made by
      cv.setUint16(6, versionNeeded, true)
      cv.setUint16(8, UTF8_FLAG, true)
      cv.setUint16(10, entry.method, true)
      cv.setUint16(12, entry.dosTime, true)
      cv.setUint16(14, entry.dosDate, true)
      cv.setUint32(16, entry.crc32, true)
      cv.setUint32(20, needComp64 ? ZIP32_MAX_VALUE : entry.compressedSize, true)
      cv.setUint32(24, needUncomp64 ? ZIP32_MAX_VALUE : entry.uncompressedSize, true)
      cv.setUint16(28, entry.nameBytes.byteLength, true)
      cv.setUint16(30, cdExtra.byteLength, true)
      cv.setUint16(32, 0, true) // File comment length
      cv.setUint16(34, 0, true) // Disk number start
      cv.setUint16(36, 0, true) // Internal file attributes
      cv.setUint32(38, 0, true) // External file attributes
      cv.setUint32(42, needOffset64 ? ZIP32_MAX_VALUE : entry.localHeaderOffset, true)
      cdHeader.set(entry.nameBytes, 46)
      if (cdExtra.byteLength > 0) {
        cdHeader.set(cdExtra, 46 + entry.nameBytes.byteLength)
      }

      this.parts.push(cdHeader)
      cdSize += cdHeader.byteLength
    }

    if (cdSize >= ZIP32_MAX_VALUE) {
      needsZip64 = true
    }

    const zip64EocdOffset = cdOffset + cdSize

    if (needsZip64) {
      // ZIP64 End of Central Directory Record (56 bytes)
      const zip64Eocd = new Uint8Array(56)
      const zv = new DataView(zip64Eocd.buffer)
      zv.setUint32(0, 0x06064b50, true)
      zv.setBigUint64(4, 44n, true) // Size of remaining record
      zv.setUint16(12, 45, true) // Version made by
      zv.setUint16(14, 45, true) // Version needed
      zv.setUint32(16, 0, true) // Number of this disk
      zv.setUint32(20, 0, true) // Disk with start of CD
      zv.setBigUint64(24, BigInt(this.entries.length), true)
      zv.setBigUint64(32, BigInt(this.entries.length), true)
      zv.setBigUint64(40, BigInt(cdSize), true)
      zv.setBigUint64(48, BigInt(cdOffset), true)

      // ZIP64 End of Central Directory Locator (20 bytes)
      const zip64Locator = new Uint8Array(20)
      const lv = new DataView(zip64Locator.buffer)
      lv.setUint32(0, 0x07064b50, true)
      lv.setUint32(4, 0, true) // Disk with start of ZIP64 EOCD
      lv.setBigUint64(8, BigInt(zip64EocdOffset), true)
      lv.setUint32(16, 1, true) // Total number of disks

      this.parts.push(zip64Eocd, zip64Locator)
    }

    // Standard End of Central Directory Record (22 bytes)
    const eocd = new Uint8Array(22)
    const ev = new DataView(eocd.buffer)
    ev.setUint32(0, 0x06054b50, true)
    ev.setUint16(4, 0, true)
    ev.setUint16(6, 0, true)
    ev.setUint16(8, Math.min(this.entries.length, ZIP32_MAX_ENTRIES), true)
    ev.setUint16(10, Math.min(this.entries.length, ZIP32_MAX_ENTRIES), true)
    ev.setUint32(12, Math.min(cdSize, ZIP32_MAX_VALUE), true)
    ev.setUint32(16, Math.min(cdOffset, ZIP32_MAX_VALUE), true)
    ev.setUint16(20, 0, true)

    this.parts.push(eocd)
    return new Blob(this.parts, { type: 'application/zip' })
  }
}

// ── Random-Access Browser ZIP / ZIP64 Reader ────────────────────────────────

export interface ParsedZipCardEntry {
  /** Full path inside the ZIP archive (e.g. "Fantasy/Alice.charx"). */
  archivePath: string
  /** Base filename (e.g. "Alice.charx"). */
  baseName: string
  /** Inferred or manifest-backed folder name ("" if root). */
  folder: string
  /** Character card format detected from extension. */
  format: CharacterExportFormat
  /** MIME type for File construction. */
  mimeType: string
  /** ZIP compression method (0 = STORE, 8 = DEFLATE). */
  compressionMethod: number
  compressedSize: number
  uncompressedSize: number
  localHeaderOffset: number
}

export interface InspectedZipArchive {
  entries: ParsedZipCardEntry[]
  manifest: WarehouseBundleManifest | null
}

function isIgnoredArchivePath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/')
  if (normalized.endsWith('/')) return true
  const segments = normalized.split('/').filter(Boolean)
  if (segments.length === 0) return true
  if (segments.some((seg) => seg === '__MACOSX' || seg.startsWith('.'))) return true
  const base = segments[segments.length - 1].toLowerCase()
  if (base === 'thumbs.db' || base === 'desktop.ini' || base === '.ds_store') return true
  return false
}

function detectCardFormatFromFilename(fileName: string): {
  format: CharacterExportFormat
  mimeType: string
} | null {
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.charx')) {
    return { format: 'charx', mimeType: 'application/zip' }
  }
  if (lower.endsWith('.png')) {
    return { format: 'png', mimeType: 'image/png' }
  }
  if (lower.endsWith('.json')) {
    if (lower === 'warehouse-manifest.json' || lower === 'manifest.json') return null
    return { format: 'json', mimeType: 'application/json' }
  }
  return null
}

interface RawCentralDirectoryEntry {
  archivePath: string
  compressionMethod: number
  compressedSize: number
  uncompressedSize: number
  localHeaderOffset: number
}

/**
 * Reads only the ZIP Central Directory from the end of a `File` without loading
 * the entire archive into memory. Supports both standard ZIP and ZIP64.
 */
export async function inspectZipArchive(file: File): Promise<InspectedZipArchive> {
  const tailLength = Math.min(file.size, 65558 + 128)
  const tailStart = file.size - tailLength
  const tailBuf = await file.slice(tailStart, file.size).arrayBuffer()
  const tailView = new DataView(tailBuf)

  let eocdPos = -1
  for (let i = tailBuf.byteLength - 22; i >= 0; i--) {
    if (tailView.getUint32(i, true) === 0x06054b50) {
      eocdPos = i
      break
    }
  }
  if (eocdPos === -1) {
    throw new Error('Not a valid .zip archive (End of Central Directory record not found)')
  }

  let cdSize = tailView.getUint32(eocdPos + 12, true)
  let cdOffset = tailView.getUint32(eocdPos + 16, true)

  // Check for ZIP64 End of Central Directory Locator (20 bytes immediately before EOCD)
  if (eocdPos >= 20 && tailView.getUint32(eocdPos - 20, true) === 0x07064b50) {
    const zip64EocdOffset = Number(tailView.getBigUint64(eocdPos - 20 + 8, true))
    const z64Buf = await file.slice(zip64EocdOffset, zip64EocdOffset + 56).arrayBuffer()
    if (z64Buf.byteLength >= 56) {
      const z64View = new DataView(z64Buf)
      if (z64View.getUint32(0, true) === 0x06064b50) {
        cdSize = Number(z64View.getBigUint64(40, true))
        cdOffset = Number(z64View.getBigUint64(48, true))
      }
    }
  }

  if (cdOffset < 0 || cdOffset + cdSize > file.size) {
    throw new Error('Corrupted .zip archive (Central Directory bounds exceed file size)')
  }

  const cdBuf = await file.slice(cdOffset, cdOffset + cdSize).arrayBuffer()
  const cdView = new DataView(cdBuf)
  const cdBytes = new Uint8Array(cdBuf)
  const decoder = new TextDecoder('utf-8')

  const rawEntries: RawCentralDirectoryEntry[] = []
  let pos = 0

  while (pos + 46 <= cdBuf.byteLength) {
    const sig = cdView.getUint32(pos, true)
    if (sig !== 0x02014b50) break

    const compressionMethod = cdView.getUint16(pos + 10, true)
    let compressedSize = cdView.getUint32(pos + 20, true)
    let uncompressedSize = cdView.getUint32(pos + 24, true)
    const nameLen = cdView.getUint16(pos + 28, true)
    const extraLen = cdView.getUint16(pos + 30, true)
    const commentLen = cdView.getUint16(pos + 32, true)
    let localHeaderOffset = cdView.getUint32(pos + 42, true)

    const nameStart = pos + 46
    const extraStart = nameStart + nameLen
    const entryEnd = extraStart + extraLen + commentLen
    if (entryEnd > cdBuf.byteLength) break

    const archivePath = decoder.decode(cdBytes.subarray(nameStart, extraStart)).replace(/\\/g, '/')

    // Parse ZIP64 Extended Information Extra Field (0x0001) if any 32-bit field is 0xFFFFFFFF
    if (
      extraLen >= 4 &&
      (uncompressedSize === ZIP32_MAX_VALUE ||
        compressedSize === ZIP32_MAX_VALUE ||
        localHeaderOffset === ZIP32_MAX_VALUE)
    ) {
      let ePos = extraStart
      const eEnd = extraStart + extraLen
      while (ePos + 4 <= eEnd) {
        const headerId = cdView.getUint16(ePos, true)
        const dataSize = cdView.getUint16(ePos + 2, true)
        let fieldCursor = ePos + 4
        if (headerId === 0x0001) {
          if (uncompressedSize === ZIP32_MAX_VALUE && fieldCursor + 8 <= ePos + 4 + dataSize) {
            uncompressedSize = Number(cdView.getBigUint64(fieldCursor, true))
            fieldCursor += 8
          }
          if (compressedSize === ZIP32_MAX_VALUE && fieldCursor + 8 <= ePos + 4 + dataSize) {
            compressedSize = Number(cdView.getBigUint64(fieldCursor, true))
            fieldCursor += 8
          }
          if (localHeaderOffset === ZIP32_MAX_VALUE && fieldCursor + 8 <= ePos + 4 + dataSize) {
            localHeaderOffset = Number(cdView.getBigUint64(fieldCursor, true))
            fieldCursor += 8
          }
          break
        }
        ePos += 4 + dataSize
      }
    }

    rawEntries.push({
      archivePath,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    })

    pos = entryEnd
  }

  // Check if warehouse-manifest.json is present
  let manifest: WarehouseBundleManifest | null = null
  const manifestRaw = rawEntries.find(
    (e) =>
      e.archivePath === 'warehouse-manifest.json' ||
      e.archivePath.endsWith('/warehouse-manifest.json'),
  )
  if (manifestRaw && manifestRaw.uncompressedSize <= 16 * 1024 * 1024) {
    try {
      const manifestBlob = await extractRawZipEntryBlob(file, manifestRaw, 'application/json')
      const text = await manifestBlob.text()
      const parsed = JSON.parse(text)
      if (parsed && parsed.schema === 'lumiverse.warehouse.bundle' && Array.isArray(parsed.entries)) {
        manifest = parsed as WarehouseBundleManifest
      }
    } catch {
      // Ignore malformed manifest and fall back to path inspection
    }
  }

  const manifestFolderByPath = new Map<string, string>()
  if (manifest) {
    for (const item of manifest.entries) {
      if (typeof item.archivePath === 'string' && typeof item.folder === 'string') {
        manifestFolderByPath.set(item.archivePath.replace(/\\/g, '/'), item.folder)
      }
    }
  }

  // If the archive was zipped manually with a single outer root directory
  // (e.g. "MyBackup/Fantasy/Alice.charx"), detect whether all card entries share a common root prefix.
  const candidateEntries = rawEntries.filter((e) => {
    if (isIgnoredArchivePath(e.archivePath)) return false
    const segments = e.archivePath.split('/').filter(Boolean)
    const baseName = segments[segments.length - 1] || ''
    return detectCardFormatFromFilename(baseName) !== null
  })

  let sharedRootPrefix = ''
  if (!manifest && candidateEntries.length > 1) {
    const firstSegments = candidateEntries[0].archivePath.split('/').filter(Boolean)
    if (firstSegments.length >= 2) {
      const candidateRoot = firstSegments[0]
      const allShareRoot = candidateEntries.every((e) => {
        const segs = e.archivePath.split('/').filter(Boolean)
        return segs.length >= 2 && segs[0] === candidateRoot
      })
      // Only strip the outer root if at least one entry has a deeper folder OR all files are inside one wrapper dir
      const anyDeeperFolder = candidateEntries.some(
        (e) => e.archivePath.split('/').filter(Boolean).length >= 3,
      )
      if (allShareRoot && anyDeeperFolder) {
        sharedRootPrefix = `${candidateRoot}/`
      }
    }
  }

  const entries: ParsedZipCardEntry[] = []
  for (const raw of candidateEntries) {
    const segments = raw.archivePath.split('/').filter(Boolean)
    const baseName = segments[segments.length - 1]
    const detected = detectCardFormatFromFilename(baseName)
    if (!detected) continue

    let folder = ''
    if (manifestFolderByPath.has(raw.archivePath)) {
      folder = manifestFolderByPath.get(raw.archivePath) || ''
    } else {
      const relativePath =
        sharedRootPrefix && raw.archivePath.startsWith(sharedRootPrefix)
          ? raw.archivePath.slice(sharedRootPrefix.length)
          : raw.archivePath
      const relSegments = relativePath.split('/').filter(Boolean)
      if (relSegments.length >= 2) {
        folder = relSegments[relSegments.length - 2]
      }
    }

    entries.push({
      archivePath: raw.archivePath,
      baseName,
      folder,
      format: detected.format,
      mimeType: detected.mimeType,
      compressionMethod: raw.compressionMethod,
      compressedSize: raw.compressedSize,
      uncompressedSize: raw.uncompressedSize,
      localHeaderOffset: raw.localHeaderOffset,
    })
  }

  return { entries, manifest }
}

async function extractRawZipEntryBlob(
  zipFile: File,
  entry: RawCentralDirectoryEntry,
  mimeType: string,
): Promise<Blob> {
  const localHeaderBuf = await zipFile
    .slice(entry.localHeaderOffset, entry.localHeaderOffset + 30)
    .arrayBuffer()
  if (localHeaderBuf.byteLength < 30) {
    throw new Error(`Truncated local header for "${entry.archivePath}"`)
  }
  const lv = new DataView(localHeaderBuf)
  if (lv.getUint32(0, true) !== 0x04034b50) {
    throw new Error(`Invalid local header signature for "${entry.archivePath}"`)
  }
  const nameLen = lv.getUint16(26, true)
  const extraLen = lv.getUint16(28, true)
  const dataStart = entry.localHeaderOffset + 30 + nameLen + extraLen
  const dataEnd = dataStart + entry.compressedSize

  if (dataEnd > zipFile.size) {
    throw new Error(`Archive entry "${entry.archivePath}" extends past end of file`)
  }

  const rawSlice = zipFile.slice(dataStart, dataEnd, mimeType)

  if (entry.compressionMethod === 0) {
    // Stored (uncompressed) — zero-copy slice!
    return rawSlice
  }
  if (entry.compressionMethod === 8) {
    // Deflated — stream through DecompressionStream('deflate-raw')
    const inflated = await inflateRawBlob(rawSlice)
    return new Blob([inflated], { type: mimeType })
  }

  throw new Error(
    `Unsupported ZIP compression method (${entry.compressionMethod}) on "${entry.archivePath}". Only STORE (0) and DEFLATE (8) are supported.`,
  )
}

/**
 * Extracts a single character card from the ZIP archive as a `File` ready to be
 * uploaded to `/api/v1/characters/import-jobs`.
 */
export async function extractZipEntryAsFile(
  zipFile: File,
  entry: ParsedZipCardEntry,
): Promise<File> {
  const blob = await extractRawZipEntryBlob(zipFile, entry, entry.mimeType)
  return new File([blob], entry.baseName, { type: entry.mimeType })
}

export function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb.toFixed(2)} MB`
  const gb = mb / 1024
  return `${gb.toFixed(2)} GB`
}

export function sanitizeFilenameComponent(input: string, fallback = 'character'): string {
  const cleaned = (input || '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '')
  return cleaned || fallback
}

