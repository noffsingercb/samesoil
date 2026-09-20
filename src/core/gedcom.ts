import type { GedcomEncoding, GedcomSource } from "./adapters.js";

export interface DecodeResult {
  readonly text: string;
  readonly encoding: Exclude<GedcomEncoding, "unknown">;
  readonly unmappableBytes: number;
}

export interface GedcomLine {
  readonly index: number;
  readonly lineNo: number;
  readonly raw: string;
  readonly level: number;
  readonly xref: string | null;
  readonly tag: string;
  readonly value: string;
  readonly parentIndex: number | null;
}

export interface GedcomParseResult {
  readonly lines: ReadonlyArray<GedcomLine>;
  readonly unparsed: ReadonlyArray<{ readonly lineNo: number; readonly raw: string }>;
  readonly countsByTag: Readonly<Record<string, number>>;
}

const CP1252: Readonly<Record<number, string>> = {
  128: "€", 130: "‚", 131: "ƒ", 132: "„", 133: "…", 134: "†", 135: "‡",
  136: "ˆ", 137: "‰", 138: "Š", 139: "‹", 140: "Œ", 142: "Ž", 145: "‘",
  146: "’", 147: "“", 148: "”", 149: "•", 150: "–", 151: "—", 152: "˜",
  153: "™", 154: "š", 155: "›", 156: "œ", 158: "ž", 159: "Ÿ"
};

const ANSEL_CHARACTERS: Readonly<Record<number, string>> = {
  0xa1: "Ł", 0xa2: "Ø", 0xa3: "Đ", 0xa4: "Þ", 0xa5: "Æ", 0xa6: "Œ",
  0xa7: "ʹ", 0xa8: "·", 0xa9: "♭", 0xaa: "®", 0xab: "±", 0xac: "Ơ",
  0xad: "Ư", 0xae: "ʼ", 0xb0: "ʻ", 0xb1: "ł", 0xb2: "ø", 0xb3: "đ",
  0xb4: "þ", 0xb5: "æ", 0xb6: "œ", 0xb7: "ʺ", 0xb8: "ı", 0xb9: "£",
  0xba: "ð", 0xbc: "ơ", 0xbd: "ư", 0xc0: "°", 0xc1: "ℓ", 0xc2: "℗",
  0xc3: "©", 0xc4: "♯", 0xc5: "¿", 0xc6: "¡", 0xc7: "ß", 0xc8: "€"
};

const ANSEL_COMBINING: Readonly<Record<number, string>> = {
  0xe0: "\u0309", 0xe1: "\u0300", 0xe2: "\u0301", 0xe3: "\u0302",
  0xe4: "\u0303", 0xe5: "\u0304", 0xe6: "\u0306", 0xe7: "\u0307",
  0xe8: "\u0308", 0xe9: "\u030c", 0xea: "\u030a", 0xeb: "\u0361",
  0xec: "\u0315", 0xed: "\u030b", 0xee: "\u0310", 0xef: "\u0327",
  0xf0: "\u0328", 0xf1: "\u0323", 0xf2: "\u0324", 0xf3: "\u0325",
  0xf4: "\u0333", 0xf5: "\u0332", 0xf6: "\u0326", 0xf7: "\u031c",
  0xf8: "\u032e", 0xf9: "\u0360", 0xfa: "\u0317", 0xfb: "\u0316",
  0xfe: "\u0313"
};

function decodeSingleByte(bytes: Uint8Array, table: Readonly<Record<number, string>>, ansel: boolean): { text: string; unmappable: number } {
  let output = "";
  let pendingMarks = "";
  let unmappable = 0;
  for (const byte of bytes) {
    if (ansel && ANSEL_COMBINING[byte] !== undefined) {
      pendingMarks += ANSEL_COMBINING[byte];
      continue;
    }
    let character: string | undefined;
    if (byte < 128 || (byte >= 160 && !ansel)) character = String.fromCodePoint(byte);
    else character = table[byte];
    if (character === undefined) {
      character = "\ufffd";
      unmappable += 1;
    }
    output += character + pendingMarks;
    pendingMarks = "";
  }
  if (pendingMarks.length > 0) {
    output += "\ufffd" + pendingMarks;
    unmappable += 1;
  }
  return { text: output.normalize("NFC"), unmappable };
}

function decodeUtf8(bytes: Uint8Array): { text: string; unmappable: number } {
  let output = "";
  let unmappable = 0;
  for (let index = 0; index < bytes.length;) {
    const first = bytes[index] ?? 0;
    if (first < 128) { output += String.fromCodePoint(first); index += 1; continue; }
    const width = first >= 0xc2 && first <= 0xdf ? 2 : first >= 0xe0 && first <= 0xef ? 3 : first >= 0xf0 && first <= 0xf4 ? 4 : 0;
    if (width === 0 || index + width > bytes.length) { output += "\ufffd"; unmappable += 1; index += 1; continue; }
    const sequence = Array.from(bytes.slice(index, index + width));
    if (sequence.slice(1).some((value) => value < 0x80 || value > 0xbf)) { output += "\ufffd"; unmappable += 1; index += 1; continue; }
    let point = width === 2 ? first & 0x1f : width === 3 ? first & 0x0f : first & 0x07;
    for (const continuation of sequence.slice(1)) point = (point << 6) | (continuation & 0x3f);
    const overlong = (width === 2 && point < 0x80) || (width === 3 && point < 0x800) || (width === 4 && point < 0x10000);
    if (overlong || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) { output += "\ufffd"; unmappable += 1; index += 1; continue; }
    output += String.fromCodePoint(point); index += width;
  }
  return { text: output, unmappable };
}

