'use strict';
// Converts the company's "Letter Regarding Tenders.docx" into faithful HTML —
// one HTML string per letter — so a saved letter format is reused with its real
// layout: paragraph alignment, bold / italic / underline, font sizes and
// families, spacing, lists, tables, and tab-aligned lines (e.g. "Ref No. ……
// date" with the date at the right margin, which becomes a borderless two-cell
// table because HTML has no tab stops).
const fs = require('fs');
const JSZip = require('jszip');
const { DOMParser } = require('@xmldom/xmldom');

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const kids = (n, name) => Array.from(n.childNodes || []).filter((c) => c.nodeType === 1 && c.localName === name);
const kid = (n, name) => kids(n, name)[0] || null;
const attr = (n, name) => (n ? n.getAttributeNS(W, name) || n.getAttribute(`w:${name}`) || '' : '');
const on = (n) => n && attr(n, 'val') !== '0' && attr(n, 'val') !== 'false';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Runs of spaces would collapse in HTML — keep them as non-breaking spaces.
const spaces = (s) => esc(s).replace(/ {2,}/g, (m) => ' ' + '&nbsp;'.repeat(m.length - 1)).replace(/^ /, '&nbsp;');

const THEME_FONT = { majorHAnsi: 'Cambria', majorAscii: 'Cambria', minorHAnsi: 'Calibri', minorAscii: 'Calibri' };
const DEFAULT_FONT = 'Calibri';
const DEFAULT_PT = 11;

function runStyle(rPr) {
  const st = { bold: false, italic: false, underline: false, strike: false, font: null, size: null, color: null };
  if (!rPr) return st;
  st.bold = on(kid(rPr, 'b'));
  st.italic = on(kid(rPr, 'i'));
  const u = kid(rPr, 'u'); st.underline = !!u && attr(u, 'val') !== 'none';
  st.strike = on(kid(rPr, 'strike'));
  const f = kid(rPr, 'rFonts');
  if (f) {
    const face = attr(f, 'ascii') || THEME_FONT[attr(f, 'asciiTheme')] || null;
    if (face && face !== DEFAULT_FONT) st.font = face;
  }
  const sz = kid(rPr, 'sz');
  if (sz) { const pt = parseInt(attr(sz, 'val'), 10) / 2; if (pt && pt !== DEFAULT_PT) st.size = pt; }
  const c = kid(rPr, 'color');
  if (c && /^[0-9a-f]{6}$/i.test(attr(c, 'val'))) st.color = `#${attr(c, 'val')}`;
  return st;
}
const sameStyle = (a, b) => ['bold', 'italic', 'underline', 'strike', 'font', 'size', 'color'].every((k) => a[k] === b[k]);

function wrap(text, st) {
  let h = spaces(text);
  const css = [];
  if (st.font) css.push(`font-family: ${st.font}`);
  if (st.size) css.push(`font-size: ${st.size}pt`);
  if (st.color && st.color !== '#000000') css.push(`color: ${st.color}`);
  if (css.length) h = `<span style="${css.join('; ')}">${h}</span>`;
  if (st.strike) h = `<s>${h}</s>`;
  if (st.underline) h = `<u>${h}</u>`;
  if (st.italic) h = `<em>${h}</em>`;
  if (st.bold) h = `<strong>${h}</strong>`;
  return h;
}

// A paragraph's runs as tokens: { text, st } | { tab: true } | { br: true }
function tokensOf(p) {
  const out = [];
  const pmark = runStyle(kid(kid(p, 'pPr') || p, 'rPr'));
  const push = (t) => out.push(t);
  const walk = (node) => {
    for (const r of Array.from(node.childNodes || [])) {
      if (r.nodeType !== 1) continue;
      if (r.localName === 'r') {
        const st = runStyle(kid(r, 'rPr'));
        for (const c of Array.from(r.childNodes)) {
          if (c.nodeType !== 1) continue;
          if (c.localName === 't') push({ text: c.textContent, st });
          else if (c.localName === 'tab') push({ tab: true });
          else if (c.localName === 'br' || c.localName === 'cr') push({ br: true });
        }
      } else if (r.localName === 'hyperlink' || r.localName === 'smartTag' || r.localName === 'ins') walk(r);
    }
  };
  walk(p);
  return { tokens: out, pmark };
}

