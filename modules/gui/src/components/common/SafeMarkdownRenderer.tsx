import { memo, useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { openExternal } from "../../environment";
import { MARKDOWN_LINK_CLASS, externalLinkTarget, type InAppLinkRenderer, type MarkdownLinkPolicy, type RemarkPlugin, type SafeMarkdownProps } from "./SafeMarkdown";

/** The react-markdown side of `SafeMarkdown`, in its own chunk so the parser loads with the first Markdown shown. */

const REHYPE_PLUGINS = [rehypeSanitize];

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

const SafeMarkdownRenderer = memo(function SafeMarkdownRenderer({
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

export default SafeMarkdownRenderer;
