import type { EngineContext } from "../core/context.js";
import { decodeGedcom, parseGedcom, type GedcomLine } from "../core/gedcom.js";

const EVENT_TAGS = new Set([
  "BIRT", "CHR", "BAPM", "RESI", "CENS", "MARR", "DIV", "DEAT", "BURI",
  "IMMI", "EMIG", "MILI", "OCCU", "PROB", "WILL", "EVEN"
]);
const CLEAR_TABLES = [
  "scored_candidates", "suppression_log", "candidate_pairs", "presence_intervals",
  "kinship_distance", "kinship_edges", "event_dates", "events", "family_children",
  "families", "individuals", "raw_records"
] as const;

interface Root {
  readonly root: GedcomLine;
  readonly children: ReadonlyArray<GedcomLine>;
}
interface LineIndex {
  readonly childrenByParent: ReadonlyMap<number, ReadonlyArray<GedcomLine>>;
}

function buildLineIndex(lines: ReadonlyArray<GedcomLine>): LineIndex {
  const mutable = new Map<number, GedcomLine[]>();
  for (const line of lines) {
    if (line.parentIndex === null) continue;
    const siblings = mutable.get(line.parentIndex);
    if (siblings === undefined) mutable.set(line.parentIndex, [line]);
    else siblings.push(line);
  }
  return { childrenByParent: mutable };
}

function children(index: LineIndex, parent: number): ReadonlyArray<GedcomLine> {
  return index.childrenByParent.get(parent) ?? [];
}

function child(index: LineIndex, parent: number, tag: string): GedcomLine | undefined {
  return children(index, parent).find((line) => line.tag === tag);
}

function assembled(index: LineIndex, line: GedcomLine): string {
  let value = line.value;
  for (const continuation of children(index, line.index)) {
    if (continuation.tag === "CONC") value += continuation.value;
    else if (continuation.tag === "CONT") value += `\n${continuation.value}`;
  }
  return value;
}

function xref(value: string): string | null {
  return /^@[^@\s]+@$/.exec(value.trim())?.[0] ?? null;
}

function id(value: number | bigint): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new Error("SQLite row id exceeds safe integer range");
  return result;
}

function roots(lines: ReadonlyArray<GedcomLine>, index: LineIndex, tag: string): ReadonlyArray<Root> {
  const result: Root[] = [];
  for (const root of lines) {
    if (root.level === 0 && root.tag === tag) result.push({ root, children: children(index, root.index) });
  }
  return result;
}

function name(index: LineIndex, record: Root): { given: string | null; surname: string | null; full: string | null } {
  const line = record.children.find((item) => item.tag === "NAME");
  if (line === undefined) return { given: null, surname: null, full: null };
  const full = assembled(index, line).trim() || null;
  const givenLine = child(index, line.index, "GIVN");
  const surnameLine = child(index, line.index, "SURN");
  const slash = full === null ? null : /^(.*?)\s*\/([^/]*)\//.exec(full);
  return {
    given: givenLine === undefined ? (slash?.[1]?.trim() || null) : (assembled(index, givenLine).trim() || null),
    surname: surnameLine === undefined ? (slash?.[2]?.trim() || null) : (assembled(index, surnameLine).trim() || null),
    full
  };
}

function eventParts(index: LineIndex, line: GedcomLine): {
  type: string; date: string | null; place: string | null; sources: number; note: string | null;
} {
  const direct = children(index, line.index);
  const date = direct.find((item) => item.tag === "DATE");
  const place = direct.find((item) => item.tag === "PLAC");
  const note = direct.find((item) => item.tag === "NOTE");
  const type = direct.find((item) => item.tag === "TYPE");
  return {
    type: line.tag === "EVEN" && type !== undefined ? (assembled(index, type).trim() || "EVEN") : line.tag,
    date: date === undefined ? null : (assembled(index, date).trim() || null),
    place: place === undefined ? null : (assembled(index, place).trim() || null),
    sources: direct.filter((item) => item.tag === "SOUR").length,
    note: note === undefined ? null : (assembled(index, note).trim() || null)
  };
}

function rawBirthYear(record: Root, index: LineIndex): number | null {
  const birth = record.children.find((line) => line.tag === "BIRT");
  const date = birth === undefined ? undefined : child(index, birth.index, "DATE");
  const match = date === undefined ? null : /(\d{3,4})(?:\/\d{2,4})?/.exec(date.value);
  return match === null ? null : Number(match[1]);
}

function linkType(index: LineIndex, familyXref: string, childXref: string, peopleByXref: ReadonlyMap<string, Root>): string {
  const person = peopleByXref.get(childXref);
  const famc = person?.children.find((line) => line.tag === "FAMC" && xref(line.value) === familyXref);
  const pedi = famc === undefined ? undefined : child(index, famc.index, "PEDI")?.value.trim().toLowerCase();
  if (pedi === "adopted" || pedi === "adop") return "adopted";
  if (pedi === "foster") return "foster";
  if (pedi === "sealed" || pedi === "sealing") return "sealed";
  return "birth";
}

