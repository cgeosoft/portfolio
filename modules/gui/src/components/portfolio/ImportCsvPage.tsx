import { rpc } from "../../rpc";
import React, { useState, useRef, useMemo, useCallback, useEffect } from "react";
import {
  UploadCloud,
  FileSpreadsheet,
  Check,
  CheckCircle2,
  RefreshCw,
  AlertTriangle,
  FileCheck2,
  HelpCircle,
  ArrowRight,
  ArrowLeft,
  Layers,
} from "lucide-react";
import { Select } from "../common/Select";
import type { PortfolioTransaction } from "portfolio-shared/portfolio";
import { fmtCurrency } from "./utils";
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from "./PortfolioCard";

/** Shape of an ISIN. The service checks the check digit and looks up the ticker on import. */
const ISIN_PATTERN = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;

/** Dry-run rows rendered before "Show all": a long broker history renders thousands of rows. */
const PREVIEW_LIMIT = 200;

export type SystemFieldKey =
  | "none"
  | "transaction_id"
  | "date"
  | "datetime"
  | "type"
  | "symbol"
  | "isin"
  | "name"
  | "asset_class"
  | "category"
  | "shares"
  | "price"
  | "amount"
  | "fee"
  | "tax"
  | "currency";

interface SystemFieldDef {
  key: SystemFieldKey;
  label: string;
  required?: boolean;
  aliases: string[];
}

const SYSTEM_FIELDS: SystemFieldDef[] = [
  {
    key: "none",
    label: "(Ignore / Skip Column)",
    aliases: [],
  },
  {
    key: "transaction_id",
    label: "Transaction ID / Ref",
    aliases: [
      "transaction_id",
      "transactionid",
      "tx_id",
      "txid",
      "order_id",
      "orderid",
      "external_id",
      "externalid",
      "id",
      "auftragsnummer",
    ],
  },
  {
    key: "datetime",
    label: "Date & Time (ISO / Timestamp)",
    aliases: [
      "datetime",
      "date_time",
      "timestamp",
      "timestamp_utc",
      "date_and_time",
      "time",
    ],
  },
  {
    key: "date",
    label: "Date (YYYY-MM-DD)",
    required: true,
    aliases: [
      "date",
      "trade_date",
      "execution_date",
      "booking_date",
      "settlement_date",
      "datum",
      "valutadatum",
    ],
  },
  {
    key: "type",
    label: "Transaction Type (BUY/SELL/...)",
    required: true,
    aliases: [
      "type",
      "transaction_type",
      "action",
      "order_type",
      "operation",
      "side",
      "direction",
      "typ",
      "transaktionsart",
    ],
  },
  {
    key: "symbol",
    label: "Symbol / Ticker / ISIN",
    required: true,
    aliases: [
      "symbol",
      "ticker",
      "instrument",
      "asset",
      "code",
      "asset_id",
      "security",
      "wertpapiersymbol",
    ],
  },
  {
    key: "isin",
    label: "ISIN Code",
    aliases: [
      "isin",
      "isin_code",
      "security_id",
      "sec_id",
      "wkn",
    ],
  },
  {
    key: "name",
    label: "Asset / Security Name",
    aliases: [
      "name",
      "security_name",
      "asset_name",
      "title",
      "product",
      "bezeichnung",
      "name des wertpapiers",
    ],
  },
  {
    key: "asset_class",
    label: "Asset Class (Stock/Fund/Crypto)",
    aliases: [
      "asset_class",
      "assetclass",
      "security_type",
      "asset_type",
      "instrument_type",
      "gattung",
    ],
  },
  {
    key: "category",
    label: "Category / Sector",
    aliases: [
      "category",
      "sector",
      "group",
      "fund_category",
      "kategorie",
    ],
  },
  {
    key: "shares",
    label: "Shares / Quantity",
    aliases: [
      "shares",
      "quantity",
      "qty",
      "units",
      "amount_shares",
      "count",
      "number_of_shares",
      "no. of shares",
      "volume",
      "stueck",
      "anteile",
      "nominal",
    ],
  },
  {
    key: "price",
    label: "Unit Price",
    aliases: [
      "price",
      "unit_price",
      "share_price",
      "price / share",
      "rate",
      "cost_per_share",
      "execution_price",
      "exec_price",
      "kurs",
      "ausfuehrungskurs",
    ],
  },
  {
    key: "amount",
    label: "Total Amount / Net Value",
    aliases: [
      "amount",
      "total",
      "total_amount",
      "total (eur)",
      "total (usd)",
      "total (gbp)",
      "net_amount",
      "gross_amount",
      "value",
      "settlement_amount",
      "cost",
      "betrag",
      "gesamtbetrag",
    ],
  },
  {
    key: "fee",
    label: "Fee / Commission",
    aliases: [
      "fee",
      "fees",
      "charge amount (eur)",
      "commission",
      "commissions",
      "brokerage",
      "charges",
      "transaction_fee",
      "order_fee",
      "gebuehren",
      "spesen",
    ],
  },
  {
    key: "tax",
    label: "Tax / Withholding",
    aliases: [
      "tax",
      "taxes",
      "withholding tax (eur)",
      "withholding_tax",
      "vat",
      "steuern",
      "kapitalertragsteuer",
    ],
  },
  {
    key: "currency",
    label: "Currency (EUR, USD, ...)",
    aliases: [
      "currency",
      "currency (price / share)",
      "currency (total)",
      "curr",
      "ccy",
      "currency_code",
      "iso_currency",
      "waehrung",
    ],
  },
];

export interface CsvTemplate {
  id: string;
  name: string;
  badge?: string;
  description: string;
  defaultCurrency?: string;
  mappings: Record<string, SystemFieldKey>;
  signatureHeaders: string[];
}