function inlineHtml(tokens) {
  const merged = [];
  for (const t of tokens) {
    const last = merged[merged.length - 1];
    if (t.text !== undefined && last && last.text !== undefined && sameStyle(last.st, t.st)) last.text += t.text;
    else merged.push({ ...t });
  }
  return merged.map((t) => (t.br ? '<br>' : t.tab ? '&nbsp;&nbsp;&nbsp;&nbsp;' : wrap(t.text, t.st))).join('');
}
const plainOf = (tokens) => tokens.map((t) => (t.br ? '\n' : t.tab ? '\t' : t.text)).join('');

function paraProps(p, ctx) {
  const pPr = kid(p, 'pPr');
  const info = { align: 'left', indentPx: 0, after: null, list: null };
  if (!pPr) return info;
  const jc = attr(kid(pPr, 'jc'), 'val');
  info.align = jc === 'center' ? 'center' : jc === 'right' ? 'right' : jc === 'both' ? 'justify' : 'left';
  const ind = kid(pPr, 'ind');
  if (ind) { const left = parseInt(attr(ind, 'left') || attr(ind, 'start') || '0', 10) || 0; info.indentPx = Math.round((left / 20) * (96 / 72)); }
  const sp = kid(pPr, 'spacing');
  const style = attr(kid(pPr, 'pStyle'), 'val');
  if (sp && attr(sp, 'after') !== '') info.after = parseInt(attr(sp, 'after'), 10) / 20;
  else if (style === 'NoSpacing') info.after = 0;
  const numPr = kid(pPr, 'numPr');
  if (numPr) {
    const numId = attr(kid(numPr, 'numId'), 'val');
    const lvl = attr(kid(numPr, 'ilvl'), 'val') || '0';
    if (numId && numId !== '0') info.list = { ordered: ctx.numFmt(numId, lvl) !== 'bullet', level: parseInt(lvl, 10) || 0 };
  }
  return info;
}

const pStyle = (info) => {
  const css = [];
  if (info.align !== 'left') css.push(`text-align: ${info.align}`);
  if (info.indentPx) css.push(`margin-left: ${info.indentPx}px`);
  if (info.after !== null && info.after !== 10) css.push(`margin-bottom: ${info.after}pt`);
  return css.length ? ` style="${css.join('; ')}"` : '';
};

// One <w:p> -> { text, html }. Tab-aligned lines become borderless multi-cell tables.
function convertParagraph(p, ctx, { allowTabTable = true } = {}) {
  const { tokens } = tokensOf(p);
  const info = paraProps(p, ctx);
  const text = plainOf(tokens);
  const hasText = /\S/.test(text.replace(/\t/g, ''));

  if (allowTabTable && !info.list && tokens.some((t) => t.tab)) {
    // split on tab groups
    const segs = [[]];
    for (const t of tokens) {
      if (t.tab) { if (segs[segs.length - 1].length) segs.push([]); continue; }
      if (t.text !== undefined && !/\S/.test(t.text) && !segs[segs.length - 1].length) continue; // spaces right after a tab
      segs[segs.length - 1].push(t);
    }
    const parts = segs.filter((s) => s.some((t) => t.text && /\S/.test(t.text)));
    // trim trailing padding spaces on each segment
    parts.forEach((seg) => { for (let i = seg.length - 1; i >= 0; i--) { if (seg[i].text !== undefined) { seg[i] = { ...seg[i], text: seg[i].text.replace(/\s+$/, '') }; break; } } });
    const leadingTab = tokens.findIndex((t) => t.tab) < tokens.findIndex((t) => t.text && /\S/.test(t.text));
    if (parts.length >= 2 && !leadingTab) {
      const cells = parts.map((seg, i) => {
        const al = i === 0 ? 'left' : i === parts.length - 1 ? 'right' : 'center';
        return `<td><p style="text-align: ${al}; margin-bottom: 0pt">${inlineHtml(seg)}</p></td>`;
      }).join('');
      return { text, html: `<table data-borderless="true"><tbody><tr>${cells}</tr></tbody></table>` };
    }
  }
  const html = hasText ? inlineHtml(tokens) : '';
  return { text, html: `<p${pStyle(info)}>${html}</p>`, list: info.list, inner: html, info };
}

