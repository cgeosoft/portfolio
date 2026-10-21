/**
 * Read the transaction sheet of an Excel workbook (.xlsx) into the same table
 * a CSV file gives. eToro, Saxo, XTB and Freedom24 export Excel only. An
 * .xlsx file is a zip of XML parts; this reads the shared strings, the cell
 * styles (to tell dates from numbers) and one sheet.
 */
import { normalizeHeader, tableFromRecords, type CsvTable } from "./csv-import";

/** Sheet names, normalised, that hold transactions, best first. */
const PREFERRED_SHEETS = [
  "accountactivity",
  "cashoperations",
  "cashoperationhistory",
  "transactions",
  "transactionoverview",
  "trades",
  "tradesexecuted",
  "history",
];

/** Built-in number formats that show a date or a time. */
const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

/** First bytes of a zip file, so an .xlsx is recognised whatever its name. */
export function isZip(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

function decodeXml(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? decodeXml(m[1]!) : undefined;
}

/** The text of an <si> or <is> element: every <t>, rich-text runs included, phonetic runs left out. */
function textOf(xml: string): string {
  const withoutPhonetic = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  let out = "";
  for (const m of withoutPhonetic.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) out += m[1];
  return decodeXml(out);
}

function sharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)].map((m) => (m[1] ? textOf(m[1]) : ""));
}

/** For each cell style index, whether it formats a date. */
function dateStyles(xml: string | undefined): boolean[] {
  if (!xml) return [];
  const custom = new Map<number, string>();
  for (const m of xml.matchAll(/<numFmt\s[^>]*>/g)) {
    const id = Number(attr(m[0], "numFmtId"));
    custom.set(id, attr(m[0], "formatCode") ?? "");
  }
  const cellXfs = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml)?.[1] ?? "";
  return [...cellXfs.matchAll(/<xf\s[^>]*?\/?>/g)].map((m) => {
    const id = Number(attr(m[0], "numFmtId") ?? 0);
    if (BUILTIN_DATE_FORMATS.has(id)) return true;
    const code = custom.get(id);
    // A date format has d, m or y outside quoted text and colour or locale brackets.
    return code !== undefined && /[dmy]/i.test(code.replace(/"[^"]*"|\[[^\]]*\]/g, ""));
  });
}

/** Excel's serial day number (1900 system) as an ISO date, with the time when it has one. */
function serialToIso(serial: number): string {
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const iso = new Date(ms).toISOString();
  return serial % 1 === 0 ? iso.slice(0, 10) : iso.slice(0, 19);
}

function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function sheetRecords(xml: string, strings: string[], isDate: boolean[]): string[][] {
  const records: string[][] = [];
  for (const row of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const record: string[] = [];
    let next = 0;
    for (const cell of (row[1] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cell[1] ?? "";
      const body = cell[2] ?? "";
      const ref = attr(` ${attrs}`, "r");
      const index = ref ? columnIndex(ref) : next;
      next = index + 1;
      const type = attr(` ${attrs}`, "t");
      const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value = "";
      if (type === "s") value = strings[Number(raw)] ?? "";
      else if (type === "inlineStr") value = textOf(/<is>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? "");
      else if (type === "b") value = raw === "1" ? "TRUE" : "FALSE";
      else if (raw !== undefined) {
        value = decodeXml(raw);
        const style = Number(attr(` ${attrs}`, "s") ?? 0);
        if ((type === undefined || type === "n") && isDate[style] && value !== "" && !isNaN(Number(value))) {
          value = serialToIso(Number(value));
        }
      }
      while (record.length < index) record.push("");
      record[index] = value.trim();
    }
    if (record.some((c) => c.length > 0)) records.push(record);
  }
  return records;
}

/** Read a workbook and return the table of its transaction sheet. */
export async function parseXlsx(data: ArrayBuffer | Uint8Array): Promise<CsvTable> {
  // JSZip loads on the first Excel import instead of with the app.
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(data);
  const read = (path: string) => zip.file(path)?.async("string");

  const workbook = (await read("xl/workbook.xml")) ?? "";
  const rels = (await read("xl/_rels/workbook.xml.rels")) ?? "";
  const targets = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\s[^>]*>/g)) {
    const id = attr(m[0], "Id");
    const target = attr(m[0], "Target");
    if (id && target) targets.set(id, target.replace(/^\/?(xl\/)?/, "xl/"));
  }
  const sheets = [...workbook.matchAll(/<sheet\s[^>]*>/g)].map((m) => ({
    name: attr(m[0], "name") ?? "",
    path: targets.get(attr(m[0], "r:id") ?? "") ?? "",
  }));
  if (sheets.length === 0) throw new Error("The workbook has no sheets.");

  const rank = (name: string) => {
    const i = PREFERRED_SHEETS.indexOf(normalizeHeader(name));
    return i === -1 ? PREFERRED_SHEETS.length : i;
  };
  const sheet = [...sheets].sort((a, b) => rank(a.name) - rank(b.name))[0]!;
  const xml = await read(sheet.path);
  if (!xml) throw new Error(`Sheet "${sheet.name}" could not be read.`);

  const strings = sharedStrings(await read("xl/sharedStrings.xml"));
  const isDate = dateStyles(await read("xl/styles.xml"));
  return tableFromRecords(sheetRecords(xml, strings, isDate));
}
