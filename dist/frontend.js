// src/search.ts
function isWhitespace(ch) {
  return ch === " " || ch === "\t" || ch === `
` || ch === "\r";
}
function scanTokens(input, groupStart, groupEnd) {
  const out = [];
  let i = groupStart;
  while (i < groupEnd) {
    while (i < groupEnd && isWhitespace(input[i]))
      i++;
    if (i >= groupEnd)
      break;
    const start = i;
    let inQuotes = false;
    while (i < groupEnd) {
      const ch = input[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
        i++;
        continue;
      }
      if (!inQuotes && isWhitespace(ch)) {
        break;
      }
      i++;
    }
    out.push({ text: input.slice(start, i), offset: start });
  }
  return out;
}
function stripOuterQuotes(val) {
  const trimmed = val.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}
var PREFIX_MAP = {
  t: "tag",
  c: "char",
  f: "folder",
  a: "author"
};
var PREFIX_EXAMPLE_MAP = {
  T: "T:Elf",
  C: "C:John",
  F: "F:Fantasy",
  A: "A:Eleisea"
};
function parseSingleToken(token) {
  const { text, offset } = token;
  let cursor = 0;
  let negated = false;
  if (text.startsWith("-")) {
    negated = true;
    cursor = 1;
  }
  const body = text.slice(cursor);
  if (body.length === 0) {
    return {
      offset,
      length: text.length,
      message: "Dangling `-` — put a term after it, like `-T:Dark` or `-F:Archive`."
    };
  }
  if (body.length >= 2 && body[1] === ":") {
    const prefixChar = body[0];
    const mappedField = PREFIX_MAP[prefixChar.toLowerCase()];
    if (mappedField) {
      const rawValue = stripOuterQuotes(body.slice(2));
      if (rawValue.length === 0) {
        const canonical = prefixChar.toUpperCase();
        const example = PREFIX_EXAMPLE_MAP[canonical] || `${canonical}:value`;
        return {
          offset,
          length: text.length,
          message: `\`${canonical}:\` requires a value — try \`${example}\`.`
        };
      }
      return {
        field: mappedField,
        value: rawValue.toLowerCase(),
        negated
      };
    }
  }
  const cleanedBare = stripOuterQuotes(body);
  if (cleanedBare.length === 0) {
    return {
      offset,
      length: text.length,
      message: "Empty quoted search term — enter text inside quotes."
    };
  }
  return {
    field: "name",
    value: cleanedBare.toLowerCase(),
    negated
  };
}
function splitGroupsRespectingQuotes(input) {
  const spans = [];
  let groupStart = 0;
  let inQuotes = false;
  for (let i = 0;i <= input.length; i++) {
    const ch = i < input.length ? input[i] : ",";
    if (ch === '"' && i < input.length) {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === "," && !inQuotes) {
      spans.push({ start: groupStart, end: i });
      groupStart = i + 1;
    }
  }
  return spans;
}
function parseQuery(rawInput) {
  const raw = typeof rawInput === "string" ? rawInput : "";
  const groups = [];
  const errors = [];
  const groupSpans = splitGroupsRespectingQuotes(raw);
  for (const span of groupSpans) {
    const tokens = scanTokens(raw, span.start, span.end);
    if (tokens.length === 0)
      continue;
    const terms = [];
    for (const tok of tokens) {
      const parsed = parseSingleToken(tok);
      if ("message" in parsed) {
        errors.push(parsed);
      } else {
        terms.push(parsed);
      }
    }
    if (terms.length > 0) {
      groups.push({ terms });
    }
  }
  const ok = errors.length === 0;
  const isEmpty = ok && groups.length === 0;
  return { raw, groups, errors, ok, isEmpty };
}
function buildCharacterMatchContext(char) {
  const tagKeys = new Set;
  if (Array.isArray(char.tags)) {
    for (const t of char.tags) {
      if (typeof t === "string") {
        const cleaned = t.trim().toLowerCase();
        if (cleaned)
          tagKeys.add(cleaned);
      }
    }
  }
  return {
    nameLower: (char.name || "").toLowerCase(),
    creatorLower: (char.creator || "").toLowerCase(),
    folderLower: (char.folder || "").trim().toLowerCase(),
    tagKeys
  };
}
function evalPositiveTerm(term, ctx) {
  switch (term.field) {
    case "name":
    case "char":
      return ctx.nameLower.includes(term.value);
    case "tag":
      return ctx.tagKeys.has(term.value);
    case "folder":
      if (term.value === "unfiled" || term.value === "none") {
        return ctx.folderLower === "" || ctx.folderLower.includes(term.value);
      }
      return ctx.folderLower.includes(term.value);
    case "author":
      return ctx.creatorLower.includes(term.value);
  }
}
function evalGroup(group, ctx) {
  for (const term of group.terms) {
    const hit = evalPositiveTerm(term, ctx);
    if (term.negated ? hit : !hit)
      return false;
  }
  return true;
}
function evaluateCharacterQuery(query, ctx) {
  if (query.groups.length === 0)
    return true;
  for (const group of query.groups) {
    if (evalGroup(group, ctx))
      return true;
  }
  return false;
}
function getWarehouseSearchHelpSections() {
  return [
    {
      heading: "Prefixes",
      examples: [
        {
          syntax: "Elf",
          meaning: "No prefix searches character names, matching any part of the name."
        },
        {
          syntax: "T:Elf",
          meaning: "Tag name search. Matches the whole tag name, so T:Elf does not match a tag called ElfKing."
        },
        {
          syntax: "C:John",
          meaning: "Character name search (explicit prefix). Matches any part of the character name."
        },
        {
          syntax: "F:Fantasy",
          meaning: "Folder search. Matches characters in a folder matching Fantasy (use F:unfiled for characters without a folder)."
        },
        {
          syntax: "A:Eleisea",
          meaning: "Author / Creator search. Matches any part of the character creator field."
        }
      ]
    },
    {
      heading: "Combining terms",
      examples: [
        {
          syntax: "T:Elf T:Magic",
          meaning: "Spaces mean AND — the character needs both tags."
        },
        {
          syntax: "F:Fantasy A:Eleisea",
          meaning: "Combines prefixes with AND — in folder Fantasy AND created by Eleisea."
        },
        {
          syntax: "T:Elf, T:Magic",
          meaning: "Commas mean OR — the character needs either tag."
        },
        {
          syntax: "C:John, F:Sci-Fi T:Mecha",
          meaning: "Mixes both: this reads as (C:John) OR (F:Sci-Fi AND T:Mecha)."
        }
      ]
    },
    {
      heading: "Excluding results",
      examples: [
        {
          syntax: "-T:Dark",
          meaning: "Put - in front of a term to exclude matches. Negation applies to the whole term."
        },
        {
          syntax: "F:Fantasy -A:Anon",
          meaning: "Characters in the Fantasy folder whose creator does not match Anon."
        },
        {
          syntax: "T:Elf -T:Dark",
          meaning: "Characters tagged Elf but not Dark."
        }
      ]
    },
    {
      heading: "Good to know",
      examples: [
        {
          syntax: "elf",
          meaning: "Matching ignores case for both prefixes and values, so T:elf, f:FANTASY, and a:eleisea all work."
        },
        {
          syntax: 'F:"My Folder"',
          meaning: 'Wrap values containing spaces in double quotes, such as F:"My Folder", A:"Jane Doe", or T:"Slice of Life".'
        },
        {
          syntax: "(empty search box)",
          meaning: "A blank search returns every character rather than no results."
        }
      ]
    }
  ];
}

// src/types.ts
var DEFAULT_PREFERENCES = {
  exportFormat: "charx",
  organizeByFolder: true,
  includeManifest: true,
  packagingMode: "browser",
  concurrency: 3,
  skipDuplicates: false,
  restoreFolders: true,
  defaultSurface: "modal"
};

// src/zip.ts
var CRC_TABLE = new Uint32Array(256);
for (let n = 0;n < 256; n++) {
  let c = n;
  for (let k = 0;k < 8; k++) {
    c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
  }
  CRC_TABLE[n] = c >>> 0;
}
function crc32Update(crc, chunk) {
  let c = crc ^ 4294967295;
  for (let i = 0;i < chunk.byteLength; i++) {
    c = CRC_TABLE[(c ^ chunk[i]) & 255] ^ c >>> 8;
  }
  return (c ^ 4294967295) >>> 0;
}
async function crc32FromBlob(blob) {
  let crc = 0;
  const reader = blob.stream().getReader();
  try {
    for (;; ) {
      const { done, value } = await reader.read();
      if (done)
        break;
      if (value)
        crc = crc32Update(crc, value);
    }
  } finally {
    reader.releaseLock();
  }
  return crc >>> 0;
}
function toDosDateTime(date = new Date) {
  const year = Math.max(1980, date.getFullYear());
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = Math.floor(date.getSeconds() / 2);
  const dosTime = (hours & 31) << 11 | (minutes & 63) << 5 | seconds & 31;
  const dosDate = (year - 1980 & 127) << 9 | (month & 15) << 5 | day & 31;
  return { dosTime, dosDate };
}
async function deflateRawBlob(input) {
  if (typeof CompressionStream === "undefined")
    return null;
  try {
    const cs = new CompressionStream("deflate-raw");
    const compressedStream = input.stream().pipeThrough(cs);
    return await new Response(compressedStream).blob();
  } catch {
    return null;
  }
}
async function inflateRawBlob(input) {
  if (typeof DecompressionStream === "undefined") {
    throw new Error('This browser does not support DecompressionStream("deflate-raw")');
  }
  const ds = new DecompressionStream("deflate-raw");
  const decompressedStream = input.stream().pipeThrough(ds);
  return await new Response(decompressedStream).blob();
}
var ZIP32_MAX_VALUE = 4294967295;
var ZIP32_MAX_ENTRIES = 65535;
var UTF8_FLAG = 2048;

