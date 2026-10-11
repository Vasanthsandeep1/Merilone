'use strict';
// Draws a letter body (the rich HTML the letter editor produces) onto a pdfkit
// document: paragraphs and headings with alignment, indent and line spacing;
// bold / italic / underline / strike, font family (mapped to the built-in PDF
// families), size and colour; bullet and numbered lists; horizontal rules;
// links; and tables (borders, header cells, cell alignment).

const ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };
const toLatin1 = (s) => s
  .replace(/₹/g, 'Rs.').replace(/[‘’‛]/g, "'").replace(/[“”]/g, '"')
  .replace(/[–—−]/g, '-').replace(/…/g, '...').replace(/[•●▪]/g, '•')
  .replace(/[  -​ 　]/g, ' ').replace(/[^\n\x20-\x7E¡-ÿ•]/g, '');
const decode = (s) => toLatin1(s.replace(/&(nbsp|amp|lt|gt|quot|apos|#39);/g, (m, k) => ENTITIES[k]));

const VOID = new Set(['br', 'hr', 'img', 'col']);

function parseStyle(str) {
  const out = {};
  String(str || '').split(';').forEach((d) => {
    const i = d.indexOf(':');
    if (i > 0) out[d.slice(0, i).trim().toLowerCase()] = d.slice(i + 1).trim();
  });
  return out;
}

// Minimal HTML -> tree ({ tag, style, attrs, children } | { text }); enough for editor output.
function parse(html) {
  const root = { tag: 'root', style: {}, attrs: {}, children: [] };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*?)(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(String(html || '')))) {
    const top = stack[stack.length - 1];
    if (m[5] !== undefined) { top.children.push({ text: m[5] }); continue; }
    if (!m[2]) continue;
    const tag = m[2].toLowerCase();
    if (m[1]) {
      for (let i = stack.length - 1; i > 0; i--) if (stack[i].tag === tag) { stack.length = i; break; }
      continue;
    }
    const attrs = {};
    for (const a of m[3].matchAll(/([a-zA-Z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1].toLowerCase()] = a[2] ?? a[3];
    const node = { tag, attrs, style: parseStyle(attrs.style), children: [] };
    top.children.push(node);
    if (!VOID.has(tag) && !m[4]) stack.push(node);
  }
  return root;
}

const pxToPt = (v) => {
  const n = parseFloat(v);
  if (Number.isNaN(n)) return null;
  return /px/i.test(v) ? n * 0.75 : n; // pt (or bare number) as is
};

function family(css) {
  const f = String(css || '').toLowerCase();
  if (/courier|mono|consolas/.test(f)) return 'Courier';
  if (/times|georgia|cambria|serif|garamond|palatino/.test(f) && !/sans/.test(f)) return 'Times';
  return 'Helvetica';
}
const face = (fam, bold, italic) => {
  if (fam === 'Times') return bold && italic ? 'Times-BoldItalic' : bold ? 'Times-Bold' : italic ? 'Times-Italic' : 'Times-Roman';
  if (fam === 'Courier') return bold && italic ? 'Courier-BoldOblique' : bold ? 'Courier-Bold' : italic ? 'Courier-Oblique' : 'Courier';
  return bold && italic ? 'Helvetica-BoldOblique' : bold ? 'Helvetica-Bold' : italic ? 'Helvetica-Oblique' : 'Helvetica';
};

const HEADING_PT = { h1: 18, h2: 14, h3: 12, h4: 11, h5: 10, h6: 10 };

// Flatten inline nodes into styled text runs.
function runsOf(nodes, base) {
  const runs = [];
  const walk = (list, st) => {
    for (const n of list) {
      if (n.text !== undefined) {
        const t = decode(n.text.replace(/\s*\n\s*/g, ' '));
        if (t) runs.push({ text: t, ...st });
        continue;
      }
      const s = { ...st };
      const css = n.style;
      if (n.tag === 'br') { runs.push({ text: '\n', ...st }); continue; }
      if (n.tag === 'strong' || n.tag === 'b') s.bold = true;
      if (n.tag === 'em' || n.tag === 'i') s.italic = true;
      if (n.tag === 'u') s.underline = true;
      if (n.tag === 's' || n.tag === 'strike' || n.tag === 'del') s.strike = true;
      if (n.tag === 'sub') s.size = (s.size || 11) * 0.75;
      if (n.tag === 'sup') s.size = (s.size || 11) * 0.75;
      if (n.tag === 'a') { s.underline = true; s.color = '#1d4ed8'; s.link = n.attrs.href; }
      if (css['font-weight'] && /bold|[6-9]00/.test(css['font-weight'])) s.bold = true;
      if (css['font-style'] === 'italic') s.italic = true;
      if (css['text-decoration'] && /underline/.test(css['text-decoration'])) s.underline = true;
      if (css['text-decoration'] && /line-through/.test(css['text-decoration'])) s.strike = true;
      if (css['font-family']) s.family = family(css['font-family']);
      if (css['font-size']) { const pt = pxToPt(css['font-size']); if (pt) s.size = pt; }
      if (/^#[0-9a-f]{3,8}$/i.test(css.color || '')) s.color = css.color;
      walk(n.children, s);
    }
  };
  walk(nodes, base);
  // drop leading/trailing whitespace of the block
  if (runs.length) { runs[0].text = runs[0].text.replace(/^\s+/, ''); runs[runs.length - 1].text = runs[runs.length - 1].text.replace(/\s+$/, ''); }
  return runs.filter((r) => r.text !== '');
}

const plainText = (nodes) => nodes.map((n) => (n.text !== undefined ? decode(n.text) : n.tag === 'br' ? '\n' : plainText(n.children))).join('');

/**
 * Render a letter body. `ctx` = { doc, width, left, limit(), fs } — `limit()` is the
 * page's usable bottom, used to break long tables across pages.
 */
function renderBody(html, ctx) {
  const { doc, width, left, limit } = ctx;
  const FS = ctx.fs || 11;

  // Word-wrap styled runs ourselves and draw each word with its own font/size/colour,
  // so left / centre / right / justify alignment and mixed formatting all work.
  const writeRuns = (runs, { x, w, align, lineGap, dry }) => {
    if (!runs.length) return dry ? 0 : false;
    const fontOf = (r) => face(r.family || 'Helvetica', r.bold, r.italic);
    const sizeOf = (r) => r.size || FS;

    const toks = [];
    for (const r of runs) {
      if (r.text === '\n') { toks.push({ br: true, r }); continue; }
      for (const part of r.text.split(/(\s+)/)) {
        if (!part) continue;
        const space = /^\s+$/.test(part);
        doc.font(fontOf(r)).fontSize(sizeOf(r));
        toks.push({ text: space ? ' ' : part, r, space, w: doc.widthOfString(space ? ' ' : part) });
      }
    }

    const lines = [];
    let cur = { items: [], w: 0, hard: false };
    const pushLine = (hard) => {
      while (cur.items.length && cur.items[cur.items.length - 1].space) { cur.w -= cur.items.pop().w; }
      cur.hard = hard;
      lines.push(cur);
      cur = { items: [], w: 0, hard: false };
    };
    for (const t of toks) {
      if (t.br) { pushLine(true); continue; }
      if (t.space && !cur.items.length) continue;
      if (!t.space && cur.items.length && cur.w + t.w > w) pushLine(false);
      cur.items.push(t); cur.w += t.w;
    }
    pushLine(true);

    if (dry) return lines.reduce((h, ln) => h + Math.max(FS, ...ln.items.map((t) => sizeOf(t.r))) * 1.2 + lineGap, 0);

    lines.forEach((ln, li) => {
      const maxSize = Math.max(FS, ...ln.items.map((t) => sizeOf(t.r)));
      const lineH = maxSize * 1.2 + lineGap;
      if (doc.y + lineH > limit()) doc.addPage();
      const y = doc.y;
      const gaps = ln.items.filter((t) => t.space).length;
      const justify = align === 'justify' && !ln.hard && li < lines.length - 1 && gaps > 0;
      const extra = justify ? (w - ln.w) / gaps : 0;
      const lineW = ln.w + extra * gaps;
      let cx = align === 'center' ? x + (w - lineW) / 2 : align === 'right' ? x + (w - lineW) : x;
      for (const t of ln.items) {
        const r = t.r;
        const adv = t.w + (t.space ? extra : 0);
        if (!t.space) {
          doc.font(fontOf(r)).fontSize(sizeOf(r)).fillColor(r.color || '#000');
          const ty = y + (maxSize - sizeOf(r)) * 0.85;
          doc.text(t.text, cx, ty, { lineBreak: false });
          // underline / strike / link are drawn by hand (pdfkit's need a wrapped-text width)
          const sz = sizeOf(r);
          if (r.underline && !t.space) doc.save().lineWidth(Math.max(0.5, sz / 20)).strokeColor(r.color || '#000').moveTo(cx, ty + sz * 1.02).lineTo(cx + t.w, ty + sz * 1.02).stroke().restore();
          if (r.strike && !t.space) doc.save().lineWidth(Math.max(0.5, sz / 20)).strokeColor(r.color || '#000').moveTo(cx, ty + sz * 0.55).lineTo(cx + t.w, ty + sz * 0.55).stroke().restore();
          if (r.link && !t.space) doc.link(cx, ty, t.w, sz * 1.1, r.link);
        }
        cx += adv;
      }
      doc.x = left;
      doc.y = y + lineH;
    });
    doc.fillColor('#000');
    return true;
  };

  const blockOpts = (node, extraIndent = 0) => {
    const align = ['left', 'center', 'right', 'justify'].includes(node.style['text-align']) ? node.style['text-align'] : (['left', 'center', 'right', 'justify'].includes(node.attrs.align) ? node.attrs.align : 'left');
    const indentPt = (pxToPt(node.style['margin-left'] || '0') || 0) + extraIndent;
    const lh = parseFloat(node.style['line-height']);
    return { align, x: left + indentPt, w: width - indentPt, lineGap: Number.isFinite(lh) && lh > 1 ? (lh - 1) * FS * 1.1 : 2 };
  };

  // Word "space after" (margin-bottom, pt) — falls back to a normal paragraph gap.
  const gapAfter = (node, def = 8) => {
    const v = node && node.style ? node.style['margin-bottom'] : undefined;
    const n = v !== undefined ? pxToPt(v) : null;
    return n === null || n === undefined ? def : n;
  };

  const table = (node) => {
    const rows = [];
    const collect = (n) => n.children.forEach((c) => {
      if (c.tag === 'tr') rows.push(c.children.filter((x) => x.tag === 'td' || x.tag === 'th'));
      else if (c.children) collect(c);
    });
    collect(node);
    if (!rows.length) return;
    const cols = Math.max(1, ...rows.map((r) => r.reduce((a, c) => a + (parseInt(c.attrs.colspan, 10) || 1), 0)));
    const colW = width / cols;
    const borderless = node.attrs['data-borderless'] === 'true';
    const padX = borderless ? 0 : 5;
    const padY = borderless ? 0 : 4;
    if (!borderless) doc.moveDown(0.3);
    for (const row of rows) {
      let idx = 0;
      const cells = row.map((c) => {
        const span = parseInt(c.attrs.colspan, 10) || 1;
        const head = c.tag === 'th';
        const paras = c.children.filter((x) => x.tag === 'p' || /^h[1-6]$/.test(x.tag));
        const blocks = (paras.length ? paras : [{ tag: 'p', style: c.style, attrs: c.attrs, children: c.children }]).map((pp) => {
          const opts = blockOpts(pp);
          return { runs: runsOf(pp.children, head ? { bold: true } : {}), align: opts.align === 'left' && ['center', 'right'].includes(c.style['text-align']) ? c.style['text-align'] : opts.align, gap: gapAfter(pp, 2) };
        });
        const cell = { x: left + idx * colW, w: colW * span, blocks };
        idx += span;
        return cell;
      });
      const heightOf = (cell) => cell.blocks.reduce((h, b) => h + (b.runs.length ? writeRuns(b.runs, { x: 0, w: cell.w - padX * 2, align: b.align, lineGap: 2, dry: true }) : FS * 1.2) + b.gap, 0);
      const h = Math.max(borderless ? 0 : 18, ...cells.map((cell) => heightOf(cell) + padY * 2));
      if (doc.y + h > limit()) doc.addPage();
      const y = doc.y;
      for (const cell of cells) {
        if (!borderless) doc.rect(cell.x, y, cell.w, h).strokeColor('#9ca3af').lineWidth(0.6).stroke();
        doc.y = y + padY;
        for (const b of cell.blocks) {
          if (b.runs.length) writeRuns(b.runs, { x: cell.x + padX, w: cell.w - padX * 2, align: b.align, lineGap: 2 });
          else doc.y += FS * 1.2;
          doc.y += b.gap;
        }
      }
      doc.x = left; doc.y = y + h;
    }
    doc.fillColor('#000');
    doc.y += borderless ? 6 : 8;
  };

  const list = (node, ordered, depth) => {
    let n = 0;
    for (const li of node.children.filter((c) => c.tag === 'li')) {
      n += 1;
      const inline = li.children.filter((c) => c.text !== undefined || !['ul', 'ol'].includes(c.tag));
      // <li><p>text</p></li> — use the paragraph's children so its alignment/styles apply
      const flat = inline.flatMap((c) => (c.tag === 'p' ? c.children : [c]));
      const runs = runsOf(flat, {});
      const opts = blockOpts(li, 18 + depth * 18);
      const marker = ordered ? `${n}.` : '•';
      if (doc.y + 16 > limit()) doc.addPage();
      const y = doc.y;
      doc.font('Helvetica').fontSize(FS).fillColor('#000').text(marker, opts.x - 14, y, { width: 14, align: 'right', lineBreak: false });
      doc.y = y;
      writeRuns(runs.length ? runs : [{ text: ' ' }], opts);
      doc.moveDown(0.25);
      for (const sub of li.children.filter((c) => c.tag === 'ul' || c.tag === 'ol')) list(sub, sub.tag === 'ol', depth + 1);
    }
    if (depth === 0) doc.moveDown(0.5);
  };

  const block = (node) => {
    if (node.text !== undefined) {
      const runs = runsOf([node], {});
      if (runs.length) { writeRuns(runs, { x: left, w: width, align: 'left', lineGap: 2 }); doc.moveDown(0.7); }
      return;
    }
    switch (node.tag) {
      case 'table': table(node); return;
      case 'ul': list(node, false, 0); return;
      case 'ol': list(node, true, 0); return;
      case 'hr':
        doc.moveDown(0.3);
        doc.moveTo(left, doc.y).lineTo(left + width, doc.y).strokeColor('#9ca3af').lineWidth(0.7).stroke();
        doc.moveDown(0.6);
        return;
      case 'p': case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': case 'blockquote': {
        const isH = /^h[1-6]$/.test(node.tag);
        const runs = runsOf(node.children, isH ? { bold: true, size: HEADING_PT[node.tag] } : {});
        if (!runs.length) { doc.y += FS * 1.2 + gapAfter(node); return; } // an empty paragraph is a blank line, like in Word
        writeRuns(runs, blockOpts(node, node.tag === 'blockquote' ? 24 : 0));
        doc.y += gapAfter(node, isH ? 6 : 8);
        return;
      }
      default: {
        // div / span / body wrappers: block-level children are rendered in turn; loose inline content becomes a paragraph
        const hasBlocks = node.children.some((c) => c.tag && ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'table', 'hr', 'div', 'blockquote'].includes(c.tag));
        if (hasBlocks) { node.children.forEach(block); return; }
        const runs = runsOf(node.children, {});
        if (runs.length) { writeRuns(runs, blockOpts(node)); doc.moveDown(0.7); }
      }
    }
  };

  parse(html).children.forEach(block);
}

module.exports = { renderBody, toLatin1 };
