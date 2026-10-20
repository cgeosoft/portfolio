import { forwardRef, memo, useState, useRef, useEffect, useCallback, useImperativeHandle, useMemo, type ReactNode } from "react";
import type { Components } from "react-markdown";
import type { PortfolioItem, FinancialPortfolioData } from "portfolio-shared/portfolio";
import type { PortfolioChatMessage, AssistantConversationSummary } from "portfolio-shared/api-types";
import { cleanThinkTags, formatTimeAgo, maskFinancialValues } from "./utils";
import { rpc } from "../../rpc";
import { AssistantSystemPromptModal } from "./AssistantSystemPromptModal";
import { renderHoldingAnchor, useHoldingLinkPlugin } from "./holding-links";
import { SafeMarkdown, type InAppLinkRenderer } from "../common/SafeMarkdown";
import { t } from "../../i18n";
import {
  Sparkles,
  Bot,
  Send,
  Trash2,
  X,
  Copy,
  Check,
  Settings,
  AlertCircle,
  TrendingUp,
  ShieldAlert,
  Wallet,
  Activity,
  MessageSquare,
  Plus,
  FileText,
  Loader2,
  History,
  ArrowLeft,
  Search,
  MessageSquareDashed,
  Cpu,
  RefreshCw,
} from "lucide-react";

interface AssistantSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  portfolio: PortfolioItem | null;
  portfolioData: FinancialPortfolioData | null;
  onOpenSettings?: () => void;
  conversations?: AssistantConversationSummary[];
  currentConversationId?: string | null;
  onSelectConversation?: (id: string) => void;
  onNewChat?: () => void;
  onDeleteConversation?: (id: string) => void;
  messages: PortfolioChatMessage[];
  onSendMessage: (text: string) => Promise<void>;
  onRegenerateMessage?: () => Promise<void>;
  onClearMessages: () => void;
  isLoading: boolean;
  error?: string | null;
  activeProvider?: string;
  activeModel?: string;
  /** Privacy mode: mask amounts in messages and the system prompt; percentages stay visible. */
  hideValues?: boolean;
}

/** Suggested questions; the label and the question are `assistant.quickPrompts.<key>.*`, read at render time. */
const SUGGESTIONS = [
  { icon: TrendingUp, key: "health" },
  { icon: ShieldAlert, key: "risk" },
  { icon: Activity, key: "technical" },
  { icon: Wallet, key: "cash" },
];

/** Styles of the assistant's Markdown replies; module level, so the elements are not remounted on every render. */
const REPLY_MARKDOWN: Components = {
  h1: ({ children }) => (
    <h1 className="text-sm font-bold text-[#DD3C73] mt-2 mb-1 uppercase tracking-wider border-b border-slate-800 pb-1">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-xs font-bold text-slate-200 mt-2 mb-1 uppercase tracking-wider">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-xs font-semibold text-slate-300 mt-1.5 mb-0.5">
      {children}
    </h3>
  ),
  p: ({ children }) => (
    <p className="my-1.5 leading-relaxed text-slate-300 font-sans text-xs">
      {children}
    </p>
  ),
  ul: ({ children }) => (
    <ul className="list-disc pl-4 space-y-1 my-1.5 text-slate-300 text-xs">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal pl-4 space-y-1 my-1.5 text-slate-300 text-xs">
      {children}
    </ol>
  ),
  li: ({ children }) => (
    <li className="text-slate-300 text-xs">{children}</li>
  ),
  strong: ({ children }) => (
    <strong className="font-bold text-slate-100">{children}</strong>
  ),
  code: ({ children }) => (
    <code className="bg-slate-900 px-1 py-0.5 rounded text-[11px] text-mint font-mono border border-slate-800">
      {children}
    </code>
  ),
  table: ({ children }) => (
    <div className="overflow-x-auto my-2 border border-slate-800 rounded">
      <table className="w-full text-left text-[11px] border-collapse">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="bg-slate-900/80 px-2 py-1 border-b border-slate-800 font-semibold text-slate-300">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="px-2 py-1 border-b border-slate-800/60 text-slate-300 font-mono">
      {children}
    </td>
  ),
};

/** A translated sentence with its `{name}` placeholder rendered as `node`, so the name keeps its own style. */
function withName(text: string, node: ReactNode): ReactNode {
  const at = text.indexOf("{name}");
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      {node}
      {text.slice(at + "{name}".length)}
    </>
  );
}

