import { lazy, memo, Suspense, type ReactNode } from "react";
import type { Components, Options } from "react-markdown";

/**
 * Markdown from a model, a data provider or the release notes. react-markdown keeps raw
 * HTML as text and rehype-sanitize drops unsafe attributes. On top of that:
 *
 * - Images never load. A model that a news item talks into writing `![](https://…?data)`
 *   would send whatever the URL carries; the alt text shows instead.
 * - Links never navigate the window. A click opens the target through `openExternal()`,
 *   and text from a model or a provider opens `https:` links only; other links show as text.
 *
 * react-markdown parses the whole text on every render, and a new `components` object
 * remounts every element. Keep `components`, `remarkPlugin` and `renderInAppLink` stable
 * (module level or memoized): the component is memoized on its props.
 *
 * The parser lives in `SafeMarkdownRenderer` and loads on first use; until then the text shows as is.
 */

export type RemarkPlugin = NonNullable<Options["remarkPlugins"]>[number];

/** `https` for model and provider text; `web` (http, https, mailto) for the vendor's release notes. */
export type MarkdownLinkPolicy = "https" | "web";

/** Renders an in-app link, such as a holding reference; null hands the link to the external link rules. */
export type InAppLinkRenderer = (href: string | undefined, children: ReactNode) => ReactNode | null;

export const MARKDOWN_LINK_CLASS = "text-[#DD3C73] underline underline-offset-2 hover:text-accent-bright transition-colors";

/** The URL a Markdown link may open under `policy`, or null. Relative links never open. */
export function externalLinkTarget(href: string | undefined, policy: MarkdownLinkPolicy): string | null {
  if (!href) return null;
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol === "https:") return url.href;
  if (policy === "web" && (url.protocol === "http:" || url.protocol === "mailto:")) return url.href;
  return null;
}

export interface SafeMarkdownProps {
  children: string;
  /** Element styles. `a` and `img` are always the safe versions above. */
  components?: Components;
  /** A remark plugin to run after GitHub Flavored Markdown, such as the holding linker. */
  remarkPlugin?: RemarkPlugin;
  links?: MarkdownLinkPolicy;
  renderInAppLink?: InAppLinkRenderer;
  linkClassName?: string;
}

const SafeMarkdownRenderer = lazy(() => import("./SafeMarkdownRenderer"));

export const SafeMarkdown = memo(function SafeMarkdown(props: SafeMarkdownProps) {
  return (
    <Suspense fallback={<div className="whitespace-pre-wrap">{props.children}</div>}>
      <SafeMarkdownRenderer {...props} />
    </Suspense>
  );
});
