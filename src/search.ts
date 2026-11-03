import type { CharacterSummaryItem } from './types';

export type SearchField = 'name' | 'tag' | 'char' | 'folder' | 'author';

export interface SearchTerm {
  field: SearchField;
  /** Already lower-cased and trimmed. Never empty on a well-formed term. */
  value: string;
  negated: boolean;
}

export interface SearchGroup {
  /** Non-empty in any group kept in `ParsedQuery.groups`. */
  terms: SearchTerm[];
}

export interface SearchSyntaxError {
  /** 0-based character offset in the raw input. */
  offset: number;
  /** Length of the offending slice (at least 1 when input is non-empty). */
  length: number;
  /** Short, user-facing description of the problem and how to fix it. */
  message: string;
}

export interface ParsedQuery {
  raw: string;
  /** OR-joined groups. Empty when the query is blank or contains no usable terms. */
  groups: SearchGroup[];
  errors: SearchSyntaxError[];
  /** True iff `errors.length === 0`. */
  ok: boolean;
  /** True iff `groups.length === 0` AND `errors.length === 0`. */
  isEmpty: boolean;
}

interface RawToken {
  text: string;
  offset: number;
}

function isWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}

/**
 * Scan a comma-separated group chunk into whitespace-delimited tokens while
 * preserving `"..."` quoted spans (e.g. `F:"Sci Fi"`, `A:"John Doe"`, `T:"Slice of Life"`).
 */
