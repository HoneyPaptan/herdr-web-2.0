import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";

import { foldCode, parseMarkdown, type InlineNode, type ListBlock, type MarkdownBlock } from "../lib/markdown.ts";
import { codeIsFilePath, OpenFileContext, splitFilePaths } from "../lib/filePaths.ts";
import { fileUriPath } from "../lib/terminalFileLinks.ts";
import { useT } from "../lib/i18n.ts";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const LINK = "wrap-anywhere font-medium text-primary underline";
const FILE = "inline cursor-pointer border-0 bg-transparent p-0 text-left text-inherit underline decoration-transparent underline-offset-2 transition-colors [font:inherit] wrap-anywhere hover:decoration-current";
const INLINE_CODE = "rounded-sm bg-muted px-1 font-mono text-code text-foreground";
const BLOCK_GAP = "mt-0 mb-3";
const HEADING: Record<1 | 2 | 3 | 4 | 5 | 6, string> = {
  1: "mt-4 mb-2", 2: "mt-4 mb-2", 3: "mt-3 mb-1.5", 4: "mt-3 mb-1.5", 5: "mt-3 mb-1.5", 6: "mt-3 mb-1.5 text-muted-foreground",
};
const NESTED = "[&_li>div]:my-1 [&_li>p]:my-1 [&_ol]:mt-1 [&_ol]:mb-0 [&_ul]:mt-1 [&_ul]:mb-0";
const CELL = "border border-border px-2 py-1.5 text-left align-top";

type Katex = typeof import("../lib/katex.ts").default;

let loadedKatex: Katex | null = null;
let katexLoad: Promise<Katex> | null = null;

export function loadKatex(): Promise<Katex> {
  katexLoad ??= import("../lib/katex.ts").then((module) => (loadedKatex = module.default));
  return katexLoad;
}

function useKatex(): Katex | null {
  const [katex, setKatex] = useState(loadedKatex);
  useEffect(() => {
    if (!katex) void loadKatex().then(setKatex, () => undefined);
  }, [katex]);
  return katex;
}

function MathExpression({ value, displayMode = false }: { value: string; displayMode?: boolean }) {
  const katex = useKatex();
  const source = <span>{displayMode ? `\\[${value}\\]` : `\\(${value}\\)`}</span>;
  if (!katex) return source;
  try {
    const html = katex.renderToString(value, { displayMode, strict: "ignore" });
    return <span className={displayMode ? cn("markdown-math-display block max-w-full overflow-x-auto", BLOCK_GAP) : "markdown-math"} dangerouslySetInnerHTML={{ __html: html }} />;
  } catch {
    return source;
  }
}

function FilePath({ path, code, open }: { path: string; code: boolean; open: (path: string) => void }) {
  const t = useT();
  const label = code ? <code className={INLINE_CODE}>{path}</code> : path;
  return <button type="button" className={cn("markdown-file", FILE)} aria-label={t("Open {path}", { path })} onClick={() => open(path)}>{label}</button>;
}

function Inline({ nodes, interactive = true }: { nodes: InlineNode[]; interactive?: boolean }) {
  const context = useContext(OpenFileContext);
  const open = interactive ? context : null;
  const t = useT();
  return <>{nodes.map((node, index) => {
    const key = `${node.type}-${index}`;
    switch (node.type) {
      case "text":
        if (open === null) return <span key={key}>{node.value}</span>;
        return <span key={key}>{splitFilePaths(node.value).map((part, n) => typeof part === "string" ? part : <FilePath key={n} path={part.path} code={false} open={open} />)}</span>;
      case "code": {
        const file = fileUriPath(node.value);
        if (open !== null && file !== null) return <FilePath key={key} path={file} code open={open} />;
        if (interactive && /^https?:\/\/\S+$/i.test(node.value)) return <a key={key} className={LINK} href={node.value} target="_blank" rel="noopener noreferrer"><code className={INLINE_CODE}>{node.value}</code></a>;
        return open !== null && codeIsFilePath(node.value) ? <FilePath key={key} path={node.value} code open={open} /> : <code key={key} className={INLINE_CODE}>{node.value}</code>;
      }
      case "math": return <MathExpression key={key} value={node.value} />;
      case "strong": return <strong key={key} className="font-semibold"><Inline nodes={node.children} interactive={interactive} /></strong>;
      case "em": return <em key={key}><Inline nodes={node.children} interactive={interactive} /></em>;
      case "del": return <del key={key}><Inline nodes={node.children} interactive={interactive} /></del>;
      case "link": return <a key={key} className={LINK} href={node.href} target="_blank" rel="noopener noreferrer"><Inline nodes={node.children} interactive={false} /></a>;
      case "file": {
        const label = <Inline nodes={node.children} interactive={false} />;
        return open !== null
          ? <button key={key} type="button" className={cn("markdown-file", FILE)} aria-label={t("Open {path}", { path: node.path })} onClick={() => open(node.path)}>{label}</button>
          : <span key={key}>{label} (<code className={INLINE_CODE}>{node.path}</code>)</span>;
      }
    }
  })}</>;
}