/** The sentence of the portfolio context card, `{name}` left in: base currency and cash share when known. */
function groundingText(currency: string | undefined, cashPercent: number | undefined): string {
  const cash = cashPercent !== undefined ? cashPercent.toFixed(1) : undefined;
  if (currency && cash !== undefined) return t("assistant.context.groundedCurrencyCash", { currency, cash });
  if (currency) return t("assistant.context.groundedCurrency", { currency });
  if (cash !== undefined) return t("assistant.context.groundedCash", { cash });
  return t("assistant.context.grounded");
}

/** Holding references in a reply open the holding; other links follow the SafeMarkdown rules. */
const renderHoldingLink: InAppLinkRenderer = (href, children) => renderHoldingAnchor(href, children, () => null);

interface ChatMessageProps {
  content: string;
  isUser: boolean;
  index: number;
  hideValues: boolean;
  holdingLinkPlugin: ReturnType<typeof useHoldingLinkPlugin>;
  copied: boolean;
  onCopy: (content: string, index: number) => void;
  /** Set on the last reply while it can be asked again. */
  onRegenerate?: () => void;
}

/**
 * One chat bubble. Memoized: a new reply, the loading state or the copy feedback
 * re-renders the bubbles whose props changed, not the Markdown of the whole conversation.
 */
