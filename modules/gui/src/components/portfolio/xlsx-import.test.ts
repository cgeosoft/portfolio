/** XLSX reader: sheet choice, shared strings, styles and dates, cell placement and errors. */
import { describe, expect, it } from "bun:test";
import JSZip from "jszip";
import { isZip, parseXlsx } from "./xlsx-import";
import { applyTemplateToHeaders, buildTransactions, detectBestTemplate } from "./csv-import";

async function book(parts: Record<string, string>): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [k, v] of Object.entries(parts)) zip.file(k, v);
  return zip.generateAsync({ type: "uint8array" });
}
const WB = (names: string[]) =>
  `<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`;
const RELS = (targets: string[]) =>
  `<?xml version="1.0"?><Relationships>${targets.map((t, i) => `<Relationship Id="rId${i + 1}" Type="x" Target="${t}"/>`).join("")}</Relationships>`;
const inline = (ref: string, text: string) => `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`;

const STYLES =
  '<styleSheet><numFmts count="3"><numFmt numFmtId="164" formatCode="dd/mm/yyyy hh:mm"/><numFmt numFmtId="165" formatCode="0.00"/><numFmt numFmtId="166" formatCode="&quot;day&quot; 0"/></numFmts><cellXfs count="5"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/><xf numFmtId="165"/><xf numFmtId="166"/></cellXfs></styleSheet>';
const SST =
  '<sst><si><t>Date</t></si><si><t>Type</t></si><si><t>Symbol</t></si><si><t>Amount</t></si><si><r><t>Bu</t></r><r><t>y</t></r></si><si><t>A&amp;B</t><rPh><t>XX</t></rPh></si><si/></sst>';
const SHEET =
  "<worksheet><sheetData>" +
  '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c><c r="E1" t="inlineStr"><is><t>Flag</t></is></c></row>' +
  '<row r="2"><c r="A2" s="1"><v>45659</v></c><c r="B2" t="s"><v>4</v></c><c r="C2" t="inlineStr"><is><t>AAPL</t></is></c><c r="D2" s="3"><v>-200.5</v></c><c r="E2" t="b"><v>1</v></c></row>' +
  '<row r="3"><c r="A3" s="2"><v>45659.5</v></c><c r="B3" t="s"><v>5</v></c><c r="D3" s="4"><v>7</v></c><c r="E3" t="b"><v>0</v></c></row>' +
  '<row r="4"/>' +
  '<row r="5"><c r="C5" t="str"><v> &lt;x&gt; &#x41;&#66; </v></c><c r="F5" t="s"><v>6</v></c></row>' +
  "</sheetData></worksheet>";

const main = await book({
  "xl/workbook.xml": WB(["Summary", "Transactions"]),
  "xl/_rels/workbook.xml.rels": RELS(["worksheets/sheet1.xml", "/xl/worksheets/sheet2.xml"]),
  "xl/worksheets/sheet1.xml": `<worksheet><sheetData><row r="1">${inline("A1", "wrong")}</row></sheetData></worksheet>`,
  "xl/worksheets/sheet2.xml": SHEET,
  "xl/sharedStrings.xml": SST,
  "xl/styles.xml": STYLES,
});

async function rejection(p: Promise<unknown>): Promise<any> {
  try {
    await p;
  } catch (err) {
    return err;
  }
  throw new Error("expected a rejection");
}