class BrowserZipBuilder {
  parts = [];
  entries = [];
  offset = 0;
  encoder = new TextEncoder;
  async addFile(archivePath, data, options = {}) {
    const cleanPath = archivePath.replace(/^\/+/, "").replace(/\\/g, "/");
    const nameBytes = this.encoder.encode(cleanPath);
    const rawBlob = data instanceof Blob ? data : new Blob([data]);
    const uncompressedSize = rawBlob.size;
    const crc32 = data instanceof Uint8Array ? crc32Update(0, data) : await crc32FromBlob(rawBlob);
    let method = 0;
    let payloadBlob = rawBlob;
    if (!options.store && uncompressedSize > 64) {
      const deflated = await deflateRawBlob(rawBlob);
      if (deflated && deflated.size < uncompressedSize) {
        method = 8;
        payloadBlob = deflated;
      }
    }
    const compressedSize = payloadBlob.size;
    const localHeaderOffset = this.offset;
    const { dosTime, dosDate } = toDosDateTime();
    const usesZip64Local = uncompressedSize >= ZIP32_MAX_VALUE || compressedSize >= ZIP32_MAX_VALUE;
    const localExtra = usesZip64Local ? new Uint8Array(20) : new Uint8Array(0);
    if (usesZip64Local) {
      const ev = new DataView(localExtra.buffer);
      ev.setUint16(0, 1, true);
      ev.setUint16(2, 16, true);
      ev.setBigUint64(4, BigInt(uncompressedSize), true);
      ev.setBigUint64(12, BigInt(compressedSize), true);
    }
    const localHeader = new Uint8Array(30 + nameBytes.byteLength + localExtra.byteLength);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 67324752, true);
    lv.setUint16(4, usesZip64Local ? 45 : 20, true);
    lv.setUint16(6, UTF8_FLAG, true);
    lv.setUint16(8, method, true);
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, crc32, true);
    lv.setUint32(18, usesZip64Local ? ZIP32_MAX_VALUE : compressedSize, true);
    lv.setUint32(22, usesZip64Local ? ZIP32_MAX_VALUE : uncompressedSize, true);
    lv.setUint16(26, nameBytes.byteLength, true);
    lv.setUint16(28, localExtra.byteLength, true);
    localHeader.set(nameBytes, 30);
    if (localExtra.byteLength > 0) {
      localHeader.set(localExtra, 30 + nameBytes.byteLength);
    }
    this.parts.push(localHeader, payloadBlob);
    this.offset += localHeader.byteLength + compressedSize;
    this.entries.push({
      nameBytes,
      method,
      crc32,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      dosTime,
      dosDate,
      usesZip64Local
    });
  }
  finalize() {
    const cdOffset = this.offset;
    let cdSize = 0;
    let needsZip64 = this.entries.length >= ZIP32_MAX_ENTRIES || cdOffset >= ZIP32_MAX_VALUE;
    for (const entry of this.entries) {
      const needUncomp64 = entry.uncompressedSize >= ZIP32_MAX_VALUE;
      const needComp64 = entry.compressedSize >= ZIP32_MAX_VALUE;
      const needOffset64 = entry.localHeaderOffset >= ZIP32_MAX_VALUE;
      const extraDataLen = (needUncomp64 ? 8 : 0) + (needComp64 ? 8 : 0) + (needOffset64 ? 8 : 0);
      const cdExtra = extraDataLen > 0 ? new Uint8Array(4 + extraDataLen) : new Uint8Array(0);
      if (extraDataLen > 0) {
        needsZip64 = true;
        const ev = new DataView(cdExtra.buffer);
        ev.setUint16(0, 1, true);
        ev.setUint16(2, extraDataLen, true);
        let pos = 4;
        if (needUncomp64) {
          ev.setBigUint64(pos, BigInt(entry.uncompressedSize), true);
          pos += 8;
        }
        if (needComp64) {
          ev.setBigUint64(pos, BigInt(entry.compressedSize), true);
          pos += 8;
        }
        if (needOffset64) {
          ev.setBigUint64(pos, BigInt(entry.localHeaderOffset), true);
        }
      }
      const cdHeader = new Uint8Array(46 + entry.nameBytes.byteLength + cdExtra.byteLength);
      const cv = new DataView(cdHeader.buffer);
      const versionNeeded = extraDataLen > 0 || entry.usesZip64Local ? 45 : 20;
      cv.setUint32(0, 33639248, true);
      cv.setUint16(4, 45, true);
      cv.setUint16(6, versionNeeded, true);
      cv.setUint16(8, UTF8_FLAG, true);
      cv.setUint16(10, entry.method, true);
      cv.setUint16(12, entry.dosTime, true);
      cv.setUint16(14, entry.dosDate, true);
      cv.setUint32(16, entry.crc32, true);
      cv.setUint32(20, needComp64 ? ZIP32_MAX_VALUE : entry.compressedSize, true);
      cv.setUint32(24, needUncomp64 ? ZIP32_MAX_VALUE : entry.uncompressedSize, true);
      cv.setUint16(28, entry.nameBytes.byteLength, true);
      cv.setUint16(30, cdExtra.byteLength, true);
      cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true);
      cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true);
      cv.setUint32(42, needOffset64 ? ZIP32_MAX_VALUE : entry.localHeaderOffset, true);
      cdHeader.set(entry.nameBytes, 46);
      if (cdExtra.byteLength > 0) {
        cdHeader.set(cdExtra, 46 + entry.nameBytes.byteLength);
      }
      this.parts.push(cdHeader);
      cdSize += cdHeader.byteLength;
    }
    if (cdSize >= ZIP32_MAX_VALUE) {
      needsZip64 = true;
    }
    const zip64EocdOffset = cdOffset + cdSize;
    if (needsZip64) {
      const zip64Eocd = new Uint8Array(56);
      const zv = new DataView(zip64Eocd.buffer);
      zv.setUint32(0, 101075792, true);
      zv.setBigUint64(4, 44n, true);
      zv.setUint16(12, 45, true);
      zv.setUint16(14, 45, true);
      zv.setUint32(16, 0, true);
      zv.setUint32(20, 0, true);
      zv.setBigUint64(24, BigInt(this.entries.length), true);
      zv.setBigUint64(32, BigInt(this.entries.length), true);
      zv.setBigUint64(40, BigInt(cdSize), true);
      zv.setBigUint64(48, BigInt(cdOffset), true);
      const zip64Locator = new Uint8Array(20);
      const lv = new DataView(zip64Locator.buffer);
      lv.setUint32(0, 117853008, true);
      lv.setUint32(4, 0, true);
      lv.setBigUint64(8, BigInt(zip64EocdOffset), true);
      lv.setUint32(16, 1, true);
      this.parts.push(zip64Eocd, zip64Locator);
    }
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 101010256, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, Math.min(this.entries.length, ZIP32_MAX_ENTRIES), true);
    ev.setUint16(10, Math.min(this.entries.length, ZIP32_MAX_ENTRIES), true);
    ev.setUint32(12, Math.min(cdSize, ZIP32_MAX_VALUE), true);
    ev.setUint32(16, Math.min(cdOffset, ZIP32_MAX_VALUE), true);
    ev.setUint16(20, 0, true);
    this.parts.push(eocd);
    return new Blob(this.parts, { type: "application/zip" });
  }
}
function isIgnoredArchivePath(path) {
  const normalized = path.replace(/\\/g, "/");
  if (normalized.endsWith("/"))
    return true;
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length === 0)
    return true;
  if (segments.some((seg) => seg === "__MACOSX" || seg.startsWith(".")))
    return true;
  const base = segments[segments.length - 1].toLowerCase();
  if (base === "thumbs.db" || base === "desktop.ini" || base === ".ds_store")
    return true;
  return false;
}
function detectCardFormatFromFilename(fileName) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".charx")) {
    return { format: "charx", mimeType: "application/zip" };
  }
  if (lower.endsWith(".png")) {
    return { format: "png", mimeType: "image/png" };
  }
  if (lower.endsWith(".json")) {
    if (lower === "warehouse-manifest.json" || lower === "manifest.json")
      return null;
    return { format: "json", mimeType: "application/json" };
  }
  return null;
}
async function inspectZipArchive(file) {
  const tailLength = Math.min(file.size, 65558 + 128);
  const tailStart = file.size - tailLength;
  const tailBuf = await file.slice(tailStart, file.size).arrayBuffer();
  const tailView = new DataView(tailBuf);
  let eocdPos = -1;
  for (let i = tailBuf.byteLength - 22;i >= 0; i--) {
    if (tailView.getUint32(i, true) === 101010256) {
      eocdPos = i;
      break;
    }
  }
  if (eocdPos === -1) {
    throw new Error("Not a valid .zip archive (End of Central Directory record not found)");
  }
  let cdSize = tailView.getUint32(eocdPos + 12, true);
  let cdOffset = tailView.getUint32(eocdPos + 16, true);
  if (eocdPos >= 20 && tailView.getUint32(eocdPos - 20, true) === 117853008) {
    const zip64EocdOffset = Number(tailView.getBigUint64(eocdPos - 20 + 8, true));
    const z64Buf = await file.slice(zip64EocdOffset, zip64EocdOffset + 56).arrayBuffer();
    if (z64Buf.byteLength >= 56) {
      const z64View = new DataView(z64Buf);
      if (z64View.getUint32(0, true) === 101075792) {
        cdSize = Number(z64View.getBigUint64(40, true));
        cdOffset = Number(z64View.getBigUint64(48, true));
      }
    }
  }
  if (cdOffset < 0 || cdOffset + cdSize > file.size) {
    throw new Error("Corrupted .zip archive (Central Directory bounds exceed file size)");
  }
  const cdBuf = await file.slice(cdOffset, cdOffset + cdSize).arrayBuffer();
  const cdView = new DataView(cdBuf);
  const cdBytes = new Uint8Array(cdBuf);
  const decoder = new TextDecoder("utf-8");
  const rawEntries = [];
  let pos = 0;
  while (pos + 46 <= cdBuf.byteLength) {
    const sig = cdView.getUint32(pos, true);
    if (sig !== 33639248)
      break;
    const compressionMethod = cdView.getUint16(pos + 10, true);
    let compressedSize = cdView.getUint32(pos + 20, true);
    let uncompressedSize = cdView.getUint32(pos + 24, true);
    const nameLen = cdView.getUint16(pos + 28, true);
    const extraLen = cdView.getUint16(pos + 30, true);
    const commentLen = cdView.getUint16(pos + 32, true);
    let localHeaderOffset = cdView.getUint32(pos + 42, true);
    const nameStart = pos + 46;
    const extraStart = nameStart + nameLen;
    const entryEnd = extraStart + extraLen + commentLen;
    if (entryEnd > cdBuf.byteLength)
      break;
    const archivePath = decoder.decode(cdBytes.subarray(nameStart, extraStart)).replace(/\\/g, "/");
    if (extraLen >= 4 && (uncompressedSize === ZIP32_MAX_VALUE || compressedSize === ZIP32_MAX_VALUE || localHeaderOffset === ZIP32_MAX_VALUE)) {
      let ePos = extraStart;
      const eEnd = extraStart + extraLen;
      while (ePos + 4 <= eEnd) {
        const headerId = cdView.getUint16(ePos, true);
        const dataSize = cdView.getUint16(ePos + 2, true);
        let fieldCursor = ePos + 4;
        if (headerId === 1) {
          if (uncompressedSize === ZIP32_MAX_VALUE && fieldCursor + 8 <= ePos + 4 + dataSize) {
            uncompressedSize = Number(cdView.getBigUint64(fieldCursor, true));
            fieldCursor += 8;
          }
          if (compressedSize === ZIP32_MAX_VALUE && fieldCursor + 8 <= ePos + 4 + dataSize) {
            compressedSize = Number(cdView.getBigUint64(fieldCursor, true));
            fieldCursor += 8;
          }
          if (localHeaderOffset === ZIP32_MAX_VALUE && fieldCursor + 8 <= ePos + 4 + dataSize) {
            localHeaderOffset = Number(cdView.getBigUint64(fieldCursor, true));
            fieldCursor += 8;
          }
          break;
        }
        ePos += 4 + dataSize;
      }
    }
    rawEntries.push({
      archivePath,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset
    });
    pos = entryEnd;
  }
  let manifest = null;
  const manifestRaw = rawEntries.find((e) => e.archivePath === "warehouse-manifest.json" || e.archivePath.endsWith("/warehouse-manifest.json"));
  if (manifestRaw && manifestRaw.uncompressedSize <= 16 * 1024 * 1024) {
    try {
      const manifestBlob = await extractRawZipEntryBlob(file, manifestRaw, "application/json");
      const text = await manifestBlob.text();
      const parsed = JSON.parse(text);
      if (parsed && parsed.schema === "lumiverse.warehouse.bundle" && Array.isArray(parsed.entries)) {
        manifest = parsed;
      }
    } catch {}
  }
  const manifestFolderByPath = new Map;
  if (manifest) {
    for (const item of manifest.entries) {
      if (typeof item.archivePath === "string" && typeof item.folder === "string") {
        manifestFolderByPath.set(item.archivePath.replace(/\\/g, "/"), item.folder);
      }
    }
  }
  const candidateEntries = rawEntries.filter((e) => {
    if (isIgnoredArchivePath(e.archivePath))
      return false;
    const segments = e.archivePath.split("/").filter(Boolean);
    const baseName = segments[segments.length - 1] || "";
    return detectCardFormatFromFilename(baseName) !== null;
  });
  let sharedRootPrefix = "";
  if (!manifest && candidateEntries.length > 1) {
    const firstSegments = candidateEntries[0].archivePath.split("/").filter(Boolean);
    if (firstSegments.length >= 2) {
      const candidateRoot = firstSegments[0];
      const allShareRoot = candidateEntries.every((e) => {
        const segs = e.archivePath.split("/").filter(Boolean);
        return segs.length >= 2 && segs[0] === candidateRoot;
      });
      const anyDeeperFolder = candidateEntries.some((e) => e.archivePath.split("/").filter(Boolean).length >= 3);
      if (allShareRoot && anyDeeperFolder) {
        sharedRootPrefix = `${candidateRoot}/`;
      }
    }
  }
  const entries = [];
  for (const raw of candidateEntries) {
    const segments = raw.archivePath.split("/").filter(Boolean);
    const baseName = segments[segments.length - 1];
    const detected = detectCardFormatFromFilename(baseName);
    if (!detected)
      continue;
    let folder = "";
    if (manifestFolderByPath.has(raw.archivePath)) {
      folder = manifestFolderByPath.get(raw.archivePath) || "";
    } else {
      const relativePath = sharedRootPrefix && raw.archivePath.startsWith(sharedRootPrefix) ? raw.archivePath.slice(sharedRootPrefix.length) : raw.archivePath;
      const relSegments = relativePath.split("/").filter(Boolean);
      if (relSegments.length >= 2) {
        folder = relSegments[relSegments.length - 2];
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
      localHeaderOffset: raw.localHeaderOffset
    });
  }
  return { entries, manifest };
}
async function extractRawZipEntryBlob(zipFile, entry, mimeType) {
  const localHeaderBuf = await zipFile.slice(entry.localHeaderOffset, entry.localHeaderOffset + 30).arrayBuffer();
  if (localHeaderBuf.byteLength < 30) {
    throw new Error(`Truncated local header for "${entry.archivePath}"`);
  }
  const lv = new DataView(localHeaderBuf);
  if (lv.getUint32(0, true) !== 67324752) {
    throw new Error(`Invalid local header signature for "${entry.archivePath}"`);
  }
  const nameLen = lv.getUint16(26, true);
  const extraLen = lv.getUint16(28, true);
  const dataStart = entry.localHeaderOffset + 30 + nameLen + extraLen;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > zipFile.size) {
    throw new Error(`Archive entry "${entry.archivePath}" extends past end of file`);
  }
  const rawSlice = zipFile.slice(dataStart, dataEnd, mimeType);
  if (entry.compressionMethod === 0) {
    return rawSlice;
  }
  if (entry.compressionMethod === 8) {
    const inflated = await inflateRawBlob(rawSlice);
    return new Blob([inflated], { type: mimeType });
  }
  throw new Error(`Unsupported ZIP compression method (${entry.compressionMethod}) on "${entry.archivePath}". Only STORE (0) and DEFLATE (8) are supported.`);
}
async function extractZipEntryAsFile(zipFile, entry) {
  const blob = await extractRawZipEntryBlob(zipFile, entry, entry.mimeType);
  return new File([blob], entry.baseName, { type: entry.mimeType });
}
function formatByteSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0)
    return "0 B";
  if (bytes < 1024)
    return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024)
    return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024)
    return `${mb.toFixed(2)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}
function sanitizeFilenameComponent(input, fallback = "character") {
  const cleaned = (input || "").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/\s+/g, " ").trim().replace(/^\.+|\.+$/g, "");
  return cleaned || fallback;
}

// src/frontend.ts
var WAREHOUSE_ICON_SVG = `<svg viewBox="0 0 24 24"><path fill="currentColor" d="M5.75 2.75h12.5V2h1.5v20h-1.5v-1.5H5.75V22h-1.5V2h1.5ZM15.926 19h2.324v-3.917H5.75V19h1.717v-2.52c0-.119-.011-.22.059-.324a.35.35 0 0 1 .257-.154c.044-.005.089-.002.134-.002h2.1c.045 0 .09-.003.134.002c.11.01.21.074.266.168c.062.103.05.205.05.32V19h2.459v-2.52c0-.119-.011-.22.059-.324a.35.35 0 0 1 .257-.154c.044-.005.09-.002.134-.002h2.1c.045 0 .09-.003.134.002c.11.01.21.074.266.168c.062.103.05.205.05.32Zm-1.036-5.417h3.36V9.667H5.75v3.916h2.14v-2.667l.005-.042a.4.4 0 0 1 .036-.106a.35.35 0 0 1 .241-.178c.061-.012.162-.007.228-.007h2.02c.132 0 .232-.01.342.08a.35.35 0 0 1 .126.236c.006.055.002.119.002.174v2.51h1v-2.51c0-.114-.012-.217.05-.32a.35.35 0 0 1 .266-.168c.044-.004.09-.002.134-.002h2.1c.045 0 .09-.002.134.002c.104.01.199.068.257.154c.07.105.059.205.059.324Zm1.64-5.416h1.72V4.25H5.75v3.917h7.78V5.656c0-.114-.012-.216.05-.319a.35.35 0 0 1 .266-.169c.044-.004.089-.001.134-.001h2.1c.045 0 .09-.003.134.001a.36.36 0 0 1 .257.154c.07.105.059.205.059.324Z"/></svg>`;
var WAREHOUSE_STYLES = `
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