const ChatMessage = memo(function ChatMessage({
  content,
  isUser,
  index,
  hideValues,
  holdingLinkPlugin,
  copied,
  onCopy,
  onRegenerate,
}: ChatMessageProps) {
  const text = useMemo(() => {
    const visible = isUser ? content : cleanThinkTags(content, false);
    return hideValues ? maskFinancialValues(visible) : visible;
  }, [content, isUser, hideValues]);

  return (
    <div className={`flex flex-col ${isUser ? "items-end" : "items-start"} group`}>
      <div className="flex items-center gap-1.5 mb-1 px-1 text-[10px] text-slate-500 uppercase tracking-wider">
        <span>{isUser ? t("assistant.chat.you") : t("assistant.chat.analyst")}</span>
      </div>

      <div
        className={`relative rounded-xl text-xs leading-relaxed max-w-[92%] px-3.5 py-2.5 break-words ${
          isUser
            ? "bg-[#DD3C73]/15 border border-[#DD3C73]/40 text-slate-100 font-mono shadow-sm"
            : "bg-widget border border-slate-800 text-slate-200 shadow-md"
        }`}
      >
        {isUser ? (
          <div className="whitespace-pre-wrap">{text}</div>
        ) : (
          <div className="prose prose-invert prose-xs max-w-none space-y-2 text-xs">
            <SafeMarkdown components={REPLY_MARKDOWN} remarkPlugin={holdingLinkPlugin} renderInAppLink={renderHoldingLink}>
              {text}
            </SafeMarkdown>

            {/* Regenerate: absolutely positioned below the bubble so the timeline never shifts */}
            {onRegenerate && (
              <button
                onClick={() => onRegenerate()}
                className="absolute left-0 top-full mt-0.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity px-1 py-0.5 rounded text-[10px] text-slate-500 hover:text-[#DD3C73] flex items-center gap-1 cursor-pointer"
                title={t("assistant.chat.regenerateTitle")}
                type="button"
              >
                <RefreshCw className="w-3 h-3" />
                <span>{t("assistant.chat.regenerate")}</span>
              </button>
            )}

            {/* Copy message button */}
            <div className="flex justify-end pt-1">
              <button
                onClick={() => onCopy(content, index)}
                className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-[10px] text-slate-500 hover:text-slate-300 flex items-center gap-1 cursor-pointer"
                title={t("assistant.chat.copyTitle")}
                type="button"
              >
                {copied ? (
                  <>
                    <Check className="w-3 h-3 text-emerald-400" />
                    <span className="text-emerald-400">{t("common.copied")}</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" />
                    <span>{t("common.copy")}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

interface ChatInputHandle {
  /** Puts a suggested question in the box and focuses it. */
  fill: (text: string) => void;
  focus: () => void;
}

interface ChatInputProps {
  isLoading: boolean;
  baseCurrency?: string;
  onSend: (text: string) => Promise<void>;
}

/** The message box. The draft lives here, so typing re-renders the box and not the conversation. */
const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(function ChatInput({ isLoading, baseCurrency, onSend }, ref) {
  const [inputText, setInputText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(
    ref,
    () => ({
      fill: (text: string) => {
        setInputText(text);
        textareaRef.current?.focus();
      },
      focus: () => textareaRef.current?.focus(),
    }),
    [],
  );

  const handleSend = async () => {
    const trimmed = inputText.trim();
    if (!trimmed || isLoading) return;
    setInputText("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
    await onSend(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleTextareaInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputText(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
  };

  return (
    <div className="px-4 py-3 border-t border-slate-800/80 bg-canvas shrink-0">
      <div className="relative flex items-end gap-2 bg-widget border border-slate-700/80 focus-within:border-[#DD3C73]/70 focus-within:ring-1 focus-within:ring-[#DD3C73]/40 rounded-xl p-2 transition-all shadow-inner">
        <textarea
          ref={textareaRef}
          value={inputText}
          onChange={handleTextareaInput}
          onKeyDown={handleKeyDown}
          placeholder={t("assistant.input.placeholder")}
          rows={1}
          disabled={isLoading}
          className="flex-1 bg-transparent border-0 resize-none text-xs text-slate-100 placeholder-slate-500 focus:outline-none custom-scrollbar max-h-[120px] py-1 font-mono leading-relaxed"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={!inputText.trim() || isLoading}
          className="h-8 w-8 rounded-lg bg-[#DD3C73] hover:bg-[#c93264] disabled:opacity-40 disabled:hover:bg-[#DD3C73] disabled:cursor-not-allowed text-white flex items-center justify-center transition-colors shrink-0 cursor-pointer shadow-md"
          title={t("assistant.input.send")}
        >
          <Send className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex items-center justify-between mt-1.5 px-1 text-[10px] text-slate-500">
        <span>{t("assistant.input.hint")}</span>
        {baseCurrency && (
          <span className="font-semibold text-slate-400">
            {t("assistant.input.groundedIn", { currency: baseCurrency })}
          </span>
        )}
      </div>
    </div>
  );
});

export function AssistantSidebar({
  isOpen,
  onClose,
  portfolio,
  portfolioData,
  onOpenSettings,
  conversations = [],
  currentConversationId = null,
  onSelectConversation,
  onNewChat,
  onDeleteConversation,
  messages,
  onSendMessage,
  onRegenerateMessage,
  onClearMessages,
  isLoading,
  error,
  activeProvider = t("assistant.localLlm"),
  activeModel,
  hideValues = false,
}: AssistantSidebarProps) {
  const mask = (text: string) => (hideValues ? maskFinancialValues(text) : text);
  const [currentView, setCurrentView] = useState<"chat" | "history">("chat");
  const [searchHistoryQuery, setSearchHistoryQuery] = useState("");
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [isSystemPromptOpen, setIsSystemPromptOpen] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [systemPromptLoading, setSystemPromptLoading] = useState(false);
  const [systemPromptError, setSystemPromptError] = useState<string | null>(null);
  const holdingLinkPlugin = useHoldingLinkPlugin();

  // The app loads the latest conversation at start-up while the sidebar is closed:
  // render its replies only once the sidebar has been opened.
  const [hasOpened, setHasOpened] = useState(isOpen);
  if (isOpen && !hasOpened) setHasOpened(true);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<ChatInputHandle>(null);

  // Reset to chat view when sidebar is opened
  useEffect(() => {
    if (isOpen) {
      setCurrentView("chat");
      setSearchHistoryQuery("");
    }
  }, [isOpen]);

  // Auto-scroll to bottom on new messages or loading change
  useEffect(() => {
    if (isOpen && currentView === "chat") {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isLoading, isOpen, currentView]);

  // Focus textarea when switching to chat view
  useEffect(() => {
    if (isOpen && currentView === "chat") {
      const timer = setTimeout(() => {
        chatInputRef.current?.focus();
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [isOpen, currentView]);

  const handleCopyMessage = useCallback(
    async (content: string, index: number) => {
      try {
        const text = cleanThinkTags(content, false);
        await navigator.clipboard.writeText(hideValues ? maskFinancialValues(text) : text);
        setCopiedIndex(index);
        setTimeout(() => setCopiedIndex(null), 2000);
      } catch {
        // Ignore clipboard error
      }
    },
    [hideValues],
  );

  const maskedSystemPrompt = useMemo(
    () => (hideValues ? maskFinancialValues(systemPrompt) : systemPrompt),
    [systemPrompt, hideValues],
  );

  const handleOpenSystemPrompt = useCallback(async () => {
    if (!portfolio?.id) return;
    setIsSystemPromptOpen(true);
    setSystemPromptLoading(true);
    setSystemPromptError(null);
    try {
      const res = await rpc.request.getAssistantSystemPrompt({ portfolioId: portfolio.id });
      setSystemPrompt(res.systemPrompt);
    } catch (err) {
      setSystemPromptError(err instanceof Error ? err.message : t("assistant.systemPrompt.loadError"));
    } finally {
      setSystemPromptLoading(false);
    }
  }, [portfolio?.id]);

  const handleStartNewChat = useCallback(() => {
    onNewChat?.();
    setCurrentView("chat");
  }, [onNewChat]);

  const handleSelectConv = useCallback(
    (convId: string) => {
      onSelectConversation?.(convId);
      setCurrentView("chat");
    },
    [onSelectConversation],
  );

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === currentConversationId),
    [conversations, currentConversationId],
  );

  const filteredConversations = useMemo(() => {
    const q = searchHistoryQuery.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => c.title.toLowerCase().includes(q));
  }, [conversations, searchHistoryQuery]);

  const holdingsCount = portfolioData?.holdings?.length ?? 0;
  const cashPercent = portfolioData?.summary?.cashWeightPercent;

  return (
    <aside
      aria-label={t("assistant.ariaLabel")}
      className={`shrink-0 flex flex-col h-full bg-widget border-l border-slate-800/80 transition-all duration-300 ease-in-out font-mono text-slate-200 z-30 select-text ${
        isOpen
          ? "w-full sm:w-[400px] lg:w-[430px] opacity-100 visible"
          : "w-0 opacity-0 invisible overflow-hidden border-l-0"
      }`}
    >
      {/* Sidebar Header */}
      <div className="px-4 py-2.5 border-b border-slate-800/80 bg-canvas flex items-center justify-between shrink-0">
        {currentView === "chat" ? (
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-6 h-6 rounded-md bg-[#DD3C73]/15 border border-[#DD3C73]/30 flex items-center justify-center shrink-0">
              <Sparkles className="w-3.5 h-3.5 text-[#DD3C73]" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-100">
                  {t("assistant.title")}
                </span>
                {activeConversation?.title && (
                  <span
                    className="text-[10px] text-slate-400 font-normal truncate max-w-[130px] px-1.5 py-0.5 rounded bg-slate-800/60 border border-slate-700/50"
                    title={mask(activeConversation.title)}
                  >
                    {mask(activeConversation.title)}
                  </span>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 min-w-0">
            <button
              type="button"
              onClick={() => setCurrentView("chat")}
              className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 hover:text-[#DD3C73] py-1 px-2 rounded hover:bg-slate-800/60 transition-colors cursor-pointer"
              title={t("assistant.history.returnTitle")}
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>{t("common.back")}</span>
            </button>
            <div className="flex items-center gap-1.5 ml-1">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-100">
                {t("assistant.history.title")}
              </span>
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-800 text-slate-400 font-mono">
                {conversations.length}
              </span>
            </div>
          </div>
        )}

        <div className="flex items-center gap-1">
          <div
            className="h-4 w-px bg-slate-800 shrink-0 mx-0.5"
            aria-hidden="true"
          />
          {currentView === "chat" ? (
            <>
              <button
                onClick={() => setCurrentView("history")}
                className="p-1.5 rounded-md text-slate-400 hover:text-[#DD3C73] hover:bg-slate-800/60 transition-colors cursor-pointer flex items-center gap-1 text-[11px]"
                title={t("assistant.header.historyTitle")}
                type="button"
              >
                <History className="w-3.5 h-3.5" />
                {conversations.length > 0 && (
                  <span className="text-[9.5px] px-1 rounded bg-slate-800 text-slate-300 font-bold">
                    {conversations.length}
                  </span>
                )}
              </button>
              {onNewChat && (
                <button
                  onClick={handleStartNewChat}
                  className="p-1.5 rounded-md text-slate-400 hover:text-[#DD3C73] hover:bg-slate-800/60 transition-colors cursor-pointer"
                  title={t("assistant.header.newChatTitle")}
                  type="button"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              )}
              {messages.length > 0 && (
                <button
                  onClick={onClearMessages}
                  className="p-1.5 rounded-md text-slate-400 hover:text-rose-400 hover:bg-slate-800/60 transition-colors cursor-pointer"
                  title={t("assistant.header.deleteTitle")}
                  type="button"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
              {onOpenSettings && (
                <button
                  onClick={onOpenSettings}
                  className="p-1.5 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition-colors cursor-pointer"
                  title={t("assistant.header.settingsTitle")}
                  type="button"
                >
                  <Settings className="w-3.5 h-3.5" />
                </button>
              )}
            </>
          ) : (
            <>
              {onNewChat && (
                <button
                  onClick={handleStartNewChat}
                  className="px-2 py-1 text-[10.5px] font-bold tracking-wider rounded bg-[#DD3C73]/15 hover:bg-[#DD3C73]/25 text-[#DD3C73] border border-[#DD3C73]/40 transition-colors cursor-pointer flex items-center gap-1 uppercase"
                  title={t("assistant.header.newChatTitle")}
                  type="button"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{t("assistant.header.newChat")}</span>
                </button>
              )}
            </>
          )}

          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition-colors cursor-pointer"
            title={t("assistant.header.closeTitle")}
            type="button"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main In-Place Content Transition Wrapper */}
      <div className="flex-1 min-h-0 relative">
        {/* Chat Panel View */}
        <div
          className={`absolute inset-0 flex flex-col transition-opacity duration-150 ease-out ${
            currentView === "chat"
              ? "opacity-100 z-10 pointer-events-auto"
              : "opacity-0 z-0 pointer-events-none"
          }`}
        >
          {/* Model Status Bar */}
          <div className="px-4 py-2 bg-canvas border-b border-slate-800/60 flex items-center justify-between text-[11px] text-slate-400 shrink-0">
            <div className="flex items-center gap-2 truncate min-w-0">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0 shadow-[0_0_6px_rgba(52,211,153,0.5)]" />
              <Bot className="w-3.5 h-3.5 text-[#DD3C73] shrink-0" />
              <span className="uppercase text-slate-500 font-semibold text-[10px] tracking-wider">{t("assistant.status.model")}</span>
              <span className="text-slate-300 truncate font-mono text-xs">{activeModel || activeProvider}</span>
            </div>
            <div className="text-[10px] text-slate-400 font-mono truncate max-w-[150px] px-2 py-0.5 rounded bg-slate-800/50 border border-slate-700/50">
              {portfolio?.name || t("assistant.status.noPortfolio")}
            </div>
          </div>

          {/* Message List */}
          <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-4 min-h-0">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col justify-center items-center text-center py-4 px-2 space-y-4">
                <div className="w-12 h-12 rounded-2xl bg-[#DD3C73]/10 border border-[#DD3C73]/25 flex items-center justify-center">
                  <Bot className="w-6 h-6 text-[#DD3C73]" />
                </div>
                <div className="space-y-1">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                    {t("assistant.empty.title")}
                  </h4>
                  <p className="text-[11px] text-slate-400 leading-relaxed max-w-[280px]">
                    {t("assistant.empty.description")}
                  </p>
                </div>

                {/* Portfolio Grounding Card with Action in Conversation */}
                <div className="w-full rounded-xl bg-widget/90 border border-slate-800 p-4 space-y-2.5 text-left">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-200">
                      <Cpu className="w-3.5 h-3.5 text-[#DD3C73]" />
                      <span>{t("assistant.context.title")}</span>
                    </div>
                    <span className="text-[10px] text-slate-400 font-mono bg-slate-800/80 px-2 py-0.5 rounded border border-slate-700/60">
                      {t("assistant.context.holdings", { count: holdingsCount })}
                    </span>
                  </div>

                  <p className="text-[11px] text-slate-400 leading-relaxed font-sans">
                    {withName(
                      groundingText(portfolio?.baseCurrency, cashPercent),
                      <span className="font-semibold text-slate-200">{portfolio?.name || t("assistant.context.activePortfolio")}</span>,
                    )}
                  </p>

                  <button
                    type="button"
                    onClick={handleOpenSystemPrompt}
                    className="w-full py-1.5 px-2.5 rounded-lg bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 hover:border-[#DD3C73]/40 text-[11px] font-medium text-slate-200 hover:text-slate-50 transition-all cursor-pointer flex items-center justify-center gap-1.5"
                    title={t("assistant.context.inspectTitle")}
                  >
                    {systemPromptLoading ? (
                      <Loader2 className="w-3.5 h-3.5 text-[#DD3C73] animate-spin" />
                    ) : (
                      <FileText className="w-3.5 h-3.5 text-[#DD3C73]" />
                    )}
                    <span>{t("assistant.context.inspect")}</span>
                  </button>
                </div>

                {/* Quick Suggestions */}
                <div className="w-full space-y-1.5 pt-1 text-left">
                  <div className="text-[10px] uppercase font-bold text-slate-500 tracking-wider px-1">
                    {t("assistant.quickPrompts.title")}
                  </div>
                  {SUGGESTIONS.map((item, idx) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => chatInputRef.current?.fill(t(`assistant.quickPrompts.${item.key}.prompt`))}
                        className="w-full p-2.5 rounded-lg bg-widget/80 hover:bg-card border border-slate-800 hover:border-[#DD3C73]/40 text-left transition-all cursor-pointer group flex items-center gap-2.5"
                      >
                        <Icon className="w-3.5 h-3.5 text-[#DD3C73] shrink-0 group-hover:scale-110 transition-transform" />
                        <span className="text-xs text-slate-300 group-hover:text-slate-100 font-medium">
                          {t(`assistant.quickPrompts.${item.key}.label`)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <>
                {/* Active Conversation Context Banner */}
                <div className="rounded-lg bg-slate-900/90 border border-slate-800/80 px-3.5 py-2 flex items-center justify-between gap-2 text-[10.5px] text-slate-400">
                  <div className="flex items-center gap-1.5 truncate min-w-0">
                    <Cpu className="w-3.5 h-3.5 text-[#DD3C73] shrink-0" />
                    <span className="truncate">
                      {withName(
                        t("assistant.context.banner", { count: holdingsCount }),
                        <strong className="font-semibold text-slate-300">{portfolio?.name || t("assistant.context.portfolio")}</strong>,
                      )}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleOpenSystemPrompt}
                    className="shrink-0 text-[10px] text-slate-400 hover:text-[#DD3C73] font-medium inline-flex items-center gap-1 transition-colors cursor-pointer"
                    title={t("assistant.context.inspectShortTitle")}
                  >
                    {systemPromptLoading ? (
                      <Loader2 className="w-3.5 h-3.5 text-[#DD3C73] animate-spin" />
                    ) : (
                      <FileText className="w-3.5 h-3.5" />
                    )}
                    <span>{t("assistant.context.inspectShort")}</span>
                  </button>
                </div>

                {hasOpened &&
                  messages.map((msg, index) => {
                    const isUser = msg.role === "user";
                    const canRegenerate =
                      !isUser && index === messages.length - 1 && !isLoading && !!onRegenerateMessage;
                    return (
                      <ChatMessage
                        key={index}
                        content={msg.content}
                        isUser={isUser}
                        index={index}
                        hideValues={hideValues}
                        holdingLinkPlugin={holdingLinkPlugin}
                        copied={copiedIndex === index}
                        onCopy={handleCopyMessage}
                        onRegenerate={canRegenerate ? onRegenerateMessage : undefined}
                      />
                    );
                  })}
              </>
            )}

            {/* Loading Indicator */}
            {isLoading && (
              <div className="flex flex-col items-start space-y-1">
                <span className="text-[10px] text-slate-500 uppercase tracking-wider px-1">
                  {t("assistant.chat.analyst")}
                </span>
                <div className="rounded-xl px-3.5 py-3 bg-widget border border-slate-800 text-slate-300 text-xs flex items-center gap-2.5 shadow-md">
                  <div className="flex items-center gap-1" aria-hidden="true">
                    <span className="cx-typing-dot" />
                    <span className="cx-typing-dot" />
                    <span className="cx-typing-dot" />
                  </div>
                  <span className="text-slate-400 text-xs">{t("assistant.chat.thinking")}</span>
                </div>
              </div>
            )}

            {/* Error Alert */}
            {error && (
              <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs space-y-2">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <div className="font-semibold">{t("assistant.chat.requestFailed")}</div>
                    <div className="text-[11px] leading-relaxed text-rose-300/90">{error}</div>
                  </div>
                </div>
                {onOpenSettings && error.toLowerCase().includes("api key") && (
                  <button
                    onClick={onOpenSettings}
                    className="w-full py-1.5 px-2.5 rounded bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-200 text-xs font-semibold tracking-wide transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                    type="button"
                  >
                    <Settings className="w-3.5 h-3.5" />
                    <span>{t("assistant.chat.configure")}</span>
                  </button>
                )}
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <ChatInput ref={chatInputRef} isLoading={isLoading} baseCurrency={portfolio?.baseCurrency} onSend={onSendMessage} />
        </div>

        {/* History Panel View */}
        <div
          className={`absolute inset-0 flex flex-col bg-widget transition-opacity duration-150 ease-out ${
            currentView === "history"
              ? "opacity-100 z-10 pointer-events-auto"
              : "opacity-0 z-0 pointer-events-none"
          }`}
        >
          {/* Search Filter Bar */}
          <div className="px-4 py-2.5 border-b border-slate-800/80 bg-canvas shrink-0">
            <div className="relative flex items-center">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 pointer-events-none" />
              <input
                type="text"
                value={searchHistoryQuery}
                onChange={(e) => setSearchHistoryQuery(e.target.value)}
                placeholder={t("assistant.history.searchPlaceholder")}
                className="w-full bg-widget border border-slate-800 focus:border-[#DD3C73]/60 rounded-lg pl-8 pr-7 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none transition-colors font-mono"
              />
              {searchHistoryQuery && (
                <button
                  type="button"
                  onClick={() => setSearchHistoryQuery("")}
                  className="absolute right-2 text-slate-500 hover:text-slate-300 p-0.5 cursor-pointer"
                  title={t("assistant.history.clearSearch")}
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {/* Conversations List */}
          <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-2 min-h-0">
            {filteredConversations.length === 0 ? (
              <div className="h-full flex flex-col justify-center items-center text-center p-6 space-y-3">
                <MessageSquareDashed className="w-8 h-8 text-slate-600" />
                <div className="space-y-1">
                  <div className="text-xs font-semibold text-slate-300">
                    {searchHistoryQuery ? t("assistant.history.noMatches") : t("assistant.history.empty")}
                  </div>
                  <p className="text-[11px] text-slate-500 max-w-[220px]">
                    {searchHistoryQuery ? t("assistant.history.noMatchesHint") : t("assistant.history.emptyHint")}
                  </p>
                </div>
                {onNewChat && (
                  <button
                    type="button"
                    onClick={handleStartNewChat}
                    className="mt-1 px-3 py-1.5 text-xs font-bold rounded-lg bg-[#DD3C73]/15 hover:bg-[#DD3C73]/25 text-[#DD3C73] border border-[#DD3C73]/40 transition-colors cursor-pointer flex items-center gap-1.5 uppercase tracking-wider"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{t("assistant.history.startNewChat")}</span>
                  </button>
                )}
              </div>
            ) : (
              filteredConversations.map((c) => {
                const isActive = c.id === currentConversationId;
                return (
                  <div
                    key={c.id}
                    onClick={() => handleSelectConv(c.id)}
                    className={`group relative rounded-xl p-3 border transition-all cursor-pointer text-left ${
                      isActive
                        ? "bg-[#DD3C73]/10 border-[#DD3C73]/40 shadow-sm"
                        : "bg-widget/70 hover:bg-card border-slate-800 hover:border-slate-700"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <MessageSquare
                            className={`w-3.5 h-3.5 shrink-0 ${
                              isActive ? "text-[#DD3C73]" : "text-slate-500 group-hover:text-slate-400"
                            }`}
                          />
                          <span
                            className={`text-xs font-semibold truncate ${
                              isActive ? "text-slate-100" : "text-slate-300 group-hover:text-slate-50"
                            }`}
                          >
                            {c.title ? mask(c.title) : t("assistant.history.untitled")}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-500">
                          <span>{formatTimeAgo(c.updatedAt)}</span>
                          <span>•</span>
                          <span>{t("assistant.history.messages", { count: c.messageCount || 0 })}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0 pt-0.5">
                        {isActive && (
                          <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#DD3C73]/20 text-[#DD3C73] border border-[#DD3C73]/30">
                            {t("assistant.history.active")}
                          </span>
                        )}
                        {onDeleteConversation && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteConversation(c.id);
                            }}
                            className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-rose-500/20 text-slate-500 hover:text-rose-400 transition-all cursor-pointer"
                            title={t("assistant.history.deleteTitle")}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      <AssistantSystemPromptModal
        isOpen={isSystemPromptOpen}
        onClose={() => setIsSystemPromptOpen(false)}
        systemPrompt={maskedSystemPrompt}
        portfolioName={portfolio?.name || ""}
        isLoading={systemPromptLoading}
        error={systemPromptError}
      />
    </aside>
  );
}
