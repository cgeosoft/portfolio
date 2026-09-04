import { rpc } from "../../rpc";
import React, { useState, useRef, useMemo, useCallback } from "react";
import {
  X,
  UploadCloud,
  FileSpreadsheet,
  Check,
  RefreshCw,
  AlertTriangle,
  FileCheck2,
  Trash2,
  HelpCircle,
  ArrowRight,
  ArrowLeft,
  Sparkles,
  Layers,
} from "lucide-react";
import type { PortfolioTransaction } from "../../types/portfolio";
import { fmtCurrency } from "./utils";

export const DEFAULT_ISIN_SYMBOL_MAP: Record<string, string> = {
  "US30303M1027": "META",
  "IE00B4L5Y983": "EUNL.DE", // Core MSCI World UCITS ETF (EUR)
  "US0231351067": "AMZN",
  "US5949181045": "MSFT",
  "IE00B5BMR087": "SXR8.DE", // Core S&P 500 UCITS ETF (EUR)
  "IE00BK5BQT80": "VWCE.DE", // FTSE All-World UCITS ETF (EUR)
  "IE00BP3QZJ36": "IQQ6.DE", // MSCI France UCITS ETF (EUR)
  "DE0005933931": "EXS1.DE", // Core DAX UCITS ETF (EUR)
  "DE0007030009": "RHM.DE", // Rheinmetall (EUR)
  "FR0000121329": "HO.PA", // Thales (EUR)
  "BTC": "BTC-EUR", // Bitcoin (EUR)
  "US18915M1071": "NET", // Cloudflare (EUR)
  "LU3176111881": "LU3176111881", // Private Equity
};

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

interface ImportCsvModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => Promise<void> | void;
  portfolioId?: string | undefined;
  baseCurrency?: string | undefined;
}

