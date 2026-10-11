'use strict';
// Division letterheads for Letter Generate. Meril's two tender divisions send
// letters on different stationery — logo/heading, the signatory and stamp, the
// contact block and the page footer differ — so a letter is tagged with a
// division ('endo' | 'diagno') and the letterhead is applied when the letter is
// viewed, downloaded or emailed (the stored letter is just the body text).
// Assets and wording come from the old portal's letterhead-endo.docx /
// letterhead.docx (Frontend/public) and endo_letter_head.html.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '../asset/letterheads');
const file = (n) => path.join(DIR, n);

const OFFICE_LINES = [
  'Corporate Office: Survey No. 135/139, Bilakhia House, Muktanand Marg, Chala, Vapi - 396191',
  'Mumbai Sales Office: 601, Midas Tower, Sahar Plaza, Andheri (E) Mumbai 400 059, Maharashtra, India',
  'Cell: +91-8140065678',
  'Direct Line: +91-22-30732570, Desk: +91-22-30732400 Extn: 570',
];

const LETTERHEADS = {
  endo: {
    key: 'endo',
    label: 'Meril Endo Surgery',
    company: 'MERIL ENDO SURGERY PVT. LTD.',
    // The scribble image has no printed name — the signatory is typed under it.
    signatory: { name: 'G. Kiran Kumar', title: 'Additional General Manager – Govt. Business' },
    logo: file('endo-logo.png'), signature: file('endo-signature.png'), stamp: file('endo-stamp.png'), footerImage: file('endo-footer.png'),
    headingText: null, footerLines: null,
    email: 'tender@merillife.com',
  },
  diagno: {
    key: 'diagno',
    label: 'Meril Diagnostics',
    company: 'MERIL DIAGNOSTICS PVT. LTD.',
    // The signature image already carries the printed name and title (Shaiju Varghese, DGM – Tender Business).
    signatory: null,
    logo: file('diagno-logo.png'), signature: file('diagno-signature.png'), stamp: file('diagno-stamp.png'), footerImage: null,
    headingText: 'Diagnostics',
    footerLines: [
      'Meril Diagnostics Private Limited',
      'CIN No. U33110GJ2011PTC064994',
      'Regd. Office: Survey No.,135/139 Bilakhia House, Muktanand Marg, Chala, Vapi-396 191, Gujarat, India',
      'Mumbai Office: 601, Midas, Sahar Plaza, JB Nagar, Andheri East, Mumbai - 400059',
      'Tel: +91 260 2408000  Email: tender.merildiagno@merillife.com  website: www.merillife.com',
    ],
    tagline: 'Cardiovascular | Orthopedic | Diagnostics | Endo-Surgery | ENT',
    email: 'tender.merildiagno@merillife.com',
  },
};

const normDivision = (v) => {
  const s = String(v || '').toLowerCase();
  if (s.includes('diagno')) return 'diagno';
  if (s.includes('endo')) return 'endo';
  return null;
};

const uriCache = {};
const dataUri = (p) => {
  if (!p) return null;
  if (!uriCache[p]) uriCache[p] = `data:image/png;base64,${fs.readFileSync(p).toString('base64')}`;
  return uriCache[p];
};