function scanTokens(input: string, groupStart: number, groupEnd: number): RawToken[] {
  const out: RawToken[] = [];
  let i = groupStart;
  while (i < groupEnd) {
    while (i < groupEnd && isWhitespace(input[i]!)) i++;
    if (i >= groupEnd) break;
    const start = i;
    let inQuotes = false;
    while (i < groupEnd) {
      const ch = input[i]!;
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

function stripOuterQuotes(val: string): string {
  const trimmed = val.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

const PREFIX_MAP: Record<string, SearchField> = {
  t: 'tag',
  c: 'char',
  f: 'folder',
  a: 'author',
};

const PREFIX_EXAMPLE_MAP: Record<string, string> = {
  T: 'T:Elf',
  C: 'C:John',
  F: 'F:Fantasy',
  A: 'A:Eleisea',
};

function parseSingleToken(token: RawToken): SearchTerm | SearchSyntaxError {
  const { text, offset } = token;
  let cursor = 0;
  let negated = false;

  if (text.startsWith('-')) {
    negated = true;
    cursor = 1;
  }

  const body = text.slice(cursor);
  if (body.length === 0) {
    return {
      offset,
      length: text.length,
      message: 'Dangling `-` — put a term after it, like `-T:Dark` or `-F:Archive`.',
    };
  }

  // Known prefix check: single letter ('T' | 'C' | 'F' | 'A', any case) followed by ':'.
  if (body.length >= 2 && body[1] === ':') {
    const prefixChar = body[0]!;
    const mappedField = PREFIX_MAP[prefixChar.toLowerCase()];
    if (mappedField) {
      const rawValue = stripOuterQuotes(body.slice(2));
      if (rawValue.length === 0) {
        const canonical = prefixChar.toUpperCase();
        const example = PREFIX_EXAMPLE_MAP[canonical] || `${canonical}:value`;
        return {
          offset,
          length: text.length,
          message: `\`${canonical}:\` requires a value — try \`${example}\`.`,
        };
      }
      return {
        field: mappedField,
        value: rawValue.toLowerCase(),
        negated,
      };
    }
  }

  const cleanedBare = stripOuterQuotes(body);
  if (cleanedBare.length === 0) {
    return {
      offset,
      length: text.length,
      message: 'Empty quoted search term — enter text inside quotes.',
    };
  }

  return {
    field: 'name',
    value: cleanedBare.toLowerCase(),
    negated,
  };
}

/**
 * Split `input` by commas that are outside `"..."` quotes.
 */
function splitGroupsRespectingQuotes(input: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  let groupStart = 0;
  let inQuotes = false;
  for (let i = 0; i <= input.length; i++) {
    const ch = i < input.length ? input[i]! : ',';
    if (ch === '"' && i < input.length) {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === ',' && !inQuotes) {
      spans.push({ start: groupStart, end: i });
      groupStart = i + 1;
    }
  }
  return spans;
}

export function parseQuery(rawInput: string): ParsedQuery {
  const raw = typeof rawInput === 'string' ? rawInput : '';
  const groups: SearchGroup[] = [];
  const errors: SearchSyntaxError[] = [];

  const groupSpans = splitGroupsRespectingQuotes(raw);
  for (const span of groupSpans) {
    const tokens = scanTokens(raw, span.start, span.end);
    if (tokens.length === 0) continue;

    const terms: SearchTerm[] = [];
    for (const tok of tokens) {
      const parsed = parseSingleToken(tok);
      if ('message' in parsed) {
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

export interface CharacterMatchContext {
  /** Lower-cased character display name. */
  nameLower: string;
  /** Lower-cased creator/author name. */
  creatorLower: string;
  /** Lower-cased trimmed folder name (`""` if unfiled). */
  folderLower: string;
  /** Set of lower-cased trimmed tag names assigned to the character. */
  tagKeys: ReadonlySet<string>;
}

export function buildCharacterMatchContext(char: CharacterSummaryItem): CharacterMatchContext {
  const tagKeys = new Set<string>();
  if (Array.isArray(char.tags)) {
    for (const t of char.tags) {
      if (typeof t === 'string') {
        const cleaned = t.trim().toLowerCase();
        if (cleaned) tagKeys.add(cleaned);
      }
    }
  }
  return {
    nameLower: (char.name || '').toLowerCase(),
    creatorLower: (char.creator || '').toLowerCase(),
    folderLower: (char.folder || '').trim().toLowerCase(),
    tagKeys,
  };
}

function evalPositiveTerm(term: SearchTerm, ctx: CharacterMatchContext): boolean {
  switch (term.field) {
    case 'name':
    case 'char':
      return ctx.nameLower.includes(term.value);
    case 'tag':
      return ctx.tagKeys.has(term.value);
    case 'folder':
      if (term.value === 'unfiled' || term.value === 'none') {
        return ctx.folderLower === '' || ctx.folderLower.includes(term.value);
      }
      return ctx.folderLower.includes(term.value);
    case 'author':
      return ctx.creatorLower.includes(term.value);
  }
}

function evalGroup(group: SearchGroup, ctx: CharacterMatchContext): boolean {
  for (const term of group.terms) {
    const hit = evalPositiveTerm(term, ctx);
    if (term.negated ? hit : !hit) return false;
  }
  return true;
}

export function evaluateCharacterQuery(query: ParsedQuery, ctx: CharacterMatchContext): boolean {
  if (query.groups.length === 0) return true;
  for (const group of query.groups) {
    if (evalGroup(group, ctx)) return true;
  }
  return false;
}

export interface SearchHelpExample {
  syntax: string;
  meaning: string;
}

export interface SearchHelpSection {
  heading: string;
  intro?: string;
  examples: SearchHelpExample[];
}

export function getWarehouseSearchHelpSections(): SearchHelpSection[] {
  return [
    {
      heading: 'Prefixes',
      examples: [
        {
          syntax: 'Elf',
          meaning: 'No prefix searches character names, matching any part of the name.',
        },
        {
          syntax: 'T:Elf',
          meaning:
            'Tag name search. Matches the whole tag name, so T:Elf does not match a tag called ElfKing.',
        },
        {
          syntax: 'C:John',
          meaning: 'Character name search (explicit prefix). Matches any part of the character name.',
        },
        {
          syntax: 'F:Fantasy',
          meaning:
            'Folder search. Matches characters in a folder matching Fantasy (use F:unfiled for characters without a folder).',
        },
        {
          syntax: 'A:Eleisea',
          meaning:
            'Author / Creator search. Matches any part of the character creator field.',
        },
      ],
    },
    {
      heading: 'Combining terms',
      examples: [
        {
          syntax: 'T:Elf T:Magic',
          meaning: 'Spaces mean AND — the character needs both tags.',
        },
        {
          syntax: 'F:Fantasy A:Eleisea',
          meaning: 'Combines prefixes with AND — in folder Fantasy AND created by Eleisea.',
        },
        {
          syntax: 'T:Elf, T:Magic',
          meaning: 'Commas mean OR — the character needs either tag.',
        },
        {
          syntax: 'C:John, F:Sci-Fi T:Mecha',
          meaning: 'Mixes both: this reads as (C:John) OR (F:Sci-Fi AND T:Mecha).',
        },
      ],
    },
    {
      heading: 'Excluding results',
      examples: [
        {
          syntax: '-T:Dark',
          meaning: 'Put - in front of a term to exclude matches. Negation applies to the whole term.',
        },
        {
          syntax: 'F:Fantasy -A:Anon',
          meaning: 'Characters in the Fantasy folder whose creator does not match Anon.',
        },
        {
          syntax: 'T:Elf -T:Dark',
          meaning: 'Characters tagged Elf but not Dark.',
        },
      ],
    },
    {
      heading: 'Good to know',
      examples: [
        {
          syntax: 'elf',
          meaning:
            'Matching ignores case for both prefixes and values, so T:elf, f:FANTASY, and a:eleisea all work.',
        },
        {
          syntax: 'F:"My Folder"',
          meaning:
            'Wrap values containing spaces in double quotes, such as F:"My Folder", A:"Jane Doe", or T:"Slice of Life".',
        },
        {
          syntax: '(empty search box)',
          meaning: 'A blank search returns every character rather than no results.',
        },
      ],
    },
  ];
}

