// Minimal, safe Markdown → DOM renderer (never uses innerHTML) + KaTeX math rendering.
import { h } from './ui.js';

function inline(text) {
  const frag = document.createDocumentFragment();
  // Keep LaTeX segments untouched so that "*" or "_" inside formulas are not treated as emphasis.
  const re = /(\$\$[^$]+\$\$|\$[^$\n]+\$|`[^`]+`|\*\*[^*]+\*\*|\*[^*\n]+\*|_[^_\n]+_)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    frag.append(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith('$')) frag.append(t);
    else if (t.startsWith('`')) frag.append(h('code', t.slice(1, -1)));
    else if (t.startsWith('**')) frag.append(h('strong', inline(t.slice(2, -2))));
    else frag.append(h('em', inline(t.slice(1, -1))));
    last = m.index + t.length;
  }
  frag.append(text.slice(last));
  return frag;
}

export function renderMarkdown(src) {
  const root = h('div.md');
  const lines = String(src || '').replace(/\r/g, '').split('\n');
  let list = null;
  let table = null;
  const closeBlocks = () => { list = null; table = null; };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const code = [];
      while (++i < lines.length && !/^```/.test(lines[i])) code.push(lines[i]);
      root.append(h('pre', h('code', code.join('\n'))));
      closeBlocks();
      continue;
    }
    if (/^\$\$\s*$/.test(line)) {
      const math = [];
      while (++i < lines.length && !/^\$\$\s*$/.test(lines[i])) math.push(lines[i]);
      root.append(h('div.math-block', `$$${math.join('\n')}$$`));
      closeBlocks();
      continue;
    }
    let m;
    if (!line.trim()) { closeBlocks(); continue; }
    if ((m = line.match(/^(#{1,4})\s+(.*)$/))) {
      root.append(h(`h${Math.min(m[1].length + 1, 5)}`, inline(m[2])));
      closeBlocks();
    } else if (/^\s*(---|\*\*\*)\s*$/.test(line)) {
      root.append(h('hr'));
      closeBlocks();
    } else if ((m = line.match(/^>\s?(.*)$/))) {
      root.append(h('blockquote', inline(m[1])));
      closeBlocks();
    } else if ((m = line.match(/^\s*([-*•]|\d+[.)])\s+(.*)$/))) {
      const ordered = /\d/.test(m[1]);
      if (!list || list.ordered !== ordered) {
        list = { el: h(ordered ? 'ol' : 'ul'), ordered };
        root.append(list.el);
      }
      list.el.append(h('li', inline(m[2])));
      table = null;
    } else if (/^\s*\|.*\|\s*$/.test(line)) {
      const cells = line.trim().slice(1, -1).split('|').map((c) => c.trim());
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
      if (!table) {
        table = h('table');
        root.append(h('div.table-wrap', table));
        table.append(h('tr', cells.map((c) => h('th', inline(c)))));
      } else {
        table.append(h('tr', cells.map((c) => h('td', inline(c)))));
      }
      list = null;
    } else {
      root.append(h('p', inline(line)));
      closeBlocks();
    }
  }
  renderMath(root);
  return root;
}

let katexReady = null;
/** Renders $…$ / $$…$$ formulas with KaTeX (loaded on first use). */
export function renderMath(el) {
  katexReady ||= (async () => {
    if (!document.querySelector('link[data-katex]')) {
      document.head.append(h('link', { rel: 'stylesheet', href: 'https://cdn.jsdelivr.net/npm/katex@0.18.7/dist/katex.min.css', 'data-katex': '' }));
    }
    return (await import('katex/auto-render')).default;
  })();
  katexReady.then((render) => render(el, {
    delimiters: [
      { left: '$$', right: '$$', display: true },
      { left: '$', right: '$', display: false },
      { left: '\\[', right: '\\]', display: true },
      { left: '\\(', right: '\\)', display: false },
    ],
    throwOnError: false,
    trust: false,
  })).catch(() => {});
}