function decodeUtf16(bytes: Uint8Array, littleEndian: boolean, offset: number): { text: string; unmappable: number } {
  let output = "";
  let unmappable = 0;
  for (let index = offset; index + 1 < bytes.length; index += 2) {
    const unit = littleEndian ? (bytes[index] ?? 0) | ((bytes[index + 1] ?? 0) << 8) : ((bytes[index] ?? 0) << 8) | (bytes[index + 1] ?? 0);
    if (unit >= 0xd800 && unit <= 0xdbff && index + 3 < bytes.length) {
      const next = littleEndian ? (bytes[index + 2] ?? 0) | ((bytes[index + 3] ?? 0) << 8) : ((bytes[index + 2] ?? 0) << 8) | (bytes[index + 3] ?? 0);
      if (next >= 0xdc00 && next <= 0xdfff) { output += String.fromCodePoint(0x10000 + ((unit - 0xd800) << 10) + next - 0xdc00); index += 2; continue; }
    }
    if (unit >= 0xd800 && unit <= 0xdfff) { output += "\ufffd"; unmappable += 1; } else output += String.fromCodePoint(unit);
  }
  if ((bytes.length - offset) % 2 !== 0) { output += "\ufffd"; unmappable += 1; }
  return { text: output, unmappable };
}

function sniffHeader(bytes: Uint8Array): string {
  return Array.from(bytes.slice(0, 4096), (byte) => byte < 128 ? String.fromCodePoint(byte) : " ").join("").toUpperCase();
}

export function decodeGedcom(source: GedcomSource): DecodeResult {
  const bytes = source.bytes;
  const header = sniffHeader(bytes);
  let encoding: Exclude<GedcomEncoding, "unknown">;
  if (source.encodingHint !== "unknown") encoding = source.encodingHint;
  else if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) encoding = "UTF-16";
  else if (/\b1 CHAR ANSEL\b/.test(header)) encoding = "ANSEL";
  else if (/\b1 CHAR (ANSI|WINDOWS|CP1252)\b/.test(header)) encoding = "CP1252";
  else encoding = "UTF-8";
  if (encoding === "UTF-16") {
    const bigEndian = bytes[0] === 0xfe && bytes[1] === 0xff;
    const hasBom = (bytes[0] === 0xff && bytes[1] === 0xfe) || bigEndian;
    const decoded = decodeUtf16(bytes, !bigEndian, hasBom ? 2 : 0);
    return { text: decoded.text, encoding, unmappableBytes: decoded.unmappable };
  }
  const offset = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  const body = bytes.slice(offset);
  const decoded = encoding === "UTF-8" ? decodeUtf8(body) : encoding === "ANSEL" ? decodeSingleByte(body, ANSEL_CHARACTERS, true) : decodeSingleByte(body, CP1252, false);
  return { text: decoded.text, encoding, unmappableBytes: decoded.unmappable };
}

export function parseGedcom(text: string): GedcomParseResult {
  const rawLines = text.replace(/^\ufeff/, "").split(/\r\n|\n|\r/);
  if (rawLines.at(-1) === "") rawLines.pop();
  const lines: GedcomLine[] = [];
  const unparsed: Array<{ lineNo: number; raw: string }> = [];
  const counts = new Map<string, number>();
  const stack: Array<number | undefined> = [];
  for (let rawIndex = 0; rawIndex < rawLines.length; rawIndex += 1) {
    const raw = rawLines[rawIndex] ?? "";
    const match = /^(\d+)\s+(?:(@[^@\s]+@)\s+)?([^\s]+)(?:\s(.*))?$/.exec(raw);
    const level = match === null ? 0 : Number(match[1]);
    while (stack.length > level) stack.pop();
    const parentIndex = level === 0 ? null : stack[level - 1] ?? null;
    const line: GedcomLine = match === null
      ? { index: lines.length, lineNo: rawIndex + 1, raw, level, xref: null, tag: "_UNPARSED", value: raw, parentIndex }
      : { index: lines.length, lineNo: rawIndex + 1, raw, level, xref: match[2] ?? null, tag: (match[3] ?? "").toUpperCase(), value: match[4] ?? "", parentIndex };
    if (match === null) unparsed.push({ lineNo: rawIndex + 1, raw });
    lines.push(line);
    counts.set(line.tag, (counts.get(line.tag) ?? 0) + 1);
    stack[level] = line.index;
    stack.length = level + 1;
  }
  return { lines, unparsed, countsByTag: Object.fromEntries([...counts.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) };
}

export function childrenOf(lines: ReadonlyArray<GedcomLine>, parentIndex: number): ReadonlyArray<GedcomLine> {
  return lines.filter((line) => line.parentIndex === parentIndex);
}

export function assembledValue(lines: ReadonlyArray<GedcomLine>, line: GedcomLine): string {
  let value = line.value;
  for (const child of childrenOf(lines, line.index)) {
    if (child.tag === "CONC") value += child.value;
    else if (child.tag === "CONT") value += `\n${child.value}`;
  }
  return value;
}