function List({ block }: { block: ListBlock }) {
  const Tag = block.ordered ? "ol" : "ul";
  return (
    <Tag className={cn("markdown-list pl-5", BLOCK_GAP, block.ordered ? "list-decimal" : "list-disc", NESTED)} start={block.ordered ? block.start : undefined}>
      {block.items.map((item, index) => (
        <li key={index}>
          <Inline nodes={item.content} />
          {item.blocks !== undefined && <Blocks blocks={item.blocks} />}
        </li>
      ))}
    </Tag>
  );
}

function CodeBlock({ language, value }: { language: string; value: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const block = useRef<HTMLDivElement>(null);
  const fold = useMemo(() => foldCode(value), [value]);
  const copy = async (): Promise<void> => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };
  const folding = useRef(false);
  const toggle = (): void => {
    folding.current = expanded;
    setExpanded(!expanded);
  };
  useLayoutEffect(() => {
    if (!folding.current) return;
    folding.current = false;
    const node = block.current;
    const view = node?.closest(".chat-view");
    if (node && view && node.getBoundingClientRect().top < view.getBoundingClientRect().top) node.scrollIntoView({ block: "start" });
  }, [expanded]);
  return (
    <div className={cn("markdown-code group/code relative w-full overflow-hidden rounded-md border border-border bg-surface-raised", BLOCK_GAP)} ref={block} data-language={language || undefined}>
      <Button variant="ghost" size="icon-xs" className="markdown-code-copy absolute top-1.5 right-1.5 text-muted-foreground opacity-0 transition-opacity duration-150 group-hover/code:opacity-100 focus-visible:opacity-100 pointer-coarse:size-8 pointer-coarse:opacity-100" onClick={() => void copy()} aria-label={t(copied ? "Code copied" : "Copy code")}>
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      </Button>
      <pre className="m-0 overflow-x-auto px-3 py-2.5 font-mono text-code whitespace-pre"><code>{fold !== null && !expanded ? fold.head : value}</code></pre>
      {fold !== null && (
        <button type="button" className="markdown-code-more flex min-h-7 w-full cursor-pointer items-center border-0 border-t border-border bg-transparent px-3 text-left font-mono text-tool text-muted-foreground transition-colors hover:bg-sidebar-accent/50 hover:text-foreground pointer-coarse:min-h-11" aria-expanded={expanded} onClick={toggle}>
          {expanded ? t("Show less") : t("Show all {n} lines", { n: fold.lines })}
        </button>
      )}
    </div>
  );
}

function Blocks({ blocks }: { blocks: MarkdownBlock[] }) {
  return <>{blocks.map((block, index): ReactNode => {
    const key = `${block.type}-${index}`;
    switch (block.type) {
      case "heading": {
        const Tag = `h${block.level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
        return <Tag key={key} className={cn("text-chat font-semibold", HEADING[block.level])}><Inline nodes={block.content} /></Tag>;
      }
      case "paragraph":
        return <p key={key} className={BLOCK_GAP}>{block.lines.map((line, lineIndex) => <span key={lineIndex}><Inline nodes={line} />{lineIndex < block.lines.length - 1 && <br />}</span>)}</p>;
      case "list": return <List key={key} block={block} />;
      case "blockquote": return <blockquote key={key} className={cn("mx-0 border-l-2 border-border pl-3 text-muted-foreground", BLOCK_GAP)}><Blocks blocks={block.blocks} /></blockquote>;
      case "code": return <CodeBlock key={key} language={block.language} value={block.value} />;
      case "math": return <MathExpression key={key} value={block.value} displayMode />;
      case "hr": return <hr key={key} className="my-4 border-0 border-t border-border" />;
      case "table": return (
        <div className={cn("markdown-table-wrap md-table-scroll w-full", BLOCK_GAP)} key={key}>
          <table className="w-max min-w-full border-collapse"><thead><tr>{block.header.map((cell, cellIndex) => <th key={cellIndex} className={cn(CELL, "bg-muted font-semibold")}><Inline nodes={cell} /></th>)}</tr></thead>
            <tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex} className={CELL}><Inline nodes={cell} /></td>)}</tr>)}</tbody>
          </table>
        </div>
      );
    }
  })}</>;
}

export function Markdown({ children, className }: { children: string; className?: string }) {
  const blocks = useMemo(() => parseMarkdown(children), [children]);
  return <div className={cn("markdown w-full text-chat wrap-anywhere [&>:first-child]:mt-0 [&>:last-child]:mb-0", className)}><Blocks blocks={blocks} /></div>;
}