const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const plain = (h) => String(h || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

// Everything after "Yours faithfully," that is just the old typed signature
// block (company / signatory / title / blank lines) is replaced by the division's
// own sign-off; anything else the user wrote is kept.
const CLOSING_RE = /yours\s+(faithfully|sincerely|truly)/i;
const SIGNBLOCK_RE = /(for\s+meril|pvt\.?\s*ltd|private\s+limited|general\s+manager|\bmanager\b|kiran|varghese|shaiju|govt\.?\s+business|tender\s+business|authori[sz]ed\s+signatory|thanking\s+you)/i;

function splitClosing(html) {
  const src = String(html || '');
  const paras = [...src.matchAll(/<p\b[^>]*>[\s\S]*?<\/p>|<table\b[\s\S]*?<\/table>/gi)];
  let idx = -1;
  paras.forEach((m, i) => { if (CLOSING_RE.test(plain(m[0]))) idx = i; });
  if (idx === -1) return { body: src, hasClosing: false, leftover: '' };
  const body = src.slice(0, paras[idx].index);
  const leftover = paras.slice(idx + 1).map((m) => m[0]).filter((h) => { const t = plain(h); return t && !SIGNBLOCK_RE.test(t); }).join('\n');
  return { body, hasClosing: true, leftover };
}

// The letter's own font (family + size) — the sign-off follows it, so a format
// written in Cambria 10pt keeps a Cambria 10pt closing block.
function bodyFont(html) {
  const fam = /font-family:\s*([^;"']+)/i.exec(String(html || ''));
  const size = /font-size:\s*([\d.]+)pt/i.exec(String(html || ''));
  return fam || size ? { family: fam ? fam[1].trim() : null, size: size ? parseFloat(size[1]) : null } : null;
}

const img = (p, width) => `<img src="${dataUri(p)}" width="${width}" alt="" />`;

function headerHtml(lh) {
  const parts = [`<p style="text-align:right;margin:0"><img src="${dataUri(lh.logo)}" width="${lh.key === 'endo' ? 120 : 110}" alt="Meril" /></p>`];
  if (lh.headingText) parts.push(`<p style="text-align:center;margin:0;color:#002060;font-size:10pt"><b>${esc(lh.headingText)}</b></p>`);
  return parts.join('');
}

function footerHtml(lh) {
  if (lh.footerImage) return `<p style="margin:0"><img src="${dataUri(lh.footerImage)}" width="100%" alt="${esc(lh.label)}" /></p>`;
  const lines = (lh.footerLines || []).map((l) => `<p style="text-align:center;margin:0;font-size:8pt">${esc(l)}</p>`).join('');
  return `${lines}${lh.tagline ? `<p style="text-align:center;margin:2pt 0 0;font-size:11pt;color:#FFC000"><b>${esc(lh.tagline)}</b></p>` : ''}`;
}

function signoffHtml(lh, hasEnclosure, font) {
  const f = font ? `${font.family ? `font-family: ${font.family}; ` : ''}${font.size ? `font-size: ${font.size}pt; ` : ''}` : '';
  const P = (extra = '') => ` style="${f}${extra}"`;
  const parts = [
    `<p${P()}>Yours faithfully,</p>`,
    `<p${P()}>For <b>${esc(lh.company)}</b></p>`,
    `<p style="margin:0">${img(lh.signature, lh.key === 'diagno' ? 150 : 110)}</p>`,
    `<p style="margin:0">${img(lh.stamp, 80)}</p>`,
  ];
  if (lh.signatory) parts.push(`<p${P()}><b>${esc(lh.signatory.name)}</b><br />${esc(lh.signatory.title)}</p>`);
  if (hasEnclosure) parts.push(`<p${P()}>Encls : As above</p>`);
  parts.push(`<p style="font-size:8pt;color:#444">${OFFICE_LINES.map(esc).join('<br />')}<br />E mail: ${esc(lh.email)}</p>`);
  return parts.join('');
}

/** Pieces of a letter with its division letterhead applied (all images inline as data URIs).
 * With no division the letter is returned untouched. */
function compose(html, division) {
  const lh = LETTERHEADS[normDivision(division)];
  if (!lh) return { division: null, header: '', body: String(html || ''), signoff: '', footer: '', leftover: '' };
  const { body, hasClosing, leftover } = splitClosing(html);
  const enclosure = /\bencl(osure|osed|s)?\b|enclos|annex/i.test(plain(html));
  return {
    division: lh.key,
    header: headerHtml(lh),
    body,
    signoff: hasClosing ? signoffHtml(lh, enclosure, bodyFont(html)) : '',
    footer: footerHtml(lh),
    leftover,
  };
}

/** The whole letter as one HTML document body + header/footer strings (Word export, email). */
function composeFull(html, division) {
  const c = compose(html, division);
  return { header: c.header, footer: c.footer, body: `${c.body}${c.signoff}${c.leftover}`, division: c.division };
}

/** Structured spec for the pdfkit renderer (file paths, not data URIs). */
function pdfSpec(html, division) {
  const lh = LETTERHEADS[normDivision(division)];
  const c = compose(html, division);
  if (!lh) return { body: c.body, letterhead: null };
  return {
    body: c.body,
    leftover: c.leftover,
    hasSignoff: !!c.signoff,
    font: bodyFont(html),
    letterhead: {
      key: lh.key, logo: lh.logo, headingText: lh.headingText, footerImage: lh.footerImage,
      footerLines: lh.footerLines, tagline: lh.tagline,
      signoff: c.signoff ? {
        company: lh.company, signature: lh.signature, stamp: lh.stamp, signatory: lh.signatory,
        enclosure: /\bencl(osure|osed|s)?\b|enclos|annex/i.test(plain(html)), office: OFFICE_LINES, email: lh.email,
      } : null,
    },
  };
}

const publicList = () => Object.values(LETTERHEADS).map((l) => ({ key: l.key, label: l.label }));

module.exports = { LETTERHEADS, normDivision, compose, composeFull, pdfSpec, splitClosing, publicList };
