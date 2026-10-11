'use strict';
// Renders a letter's HTML (the rich text the letter editor produces) to an A4 PDF with pdfkit, so no headless browser is
// needed on the server. Built-in PDF fonts have no rupee glyph, so ₹ is
// written as "Rs.".
const PDFDocument = require('pdfkit');
const { pdfSpec } = require('./letterheads');

const { renderBody, toLatin1 } = require('./letterHtmlPdf');

// Optional `division` ('endo' | 'diagno') applies that division's letterhead:
// logo (+ heading) at the top of every page, the footer at the bottom of every
// page, and — when the letter has a "Yours faithfully" closing — the division's
// signature, stamp, signatory and contact block after the body.
function renderPdf(html, title, division) {
  const spec = pdfSpec(html, division);
  const lh = spec.letterhead;
  return new Promise((resolve, reject) => {
    const PAGE_W = 595.28;
    const footerImgH = lh && lh.footerImage ? PAGE_W * (201 / 941) : 0;
    const footerTextH = lh && lh.footerLines ? 12 * lh.footerLines.length + 22 : 0;
    const footerH = footerImgH || footerTextH;
    const headerH = lh ? (lh.headingText ? 84 : 72) : 0;
    const margins = { top: 60 + headerH * (lh ? 0.9 : 0), bottom: 60 + (lh ? footerH * 0.95 : 0), left: 64, right: 64 };

    const doc = new PDFDocument({ size: 'A4', margins, info: { Title: title || 'Letter' } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const drawFrame = () => {
      if (!lh) return;
      const saved = { x: doc.x, y: doc.y };
      const bm = doc.page.margins.bottom;
      doc.page.margins.bottom = 0; // footer sits inside the bottom margin — must not trigger a page break
      try {
        const logoW = lh.key === 'endo' ? 100 : 96;
        doc.image(lh.logo, PAGE_W - 64 - logoW, 26, { width: logoW });
        if (lh.headingText) doc.font('Helvetica-Bold').fontSize(10).fillColor('#002060').text(lh.headingText, 64, 26 + logoW * 0.46 + 4, { width: PAGE_W - 128, align: 'center', lineBreak: false });
        if (lh.footerImage) {
          doc.image(lh.footerImage, 0, doc.page.height - footerImgH, { width: PAGE_W });
        } else if (lh.footerLines) {
          let y = doc.page.height - footerTextH - 8;
          doc.font('Helvetica').fontSize(7.5).fillColor('#222');
          for (const line of lh.footerLines) { doc.text(toLatin1(line), 40, y, { width: PAGE_W - 80, align: 'center', lineBreak: false }); y += 10.5; }
          if (lh.tagline) doc.font('Helvetica-Bold').fontSize(10).fillColor('#FFC000').text(lh.tagline, 40, y + 4, { width: PAGE_W - 80, align: 'center', lineBreak: false });
        }
      } finally {
        doc.page.margins.bottom = bm;
        doc.fillColor('#000');
        doc.x = saved.x; doc.y = saved.y;
      }
    };
    drawFrame();
    doc.on('pageAdded', () => { drawFrame(); doc.x = doc.page.margins.left; doc.y = doc.page.margins.top; });

    const width = PAGE_W - margins.left - margins.right;
    const FS = 11;
    const limit = () => doc.page.height - doc.page.margins.bottom;
    const bodyCtx = { doc, width, left: margins.left, limit, fs: FS };

    renderBody(spec.body, bodyCtx);

    // Division sign-off: closing, company, signature + stamp, signatory, enclosure, contact block.
    const so = lh && lh.signoff;
    if (so) {
      const serif = spec.font && /cambria|times|georgia|serif/i.test(spec.font.family || '') && !/sans/i.test(spec.font.family || '');
      const SF = (spec.font && spec.font.size) || FS;
      const reg = serif ? 'Times-Roman' : 'Helvetica';
      const bold = serif ? 'Times-Bold' : 'Helvetica-Bold';
      const sigW = lh.key === 'diagno' ? 150 : 110;
      const sigH = sigW * (lh.key === 'diagno' ? 211 / 433 : 93 / 273);
      const need = 24 + 20 + sigH + 6 + 62 + (so.signatory ? 34 : 0) + (so.enclosure ? 18 : 0) + 56;
      if (doc.y + need > limit()) doc.addPage();
      doc.x = doc.page.margins.left;
      doc.font(reg).fontSize(SF).fillColor('#000').text('Yours faithfully,', { width });
      doc.moveDown(0.5);
      doc.font(reg).fontSize(SF).text('For ', { width, continued: true }).font(bold).text(so.company);
      doc.moveDown(0.3);
      let y = doc.y;
      doc.image(so.signature, doc.page.margins.left, y, { width: sigW });
      y += sigH + 4;
      doc.image(so.stamp, doc.page.margins.left, y, { width: 60 });
      y += 62;
      doc.x = doc.page.margins.left; doc.y = y;
      if (so.signatory) {
        doc.font(bold).fontSize(SF).text(toLatin1(so.signatory.name), { width });
        doc.font(reg).text(toLatin1(so.signatory.title), { width });
        doc.moveDown(0.6);
      }
      if (so.enclosure) { doc.font(reg).fontSize(SF).text('Encls : As above', { width }); doc.moveDown(0.6); }
      doc.font('Helvetica').fontSize(7.5).fillColor('#444');
      for (const line of so.office) doc.text(toLatin1(line), { width });
      doc.text(`E mail: ${so.email}`, { width });
    }
    if (spec.leftover) { doc.moveDown(0.6); renderBody(spec.leftover, bodyCtx); }
    doc.end();
  });
}

module.exports = { renderPdf };
