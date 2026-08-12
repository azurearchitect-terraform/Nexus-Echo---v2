import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { memo } from "react";

/**
 * Memoized because streaming re-renders this on every token, and re-parsing a
 * growing markdown string 60 times a second is the difference between a smooth
 * stream and a stuttering one.
 */
export const Markdown = memo(function Markdown({ children, style }: { children: string; style?: React.CSSProperties }) {
  return (
    <div className="answer leading-relaxed" style={{ fontSize: "15px", ...style }}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
});
