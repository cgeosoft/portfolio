/**
 * Encode the input payload of a metric module from the granted scopes only.
 * The layout is documented in src/shared/metric-abi.ts and mirrored by the
 * generated AssemblyScript SDK.
 */

import type { FinancialPortfolioData } from "../../../types/portfolio.js";
import {
  HISTORY_FIELDS,
  HOLDING_ASSET_TYPES,
  HOLDING_FIELDS,
  HOLDING_RECORD_PREFIX_BYTES,
  METRIC_ABI_VERSION,
  METRIC_PAYLOAD_MAGIC,
  METRIC_SCOPE_BITS,
  PAYLOAD_HEADER_BYTES,
  SUMMARY_FIELDS,
  TRANSACTION_FIELDS,
  TRANSACTION_KINDS,
  TRANSACTION_RECORD_PREFIX_BYTES,
  classifyTransactionType,
  type MetricScope,
} from "../../../shared/metric-abi.js";

/** Upper bound of a payload; larger ledgers are truncated to the newest rows. */
export const MAX_PAYLOAD_BYTES = 8 * 1024 * 1024;
const MAX_TRANSACTIONS = 50_000;
const MAX_HISTORY_POINTS = 20_000;

const encoder = new TextEncoder();

function align8(n: number): number {
  return (n + 7) & ~7;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

class StringTable {
  private chunks: Uint8Array[] = [];
  private index = new Map<string, [number, number]>();
  length = 0;

  add(value: string | null | undefined): [number, number] {
    const text = value ?? "";
    const cached = this.index.get(text);
    if (cached) return cached;
    const bytes = encoder.encode(text);
    const ref: [number, number] = [this.length, bytes.length];
    this.chunks.push(bytes);
    this.length += bytes.length;
    this.index.set(text, ref);
    return ref;
  }

  writeTo(target: Uint8Array, offset: number): void {
    let cursor = offset;
    for (const chunk of this.chunks) {
      target.set(chunk, cursor);
      cursor += chunk.length;
    }
  }
}

/**
 * Build the binary payload. Only the blocks of the granted scopes are
 * present; the header offset of every other block is zero, so a module
 * cannot observe data it was not granted.
 */
export function encodeMetricPayload(data: FinancialPortfolioData, scopes: readonly MetricScope[]): Uint8Array {
  const granted = new Set(scopes);
  const strings = new StringTable();

  const summaryBytes = granted.has("portfolio.summary") ? align8(8 + SUMMARY_FIELDS.length * 8) : 0;

  const holdings = granted.has("portfolio.holdings") ? data.holdings ?? [] : [];
  const holdingRecord = HOLDING_RECORD_PREFIX_BYTES + HOLDING_FIELDS.length * 8;
  const holdingsBytes = granted.has("portfolio.holdings") ? align8(8 + holdings.length * holdingRecord) : 0;

  const allTransactions = granted.has("portfolio.transactions") ? data.transactions ?? [] : [];
  const transactions = allTransactions.length > MAX_TRANSACTIONS ? allTransactions.slice(-MAX_TRANSACTIONS) : allTransactions;
  const transactionRecord = TRANSACTION_RECORD_PREFIX_BYTES + TRANSACTION_FIELDS.length * 8;
  const transactionsBytes = granted.has("portfolio.transactions") ? align8(8 + transactions.length * transactionRecord) : 0;

  const allHistory = granted.has("portfolio.history") ? data.chartHistory ?? [] : [];
  const history = allHistory.length > MAX_HISTORY_POINTS ? allHistory.slice(-MAX_HISTORY_POINTS) : allHistory;
  const historyRecord = HISTORY_FIELDS.length * 8;
  const historyBytes = granted.has("portfolio.history") ? align8(8 + history.length * historyRecord) : 0;

  // Intern strings first so the table length is known before allocation.
  const holdingRefs = holdings.map((h) => strings.add(h.symbol));
  const transactionRefs = transactions.map((t) => [strings.add(t.symbol), strings.add(t.type)] as const);

  const summaryOffset = summaryBytes ? PAYLOAD_HEADER_BYTES : 0;
  const holdingsOffset = holdingsBytes ? PAYLOAD_HEADER_BYTES + summaryBytes : 0;
  const transactionsOffset = transactionsBytes ? PAYLOAD_HEADER_BYTES + summaryBytes + holdingsBytes : 0;
  const historyOffset = historyBytes ? PAYLOAD_HEADER_BYTES + summaryBytes + holdingsBytes + transactionsBytes : 0;
  const stringsOffset = PAYLOAD_HEADER_BYTES + summaryBytes + holdingsBytes + transactionsBytes + historyBytes;
  const total = align8(stringsOffset + strings.length);
  if (total > MAX_PAYLOAD_BYTES) throw new Error("Metric payload exceeds the size limit");

  const buffer = new ArrayBuffer(total);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  let scopeMask = 0;
  for (const scope of granted) scopeMask |= METRIC_SCOPE_BITS[scope];

  view.setUint32(0, METRIC_PAYLOAD_MAGIC, true);
  view.setUint32(4, METRIC_ABI_VERSION, true);
  view.setUint32(8, scopeMask, true);
  view.setUint32(12, summaryOffset, true);
  view.setUint32(16, holdingsOffset, true);
  view.setUint32(20, transactionsOffset, true);
  view.setUint32(24, historyOffset, true);
  view.setUint32(28, stringsOffset, true);

  if (summaryOffset) {
    const summary = (data.summary ?? {}) as unknown as Record<string, unknown>;
    view.setUint32(summaryOffset, SUMMARY_FIELDS.length, true);
    SUMMARY_FIELDS.forEach((field, i) => view.setFloat64(summaryOffset + 8 + i * 8, num(summary[field]), true));
  }

  if (holdingsOffset) {
    view.setUint32(holdingsOffset, holdings.length, true);
    view.setUint32(holdingsOffset + 4, HOLDING_FIELDS.length, true);
    holdings.forEach((holding, index) => {
      const base = holdingsOffset + 8 + index * holdingRecord;
      const [symOff, symLen] = holdingRefs[index];
      view.setUint32(base, stringsOffset + symOff, true);
      view.setUint32(base + 4, symLen, true);
      const assetType = Math.max(0, (HOLDING_ASSET_TYPES as readonly string[]).indexOf(holding.assetType));
      view.setUint32(base + 8, assetType, true);
      const row = holding as unknown as Record<string, unknown>;
      HOLDING_FIELDS.forEach((field, i) =>
        view.setFloat64(base + HOLDING_RECORD_PREFIX_BYTES + i * 8, num(row[field]), true),
      );
    });
  }

  if (transactionsOffset) {
    view.setUint32(transactionsOffset, transactions.length, true);
    view.setUint32(transactionsOffset + 4, TRANSACTION_FIELDS.length, true);
    transactions.forEach((tx, index) => {
      const base = transactionsOffset + 8 + index * transactionRecord;
      const [[symOff, symLen], [typeOff, typeLen]] = transactionRefs[index];
      view.setUint32(base, stringsOffset + symOff, true);
      view.setUint32(base + 4, symLen, true);
      view.setUint32(base + 8, stringsOffset + typeOff, true);
      view.setUint32(base + 12, typeLen, true);
      view.setUint32(base + 16, (TRANSACTION_KINDS as readonly string[]).indexOf(classifyTransactionType(tx.type)), true);
      const timestamp = Date.parse(tx.datetime || tx.date);
      const values: Record<string, unknown> = { ...tx, timestamp: Number.isFinite(timestamp) ? timestamp : 0 };
      TRANSACTION_FIELDS.forEach((field, i) =>
        view.setFloat64(base + TRANSACTION_RECORD_PREFIX_BYTES + i * 8, num(values[field]), true),
      );
    });
  }

  if (historyOffset) {
    view.setUint32(historyOffset, history.length, true);
    view.setUint32(historyOffset + 4, HISTORY_FIELDS.length, true);
    history.forEach((point, index) => {
      const base = historyOffset + 8 + index * historyRecord;
      const row = point as unknown as Record<string, unknown>;
      HISTORY_FIELDS.forEach((field, i) => view.setFloat64(base + i * 8, num(row[field]), true));
    });
  }

  strings.writeTo(bytes, stringsOffset);
  return bytes;
}
