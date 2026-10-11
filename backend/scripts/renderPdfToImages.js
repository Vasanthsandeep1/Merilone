// One-off child process: rasterizes a PDF's pages to PNG files.
// Run in a fresh process (not required into the main server) so its
// pdf-to-img -> pdfjs-dist copy never shares a process with pdf-parse's own
// separately-pinned pdfjs-dist — the two conflict when loaded together (see
// documentTenderController.js's ocrPdf for the version-mismatch this avoids).
//
// Usage: node renderPdfToImages.js <pdfPath> <outDir> [maxPages] [startPage]
// Writes outDir/page-<N>.png (1-based, matching the real PDF page number)
// for pages in [startPage, startPage+maxPages-1], and prints the written
// paths to stdout. pdf-to-img's generator rasterizes sequentially with no
// cheap "jump to page N" — earlier pages are still generated internally,
// just not written to disk — fine for the page counts this feature deals
// with (a handful of pages per annexure, out of a <300 page tender).
const fs = require('fs');
const path = require('path');

async function main() {
  const [, , pdfPath, outDir, maxPagesArg, startPageArg] = process.argv;
  if (!pdfPath || !outDir) {
    console.error('Usage: node renderPdfToImages.js <pdfPath> <outDir> [maxPages] [startPage]');
    process.exit(1);
  }
  const maxPages = maxPagesArg ? parseInt(maxPagesArg, 10) : 15;
  const startPage = startPageArg ? parseInt(startPageArg, 10) : 1;
  const endPage = startPage + maxPages - 1;

  const { pdf } = await import('pdf-to-img');
  const document = await pdf(pdfPath, { scale: 2 });

  let pageNum = 0;
  const written = [];
  for await (const image of document) {
    pageNum++;
    if (pageNum > endPage) break;
    if (pageNum < startPage) continue;
    const imgPath = path.join(outDir, `page-${pageNum}.png`);
    fs.writeFileSync(imgPath, image);
    written.push(imgPath);
  }
  console.log(JSON.stringify({ pages: written }));
}

main().catch((err) => {
  console.error(err.message || String(err));
  process.exit(1);
});
