import type { Components } from "react-markdown";

/** Styles of the report body; module level, so the elements are not remounted on every render. */
export const REPORT_MARKDOWN: Components = {
  h1: ({ node: _n, ...props }) => (
    <h1 className="text-sm font-bold uppercase tracking-wider text-[#DD3C73] border-b border-slate-800 pb-1.5 mt-4 mb-2" {...props} />
  ),
  h2: ({ node: _n, ...props }) => (
    <h2 className="text-xs font-bold uppercase tracking-wider text-[#DD3C73] mt-4 mb-2" {...props} />
  ),
  h3: ({ node: _n, ...props }) => (
    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200 mt-3 mb-1.5" {...props} />
  ),
  p: ({ node: _n, ...props }) => <p className="mb-2.5 text-slate-300 leading-relaxed" {...props} />,
  ul: ({ node: _n, ...props }) => <ul className="list-disc list-outside pl-4 mb-3 space-y-1 text-slate-300" {...props} />,
  ol: ({ node: _n, ...props }) => <ol className="list-decimal list-outside pl-4 mb-3 space-y-1 text-slate-300" {...props} />,
  li: ({ node: _n, ...props }) => <li className="text-slate-300 leading-relaxed" {...props} />,
  blockquote: ({ node: _n, ...props }) => (
    <blockquote className="border-l-2 border-[#DD3C73] bg-[#DD3C73]/5 px-3 py-2 my-3 text-slate-400 italic rounded-r" {...props} />
  ),
  table: ({ node: _n, ...props }) => (
    <div className="my-3 overflow-x-auto rounded-lg border border-slate-800 bg-slate-950">
      <table className="w-full border-collapse font-mono text-xs" {...props} />
    </div>
  ),
  thead: ({ node: _n, ...props }) => (
    <thead className="border-b border-slate-800 bg-slate-900 text-slate-400 uppercase tracking-wider" {...props} />
  ),
  tbody: ({ node: _n, ...props }) => <tbody className="divide-y divide-slate-800/60 text-slate-300" {...props} />,
  tr: ({ node: _n, ...props }) => <tr className="hover:bg-slate-800/30 transition-colors" {...props} />,
  th: ({ node: _n, ...props }) => <th className="px-3 py-2 text-left font-bold text-slate-200" {...props} />,
  td: ({ node: _n, ...props }) => <td className="px-3 py-2 text-slate-400" {...props} />,
  strong: ({ node: _n, ...props }) => <strong className="font-bold text-slate-100" {...props} />,
  code: ({ node: _n, ...props }) => (
    <code className="px-1.5 py-0.5 rounded-sm bg-slate-950 border border-slate-800 text-cream font-mono text-[11px]" {...props} />
  ),
};