describe("parseXlsx", () => {
  it("reads the preferred sheet with shared strings, styles and dates", async () => {
    expect(await parseXlsx(main)).toEqual({
      headers: ["Date", "Type", "Symbol", "Amount", "Flag"],
      rows: [
        ["2025-01-02", "Buy", "AAPL", "-200.5", "TRUE"],
        ["2025-01-02T12:00:00", "A&B", "", "7", "FALSE"],
        ["", "", "<x> AB", "", "", ""],
      ],
    });
  });

  it("accepts an ArrayBuffer", async () => {
    const buffer = main.buffer.slice(main.byteOffset, main.byteOffset + main.byteLength) as ArrayBuffer;
    expect((await parseXlsx(buffer)).headers).toEqual(["Date", "Type", "Symbol", "Amount", "Flag"]);
  });

  it("works without styles and shared strings and places cells without a reference", async () => {
    const bytes = await book({
      "xl/workbook.xml": WB(["Sheet1"]),
      "xl/_rels/workbook.xml.rels": RELS(["worksheets/sheet1.xml"]),
      "xl/worksheets/sheet1.xml":
        '<worksheet><sheetData><row><c><v>45659</v></c><c t="inlineStr"><is><t>x</t></is></c></row><row><c r="C2"><v>1</v></c></row></sheetData></worksheet>',
    });
    expect(await parseXlsx(bytes)).toEqual({ headers: ["45659", "x"], rows: [["", "", "1"]] });
  });

  it("ranks account activity above transactions", async () => {
    const sheet = (text: string) => `<worksheet><sheetData><row r="1">${inline("A1", text)}</row></sheetData></worksheet>`;
    const bytes = await book({
      "xl/workbook.xml": WB(["Transactions", "Account Activity", "Other"]),
      "xl/_rels/workbook.xml.rels": RELS(["worksheets/sheet1.xml", "worksheets/sheet2.xml", "worksheets/sheet3.xml"]),
      "xl/worksheets/sheet1.xml": sheet("T"),
      "xl/worksheets/sheet2.xml": sheet("AA"),
      "xl/worksheets/sheet3.xml": sheet("O"),
    });
    expect(await parseXlsx(bytes)).toEqual({ headers: ["AA"], rows: [] });
  });

  it("rejects a workbook without sheets", async () => {
    const bytes = await book({ "xl/workbook.xml": "<workbook><sheets></sheets></workbook>" });
    expect((await rejection(parseXlsx(bytes))).message).toBe("The workbook has no sheets.");
  });

  it("rejects a sheet whose part is missing", async () => {
    const bytes = await book({
      "xl/workbook.xml": WB(["Data"]),
      "xl/_rels/workbook.xml.rels": RELS(["worksheets/missing.xml"]),
    });
    expect((await rejection(parseXlsx(bytes))).message).toBe('Sheet "Data" could not be read.');
  });

  it("rejects bytes that are not a zip", async () => {
    expect(await rejection(parseXlsx(new Uint8Array([1, 2, 3])))).toBeDefined();
  });

  it("feeds the CSV pipeline", async () => {
    const bytes = await book({
      "xl/workbook.xml": WB(["Sheet1"]),
      "xl/_rels/workbook.xml.rels": RELS(["worksheets/sheet1.xml"]),
      "xl/styles.xml": STYLES,
      "xl/worksheets/sheet1.xml":
        "<worksheet><sheetData>" +
        `<row r="1">${inline("A1", "Date")}${inline("B1", "Type")}${inline("C1", "Symbol")}${inline("D1", "Amount")}</row>` +
        `<row r="2"><c r="A2" s="1"><v>45659</v></c>${inline("B2", "Buy")}${inline("C2", "AAPL")}<c r="D2"><v>-100</v></c></row>` +
        "</sheetData></worksheet>",
    });
    const table = await parseXlsx(bytes);
    const template = detectBestTemplate(table.headers);
    const { mappings, defaultCurrency } = applyTemplateToHeaders(template, table.headers);
    const { transactions } = buildTransactions(table, mappings, { templateId: template, defaultCurrency: defaultCurrency ?? "EUR" });
    expect(transactions.length).toBe(1);
    expect(transactions[0]).toMatchObject({ date: "2025-01-02", type: "BUY", symbol: "AAPL", amount: -100 });
  });
});

describe("isZip", () => {
  it("checks the local file header signature", () => {
    expect(isZip(main)).toBe(true);
    expect(isZip(new Uint8Array([0x50, 0x4b, 3]))).toBe(false);
    expect(isZip(new Uint8Array([1, 2, 3, 4]))).toBe(false);
  });
});
