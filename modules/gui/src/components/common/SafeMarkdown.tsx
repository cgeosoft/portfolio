import { memo, useMemo, type ReactNode } from "react";
import ReactMarkdown, { type Components, type Options } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { openExternal } from "../../environment";

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
 */

type RemarkPlugin = NonNullable<Options["remarkPlugins"]>[number];

/** `https` for model and provider text; `web` (http, https, mailto) for the vendor's release notes. */
export type MarkdownLinkPolicy = "https" | "web";

/** Renders an in-app link, such as a holding reference; null hands the link to the external link rules. */
export type InAppLinkRenderer = (href: string | undefined, children: ReactNode) => ReactNode | null;

export const MARKDOWN_LINK_CLASS = "text-[#DD3C73] underline underline-offset-2 hover:text-accent-bright transition-colors";

const REHYPE_PLUGINS = [rehypeSanitize];

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

function withSafeElements(
  base: Components | undefined,
  links: MarkdownLinkPolicy,
  renderInAppLink: InAppLinkRenderer | undefined,
  linkClassName: string,
): Components {
  return {
    ...base,
    a: ({ href, children }) => {
      const inApp = renderInAppLink?.(href, children);
      if (inApp !== null && inApp !== undefined) return inApp;
      const target = externalLinkTarget(href, links);
      if (!target) return <span>{children}</span>;
      return (
        <a
          href={target}
          title={target}
          rel="noopener noreferrer"
          className={linkClassName}
          onClick={(e) => {
            e.preventDefault();
            openExternal(target);
          }}
        >
          {children}
        </a>
      );
    },
    img: ({ alt }) => (alt ? <span>{alt}</span> : null),
  };
}

interface SafeMarkdownProps {
  children: string;
  /** Element styles. `a` and `img` are always the safe versions above. */
  components?: Components;
  /** A remark plugin to run after GitHub Flavored Markdown, such as the holding linker. */
  remarkPlugin?: RemarkPlugin;
  links?: MarkdownLinkPolicy;
  renderInAppLink?: InAppLinkRenderer;
  linkClassName?: string;
}

export const SafeMarkdown = memo(function SafeMarkdown({
  children,
  components,
  remarkPlugin,
  links = "https",
  renderInAppLink,
  linkClassName = MARKDOWN_LINK_CLASS,
}: SafeMarkdownProps) {
  const remarkPlugins = useMemo<RemarkPlugin[]>(() => (remarkPlugin ? [remarkGfm, remarkPlugin] : [remarkGfm]), [remarkPlugin]);
  const elements = useMemo(
    () => withSafeElements(components, links, renderInAppLink, linkClassName),
    [components, links, renderInAppLink, linkClassName],
  );
  return (
    <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={REHYPE_PLUGINS} components={elements}>
      {children}
    </ReactMarkdown>
  );
});
