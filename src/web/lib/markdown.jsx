/**
 * Small, safe Markdown renderer for minutes: headings, lists, bold, italics and paragraphs, built
 * as React elements (no HTML strings, so nothing a model writes can run in the page).
 */
import { Fragment } from "react";

function inline(text, key) {
  // **bold** and *italic* / _italic_; everything else is plain text.
  const parts = [];
  const re = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;
  let last = 0;
  let m;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const token = m[0];
    if (token.startsWith("**")) parts.push(<strong key={`${key}-${i++}`}>{token.slice(2, -2)}</strong>);
    else parts.push(<em key={`${key}-${i++}`}>{token.slice(1, -1)}</em>);
    last = m.index + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export function renderMarkdown(source) {
  const lines = String(source || "").replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let list = null; // { ordered, items }
  let para = [];
  const flushPara = () => {
    if (para.length) out.push(<p key={`p${out.length}`}>{inline(para.join(" "), `p${out.length}`)}</p>);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    out.push(
      <Tag key={`l${out.length}`} className={list.ordered ? "list-decimal" : "list-disc"}>
        {list.items.map((it, i) => (
          <li key={i} style={{ marginLeft: `${it.depth * 1.25}rem` }}>
            {inline(it.text, `l${out.length}-${i}`)}
          </li>
        ))}
      </Tag>,
    );
    list = null;
  };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    const bullet = /^(\s*)[-*•]\s+(.*)$/.exec(line);
    const numbered = /^(\s*)\d+[.)]\s+(.*)$/.exec(line);
    if (!line.trim()) {
      flushPara();
      flushList();
    } else if (heading) {
      flushPara();
      flushList();
      const level = heading[1].length;
      const Tag = level === 1 ? "h2" : level === 2 ? "h3" : "h4";
      out.push(<Tag key={`h${out.length}`}>{inline(heading[2], `h${out.length}`)}</Tag>);
    } else if (bullet || numbered) {
      flushPara();
      const m = bullet || numbered;
      const ordered = Boolean(numbered);
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push({ text: m[2], depth: Math.min(3, Math.floor(m[1].length / 2)) });
    } else if (/^[-*_]{3,}$/.test(line.trim())) {
      flushPara();
      flushList();
      out.push(<hr key={`r${out.length}`} />);
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();
  return <Fragment>{out}</Fragment>;
}

/** Plain text version (for .txt downloads and sharing to apps that do not read Markdown). */
export function markdownToText(source) {
  return String(source || "")
    .replace(/^#{1,4}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|\s)[*_]([^*_\s][^*_]*)[*_]/g, "$1$2")
    .replace(/^(\s*)[*•]\s+/gm, "$1- ");
}