.wh-search-row {
  display: flex;
  align-items: center;
  gap: 7px;
}

.wh-search-row .wh-input {
  flex: 1;
}

.wh-query-errors {
  margin: 0;
  padding: 8px 10px;
  border: 1px solid rgba(250, 204, 21, 0.35);
  border-radius: 8px;
  background: rgba(250, 204, 21, 0.08);
  color: var(--lumiverse-text-muted, #a1a1aa);
  font-size: 11.5px;
  line-height: 1.45;
}

.wh-query-errors strong {
  color: #facc15;
  font-weight: 600;
}

.wh-query-errors ul {
  margin: 5px 0 0;
  padding-left: 18px;
  list-style: disc;
}

.wh-help-dialog {
  display: flex;
  flex-direction: column;
  gap: 14px;
  color: var(--lumiverse-text, #f4f4f6);
  font-size: 13px;
  line-height: 1.5;
}

.wh-help-intro {
  margin: 0;
  font-size: 12.5px;
  color: var(--lumiverse-text-muted, #a1a1aa);
}

.wh-help-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.wh-help-heading {
  margin: 0;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--lumiverse-text-muted, #a1a1aa);
}

.wh-help-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.wh-help-item {
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--lumiverse-text-muted, #a1a1aa);
}

.wh-help-code {
  display: inline-block;
  padding: 1px 6px;
  margin-right: 6px;
  border-radius: 5px;
  background: rgba(56, 189, 248, 0.14);
  color: #38bdf8;
  font-family: var(--lumiverse-font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace);
  font-size: 11.5px;
  font-weight: 500;
}

.wh-help-actions {
  display: flex;
  justify-content: flex-end;
  padding-top: 6px;
}
`;
function setup(ctx) {
  ctx.dom.addStyle(WAREHOUSE_STYLES);
  let activeMode = "export";
  let preferences = { ...DEFAULT_PREFERENCES };
  let characters = [];
  const characterMatchContexts = new Map;
  let availableTags = [];
  let isLoadingLibrary = false;
  let libraryLoadedCount = 0;
  let libraryTotalCount = 0;
  let libraryError = null;
  let searchQuery = "";
  let lastValidParsedQuery = parseQuery("");
  let folderFilter = "__ALL__";
  let tagFilter = "__ALL__";
  let exportPage = 0;
  let importPage = 0;
  const selectedCharIds = new Set;
  let activeModal = null;
  let activeHelpModal = null;
  let isExporting = false;
  let exportCancelRequested = false;
  let exportAbortController = null;
  let exportStatusText = "";
  let exportSubStatusText = "";
  let exportProgressPct = 0;
  let lastExportArtifact = null;
  let activeExportTrackingId = null;
  let selectedZipFile = null;
  let inspectedZip = null;
  let isInspectingZip = false;
  let zipInspectError = null;
  const selectedZipEntryPaths = new Set;
  let isImporting = false;
  let importCancelRequested = false;
  let activeImportJobId = null;
  let importStatusText = "";
  let importSubStatusText = "";
  let importProgressPct = 0;
  let importResultsSummary = null;
  const pendingAssemblies = new Map;
  const supportsFileTransfers = ctx.host?.capabilities?.["file-transfers-v1"] === 1;
  function sendToBackend(msg) {
    ctx.sendToBackend(msg);
  }
  function showToast(message, variant = "info") {
    sendToBackend({ type: "notify", message, variant });
  }
  function el(tag, opts, children) {
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
          element.style[k] = v;
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
  function encodeBase64Utf8(str) {
    const bytes = new TextEncoder().encode(str);
    let binary = "";
    for (let i = 0;i < bytes.length; i += 1) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
  async function uploadStagedBlobToHost(blob, fileName, signal) {
    const metadataPairs = [
      `extension ${encodeBase64Utf8(ctx.extensionName || "warehouse")}`,
      `filename ${encodeBase64Utf8(fileName)}`,
      `filetype ${encodeBase64Utf8(blob.type || "application/octet-stream")}`
    ];
    const createRes = await fetch("/api/v1/spindle-uploads", {
      method: "POST",
      headers: {
        "Tus-Resumable": "1.0.0",
        "Upload-Length": String(blob.size),
        "Upload-Metadata": metadataPairs.join(",")
      },
      signal
    });
    if (!createRes.ok) {
      throw new Error(`Failed to create host staging upload (HTTP ${createRes.status})`);
    }
    const location = createRes.headers.get("Location") || "";
    const uploadId = location.split("/").filter(Boolean).pop() || "";
    if (!uploadId) {
      throw new Error("Missing upload ID from host staging endpoint");
    }
    const patchRes = await fetch(`/api/v1/spindle-uploads/${encodeURIComponent(uploadId)}`, {
      method: "PATCH",
      headers: {
        "Tus-Resumable": "1.0.0",
        "Upload-Offset": "0",
        "Content-Type": "application/offset+octet-stream"
      },
      body: blob,
      signal
    });
    if (!patchRes.ok) {
      throw new Error(`Failed to write staged upload bytes (HTTP ${patchRes.status})`);
    }
    return { uploadId };
  }
  function updatePreferences(patch) {
    preferences = { ...preferences, ...patch };
    sendToBackend({ type: "save_preferences", preferences: patch });
  }
  const unsubCharxProgress = ctx.events.on("CHARACTER_EXPORT_PROGRESS", (payload) => {
    if (!isExporting || !payload || typeof payload !== "object")
      return;
    const data = payload;
    if (activeExportTrackingId && data.exportId && data.exportId !== activeExportTrackingId) {
      return;
    }
    if (typeof data.processed === "number" && typeof data.total === "number" && data.total > 0) {
      exportSubStatusText = `Packaging CHARX assets (${data.processed}/${data.total})${data.detail ? ` — ${data.detail}` : ""}`;
      renderProgressOnly();
    }
  });
  ctx.onTeardown(unsubCharxProgress);
  const tab = ctx.ui.registerDrawerTab({
    id: "warehouse",
    title: "Warehouse — Batch Character Export & Import",
    shortName: "Warehouse",
    headerTitle: "Warehouse",
    description: "Batch export characters in JSON, PNG, or CHARX format into a .zip bundle and re-import character .zip archives.",
    keywords: [
      "warehouse",
      "batch",
      "bulk",
      "export",
      "import",
      "zip",
      "charx",
      "png",
      "json",
      "backup",
      "characters"
    ],
    iconSvg: WAREHOUSE_ICON_SVG,
    defaultOpen: false
  });
  const drawerRoot = el("div", { className: "wh-root" });
  const modalRoot = el("div", { className: "wh-root is-modal" });
  tab.root.appendChild(drawerRoot);
  function openWarehouseModal(mode) {
    if (mode) {
      activeMode = mode;
    }
    if (activeModal) {
      render();
      return;
    }
    try {
      const modalHandle = ctx.ui.showModal({
        title: `Warehouse — Batch Character ${activeMode === "export" ? "Export" : "Import"} (${characters.length.toLocaleString()} cards)`,
        width: 1120,
        maxHeight: 860
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
      showToast(`Could not open modal: ${msg}`, "error");
    }
  }
  function closeWarehouseModal() {
    if (!activeModal)
      return;
    const handle = activeModal;
    activeModal = null;
    handle.dismiss();
    render();
  }
  let progressLabelEl = null;
  let progressSubLabelEl = null;
  let progressFillEl = null;
  let progressPctEl = null;
  let charListContainerEl = null;
  let charListPagerEl = null;
  let selectionSummaryEl = null;
  let exportButtonEl = null;
  let queryErrorsContainerEl = null;
  function openSearchHelpModal() {
    if (activeHelpModal) {
      return;
    }
    try {
      const helpHandle = ctx.ui.showModal({
        title: "Search help — Warehouse",
        width: 580,
        maxHeight: 760
      });
      activeHelpModal = helpHandle;
      helpHandle.onDismiss(() => {
        if (activeHelpModal === helpHandle) {
          activeHelpModal = null;
        }
      });
      const dialogBody = el("div", { className: "wh-help-dialog" }, [
        el("p", {
          className: "wh-help-intro",
          text: "Use LumiTag-style search prefixes to filter characters by name, tag, folder, or author/creator."
        })
      ]);
      for (const section of getWarehouseSearchHelpSections()) {
        const secEl = el("section", { className: "wh-help-section" }, [
          el("h4", { className: "wh-help-heading", text: section.heading })
        ]);
        if (section.intro) {
          secEl.appendChild(el("p", { className: "wh-help-intro", text: section.intro }));
        }
        const listEl = el("div", { className: "wh-help-list" });
        for (const ex of section.examples) {
          const itemEl = el("div", { className: "wh-help-item" }, [
            el("code", { className: "wh-help-code", text: ex.syntax }),
            el("span", { text: ex.meaning })
          ]);
          listEl.appendChild(itemEl);
        }
        secEl.appendChild(listEl);
        dialogBody.appendChild(secEl);
      }
      const actionsRow = el("div", { className: "wh-help-actions" }, [
        el("button", {
          className: "wh-primary-btn",
          style: { width: "auto", padding: "7px 18px" },
          text: "Close",
          attrs: { type: "button" },
          on: {
            click: () => {
              const handle = activeHelpModal;
              activeHelpModal = null;
              handle?.dismiss();
            }
          }
        })
      ]);
      dialogBody.appendChild(actionsRow);
      helpHandle.root.appendChild(dialogBody);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Could not open Search Help: ${msg}`, "error");
    }
  }
  function renderQueryErrorsNotice() {
    if (!queryErrorsContainerEl)
      return;
    queryErrorsContainerEl.innerHTML = "";
    const parsed = parseQuery(searchQuery);
    if (parsed.ok) {
      lastValidParsedQuery = parsed;
      queryErrorsContainerEl.style.display = "none";
      return;
    }
    queryErrorsContainerEl.style.display = "block";
    const box = el("div", {
      className: "wh-query-errors",
      attrs: { role: "alert" }
    });
    box.appendChild(el("strong", { text: "Search syntax problem — fix the query:" }));
    const ul = el("ul");
    for (const err of parsed.errors) {
      ul.appendChild(el("li", { text: err.message }));
    }
    box.appendChild(ul);
    queryErrorsContainerEl.appendChild(box);
  }
  function renderProgressOnly() {
    const statusText = activeMode === "export" ? exportStatusText : importStatusText;
    const subText = activeMode === "export" ? exportSubStatusText : importSubStatusText;
    const pct = activeMode === "export" ? exportProgressPct : importProgressPct;
    if (progressLabelEl)
      progressLabelEl.textContent = statusText;
    if (progressSubLabelEl)
      progressSubLabelEl.textContent = subText;
    if (progressFillEl)
      progressFillEl.style.width = `${Math.max(0, Math.min(100, pct))}%`;
    if (progressPctEl)
      progressPctEl.textContent = `${Math.round(pct)}%`;
  }
  function getFoldersList() {
    const folders = new Set;
    for (const c of characters) {
      const f = (c.folder || "").trim();
      if (f)
        folders.add(f);
    }
    return Array.from(folders).sort((a, b) => a.localeCompare(b));
  }
  function getFilteredCharacters() {
    const parsed = parseQuery(searchQuery);
    if (parsed.ok) {
      lastValidParsedQuery = parsed;
    }
    const effectiveQuery = parsed.ok ? parsed : parsed.groups.length > 0 ? parsed : lastValidParsedQuery;
    return characters.filter((c) => {
      if (folderFilter === "__UNFILED__") {
        if ((c.folder || "").trim() !== "")
          return false;
      } else if (folderFilter !== "__ALL__") {
        if ((c.folder || "").trim() !== folderFilter)
          return false;
      }
      if (tagFilter !== "__ALL__") {
        if (!Array.isArray(c.tags) || !c.tags.includes(tagFilter))
          return false;
      }
      if (effectiveQuery.groups.length > 0) {
        let matchCtx = characterMatchContexts.get(c.id);
        if (!matchCtx) {
          matchCtx = buildCharacterMatchContext(c);
          characterMatchContexts.set(c.id, matchCtx);
        }
        if (!evaluateCharacterQuery(effectiveQuery, matchCtx))
          return false;
      }
      return true;
    });
  }
  async function loadCharacterLibrary() {
    if (isLoadingLibrary)
      return;
    isLoadingLibrary = true;
    libraryLoadedCount = 0;
    libraryTotalCount = 0;
    libraryError = null;
    render();
    try {
      const allItems = [];
      const pageSize = 1000;
      let offset = 0;
      let total = 0;
      do {
        const res = await fetch(`/api/v1/characters/summary?limit=${pageSize}&offset=${offset}&sort=name&direction=asc`);
        if (!res.ok) {
          throw new Error(`Failed to fetch characters (HTTP ${res.status})`);
        }
        const data = await res.json();
        const pageItems = Array.isArray(data.data) ? data.data : Array.isArray(data.items) ? data.items : [];
        allItems.push(...pageItems);
        total = typeof data.total === "number" ? data.total : allItems.length;
        offset += pageItems.length;
        libraryLoadedCount = allItems.length;
        libraryTotalCount = total;
        if (charListContainerEl && isLoadingLibrary) {
          charListContainerEl.innerHTML = "";
          charListContainerEl.appendChild(el("div", {
            className: "wh-empty",
            text: `Loading character library... (${libraryLoadedCount.toLocaleString()} / ${libraryTotalCount.toLocaleString()})`
          }));
        }
        if (pageItems.length === 0)
          break;
      } while (offset < total);
      characters = allItems;
      characterMatchContexts.clear();
      for (const c of characters) {
        characterMatchContexts.set(c.id, buildCharacterMatchContext(c));
      }
      exportPage = 0;
      const validIds = new Set(characters.map((c) => c.id));
      for (const id of Array.from(selectedCharIds)) {
        if (!validIds.has(id))
          selectedCharIds.delete(id);
      }
      if (selectedCharIds.size === 0 && characters.length > 0) {
        for (const c of characters) {
          selectedCharIds.add(c.id);
        }
      }
      try {
        const tagRes = await fetch("/api/v1/characters/tags");
        if (tagRes.ok) {
          const tagRaw = await tagRes.json();
          const rawList = Array.isArray(tagRaw) ? tagRaw : tagRaw && typeof tagRaw === "object" && Array.isArray(tagRaw.tags) ? tagRaw.tags : [];
          const parsedTags = [];
          for (const entry of rawList) {
            if (typeof entry === "string" && entry.trim()) {
              parsedTags.push(entry.trim());
            } else if (entry && typeof entry === "object" && typeof entry.tag === "string") {
              const t = (entry.tag || "").trim();
              if (t)
                parsedTags.push(t);
            }
          }
          availableTags = Array.from(new Set(parsedTags)).sort((a, b) => a.localeCompare(b));
        }
      } catch {}
    } catch (err) {
      libraryError = err instanceof Error ? err.message : String(err);
    } finally {
      isLoadingLibrary = false;
      render();
    }
  }
  function triggerBrowserBlobDownload(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1e4);
  }
  async function downloadLastExportArtifact() {
    if (!lastExportArtifact)
      return;
    if (lastExportArtifact.blob) {
      triggerBrowserBlobDownload(lastExportArtifact.blob, lastExportArtifact.fileName);
      return;
    }
    if (lastExportArtifact.fileId) {
      await ctx.files.download(lastExportArtifact.fileId);
    }
  }
  function buildArchiveTimestamp() {
    const now = new Date;
    const pad = (n) => String(n).padStart(2, "0");
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}`;
  }
  function allocateZipEntryPath(char, format, organizeByFolder, usedPathsLower) {
    const baseName = sanitizeFilenameComponent(char.name || "character", "character");
    const folderRaw = organizeByFolder ? (char.folder || "").trim() : "";
    const folderPrefix = folderRaw ? `${sanitizeFilenameComponent(folderRaw, "Folder")}/` : "";
    let candidate = `${folderPrefix}${baseName}.${format}`;
    let counter = 2;
    while (usedPathsLower.has(candidate.toLowerCase())) {
      candidate = `${folderPrefix}${baseName} (${counter}).${format}`;
      counter += 1;
    }
    usedPathsLower.add(candidate.toLowerCase());
    return candidate;
  }
  async function runBatchExport() {
    if (isExporting)
      return;
    const selectedChars = characters.filter((c) => selectedCharIds.has(c.id));
    if (selectedChars.length === 0) {
      showToast("Select at least one character to export.", "warning");
      return;
    }
    if (lastExportArtifact?.fileId) {
      sendToBackend({ type: "cleanup_archive", fileId: lastExportArtifact.fileId });
    }
    lastExportArtifact = null;
    isExporting = true;
    exportCancelRequested = false;
    exportAbortController = new AbortController;
    const format = preferences.exportFormat;
    const organizeByFolder = preferences.organizeByFolder;
    const includeManifest = preferences.includeManifest;
    const useServerStaging = Boolean(preferences.packagingMode === "host" && supportsFileTransfers);
    const storeWithoutCompression = format !== "json";
    exportStatusText = `Preparing to export ${selectedChars.length} character${selectedChars.length === 1 ? "" : "s"} (${format.toUpperCase()})...`;
    exportSubStatusText = "";
    exportProgressPct = 0;
    render();
    const usedPathsLower = new Set(["warehouse-manifest.json"]);
    const manifestEntries = [];
    const stagedUploadEntries = [];
    const zipBuilder = useServerStaging ? null : new BrowserZipBuilder;
    try {
      for (let i = 0;i < selectedChars.length; i += 1) {
        if (exportCancelRequested) {
          throw new Error("Export cancelled by user.");
        }
        const char = selectedChars[i];
        const entryPath = allocateZipEntryPath(char, format, organizeByFolder, usedPathsLower);
        exportStatusText = `Exporting (${i + 1}/${selectedChars.length}): ${char.name}`;
        exportSubStatusText = format === "charx" ? "Building CHARX package with assets & modules..." : `Generating .${format} card...`;
        exportProgressPct = i / selectedChars.length * 88;
        renderProgressOnly();
        const exportTrackingId = format === "charx" ? `wh_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` : null;
        activeExportTrackingId = exportTrackingId;
        const query = new URLSearchParams({ format });
        if (exportTrackingId) {
          query.set("export_id", exportTrackingId);
        }
        const response = await fetch(`/api/v1/characters/${encodeURIComponent(char.id)}/export?${query.toString()}`, {
          method: "GET",
          signal: exportAbortController.signal
        });
        if (!response.ok) {
          let errDetail = `HTTP ${response.status}`;
          try {
            const errJson = await response.json();
            if (errJson?.error)
              errDetail = errJson.error;
          } catch {}
          throw new Error(`Failed to export "${char.name}": ${errDetail}`);
        }
        const cardBytes = new Uint8Array(await response.arrayBuffer());
        activeExportTrackingId = null;
        if (exportCancelRequested) {
          throw new Error("Export cancelled by user.");
        }
        if (useServerStaging) {
          exportSubStatusText = `Staging ${entryPath} (${formatByteSize(cardBytes.byteLength)}) to host...`;
          renderProgressOnly();
          const baseFileName = entryPath.split("/").pop() || `${char.id}.${format}`;
          const mimeType = format === "json" ? "application/json" : format === "png" ? "image/png" : "application/zip";
          const fileBlob = new Blob([cardBytes], { type: mimeType });
          const uploaded = await uploadStagedBlobToHost(fileBlob, baseFileName, exportAbortController.signal);
          stagedUploadEntries.push({
            name: entryPath,
            uploadId: uploaded.uploadId,
            store: storeWithoutCompression
          });
        } else if (zipBuilder) {
          exportSubStatusText = `Adding ${entryPath} (${formatByteSize(cardBytes.byteLength)}) to ZIP...`;
          renderProgressOnly();
          await zipBuilder.addFile(entryPath, cardBytes, {
            store: storeWithoutCompression
          });
        }
        manifestEntries.push({
          archivePath: entryPath,
          characterId: char.id,
          name: char.name,
          creator: char.creator || "",
          folder: (char.folder || "").trim(),
          tags: Array.isArray(char.tags) ? char.tags : [],
          format,
          sizeBytes: cardBytes.byteLength
        });
      }
      const manifestObj = {
        schema: "lumiverse.warehouse.bundle",
        version: 1,
        creator: "Eleisea",
        exportedAt: new Date().toISOString(),
        format,
        totalCharacters: manifestEntries.length,
        entries: manifestEntries
      };
      const manifestJson = includeManifest ? JSON.stringify(manifestObj, null, 2) : undefined;
      const archiveFileName = `warehouse-${format}-${manifestEntries.length}-chars-${buildArchiveTimestamp()}.zip`;
      exportStatusText = "Finalizing ZIP archive...";
      exportSubStatusText = "Writing Central Directory & ZIP64 records...";
      exportProgressPct = 94;
      renderProgressOnly();
      if (useServerStaging) {
        const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const archiveResult = await new Promise((resolve, reject) => {
          pendingAssemblies.set(jobId, { resolve, reject });
          sendToBackend({
            type: "assemble_archive",
            jobId,
            fileName: archiveFileName,
            entries: stagedUploadEntries,
            manifestJson
          });
        });
        lastExportArtifact = {
          fileName: archiveResult.fileName || archiveFileName,
          size: archiveResult.size,
          count: manifestEntries.length,
          format,
          fileId: archiveResult.fileId
        };
      } else if (zipBuilder) {
        if (manifestJson) {
          await zipBuilder.addFile("warehouse-manifest.json", new TextEncoder().encode(manifestJson), { store: false });
        }
        const zipBlob = zipBuilder.finalize();
        lastExportArtifact = {
          fileName: archiveFileName,
          size: zipBlob.size,
          count: manifestEntries.length,
          format,
          blob: zipBlob
        };
      }
      exportProgressPct = 100;
      exportStatusText = `Exported ${manifestEntries.length} character${manifestEntries.length === 1 ? "" : "s"} (${formatByteSize(lastExportArtifact?.size || 0)})`;
      exportSubStatusText = "Starting download...";
      renderProgressOnly();
      await downloadLastExportArtifact();
      showToast(`Exported ${manifestEntries.length} character${manifestEntries.length === 1 ? "" : "s"} to ${archiveFileName}`, "success");
    } catch (err) {
      if (stagedUploadEntries.length > 0) {
        sendToBackend({
          type: "cleanup_uploads",
          uploadIds: stagedUploadEntries.map((e) => e.uploadId)
        });
      }
      const message = err instanceof Error ? err.message : String(err);
      if (exportCancelRequested || message.toLowerCase().includes("abort")) {
        showToast("Batch export cancelled.", "info");
      } else {
        showToast(`Export failed: ${message}`, "error");
      }
    } finally {
      activeExportTrackingId = null;
      exportAbortController = null;
      isExporting = false;
      exportCancelRequested = false;
      render();
    }
  }
  async function handleZipFileSelected(file) {
    selectedZipFile = file;
    inspectedZip = null;
    zipInspectError = null;
    importResultsSummary = null;
    importPage = 0;
    selectedZipEntryPaths.clear();
    if (!file.name.toLowerCase().endsWith(".zip")) {
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
        zipInspectError = "No .charx, .png, or .json character cards were found inside this .zip archive.";
      }
    } catch (err) {
      zipInspectError = err instanceof Error ? err.message : String(err);
    } finally {
      isInspectingZip = false;
      render();
    }
  }
  async function runBatchImport() {
    if (isImporting || !selectedZipFile || !inspectedZip)
      return;
    const chosenCandidates = inspectedZip.entries.filter((c) => selectedZipEntryPaths.has(c.archivePath));
    if (chosenCandidates.length === 0) {
      showToast("Select at least one character from the archive to import.", "warning");
      return;
    }
    isImporting = true;
    importCancelRequested = false;
    activeImportJobId = null;
    importResultsSummary = null;
    importProgressPct = 0;
    importStatusText = `Creating import job for ${chosenCandidates.length} character${chosenCandidates.length === 1 ? "" : "s"}...`;
    importSubStatusText = "";
    render();
    try {
      const createRes = await fetch("/api/v1/characters/import-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          total: chosenCandidates.length,
          skip_duplicates: preferences.skipDuplicates
        })
      });
      if (!createRes.ok) {
        throw new Error(`Failed to initialize import job (HTTP ${createRes.status})`);
      }
      const { jobId } = await createRes.json();
      activeImportJobId = jobId;
      for (let i = 0;i < chosenCandidates.length; i += 1) {
        if (importCancelRequested) {
          await fetch(`/api/v1/characters/import-jobs/${encodeURIComponent(jobId)}/cancel`, {
            method: "POST"
          }).catch(() => {});
          throw new Error("Import cancelled by user.");
        }
        const candidate = chosenCandidates[i];
        importStatusText = `Extracting & staging (${i + 1}/${chosenCandidates.length}): ${candidate.baseName}`;
        importSubStatusText = `${candidate.archivePath} (${formatByteSize(candidate.uncompressedSize)})`;
        importProgressPct = i / chosenCandidates.length * 45;
        renderProgressOnly();
        const extractedFile = await extractZipEntryAsFile(selectedZipFile, candidate);
        const uploadRes = await fetch(`/api/v1/characters/import-jobs/${encodeURIComponent(jobId)}/files/${i}?filename=${encodeURIComponent(extractedFile.name)}`, {
          method: "PUT",
          headers: {
            "Content-Type": extractedFile.type || "application/octet-stream"
          },
          body: extractedFile
        });
        if (!uploadRes.ok) {
          throw new Error(`Failed to stage "${candidate.baseName}" (HTTP ${uploadRes.status})`);
        }
      }
      importStatusText = "Starting character import pipeline...";
      importSubStatusText = "Importing cards, avatars, world books, and modules...";
      importProgressPct = 48;
      renderProgressOnly();
      const startRes = await fetch(`/api/v1/characters/import-jobs/${encodeURIComponent(jobId)}/start`, {
        method: "POST"
      });
      if (!startRes.ok) {
        throw new Error(`Failed to start import job (HTTP ${startRes.status})`);
      }
      let finalStatus = null;
      while (true) {
        if (importCancelRequested) {
          await fetch(`/api/v1/characters/import-jobs/${encodeURIComponent(jobId)}/cancel`, {
            method: "POST"
          }).catch(() => {});
        }
        const statusRes = await fetch(`/api/v1/characters/import-jobs/${encodeURIComponent(jobId)}/status`);
        if (!statusRes.ok) {
          throw new Error(`Failed to read import job status (HTTP ${statusRes.status})`);
        }
        const statusData = await statusRes.json();
        const processed = statusData.processed || 0;
        const total = statusData.total || chosenCandidates.length;
        const liveImported = statusData.summary?.imported ?? (Array.isArray(statusData.results) ? statusData.results.filter((r) => r.success && !r.skipped).length : 0);
        const liveSkipped = statusData.summary?.skipped ?? (Array.isArray(statusData.results) ? statusData.results.filter((r) => Boolean(r.skipped)).length : 0);
        const liveFailed = statusData.summary?.failed ?? (Array.isArray(statusData.results) ? statusData.results.filter((r) => !r.success && !r.skipped).length : 0);
        importStatusText = `Importing characters (${processed}/${total})...`;
        importSubStatusText = `${liveImported} imported, ${liveSkipped} skipped, ${liveFailed} failed`;
        importProgressPct = 48 + processed / Math.max(1, total) * 45;
        renderProgressOnly();
        if (statusData.status === "complete" || statusData.status === "cancelled" || statusData.status === "error") {
          finalStatus = statusData;
          break;
        }
        await new Promise((r) => setTimeout(r, 250));
      }
      let foldersRestoredCount = 0;
      if (preferences.restoreFolders && finalStatus && Array.isArray(finalStatus.results)) {
        const folderToCharIds = new Map;
        for (let idx = 0;idx < finalStatus.results.length; idx += 1) {
          const itemResult = finalStatus.results[idx];
          const isImported = Boolean(itemResult.success && !itemResult.skipped);
          if (isImported && itemResult.character?.id) {
            const candidate = chosenCandidates[idx];
            const targetFolder = (candidate?.folder || "").trim();
            if (targetFolder) {
              const list = folderToCharIds.get(targetFolder) || [];
              list.push(itemResult.character.id);
              folderToCharIds.set(targetFolder, list);
            }
          }
        }
        if (folderToCharIds.size > 0) {
          importStatusText = "Restoring character folder assignments...";
          importProgressPct = 96;
          renderProgressOnly();
          for (const [folderName, charIds] of folderToCharIds.entries()) {
            try {
              const bulkRes = await fetch("/api/v1/characters/bulk-update", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  ids: charIds,
                  folder: folderName
                })
              });
              if (bulkRes.ok) {
                foldersRestoredCount += charIds.length;
              }
            } catch {}
          }
        }
      }
      const logItems = [];
      let computedImported = 0;
      let computedSkipped = 0;
      let computedFailed = 0;
      if (finalStatus && Array.isArray(finalStatus.results)) {
        for (let idx = 0;idx < finalStatus.results.length; idx += 1) {
          const r = finalStatus.results[idx];
          const candidate = chosenCandidates[idx];
          const itemStatus = r.skipped ? "skipped" : r.success ? "imported" : "error";
          if (itemStatus === "imported")
            computedImported += 1;
          else if (itemStatus === "skipped")
            computedSkipped += 1;
          else
            computedFailed += 1;
          const displayName = r.character?.name || candidate?.baseName || r.filename || `Entry #${idx + 1}`;
          logItems.push({
            name: displayName,
            status: itemStatus,
            detail: itemStatus === "imported" ? candidate?.folder && preferences.restoreFolders ? `Imported (Folder: ${candidate.folder})` : "Imported" : r.error || (itemStatus === "skipped" ? "Duplicate skipped" : "Failed")
          });
        }
      }
      importResultsSummary = {
        imported: finalStatus?.summary?.imported ?? computedImported,
        skipped: finalStatus?.summary?.skipped ?? computedSkipped,
        failed: finalStatus?.summary?.failed ?? computedFailed,
        foldersRestored: foldersRestoredCount,
        items: logItems
      };
      importProgressPct = 100;
      showToast(`Import complete: ${importResultsSummary.imported} imported, ${importResultsSummary.skipped} skipped, ${importResultsSummary.failed} failed.`, importResultsSummary.failed > 0 ? "warning" : "success");
      loadCharacterLibrary().catch(() => {});
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Import failed: ${msg}`, "error");
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
  function updateCharacterListSelectionUI() {
    const filtered = getFilteredCharacters();
    if (selectionSummaryEl) {
      selectionSummaryEl.textContent = `${selectedCharIds.size.toLocaleString()} of ${characters.length.toLocaleString()} selected (${filtered.length.toLocaleString()} shown)`;
    }
    if (exportButtonEl) {
      exportButtonEl.disabled = isExporting || selectedCharIds.size === 0;
      exportButtonEl.textContent = isExporting ? "Exporting..." : `Export ${selectedCharIds.size.toLocaleString()} Character${selectedCharIds.size === 1 ? "" : "s"} as .ZIP (${preferences.exportFormat.toUpperCase()})`;
    }
    if (!charListContainerEl)
      return;
    charListContainerEl.innerHTML = "";
    if (charListPagerEl) {
      charListPagerEl.innerHTML = "";
      charListPagerEl.style.display = "none";
    }
    if (isLoadingLibrary) {
      const progressDetail = libraryTotalCount > 0 ? ` (${libraryLoadedCount.toLocaleString()} / ${libraryTotalCount.toLocaleString()})` : "";
      charListContainerEl.appendChild(el("div", {
        className: "wh-empty",
        text: `Loading character library...${progressDetail}`
      }));
      return;
    }
    if (libraryError) {
      charListContainerEl.appendChild(el("div", { className: "wh-empty wh-status-err", text: libraryError }));
      return;
    }
    if (filtered.length === 0) {
      charListContainerEl.appendChild(el("div", {
        className: "wh-empty",
        text: characters.length === 0 ? "No characters found in your Lumiverse library." : "No characters match your current search or filter."
      }));
      return;
    }
    const pageSize = activeModal ? EXPORT_PAGE_SIZE_MODAL : EXPORT_PAGE_SIZE_DRAWER;
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    if (exportPage >= totalPages)
      exportPage = totalPages - 1;
    if (exportPage < 0)
      exportPage = 0;
    const startIdx = exportPage * pageSize;
    const pageSlice = filtered.slice(startIdx, startIdx + pageSize);
    for (const char of pageSlice) {
      const isSelected = selectedCharIds.has(char.id);
      const row = el("div", {
        className: `wh-char-item${isSelected ? " is-selected" : ""}`
      });
      const checkbox = el("input", {
        attrs: { type: "checkbox" }
      });
      checkbox.checked = isSelected;
      const avatar = el("img", {
        className: "wh-char-avatar",
        attrs: {
          src: `/api/v1/characters/${encodeURIComponent(char.id)}/avatar?size=sm`,
          alt: char.name || "Character",
          loading: "lazy"
        }
      });
      const subParts = [];
      if (char.creator)
        subParts.push(`by ${char.creator}`);
      if (Array.isArray(char.tags) && char.tags.length > 0) {
        subParts.push(char.tags.slice(0, 3).join(", "));
      }
      const info = el("div", { className: "wh-char-info" }, [
        el("div", { className: "wh-char-name", text: char.name || "Unnamed" }),
        el("div", {
          className: "wh-char-sub",
          text: subParts.join(" • ") || "No creator/tags"
        })
      ]);
      row.appendChild(checkbox);
      row.appendChild(avatar);
      row.appendChild(info);
      if (char.folder && char.folder.trim()) {
        row.appendChild(el("span", {
          className: "wh-badge is-folder",
          text: char.folder.trim()
        }));
      }
      const toggleChar = () => {
        if (isExporting)
          return;
        if (selectedCharIds.has(char.id)) {
          selectedCharIds.delete(char.id);
          checkbox.checked = false;
          row.classList.remove("is-selected");
        } else {
          selectedCharIds.add(char.id);
          checkbox.checked = true;
          row.classList.add("is-selected");
        }
        if (selectionSummaryEl) {
          selectionSummaryEl.textContent = `${selectedCharIds.size.toLocaleString()} of ${characters.length.toLocaleString()} selected (${filtered.length.toLocaleString()} shown)`;
        }
        if (exportButtonEl) {
          exportButtonEl.disabled = isExporting || selectedCharIds.size === 0;
          exportButtonEl.textContent = `Export ${selectedCharIds.size.toLocaleString()} Character${selectedCharIds.size === 1 ? "" : "s"} as .ZIP (${preferences.exportFormat.toUpperCase()})`;
        }
      };
      row.addEventListener("click", (e) => {
        if (e.target === checkbox)
          return;
        toggleChar();
      });
      checkbox.addEventListener("change", () => {
        toggleChar();
      });
      charListContainerEl.appendChild(row);
    }
    if (charListPagerEl && totalPages > 1) {
      charListPagerEl.style.display = "flex";
      const rangeStart = startIdx + 1;
      const rangeEnd = Math.min(filtered.length, startIdx + pageSlice.length);
      const prevBtn = el("button", {
        className: "wh-mini-btn",
        text: "← Prev",
        attrs: { type: "button" },
        on: {
          click: () => {
            if (exportPage > 0) {
              exportPage -= 1;
              updateCharacterListSelectionUI();
            }
          }
        }
      });
      prevBtn.disabled = exportPage <= 0;
      const nextBtn = el("button", {
        className: "wh-mini-btn",
        text: "Next →",
        attrs: { type: "button" },
        on: {
          click: () => {
            if (exportPage < totalPages - 1) {
              exportPage += 1;
              updateCharacterListSelectionUI();
            }
          }
        }
      });
      nextBtn.disabled = exportPage >= totalPages - 1;
      charListPagerEl.appendChild(el("span", {
        text: `Showing ${rangeStart.toLocaleString()}–${rangeEnd.toLocaleString()} of ${filtered.length.toLocaleString()} • Page ${exportPage + 1} of ${totalPages}`
      }));
      charListPagerEl.appendChild(el("div", { className: "wh-pager-controls" }, [prevBtn, nextBtn]));
    }
  }
  function renderExportView() {
    const container = el("div", {
      style: { display: "flex", flexDirection: "column", gap: "12px" }
    });
    const formatPanel = el("div", { className: "wh-panel" });
    formatPanel.appendChild(el("div", { className: "wh-panel-header" }, [
      el("span", { className: "wh-panel-title", text: "1. Export Format & Archive Options" }),
      el("span", { className: "wh-panel-subtitle", text: "Bundled as .zip" })
    ]));
    const formats = [
      {
        id: "charx",
        title: "CHARX",
        ext: ".charx",
        desc: "Full bundle: card, alt avatars, gallery, expressions, world books & regex"
      },
      {
        id: "png",
        title: "PNG Card",
        ext: ".png",
        desc: "Avatar PNG embedded with CCSv3 metadata & attached world books"
      },
      {
        id: "json",
        title: "JSON Card",
        ext: ".json",
        desc: "Lightweight CCSv3 JSON character definition & character_book"
      }
    ];
    const formatGrid = el("div", { className: "wh-format-grid" });
    for (const fmt of formats) {
      const card = el("button", {
        className: `wh-format-card${preferences.exportFormat === fmt.id ? " is-selected" : ""}`,
        attrs: { type: "button" },
        on: {
          click: () => {
            if (isExporting)
              return;
            updatePreferences({ exportFormat: fmt.id });
            render();
          }
        }
      }, [
        el("div", { className: "wh-format-card-top" }, [
          el("span", { className: "wh-format-name", text: fmt.title }),
          el("span", { className: "wh-format-ext", text: fmt.ext })
        ]),
        el("span", { className: "wh-format-desc", text: fmt.desc })
      ]);
      formatGrid.appendChild(card);
    }
    formatPanel.appendChild(formatGrid);
    const optionsList = el("div", { className: "wh-options-list" });
    const createOptionRow = (checked, title, hint, onChange) => {
      const cb = el("input", { attrs: { type: "checkbox" } });
      cb.checked = checked;
      cb.disabled = isExporting;
      cb.addEventListener("change", () => onChange(cb.checked));
      return el("label", { className: "wh-checkbox-row" }, [
        cb,
        el("div", { className: "wh-checkbox-meta" }, [
          el("span", { text: title }),
          el("span", { className: "wh-checkbox-hint", text: hint })
        ])
      ]);
    };
    optionsList.appendChild(createOptionRow(preferences.organizeByFolder, "Organize archive into subfolders by character folder", "Places characters in FolderName/CharacterName.ext inside the .zip", (val) => updatePreferences({ organizeByFolder: val })));
    optionsList.appendChild(createOptionRow(preferences.includeManifest, "Include warehouse-manifest.json metadata", "Preserves exact folder assignments and export metadata when re-importing later", (val) => updatePreferences({ includeManifest: val })));
    if (supportsFileTransfers) {
      optionsList.appendChild(createOptionRow(preferences.packagingMode === "host", "Use host disk staging (Spindle Archives API)", "Stages files on the Lumiverse server disk before assembling the ZIP64 archive", (val) => updatePreferences({ packagingMode: val ? "host" : "browser" })));
    }
    formatPanel.appendChild(optionsList);
    container.appendChild(formatPanel);
    const selectPanel = el("div", { className: "wh-panel" });
    selectionSummaryEl = el("span", {
      className: "wh-panel-subtitle",
      text: `${selectedCharIds.size} of ${characters.length} selected`
    });
    selectPanel.appendChild(el("div", { className: "wh-panel-header" }, [
      el("span", { className: "wh-panel-title", text: "2. Select Characters" }),
      selectionSummaryEl
    ]));
    const filterBar = el("div", { className: "wh-filter-bar" });
    const searchInput = el("input", {
      className: "wh-input",
      attrs: {
        type: "search",
        placeholder: "Search names, or use T:tag F:folder A:author C:name (comma = OR, - = exclude)...",
        value: searchQuery
      }
    });
    searchInput.addEventListener("input", () => {
      searchQuery = searchInput.value;
      exportPage = 0;
      renderQueryErrorsNotice();
      updateCharacterListSelectionUI();
    });
    const syntaxHelpBtn = el("button", {
      className: "wh-mini-btn",
      style: { padding: "7px 10px", whiteSpace: "nowrap" },
      text: "Search Syntax Help",
      attrs: {
        type: "button",
        title: "Show search syntax reference (T:, C:, F:, A:, AND/OR, negation)"
      },
      on: {
        click: () => {
          openSearchHelpModal();
        }
      }
    });
    const searchRow = el("div", { className: "wh-search-row" }, [
      searchInput,
      syntaxHelpBtn
    ]);
    filterBar.appendChild(searchRow);
    queryErrorsContainerEl = el("div", { style: { display: "none" } });
    filterBar.appendChild(queryErrorsContainerEl);
    renderQueryErrorsNotice();
    const filterRow = el("div", { className: "wh-filter-row" });
    const folderSelect = el("select", { className: "wh-select" });
    folderSelect.appendChild(el("option", { attrs: { value: "__ALL__" }, text: "All Folders" }));
    folderSelect.appendChild(el("option", { attrs: { value: "__UNFILED__" }, text: "Unfiled (No Folder)" }));
    for (const f of getFoldersList()) {
      folderSelect.appendChild(el("option", { attrs: { value: f }, text: `Folder: ${f}` }));
    }
    folderSelect.value = folderFilter;
    folderSelect.addEventListener("change", () => {
      folderFilter = folderSelect.value;
      exportPage = 0;
      updateCharacterListSelectionUI();
    });
    const tagSelect = el("select", { className: "wh-select" });
    tagSelect.appendChild(el("option", { attrs: { value: "__ALL__" }, text: "All Tags" }));
    for (const t of availableTags) {
      tagSelect.appendChild(el("option", { attrs: { value: t }, text: `Tag: ${t}` }));
    }
    tagSelect.value = tagFilter;
    tagSelect.addEventListener("change", () => {
      tagFilter = tagSelect.value;
      exportPage = 0;
      updateCharacterListSelectionUI();
    });
    filterRow.appendChild(folderSelect);
    filterRow.appendChild(tagSelect);
    filterBar.appendChild(filterRow);
    selectPanel.appendChild(filterBar);
    const toolbar = el("div", { className: "wh-toolbar" });
    const leftGroup = el("div", { className: "wh-toolbar-group" }, [
      el("button", {
        className: "wh-mini-btn",
        text: "Select Shown",
        attrs: { type: "button" },
        on: {
          click: () => {
            for (const c of getFilteredCharacters())
              selectedCharIds.add(c.id);
            updateCharacterListSelectionUI();
          }
        }
      }),
      el("button", {
        className: "wh-mini-btn",
        text: "Select All",
        attrs: { type: "button" },
        on: {
          click: () => {
            for (const c of characters)
              selectedCharIds.add(c.id);
            updateCharacterListSelectionUI();
          }
        }
      }),
      el("button", {
        className: "wh-mini-btn",
        text: "Invert Shown",
        attrs: { type: "button" },
        on: {
          click: () => {
            for (const c of getFilteredCharacters()) {
              if (selectedCharIds.has(c.id))
                selectedCharIds.delete(c.id);
              else
                selectedCharIds.add(c.id);
            }
            updateCharacterListSelectionUI();
          }
        }
      }),
      el("button", {
        className: "wh-mini-btn",
        text: "Clear",
        attrs: { type: "button" },
        on: {
          click: () => {
            selectedCharIds.clear();
            updateCharacterListSelectionUI();
          }
        }
      })
    ]);
    const refreshBtn = el("button", {
      className: "wh-mini-btn",
      text: isLoadingLibrary ? "Refreshing..." : "Refresh List",
      attrs: { type: "button" },
      on: {
        click: () => {
          loadCharacterLibrary();
        }
      }
    });
    refreshBtn.disabled = isLoadingLibrary || isExporting;
    toolbar.appendChild(leftGroup);
    toolbar.appendChild(refreshBtn);
    selectPanel.appendChild(toolbar);
    charListContainerEl = el("div", { className: "wh-char-list" });
    charListPagerEl = el("div", { className: "wh-pager", style: { display: "none" } });
    selectPanel.appendChild(charListContainerEl);
    selectPanel.appendChild(charListPagerEl);
    container.appendChild(selectPanel);
    const actionPanel = el("div", { className: "wh-panel" });
    if (isExporting) {
      progressLabelEl = el("div", {
        className: "wh-panel-title",
        text: exportStatusText || "Exporting..."
      });
      progressPctEl = el("span", { text: `${Math.round(exportProgressPct)}%` });
      progressSubLabelEl = el("span", { text: exportSubStatusText });
      progressFillEl = el("div", {
        className: "wh-progress-fill",
        style: { width: `${exportProgressPct}%` }
      });
      const progressBox = el("div", { className: "wh-progress-box" }, [
        el("div", { className: "wh-panel-header" }, [progressLabelEl, progressPctEl]),
        el("div", { className: "wh-progress-track" }, [progressFillEl]),
        el("div", { className: "wh-progress-meta" }, [progressSubLabelEl])
      ]);
      actionPanel.appendChild(progressBox);
      const cancelBtn = el("button", {
        className: "wh-secondary-btn wh-danger-btn",
        text: "Cancel Export",
        attrs: { type: "button" },
        on: {
          click: () => {
            exportCancelRequested = true;
            exportAbortController?.abort();
          }
        }
      });
      actionPanel.appendChild(cancelBtn);
    } else {
      exportButtonEl = el("button", {
        className: "wh-primary-btn",
        text: `Export ${selectedCharIds.size} Character${selectedCharIds.size === 1 ? "" : "s"} as .ZIP (${preferences.exportFormat.toUpperCase()})`,
        attrs: { type: "button" },
        on: {
          click: () => {
            runBatchExport();
          }
        }
      });
      exportButtonEl.disabled = selectedCharIds.size === 0;
      actionPanel.appendChild(exportButtonEl);
      if (lastExportArtifact) {
        const readyRow = el("div", {
          className: "wh-progress-box",
          style: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }
        }, [
          el("div", { style: { display: "flex", flexDirection: "column", gap: "2px" } }, [
            el("span", {
              className: "wh-status-ok",
              style: { fontWeight: "600", fontSize: "12px" },
              text: `Ready: ${lastExportArtifact.fileName}`
            }),
            el("span", {
              className: "wh-panel-subtitle",
              text: `${lastExportArtifact.count} character${lastExportArtifact.count === 1 ? "" : "s"} • ${formatByteSize(lastExportArtifact.size)}`
            })
          ]),
          el("button", {
            className: "wh-secondary-btn",
            text: "Download Again",
            attrs: { type: "button" },
            on: {
              click: () => {
                downloadLastExportArtifact();
              }
            }
          })
        ]);
        actionPanel.appendChild(readyRow);
      }
    }
    container.appendChild(actionPanel);
    updateCharacterListSelectionUI();
    return container;
  }
  function renderImportView() {
    const container = el("div", {
      style: { display: "flex", flexDirection: "column", gap: "12px" }
    });
    const pickerPanel = el("div", { className: "wh-panel" });
    pickerPanel.appendChild(el("div", { className: "wh-panel-header" }, [
      el("span", { className: "wh-panel-title", text: "1. Select Character .ZIP Archive" }),
      el("span", {
        className: "wh-panel-subtitle",
        text: "Supports .charx, .png, and .json inside .zip"
      })
    ]));
    const fileInput = el("input", {
      attrs: {
        type: "file",
        accept: ".zip,application/zip"
      },
      style: { display: "none" }
    });
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      if (file) {
        handleZipFileSelected(file);
      }
    });
    const dropzone = el("div", {
      className: "wh-dropzone",
      on: {
        click: () => {
          if (!isImporting)
            fileInput.click();
        },
        dragover: (e) => {
          e.preventDefault();
          dropzone.classList.add("is-dragover");
        },
        dragleave: () => {
          dropzone.classList.remove("is-dragover");
        },
        drop: (e) => {
          e.preventDefault();
          dropzone.classList.remove("is-dragover");
          if (isImporting)
            return;
          const dt = e.dataTransfer;
          const file = dt?.files?.[0];
          if (file) {
            handleZipFileSelected(file);
          }
        }
      }
    }, [
      el("div", {
        style: { fontWeight: "600", fontSize: "13px" },
        text: selectedZipFile ? `${selectedZipFile.name} (${formatByteSize(selectedZipFile.size)})` : "Click or drag & drop a .zip archive here"
      }),
      el("div", {
        className: "wh-panel-subtitle",
        text: inspectedZip ? `Found ${inspectedZip.entries.length} character card${inspectedZip.entries.length === 1 ? "" : "s"}${inspectedZip.manifest ? " • Warehouse Manifest detected" : ""}` : "Reads ZIP & ZIP64 archives directly without loading the entire file into RAM"
      })
    ]);
    pickerPanel.appendChild(fileInput);
    pickerPanel.appendChild(dropzone);
    if (isInspectingZip) {
      pickerPanel.appendChild(el("div", { className: "wh-empty", text: "Inspecting ZIP central directory..." }));
    } else if (zipInspectError) {
      pickerPanel.appendChild(el("div", { className: "wh-empty wh-status-err", text: zipInspectError }));
    }
    container.appendChild(pickerPanel);
    if (inspectedZip && inspectedZip.entries.length > 0) {
      const contentsPanel = el("div", { className: "wh-panel" });
      const countSummaryEl = el("span", {
        className: "wh-panel-subtitle",
        text: `${selectedZipEntryPaths.size} of ${inspectedZip.entries.length} selected`
      });
      contentsPanel.appendChild(el("div", { className: "wh-panel-header" }, [
        el("span", { className: "wh-panel-title", text: "2. Archive Contents & Options" }),
        countSummaryEl
      ]));
      const optionsList = el("div", { className: "wh-options-list" });
      const skipDupCb = el("input", { attrs: { type: "checkbox" } });
      skipDupCb.checked = preferences.skipDuplicates;
      skipDupCb.disabled = isImporting;
      skipDupCb.addEventListener("change", () => {
        updatePreferences({ skipDuplicates: skipDupCb.checked });
      });
      optionsList.appendChild(el("label", { className: "wh-checkbox-row" }, [
        skipDupCb,
        el("div", { className: "wh-checkbox-meta" }, [
          el("span", { text: "Skip duplicate characters" }),
          el("span", {
            className: "wh-checkbox-hint",
            text: "Skips characters whose name already exists in your library"
          })
        ])
      ]));
      const hasAnyFolders = inspectedZip.entries.some((c) => Boolean(c.folder));
      if (hasAnyFolders) {
        const restoreFoldersCb = el("input", {
          attrs: { type: "checkbox" }
        });
        restoreFoldersCb.checked = preferences.restoreFolders;
        restoreFoldersCb.disabled = isImporting;
        restoreFoldersCb.addEventListener("change", () => {
          updatePreferences({ restoreFolders: restoreFoldersCb.checked });
        });
        optionsList.appendChild(el("label", { className: "wh-checkbox-row" }, [
          restoreFoldersCb,
          el("div", { className: "wh-checkbox-meta" }, [
            el("span", { text: "Restore character folder assignments" }),
            el("span", {
              className: "wh-checkbox-hint",
              text: "Assigns imported characters to their folder from the manifest or ZIP subfolder"
            })
          ])
        ]));
      }
      contentsPanel.appendChild(optionsList);
      const toolbar = el("div", { className: "wh-toolbar" }, [
        el("div", { className: "wh-toolbar-group" }, [
          el("button", {
            className: "wh-mini-btn",
            text: "Select All",
            attrs: { type: "button" },
            on: {
              click: () => {
                if (isImporting || !inspectedZip)
                  return;
                for (const c of inspectedZip.entries) {
                  selectedZipEntryPaths.add(c.archivePath);
                }
                render();
              }
            }
          }),
          el("button", {
            className: "wh-mini-btn",
            text: "Clear",
            attrs: { type: "button" },
            on: {
              click: () => {
                if (isImporting)
                  return;
                selectedZipEntryPaths.clear();
                render();
              }
            }
          })
        ])
      ]);
      contentsPanel.appendChild(toolbar);
      const importPageSize = activeModal ? IMPORT_PAGE_SIZE_MODAL : IMPORT_PAGE_SIZE_DRAWER;
      const totalImportPages = Math.max(1, Math.ceil(inspectedZip.entries.length / importPageSize));
      if (importPage >= totalImportPages)
        importPage = totalImportPages - 1;
      if (importPage < 0)
        importPage = 0;
      const importStartIdx = importPage * importPageSize;
      const importPageSlice = inspectedZip.entries.slice(importStartIdx, importStartIdx + importPageSize);
      const listEl = el("div", { className: "wh-char-list" });
      for (const candidate of importPageSlice) {
        const isChecked = selectedZipEntryPaths.has(candidate.archivePath);
        const itemRow = el("div", {
          className: `wh-char-item${isChecked ? " is-selected" : ""}`
        });
        const cb = el("input", { attrs: { type: "checkbox" } });
        cb.checked = isChecked;
        cb.disabled = isImporting;
        const info = el("div", { className: "wh-char-info" }, [
          el("div", { className: "wh-char-name", text: candidate.baseName }),
          el("div", {
            className: "wh-char-sub",
            text: `${candidate.archivePath} • ${formatByteSize(candidate.uncompressedSize)}`
          })
        ]);
        itemRow.appendChild(cb);
        itemRow.appendChild(info);
        if (candidate.folder) {
          itemRow.appendChild(el("span", {
            className: "wh-badge is-folder",
            text: candidate.folder
          }));
        }
        itemRow.appendChild(el("span", {
          className: "wh-badge is-format",
          text: candidate.format
        }));
        const toggleCandidate = () => {
          if (isImporting)
            return;
          if (selectedZipEntryPaths.has(candidate.archivePath)) {
            selectedZipEntryPaths.delete(candidate.archivePath);
          } else {
            selectedZipEntryPaths.add(candidate.archivePath);
          }
          render();
        };
        itemRow.addEventListener("click", (e) => {
          if (e.target === cb)
            return;
          toggleCandidate();
        });
        cb.addEventListener("change", () => {
          toggleCandidate();
        });
        listEl.appendChild(itemRow);
      }
      contentsPanel.appendChild(listEl);
      if (totalImportPages > 1) {
        const rangeStart = importStartIdx + 1;
        const rangeEnd = Math.min(inspectedZip.entries.length, importStartIdx + importPageSlice.length);
        const prevBtn = el("button", {
          className: "wh-mini-btn",
          text: "← Prev",
          attrs: { type: "button" },
          on: {
            click: () => {
              if (importPage > 0) {
                importPage -= 1;
                render();
              }
            }
          }
        });
        prevBtn.disabled = importPage <= 0;
        const nextBtn = el("button", {
          className: "wh-mini-btn",
          text: "Next →",
          attrs: { type: "button" },
          on: {
            click: () => {
              if (importPage < totalImportPages - 1) {
                importPage += 1;
                render();
              }
            }
          }
        });
        nextBtn.disabled = importPage >= totalImportPages - 1;
        contentsPanel.appendChild(el("div", { className: "wh-pager" }, [
          el("span", {
            text: `Showing ${rangeStart.toLocaleString()}–${rangeEnd.toLocaleString()} of ${inspectedZip.entries.length.toLocaleString()} • Page ${importPage + 1} of ${totalImportPages}`
          }),
          el("div", { className: "wh-pager-controls" }, [prevBtn, nextBtn])
        ]));
      }
      if (isImporting) {
        progressLabelEl = el("div", {
          className: "wh-panel-title",
          text: importStatusText || "Importing..."
        });
        progressPctEl = el("span", { text: `${Math.round(importProgressPct)}%` });
        progressSubLabelEl = el("span", { text: importSubStatusText });
        progressFillEl = el("div", {
          className: "wh-progress-fill",
          style: { width: `${importProgressPct}%` }
        });
        contentsPanel.appendChild(el("div", { className: "wh-progress-box" }, [
          el("div", { className: "wh-panel-header" }, [progressLabelEl, progressPctEl]),
          el("div", { className: "wh-progress-track" }, [progressFillEl]),
          el("div", { className: "wh-progress-meta" }, [progressSubLabelEl])
        ]));
        contentsPanel.appendChild(el("button", {
          className: "wh-secondary-btn wh-danger-btn",
          text: "Cancel Import",
          attrs: { type: "button" },
          on: {
            click: () => {
              importCancelRequested = true;
              if (activeImportJobId) {
                fetch(`/api/v1/characters/import-jobs/${encodeURIComponent(activeImportJobId)}/cancel`, { method: "POST" }).catch(() => {});
              }
            }
          }
        }));
      } else {
        const importBtn = el("button", {
          className: "wh-primary-btn",
          text: `Import ${selectedZipEntryPaths.size} Character${selectedZipEntryPaths.size === 1 ? "" : "s"} into Lumiverse`,
          attrs: { type: "button" },
          on: {
            click: () => {
              runBatchImport();
            }
          }
        });
        importBtn.disabled = selectedZipEntryPaths.size === 0;
        contentsPanel.appendChild(importBtn);
      }
      container.appendChild(contentsPanel);
    }
    if (importResultsSummary) {
      const summaryPanel = el("div", { className: "wh-panel" });
      summaryPanel.appendChild(el("div", { className: "wh-panel-header" }, [
        el("span", { className: "wh-panel-title", text: "Import Summary" }),
        el("span", {
          className: "wh-panel-subtitle",
          text: `${importResultsSummary.imported} imported • ${importResultsSummary.skipped} skipped • ${importResultsSummary.failed} failed${importResultsSummary.foldersRestored > 0 ? ` • ${importResultsSummary.foldersRestored} folders restored` : ""}`
        })
      ]));
      if (importResultsSummary.items.length > 0) {
        const logList = el("div", { className: "wh-log-list" });
        for (const item of importResultsSummary.items) {
          const statusClass = item.status === "imported" ? "wh-status-ok" : item.status === "skipped" ? "wh-status-skip" : "wh-status-err";
          logList.appendChild(el("div", { className: "wh-log-item" }, [
            el("span", {
              style: { fontWeight: "500", overflow: "hidden", textOverflow: "ellipsis" },
              text: item.name
            }),
            el("span", {
              className: statusClass,
              text: item.detail || item.status
            })
          ]));
        }
        summaryPanel.appendChild(logList);
      }
      container.appendChild(summaryPanel);
    }
    return container;
  }
  function render() {
    progressLabelEl = null;
    progressSubLabelEl = null;
    progressFillEl = null;
    progressPctEl = null;
    charListContainerEl = null;
    charListPagerEl = null;
    selectionSummaryEl = null;
    exportButtonEl = null;
    queryErrorsContainerEl = null;
    const activeRoot = activeModal ? modalRoot : drawerRoot;
    drawerRoot.innerHTML = "";
    modalRoot.innerHTML = "";
    if (activeModal) {
      activeModal.setTitle(`Warehouse — Batch Character ${activeMode === "export" ? "Export" : "Import"} (${characters.length.toLocaleString()} cards)`);
      drawerRoot.appendChild(el("div", { className: "wh-panel wh-modal-placeholder" }, [
        el("div", {
          className: "wh-panel-title",
          text: "Warehouse is open in Modal View"
        }),
        el("div", {
          className: "wh-panel-subtitle",
          text: "Using wide multi-column layout for large character libraries."
        }),
        el("button", {
          className: "wh-secondary-btn",
          text: "Switch Back to Sidebar View",
          attrs: { type: "button" },
          on: {
            click: () => {
              closeWarehouseModal();
            }
          }
        })
      ]));
    }
    const modeBar = el("div", { className: "wh-mode-bar" }, [
      el("button", {
        className: `wh-mode-btn${activeMode === "export" ? " is-active" : ""}`,
        text: "Batch Export (.ZIP)",
        attrs: { type: "button" },
        on: {
          click: () => {
            if (activeMode !== "export") {
              activeMode = "export";
              render();
            }
          }
        }
      }),
      el("button", {
        className: `wh-mode-btn${activeMode === "import" ? " is-active" : ""}`,
        text: "Batch Import (.ZIP)",
        attrs: { type: "button" },
        on: {
          click: () => {
            if (activeMode !== "import") {
              activeMode = "import";
              render();
            }
          }
        }
      })
    ]);
    const surfaceToggleBtn = el("button", {
      className: "wh-surface-btn",
      text: activeModal ? "Dock to Sidebar" : "Pop Out Modal ⤢",
      attrs: {
        type: "button",
        title: activeModal ? "Close modal and return to the sidebar drawer" : "Open Warehouse in a large multi-column modal window"
      },
      on: {
        click: () => {
          if (activeModal) {
            closeWarehouseModal();
          } else {
            openWarehouseModal(activeMode);
          }
        }
      }
    });
    const topBarWrap = el("div", { className: "wh-mode-bar-wrap" }, [
      modeBar,
      surfaceToggleBtn
    ]);
    activeRoot.appendChild(topBarWrap);
    if (activeMode === "export") {
      activeRoot.appendChild(renderExportView());
    } else {
      activeRoot.appendChild(renderImportView());
    }
  }
  ctx.onBackendMessage((rawData) => {
    if (!rawData || typeof rawData !== "object")
      return;
    const msg = rawData;
    switch (msg.type) {
      case "preferences_loaded": {
        preferences = { ...preferences, ...msg.preferences };
        render();
        break;
      }
      case "open_tab": {
        activeMode = msg.mode === "import" ? "import" : "export";
        const targetSurface = msg.surface || preferences.defaultSurface || "modal";
        if (targetSurface === "modal") {
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
      case "archive_ready": {
        const pending = pendingAssemblies.get(msg.jobId);
        if (pending) {
          pendingAssemblies.delete(msg.jobId);
          pending.resolve({
            fileId: msg.fileId,
            fileName: msg.fileName,
            size: msg.size
          });
        }
        break;
      }
      case "archive_error": {
        const pending = pendingAssemblies.get(msg.jobId);
        if (pending) {
          pendingAssemblies.delete(msg.jobId);
          pending.reject(new Error(msg.error || "Archive creation failed"));
        }
        break;
      }
    }
  });
  render();
  sendToBackend({ type: "load_preferences" });
  loadCharacterLibrary();
}
export {
  setup
};
