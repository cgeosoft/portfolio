import { useState, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { Terminal, Copy, CheckCheck, X, Bot, AlertCircle, Loader2, FileCode } from "lucide-react";

interface AssistantSystemPromptModalProps {
  isOpen: boolean;
  onClose: () => void;
  systemPrompt: string;
  portfolioName: string;
  isLoading: boolean;
  error?: string | null;
}

export function AssistantSystemPromptModal({
  isOpen,
  onClose,
  systemPrompt,
  portfolioName,
  isLoading,
  error,
}: AssistantSystemPromptModalProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const handleCopy = useCallback(async () => {
    if (!systemPrompt) return;
    try {
      await navigator.clipboard.writeText(systemPrompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore clipboard error
    }
  }, [systemPrompt]);

  if (!isOpen) return null;

  const charCount = systemPrompt.length;
  const wordCount = systemPrompt ? systemPrompt.trim().split(/\s+/).length : 0;
  const approxTokens = Math.round(charCount / 4);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-2 sm:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200 font-mono overflow-y-auto">
      <div
        className="relative w-full max-w-2xl sm:max-w-3xl flex flex-col rounded-xl sm:rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl overflow-hidden max-h-[calc(100dvh-1rem)] sm:max-h-[90dvh] my-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="assistant-system-prompt-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950/70 px-4 py-3 sm:px-5 sm:py-3.5 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-lg border border-[#DD3C73]/30 bg-[#DD3C73]/10 flex items-center justify-center text-[#DD3C73] shrink-0">
              <Terminal className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2
                id="assistant-system-prompt-title"
                className="text-xs sm:text-sm font-bold uppercase tracking-wider text-slate-100 truncate"
              >
                Assistant System Prompt
              </h2>
              <div className="flex flex-wrap items-center gap-2 mt-0.5 text-[10px] text-slate-400">
                <span className="flex items-center gap-1">
                  <Bot className="w-3 h-3 text-[#DD3C73]" />
                  <span className="truncate">{portfolioName || "Current Portfolio"}</span>
                </span>
                <span className="text-slate-600">•</span>
                <span className="text-slate-400">Sent as the system message in each new chat</span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
            title="Close system prompt"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Toolbar */}
        <div className="px-4 sm:px-5 py-2.5 border-b border-slate-800/80 bg-slate-950/40 flex flex-wrap items-center justify-between gap-2.5 shrink-0 text-xs">
          <div className="flex items-center gap-1.5 text-slate-400 text-xs font-bold uppercase tracking-wider">
            <FileCode className="w-3.5 h-3.5 text-[#DD3C73]" />
            <span>System Prompt Payload</span>
          </div>

          {systemPrompt && (
            <div className="flex items-center gap-2 text-[10px] text-slate-500 font-mono ml-auto">
              <span>{wordCount} words</span>
              <span>•</span>
              <span>{charCount} chars</span>
              <span>•</span>
              <span>~{approxTokens} tokens</span>
            </div>
          )}
        </div>

        {/* Modal Content */}
        <div className="p-4 sm:p-5 flex-1 min-h-0 overflow-hidden flex flex-col">
          {isLoading ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center rounded-xl border border-slate-800 bg-slate-950/60">
              <Loader2 className="w-7 h-7 text-[#DD3C73] mb-3 animate-spin" />
              <div className="text-xs font-bold uppercase tracking-wider text-slate-200">
                Building system prompt...
              </div>
              <p className="max-w-md text-[11px] text-slate-400 leading-relaxed">
                Compiling live portfolio metrics, holdings, and technical indicators.
              </p>
            </div>
          ) : error ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center rounded-xl border border-rose-500/30 bg-rose-500/5">
              <AlertCircle className="w-8 h-8 text-rose-400 mb-3 opacity-80" />
              <div className="text-xs font-bold uppercase tracking-wider text-slate-200 mb-1">
                Could Not Load System Prompt
              </div>
              <p className="max-w-md text-[11px] text-slate-400 leading-relaxed">{error}</p>
            </div>
          ) : !systemPrompt ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center rounded-xl border border-slate-800 bg-slate-950/60">
              <AlertCircle className="w-8 h-8 text-[#E3EACD] mb-3 opacity-80" />
              <div className="text-xs font-bold uppercase tracking-wider text-slate-200 mb-1">
                No System Prompt
              </div>
              <p className="max-w-md text-[11px] text-slate-400 leading-relaxed">
                Select a portfolio to view its assistant system prompt.
              </p>
            </div>
          ) : (
            <div className="relative flex-1 min-h-0 flex flex-col rounded-xl border border-slate-800 bg-slate-950 overflow-hidden">
              <div className="absolute top-2.5 right-2.5 z-10">
                <button
                  type="button"
                  onClick={handleCopy}
                  className="h-7 inline-flex items-center gap-1.5 px-2.5 rounded-lg border border-slate-800 bg-slate-900/90 text-[11px] font-medium text-slate-300 hover:text-white hover:border-slate-700 transition-colors shadow-lg cursor-pointer"
                  title="Copy system prompt text"
                >
                  {copied ? (
                    <>
                      <CheckCheck className="w-3.5 h-3.5 text-[#A7E2C0]" />
                      <span className="text-[#A7E2C0]">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-slate-400" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>

              <div className="flex-1 min-h-0 p-4 overflow-auto custom-scrollbar select-text prose prose-invert max-w-none space-y-1 text-xs">
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
                      <p className="my-1.5 leading-relaxed text-slate-300 text-xs whitespace-pre-wrap">
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
                    li: ({ children }) => <li className="text-slate-300 text-xs">{children}</li>,
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
                  {systemPrompt}
                </ReactMarkdown>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between border-t border-slate-800 bg-slate-950/70 px-4 py-2.5 sm:px-5 sm:py-3 shrink-0 gap-3">
          <div className="text-[10px] text-slate-500 truncate">
            {systemPrompt
              ? "The exact system message sent to the model in a new conversation."
              : "System prompt preview"}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {systemPrompt && (
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-800 bg-slate-900 text-xs font-bold text-slate-300 hover:text-white hover:border-slate-700 transition-colors cursor-pointer"
              >
                {copied ? (
                  <>
                    <CheckCheck className="w-3.5 h-3.5 text-[#A7E2C0]" />
                    <span className="text-[#A7E2C0]">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-slate-400" />
                    <span>Copy Prompt</span>
                  </>
                )}
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg bg-[#243C8F] hover:bg-[#341B83] text-white text-xs font-bold transition-all cursor-pointer uppercase tracking-wider"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}