export const CSV_TEMPLATES: CsvTemplate[] = [
  {
    id: "trade_republic",
    name: "Trade Republic",
    badge: "TR",
    description: "Standard Trade Republic statement / transaction export CSV",
    defaultCurrency: "EUR",
    signatureHeaders: ["datetime", "accounttype", "assetclass", "counterpartyiban", "mcccode", "paymentreference"],
    mappings: {
      datetime: "datetime",
      date: "date",
      type: "type",
      assetclass: "asset_class",
      name: "name",
      symbol: "symbol",
      shares: "shares",
      price: "price",
      amount: "amount",
      fee: "fee",
      tax: "tax",
      currency: "currency",
      transactionid: "transaction_id",
      category: "category",
    },
  },
  {
    id: "ibkr",
    name: "Interactive Brokers (IBKR)",
    badge: "IBKR",
    description: "Interactive Brokers Activity & Trades statement CSV",
    defaultCurrency: "USD",
    signatureHeaders: ["tradedate", "ibcommission", "proceeds", "assetcategory", "currencyprimary"],
    mappings: {
      tradedate: "date",
      date: "date",
      datetime: "datetime",
      timestamp: "datetime",
      symbol: "symbol",
      isin: "isin",
      description: "name",
      quantity: "shares",
      tradeprice: "price",
      price: "price",
      grossamount: "amount",
      netamount: "amount",
      proceeds: "amount",
      amount: "amount",
      ibcommission: "fee",
      commission: "fee",
      fee: "fee",
      withholdingtax: "tax",
      tax: "tax",
      currencyprimary: "currency",
      currency: "currency",
      buysell: "type",
      type: "type",
      assetcategory: "asset_class",
      transactionid: "transaction_id",
    },
  },
  {
    id: "scalable",
    name: "Scalable Capital / Baader",
    badge: "SC",
    description: "Scalable Capital / Baader Bank transaction export CSV",
    defaultCurrency: "EUR",
    signatureHeaders: ["valutadatum", "buchungsdatum", "transaktionsart", "wertpapierbezeichnung", "ausfuehrungskurs"],
    mappings: {
      valutadatum: "date",
      buchungsdatum: "date",
      datum: "date",
      date: "date",
      transaktionsart: "type",
      typ: "type",
      type: "type",
      isin: "isin",
      wertpapierbezeichnung: "name",
      name: "name",
      stueck: "shares",
      anzahl: "shares",
      shares: "shares",
      ausfuehrungskurs: "price",
      kurs: "price",
      price: "price",
      betrag: "amount",
      amount: "amount",
      gebuehren: "fee",
      spesen: "fee",
      fee: "fee",
      steuern: "tax",
      tax: "tax",
      waehrung: "currency",
      currency: "currency",
      referenz: "transaction_id",
      orderid: "transaction_id",
    },
  },
  {
    id: "degiro",
    name: "Degiro / Flatex",
    badge: "DG",
    description: "Degiro / Flatex transactions and portfolio statement CSV",
    defaultCurrency: "EUR",
    signatureHeaders: ["produkt", "aantal", "waarde", "autofx"],
    mappings: {
      datum: "date",
      date: "date",
      tijd: "datetime",
      time: "datetime",
      produkt: "name",
      name: "name",
      isin: "isin",
      symbol: "symbol",
      aantal: "shares",
      anzahl: "shares",
      shares: "shares",
      kurs: "price",
      price: "price",
      waarde: "amount",
      wert: "amount",
      gesamt: "amount",
      amount: "amount",
      gebuehren: "fee",
      kosten: "fee",
      fee: "fee",
      waehrung: "currency",
      currency: "currency",
      orderid: "transaction_id",
      referenz: "transaction_id",
    },
  },
  {
    id: "auto",
    name: "Auto-Detect (Smart Generic)",
    badge: "AUTO",
    description: "Intelligent automatic heuristic column detection for any broker",
    signatureHeaders: [],
    mappings: {},
  },
];

