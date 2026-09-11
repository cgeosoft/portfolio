import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import type { PortfolioItem, FinancialPortfolioData } from "../../types/portfolio";
import type { PortfolioChatMessage, AssistantConversation } from "../../../../shared/rpc-types";
import { cleanThinkTags, formatTimeAgo } from "./utils";
import { rpc } from "../../rpc";
import { AssistantSystemPromptModal } from "./AssistantSystemPromptModal";
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
} from "lucide-react";

interface AssistantSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  portfolio: PortfolioItem | null;
  portfolioData: FinancialPortfolioData | null;
  onOpenSettings?: () => void;
  conversations?: AssistantConversation[];
  currentConversationId?: string | null;
  onSelectConversation?: (id: string) => void;
  onNewChat?: () => void;
  onDeleteConversation?: (id: string) => void;
  messages: PortfolioChatMessage[];
  onSendMessage: (text: string) => Promise<void>;
  onClearMessages: () => void;
  isLoading: boolean;
  error?: string | null;
  activeProvider?: string;
  activeModel?: string;
}

const SUGGESTIONS = [
  {
    icon: TrendingUp,
    label: "Portfolio health summary",
    prompt: "Provide an executive summary of my portfolio health, total returns, and current valuation.",
  },
  {
    icon: ShieldAlert,
    label: "Risk & asset concentration",
    prompt: "Assess my portfolio risk exposure and asset allocation concentration. Are there any overweight positions?",
  },
  {
    icon: Activity,
    label: "Technical indicators (RSI/SMA)",
    prompt: "Review the technical indicators (RSI 14, SMA 50, SMA 200) for all my holdings. Which ones appear overbought or oversold?",
  },
  {
    icon: Wallet,
    label: "Cash liquidity & buffer",
    prompt: "Analyze my cash liquidity buffer and explain whether my cash reserve is optimal given my current holdings.",
  },
];

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
  onClearMessages,
  isLoading,
  error,
  activeProvider = "Local LLM",
  activeModel,
}: AssistantSidebarProps) {
  const [currentView, setCurrentView] = useState<"chat" | "history">("chat");
  const [searchHistoryQuery, setSearchHistoryQuery] = useState("");
  const [inputText, setInputText] = useState("");
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [isSystemPromptOpen, setIsSystemPromptOpen] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [systemPromptLoading, setSystemPromptLoading] = useState(false);
  const [systemPromptError, setSystemPromptError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
        textareaRef.current?.focus();
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [isOpen, currentView]);

  const handleSend = useCallback(async () => {
    const trimmed = inputText.trim();
    if (!trimmed || isLoading) return;
    setInputText("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
    await onSendMessage(trimmed);
  }, [inputText, isLoading, onSendMessage]);

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

  const handleCopyMessage = async (content: string, index: number) => {
    try {
      await navigator.clipboard.writeText(cleanThinkTags(content, false));
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch {
      // Ignore clipboard error
    }
  };

  const handleOpenSystemPrompt = useCallback(async () => {
    if (!portfolio?.id) return;
    setIsSystemPromptOpen(true);
    setSystemPromptLoading(true);
    setSystemPromptError(null);
    try {
      const res = await rpc.request.getAssistantSystemPrompt({ portfolioId: portfolio.id });
      setSystemPrompt(res.systemPrompt);
    } catch (err) {
      setSystemPromptError(err instanceof Error ? err.message : "Failed to load the system prompt.");
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
      aria-label="AI Portfolio Assistant"
      className={`shrink-0 flex flex-col h-full bg-[#0c1220] border-l border-slate-800/80 transition-all duration-300 ease-in-out font-mono text-slate-200 z-30 select-text ${
        isOpen
          ? "w-full sm:w-[400px] lg:w-[430px] opacity-100 visible"
          : "w-0 opacity-0 invisible overflow-hidden border-l-0"
      }`}
    >
      {/* Sidebar Header */}
      <div className="px-4 py-2.5 border-b border-slate-800/80 bg-[#090e1a] flex items-center justify-between shrink-0">
        {currentView === "chat" ? (
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-6 h-6 rounded-md bg-[#DD3C73]/15 border border-[#DD3C73]/30 flex items-center justify-center shrink-0">
              <Sparkles className="w-3.5 h-3.5 text-[#DD3C73]" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-100">
                  Assistant
                </span>
                {activeConversation?.title && (
                  <span
                    className="text-[10px] text-slate-400 font-normal truncate max-w-[130px] px-1.5 py-0.5 rounded bg-slate-800/60 border border-slate-700/50"
                    title={activeConversation.title}
                  >
                    {activeConversation.title}
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
              title="Return to conversation"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back</span>
            </button>
            <div className="flex items-center gap-1.5 ml-1">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-100">
                History
              </span>
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-800 text-slate-400 font-mono">
                {conversations.length}
              </span>
            </div>
          </div>
        )}

        <div className="flex items-center gap-1">
          {currentView === "chat" ? (
            <>
              <button
                onClick={() => setCurrentView("history")}
                className="p-1.5 rounded-md text-slate-400 hover:text-[#DD3C73] hover:bg-slate-800/60 transition-colors cursor-pointer flex items-center gap-1 text-[11px]"
                title="View Conversation History"
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
                  title="Start New Chat"
                  type="button"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              )}
              {messages.length > 0 && (
                <button
                  onClick={onClearMessages}
                  className="p-1.5 rounded-md text-slate-400 hover:text-rose-400 hover:bg-slate-800/60 transition-colors cursor-pointer"
                  title="Delete current conversation"
                  type="button"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
              {onOpenSettings && (
                <button
                  onClick={onOpenSettings}
                  className="p-1.5 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition-colors cursor-pointer"
                  title="Assistant Settings"
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
                  title="Start New Chat"
                  type="button"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>New Chat</span>
                </button>
              )}
            </>
          )}

          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition-colors cursor-pointer"
            title="Close Assistant (Ctrl+J)"
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
          <div className="px-4 py-2 bg-[#080c16] border-b border-slate-800/60 flex items-center justify-between text-[11px] text-slate-400 shrink-0">
            <div className="flex items-center gap-2 truncate min-w-0">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0 shadow-[0_0_6px_rgba(52,211,153,0.5)]" />
              <Bot className="w-3.5 h-3.5 text-[#DD3C73] shrink-0" />
              <span className="uppercase text-slate-500 font-semibold text-[10px] tracking-wider">Model:</span>
              <span className="text-slate-300 truncate font-mono text-xs">{activeModel || activeProvider}</span>
            </div>
            <div className="text-[10px] text-slate-400 font-mono truncate max-w-[150px] px-2 py-0.5 rounded bg-slate-800/50 border border-slate-700/50">
              {portfolio?.name || "No active portfolio"}
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
                    Portfolio Intelligence Assistant
                  </h4>
                  <p className="text-[11px] text-slate-400 leading-relaxed max-w-[280px]">
                    Ask questions about your asset allocation, technical indicators, unrealized gains, or risk exposure.
                  </p>
                </div>

                {/* Portfolio Grounding Card with Action in Conversation */}
                <div className="w-full rounded-xl bg-[#111827]/90 border border-slate-800 p-4 space-y-2.5 text-left">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-200">
                      <Cpu className="w-3.5 h-3.5 text-[#DD3C73]" />
                      <span>Portfolio Context</span>
                    </div>
                    <span className="text-[10px] text-slate-400 font-mono bg-slate-800/80 px-2 py-0.5 rounded border border-slate-700/60">
                      {holdingsCount} {holdingsCount === 1 ? "Holding" : "Holdings"}
                    </span>
                  </div>

                  <p className="text-[11px] text-slate-400 leading-relaxed font-sans">
                    Grounded in <span className="font-semibold text-slate-200">{portfolio?.name || "Active Portfolio"}</span>
                    {portfolio?.baseCurrency ? ` (${portfolio.baseCurrency})` : ""}
                    {cashPercent !== undefined ? ` with ${cashPercent.toFixed(1)}% cash allocation` : ""}.
                  </p>

                  <button
                    type="button"
                    onClick={handleOpenSystemPrompt}
                    className="w-full py-1.5 px-2.5 rounded-lg bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 hover:border-[#DD3C73]/40 text-[11px] font-medium text-slate-200 hover:text-white transition-all cursor-pointer flex items-center justify-center gap-1.5"
                    title="Inspect the quantitative system prompt sent to the model"
                  >
                    {systemPromptLoading ? (
                      <Loader2 className="w-3.5 h-3.5 text-[#DD3C73] animate-spin" />
                    ) : (
                      <FileText className="w-3.5 h-3.5 text-[#DD3C73]" />
                    )}
                    <span>Inspect System Prompt & Context</span>
                  </button>
                </div>

                {/* Quick Suggestions */}
                <div className="w-full space-y-1.5 pt-1 text-left">
                  <div className="text-[10px] uppercase font-bold text-slate-500 tracking-wider px-1">
                    Suggested questions
                  </div>
                  {SUGGESTIONS.map((item, idx) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => {
                          setInputText(item.prompt);
                          textareaRef.current?.focus();
                        }}
                        className="w-full p-2.5 rounded-lg bg-[#111827]/80 hover:bg-[#151f33] border border-slate-800 hover:border-[#DD3C73]/40 text-left transition-all cursor-pointer group flex items-center gap-2.5"
                      >
                        <Icon className="w-3.5 h-3.5 text-[#DD3C73] shrink-0 group-hover:scale-110 transition-transform" />
                        <span className="text-xs text-slate-300 group-hover:text-slate-100 font-medium">
                          {item.label}
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
                      Grounded in <strong className="font-semibold text-slate-300">{portfolio?.name || "Portfolio"}</strong> ({holdingsCount} assets)
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleOpenSystemPrompt}
                    className="shrink-0 text-[10px] text-slate-400 hover:text-[#DD3C73] font-medium inline-flex items-center gap-1 transition-colors cursor-pointer"
                    title="Inspect the quantitative prompt sent to the model"
                  >
                    {systemPromptLoading ? (
                      <Loader2 className="w-3.5 h-3.5 text-[#DD3C73] animate-spin" />
                    ) : (
                      <FileText className="w-3.5 h-3.5" />
                    )}
                    <span>Inspect Context</span>
                  </button>
                </div>

                {messages.map((msg, index) => {
                  const isUser = msg.role === "user";
                  const cleanedContent = cleanThinkTags(msg.content, false);

                  return (
                    <div
                      key={index}
                      className={`flex flex-col ${isUser ? "items-end" : "items-start"} group`}
                    >
                      <div className="flex items-center gap-1.5 mb-1 px-1 text-[10px] text-slate-500 uppercase tracking-wider">
                        <span>{isUser ? "You" : "Analyst"}</span>
                      </div>

                      <div
                        className={`relative rounded-xl text-xs leading-relaxed max-w-[92%] px-3.5 py-2.5 break-words ${
                          isUser
                            ? "bg-[#DD3C73]/15 border border-[#DD3C73]/40 text-slate-100 font-mono shadow-sm"
                            : "bg-[#111728] border border-slate-800 text-slate-200 shadow-md"
                        }`}
                      >
                        {isUser ? (
                          <div className="whitespace-pre-wrap">{msg.content}</div>
                        ) : (
                          <div className="prose prose-invert prose-xs max-w-none space-y-2 text-xs">
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm]}
                              rehypePlugins={[rehypeSanitize]}
                              components={{
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
                                a: ({ href, children }) => (
                                  <a
                                    href={href}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-[#DD3C73] underline underline-offset-2 hover:text-[#e8558a] transition-colors"
                                  >
                                    {children}
                                  </a>
                                ),
                                strong: ({ children }) => (
                                  <strong className="font-bold text-slate-100">{children}</strong>
                                ),
                                code: ({ children }) => (
                                  <code className="bg-slate-900 px-1 py-0.5 rounded text-[11px] text-[#A7E2C0] font-mono border border-slate-800">
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
                              }}
                            >
                              {cleanedContent}
                            </ReactMarkdown>

                            {/* Copy message button */}
                            <div className="flex justify-end pt-1">
                              <button
                                onClick={() => handleCopyMessage(msg.content, index)}
                                className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-[10px] text-slate-500 hover:text-slate-300 flex items-center gap-1 cursor-pointer"
                                title="Copy response"
                                type="button"
                              >
                                {copiedIndex === index ? (
                                  <>
                                    <Check className="w-3 h-3 text-emerald-400" />
                                    <span className="text-emerald-400">Copied</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-3 h-3" />
                                    <span>Copy</span>
                                  </>
                                )}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </>
            )}

            {/* Loading Indicator */}
            {isLoading && (
              <div className="flex flex-col items-start space-y-1">
                <span className="text-[10px] text-slate-500 uppercase tracking-wider px-1">
                  Analyst
                </span>
                <div className="rounded-xl px-3.5 py-3 bg-[#111728] border border-slate-800 text-slate-300 text-xs flex items-center gap-2.5 shadow-md">
                  <div className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#DD3C73] animate-ping" />
                    <span className="w-1.5 h-1.5 rounded-full bg-[#DD3C73] animate-pulse" />
                    <span className="w-1.5 h-1.5 rounded-full bg-[#DD3C73]" />
                  </div>
                  <span className="text-slate-400 text-xs">Analyzing portfolio metrics...</span>
                </div>
              </div>
            )}

            {/* Error Alert */}
            {error && (
              <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs space-y-2">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <div className="font-semibold">Assistant Request Failed</div>
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
                    <span>Configure Assistant in Settings</span>
                  </button>
                )}
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <div className="px-4 py-3 border-t border-slate-800/80 bg-[#090e1a] shrink-0">
            <div className="relative flex items-end gap-2 bg-[#0e1526] border border-slate-700/80 focus-within:border-[#DD3C73]/70 focus-within:ring-1 focus-within:ring-[#DD3C73]/40 rounded-xl p-2 transition-all shadow-inner">
              <textarea
                ref={textareaRef}
                value={inputText}
                onChange={handleTextareaInput}
                onKeyDown={handleKeyDown}
                placeholder="Ask about your holdings, risks, metrics..."
                rows={1}
                disabled={isLoading}
                className="flex-1 bg-transparent border-0 resize-none text-xs text-slate-100 placeholder-slate-500 focus:outline-none custom-scrollbar max-h-[120px] py-1 font-mono leading-relaxed"
              />
              <button
                type="button"
                onClick={handleSend}
                disabled={!inputText.trim() || isLoading}
                className="h-8 w-8 rounded-lg bg-[#DD3C73] hover:bg-[#c93264] disabled:opacity-40 disabled:hover:bg-[#DD3C73] disabled:cursor-not-allowed text-white flex items-center justify-center transition-colors shrink-0 cursor-pointer shadow-md"
                title="Send Message (Enter)"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex items-center justify-between mt-1.5 px-1 text-[10px] text-slate-500">
              <span>Enter to send, Shift+Enter for newline</span>
              {portfolio?.baseCurrency && (
                <span className="font-semibold text-slate-400">
                  Grounded in {portfolio.baseCurrency}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* History Panel View */}
        <div
          className={`absolute inset-0 flex flex-col bg-[#0c1220] transition-opacity duration-150 ease-out ${
            currentView === "history"
              ? "opacity-100 z-10 pointer-events-auto"
              : "opacity-0 z-0 pointer-events-none"
          }`}
        >
          {/* Search Filter Bar */}
          <div className="px-4 py-2.5 border-b border-slate-800/80 bg-[#090e1a] shrink-0">
            <div className="relative flex items-center">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 pointer-events-none" />
              <input
                type="text"
                value={searchHistoryQuery}
                onChange={(e) => setSearchHistoryQuery(e.target.value)}
                placeholder="Search saved conversations..."
                className="w-full bg-[#0e1526] border border-slate-800 focus:border-[#DD3C73]/60 rounded-lg pl-8 pr-7 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none transition-colors font-mono"
              />
              {searchHistoryQuery && (
                <button
                  type="button"
                  onClick={() => setSearchHistoryQuery("")}
                  className="absolute right-2 text-slate-500 hover:text-slate-300 p-0.5 cursor-pointer"
                  title="Clear search"
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
                    {searchHistoryQuery ? "No matching conversations" : "No saved conversations yet"}
                  </div>
                  <p className="text-[11px] text-slate-500 max-w-[220px]">
                    {searchHistoryQuery
                      ? "Try a different search query."
                      : "Start a conversation to analyze portfolio metrics."}
                  </p>
                </div>
                {onNewChat && (
                  <button
                    type="button"
                    onClick={handleStartNewChat}
                    className="mt-1 px-3 py-1.5 text-xs font-bold rounded-lg bg-[#DD3C73]/15 hover:bg-[#DD3C73]/25 text-[#DD3C73] border border-[#DD3C73]/40 transition-colors cursor-pointer flex items-center gap-1.5 uppercase tracking-wider"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Start New Chat</span>
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
                        : "bg-[#111728]/70 hover:bg-[#151f33] border-slate-800 hover:border-slate-700"
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
                              isActive ? "text-slate-100" : "text-slate-300 group-hover:text-white"
                            }`}
                          >
                            {c.title || "Untitled Conversation"}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-500">
                          <span>{formatTimeAgo(c.updatedAt)}</span>
                          <span>•</span>
                          <span>{c.messages?.length || 0} messages</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0 pt-0.5">
                        {isActive && (
                          <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#DD3C73]/20 text-[#DD3C73] border border-[#DD3C73]/30">
                            Active
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
                            title="Delete conversation"
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
        systemPrompt={systemPrompt}
        portfolioName={portfolio?.name || ""}
        isLoading={systemPromptLoading}
        error={systemPromptError}
      />
    </aside>
  );
}
