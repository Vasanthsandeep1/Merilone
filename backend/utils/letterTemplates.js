'use strict';
// Parses the client's own "Letter Regarding Tenders.docx" — a set of real
// letters they already send out, covering ~7 recurring situations (EMD
// shortfall, RC validity extension, sample-date revision, etc.) — into
// individual reference templates, and matches a chat request like "create a
// letter for Extension of Validity of Rate Contract" to the closest one by
// keyword overlap against each template's own Subject line.
const path = require('path');
const mammoth = require('mammoth');
const { letterHtmlBlocks } = require('./letterDocx');

const DOCX_PATH = path.join(__dirname, '../asset/letter-templates/Letter Regarding Tenders.docx');

let cachedTemplates = null;

/** Splits the raw extracted text on each "Ref No./Ref. No.:" line — every
 * letter in the source file starts with one — into individual templates. */
async function loadTemplates() {
  if (cachedTemplates) return cachedTemplates;

  const { value: text } = await mammoth.extractRawText({ path: DOCX_PATH });
  // Every real letter opens with OUR OWN reference number ("Ref No.:
  // MEPL/2026-27/..."), which is what actually marks a new letter. A plain
  // "Ref No" split also catches lines like "Reference: Your Letter No. ..."
  // that cite the RECIPIENT's own reference midway through a letter body,
  // fragmenting it — anchoring on "MEPL" avoids that.
  const blocks = text
    .split(/(?=Ref\.?\s*No\.?\s*:\s*MEPL)/i)
    .map((b) => b.trim())
    .filter(Boolean);

  // Faithful HTML of each letter (layout, fonts, alignment, tab-aligned date…). Same
  // anchors as the text split above, so the two line up index by index.
  let htmls = [];
  try { htmls = await letterHtmlBlocks(DOCX_PATH); } catch (e) { console.warn('[letter-templates] layout conversion failed:', e.message); }
  const useHtml = htmls.length === blocks.length;

  cachedTemplates = blocks.map((body, i) => {
    // Two subject-line styles appear in the source file: "Subject:" and,
    // in one older letter, "Sub :-".
    const subjectMatch = body.match(/Sub(?:ject)?\s*[:\-]+\s*([^\n]+)/i);
    return {
      id: `tmpl-${i + 1}`,
      subject: subjectMatch ? subjectMatch[1].trim() : `Letter format ${i + 1}`,
      body,
      html: useHtml ? htmls[i] : null,
    };
  });
  return cachedTemplates;
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'for', 'to', 'and', 'or', 'in', 'on', 'with', 'regarding',
  'letter', 'create', 'draft', 'please', 'write', 'prepare', 'tender', 'against', 'our', 'is',
  'i', 'need', 'want', 'my', 'me', 'you', 'we', 'us', 'i\'m', 'do', 'make', 'get', 'give', 'ok', 'now', 'new', 'no', 'date', 'submission',
]);

function tokenize(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOPWORDS.has(w));
}

/** Best-matching template for a chat request, by keyword overlap with each
 * template's Subject line. A format only counts as a match when at least TWO
 * meaningful words overlap — a single shared word ("date", "letter") is
 * coincidence, and forcing a company tender format onto e.g. a leave letter
 * gives nonsense. When nothing matches, `template` is null and the caller
 * drafts a free-form letter instead. */
async function matchTemplate(message) {
  const templates = await loadTemplates();
  const msgTokens = new Set(tokenize(message));

  let best = null;
  let bestScore = 0;
  for (const t of templates) {
    const subjTokens = tokenize(t.subject);
    let score = 0;
    for (const tok of subjTokens) if (msgTokens.has(tok)) score++;
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  const matched = bestScore >= 2;
  return { template: matched ? best : null, matched };
}

module.exports = { loadTemplates, matchTemplate };