export async function run(ctx: EngineContext): Promise<void> {
  if (ctx.inputPath === undefined) throw new Error("ingest requires --gedcom <path>");
  ctx.progress.passStarted("ingest");

  const decoded = decodeGedcom(await ctx.fileSource.readGedcom(ctx.inputPath));
  const parsed = parseGedcom(decoded.text);
  const lineIndex = buildLineIndex(parsed.lines);
  const people = roots(parsed.lines, lineIndex, "INDI");
  const families = roots(parsed.lines, lineIndex, "FAM");
  const peopleByXref = new Map<string, Root>();
  for (const person of people) if (person.root.xref !== null) peopleByXref.set(person.root.xref, person);

  const personIds = new Map<string, number>();
  const familyIds = new Map<string, number>();
  const rawIds = new Map<number, number>();
  let eventCount = 0;

  ctx.storage.transaction((): void => {
    for (const table of CLEAR_TABLES) ctx.storage.run(`DELETE FROM ${table}`);

    let recordXref = "";
    for (const line of parsed.lines) {
      if (line.level === 0) recordXref = line.xref ?? "";
      const result = ctx.storage.run(
        "INSERT INTO raw_records(gedcom_xref,tag,level,value,parent_id,line_no) VALUES(?,?,?,?,?,?)",
        [recordXref, line.tag, line.level, line.value, line.parentIndex === null ? null : (rawIds.get(line.parentIndex) ?? null), line.lineNo]
      );
      rawIds.set(line.index, id(result.lastInsertRowid));
    }
    ctx.progress.progress("ingest", parsed.lines.length, parsed.lines.length);

    for (const person of people) {
      if (person.root.xref === null) continue;
      const parsedName = name(lineIndex, person);
      const sex = person.children.find((line) => line.tag === "SEX")?.value.trim() || null;
      const hasDeath = person.children.some((line) => line.tag === "DEAT" || line.tag === "BURI");
      const year = rawBirthYear(person, lineIndex);
      const living = !hasDeath && (year === null || year > ctx.config.privacy.living_cutoff_year);
      const result = ctx.storage.run(
        "INSERT INTO individuals(gedcom_xref,name_given,name_surname,name_full,sex,is_living,lifespan_src) VALUES(?,?,?,?,?,?,?)",
        [person.root.xref, parsedName.given, parsedName.surname, parsedName.full, sex, living ? 1 : 0, "unknown"]
      );
      personIds.set(person.root.xref, id(result.lastInsertRowid));
    }

    for (const family of families) {
      if (family.root.xref === null) continue;
      const husband = xref(family.children.find((line) => line.tag === "HUSB")?.value ?? "");
      const wife = xref(family.children.find((line) => line.tag === "WIFE")?.value ?? "");
      const result = ctx.storage.run(
        "INSERT INTO families(gedcom_xref,husband_id,wife_id) VALUES(?,?,?)",
        [family.root.xref, husband === null ? null : (personIds.get(husband) ?? null), wife === null ? null : (personIds.get(wife) ?? null)]
      );
      familyIds.set(family.root.xref, id(result.lastInsertRowid));
    }

    for (const family of families) {
      if (family.root.xref === null) continue;
      const familyId = familyIds.get(family.root.xref);
      if (familyId === undefined) continue;
      for (const line of family.children) {
        if (line.tag !== "CHIL") continue;
        const childXref = xref(line.value);
        const childId = childXref === null ? undefined : personIds.get(childXref);
        if (childXref !== null && childId !== undefined) {
          ctx.storage.run(
            "INSERT INTO family_children(family_id,child_id,link_type) VALUES(?,?,?)",
            [familyId, childId, linkType(lineIndex, family.root.xref, childXref, peopleByXref)]
          );
        }
      }
    }

    const eventRows: Array<{ subjectType: "individual" | "family"; subjectId: number; line: GedcomLine }> = [];
    for (const person of people) {
      const subjectId = person.root.xref === null ? undefined : personIds.get(person.root.xref);
      if (subjectId !== undefined) for (const line of person.children) if (EVENT_TAGS.has(line.tag)) eventRows.push({ subjectType: "individual", subjectId, line });
    }
    for (const family of families) {
      const subjectId = family.root.xref === null ? undefined : familyIds.get(family.root.xref);
      if (subjectId !== undefined) for (const line of family.children) if (EVENT_TAGS.has(line.tag)) eventRows.push({ subjectType: "family", subjectId, line });
    }
    eventRows.sort((a, b) => a.line.lineNo - b.line.lineNo);
    for (const event of eventRows) {
      const data = eventParts(lineIndex, event.line);
      ctx.storage.run(
        "INSERT INTO events(subject_type,subject_id,event_type,date_raw,place_raw,source_count,note,line_no) VALUES(?,?,?,?,?,?,?,?)",
        [event.subjectType, event.subjectId, data.type, data.date, data.place, data.sources, data.note, event.line.lineNo]
      );
      eventCount += 1;
    }

    ctx.storage.run("INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", ["input_encoding", decoded.encoding]);
    ctx.storage.run("INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", ["input_unmappable_bytes", String(decoded.unmappableBytes)]);
  });

  const eventSubjects = ctx.storage.all<Readonly<Record<string, unknown>> & { readonly subject_id: number }>(
    "SELECT DISTINCT subject_id FROM events WHERE subject_type=? ORDER BY subject_id", ["individual"]
  );
  const withEvents = new Set(eventSubjects.map((row) => row.subject_id));
  const without = [...personIds.entries()].filter(([, personId]) => !withEvents.has(personId)).map(([personXref]) => personXref).sort();
  if (parsed.unparsed.length > 0) ctx.progress.warn(`${parsed.unparsed.length} GEDCOM lines were structurally unparsed`);
  ctx.progress.passFinished("ingest", {
    encoding: decoded.encoding,
    unmappableBytes: decoded.unmappableBytes,
    countsByTag: parsed.countsByTag,
    unparsedLines: parsed.unparsed.length,
    individuals: people.length,
    families: families.length,
    events: eventCount,
    individualsWithNoEvents: without
  });
}