function convertTable(tbl, ctx) {
  const rows = kids(tbl, 'tr').map((tr) => {
    const cells = kids(tr, 'tc').map((tc) => {
      const gs = kid(kid(tc, 'tcPr') || tc, 'gridSpan');
      const span = gs ? parseInt(attr(gs, 'val'), 10) : 1;
      const vm = kid(kid(tc, 'tcPr') || tc, 'vMerge');
      const isCont = !!vm && attr(vm, 'val') !== 'restart';
      const paras = kids(tc, 'p').map((p) => convertParagraph(p, ctx, { allowTabTable: false }));
      const inner = paras.map((x) => x.html).join('') || '<p></p>';
      return { html: `<td${span > 1 ? ` colspan="${span}"` : ''}>${isCont ? '<p></p>' : inner}</td>`, text: paras.map((x) => x.text).join(' ') };
    });
    return { html: `<tr>${cells.map((c) => c.html).join('')}</tr>`, text: cells.map((c) => c.text).join('\t') };
  });
  return { text: rows.map((r) => r.text).join('\n'), html: `<table><tbody>${rows.map((r) => r.html).join('')}</tbody></table>` };
}

async function letterHtmlBlocks(docxPath) {
  const zip = await JSZip.loadAsync(fs.readFileSync(docxPath));
  const parse = (xml) => new DOMParser().parseFromString(xml, 'text/xml');
  const doc = parse(await zip.file('word/document.xml').async('string'));
  const numXml = zip.file('word/numbering.xml') ? parse(await zip.file('word/numbering.xml').async('string')) : null;

  const numFmt = (numId, lvl) => {
    if (!numXml) return 'decimal';
    const num = Array.from(numXml.getElementsByTagNameNS(W, 'num')).find((n) => attr(n, 'numId') === numId);
    const absId = num && attr(kid(num, 'abstractNumId'), 'val');
    const abs = Array.from(numXml.getElementsByTagNameNS(W, 'abstractNum')).find((a) => attr(a, 'abstractNumId') === absId);
    const level = abs && kids(abs, 'lvl').find((l) => attr(l, 'ilvl') === lvl);
    return level ? attr(kid(level, 'numFmt'), 'val') : 'decimal';
  };
  const ctx = { numFmt };

  const body = doc.getElementsByTagNameNS(W, 'body')[0];
  const items = [];
  for (const n of Array.from(body.childNodes)) {
    if (n.nodeType !== 1) continue;
    if (n.localName === 'p') items.push(convertParagraph(n, ctx));
    else if (n.localName === 'tbl') items.push({ ...convertTable(n, ctx), isTable: true });
  }

  // group list paragraphs into <ul>/<ol>
  const grouped = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.list) {
      const ordered = it.list.ordered;
      let lis = '';
      let text = '';
      while (i < items.length && items[i].list && items[i].list.ordered === ordered) {
        lis += `<li><p>${items[i].inner}</p></li>`; text += items[i].text + '\n'; i++;
      }
      i--;
      grouped.push({ text, html: `<${ordered ? 'ol' : 'ul'}>${lis}</${ordered ? 'ol' : 'ul'}>` });
    } else grouped.push(it);
  }

  // split into letters at each "Ref No.: MEPL…" line
  const START = /Ref\.?\s*No\.?\s*:\s*MEPL/i;
  const letters = [];
  let cur = null;
  for (const it of grouped) {
    if (START.test(it.text) && !it.isTable) { cur = []; letters.push(cur); }
    if (cur) cur.push(it);
  }

  // Word's "no spacing" runs of lines become one paragraph with <br> so the
  // editor (which spaces every paragraph) keeps the tight address / signature blocks.
  return letters.map((items2) => {
    const html = [];
    let tight = null;
    const flush = () => { if (tight) { html.push(`<p${tight.style}>${tight.parts.join('<br>')}</p>`); tight = null; } };
    for (const it of items2) {
      const m = /^<p( style="([^"]*)")?>([\s\S]*)<\/p>$/.exec(it.html);
      const isTightPara = m && /margin-bottom: 0pt/.test(m[2] || '') && m[3] && !it.isTable;
      if (isTightPara) {
        const style = (m[2] || '').replace(/;?\s*margin-bottom: 0pt/, '').replace(/^;\s*/, '');
        const styleAttr = style ? ` style="${style}"` : '';
        if (tight && tight.style === styleAttr) tight.parts.push(m[3]);
        else { flush(); tight = { style: styleAttr, parts: [m[3]] }; }
      } else { flush(); html.push(it.html); }
    }
    flush();
    // drop leading/trailing empty paragraphs
    return html.join('\n').replace(/(<p><\/p>\s*)+$/g, '').replace(/^(<p><\/p>\s*)+/g, '');
  });
}

module.exports = { letterHtmlBlocks };