function normalizeHeaderStr(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function autoDetectAllFields(headers: string[]): SystemFieldKey[] {
  const assigned = new Set<SystemFieldKey>();
  const mappings: SystemFieldKey[] = new Array(headers.length).fill("none");

  // Pass 1: Exact alias matching
  headers.forEach((h, idx) => {
    const norm = normalizeHeaderStr(h);
    if (!norm) return;

    for (const def of SYSTEM_FIELDS) {
      if (def.key === "none" || assigned.has(def.key)) continue;
      for (const alias of def.aliases) {
        if (norm === normalizeHeaderStr(alias)) {
          mappings[idx] = def.key;
          assigned.add(def.key);
          return;
        }
      }
    }
  });

  return mappings;
}

function detectBestTemplate(headers: string[]): string {
  const normHeaders = headers.map((h) => normalizeHeaderStr(h));
  let bestTemplateId = "auto";
  let maxMatches = 0;

  for (const template of CSV_TEMPLATES) {
    if (template.id === "auto" || template.signatureHeaders.length === 0) continue;
    let matches = 0;
    for (const sig of template.signatureHeaders) {
      if (normHeaders.includes(sig)) {
        matches++;
      }
    }
    if (matches > maxMatches && matches >= 2) {
      maxMatches = matches;
      bestTemplateId = template.id;
    }
  }

  return bestTemplateId;
}

function applyTemplateToHeaders(
  templateId: string,
  headers: string[]
): { mappings: SystemFieldKey[]; defaultCurrency?: string | undefined } {
  const template = CSV_TEMPLATES.find((t) => t.id === templateId);
  if (!template || template.id === "auto") {
    return { mappings: autoDetectAllFields(headers) };
  }

  const assigned = new Set<SystemFieldKey>();
  const mappings: SystemFieldKey[] = new Array(headers.length).fill("none");

  headers.forEach((h, idx) => {
    const norm = normalizeHeaderStr(h);
    if (!norm) return;

    const mappedKey = template.mappings[norm];
    if (mappedKey && mappedKey !== "none" && !assigned.has(mappedKey)) {
      mappings[idx] = mappedKey;
      assigned.add(mappedKey);
    }
  });

  return { mappings, defaultCurrency: template.defaultCurrency };
}

function parseCsvContent(content: string): { headers: string[]; rows: string[][] } {
  let cleanContent = content;
  if (cleanContent.charCodeAt(0) === 0xfeff) {
    cleanContent = cleanContent.slice(1);
  }

  const rawLines = cleanContent
    .split(/\r\n|\n|\r/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (rawLines.length === 0) {
    return { headers: [], rows: [] };
  }

  const firstLine = rawLines[0]!;
  const commaCount = (firstLine.match(/,/g) || []).length;
  const semiCount = (firstLine.match(/;/g) || []).length;
  const tabCount = (firstLine.match(/\t/g) || []).length;

  let delimiter = ",";
  if (semiCount > commaCount && semiCount >= tabCount) {
    delimiter = ";";
  } else if (tabCount > commaCount && tabCount > semiCount) {
    delimiter = "\t";
  }

  const parseLine = (line: string): string[] => {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === delimiter && !inQuotes) {
        result.push(current.trim().replace(/^["']|["']$/g, ""));
        current = "";
      } else {
        current += char;
      }
    }
    result.push(current.trim().replace(/^["']|["']$/g, ""));
    return result;
  };

  const headers = parseLine(rawLines[0]!);
  const rows: string[][] = [];

  for (let i = 1; i < rawLines.length; i++) {
    const cols = parseLine(rawLines[i]!);
    if (cols.some((c) => c.length > 0)) {
      while (cols.length < headers.length) {
        cols.push("");
      }
      rows.push(cols);
    }
  }

  return { headers, rows };
}

function parseNumber(val: string | undefined): number | undefined {
  if (!val) return undefined;
  let str = val.trim();
  str = str.replace(/[€$£\s]/g, "");
  if (str.includes(",") && !str.includes(".")) {
    str = str.replace(",", ".");
  } else if (str.includes(".") && str.includes(",")) {
    if (str.indexOf(".") < str.indexOf(",")) {
      str = str.replace(/\./g, "").replace(",", ".");
    } else {
      str = str.replace(/,/g, "");
    }
  }
  const parsed = parseFloat(str);
  return isNaN(parsed) ? undefined : parsed;
}

function parseDateStr(val: string | undefined): string {
  if (!val) return new Date().toISOString().split("T")[0]!;
  const trimmed = val.trim();

  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    return trimmed.split("T")[0]!;
  }

  const euroMatch = trimmed.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  if (euroMatch) {
    const day = euroMatch[1]!.padStart(2, "0");
    const month = euroMatch[2]!.padStart(2, "0");
    const year = euroMatch[3]!;
    return `${year}-${month}-${day}`;
  }

  const d = new Date(trimmed);
  if (!isNaN(d.getTime())) {
    return d.toISOString().split("T")[0]!;
  }

  return new Date().toISOString().split("T")[0]!;
}

export interface TransactionFieldDiff {
  field: string;
  oldVal: unknown;
  newVal: unknown;
}

export interface ModifiedTransactionPreview {
  tx: PortfolioTransaction;
  diffs: TransactionFieldDiff[];
}

interface DryRunResult {
  count?: number;
  totalTransactions?: number;
  newTransactionsCount?: number;
  modifiedTransactionsCount?: number;
  unchangedTransactionsCount?: number;
  addedPreview?: PortfolioTransaction[];
  modifiedPreview?: ModifiedTransactionPreview[];
  unchangedPreview?: PortfolioTransaction[];
  // Legacy aliases
  newCount?: number;
  modifiedCount?: number;
  unchangedCount?: number;
  totalIncoming?: number;
  added?: PortfolioTransaction[];
  modified?: ModifiedTransactionPreview[];
  unchanged?: PortfolioTransaction[];
}

/** CSV rows shown under the column mapping as a sample. */
const MAPPING_SAMPLE_ROWS = 20;

const STEPS = [
  { key: "upload", label: "Select file" },
  { key: "mapping", label: "Map columns" },
  { key: "confirmation", label: "Review" },
  { key: "success", label: "Done" },
] as const;

type ImportStage = (typeof STEPS)[number]["key"];

/** The wizard steps: done steps carry a check, the current one the accent. */
function Stepper({ stage }: { stage: ImportStage }) {
  const current = STEPS.findIndex((s) => s.key === stage);
  return (
    <ol className="flex items-center gap-2 sm:gap-3 min-w-0 w-full">
      {STEPS.map((s, i) => {
        const done = i < current || stage === "success";
        const active = i === current && !done;
        return (
          <li key={s.key} className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1 last:flex-none">
            <div className="flex items-center gap-2 shrink-0">
              <span
                className={`w-6 h-6 rounded-full border flex items-center justify-center text-[11px] font-bold ${
                  done
                    ? "border-mint/50 bg-mint/15 text-mint"
                    : active
                      ? "border-accent-500 bg-accent-500/15 text-accent-bright"
                      : "border-slate-700 text-slate-500"
                }`}
              >
                {done ? <Check className="w-3.5 h-3.5" /> : i + 1}
              </span>
              <span
                className={`${active ? "inline" : "hidden sm:inline"} text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap ${
                  active ? "text-slate-100" : done ? "text-slate-300" : "text-slate-500"
                }`}
              >
                {s.label}
              </span>
            </div>
            {i < STEPS.length - 1 && <span className={`h-px flex-1 min-w-3 ${done ? "bg-mint/40" : "bg-slate-800"}`} />}
          </li>
        );
      })}
    </ol>
  );
}

interface ImportCsvPageProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => Promise<void> | void;
  portfolioId?: string | undefined;
  portfolioName?: string | undefined;
  baseCurrency?: string | undefined;
}

/**
 * Full-window wizard that imports a broker CSV into a portfolio: select the file, map its
 * columns, review the dry run, save. It stays mounted while closed, so the file and the
 * mapping survive closing and reopening.
 */
export function ImportCsvPage({
  isOpen,
  onClose,
  onSuccess,
  portfolioId,
  portfolioName,
  baseCurrency = "EUR",
}: ImportCsvPageProps) {
  const [fileName, setFileName] = useState<string>("");
  const [fileSize, setFileSize] = useState<number>(0);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [columnMappings, setColumnMappings] = useState<SystemFieldKey[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string>("auto");
  const [isDragging, setIsDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customBaseCurrency, setCustomBaseCurrency] = useState(baseCurrency);

  const [stage, setStage] = useState<ImportStage>("upload");
  const [dryRunData, setDryRunData] = useState<DryRunResult | null>(null);
  const [previewFilter, setPreviewFilter] = useState<"all" | "new" | "modified" | "unchanged">("all");
  const [showAllPreview, setShowAllPreview] = useState(false);
  const [successInfo, setSuccessInfo] = useState<{ total: number; newCount: number } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileProcess = useCallback((file: {name: string, content: string}) => {
    setError(null);
    setSuccessInfo(null);
    setDryRunData(null);
    setPreviewFilter("all");
    setFileName(file.name);
    setFileSize(file.content.length);

    try {
      const text = file.content;
        if (!text) {
          setError("File appears to be empty.");
          return;
        }

        const { headers: parsedHeaders, rows: parsedRows } = parseCsvContent(text);
        if (parsedHeaders.length === 0 || parsedRows.length === 0) {
          setError("Could not find any data rows or header columns in the CSV.");
          return;
        }

        setHeaders(parsedHeaders);
        setRows(parsedRows);

        const bestTpl = detectBestTemplate(parsedHeaders);
        setSelectedTemplate(bestTpl);

        const { mappings, defaultCurrency } = applyTemplateToHeaders(bestTpl, parsedHeaders);
        setColumnMappings(mappings);
        if (defaultCurrency) {
          setCustomBaseCurrency(defaultCurrency);
        }

        setStage("mapping");
      } catch (err) {
        console.error("[ImportCsvPage] Failed to parse CSV:", err);
        setError(err instanceof Error ? err.message : "Failed to parse CSV file.");
      }
  }, []);

  const handleTemplateChange = (templateId: string) => {
    setSelectedTemplate(templateId);
    if (templateId === "custom") return;

    const { mappings, defaultCurrency } = applyTemplateToHeaders(templateId, headers);
    setColumnMappings(mappings);
    if (defaultCurrency) {
      setCustomBaseCurrency(defaultCurrency);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (file) {
        const content = await file.text();
        handleFileProcess({ name: file.name, content });
      }
    }
  };

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const content = await file.text();
        handleFileProcess({ name: file.name, content });
      } catch (err) {
        console.error("[ImportCsvPage] Failed to read file:", err);
        setError("Failed to read selected file.");
      }
    }
  };

  const handleBrowseClick = () => {
    fileInputRef.current?.click();
  };

  const handleMappingChange = (index: number, newField: SystemFieldKey) => {
    setSelectedTemplate("custom");
    setColumnMappings((prev) => {
      const updated = [...prev];
      updated[index] = newField;
      return updated;
    });
  };

  const handleReset = () => {
    setFileName("");
    setFileSize(0);
    setHeaders([]);
    setRows([]);
    setColumnMappings([]);
    setSelectedTemplate("auto");
    setError(null);
    setDryRunData(null);
    setPreviewFilter("all");
    setSuccessInfo(null);
    setStage("upload");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const mappedSummary = useMemo(() => {
    const mappedKeys = new Set(columnMappings.filter((k) => k !== "none"));
    return {
      hasDate: mappedKeys.has("date") || mappedKeys.has("datetime"),
      hasType: mappedKeys.has("type"),
      hasSymbol: mappedKeys.has("symbol") || mappedKeys.has("isin"),
      count: mappedKeys.size,
    };
  }, [columnMappings]);

  // Construct structured transactions from parsed rows and active mappings
  const buildTransactions = useCallback((): PortfolioTransaction[] => {
    const transactions: PortfolioTransaction[] = [];

    const colIndexByField: Partial<Record<SystemFieldKey, number>> = {};
    columnMappings.forEach((f, idx) => {
      if (f !== "none" && colIndexByField[f] === undefined) {
        colIndexByField[f] = idx;
      }
    });

    const getVal = (rowCols: string[], field: SystemFieldKey): string => {
      const idx = colIndexByField[field];
      return idx !== undefined && idx >= 0 ? (rowCols[idx] ?? "").trim() : "";
    };

    // Stored tax is a cost: positive when paid, negative when refunded. Exports
    // that write paid tax as a negative number (Trade Republic) also write a
    // refund as a positive one, so flip the sign for those instead of using abs.
    const taxPaidIsNegative = rows.some((rowCols) => (parseNumber(getVal(rowCols, "tax")) ?? 0) < 0);

    for (let r = 0; r < rows.length; r++) {
      const rowCols = rows[r]!;

      const rawDatetime = getVal(rowCols, "datetime");
      const rawDate = getVal(rowCols, "date") || rawDatetime;
      const date = parseDateStr(rawDate);
      const datetime = rawDatetime || undefined;
      let rawType = (getVal(rowCols, "type") || "BUY").toUpperCase().replace(/\s+/g, "_");
      if (rawType.includes("BUY")) rawType = "BUY";
      else if (rawType.includes("SELL")) rawType = "SELL";
      else if (rawType.includes("DIVIDEND")) rawType = "DIVIDEND";
      else if (rawType.includes("DEPOSIT") || rawType.includes("INBOUND")) rawType = "CUSTOMER_INBOUND";
      else if (rawType.includes("WITHDRAWAL") || rawType.includes("OUTBOUND")) rawType = "CUSTOMER_OUTBOUND";
      else if (rawType.includes("INTEREST")) rawType = "INTEREST_PAYMENT";

      const rawIsin = getVal(rowCols, "isin");
      let rawSymbol = getVal(rowCols, "symbol");
      const category = getVal(rowCols, "category");
      const rawAssetClass = getVal(rowCols, "asset_class");

      // Trade Republic puts the ISIN in its symbol column. The service swaps an
      // ISIN-only symbol for the ticker (stored ISIN map, then provider search).
      const isinCandidate = (rawIsin || rawSymbol).toUpperCase();
      const isin = ISIN_PATTERN.test(isinCandidate) ? isinCandidate : undefined;
      let symbol = rawSymbol;

      if (!symbol && isin) {
        symbol = isin;
      } else if (!symbol && (category === "PRIVATE_FUND" || rawAssetClass === "PRIVATE_FUND")) {
        symbol = "LU3176111881";
      } else if (!symbol) {
        symbol = "CASH";
      }

      const name = getVal(rowCols, "name") || undefined;
      const shares = parseNumber(getVal(rowCols, "shares"));
      const price = parseNumber(getVal(rowCols, "price"));
      const amount = parseNumber(getVal(rowCols, "amount"));
      const fee = parseNumber(getVal(rowCols, "fee")) !== undefined ? Math.abs(parseNumber(getVal(rowCols, "fee"))!) : undefined;
      const rawTax = parseNumber(getVal(rowCols, "tax"));
      const tax = rawTax === undefined ? undefined : taxPaidIsNegative ? 0 - rawTax || 0 : Math.abs(rawTax);
      const currency = getVal(rowCols, "currency") || customBaseCurrency || "EUR";

      const isPrivate =
        category === "PRIVATE_FUND" ||
        rawAssetClass === "PRIVATE_FUND" ||
        symbol === "LU3176111881" ||
        Boolean(rawAssetClass && rawAssetClass.toUpperCase().includes("PRIVATE"));

      const assetClass = isPrivate ? "PRIVATE_FUND" : (rawAssetClass || (rawType.includes("CRYPTO") || symbol.includes("BTC") ? "CRYPTO" : undefined));

      const explicitTxId = getVal(rowCols, "transaction_id");
      const txId = explicitTxId || `tx_${date}_${rawType}_${symbol}_${amount ?? ""}_${shares ?? ""}_${r}`;

      transactions.push({
        id: txId,
        date,
        datetime,
        type: rawType,
        assetClass,
        name,
        symbol: symbol.toUpperCase(),
        isin,
        shares,
        price,
        amount,
        fee,
        tax,
        currency,
      });
    }

    return transactions;
  }, [rows, columnMappings, customBaseCurrency]);

  const targetUrl = useMemo(() => {
    return portfolioId
      ? `/api/portfolio/transactions/manage?portfolioId=${portfolioId}`
      : "/api/portfolio/transactions/manage";
  }, [portfolioId]);

  // Step 2 -> Step 3: Run Dry-Run Preview
  const handleProceedToDryRun = async () => {
    if (rows.length === 0) return;
    setSubmitting(true);
    setError(null);

    try {
      const transactions = buildTransactions();
      const json = await rpc.request.manageTransactions({ portfolioId: portfolioId ?? "", action: "import", dryRun: true, transactions });
      if (json.success === false) {
        throw new Error(json.error || "Dry run failed");
      }

      setDryRunData(json);
      setPreviewFilter("all");
      setShowAllPreview(false);
      setStage("confirmation");
    } catch (err) {
      console.error("[ImportCsvPage] Dry run error:", err);
      setError(err instanceof Error ? err.message : "Failed to execute dry run verification");
    } finally {
      setSubmitting(false);
    }
  };

  // Step 3 -> Final Execution: Commit Batch Import
  const handleFinalCommit = async () => {
    if (rows.length === 0) return;
    setSubmitting(true);
    setError(null);

    try {
      const transactions = buildTransactions();
      const json = await rpc.request.manageTransactions({ portfolioId: portfolioId ?? "", action: "import", dryRun: false, transactions });
      if (json.success === false) {
        throw new Error(json.error || "Import failed");
      }

      setSuccessInfo({
        total: json.totalTransactions ?? transactions.length,
        newCount: json.newTransactionsCount ?? transactions.length,
      });
      setStage("success");

      await onSuccess();
    } catch (err) {
      console.error("[ImportCsvPage] Final import commit error:", err);
      setError(err instanceof Error ? err.message : "Failed to commit transactions");
    } finally {
      setSubmitting(false);
    }
  };

  const activeTemplateObj = CSV_TEMPLATES.find((t) => t.id === selectedTemplate);

  const newItemsCount = dryRunData?.newTransactionsCount ?? dryRunData?.newCount ?? 0;
  const modItemsCount = dryRunData?.modifiedTransactionsCount ?? dryRunData?.modifiedCount ?? 0;
  const unchItemsCount = dryRunData?.unchangedTransactionsCount ?? dryRunData?.unchangedCount ?? 0;
  const totalCount = dryRunData?.totalIncoming ?? rows.length;

  const addedList = dryRunData?.addedPreview || dryRunData?.added || [];
  const modifiedList = dryRunData?.modifiedPreview || dryRunData?.modified || [];
  const unchangedList = dryRunData?.unchangedPreview || dryRunData?.unchanged || [];

  const previewItems = useMemo(() => {
    if (!dryRunData) return [];
    const items: Array<{
      tx: PortfolioTransaction;
      status: "new" | "modified" | "unchanged";
      diffs?: TransactionFieldDiff[];
    }> = [];

    const showAll = previewFilter === "all";

    if (showAll || previewFilter === "new") {
      addedList.forEach((t) => items.push({ tx: t, status: "new" }));
    }
    if (showAll || previewFilter === "modified") {
      modifiedList.forEach((m) =>
        items.push({ tx: m.tx, status: "modified", diffs: m.diffs })
      );
    }
    if (showAll || previewFilter === "unchanged") {
      unchangedList.forEach((t) =>
        items.push({ tx: t, status: "unchanged" })
      );
    }
    return items;
  }, [dryRunData, previewFilter, addedList, modifiedList, unchangedList]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented && !submitting) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, submitting, onClose]);

  if (!isOpen) return null;

  const reviewFilters = [
    { key: "all", label: "In file", count: totalCount, tone: "text-slate-100", on: "border-slate-500 bg-slate-800/60" },
    { key: "new", label: "New", count: newItemsCount, tone: "text-mint", on: "border-mint/60 bg-mint/10" },
    { key: "modified", label: "Modified", count: modItemsCount, tone: "text-cream", on: "border-cream/60 bg-cream/10" },
    { key: "unchanged", label: "Unchanged", count: unchItemsCount, tone: "text-slate-400", on: "border-slate-500 bg-slate-800/60" },
  ] as const;

  const missingFields = [
    !mappedSummary.hasDate && "Date",
    !mappedSummary.hasType && "Type",
    !mappedSummary.hasSymbol && "Symbol or ISIN",
  ].filter((f): f is string => Boolean(f));

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-canvas text-slate-100 font-mono animate-in fade-in duration-150">
      {/* Page header: back, title, steps */}
      <header className="shrink-0 border-b border-line bg-widget">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-8 py-4 flex flex-col lg:flex-row lg:items-center gap-4">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <button type="button" onClick={onClose} disabled={submitting} className={SECONDARY_BUTTON} title="Back (Escape)">
              <ArrowLeft className="w-3.5 h-3.5" />
              Back
            </button>
            <div className="min-w-0">
              <h1 className="flex items-center gap-2 min-w-0 text-sm font-bold uppercase tracking-wider text-slate-50 whitespace-nowrap">
                <FileSpreadsheet className="w-4 h-4 shrink-0 text-accent-500" />
                <span className="truncate">Import transactions</span>
              </h1>
              <p className="text-[11px] text-slate-500 truncate">
                {portfolioName ? (
                  <>
                    Into <span className="text-slate-300 font-semibold">{portfolioName}</span>. Nothing is saved before the last step.
                  </>
                ) : (
                  "Nothing is saved before the last step."
                )}
              </p>
            </div>
          </div>
          <div className="lg:w-[560px] shrink-0">
            <Stepper stage={stage} />
          </div>
        </div>
      </header>

      {/* Page body */}
      <main className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
        <div className="max-w-[1400px] mx-auto h-full px-4 sm:px-8 py-5 flex flex-col gap-4">
          {error && (
            <div className="shrink-0 p-3 rounded-xl border border-rose-800/50 bg-rose-950/40 text-rose-400 text-xs flex items-center gap-2.5">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* STEP 1: SELECT FILE */}
          {stage === "upload" && (
            <div className="flex flex-col lg:flex-row gap-4 flex-1 min-h-0">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv,text/plain"
                className="hidden"
                style={{ display: "none" }}
                onChange={handleFileInputChange}
              />
              <div
                role="button"
                tabIndex={0}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={handleBrowseClick}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleBrowseClick();
                  }
                }}
                className={`flex-1 min-h-[260px] border-2 border-dashed rounded-2xl p-6 sm:p-10 flex flex-col items-center justify-center gap-4 text-center cursor-pointer transition-colors focus-visible:outline-none focus-visible:border-accent-500 ${
                  isDragging
                    ? "border-accent-500 bg-accent-500/10"
                    : "border-slate-800 bg-widget/60 hover:border-accent-500/50 hover:bg-widget"
                }`}
              >
                <div className="w-14 h-14 rounded-2xl border border-accent-500/30 bg-accent-500/10 flex items-center justify-center text-accent-500">
                  <UploadCloud className="w-7 h-7" />
                </div>
                <div className="space-y-1">
                  <span className="block font-bold text-sm uppercase tracking-wider text-slate-100">Drop a CSV file here</span>
                  <span className="block text-xs text-slate-500">or click to choose one from your computer</span>
                </div>
                <span className={SECONDARY_BUTTON}>
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  Choose file
                </span>
                <span className="text-[11px] text-slate-500 max-w-md">
                  The file needs a header row and one row per transaction. Map at least a date, a type and a symbol or ISIN column.
                </span>
              </div>

              {/* Known broker formats */}
              <aside className="lg:w-80 shrink-0 cx-card rounded-2xl p-4 flex flex-col gap-3 min-h-0">
                <div className="text-[11px] uppercase font-bold tracking-wider text-slate-400 flex items-center gap-2">
                  <Layers className="w-3.5 h-3.5 text-accent-500" />
                  Recognised formats
                </div>
                <p className="text-[11px] text-slate-500">The columns of these exports are mapped for you. Any other CSV can be mapped by hand.</p>
                <ul className="flex flex-col gap-2 overflow-y-auto custom-scrollbar min-h-0">
                  {CSV_TEMPLATES.filter((t) => t.id !== "auto").map((tpl) => (
                    <li key={tpl.id} className="p-2.5 rounded-lg border border-line bg-card/60 flex flex-col gap-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-xs text-slate-200 truncate">{tpl.name}</span>
                        {tpl.badge && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-accent-500/15 text-accent-bright border border-accent-500/30 shrink-0">
                            {tpl.badge}
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-slate-500 line-clamp-2" title={tpl.description}>
                        {tpl.description}
                      </span>
                    </li>
                  ))}
                </ul>
              </aside>
            </div>
          )}

          {/* STEP 2: MAP COLUMNS */}
          {stage === "mapping" && (
            <div className="flex flex-col gap-4 flex-1 min-h-0">
              {/* File and template controls */}
              <div className="shrink-0 flex flex-col md:flex-row md:items-center justify-between gap-3 p-3 rounded-xl border border-line bg-widget text-xs">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-accent-500/10 border border-accent-500/30 flex items-center justify-center text-accent-500 shrink-0">
                    <FileSpreadsheet className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-bold text-slate-200 truncate" title={fileName}>{fileName}</div>
                    <div className="text-[11px] text-slate-500">
                      {(fileSize / 1024).toFixed(1)} KB · {rows.length} rows · {headers.length} columns
                    </div>
                  </div>
                  <button type="button" onClick={handleReset} className={SECONDARY_BUTTON}>
                    Change file
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 text-[11px] text-slate-400">
                    <span className="font-semibold uppercase tracking-wider">Format</span>
                    <Select
                      value={selectedTemplate}
                      onChange={(e) => handleTemplateChange(e.target.value)}
                      selectSize="sm"
                      tone="accent"
                      aria-label="CSV format"
                    >
                      {CSV_TEMPLATES.map((tpl) => (
                        <option key={tpl.id} value={tpl.id}>
                          {tpl.badge ? `[${tpl.badge}] ` : ""}{tpl.name}
                        </option>
                      ))}
                      <option value="custom">[MANUAL] Custom Column Mapping</option>
                    </Select>
                  </label>
                  <label className="flex items-center gap-2 text-[11px] text-slate-400">
                    <span className="font-semibold uppercase tracking-wider">Currency</span>
                    <Select
                      value={customBaseCurrency}
                      onChange={(e) => setCustomBaseCurrency(e.target.value)}
                      selectSize="sm"
                      wrapperClassName="shrink-0"
                      aria-label="Default currency"
                    >
                      <option value="EUR">EUR (€)</option>
                      <option value="USD">USD ($)</option>
                      <option value="GBP">GBP (£)</option>
                      <option value="CHF">CHF (Fr)</option>
                    </Select>
                  </label>
                </div>
              </div>

              <div className="shrink-0 text-[11px] text-slate-400 flex flex-wrap items-center justify-between gap-2 px-1">
                <span className="flex items-center gap-1.5">
                  <HelpCircle className="w-3.5 h-3.5 text-accent-500 shrink-0" />
                  {activeTemplateObj
                    ? `Mapped with the ${activeTemplateObj.name} format. Change any column below if it is wrong.`
                    : "Custom mapping. Pick a field for every column you want to import."}
                </span>
                <span className="font-bold text-accent-bright">
                  {mappedSummary.count} of {headers.length} columns mapped
                </span>
              </div>

              {/* Mapping and sample rows */}
              <div className="rounded-xl border border-line bg-widget overflow-hidden flex flex-col flex-1 min-h-[280px]">
                <div className="overflow-auto flex-1 min-h-0 custom-scrollbar">
                  <table className="w-full border-collapse text-xs font-mono">
                    <thead className="sticky top-0 z-10">
                      <tr className="bg-card border-b border-line">
                        {headers.map((_, colIdx) => {
                          const currentField = columnMappings[colIdx] || "none";
                          const isMapped = currentField !== "none";
                          return (
                            <th key={`map-${colIdx}`} className="p-2.5 text-left align-top min-w-[180px] border-r border-line/60 last:border-r-0">
                              <div className="flex flex-col gap-1.5">
                                <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold flex items-center justify-between">
                                  <span>Field</span>
                                  {isMapped ? (
                                    <span className="text-[9px] text-accent-bright bg-accent-500/15 px-1.5 rounded font-bold border border-accent-500/30">MAPPED</span>
                                  ) : (
                                    <span className="text-[9px] text-slate-500 bg-slate-900 px-1.5 rounded border border-slate-800">IGNORED</span>
                                  )}
                                </div>
                                <Select
                                  value={currentField}
                                  onChange={(e) => handleMappingChange(colIdx, e.target.value as SystemFieldKey)}
                                  selectSize="sm"
                                  tone={isMapped ? "accent" : "muted"}
                                  aria-label={`Map column ${colIdx + 1}`}
                                >
                                  {SYSTEM_FIELDS.map((f) => (
                                    <option key={f.key} value={f.key}>
                                      {f.label}
                                    </option>
                                  ))}
                                </Select>
                              </div>
                            </th>
                          );
                        })}
                      </tr>
                      <tr className="bg-widget border-b border-line">
                        {headers.map((h, colIdx) => (
                          <th
                            key={`h-${colIdx}`}
                            className="px-3 py-2 text-left font-bold text-[11px] uppercase tracking-wider border-r border-line/60 last:border-r-0 text-slate-200 truncate max-w-[220px]"
                            title={h}
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/40">
                      {rows.slice(0, MAPPING_SAMPLE_ROWS).map((rowCols, rIdx) => (
                        <tr key={`r-${rIdx}`} className="hover:bg-slate-800/20">
                          {headers.map((_, cIdx) => {
                            const val = rowCols[cIdx] ?? "";
                            const isMapped = (columnMappings[cIdx] || "none") !== "none";
                            return (
                              <td
                                key={`c-${rIdx}-${cIdx}`}
                                className={`px-3 py-2 whitespace-nowrap border-r border-line/30 last:border-r-0 truncate max-w-[220px] ${
                                  isMapped ? "text-slate-300" : "text-slate-600"
                                }`}
                                title={val}
                              >
                                {val || <span className="opacity-30">-</span>}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {rows.length > MAPPING_SAMPLE_ROWS && (
                  <div className="shrink-0 px-3 py-2 border-t border-line bg-card text-center text-[11px] text-slate-500">
                    The first {MAPPING_SAMPLE_ROWS} of {rows.length} rows. The review step checks every row.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* STEP 3: REVIEW */}
          {stage === "confirmation" && dryRunData && (
            <div className="flex flex-col gap-4 flex-1 min-h-0">
              {/* Counts double as filters */}
              <div className="shrink-0 grid grid-cols-2 md:grid-cols-4 gap-3">
                {reviewFilters.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => setPreviewFilter(f.key)}
                    aria-pressed={previewFilter === f.key}
                    className={`text-left p-3 rounded-xl border transition-colors cursor-pointer ${
                      previewFilter === f.key ? f.on : "border-line bg-widget hover:border-slate-600"
                    }`}
                  >
                    <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">{f.label}</div>
                    <div className={`text-xl font-bold ${f.tone}`}>{f.count}</div>
                  </button>
                ))}
              </div>

              <div className="rounded-xl border border-line bg-widget overflow-hidden flex flex-col flex-1 min-h-[280px]">
                <div className="overflow-auto flex-1 min-h-0 custom-scrollbar">
                  <table className="w-full border-collapse text-xs font-mono">
                    <thead className="bg-card text-slate-400 text-[11px] uppercase border-b border-line sticky top-0 z-10">
                      <tr>
                        <th className="px-3 py-2.5 text-left font-semibold">Status</th>
                        <th className="px-3 py-2.5 text-left font-semibold">Date</th>
                        <th className="px-3 py-2.5 text-left font-semibold">Type</th>
                        <th className="px-3 py-2.5 text-left font-semibold">Symbol / Name</th>
                        <th className="px-3 py-2.5 text-right font-semibold">Shares</th>
                        <th className="px-3 py-2.5 text-right font-semibold">Price</th>
                        <th className="px-3 py-2.5 text-right font-semibold">Amount</th>
                        <th className="px-3 py-2.5 text-right font-semibold">Fee / Tax</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/40">
                      {previewItems.length === 0 && (
                        <tr>
                          <td colSpan={8} className="px-3 py-10 text-center text-slate-500">
                            No rows in this group.
                          </td>
                        </tr>
                      )}
                      {(showAllPreview ? previewItems : previewItems.slice(0, PREVIEW_LIMIT)).map(({ tx, status, diffs }, idx) => {
                        const isNew = status === "new";
                        const isModified = status === "modified";
                        const diffFieldNames = new Set((diffs || []).map((d) => d.field));
                        const changed = (field: string) => diffFieldNames.has(field);

                        return (
                          <tr
                            key={`${tx.id}-${status}-${idx}`}
                            className={`transition-colors ${
                              isNew ? "bg-mint/5 hover:bg-mint/10" : isModified ? "bg-cream/5 hover:bg-cream/10" : "hover:bg-slate-800/20 text-slate-500"
                            }`}
                          >
                            <td className="px-3 py-2 whitespace-nowrap">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${
                                  isNew
                                    ? "bg-mint/15 text-mint border-mint/30"
                                    : isModified
                                      ? "bg-cream/15 text-cream border-cream/30"
                                      : "bg-slate-800 text-slate-400 border-slate-700"
                                }`}
                              >
                                {isNew ? "New" : isModified ? "Modified" : "Unchanged"}
                              </span>
                            </td>
                            <td className={`px-3 py-2 whitespace-nowrap ${changed("date") ? "text-cream font-bold" : "text-slate-400"}`}>{tx.date}</td>
                            <td className={`px-3 py-2 whitespace-nowrap font-bold ${changed("type") ? "text-cream" : "text-slate-300"}`}>{tx.type}</td>
                            <td className="px-3 py-2 whitespace-nowrap">
                              <span className={`font-bold ${changed("symbol") || changed("name") ? "text-cream" : "text-slate-100"}`}>{tx.symbol}</span>
                              {tx.name && tx.name !== tx.symbol && <span className="text-[11px] text-slate-500 ml-2">· {tx.name}</span>}
                              {diffs && diffs.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {diffs.map((d, dIdx) => (
                                    <span
                                      key={`diff-${dIdx}`}
                                      className="px-1.5 rounded text-[10px] bg-cream/15 text-cream border border-cream/30"
                                      title={`${d.field}: ${String(d.oldVal)} → ${String(d.newVal)}`}
                                    >
                                      {d.field}: {String(d.oldVal ?? "-")} → {String(d.newVal ?? "-")}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </td>
                            <td className={`px-3 py-2 text-right ${changed("shares") ? "text-cream font-bold bg-cream/10" : "text-slate-200"}`}>
                              {tx.shares != null ? tx.shares.toFixed(4) : "-"}
                            </td>
                            <td className={`px-3 py-2 text-right ${changed("price") ? "text-cream font-bold bg-cream/10" : "text-slate-400"}`}>
                              {tx.price != null ? fmtCurrency(tx.price, tx.currency || customBaseCurrency) : "-"}
                            </td>
                            <td className={`px-3 py-2 text-right font-bold ${changed("amount") ? "text-cream bg-cream/10" : "text-slate-100"}`}>
                              {tx.amount != null ? fmtCurrency(Math.abs(tx.amount), tx.currency || customBaseCurrency) : "-"}
                            </td>
                            <td className={`px-3 py-2 text-right ${changed("fee") || changed("tax") ? "text-cream font-bold bg-cream/10" : "text-slate-500"}`}>
                              {tx.fee || tx.tax ? fmtCurrency((tx.fee || 0) + (tx.tax || 0), tx.currency || customBaseCurrency) : "-"}
                            </td>
                          </tr>
                        );
                      })}
                      {!showAllPreview && previewItems.length > PREVIEW_LIMIT && (
                        <tr>
                          <td colSpan={8} className="px-3 py-3 text-center">
                            <button type="button" onClick={() => setShowAllPreview(true)} className={SECONDARY_BUTTON}>
                              Show all {previewItems.length} rows
                            </button>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* STEP 4: DONE */}
          {stage === "success" && successInfo && (
            <div className="flex-1 flex items-center justify-center py-10">
              <div className="cx-card w-full max-w-lg rounded-2xl p-8 flex flex-col items-center text-center gap-4">
                <div className="w-14 h-14 rounded-2xl border border-mint/40 bg-mint/15 flex items-center justify-center text-mint">
                  <FileCheck2 className="w-7 h-7" />
                </div>
                <div className="space-y-1.5">
                  <h2 className="font-bold text-sm uppercase tracking-wider text-mint">Import saved</h2>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Read <span className="text-slate-100 font-bold">{rows.length}</span> rows from{" "}
                    <span className="text-slate-100 font-bold">{fileName}</span>. {successInfo.newCount} new transactions saved. The
                    portfolio now holds <span className="text-mint font-bold">{successInfo.total}</span> transactions.
                  </p>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <button type="button" onClick={handleReset} className={SECONDARY_BUTTON}>
                    Import another file
                  </button>
                  <button type="button" onClick={onClose} className={PRIMARY_BUTTON}>
                    Done
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Step actions */}
      {(stage === "mapping" || stage === "confirmation") && (
        <footer className="shrink-0 border-t border-line bg-widget">
          <div className="max-w-[1400px] mx-auto px-4 sm:px-8 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="text-[11px] min-w-0">
              {stage === "mapping" &&
                (missingFields.length > 0 ? (
                  <span className="text-cream flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    Not mapped: {missingFields.join(", ")}
                  </span>
                ) : (
                  <span className="text-mint flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                    Date, type and symbol are mapped
                  </span>
                ))}
              {stage === "confirmation" && (
                <span className="text-slate-400">
                  <span className="text-mint font-bold">{newItemsCount}</span> new, <span className="text-cream font-bold">{modItemsCount}</span>{" "}
                  modified, {unchItemsCount} unchanged
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 justify-end">
              <button
                type="button"
                onClick={() => (stage === "confirmation" ? setStage("mapping") : handleReset())}
                disabled={submitting}
                className={SECONDARY_BUTTON}
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Back
              </button>
              {stage === "mapping" ? (
                <button
                  type="button"
                  disabled={submitting || rows.length === 0}
                  onClick={() => void handleProceedToDryRun()}
                  className={PRIMARY_BUTTON}
                >
                  {submitting && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  Review {rows.length} rows
                  {!submitting && <ArrowRight className="w-3.5 h-3.5" />}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={submitting || rows.length === 0}
                  onClick={() => void handleFinalCommit()}
                  className={PRIMARY_BUTTON}
                >
                  {submitting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  Import {rows.length} rows
                </button>
              )}
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}
