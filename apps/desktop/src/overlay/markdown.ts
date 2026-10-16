import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import yaml from 'highlight.js/lib/languages/yaml';

// Only languages that come up in interviews, to keep the overlay bundle small.
for (const [name, lang] of Object.entries({
  bash, c, cpp, csharp, go, java, javascript, json, kotlin, python, rust, sql, swift, typescript, yaml,
})) {
  hljs.registerLanguage(name, lang);
}

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const md = new MarkdownIt({
  html: false, // model output is untrusted: never render raw HTML
  linkify: true,
  breaks: false,
});

// Code blocks: language label + copy button header, highlighted body. The copy button is handled by
// event delegation in the overlay (data-copy-code), so the HTML stays static.
md.renderer.rules.fence = (tokens, idx) => {
  const token = tokens[idx];
  const lang = token.info.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  const known = lang && hljs.getLanguage(lang);
  const body = known ? hljs.highlight(token.content, { language: lang, ignoreIllegals: true }).value : escape(token.content);
  return (
    `<div class="pk-code"><div class="pk-code-head"><span>${escape(lang || 'code')}</span>` +
    `<button type="button" data-copy-code title="Copy code" aria-label="Copy code">` +
    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>` +
    `</button></div><pre><code class="hljs">${body}</code></pre></div>`
  );
};

// Links open in the system browser (handled by the overlay), never inside the overlay.
const defaultLinkOpen = md.renderer.rules.link_open ?? ((t, i, o, _e, self) => self.renderToken(t, i, o));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  tokens[idx].attrSet('target', '_blank');
  tokens[idx].attrSet('rel', 'noreferrer');
  return defaultLinkOpen(tokens, idx, options, env, self);
};

/**
 * Renders (possibly still-streaming) Markdown. An unterminated ``` fence is closed temporarily so a code
 * block renders as code while it streams instead of flashing as plain text.
 */
export function renderMarkdown(text: string, streaming: boolean): string {
  let src = text;
  if (streaming && (src.match(/^```/gm)?.length ?? 0) % 2 === 1) src += '\n```';
  return md.render(src);
}
