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

export interface PortfolioChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AssistantConversation {
  id: string;
  portfolioId: string;
  title: string;
  messages: PortfolioChatMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface GetAssistantConversationsRequest {
  portfolioId: string;
}

export interface GetAssistantConversationsResponse {
  conversations: AssistantConversation[];
}

export interface DeleteAssistantConversationRequest {
  portfolioId: string;
  conversationId: string;
}

export interface ChatWithPortfolioRequest {
  portfolioId: string;
  conversationId?: string;
  title?: string;
  messages: PortfolioChatMessage[];
  provider?: string;
  model?: string;
}

export interface ChatWithPortfolioResponse {
  message: PortfolioChatMessage;
  conversationId: string;
  title: string;
  provider: string;
  model: string;
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

export type LlmTestStepId = "config" | "connection" | "inference" | "integrity";

export interface TestLlmStepRequest {
  step: LlmTestStepId;
  provider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  previousOutput?: string;
}

export interface TestLlmStepResponse {
  success: boolean;
  message: string;
  latencyMs?: number;
  output?: string;
}

export interface GetProviderModelsRequest {
  provider: string;
  baseUrl?: string;
  apiKey?: string;
}

export interface GetProviderModelsResponse {
  models: string[];
}

export interface GetAppInfoResponse {
  version: string;
  majorMinor: string;
  webpageUrl: string;
  lastQuotesSync?: string;
}

export interface OpenExternalUrlRequest {
  url: string;
}

export interface SyncQuotesResponse {
  success: boolean;
  lastSync: string;
  error?: string;
}

export interface GetSponsorBannerRequest {
  url?: string;
}

export interface GetSponsorBannerResponse {
  success: boolean;
  html: string;
  error?: string;
}

export interface LogClientEventRequest {
  level: "info" | "success" | "warning" | "error" | "debug";
  source: string;
  step?: string;
  message: string;
  durationMs?: number;
  data?: Record<string, unknown>;
}

// -- RPC Schema ---------------------------------------------------------------

export type PortfolioRPC = {
  bun: RPCSchema<{
    requests: {
      // Client telemetry & diagnostic logging
      logClientEvent: { params: LogClientEventRequest; response: { success: boolean } };

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

      // LLM & Assistant
      chatWithPortfolio: { params: ChatWithPortfolioRequest; response: ChatWithPortfolioResponse };
      getAssistantConversations: { params: GetAssistantConversationsRequest; response: GetAssistantConversationsResponse };
      deleteAssistantConversation: { params: DeleteAssistantConversationRequest; response: { success: boolean } };
      testLlm: { params: TestLlmRequest; response: { success: boolean; message: string } };
      testLlmStep: { params: TestLlmStepRequest; response: TestLlmStepResponse };
      getProviderModels: { params: GetProviderModelsRequest; response: GetProviderModelsResponse };

      // Config
      getConfig: { params: Record<string, never>; response: DesktopConfig };
      saveConfig: { params: Partial<DesktopConfig>; response: DesktopConfig };

      // App info, external browser links, and sync
      getAppInfo: { params: Record<string, never>; response: GetAppInfoResponse };
      openExternalUrl: { params: OpenExternalUrlRequest; response: { success: boolean } };
      syncQuotes: { params: Record<string, never>; response: SyncQuotesResponse };
      getSponsorBanner: { params: GetSponsorBannerRequest; response: GetSponsorBannerResponse };

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