export function ImportCsvModal({
  isOpen,
  onClose,
  onSuccess,
  portfolioId,
  baseCurrency = "EUR",
}: ImportCsvModalProps) {
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

  // Stage: "upload" | "mapping" | "confirmation" | "success"
  const [stage, setStage] = useState<"upload" | "mapping" | "confirmation" | "success">("upload");
  const [dryRunData, setDryRunData] = useState<DryRunResult | null>(null);
  const [previewFilter, setPreviewFilter] = useState<"all" | "new" | "modified" | "unchanged">("all");
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
        console.error("[ImportCsvModal] Failed to parse CSV:", err);
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
        const filePath = (file as any).path as string | undefined;
        if (filePath) {
          const dir = filePath.substring(0, Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\")));
          if (dir) {
            localStorage.setItem("portfolio_last_import_dir", dir);
            void rpc.request.setLastImportDirectory({ directory: dir }).catch(() => {});
          }
        }
        handleFileProcess({ name: file.name, content });
      }
    }
  };

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const content = await file.text();
        const filePath = (file as any).path as string | undefined;
        if (filePath) {
          const dir = filePath.substring(0, Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\")));
          if (dir) {
            localStorage.setItem("portfolio_last_import_dir", dir);
            void rpc.request.setLastImportDirectory({ directory: dir }).catch(() => {});
          }
        }
        handleFileProcess({ name: file.name, content });
      } catch (err) {
        console.error("[ImportCsvModal] Failed to read file:", err);
        setError("Failed to read selected file.");
      }
    }
  };

  const handleBrowseClick = async () => {
    // 1. Primary: invoke desktop native file picker which honors startingFolder and remembers last directory
    try {
      const savedDir = localStorage.getItem("portfolio_last_import_dir") || undefined;
      const res = await rpc.request.pickFile({
        title: "Select CSV File",
        filters: [".csv"],
        startingFolder: savedDir,
      });

      if (res && res.path && res.content) {
        const name = res.path.split("/").pop() || res.path.split("\\").pop() || "file.csv";
        const dir = res.path.substring(0, Math.max(res.path.lastIndexOf("/"), res.path.lastIndexOf("\\")));
        if (dir) {
          localStorage.setItem("portfolio_last_import_dir", dir);
          void rpc.request.setLastImportDirectory({ directory: dir }).catch(() => {});
        }
        handleFileProcess({ name, content: res.content });
        return;
      }
      if (res && res.path === null) {
        // User cancelled or closed the file picker dialog
        return;
      }
    } catch (err) {
      console.warn("[ImportCsvModal] Desktop pickFile failed, using browser input fallback:", err);
      // Fallback to hidden HTML file input if desktop RPC is unavailable
      if (fileInputRef.current) {
        fileInputRef.current.click();
      }
    }
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

      const isin = rawIsin || rawSymbol || undefined;
      let symbol = rawSymbol;

      if (rawSymbol && DEFAULT_ISIN_SYMBOL_MAP[rawSymbol.toUpperCase()]) {
        symbol = DEFAULT_ISIN_SYMBOL_MAP[rawSymbol.toUpperCase()]!;
      } else if (rawIsin && DEFAULT_ISIN_SYMBOL_MAP[rawIsin.toUpperCase()]) {
        symbol = DEFAULT_ISIN_SYMBOL_MAP[rawIsin.toUpperCase()]!;
      } else if (!symbol && isin) {
        symbol = isin;
      } else if (!symbol && (category === "PRIVATE_FUND" || rawAssetClass === "PRIVATE_FUND")) {
        symbol = "LU3176111881";
      } else if (!symbol) {
        symbol = "CASH";
      }

      const name = getVal(rowCols, "name") || symbol;
      const shares = parseNumber(getVal(rowCols, "shares"));
      const price = parseNumber(getVal(rowCols, "price"));
      const amount = parseNumber(getVal(rowCols, "amount"));
      const fee = parseNumber(getVal(rowCols, "fee")) !== undefined ? Math.abs(parseNumber(getVal(rowCols, "fee"))!) : undefined;
      const tax = parseNumber(getVal(rowCols, "tax")) !== undefined ? Math.abs(parseNumber(getVal(rowCols, "tax"))!) : undefined;
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
      const json = await rpc.request.manageTransactions({ portfolioId, action: "import", dryRun: true, transactions });
      if (json.success === false) {
        throw new Error(json.error || "Dry run failed");
      }

      setDryRunData(json);
      setPreviewFilter("all");
      setStage("confirmation");
    } catch (err) {
      console.error("[ImportCsvModal] Dry run error:", err);
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
      const json = await rpc.request.manageTransactions({ portfolioId, action: "import", dryRun: false, transactions });
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
      console.error("[ImportCsvModal] Final import commit error:", err);
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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200 font-mono overflow-y-auto">
      <div className="relative w-full max-w-5xl flex flex-col max-h-[calc(100dvh-1rem)] sm:max-h-[90dvh] rounded-xl sm:rounded-2xl border border-slate-800 bg-[#111726] shadow-2xl overflow-hidden text-slate-100 my-auto">
        
        {/* Modal Header & Wizard Stepper */}
        <div className="flex items-center justify-between border-b border-slate-800 bg-[#0b0f19] px-3.5 py-2.5 sm:px-5 sm:py-3.5 shrink-0 gap-2 sm:gap-3">
          <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-[#DD3C73]/10 border border-[#DD3C73]/30 flex items-center justify-center text-[#DD3C73] shrink-0">
              <FileSpreadsheet className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-200 truncate">
                Import Portfolio CSV
              </h2>
              <p className="text-[10px] text-slate-500 font-mono truncate hidden sm:block">Multi-Broker Ledger Ingestion Wizard</p>
            </div>
          </div>

          {/* Stepper Indicator - Mobile Badge vs Desktop Breadcrumbs */}
          <div className="flex items-center gap-1.5">
            <div className="sm:hidden text-[10px] font-bold uppercase tracking-wider text-[#DD3C73] bg-[#DD3C73]/15 px-2 py-0.5 rounded border border-[#DD3C73]/30">
              {stage === "upload" ? "1/4 Select" : stage === "mapping" ? "2/4 Map" : stage === "confirmation" ? "3/4 Review" : "4/4 Done"}
            </div>

            <div className="hidden sm:flex items-center gap-1.5 text-[11px] uppercase font-mono tracking-wider">
              <span className={`px-2 py-0.5 rounded transition-colors ${stage === "upload" ? "bg-[#DD3C73]/20 text-[#DD3C73] font-bold border border-[#DD3C73]/40" : "text-slate-500"}`}>
                1. Select
              </span>
              <span className="text-slate-600">➔</span>
              <span className={`px-2 py-0.5 rounded transition-colors ${stage === "mapping" ? "bg-[#DD3C73]/20 text-[#DD3C73] font-bold border border-[#DD3C73]/40" : "text-slate-500"}`}>
                2. Map Columns
              </span>
              <span className="text-slate-600">➔</span>
              <span className={`px-2 py-0.5 rounded transition-colors ${stage === "confirmation" ? "bg-[#DD3C73]/20 text-[#DD3C73] font-bold border border-[#DD3C73]/40" : "text-slate-500"}`}>
                3. Review
              </span>
              <span className="text-slate-600">➔</span>
              <span className={`px-2 py-0.5 rounded transition-colors ${stage === "success" ? "bg-[#A7E2C0]/20 text-[#A7E2C0] font-bold border border-[#A7E2C0]/40" : "text-slate-500"}`}>
                4. Done
              </span>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer shrink-0"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-5 flex flex-col gap-4 custom-scrollbar">
          {error && (
            <div className="p-3 rounded-xl border border-rose-800/50 bg-rose-950/40 text-rose-400 text-xs flex items-center gap-2.5">
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{error}</span>
            </div>
          )}

          {/* STAGE 1: UPLOAD DROPZONE */}
          {stage === "upload" && (
            <div className="flex flex-col gap-4">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv,text/plain"
                className="hidden"
                style={{ display: "none" }}
                onChange={handleFileInputChange}
              />
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={handleBrowseClick}
                className={`border-2 border-dashed rounded-2xl p-6 sm:p-10 flex flex-col items-center justify-center gap-3 text-center cursor-pointer transition-all min-h-[200px] sm:min-h-[260px] ${
                  isDragging
                    ? "border-[#DD3C73] bg-[#DD3C73]/10 shadow-[0_0_24px_rgba(221,60,115,0.2)]"
                    : "border-slate-800 bg-[#0b0f19]/60 hover:border-[#DD3C73]/50 hover:bg-[#151d30]/60"
                }`}
              >
                
                <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl border border-[#DD3C73]/30 bg-[#DD3C73]/10 flex items-center justify-center text-[#DD3C73] shadow-lg shadow-[#DD3C73]/10">
                  <UploadCloud className="w-6 h-6 sm:w-7 sm:h-7" />
                </div>
                <div>
                  <span className="font-bold text-xs sm:text-sm uppercase tracking-wider block text-slate-200">
                    Drop CSV file here or click to browse
                  </span>
                  <span className="text-[11px] sm:text-xs text-slate-500 mt-1 block">
                    Upload broker statement CSV (Trade Republic, Scalable Capital, Interactive Brokers, Degiro, etc.)
                  </span>
                </div>
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg border border-slate-800 bg-[#0b0f19] text-[10px] sm:text-[11px] text-slate-400 mt-1">
                  <span>Standard format: Header row + delimited records</span>
                </div>
              </div>

              {/* Supported Broker Templates List */}
              <div className="p-3.5 sm:p-4 rounded-xl border border-slate-800 bg-[#0b0f19]/60 flex flex-col gap-2.5">
                <div className="text-xs uppercase font-bold text-slate-400 flex items-center gap-2">
                  <Layers className="w-4 h-4 text-[#DD3C73]" />
                  <span>Pre-Configured Broker Formats:</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2 sm:gap-2.5">
                  {CSV_TEMPLATES.filter((t) => t.id !== "auto").map((tpl) => (
                    <div
                      key={tpl.id}
                      className="p-2.5 sm:p-3 rounded-lg border border-slate-800 bg-[#111726] flex flex-col gap-1 hover:border-slate-700 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-xs text-slate-200">{tpl.name}</span>
                        {tpl.badge && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#DD3C73]/15 text-[#DD3C73] border border-[#DD3C73]/30">
                            {tpl.badge}
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] sm:text-[11px] text-slate-500 truncate" title={tpl.description}>
                        {tpl.description}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* STAGE 2: COLUMN MAPPING & PREVIEW */}
          {stage === "mapping" && (
            <div className="flex flex-col gap-4">
              {/* File Info & Template Controls Bar */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 sm:p-3.5 rounded-xl border border-slate-800 bg-[#0b0f19] text-xs">
                <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-[#DD3C73]/10 border border-[#DD3C73]/30 flex items-center justify-center text-[#DD3C73] shrink-0">
                    <FileSpreadsheet className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 truncate">
                    <span className="font-bold text-slate-200 truncate block sm:inline">{fileName}</span>
                    <span className="text-[10px] sm:text-[11px] text-slate-500 sm:ml-2 block sm:inline">
                      ({(fileSize / 1024).toFixed(1)} KB · {rows.length} rows · {headers.length} cols)
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleReset}
                    className="ml-2 px-2.5 py-1 rounded-lg border border-slate-700/80 bg-[#111726] text-[11px] font-bold text-slate-300 hover:text-white hover:border-slate-600 transition-colors cursor-pointer shrink-0"
                  >
                    Change File
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {/* CSV Field Template Selector */}
                  <div className="flex items-center gap-1.5 text-xs flex-1 sm:flex-initial">
                    <span className="text-slate-400 font-bold flex items-center gap-1 text-[11px] sm:text-xs">
                      <Layers className="w-3.5 h-3.5 text-[#DD3C73]" />
                      <span className="hidden sm:inline">Template:</span>
                    </span>
                    <select
                      value={selectedTemplate}
                      onChange={(e) => handleTemplateChange(e.target.value)}
                      className="w-full sm:w-auto px-2 sm:px-2.5 py-1.5 rounded-lg border border-[#DD3C73]/50 bg-[#18181b] text-xs text-[#DD3C73] font-bold font-mono outline-none focus:border-[#DD3C73] cursor-pointer shadow-[0_0_8px_rgba(221,60,115,0.15)]"
                    >
                      {CSV_TEMPLATES.map((tpl) => (
                        <option
                          key={tpl.id}
                          value={tpl.id}
                          className="bg-[#18181b] text-slate-100"
                        >
                          {tpl.badge ? `[${tpl.badge}] ` : ""}{tpl.name}
                        </option>
                      ))}
                      <option
                        value="custom"
                        className="bg-[#18181b] text-slate-100"
                      >
                        [MANUAL] Custom Column Mapping
                      </option>
                    </select>
                  </div>

                  {/* Currency Selector */}
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="text-slate-400 text-[11px] sm:text-xs">Cur:</span>
                    <select
                      value={customBaseCurrency}
                      onChange={(e) => setCustomBaseCurrency(e.target.value)}
                      className="px-2 py-1.5 rounded-lg border border-slate-700 bg-[#18181b] text-xs text-slate-200 outline-none focus:border-[#DD3C73] cursor-pointer font-mono"
                    >
                      <option value="EUR" className="bg-[#18181b] text-slate-100">EUR (€)</option>
                      <option value="USD" className="bg-[#18181b] text-slate-100">USD ($)</option>
                      <option value="GBP" className="bg-[#18181b] text-slate-100">GBP (£)</option>
                      <option value="CHF" className="bg-[#18181b] text-slate-100">CHF (Fr)</option>
                    </select>
                  </div>

                  <button
                    onClick={handleReset}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-rose-800/40 bg-rose-950/30 text-rose-400 text-xs hover:bg-rose-950/50 transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Clear</span>
                  </button>
                </div>
              </div>

              {/* Instructions Bar & Template Hint */}
              <div className="text-xs text-slate-400 flex flex-wrap items-center justify-between gap-2 px-1">
                <div className="flex items-center gap-1.5">
                  <HelpCircle className="w-4 h-4 text-[#DD3C73] shrink-0" />
                  <span className="text-[11px] sm:text-xs">
                    {activeTemplateObj
                      ? `Template: ${activeTemplateObj.name}. Adjust individual column dropdowns below as needed.`
                      : "Custom mapping active. Use the dropdowns to map columns to system fields."}
                  </span>
                </div>
                <div className="font-bold text-[#DD3C73] text-[11px] sm:text-xs">
                  {mappedSummary.count} of {headers.length} columns mapped
                </div>
              </div>

              {/* Mapping & Data Preview Table */}
              <div className="rounded-xl border border-slate-800 bg-[#0b0f19] overflow-hidden flex flex-col">
                <div className="overflow-x-auto max-h-[380px] custom-scrollbar">
                  <table className="w-full border-collapse text-xs font-mono">
                    <thead className="bg-[#151d30] border-b border-slate-800 sticky top-0 z-10">
                      {/* Row 1: System Field Dropdowns */}
                      <tr className="border-b border-slate-800/80 bg-[#111726]">
                        {headers.map((_, colIdx) => {
                          const currentField = columnMappings[colIdx] || "none";
                          const isMapped = currentField !== "none";
                          return (
                            <th key={`map-${colIdx}`} className="p-2.5 text-left align-top min-w-[180px] border-r border-slate-800/60 last:border-r-0">
                              <div className="flex flex-col gap-1.5">
                                <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400 font-semibold flex items-center justify-between">
                                  <span>System Field</span>
                                  {isMapped ? (
                                    <span className="text-[9px] text-[#DD3C73] bg-[#DD3C73]/15 px-1.5 py-0.2 rounded font-bold border border-[#DD3C73]/30">MAPPED</span>
                                  ) : (
                                    <span className="text-[9px] text-slate-500 bg-slate-900 px-1.5 py-0.2 rounded border border-slate-800">IGNORED</span>
                                  )}
                                </div>
                                <select
                                  value={currentField}
                                  onChange={(e) => handleMappingChange(colIdx, e.target.value as SystemFieldKey)}
                                  className={`w-full px-2.5 py-1.5 rounded-lg border text-xs font-mono font-semibold outline-none transition-colors cursor-pointer ${
                                    isMapped
                                      ? "border-[#DD3C73] text-[#DD3C73] bg-[#1a121d] shadow-[0_0_8px_rgba(221,60,115,0.15)]"
                                      : "border-slate-700 bg-[#18181b] text-slate-400 hover:border-slate-600"
                                  }`}
                                >
                                  {SYSTEM_FIELDS.map((f) => (
                                    <option
                                      key={f.key}
                                      value={f.key}
                                      className="bg-[#18181b] text-slate-100"
                                    >
                                      {f.label}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </th>
                          );
                        })}
                      </tr>

                      {/* Row 2: Original CSV Column Headers */}
                      <tr className="bg-[#151d30] text-slate-400">
                        {headers.map((h, colIdx) => (
                          <th
                            key={`h-${colIdx}`}
                            className="px-3 py-2 text-left font-mono font-bold text-[11px] uppercase tracking-wider border-r border-slate-800/60 last:border-r-0 text-slate-200 truncate max-w-[200px]"
                            title={h}
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>

                    {/* Preview Rows */}
                    <tbody className="divide-y divide-slate-800/40 font-mono">
                      {rows.slice(0, 6).map((rowCols, rIdx) => (
                        <tr key={`r-${rIdx}`} className="hover:bg-slate-800/20">
                          {rowCols.map((val, cIdx) => (
                            <td
                              key={`c-${rIdx}-${cIdx}`}
                              className="px-3 py-2 whitespace-nowrap text-slate-400 border-r border-slate-800/30 last:border-r-0 text-xs truncate max-w-[200px]"
                              title={val}
                            >
                              {val || <span className="opacity-30">—</span>}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {rows.length > 6 && (
                  <div className="p-2.5 border-t border-slate-800 bg-[#111726] text-center text-[11px] text-slate-500">
                    Showing first 6 sample records of {rows.length} total rows.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* STAGE 3: CONFIRMATION / REVIEW */}
          {stage === "confirmation" && dryRunData && (
            <div className="flex flex-col gap-4 flex-1 min-h-0">
              {/* Changes Preview Table */}
              <div className="rounded-xl border border-slate-800 bg-[#0b0f19] overflow-hidden flex flex-col flex-1 min-h-0">
                <div className="p-3 border-b border-slate-800 bg-[#151d30] text-xs font-bold uppercase tracking-wider text-slate-400 flex flex-wrap items-center justify-between gap-2 shrink-0">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-200">
                      Transactions Review ({previewItems.length} records shown)
                    </span>
                  </div>

                  {/* Filter Pill Tabs */}
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setPreviewFilter("all")}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer transition-colors ${
                        previewFilter === "all"
                          ? "bg-[#DD3C73]/20 text-[#DD3C73] border border-[#DD3C73]"
                          : "bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800"
                      }`}
                    >
                      All ({totalCount})
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewFilter("new")}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer transition-colors ${
                        previewFilter === "new"
                          ? "bg-[#A7E2C0]/20 text-[#A7E2C0] border border-[#A7E2C0]"
                          : "bg-slate-900 text-[#A7E2C0]/80 hover:text-[#A7E2C0] border border-slate-800"
                      }`}
                    >
                      + New ({newItemsCount})
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewFilter("modified")}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer transition-colors ${
                        previewFilter === "modified"
                          ? "bg-[#E3EACD]/20 text-[#E3EACD] border border-[#E3EACD]"
                          : "bg-slate-900 text-[#E3EACD]/80 hover:text-[#E3EACD] border border-slate-800"
                      }`}
                    >
                      ↺ Modified ({modItemsCount})
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewFilter("unchanged")}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer transition-colors ${
                        previewFilter === "unchanged"
                          ? "bg-slate-800 text-slate-200 border border-slate-700"
                          : "bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800"
                      }`}
                    >
                      ✓ Unchanged ({unchItemsCount})
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto overflow-y-auto max-h-[480px] custom-scrollbar">
                  <table className="w-full border-collapse text-xs font-mono">
                    <thead className="bg-[#111726] text-slate-400 font-mono text-[11px] uppercase border-b border-slate-800 sticky top-0 backdrop-blur z-10">
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
                    <tbody className="divide-y divide-slate-800/40 font-mono">
                      {previewItems.map(({ tx, status, diffs }, idx) => {
                        const isNew = status === "new";
                        const isModified = status === "modified";
                        const isUnchanged = status === "unchanged";
                        const diffFieldNames = new Set((diffs || []).map((d) => d.field));

                        return (
                          <tr
                            key={`${tx.id}-${status}-${idx}`}
                            className={`transition-colors ${
                              isNew
                                ? "bg-[#A7E2C0]/10 hover:bg-[#A7E2C0]/20"
                                : isModified
                                ? "bg-[#E3EACD]/10 hover:bg-[#E3EACD]/20"
                                : "hover:bg-slate-800/20 opacity-75 hover:opacity-100"
                            }`}
                          >
                            <td className="px-3 py-2 whitespace-nowrap">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                  isNew
                                    ? "bg-[#A7E2C0]/15 text-[#A7E2C0] border border-[#A7E2C0]/30"
                                    : isModified
                                    ? "bg-[#E3EACD]/15 text-[#E3EACD] border border-[#E3EACD]/30"
                                    : "bg-slate-800 text-slate-400 border border-slate-700"
                                }`}
                              >
                                {isNew && "+ NEW"}
                                {isModified && "↺ MODIFIED"}
                                {isUnchanged && "✓ UNCHANGED"}
                              </span>
                            </td>

                            <td
                              className={`px-3 py-2 whitespace-nowrap text-slate-400 ${
                                diffFieldNames.has("date") ? "text-[#E3EACD] font-bold" : ""
                              }`}
                            >
                              {tx.date}
                            </td>

                            <td
                              className={`px-3 py-2 whitespace-nowrap font-bold ${
                                diffFieldNames.has("type") ? "text-[#E3EACD]" : "text-slate-300"
                              }`}
                            >
                              {tx.type}
                            </td>

                            <td className="px-3 py-2 whitespace-nowrap">
                              <span
                                className={`font-bold text-slate-100 ${
                                  diffFieldNames.has("symbol") || diffFieldNames.has("name")
                                    ? "text-[#E3EACD]"
                                    : ""
                                }`}
                              >
                                {tx.symbol}
                              </span>
                              {tx.name && tx.name !== tx.symbol && (
                                <span className="text-[11px] text-slate-500 ml-2 truncate">
                                  · {tx.name}
                                </span>
                              )}
                              {diffs && diffs.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {diffs.map((d, dIdx) => (
                                    <span
                                      key={`diff-${dIdx}`}
                                      className="px-1.5 py-0.2 rounded text-[10px] bg-[#E3EACD]/15 text-[#E3EACD] border border-[#E3EACD]/30 font-mono"
                                      title={`${d.field}: ${String(d.oldVal)} ➔ ${String(d.newVal)}`}
                                    >
                                      {d.field}: {String(d.oldVal ?? "—")} ➔ {String(d.newVal ?? "—")}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </td>

                            <td
                              className={`px-3 py-2 text-right ${
                                diffFieldNames.has("shares")
                                  ? "text-[#E3EACD] font-bold bg-[#E3EACD]/10"
                                  : "text-slate-200"
                              }`}
                            >
                              {tx.shares != null ? tx.shares.toFixed(4) : "—"}
                            </td>

                            <td
                              className={`px-3 py-2 text-right ${
                                diffFieldNames.has("price")
                                  ? "text-[#E3EACD] font-bold bg-[#E3EACD]/10"
                                  : "text-slate-400"
                              }`}
                            >
                              {tx.price != null
                                ? fmtCurrency(tx.price, tx.currency || customBaseCurrency)
                                : "—"}
                            </td>

                            <td
                              className={`px-3 py-2 text-right font-bold ${
                                diffFieldNames.has("amount")
                                  ? "text-[#E3EACD] bg-[#E3EACD]/10"
                                  : "text-slate-100"
                              }`}
                            >
                              {tx.amount != null
                                ? fmtCurrency(Math.abs(tx.amount), tx.currency || customBaseCurrency)
                                : "—"}
                            </td>

                            <td
                              className={`px-3 py-2 text-right text-xs ${
                                diffFieldNames.has("fee") || diffFieldNames.has("tax")
                                  ? "text-[#E3EACD] font-bold bg-[#E3EACD]/10"
                                  : "text-slate-500"
                              }`}
                            >
                              {tx.fee || tx.tax
                                ? fmtCurrency((tx.fee || 0) + (tx.tax || 0), tx.currency || customBaseCurrency)
                                : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* STAGE 4: SUCCESS */}
          {stage === "success" && successInfo && (
            <div className="py-12 px-4 flex flex-col items-center justify-center text-center gap-4">
              <div className="w-16 h-16 rounded-2xl border border-[#A7E2C0]/40 bg-[#A7E2C0]/15 flex items-center justify-center text-[#A7E2C0] shadow-lg shadow-[#A7E2C0]/10">
                <FileCheck2 className="w-8 h-8" />
              </div>
              <div>
                <h3 className="font-bold text-base uppercase tracking-wider text-[#A7E2C0]">
                  CSV Ledger Imported Successfully
                </h3>
                <p className="text-xs text-slate-400 max-w-md mt-1.5 leading-relaxed">
                  Synchronized <span className="text-slate-100 font-bold">{rows.length}</span> records from{" "}
                  <span className="text-slate-100 font-bold">{fileName}</span>. Total transactions in portfolio:{" "}
                  <span className="text-[#A7E2C0] font-bold">{successInfo.total}</span> ({successInfo.newCount} new records saved).
                </p>
              </div>

              <div className="flex items-center gap-3 mt-4">
                <button
                  onClick={handleReset}
                  className="px-4 py-2 rounded-xl border border-slate-700 bg-[#0b0f19] text-xs font-bold text-slate-300 hover:text-white cursor-pointer uppercase transition-colors"
                >
                  Import Another File
                </button>
                <button
                  onClick={onClose}
                  className="px-6 py-2 rounded-xl border border-[#DD3C73] bg-[#DD3C73] text-xs font-bold text-white hover:bg-[#c82f63] shadow-lg shadow-[#DD3C73]/25 transition-all cursor-pointer uppercase"
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer Controls */}
        {stage === "mapping" && (
          <div className="flex flex-col sm:flex-row items-center justify-between border-t border-slate-800 bg-[#0b0f19] px-3.5 py-2.5 sm:px-5 sm:py-3.5 shrink-0 gap-2.5">
            <div className="flex items-center gap-2 sm:gap-3 text-xs text-slate-400 w-full sm:w-auto justify-between sm:justify-start">
              {!mappedSummary.hasDate && (
                <span className="text-[#E3EACD] flex items-center gap-1 text-[11px] sm:text-xs">
                  <AlertTriangle className="w-3.5 h-3.5" /> Missing Date
                </span>
              )}
              {!mappedSummary.hasType && (
                <span className="text-[#E3EACD] flex items-center gap-1 text-[11px] sm:text-xs">
                  <AlertTriangle className="w-3.5 h-3.5" /> Missing Type
                </span>
              )}
              {!mappedSummary.hasSymbol && (
                <span className="text-[#E3EACD] flex items-center gap-1 text-[11px] sm:text-xs">
                  <AlertTriangle className="w-3.5 h-3.5" /> Missing Symbol
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 sm:gap-2.5 w-full sm:w-auto justify-end">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 sm:px-4 py-1.5 sm:py-2 rounded-xl border border-slate-700 bg-[#111726] text-xs font-bold text-slate-300 hover:text-white cursor-pointer transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={submitting || rows.length === 0}
                onClick={() => void handleProceedToDryRun()}
                className="flex items-center gap-1.5 sm:gap-2 px-3.5 sm:px-5 py-1.5 sm:py-2 rounded-xl border border-[#DD3C73] bg-[#DD3C73] text-xs font-bold text-white hover:bg-[#c82f63] shadow-lg shadow-[#DD3C73]/25 transition-all cursor-pointer disabled:opacity-50"
              >
                {submitting ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5" />
                )}
                <span>Review <span className="hidden sm:inline">Transactions </span>(Step 3)</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {stage === "confirmation" && (
          <div className="flex flex-col sm:flex-row items-center justify-between border-t border-slate-800 bg-[#0b0f19] px-3.5 py-2.5 sm:px-5 sm:py-3.5 shrink-0 gap-2.5">
            <button
              type="button"
              onClick={() => setStage("mapping")}
              className="flex items-center gap-1.5 px-3.5 sm:px-4 py-1.5 sm:py-2 rounded-xl border border-slate-700 bg-[#111726] text-xs font-bold text-slate-300 hover:text-white cursor-pointer transition-colors w-full sm:w-auto justify-center sm:justify-start"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to Mapping</span>
            </button>

            <div className="flex items-center gap-2 sm:gap-2.5 w-full sm:w-auto justify-end">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 sm:px-4 py-1.5 sm:py-2 rounded-xl border border-slate-700 bg-[#111726] text-xs font-bold text-slate-300 hover:text-white cursor-pointer transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={submitting || rows.length === 0}
                onClick={() => void handleFinalCommit()}
                className="flex items-center gap-1.5 sm:gap-2 px-4 sm:px-6 py-1.5 sm:py-2 rounded-xl border border-[#DD3C73] bg-[#DD3C73] text-xs font-bold text-white hover:bg-[#c82f63] shadow-lg shadow-[#DD3C73]/25 transition-all cursor-pointer disabled:opacity-50"
              >
                {submitting ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Check className="w-3.5 h-3.5" />
                )}
                <span>Confirm & Commit<span className="hidden sm:inline"> Import ({rows.length} Records)</span></span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
