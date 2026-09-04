/**
 * Type-safe RPC schema for Bun <-> Webview communication.
 * Follows Electrobun's RPCSchema pattern from Aurora.
 */

import type { RPCSchema } from "electrobun/bun";
import type {
  PortfolioItem,
  PortfolioHolding,
  PortfolioSummary,
  PortfolioHistoricalPoint,
  PortfolioTransaction,
  PortfolioReport,
  FinancialPortfolioData,
} from "../types/portfolio.js";
import type { DesktopConfig } from "../bun/config.js";
export type { DesktopConfig };

// ── Request/Response Payload Types ───────────────────────────────────────────

export interface GetPortfoliosResponse {
  portfolios: PortfolioItem[];
}

export interface GetPortfolioDataRequest {
  portfolioId: string;
  baseCurrency?: string;
  refresh?: boolean;
}

export interface CreatePortfolioRequest {
  name: string;
  description?: string;
  baseCurrency?: string;
}

export interface UpdatePortfolioRequest {
  portfolioId: string;
  name?: string;
  description?: string;
  baseCurrency?: string;
}

export interface ManageTransactionRequest {
  portfolioId: string;
  action: "add" | "edit" | "delete" | "import";
  transaction?: Partial<PortfolioTransaction>;
  transactionId?: string;
  transactions?: Partial<PortfolioTransaction>[];
  dryRun?: boolean;
}

export interface ManageTransactionResponse {
  success: boolean;
  action: string;
  totalTransactions: number;
  newTransactionsCount?: number;
  modifiedTransactionsCount?: number;
  unchangedTransactionsCount?: number;
  addedPreview?: PortfolioTransaction[];
  modifiedPreview?: { tx: PortfolioTransaction; diffs: { field: string; oldVal: unknown; newVal: unknown }[] }[];
  unchangedPreview?: PortfolioTransaction[];
  transaction?: PortfolioTransaction;
  error?: string;
}

export interface SearchSymbolRequest {
  query: string;
}

export interface SearchSymbolResponse {
  results: { symbol: string; name: string; exchange: string; quoteType: string; typeDisp?: string }[];
}

export interface GenerateReportRequest {
  portfolioId: string;
  provider?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
}

export interface GetReportsRequest {
  portfolioId: string;
}

export interface DeleteReportRequest {
  portfolioId: string;
  reportId: string;
}

export interface CompleteSetupRequest {
  populateDemo: boolean;
  enableTelemetry: boolean;
}

export interface PickFileRequest {
  title?: string;
  filters?: string[];
  startingFolder?: string;
}

export interface PickFileResponse {
  path: string | null;
  content?: string;
}

export interface SetLastImportDirectoryRequest {
  directory: string;
}

export interface SetLastImportDirectoryResponse {
  success: boolean;
}

export interface TestLlmRequest {
  provider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
}

// ── RPC Schema ───────────────────────────────────────────────────────────────

export type PortfolioRPC = {
  bun: RPCSchema<{
    requests: {
      // Portfolio CRUD
      getPortfolios: { params: Record<string, never>; response: GetPortfoliosResponse };
      getPortfolioData: { params: GetPortfolioDataRequest; response: FinancialPortfolioData };
      createPortfolio: { params: CreatePortfolioRequest; response: PortfolioItem };
      updatePortfolio: { params: UpdatePortfolioRequest; response: PortfolioItem };
      deletePortfolio: { params: { portfolioId: string }; response: { success: boolean } };

      // Transaction management
      manageTransactions: { params: ManageTransactionRequest; response: ManageTransactionResponse };
      getTransactions: { params: { portfolioId: string }; response: { transactions: PortfolioTransaction[] } };

      // Symbol search
      searchSymbol: { params: SearchSymbolRequest; response: SearchSymbolResponse };

      // Reports
      getReports: { params: GetReportsRequest; response: { reports: PortfolioReport[]; latestReport?: PortfolioReport } };
      generateReport: { params: GenerateReportRequest; response: PortfolioReport };
      deleteReport: { params: DeleteReportRequest; response: { success: boolean } };

      // LLM
      testLlm: { params: TestLlmRequest; response: { success: boolean; message: string } };

      // Config
      getConfig: { params: Record<string, never>; response: DesktopConfig };
      saveConfig: { params: Partial<DesktopConfig>; response: DesktopConfig };

      // Setup wizard
      completeSetup: { params: CompleteSetupRequest; response: { success: boolean } };

      // File system
      pickFile: { params: PickFileRequest; response: PickFileResponse };
      readFile: { params: { path: string }; response: { content: string } };
      setLastImportDirectory: { params: SetLastImportDirectoryRequest; response: SetLastImportDirectoryResponse };

      // App lifecycle
      quitApp: { params: Record<string, never>; response: { success: boolean } };
    };
    messages: {
      // Bun -> Webview: push updates
    };
  }>;
  webview: RPCSchema<{
    requests: {
      // Webview -> Bun: none needed beyond the above
    };
    messages: {
      // Webview -> Bun: fire-and-forget messages
      logEvent: { type: string; message: string };
    };
  }>;
};
