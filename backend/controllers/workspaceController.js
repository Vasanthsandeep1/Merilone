const fs = require('fs');
const path = require('path');
const { Op } = require('sequelize');
const {
  GemTender, GemTenderDoc, OpenTenderDetail, TenderStatusEntry, PartnerProfile, PartnerContact,
  WorkspaceDepartment, WorkspaceTask, WorkspaceDeadline, WorkspaceDocument, WorkspaceMyDoc, WorkspaceDocPrepSession,
  DocPrepAnnexure, DocPrepFieldMemory, DocPrepChecklistRow, LibraryItem,
  TenderProcessingResult, TenderProductSelection,
} = require('../models');
const { ollamaChat, parseJsonResponse, isOllamaAvailable } = require('../utils/ollamaClient');
const { sendMail, isMailConfigured } = require('../utils/mailer');
const { helpers } = require('./tenderController');
const { fromUrlId, parseGemJsonData, parseGemDateLoose, parseGemDocuments } = helpers;

// Clone of the automation site's Tender Hub (/workspace/:tenderId) — the
// container that opens when a partner clicks "Open Workspace" from Active
// Workspaces. Every table here is scoped to (user_id, bid_number): unlike
// the original (one shared internal workspace per tender, visible to all
// Meril staff), each partner tenant gets their own private hub for a
// tender, consistent with every other feature in this portal.

function bidFromReq(req) { return fromUrlId(req.params.bidNumber); }

// Strips currency formatting ("₹1,20,000", "1.2 Lakh" etc. never appears in
// gem_tenders — it's always a plain numeric string) down to a Number for
// chart axes; non-numeric/blank values become null rather than 0, so a
// missing EMD doesn't silently plot as "zero rupees".
const numOrNull = (v) => {
  const n = Number(String(v || '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};

// @route GET /api/workspace/:bidNumber/overview
// Tender Hub > Overview — a real documentation-dashboard read of this one
// tender: every scraped/parsed field GeM gives us, this partner's own
// status history, and a composition snapshot of what's actually been
// assembled so far (Tender Documents / My Docs / AI-matched Products /
// Deadlines) for the chart. No fabricated department/task board here —
// that concept was the old Workspace tab, which this page doesn't link to
// anymore.
exports.getOverview = async (req, res) => {
  try {
    const bidNumber = bidFromReq(req);
    const userId = req.user.id;

    const [tender, openTender, statusHistory, documents, myDocs, deadlines, processingResult, selections] = await Promise.all([
      GemTender.findOne({ where: { bidNumber } }),
      OpenTenderDetail.findOne({ where: { tenderId: bidNumber } }),
      TenderStatusEntry.findAll({ where: { userId, bidNumber }, order: [['createdAt', 'DESC']] }),
      WorkspaceDocument.count({ where: { userId, bidNumber } }),
      WorkspaceMyDoc.count({ where: { userId, bidNumber } }),
      WorkspaceDeadline.findAll({ where: { userId, bidNumber }, order: [['dueDate', 'ASC']] }),
      TenderProcessingResult.findOne({ where: { bidNo: bidNumber } }),
      TenderProductSelection.findAll({ where: { userId, bidNumber } }),
    ]);

    if (!tender && !openTender) return res.status(404).json({ success: false, message: 'Tender not found' });

    const latestStatus = statusHistory[0]?.status || null;
    // Open/CPPP tenders (no GemTender row, no scraped jsonData to parse) —
    // map onto the same shape with everything GeM-specific left null
    // rather than duplicating this whole response for a second source.
    const t = tender ? tender.toJSON() : (() => {
      const o = openTender.toJSON();
      return {
        bidNumber: o.tenderId, items: o.tenderTitle, quantity: null,
        department: o.organisationName || o.organisationChain, dept: o.dept, state: o.state,
        district: null, pincode: o.pincode, subCat: null,
        startDate: o.ePublishedDate, endDate: o.closingDate,
        emdAmount: o.emdAmount, bidValue: o.tenderValue,
        detailUrl: o.tenderSiteLink || o.tenderPageLink, jsonData: null,
      };
    })();
    const parsed = t.jsonData ? parseGemJsonData(t.jsonData) : {};
    const officialDocsCount = t.jsonData ? parseGemDocuments(t.jsonData).length : (openTender ? (openTender.fileLink?.length || 0) : 0);

    const rawProducts = processingResult?.suggestedProducts || null;
    const productsList = Array.isArray(rawProducts) ? rawProducts : (rawProducts ? JSON.parse(rawProducts) : []);
    const productsCount = productsList.filter((p) => !p.deleted).length;

    const now = Date.now();
    const endDateDt = t.endDate ? parseGemDateLoose(t.endDate) : null;
    const hoursLeft = endDateDt ? Math.round((endDateDt.getTime() - now) / 3.6e6) : null;
    const nextDeadline = deadlines.find((d) => new Date(d.dueDate).getTime() >= now) || null;

    // Timeline — merged, sorted events: this partner's own status-change
    // log plus the deadlines they've set themselves.
    const timeline = [
      ...statusHistory.map((s) => ({ type: 'status', label: `Marked "${s.status}"`, detail: s.remarks, at: s.createdAt })),
      ...deadlines.map((d) => ({ type: 'deadline', label: `Deadline set: ${d.title}`, detail: new Date(d.dueDate).toLocaleDateString('en-IN'), at: d.createdAt })),
    ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 30);

    res.json({
      success: true,
      data: {
        tender: {
          bidNumber: t.bidNumber,
          title: t.items,
          quantity: t.quantity,
          department: t.department,
          dept: t.dept,
          state: t.state,
          district: t.district,
          pincode: t.pincode,
          subCat: t.subCat,
          startDate: t.startDate,
          endDate: t.endDate,
          emdAmount: t.emdAmount,
          bidValue: t.bidValue,
          detailUrl: t.detailUrl,
          status: latestStatus,
          hoursLeft,
          parsed: {
            organisationName: parsed.organisationName || null,
            officeName: parsed.officeName || null,
            departmentOrg: parsed.departmentOrg || null,
            evaluationMethod: parsed.evaluationMethod || null,
            epbgPercentage: parsed.epbgPercentage || null,
            epbgDuration: parsed.epbgDuration || null,
            preBidDate: parsed.preBidDate || null,
            preBidTime: parsed.preBidTime || null,
            preBidVenue: parsed.preBidVenue || null,
            documentRequired: parsed.documentRequired || null,
            sampleRequired: !!parsed.sampleRequired,
            itemCategories: parsed.itemCategories ? Array.from(parsed.itemCategories) : [],
            bidOpeningDate: parsed.bidOpeningDate || null,
            bidOfferValidity: parsed.bidOfferValidity || null,
            advisoryBank: parsed.advisoryBank || null,
          },
        },
        summary: {
          documents: officialDocsCount + documents,
          myDocs,
          products: productsCount,
          productsSelected: selections.length,
          deadlinesTotal: deadlines.length,
          nextDeadline: nextDeadline ? { title: nextDeadline.title, dueDate: nextDeadline.dueDate } : null,
          emdAmountNum: numOrNull(t.emdAmount),
          bidValueNum: numOrNull(t.bidValue),
        },
        timeline,
      },
    });
  } catch (err) {
    console.error('getOverview error:', err);
    res.status(500).json({ success: false, message: 'Failed to load overview' });
  }
};

// ---- Departments ----

exports.listDepartments = async (req, res) => {
  try {
    const departments = await WorkspaceDepartment.findAll({ where: { userId: req.user.id, bidNumber: bidFromReq(req) }, order: [['name', 'ASC']] });
    res.json({ success: true, data: departments.map((d) => d.toJSON()) });
  } catch (err) {
    console.error('listDepartments error:', err);
    res.status(500).json({ success: false, message: 'Failed to load departments' });
  }
};

exports.createDepartment = async (req, res) => {
  try {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ success: false, message: 'Name is required' });
    const dept = await WorkspaceDepartment.create({ userId: req.user.id, bidNumber: bidFromReq(req), name: name.trim() });
    res.json({ success: true, data: dept.toJSON() });
  } catch (err) {
    console.error('createDepartment error:', err);
    res.status(500).json({ success: false, message: 'Failed to create department' });
  }
};

exports.renameDepartment = async (req, res) => {
  try {
    const dept = await WorkspaceDepartment.findOne({ where: { id: req.params.id, userId: req.user.id, bidNumber: bidFromReq(req) } });
    if (!dept) return res.status(404).json({ success: false, message: 'Department not found' });
    dept.name = (req.body.name || dept.name).trim();
    await dept.save();
    res.json({ success: true, data: dept.toJSON() });
  } catch (err) {
    console.error('renameDepartment error:', err);
    res.status(500).json({ success: false, message: 'Failed to update department' });
  }
};

exports.deleteDepartment = async (req, res) => {
  try {
    const userId = req.user.id;
    const bidNumber = bidFromReq(req);
    const dept = await WorkspaceDepartment.findOne({ where: { id: req.params.id, userId, bidNumber } });
    if (!dept) return res.status(404).json({ success: false, message: 'Department not found' });
    await WorkspaceTask.update({ departmentId: null }, { where: { userId, bidNumber, departmentId: dept.id } });
    await dept.destroy();
    res.json({ success: true });
  } catch (err) {
    console.error('deleteDepartment error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete department' });
  }
};

// ---- Tasks ----

exports.listTasks = async (req, res) => {
  try {
    const tasks = await WorkspaceTask.findAll({ where: { userId: req.user.id, bidNumber: bidFromReq(req) }, order: [['createdAt', 'DESC']] });
    res.json({ success: true, data: tasks.map((t) => t.toJSON()) });
  } catch (err) {
    console.error('listTasks error:', err);
    res.status(500).json({ success: false, message: 'Failed to load tasks' });
  }
};

exports.createTask = async (req, res) => {
  try {
    const { title, departmentId, dueDate, assignedContactId } = req.body;
    if (!title?.trim()) return res.status(400).json({ success: false, message: 'Title is required' });
    const task = await WorkspaceTask.create({
      userId: req.user.id, bidNumber: bidFromReq(req), title: title.trim(),
      departmentId: departmentId || null, dueDate: dueDate || null, assignedContactId: assignedContactId || null,
    });
    res.json({ success: true, data: task.toJSON() });
  } catch (err) {
    console.error('createTask error:', err);
    res.status(500).json({ success: false, message: 'Failed to create task' });
  }
};

exports.updateTask = async (req, res) => {
  try {
    const task = await WorkspaceTask.findOne({ where: { id: req.params.id, userId: req.user.id, bidNumber: bidFromReq(req) } });
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });
    const { title, status, dueDate, departmentId, assignedContactId } = req.body;
    if (title !== undefined) task.title = title;
    if (status !== undefined) task.status = status;
    if (dueDate !== undefined) task.dueDate = dueDate || null;
    if (departmentId !== undefined) task.departmentId = departmentId || null;
    if (assignedContactId !== undefined) task.assignedContactId = assignedContactId || null;
    await task.save();
    res.json({ success: true, data: task.toJSON() });
  } catch (err) {
    console.error('updateTask error:', err);
    res.status(500).json({ success: false, message: 'Failed to update task' });
  }
};

exports.deleteTask = async (req, res) => {
  try {
    const deleted = await WorkspaceTask.destroy({ where: { id: req.params.id, userId: req.user.id, bidNumber: bidFromReq(req) } });
    if (!deleted) return res.status(404).json({ success: false, message: 'Task not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('deleteTask error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete task' });
  }
};

// ---- Deadlines ----

exports.listDeadlines = async (req, res) => {
  try {
    const deadlines = await WorkspaceDeadline.findAll({ where: { userId: req.user.id, bidNumber: bidFromReq(req) }, order: [['dueDate', 'ASC']] });
    res.json({ success: true, data: deadlines.map((d) => d.toJSON()) });
  } catch (err) {
    console.error('listDeadlines error:', err);
    res.status(500).json({ success: false, message: 'Failed to load deadlines' });
  }
};

exports.createDeadline = async (req, res) => {
  try {
    const { title, dueDate } = req.body;
    if (!title?.trim() || !dueDate) return res.status(400).json({ success: false, message: 'Title and due date are required' });
    const deadline = await WorkspaceDeadline.create({ userId: req.user.id, bidNumber: bidFromReq(req), title: title.trim(), dueDate });
    res.json({ success: true, data: deadline.toJSON() });
  } catch (err) {
    console.error('createDeadline error:', err);
    res.status(500).json({ success: false, message: 'Failed to create deadline' });
  }
};

exports.deleteDeadline = async (req, res) => {
  try {
    const deleted = await WorkspaceDeadline.destroy({ where: { id: req.params.id, userId: req.user.id, bidNumber: bidFromReq(req) } });
    if (!deleted) return res.status(404).json({ success: false, message: 'Deadline not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('deleteDeadline error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete deadline' });
  }
};

// ---- Documents (partner-uploaded, alongside the official scraped ones) ----

exports.listDocuments = async (req, res) => {
  try {
    const docs = await WorkspaceDocument.findAll({ where: { userId: req.user.id, bidNumber: bidFromReq(req) }, order: [['createdAt', 'DESC']] });
    res.json({ success: true, data: docs.map((d) => d.toJSON()) });
  } catch (err) {
    console.error('listDocuments error:', err);
    res.status(500).json({ success: false, message: 'Failed to load documents' });
  }
};

exports.uploadDocument = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    const doc = await WorkspaceDocument.create({
      userId: req.user.id, bidNumber: bidFromReq(req),
      name: req.file.originalname, filePath: req.file.path, fileSize: req.file.size, mimeType: req.file.mimetype,
    });
    res.json({ success: true, data: doc.toJSON() });
  } catch (err) {
    console.error('uploadDocument error:', err);
    res.status(500).json({ success: false, message: 'Upload failed' });
  }
};

exports.downloadDocument = async (req, res) => {
  try {
    const doc = await WorkspaceDocument.findOne({ where: { id: req.params.id, userId: req.user.id, bidNumber: bidFromReq(req) } });
    if (!doc || !fs.existsSync(doc.filePath)) return res.status(404).json({ success: false, message: 'File not found' });
    res.download(doc.filePath, doc.name);
  } catch (err) {
    console.error('downloadDocument error:', err);
    res.status(500).json({ success: false, message: 'Download failed' });
  }
};

// @route GET /api/workspace/:bidNumber/documents/:id/view
// Same file as download, but served inline with a real MIME type so the
// browser renders it instead of forcing a save-as (which res.download
// always does via Content-Disposition: attachment).
exports.viewDocument = async (req, res) => {
  try {
    const doc = await WorkspaceDocument.findOne({ where: { id: req.params.id, userId: req.user.id, bidNumber: bidFromReq(req) } });
    if (!doc || !fs.existsSync(doc.filePath)) return res.status(404).json({ success: false, message: 'File not found' });
    res.setHeader('Content-Type', doc.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${doc.name.replace(/[^a-zA-Z0-9._-]/g, '_')}"`);
    fs.createReadStream(doc.filePath).pipe(res);
  } catch (err) {
    console.error('viewDocument error:', err);
    res.status(500).json({ success: false, message: 'Failed to open document' });
  }
};

exports.deleteDocument = async (req, res) => {
  try {
    const doc = await WorkspaceDocument.findOne({ where: { id: req.params.id, userId: req.user.id, bidNumber: bidFromReq(req) } });
    if (!doc) return res.status(404).json({ success: false, message: 'File not found' });
    if (fs.existsSync(doc.filePath)) fs.unlink(doc.filePath, () => {});
    await doc.destroy();
    res.json({ success: true });
  } catch (err) {
    console.error('deleteDocument error:', err);
    res.status(500).json({ success: false, message: 'Delete failed' });
  }
};

// @route GET /api/workspace/:bidNumber/documents/:id/pdf
// My Docs > Merge needs real PDF bytes for every source document — this
// serves the file as-is when it's already a PDF (the common case: most
// uploads here are PDFs, and every annexure download already is one) and
// a clear 415 otherwise, since this environment has no LibreOffice/format
// conversion available — the client-side merge skips that one file with a
// warning rather than failing the whole merge.
exports.getDocumentAsPdf = async (req, res) => {
  try {
    const doc = await WorkspaceDocument.findOne({ where: { id: req.params.id, userId: req.user.id, bidNumber: bidFromReq(req) } });
    if (!doc || !fs.existsSync(doc.filePath)) return res.status(404).json({ success: false, message: 'File not found' });
    const isPdf = (doc.mimeType || '').includes('pdf') || doc.filePath.toLowerCase().endsWith('.pdf');
    if (!isPdf) return res.status(415).json({ success: false, message: `"${doc.name}" isn't a PDF and can't be converted here — download it separately.` });
    res.setHeader('Content-Type', 'application/pdf');
    fs.createReadStream(doc.filePath).pipe(res);
  } catch (err) {
    console.error('getDocumentAsPdf error:', err);
    res.status(500).json({ success: false, message: 'Failed to read document' });
  }
};

// @route POST /api/workspace/:bidNumber/documents/merge-upload
// Receives the ALREADY-MERGED PDF bytes the client built with pdf-lib
// (page copying/numbering happens entirely in the browser — see the My
// Docs workflow spec) and stores it as the tender's one-and-only current
// merged document, replacing any previous merge in place rather than
// accumulating a pile of old attempts.
exports.uploadMergedDocument = async (req, res) => {
  try {
    const userId = req.user.id;
    const bidNumber = bidFromReq(req);
    if (!req.file) return res.status(400).json({ success: false, message: 'No merged file received' });

    let pageMap = [];
    try { pageMap = JSON.parse(req.body.pageMap || '[]'); } catch (e) { /* leave empty */ }
    const pages = parseInt(req.body.pages, 10) || null;

    const old = await WorkspaceDocument.findOne({ where: { userId, bidNumber, isMerged: true } });
    if (old) { if (fs.existsSync(old.filePath)) fs.unlink(old.filePath, () => {}); await old.destroy(); }

    const doc = await WorkspaceDocument.create({
      userId, bidNumber,
      name: (req.body.name || 'Merged Submission').trim() || 'Merged Submission',
      filePath: req.file.path, fileSize: req.file.size, mimeType: 'application/pdf',
      isMerged: true, pushSource: 'merged_output', pageMap, pages,
    });
    res.json({ success: true, data: doc.toJSON() });
  } catch (err) {
    console.error('uploadMergedDocument error:', err);
    res.status(500).json({ success: false, message: 'Failed to save merged document' });
  }
};

const TRANSCRIBE_PAGE_PROMPT = `You are transcribing a page of an ALREADY-FILLED real document exactly as shown in the image — nothing here is a blank to guess at, every word/number is already there. Transcribe it EXACTLY, do not invent or omit anything.
Output real HTML: a real <table> with <tr>/<td>/<th> and borders for any tabular content, headings/bold/alignment preserved via inline styles only (text-align, font-weight — no classes/external CSS). Ignore any letterhead/logo/footer graphic on the page — transcribe the body content only.
Output ONLY the HTML, no markdown, no commentary.`;

// @route POST /api/workspace/:bidNumber/documents/transcribe-page
// My Docs > page editor "Edit this page's content" (§4.3) — takes a
// single-page PDF the client extracted from the merged document, renders
// it to an image, and has a vision-capable model transcribe it back out as
// real HTML (same contract as Doc Prep's annexure-format extraction,
// except this is transcribing content that's already filled in, not a
// blank template with [FILL:*] placeholders).
exports.transcribePage = async (req, res) => {
  let tmpPath = null;
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No page received' });
    tmpPath = req.file.path;
    const { renderPdfPageRangeBase64 } = require('./documentTenderController').helpers;
    const images = await renderPdfPageRangeBase64(tmpPath, 1, 1);
    if (!images.length) return res.status(500).json({ success: false, message: 'Could not render this page.' });

    const visionModel = process.env.OLLAMA_VISION_MODEL || 'gemma4:31b-cloud';
    const raw = await ollamaChat(TRANSCRIBE_PAGE_PROMPT, 'Transcribe this page.', { json: false, numPredict: 3000, temperature: 0, model: visionModel, images });
    res.json({ success: true, html: cleanDraftHtml(raw) });
  } catch (err) {
    console.error('transcribePage error:', err);
    res.status(500).json({ success: false, message: 'Transcription failed — is Ollama running with a vision model pulled?' });
  } finally {
    if (tmpPath && fs.existsSync(tmpPath)) fs.unlink(tmpPath, () => {});
  }
};

// ---- My Docs ----

exports.listMyDocs = async (req, res) => {
  try {
    const docs = await WorkspaceMyDoc.findAll({ where: { userId: req.user.id, bidNumber: bidFromReq(req) }, order: [['updatedAt', 'DESC']] });
    res.json({ success: true, data: docs.map((d) => d.toJSON()) });
  } catch (err) {
    console.error('listMyDocs error:', err);
    res.status(500).json({ success: false, message: 'Failed to load documents' });
  }
};

exports.createMyDoc = async (req, res) => {
  try {
    const doc = await WorkspaceMyDoc.create({ userId: req.user.id, bidNumber: bidFromReq(req), title: req.body.title || 'Untitled document', content: '' });
    res.json({ success: true, data: doc.toJSON() });
  } catch (err) {
    console.error('createMyDoc error:', err);
    res.status(500).json({ success: false, message: 'Failed to create document' });
  }
};

exports.updateMyDoc = async (req, res) => {
  try {
    const doc = await WorkspaceMyDoc.findOne({ where: { id: req.params.id, userId: req.user.id, bidNumber: bidFromReq(req) } });
    if (!doc) return res.status(404).json({ success: false, message: 'Document not found' });
    const { title, content } = req.body;
    if (title !== undefined) doc.title = title || 'Untitled document';
    if (content !== undefined) doc.content = content;
    await doc.save();
    res.json({ success: true, data: doc.toJSON() });
  } catch (err) {
    console.error('updateMyDoc error:', err);
    res.status(500).json({ success: false, message: 'Failed to save document' });
  }
};

exports.deleteMyDoc = async (req, res) => {
  try {
    const deleted = await WorkspaceMyDoc.destroy({ where: { id: req.params.id, userId: req.user.id, bidNumber: bidFromReq(req) } });
    if (!deleted) return res.status(404).json({ success: false, message: 'Document not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('deleteMyDoc error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete document' });
  }
};

// A blank never occurs in a normal typed/AI-drafted document — used to mark
// where one merged section ends and the next begins, so exportMyDoc can put
// a real page break there instead of running everything together.
const MERGE_SECTION_BREAK = '\n\n\x0c\n\n';

// @route POST /api/workspace/:bidNumber/mydocs/merge
// Bundles a set of My Docs (annexure drafts pushed here, or hand-written
// notes) into a single ready-to-submit document, in the order given.
exports.mergeMyDocs = async (req, res) => {
  try {
    const userId = req.user.id;
    const bidNumber = bidFromReq(req);
    const { ids, title } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: 'Select at least one document to merge' });
    }

    const docs = await WorkspaceMyDoc.findAll({ where: { id: ids, userId, bidNumber } });
    const byId = new Map(docs.map((d) => [d.id, d]));
    const ordered = ids.map((id) => byId.get(id)).filter(Boolean);
    if (!ordered.length) return res.status(404).json({ success: false, message: 'Documents not found' });

    const mergedContent = ordered
      .map((d) => `${d.title}\n${'='.repeat(String(d.title || '').length)}\n\n${(d.content || '').trim()}`)
      .join(MERGE_SECTION_BREAK);

    const merged = await WorkspaceMyDoc.create({
      userId,
      bidNumber,
      title: title?.trim() || 'Final Submission Bundle',
      content: mergedContent,
      mergedFromIds: ordered.map((d) => d.id),
    });

    res.json({ success: true, data: merged.toJSON() });
  } catch (err) {
    console.error('mergeMyDocs error:', err);
    res.status(500).json({ success: false, message: 'Merge failed' });
  }
};

// @route GET /api/workspace/:bidNumber/mydocs/:id/export
// Same "HTML served as .doc" approach as exportAnnexure — merged docs get a
// real page break at each MERGE_SECTION_BREAK so each source section starts
// on its own page in Word.
exports.exportMyDoc = async (req, res) => {
  try {
    const doc = await WorkspaceMyDoc.findOne({ where: { id: req.params.id, userId: req.user.id, bidNumber: bidFromReq(req) } });
    if (!doc || !doc.content) return res.status(404).json({ success: false, message: 'Nothing to export' });

    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const sections = doc.content.split('\x0c');
    const body = sections
      .map((section, i) => {
        const pre = `<pre style="font-family:Calibri,sans-serif;white-space:pre-wrap;">${esc(section.trim())}</pre>`;
        return i === 0 ? pre : `<div style="page-break-before:always;">${pre}</div>`;
      })
      .join('');

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${body}</body></html>`;
    res.setHeader('Content-Type', 'application/msword');
    res.setHeader('Content-Disposition', `attachment; filename="${doc.title.replace(/[^a-z0-9]/gi, '_')}.doc"`);
    res.send(html);
  } catch (err) {
    console.error('exportMyDoc error:', err);
    res.status(500).json({ success: false, message: 'Export failed' });
  }
};

// @route GET /api/workspace/:bidNumber/mydocs/:id/pdf
// A My Docs draft has no bytes anywhere until it's actually needed — My
// Docs > Merge renders it to a real PDF on demand via this endpoint (same
// idea as a Doc Prep annexure draft, just plain text here, no letterhead).
exports.getMyDocAsPdf = async (req, res) => {
  try {
    const doc = await WorkspaceMyDoc.findOne({ where: { id: req.params.id, userId: req.user.id, bidNumber: bidFromReq(req) } });
    if (!doc || !doc.content) return res.status(404).json({ success: false, message: 'Nothing to render' });
    const { renderPdf } = require('../utils/letterPdf');
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const html = doc.content.split('\x0c').map((section) => `<p>${esc(section.trim()).replace(/\n/g, '<br>')}</p>`).join('<p style="page-break-before:always;"></p>');
    const buf = await renderPdf(html, doc.title, null);
    res.setHeader('Content-Type', 'application/pdf');
    res.send(buf);
  } catch (err) {
    console.error('getMyDocAsPdf error:', err);
    res.status(500).json({ success: false, message: 'Failed to render document' });
  }
};

// ---- Doc Prep ----
// Clone of the OpenProcure automation site's Doc Prep (annexure discovery +
// drafting + library interaction + checklist/page-numbering), rebuilt onto
// normalized tables (DocPrepAnnexure / DocPrepFieldMemory /
// DocPrepChecklistRow) instead of the original's single JSON-blob session
// row with no transaction safety. Two deliberate departures from the
// original, called out where relevant below:
//   1. Re-analyze diffs against existing annexures (matched by
//      annexureRef+title) and PRESERVES already-drafted/pushed content —
//      the original fully replaces the list and wipes every draft on every
//      re-run, which is a destructive footgun, not a feature worth copying.
//   2. "AI Drive" matching runs against this partner's own Library
//      (per-partner tenancy) instead of one shared company-wide drive.

async function getOrCreateSession(userId, bidNumber) {
  const [session] = await WorkspaceDocPrepSession.findOrCreate({
    where: { userId, bidNumber },
    defaults: { userId, bidNumber, status: 'idle', annexures: [] },
  });
  return session;
}

function annexureForApi(a) {
  const j = a.toJSON ? a.toJSON() : a;
  return { ...j, hasDraft: !!j.draftContent };
}

// Runs once per session (gemDetectedAt marks it as done) — checks whether
// this tender already has a real bid document on file (GemTenderDoc.pdfUrl,
// a genuine gem.gov.in link scraped alongside everything else about this
// tender) and fetches it automatically, exactly like the original's "the
// system checks thoroughly and auto-attaches the bid document, only asking
// the partner to upload when nothing was found." The tender's other
// scraped links (BOQ/ATC/OMPPD/Gem Contract) are offered as one-click
// Accept/Reject "detected documents" rather than auto-downloaded outright,
// since those are supplementary, not the bid doc itself.
async function autoResolveBidDocument(session, bidNumber) {
  if (session.gemDetectedAt) return session;
  session.gemDetectedAt = new Date();

  try {
    const [gemDoc, tender] = await Promise.all([
      GemTenderDoc.findOne({ where: { bidNumber } }),
      GemTender.findOne({ where: { bidNumber } }),
    ]);

    if (!session.bidDocPath && gemDoc?.pdfUrl) {
      try {
        const resp = await fetch(gemDoc.pdfUrl, { signal: AbortSignal.timeout(30000) });
        if (resp.ok) {
          const buf = Buffer.from(await resp.arrayBuffer());
          const uploadDir = path.join(process.env.UPLOAD_DIR || 'uploads', 'workspace');
          if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
          const filename = `biddoc-${Date.now()}-${Math.round(Math.random() * 1e9)}.pdf`;
          const destPath = path.join(uploadDir, filename);
          fs.writeFileSync(destPath, buf);
          session.bidDocPath = destPath;
          session.bidDocName = `${bidNumber.replace(/\//g, '_')}.pdf`;
          session.bidDocAutoFetched = true;
        }
      } catch (err) { console.error('autoResolveBidDocument: pdf fetch failed (non-fatal):', err.message); }
    }

    // Other scraped links (BOQ/ATC/OMPPD/Gem Contract) — surfaced for
    // review, not force-downloaded, since the partner should decide which
    // of these are actually relevant as additional documents.
    if (tender?.jsonData) {
      const links = parseGemDocuments(tender.jsonData);
      const mainUrl = gemDoc?.pdfUrl;
      session.detectedDocs = links
        .filter((l) => l.url !== mainUrl)
        .slice(0, 8)
        .map((l, i) => ({ id: `det_${Date.now()}_${i}`, label: l.label, url: l.url }));
    }
  } catch (err) {
    console.error('autoResolveBidDocument error (non-fatal):', err.message);
  }

  await session.save();
  return session;
}

// @route GET /api/workspace/:bidNumber/doc-prep
exports.getDocPrepSession = async (req, res) => {
  try {
    const userId = req.user.id;
    const bidNumber = bidFromReq(req);
    let session = await getOrCreateSession(userId, bidNumber);
    session = await autoResolveBidDocument(session, bidNumber);
    const annexures = await DocPrepAnnexure.findAll({ where: { userId, bidNumber }, order: [['sortOrder', 'ASC'], ['id', 'ASC']] });
    const ollamaReady = await isOllamaAvailable();
    res.json({
      success: true,
      data: { ...sessionForApi(session), annexures: annexures.map(annexureForApi) },
      ollamaReady,
    });
  } catch (err) {
    console.error('getDocPrepSession error:', err);
    res.status(500).json({ success: false, message: 'Failed to load Doc Prep session' });
  }
};

// ---- Doc Prep: bid document + additional docs (pre-analysis gate) ----
// Same "upload or import, then Analyze" flow as the original — Run
// Analysis stays disabled in the UI until a bid document is selected.

function sessionForApi(session) {
  const j = session.toJSON();
  return { ...j, additionalDocs: j.additionalDocs || [], detectedDocs: j.detectedDocs || [] };
}

// @route POST /api/workspace/:bidNumber/doc-prep/upload-bid
exports.uploadBidDocument = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    const session = await getOrCreateSession(req.user.id, bidFromReq(req));
    if (session.bidDocPath && !session.bidDocSourceDocumentId && fs.existsSync(session.bidDocPath)) fs.unlink(session.bidDocPath, () => {});
    session.bidDocPath = req.file.path;
    session.bidDocName = req.file.originalname;
    session.bidDocSourceDocumentId = null;
    await session.save();
    res.json({ success: true, data: sessionForApi(session) });
  } catch (err) {
    console.error('uploadBidDocument error:', err);
    res.status(500).json({ success: false, message: 'Upload failed' });
  }
};

// @route POST /api/workspace/:bidNumber/doc-prep/import-bid
// Points the bid doc at a file already sitting in this tender's Documents
// tab, instead of uploading a duplicate copy.
exports.importBidDocumentFromDocuments = async (req, res) => {
  try {
    const userId = req.user.id;
    const bidNumber = bidFromReq(req);
    const doc = await WorkspaceDocument.findOne({ where: { id: req.body.documentId, userId, bidNumber } });
    if (!doc) return res.status(404).json({ success: false, message: 'Document not found' });
    const session = await getOrCreateSession(userId, bidNumber);
    if (session.bidDocPath && !session.bidDocSourceDocumentId && fs.existsSync(session.bidDocPath)) fs.unlink(session.bidDocPath, () => {});
    session.bidDocPath = doc.filePath;
    session.bidDocName = doc.name;
    session.bidDocSourceDocumentId = doc.id;
    await session.save();
    res.json({ success: true, data: sessionForApi(session) });
  } catch (err) {
    console.error('importBidDocumentFromDocuments error:', err);
    res.status(500).json({ success: false, message: 'Import failed' });
  }
};

// @route DELETE /api/workspace/:bidNumber/doc-prep/bid-doc
exports.removeBidDocument = async (req, res) => {
  try {
    const session = await getOrCreateSession(req.user.id, bidFromReq(req));
    if (session.bidDocPath && !session.bidDocSourceDocumentId && fs.existsSync(session.bidDocPath)) fs.unlink(session.bidDocPath, () => {});
    session.bidDocPath = null;
    session.bidDocName = null;
    session.bidDocSourceDocumentId = null;
    session.bidDocAutoFetched = false;
    await session.save();
    res.json({ success: true, data: sessionForApi(session) });
  } catch (err) {
    console.error('removeBidDocument error:', err);
    res.status(500).json({ success: false, message: 'Failed to remove bid document' });
  }
};

// @route GET /api/workspace/:bidNumber/doc-prep/bid-doc/view
// Streams the current bid document inline (for "View"), whether it was
// auto-fetched, uploaded, or imported from Documents.
exports.viewBidDocument = async (req, res) => {
  try {
    const session = await getOrCreateSession(req.user.id, bidFromReq(req));
    if (!session.bidDocPath || !fs.existsSync(session.bidDocPath)) return res.status(404).json({ success: false, message: 'Bid document not found' });
    const ext = path.extname(session.bidDocName || session.bidDocPath).toLowerCase();
    const mime = ext === '.pdf' ? 'application/pdf'
      : ext === '.docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      : ext === '.doc' ? 'application/msword'
      : 'application/octet-stream';
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `inline; filename="${(session.bidDocName || 'bid-document.pdf').replace(/[^a-zA-Z0-9._-]/g, '_')}"`);
    fs.createReadStream(session.bidDocPath).pipe(res);
  } catch (err) {
    console.error('viewBidDocument error:', err);
    res.status(500).json({ success: false, message: 'Failed to open bid document' });
  }
};

// @route POST /api/workspace/:bidNumber/doc-prep/upload-additional
// ATC, OMPPD, corrigendum etc — supporting docs alongside the main bid doc.
exports.uploadAdditionalDoc = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    const session = await getOrCreateSession(req.user.id, bidFromReq(req));
    const docs = session.additionalDocs || [];
    docs.push({ id: `add_${Date.now()}`, name: req.file.originalname, path: req.file.path, label: req.body.label || 'Additional Document' });
    session.additionalDocs = [...docs];
    session.changed('additionalDocs', true);
    await session.save();
    res.json({ success: true, data: sessionForApi(session) });
  } catch (err) {
    console.error('uploadAdditionalDoc error:', err);
    res.status(500).json({ success: false, message: 'Upload failed' });
  }
};

// @route DELETE /api/workspace/:bidNumber/doc-prep/additional/:docId
exports.deleteAdditionalDoc = async (req, res) => {
  try {
    const session = await getOrCreateSession(req.user.id, bidFromReq(req));
    const docs = session.additionalDocs || [];
    const found = docs.find((d) => d.id === req.params.docId);
    if (found && fs.existsSync(found.path)) fs.unlink(found.path, () => {});
    session.additionalDocs = docs.filter((d) => d.id !== req.params.docId);
    session.changed('additionalDocs', true);
    await session.save();
    res.json({ success: true, data: sessionForApi(session) });
  } catch (err) {
    console.error('deleteAdditionalDoc error:', err);
    res.status(500).json({ success: false, message: 'Failed to remove document' });
  }
};

// @route POST /api/workspace/:bidNumber/doc-prep/detected/:docId/accept
// Downloads a GEM-scraped supporting link (BOQ/ATC/OMPPD/Gem Contract) the
// system found on its own, moving it from "detected" into the real
// additional-docs list.
exports.acceptDetectedDoc = async (req, res) => {
  try {
    const session = await getOrCreateSession(req.user.id, bidFromReq(req));
    const detected = session.detectedDocs || [];
    const found = detected.find((d) => d.id === req.params.docId);
    if (!found) return res.status(404).json({ success: false, message: 'Detected document not found' });

    const resp = await fetch(found.url, { signal: AbortSignal.timeout(30000) });
    if (!resp.ok) return res.status(502).json({ success: false, message: 'Could not download this document right now.' });
    const buf = Buffer.from(await resp.arrayBuffer());
    const uploadDir = path.join(process.env.UPLOAD_DIR || 'uploads', 'workspace');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    const filePath = path.join(uploadDir, `detected-${Date.now()}-${Math.round(Math.random() * 1e9)}.pdf`);
    fs.writeFileSync(filePath, buf);

    const docs = session.additionalDocs || [];
    docs.push({ id: `add_${Date.now()}`, name: `${found.label}.pdf`, path: filePath, label: found.label });
    session.additionalDocs = [...docs];
    session.changed('additionalDocs', true);
    session.detectedDocs = detected.filter((d) => d.id !== req.params.docId);
    session.changed('detectedDocs', true);
    await session.save();
    res.json({ success: true, data: sessionForApi(session) });
  } catch (err) {
    console.error('acceptDetectedDoc error:', err);
    res.status(500).json({ success: false, message: 'Failed to accept document' });
  }
};

// @route POST /api/workspace/:bidNumber/doc-prep/detected/:docId/reject
exports.rejectDetectedDoc = async (req, res) => {
  try {
    const session = await getOrCreateSession(req.user.id, bidFromReq(req));
    session.detectedDocs = (session.detectedDocs || []).filter((d) => d.id !== req.params.docId);
    session.changed('detectedDocs', true);
    await session.save();
    res.json({ success: true, data: sessionForApi(session) });
  } catch (err) {
    console.error('rejectDetectedDoc error:', err);
    res.status(500).json({ success: false, message: 'Failed to reject document' });
  }
};

// Ollama's format:'json' mode (used by ollamaChat's default json:true) only
// guarantees a valid JSON *object* comes back, not an array — asking for a
// bare `[...]` array under that mode is unreliable (a small local model like
// qwen2.5:1.5b will happily emit a single object instead, and json-mode
// forbids top-level arrays outright on some Ollama versions). Wrapping the
// list in an object key sidesteps that entirely.
//
// Taxonomy (type/category/dept/doc_group/mandatory/has_prescribed_format)
// mirrors the original's free-form discovery prompt exactly — the model is
// never given a hardcoded catalogue of document names, only this
// classification scheme to apply to whatever it actually finds in the
// tender text.
const ANNEXURE_SYSTEM_PROMPT = `You are a GeM tender documentation specialist. Read this tender's details and find EVERY item that requires a submission from the bidder: annexures (Annexure A, Form-1, etc.), affidavits, declarations, undertakings, authorization letters, agreements, checklists, and technical/financial/sample submission formats. Do not use a fixed list — find what this specific tender actually asks for.

For EACH item, assign:
- "annexure_ref": its exact annexure/form number if the tender gives one, otherwise a short descriptive label you invent
- "title": a clear document title
- "type": one of affidavit|declaration|undertaking|authorization|agreement|checklist|financial|technical|sample_submission|other
- "category": letter|certificate
- "dept_tag": financial|tender_admin|technical|legal|hr|other (who in the company should own producing this)
- "doc_group": annexure|license|certificate
- "mandatory": true|false
- "has_prescribed_format": true if the tender provides a fillable template/format to copy, false if the bidder must produce the document in their own format

Output ONLY a JSON object of this exact shape: {"documents": [{"annexure_ref":"Annexure A","title":"...","type":"authorization","category":"certificate","dept_tag":"tender_admin","doc_group":"annexure","mandatory":true,"has_prescribed_format":true}]}
Return every real item you can find (typically 4-12). No markdown, no explanation.`;

// ---- Index-driven annexure discovery ----
// Every GeM/Open tender's bid document is its own ground truth: it has a
// table of contents listing "ANNEXURE-I ... 36", "ANNEXURE-II ... 37" with
// the document's OWN printed page numbers. Reading that index and jumping
// straight to those pages (same idea as the original's vision-based
// page_hint navigation) finds the REAL annexures with their REAL content —
// a free-form "read 12000 characters and guess" LLM call over the front
// matter never sees the annexures at all and invents plausible-sounding
// titles instead. This path is tried first for any PDF bid document; the
// free-form prompt below is the fallback for documents with no such index
// (most GEM tenders, which rarely scan this cleanly).

// Maps this document's own printed page numbers ("Page 36 of 55") to the
// actual array index in `pages` — usually identical, but reading the
// marker instead of assuming front matter can throw that off.
function buildPrintedPageMap(pages) {
  const map = new Map();
  for (let i = 0; i < pages.length; i++) {
    const m = pages[i].text.match(/Page\s+(\d+)\s+of\s+\d+/i);
    if (m) map.set(Number(m[1]), i);
  }
  return map;
}

function resolvePageIndex(printedPage, pages, printedMap) {
  if (printedMap.has(printedPage)) return printedMap.get(printedPage);
  const idx = printedPage - 1;
  return idx >= 0 && idx < pages.length ? idx : null;
}

// Scans every page directly for a real annexure/bidding-schedule heading
// near its top. Tried BEFORE the TOC-based approach below: a real tender
// document was found where the TOC's own page-number column was simply
// wrong throughout (claimed "Annexure I → page 36", but the real
// "ANNEXURE - I" heading is actually on page 32 — every single entry was
// off, not just one), while the in-body headings themselves were exactly
// where printed. The body is more trustworthy than the document's own
// table of contents for THIS reason — go straight to the source.
function findRealAnnexureHeadings(pages) {
  const headingRe = /^(ANNEXURE[\s\-–—]*(?:[IVXLCDM]+|\d+)|BIDDING\s+SCHEDULES?)\b/i;
  const found = [];
  for (let i = 0; i < pages.length; i++) {
    const lines = pages[i].text.split('\n').map((l) => l.trim()).filter(Boolean);
    // The heading is almost always within the first few non-blank lines of
    // the page (may follow a 1-3 line letterhead masthead) — and short; a
    // long line matching loosely is body prose quoting/cross-referencing
    // an annexure, not the annexure's own heading.
    for (const line of lines.slice(0, 6)) {
      if (line.length > 80) continue;
      const m = line.match(headingRe);
      if (m) { found.push({ ref: m[1].replace(/\s+/g, ' ').trim(), pageIdx: i }); break; }
    }
  }
  const seen = new Set();
  const entries = found.filter((e) => { const k = e.ref.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  if (entries.length < 3) return [];

  for (let i = 0; i < entries.length; i++) {
    const cur = entries[i];
    const next = entries[i + 1];
    cur.startIdx = cur.pageIdx;
    cur.endIdx = Math.min(pages.length - 1, next ? Math.max(cur.pageIdx, next.pageIdx - 1) : cur.pageIdx + 3, cur.pageIdx + 3);
    cur.sourceText = pages.slice(cur.startIdx, cur.endIdx + 1)
      .map((p) => p.text.replace(/^Page\s+\d+\s+of\s+\d+\s*$/gim, '').trim())
      .join('\n\n').slice(0, 8000);
  }
  return entries.filter((e) => e.sourceText);
}

// Finds lines like "ANNEXURE- I \t36" or "BIDDING SCHEDULE \t53" anywhere
// in the document (the index/TOC page is usually near the front, but this
// doesn't assume a fixed position) and resolves each to its real source
// text — up to 4 printed pages, bounded by the next index entry's page.
// Fallback only: used when the body scan above (findRealAnnexureHeadings)
// doesn't find real in-body headings itself (e.g. a document that prints
// annexures without any heading line pdf-parse can isolate).
function parseAnnexureIndexEntries(pages) {
  const raw = [];
  const lineRe = /^(ANNEXURE[\s\-–—]*(?:[IVXLCDM]+|\d+)|BIDDING\s+SCHEDULE)\s*\t+\s*(\d{1,4})\s*$/i;
  for (const p of pages) {
    for (const line of p.text.split('\n')) {
      const m = line.trim().match(lineRe);
      if (m) raw.push({ ref: m[1].replace(/\s+/g, ' ').trim(), printedPage: Number(m[2]) });
    }
  }
  const seen = new Set();
  const entries = raw.filter((e) => { const k = e.ref.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  if (entries.length < 3) return []; // too few to trust as a real index — let the fallback handle it

  entries.sort((a, b) => a.printedPage - b.printedPage);
  const printedMap = buildPrintedPageMap(pages);
  for (let i = 0; i < entries.length; i++) {
    const cur = entries[i];
    const next = entries[i + 1];
    const startIdx = resolvePageIndex(cur.printedPage, pages, printedMap);
    if (startIdx == null) { cur.sourceText = ''; continue; }
    let endPrinted = next ? Math.max(cur.printedPage, next.printedPage - 1) : cur.printedPage + 3;
    endPrinted = Math.min(endPrinted, cur.printedPage + 3);
    const endIdx = Math.min(pages.length - 1, resolvePageIndex(endPrinted, pages, printedMap) ?? startIdx);
    cur.startIdx = startIdx;
    cur.endIdx = Math.max(startIdx, endIdx);
    // Strip the "Page N of NN" running header/footer each page carries —
    // pure pagination noise, not part of the annexure's actual content,
    // and leaving it in made drafts echo a stray "Page 40 of 55" line.
    cur.sourceText = pages.slice(startIdx, cur.endIdx + 1)
      .map((p) => p.text.replace(/^Page\s+\d+\s+of\s+\d+\s*$/gim, '').trim())
      .join('\n\n').slice(0, 8000);

    // NOTE: an earlier version of this function overrode `cur.ref` with
    // whatever heading text was actually printed on the resolved page,
    // reasoning that the label should match the opened content. Reverted —
    // on a real document where the in-body numbering itself isn't
    // sequential/consistent (this exact tender has that problem), that
    // produced a confusing non-sequential list (I, V, VI, VII, VIII, X,
    // VII again, ...) that LOOKED like annexures II–IV had gone missing,
    // when all 16 index entries were still present. The index's own
    // sequential numbering (I, II, III, ...) is what the user actually
    // scans top-to-bottom, so it stays authoritative for the ref — the
    // `title` field (and the real sourceText/content underneath) is what
    // carries the accurate description either way.
  }
  return entries.filter((e) => e.sourceText);
}

const INDEX_CLASSIFY_PROMPT = `You are reading one specific annexure/document exactly as printed in a tender's bid document. Describe it accurately based ONLY on the real text given — never invent content it doesn't contain.
Output ONLY this JSON: {"title":"a short clear document title, max 8 words","type":"affidavit|declaration|undertaking|authorization|agreement|checklist|financial|technical|sample_submission|other","category":"letter|certificate","dept_tag":"financial|tender_admin|technical|legal|hr|other","doc_group":"annexure|license|certificate","mandatory":true,"has_prescribed_format":true}
"has_prescribed_format" is true if this text IS a fillable format/template (has blanks, a table to fill, "I/We hereby..." etc) — which is true for almost every annexure.`;

// Classifies each already-LOCATED (not guessed) annexure from its real
// source text — bounded concurrency since a tender can have 15+ of these
// and this runs on a small local model.
async function classifyIndexedAnnexures(entries) {
  const results = [];
  const CONCURRENCY = 3;
  for (let i = 0; i < entries.length; i += CONCURRENCY) {
    const batch = entries.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(batch.map(async (e) => {
      const userMsg = `Reference: ${e.ref}\n\nReal content from the bid document:\n${e.sourceText}`;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const raw = await ollamaChat(INDEX_CLASSIFY_PROMPT, userMsg, { numPredict: 600 });
          const parsed = parseJsonResponse(raw);
          if (parsed?.title) return { ...e, ...parsed };
        } catch (err) { /* retry once */ }
      }
      return { ...e, title: e.ref, type: 'other', category: 'letter', dept_tag: 'other', doc_group: 'annexure', mandatory: true, has_prescribed_format: true };
    }));
    results.push(...batchResults);
  }
  return results;
}

// Token-overlap similarity — same algorithm as the original's
// checklistFuzzyScore: normalize, tokenize on whitespace keeping words >2
// chars, overlap / larger-set-size. No edit distance/embeddings needed for
// matching short document titles.
function fuzzyScore(a, b) {
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, '');
  const tokens = (s) => new Set(norm(s).split(/\s+/).filter((t) => t.length > 2));
  const setA = tokens(a); const setB = tokens(b);
  if (!setA.size || !setB.size) return 0;
  let overlap = 0;
  for (const t of setA) if (setB.has(t)) overlap++;
  return overlap / Math.max(setA.size, setB.size);
}

// @route POST /api/workspace/:bidNumber/doc-prep/analyze
// Also doubles as "Re-analyze" — see the diff-merge note above the Doc Prep
// section header for why this does NOT behave like the original's
// destructive full-replace.
exports.analyzeDocPrep = async (req, res) => {
  const userId = req.user.id;
  const bidNumber = bidFromReq(req);
  try {
    const session = await getOrCreateSession(userId, bidNumber);
    if (!session.bidDocPath) {
      return res.status(400).json({ success: false, message: 'Upload the bid document (or import one from Documents) before running analysis.' });
    }
    const tender = await GemTender.findOne({ where: { bidNumber } });
    const openTenderRow = tender ? null : await OpenTenderDetail.findOne({ where: { tenderId: bidNumber } });
    if (!tender && !openTenderRow) return res.status(404).json({ success: false, message: 'Tender not found' });

    session.status = 'processing';
    await session.save();

    // Open/CPPP tenders have no scraped jsonData/tech-spec tables to fall
    // back on — the uploaded bid document's own text (fetched below) is
    // the only real source of annexure context for them.
    const tenderJson = tender ? tender.toJSON() : {
      items: openTenderRow.tenderTitle, dept: openTenderRow.dept, subCat: null,
    };
    const parsed = tenderJson.jsonData ? parseGemJsonData(tenderJson.jsonData) : null;
    const techSpecsText = parsed?.techSpecTables?.length
      ? JSON.stringify(parsed.techSpecTables).slice(0, 6000)
      : (tenderJson.items || '');

    // Prefer the actual bid document's own text (same extractText pipeline
    // as the Document Tender feature — PDF/OCR/docx/xlsx) over the
    // tender's scraped spec tables when it reads cleanly; falls back to
    // the scraped data if extraction comes back too thin to be useful.
    // Annexure formats conventionally sit at the very END of a long
    // document — an aggressive cap silently drops every annexure body even
    // though discovery still "finds" it by name earlier in the text — so
    // this is sized generously against the discovery model's own context
    // window (OLLAMA_MODEL defaults to a large-context cloud model), not an
    // arbitrary small number.
    const DISCOVERY_TEXT_CAP = 100000;
    let bidDocText = '';
    try {
      const { extractText } = require('./documentTenderController').helpers;
      const raw = await extractText(session.bidDocPath, session.bidDocName || session.bidDocPath);
      bidDocText = (raw || '').trim().slice(0, DISCOVERY_TEXT_CAP);
    } catch (e) { console.error('bid doc extraction failed, falling back to scraped data:', e.message); }

    // Additional docs (ATC etc) get read too, not just their labels —
    // annexure formats very often live in a companion ATC document rather
    // than the main NIT, so ATC-labelled ones are sorted to the front.
    let additionalDocsText = '';
    try {
      const { extractText } = require('./documentTenderController').helpers;
      const docs = [...(session.additionalDocs || [])].sort((a, b) => (/atc/i.test(a.label) ? -1 : 0) - (/atc/i.test(b.label) ? -1 : 0));
      const parts = [];
      for (const d of docs) {
        try { parts.push(`--- ${d.label} ---\n${(await extractText(d.path, d.name) || '').trim()}`); } catch (e) { /* skip unreadable one */ }
      }
      additionalDocsText = parts.join('\n\n').slice(0, DISCOVERY_TEXT_CAP);
    } catch (e) { /* additionalDocs may be empty — fine */ }

    // Try the document's own index/table of contents first — real,
    // located content beats a free-form guess every time. Only falls
    // through to the guess-from-the-front-matter prompt below when no
    // usable index was found (fewer than 3 "ANNEXURE ... <page>" lines).
    let list = null;
    try {
      const { extractPdfPagesRaw } = require('./documentTenderController').helpers;
      const pages = await extractPdfPagesRaw(session.bidDocPath);
      if (pages) {
        // Body-scan (real in-body headings) first — more trustworthy than
        // the TOC, see findRealAnnexureHeadings' own comment. Only falls
        // back to the TOC-based page-number approach when the body scan
        // itself can't find real headings.
        const indexed = findRealAnnexureHeadings(pages);
        const finalIndexed = indexed.length >= 3 ? indexed : parseAnnexureIndexEntries(pages);
        if (finalIndexed.length >= 3) {
          list = (await classifyIndexedAnnexures(finalIndexed)).map((e) => ({
            annexure_ref: e.ref, title: e.title || e.ref, type: e.type, category: e.category,
            dept_tag: e.dept_tag, doc_group: e.doc_group, mandatory: e.mandatory, has_prescribed_format: e.has_prescribed_format,
            page_hint: e.printedPage ? `Page ${e.printedPage}` : `Page ${e.pageIdx + 1}`, sourceText: e.sourceText,
            sourcePageStart: e.startIdx, sourcePageEnd: e.endIdx,
          }));
        }
      }
    } catch (e) { console.error('index-driven annexure discovery failed, falling back to free-form:', e.message); }

    if (!list) {
      const userMsg = `Tender Item: ${tenderJson.items || ''}
Department: ${tenderJson.dept || ''}
Sub Category: ${tenderJson.subCat || ''}
Document Required: ${parsed?.documentRequired || ''}
${additionalDocsText ? `Additional Documents Text (ATC etc):\n${additionalDocsText}\n\n` : ''}${bidDocText.length > 200 ? `Bid Document Text:\n${bidDocText}` : `Technical Specifications: ${techSpecsText}`}`;

      // A small local model occasionally returns a genuinely empty
      // {"documents":[]} on the first pass for terse tenders (sparse
      // techSpecsText gives it little to latch onto) — one retry at a
      // slightly higher temperature resolves this in practice without
      // resorting to a larger/slower model.
      for (let attempt = 0; attempt < 2 && (!Array.isArray(list) || list.length === 0); attempt++) {
        const raw = await ollamaChat(ANNEXURE_SYSTEM_PROMPT, userMsg, { numPredict: 8000, temperature: attempt === 0 ? 0.05 : 0.4 });
        const parsedResponse = parseJsonResponse(raw);
        list = Array.isArray(parsedResponse) ? parsedResponse : parsedResponse?.documents;
      }
    }
    if (!Array.isArray(list) || list.length === 0) throw new Error('No annexures could be identified for this tender — try again, or add documents manually.');

    const existing = await DocPrepAnnexure.findAll({ where: { userId, bidNumber } });
    const ENUM_TYPE = ['affidavit', 'declaration', 'undertaking', 'authorization', 'agreement', 'checklist', 'financial', 'technical', 'sample_submission', 'tender_checklist', 'other'];
    const ENUM_DEPT = ['financial', 'tender_admin', 'technical', 'legal', 'hr', 'other'];
    const ENUM_GROUP = ['annexure', 'license', 'certificate'];

    const seenIds = new Set();
    let order = 0;
    for (const item of list) {
      const title = item.title || item.name || `Document ${order + 1}`;
      const annexureRef = item.annexure_ref || item.annexureRef || null;
      // Match against an already-discovered row by ref (or title, if no
      // ref was given either time) so a drafted/pushed annexure survives a
      // recheck instead of being wiped and recreated from scratch.
      const match = existing.find((e) => !seenIds.has(e.id) && (
        (annexureRef && e.annexureRef && e.annexureRef.toLowerCase() === annexureRef.toLowerCase())
        || e.title.toLowerCase() === title.toLowerCase()
      ));

      const type = ENUM_TYPE.includes(item.type) ? item.type : 'other';
      const payload = {
        userId, bidNumber,
        annexureRef, title,
        type,
        category: item.category === 'certificate' ? 'certificate' : 'letter',
        deptTag: ENUM_DEPT.includes(item.dept_tag) ? item.dept_tag : 'other',
        docGroup: ENUM_GROUP.includes(item.doc_group) ? item.doc_group : 'annexure',
        mandatory: item.mandatory !== false,
        hasPrescribedFormat: !!item.has_prescribed_format,
        pageHint: item.page_hint || null,
        sourceText: item.sourceText || null,
        sourcePageStart: item.sourcePageStart ?? null,
        sourcePageEnd: item.sourcePageEnd ?? null,
        requiresStampPaper: type === 'affidavit',
        sortOrder: order++,
      };
      if (type === 'affidavit' && !match) payload.stampStatus = 'pending';

      if (match) {
        seenIds.add(match.id);
        Object.assign(match, payload);
        await match.save();
      } else {
        await DocPrepAnnexure.create(payload);
      }
    }

    // Anything not re-discovered this run: drop it ONLY if nothing has been
    // drafted/pushed for it yet — never silently destroy a partner's work
    // just because the model phrased things differently this time.
    const stale = existing.filter((e) => !seenIds.has(e.id) && !e.draftContent && e.status === 'pending');
    if (stale.length) await DocPrepAnnexure.destroy({ where: { id: stale.map((s) => s.id) } });

    session.status = 'done';
    session.errorMessage = null;
    await session.save();

    // AI Library matching — one Ollama call per annexure that has no
    // prescribed format (those need a real supporting document, not a
    // fillable template), judged against this partner's own Library files.
    matchLibraryForAnnexures(userId, bidNumber).catch((e) => console.error('matchLibraryForAnnexures error:', e));

    const annexures = await DocPrepAnnexure.findAll({ where: { userId, bidNumber }, order: [['sortOrder', 'ASC'], ['id', 'ASC']] });
    res.json({ success: true, data: { ...sessionForApi(session), annexures: annexures.map(annexureForApi) } });
  } catch (err) {
    console.error('analyzeDocPrep error:', err);
    const session = await getOrCreateSession(userId, bidNumber);
    session.status = 'error';
    session.errorMessage = err.message;
    await session.save();
    res.status(500).json({ success: false, message: err.message || 'Analysis failed — is Ollama running with a model pulled?' });
  }
};

const DRIVE_MATCH_PROMPT = `You are matching a company's document library to a tender requirement. The tender requires a document for which no fillable template exists — a ready-made supporting document from the library archive is needed instead.
Only match if genuinely relevant — most requirements have nothing suitable in the archive.
Output ONLY this JSON: {"matched": true, "id": 12, "reason": "one short sentence"} or {"matched": false, "id": null, "reason": ""}`;

// Runs after every analyze — judged purely by the model, not fuzzy string
// matching, same as the original's AI Drive matching (one call per
// unmatched annexure, not batched/cached beyond this annexure row).
async function matchLibraryForAnnexures(userId, bidNumber) {
  const [annexures, libraryFiles] = await Promise.all([
    DocPrepAnnexure.findAll({ where: { userId, bidNumber, hasPrescribedFormat: false, importedDocumentId: null } }),
    LibraryItem.findAll({ where: { ownerUserId: userId, type: 'file' }, limit: 50, order: [['updatedAt', 'DESC']] }),
  ]);
  if (!annexures.length || !libraryFiles.length) return;

  const catalogue = libraryFiles.map((f) => ({ id: f.id, name: f.name }));
  await Promise.all(annexures.map(async (ann) => {
    try {
      const userMsg = `Tender requirement:\nTitle: ${ann.title}\nType: ${ann.type}\nReference: ${ann.annexureRef || ''}\n\nAvailable library documents:\n${JSON.stringify(catalogue)}`;
      const raw = await ollamaChat(DRIVE_MATCH_PROMPT, userMsg, { numPredict: 200 });
      const result = parseJsonResponse(raw);
      if (result?.matched && result.id) {
        ann.libraryMatchItemId = result.id;
        ann.libraryMatchReason = result.reason || null;
        await ann.save();
      }
    } catch (e) { /* best-effort — one failed match shouldn't block the others */ }
  }));
}

// Asks for clean semantic HTML (not markdown, not a styled template) so the
// result can be dropped straight into the TipTap rich-text editor on the
// frontend — same "edit it like a Word document" experience as the
// Letter Generate feature, reusing its own editor component.
const DRAFT_SYSTEM_PROMPT = `You are drafting a formal tender-support document on behalf of a bidding company for submission with a GeM bid. Write complete, professional, ready-to-use document content (not a template with blanks) based on the company and tender details given.
Output ONLY clean semantic HTML for the document body: a centered bold <h2> title line, <p> paragraphs, and a real <table> with <tr>/<td> if the document calls for one (e.g. a schedule of items). No markdown, no <html>/<head>/<body> wrapper tags, no commentary — just the inner HTML content, starting directly with the title heading.`;


// Strips a markdown code fence or stray <html>/<body> wrapper the model
// sometimes adds despite instructions, and falls back to wrapping plain
// text in <p> tags if the model ignored the HTML instruction entirely.
function cleanDraftHtml(raw) {
  let html = raw.trim().replace(/^```(?:html)?\n?/i, '').replace(/```$/i, '').trim();
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (bodyMatch) html = bodyMatch[1].trim();
  html = html.replace(/<\/?(?:html|head|body)[^>]*>/gi, '').trim();
  if (!/<[a-z][\s\S]*>/i.test(html)) {
    html = html.split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
  }
  return html;
}

const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Deterministic, ZERO-paraphrase conversion of the bid document's own
// extracted text (annexure.sourceText) into HTML — no LLM involved in
// producing the wording at all, so the output is guaranteed
// character-for-character identical to the tender's own document,
// tables included. Replaces an earlier LLM-based "reproduce the format"
// approach that, even heavily constrained, still occasionally paraphrased
// or dropped a clause — unacceptable for a document going into an actual
// bid submission.
function sourceTextToHtml(sourceText) {
  const lines = sourceText.split('\n');
  const tabby = (l) => (l.match(/\t/g) || []).length >= 2;
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    // A genuine table is 2+ CONSECUTIVE tab-aligned lines — pdf-parse also
    // inserts stray tabs for ordinary multi-space indentation inside plain
    // sentences, so a single isolated tabby line is treated as prose
    // instead of folded into a misleading one-row "table" that fragments
    // the sentence around it.
    if (tabby(line) && i + 1 < lines.length && tabby(lines[i + 1])) {
      const rows = [];
      while (i < lines.length && tabby(lines[i])) {
        rows.push(lines[i].split('\t').map((c) => c.trim()).filter(Boolean));
        i++;
      }
      blocks.push({ type: 'table', rows });
      continue;
    }
    if (/^(ANNEXURE[\s\-–—]|BIDDING\s+SCHEDULE)/i.test(line.trim()) && line.trim().length < 80) {
      blocks.push({ type: 'heading', text: line.trim() });
      i++; continue;
    }
    const paraLines = [];
    while (i < lines.length && lines[i].trim() && !(tabby(lines[i]) && i + 1 < lines.length && tabby(lines[i + 1]))) {
      // A lone tabby line inside a paragraph run: keep its words but drop
      // the tab characters so they don't print as odd gaps.
      paraLines.push(lines[i].trim().replace(/\t+/g, ' '));
      i++;
    }
    blocks.push({ type: 'para', text: paraLines.join(' ') });
  }
  return blocks.map((b) => {
    if (b.type === 'heading') return `<h2 style="text-align:center;font-weight:bold;">${escHtml(b.text)}</h2>`;
    if (b.type === 'table') return `<table border="1" cellpadding="5" cellspacing="0">${b.rows.map((cells) => `<tr>${cells.map((c) => `<td>${escHtml(c)}</td>`).join('')}</tr>`).join('')}</table>`;
    return `<p>${escHtml(b.text)}</p>`;
  }).join('\n');
}

// Best-effort, cue-based blank filling — only replaces a run of
// underscores immediately after a recognizable label (never touches
// anything else in the text); anything it doesn't recognize is left as a
// blank underscore line rather than guessed, consistent with "never
// invent data" everywhere else in this feature.
function fillBlanksDeterministic(html, fields) {
  const rules = [
    [/Tender Enquiry\s*#\s*:?\s*_{2,}/gi, fields.tender_reference],
    [/M\/s\.\s*_{2,}/g, fields.company_name],
    [/\bGSTIN:?\s*_{2,}/gi, fields.gstin],
    [/\bDate:?-?\s*_{2,}/gi, fields.date],
    [/\bPlace:?\s*_{2,}/gi, fields.place],
  ];
  let out = html;
  for (const [re, value] of rules) {
    if (!value) continue;
    out = out.replace(re, (m) => m.replace(/_{2,}/, escHtml(value)));
  }
  return out;
}

// Flat key/value map pulled from this partner's own Setup Profile — same
// role as the original's static per-division company JSON files, just
// sourced from the real onboarded profile instead of a fixture.
function staticFieldMap(profile, bidNumber) {
  const companyInfo = profile?.companyInfo || {};
  const address = profile?.registeredAddress || {};
  const bank = profile?.bankDetails || {};
  return {
    company_name: companyInfo.legalName || companyInfo.tradeName || '',
    address: [address.line1, address.city, address.state, address.pincode].filter(Boolean).join(', '),
    gstin: companyInfo.gstin || '',
    pan: companyInfo.pan || '',
    cin: companyInfo.cin || '',
    authorized_signatory: companyInfo.authorizedPerson || '',
    designation: companyInfo.designation || '',
    contact_number: companyInfo.phone || '',
    email: companyInfo.email || '',
    bank_name: bank.bankName || '',
    bank_account: bank.accountNumber || '',
    bank_ifsc: bank.ifsc || '',
    tender_reference: bidNumber,
    date: new Date().toLocaleDateString('en-IN'),
    place: address.city || '',
  };
}

// @route POST /api/workspace/:bidNumber/doc-prep/:annexureId/draft
// Fixed [FILL:*] vocabulary — matches staticFieldMap's own keys exactly so
// extraction and substitution always agree on field names; "other_*" is the
// escape hatch for a concept with no fixed slot (e.g. other_scheme_name).
const FILL_VOCAB = 'company_name, address, gstin, pan, cin, authorized_signatory, designation, date, place, contact_number, email, bank_name, bank_account, bank_ifsc, tender_reference, tender_name, other_{descriptive_name}';

const VISION_TEMPLATE_PROMPT = `You are extracting ONE specific annexure/form exactly as it is printed in a tender document, from the page image(s) given. You will output real HTML reproducing its EXACT visual layout — this HTML becomes the bidder's actual submission, so fidelity matters more than anything else.

Rules, in priority order:
1. TABLES ARE HIGHEST PRIORITY. Any row/column content (checklist, schedule, rate table) MUST become a real <table> with <tr>/<td>/<th>, a 1px solid border on the table and every cell, and rowspan/colspan reproduced for merged header cells. Include every row/column from the source, including blank rows meant for the bidder to hand-fill. Never drop, merge, summarize or truncate a table.
2. Preserve every heading, numbered clause, and signature/stamp block character-for-character — no summarizing, no rewriting.
3. Reproduce the visual layout with these conventions:
   - title/heading line → <p style="text-align:center;font-weight:bold;">
   - a bold field label at the start of a line (Sub:, Ref:, To:) → <b>label</b> then the rest normal
   - an indented block (addressee / registered-office lines) → <p style="margin-left:2em;">
   - a right-aligned closing line (Yours faithfully,) → <p style="text-align:right;">
   - everything else → a plain <p> per line/paragraph
4. Every blank/underscore/fill-in space the bidder must complete becomes exactly:
   <span style="border-bottom:1px solid #000;padding:0 4px;">[FILL:field_name]</span>
   field_name MUST come from this fixed list only: ${FILL_VOCAB}
   Never merge two concepts into one field (e.g. never [FILL:company_name_and_address] — emit two separate spans back to back instead). Never put a [FILL:*] span inside a table cell that should stay blank for hand-writing — leave that <td></td> empty.
5. No other tags, styles, classes or markdown.
6. If the page(s) given do NOT contain this annexure's own full heading and body — only a cross-reference/mention of it in some other table or index — respond with exactly the single word NOT_FOUND and nothing else.

Wrap your actual HTML answer between the exact markers ===TEMPLATE_START=== and ===TEMPLATE_END=== with nothing else outside them.`;

// Vision-based verbatim extraction — renders the annexure's real pages as
// images and has a vision-capable model read the layout directly off them,
// which is what correctly preserves tables (text extraction flattens
// row/column structure irrecoverably). Returns null on NOT_FOUND, a too-
// short result, or any failure, so the caller can fall back to the
// deterministic text-based conversion.
async function extractVerbatimTemplateVision(session, annexure) {
  if (session.bidDocPath?.toLowerCase().slice(-4) !== '.pdf') return null;
  if (annexure.sourcePageStart == null) return null;
  try {
    const { renderPdfPageRangeBase64 } = require('./documentTenderController').helpers;
    // +1 page lookahead past the resolved range — annexures routinely
    // spill onto the next page (signature block, declaration tail).
    const images = await renderPdfPageRangeBase64(session.bidDocPath, annexure.sourcePageStart + 1, annexure.sourcePageEnd + 2);
    if (!images.length) return null;

    const visionModel = process.env.OLLAMA_VISION_MODEL || 'gemma4:31b-cloud';
    const userMsg = `Annexure reference: ${annexure.annexureRef || annexure.title}\nTitle: ${annexure.title}\n\nExtract this annexure's full format from the attached page image(s).`;
    // Long annexures (multi-row checklists/schedules) can run well past a
    // few thousand tokens of HTML — a tight budget here silently truncates
    // mid-table, which is worse than the slower call.
    const raw = await ollamaChat(VISION_TEMPLATE_PROMPT, userMsg, { json: false, numPredict: 7000, temperature: 0, model: visionModel, images });

    if (/^\s*NOT_FOUND\s*$/i.test(raw.trim())) return null;
    // Tolerate a missing/truncated END marker (ran out of token budget
    // mid-table) — still take whatever HTML came after START rather than
    // falling back to the raw string with the literal marker text in it.
    const marked = raw.match(/===TEMPLATE_START===([\s\S]*?)(?:===TEMPLATE_END===|$)/);
    const html = (marked ? marked[1] : raw.replace(/===TEMPLATE_(START|END)===/g, '')).trim();
    if (html.length < 400) return null; // near-empty — almost always a thin cross-reference mention, not the real thing
    return cleanDraftHtml(html);
  } catch (err) {
    console.error('extractVerbatimTemplateVision failed (falling back to text):', err.message);
    return null;
  }
}

// Deterministic, escape-safe substitution of every [FILL:key] token's text
// with the resolved value — unresolved keys are left exactly as-is (still
// visibly a fill-in blank) rather than guessed.
function substituteFillTokens(html, fields) {
  return html.replace(/\[FILL:([a-zA-Z0-9_]+)\]/g, (m, key) => {
    const val = fields[key];
    return val ? escHtml(val) : m;
  });
}

exports.draftAnnexure = async (req, res) => {
  try {
    const userId = req.user.id;
    const bidNumber = bidFromReq(req);
    const annexure = await DocPrepAnnexure.findOne({ where: { id: req.params.annexureId, userId, bidNumber } });
    if (!annexure) return res.status(404).json({ success: false, message: 'Annexure not found' });

    const [tender, profile, memoryRows] = await Promise.all([
      GemTender.findOne({ where: { bidNumber } }),
      PartnerProfile.findOne({ where: { userId } }),
      DocPrepFieldMemory.findAll({ where: { userId } }),
    ]);

    // Field memory reuse: whatever this partner typed for a prior
    // annexure/tender wins over the Setup Profile static value, which wins
    // over a blank — same precedence order as the original
    // (memory > statics > defaults).
    const statics = staticFieldMap(profile, bidNumber);
    const memory = Object.fromEntries(memoryRows.map((m) => [m.fieldKey, m.fieldValue]));
    const fields = { ...statics, ...memory };

    if (annexure.sourceText) {
      const allFields = { ...fields, tender_reference: tender?.bidNumber || bidNumber };

      // formatHtml is cached (lazy, computed once) — a later Regenerate
      // with the same or edited field values never needs to re-render
      // pages / re-call the vision model.
      if (!annexure.formatHtml) {
        const session = await getOrCreateSession(userId, bidNumber);
        const visionHtml = await extractVerbatimTemplateVision(session, annexure);
        // Vision extraction (reads the real page image — preserves tables
        // and exact layout) is preferred; deterministic text conversion
        // (verbatim wording, cruder layout) is the fallback when vision is
        // unavailable, fails, or only finds a thin cross-reference.
        annexure.formatHtml = visionHtml || sourceTextToHtml(annexure.sourceText);
      }

      annexure.draftContent = /\[FILL:/.test(annexure.formatHtml)
        ? substituteFillTokens(annexure.formatHtml, allFields)
        : fillBlanksDeterministic(annexure.formatHtml, allFields);
      annexure.status = 'drafted';
      await annexure.save();
      return res.json({ success: true, data: annexureForApi(annexure) });
    }

    // No real source page was found for this one (free-form discovery, or
    // an index entry with no resolvable page) — compose it with the AI,
    // same as before.
    const userMsg = `Document to draft: ${annexure.title}${annexure.annexureRef ? ` (${annexure.annexureRef})` : ''}
Document type: ${annexure.type}

Company: ${fields.company_name || 'The Bidder'}
Company Address: ${fields.address}
GSTIN: ${fields.gstin}
Authorized Signatory: ${fields.authorized_signatory}
Tender: ${tender?.bidNumber || bidNumber} — ${tender?.items || ''}
Buyer Department: ${tender?.department || ''}
Date: ${fields.date}
Place: ${fields.place}`;

    // Measured ~24 tok/s on this machine's CPU-bound qwen2.5:1.5b — 4096
    // tokens routinely blew past ollamaChat's 5-minute-per-attempt abort
    // under any concurrent load (dev servers, etc). 1500 tokens (~1000+
    // words) is comfortably enough for a one-page formal annexure/letter
    // and finishes in well under a minute.
    const raw = await ollamaChat(DRAFT_SYSTEM_PROMPT, userMsg, { json: false, numPredict: 1500 });
    annexure.draftContent = cleanDraftHtml(raw);
    annexure.status = 'drafted';
    await annexure.save();

    res.json({ success: true, data: annexureForApi(annexure) });
  } catch (err) {
    console.error('draftAnnexure error:', err);
    res.status(500).json({ success: false, message: err.message || 'Drafting failed — is Ollama running with a model pulled?' });
  }
};

const REVISE_SYSTEM_PROMPT = `You are revising a formal tender-support document's HTML content per the user's instruction. Apply ONLY the requested change — keep everything else in the document exactly as-is. Output ONLY the revised HTML (same rules as before: h2/p/table, no markdown, no <html>/<body> wrapper, no commentary).`;

// @route POST /api/workspace/:bidNumber/doc-prep/:annexureId/revise
// "AI Chat" in the annexure editor — applies one free-text instruction to
// the current draft and returns the revised HTML; the frontend decides
// whether/when to save it (same pattern as the Letter Generate editor's
// own revise-with-AI chat).
exports.reviseAnnexure = async (req, res) => {
  try {
    const { instruction, html } = req.body;
    if (!instruction?.trim()) return res.status(400).json({ success: false, message: 'Tell the AI what to change' });
    const annexure = await DocPrepAnnexure.findOne({ where: { id: req.params.annexureId, userId: req.user.id, bidNumber: bidFromReq(req) } });
    if (!annexure) return res.status(404).json({ success: false, message: 'Annexure not found' });

    const currentHtml = html || annexure.draftContent || '';
    const userMsg = `Current document HTML:\n${currentHtml.slice(0, 8000)}\n\nInstruction: ${instruction.trim()}`;
    const raw = await ollamaChat(REVISE_SYSTEM_PROMPT, userMsg, { json: false, numPredict: 1500 });
    const revised = cleanDraftHtml(raw);
    annexure.draftContent = revised;
    await annexure.save();

    res.json({ success: true, data: annexureForApi(annexure) });
  } catch (err) {
    console.error('reviseAnnexure error:', err);
    res.status(500).json({ success: false, message: err.message || 'Revision failed — is Ollama running with a model pulled?' });
  }
};

// @route PATCH /api/workspace/:bidNumber/doc-prep/:annexureId
// Covers both status/content edits and the user's own corrections to the
// AI's classification (ref/title/doc_group/stamp requirement) — the
// original exposes these as two endpoints, merged here since both are
// "edit this row".
exports.updateAnnexureStatus = async (req, res) => {
  try {
    const annexure = await DocPrepAnnexure.findOne({ where: { id: req.params.annexureId, userId: req.user.id, bidNumber: bidFromReq(req) } });
    if (!annexure) return res.status(404).json({ success: false, message: 'Annexure not found' });
    const { status, draftContent, annexureRef, title, docGroup, requiresStampPaper } = req.body;
    if (status) annexure.status = status;
    if (draftContent !== undefined) annexure.draftContent = draftContent;
    if (annexureRef !== undefined) annexure.annexureRef = annexureRef;
    if (title !== undefined) annexure.title = title;
    if (docGroup) annexure.docGroup = docGroup;
    if (requiresStampPaper !== undefined) {
      annexure.requiresStampPaper = requiresStampPaper;
      if (requiresStampPaper && !annexure.stampStatus) annexure.stampStatus = 'pending';
    }
    await annexure.save();
    res.json({ success: true, data: annexureForApi(annexure) });
  } catch (err) {
    console.error('updateAnnexureStatus error:', err);
    res.status(500).json({ success: false, message: 'Failed to update annexure' });
  }
};

// @route DELETE /api/workspace/:bidNumber/doc-prep/:annexureId
exports.deleteAnnexure = async (req, res) => {
  try {
    const annexure = await DocPrepAnnexure.findOne({ where: { id: req.params.annexureId, userId: req.user.id, bidNumber: bidFromReq(req) } });
    if (!annexure) return res.status(404).json({ success: false, message: 'Annexure not found' });
    if (annexure.importedDocumentId) {
      const doc = await WorkspaceDocument.findByPk(annexure.importedDocumentId);
      if (doc) { if (fs.existsSync(doc.filePath)) fs.unlink(doc.filePath, () => {}); await doc.destroy(); }
    }
    await annexure.destroy();
    res.json({ success: true });
  } catch (err) {
    console.error('deleteAnnexure error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete annexure' });
  }
};

// @route POST /api/workspace/:bidNumber/doc-prep/:annexureId/push-to-mydocs
// Pushes a drafted annexure into My Docs so it can be merged with other
// drafts + hand-written notes into the final submission bundle. Re-pushing
// the same annexure (after re-drafting it) updates the existing My Doc
// instead of creating a duplicate — the normalized version of the
// original's "replace, don't stack" rule for this push path.
// My Docs is a plain-text notes editor (WorkspaceMyDoc.content), while
// annexure drafts are now rich HTML for the TipTap editor — converts one to
// the other so a pushed annexure reads cleanly there instead of showing raw
// markup. Good-enough fidelity: paragraph/heading text on its own line,
// table rows as pipe-separated cells, nothing fancier.
function htmlToPlainText(html) {
  return html
    .replace(/<tr[^>]*>/gi, '\n')
    .replace(/<\/t[dh]>\s*<t[dh][^>]*>/gi, ' | ')
    .replace(/<\/(p|h[1-6]|div|li)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

exports.pushAnnexureToMyDocs = async (req, res) => {
  try {
    const userId = req.user.id;
    const bidNumber = bidFromReq(req);
    const annexure = await DocPrepAnnexure.findOne({ where: { id: req.params.annexureId, userId, bidNumber } });
    if (!annexure) return res.status(404).json({ success: false, message: 'Annexure not found' });
    if (!annexure.draftContent) return res.status(400).json({ success: false, message: 'Draft this annexure before pushing it to My Docs' });

    const plainContent = htmlToPlainText(annexure.draftContent);
    let myDoc = await WorkspaceMyDoc.findOne({ where: { userId, bidNumber, sourceAnnexureId: String(annexure.id) } });
    if (myDoc) {
      myDoc.title = annexure.title;
      myDoc.content = plainContent;
      await myDoc.save();
    } else {
      myDoc = await WorkspaceMyDoc.create({
        userId, bidNumber, title: annexure.title, content: plainContent, sourceAnnexureId: String(annexure.id),
      });
    }

    annexure.status = 'pushed';
    await annexure.save();

    res.json({ success: true, data: myDoc.toJSON(), annexure: annexureForApi(annexure) });
  } catch (err) {
    console.error('pushAnnexureToMyDocs error:', err);
    res.status(500).json({ success: false, message: 'Failed to push to My Docs' });
  }
};

// @route GET /api/workspace/:bidNumber/doc-prep/:annexureId/export
// Ships the draft as a .doc — Word opens an HTML payload served with a
// msword content-type just fine, which avoids pulling in a docx-generation
// dependency for what's still an early version of this feature.
exports.exportAnnexure = async (req, res) => {
  try {
    const bidNumber = bidFromReq(req);
    const annexure = await DocPrepAnnexure.findOne({ where: { id: req.params.annexureId, userId: req.user.id, bidNumber } });
    if (!annexure?.draftContent) return res.status(404).json({ success: false, message: 'No draft available to export' });

    // Same letterhead-by-default rule as Download/Share — header, footer,
    // and a forced signature block when this tender's division is known.
    const { compose } = require('../utils/letterheads');
    const division = await resolveTenderDivision(bidNumber);
    const c = compose(ensureClosingForLetterhead(annexure.draftContent), division);
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:Calibri,sans-serif;} table{border-collapse:collapse;width:100%;} td,th{border:1px solid #888;padding:5px 8px;}</style></head><body>${c.header}${c.body}${c.signoff}${c.leftover}${c.footer}</body></html>`;
    res.setHeader('Content-Type', 'application/msword');
    res.setHeader('Content-Disposition', `attachment; filename="${annexure.title.replace(/[^a-z0-9]/gi, '_')}.doc"`);
    res.send(html);
  } catch (err) {
    console.error('exportAnnexure error:', err);
    res.status(500).json({ success: false, message: 'Export failed' });
  }
};

// Looks up this tender's own division (Endo/Diagno — set on partner-side
// classification, GemTender.dept / OpenTenderDetail.dept) so a downloaded
// annexure carries the SAME letterhead/signature/footer pipeline the Dealer
// Authorization Letter and Letter Generate features already use — not a
// second implementation of it.
async function resolveTenderDivision(bidNumber) {
  const tender = await GemTender.findOne({ where: { bidNumber }, attributes: ['dept'] });
  if (tender?.dept) return tender.dept;
  const openTender = await OpenTenderDetail.findOne({ where: { tenderId: bidNumber }, attributes: ['dept'] });
  return openTender?.dept || null;
}

// utils/letterheads.js only renders the signature/stamp block when the
// content itself already ends in a "Yours faithfully,"-style closing line
// (it was built for real correspondence letters, where that's a given).
// Annexures almost never phrase their own closing that way, so without
// this, a download would get the letterhead's header/footer but silently
// skip the signature — every exported annexure should carry the full
// letterhead (header, footer, signature+stamp) by default, so a closing
// line is appended here whenever the draft doesn't already have one, which
// makes compose()'s own existing signoff detection fire as normal.
const CLOSING_RE = /yours\s+(faithfully|sincerely|truly)/i;
function ensureClosingForLetterhead(html) {
  if (CLOSING_RE.test(html.replace(/<[^>]+>/g, ' '))) return html;
  return `${html}<p>Yours faithfully,</p>`;
}

// @route GET /api/workspace/:bidNumber/doc-prep/:annexureId/download?format=pdf|docx
// A proper Word or PDF download — unlike exportAnnexure's quick "HTML served
// as .doc" shortcut, this is real DOCX (html-to-docx) or a real PDF
// (pdfkit), and — by default, for every annexure, every time — carries the
// tender's division letterhead: logo/header, footer, AND the signature +
// stamp block (forced via ensureClosingForLetterhead even when the draft's
// own wording has no natural closing line), via the exact same
// utils/letterheads.js + utils/letterPdf.js pipeline the Dealer
// Authorization Letter uses.
exports.downloadAnnexure = async (req, res) => {
  try {
    const bidNumber = bidFromReq(req);
    const annexure = await DocPrepAnnexure.findOne({ where: { id: req.params.annexureId, userId: req.user.id, bidNumber } });
    if (!annexure?.draftContent) return res.status(404).json({ success: false, message: 'No draft available to download' });

    const format = req.query.format === 'docx' ? 'docx' : 'pdf';
    // ?plain=1 — no letterhead/signature at all: used when this content is
    // being spliced back into an existing merged document's own page
    // range as raw content, not exported as a fresh standalone letter
    // (see My Docs' page-editor "Update Page in Merge Doc").
    const plain = req.query.plain === '1';
    const division = plain ? null : await resolveTenderDivision(bidNumber);
    const filename = annexure.title.replace(/[^a-z0-9]/gi, '_');
    const content = plain ? annexure.draftContent : ensureClosingForLetterhead(annexure.draftContent);

    if (format === 'pdf') {
      const { renderPdf } = require('../utils/letterPdf');
      const buf = await renderPdf(content, annexure.title, division);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
      return res.send(buf);
    }

    const HTMLtoDOCX = require('html-to-docx');
    const { composeFull } = require('../utils/letterheads');
    const full = composeFull(content, division);
    const buf = await HTMLtoDOCX(full.body, full.header || null, {
      margins: { top: full.header ? 1900 : 1440, right: 1440, bottom: full.footer ? 1900 : 1440, left: 1440, gutter: 0, header: 500, footer: 300 },
      font: 'Calibri', fontSize: 22,
      table: { row: { cantSplit: true } }, header: !!full.header, footer: !!full.footer,
    }, full.footer || null);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.docx"`);
    res.send(buf);
  } catch (err) {
    console.error('downloadAnnexure error:', err);
    res.status(500).json({ success: false, message: 'Download failed' });
  }
};

// @route POST /api/workspace/:bidNumber/doc-prep/:annexureId/share
// Emails the current draft as a .doc attachment — same HTML-as-.doc
// approach as exportAnnexure, just mailed instead of downloaded.
exports.shareAnnexure = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email?.trim()) return res.status(400).json({ success: false, message: 'Recipient email is required' });
    if (!isMailConfigured()) return res.status(503).json({ success: false, message: 'Email sending is not configured on this server.' });

    const bidNumber = bidFromReq(req);
    const annexure = await DocPrepAnnexure.findOne({ where: { id: req.params.annexureId, userId: req.user.id, bidNumber } });
    if (!annexure?.draftContent) return res.status(404).json({ success: false, message: 'No draft available to share' });

    // Same real letterhead-branded PDF as the Download button, not the old
    // plain-HTML .doc — every exported/shared annexure should carry the
    // tender's letterhead, signature and footer by default.
    const { renderPdf } = require('../utils/letterPdf');
    const division = await resolveTenderDivision(bidNumber);
    const buf = await renderPdf(ensureClosingForLetterhead(annexure.draftContent), annexure.title, division);
    const filename = `${annexure.title.replace(/[^a-z0-9]/gi, '_')}.pdf`;
    await sendMail({
      to: email.trim(),
      subject: `${annexure.title} — ${bidNumber}`,
      text: `Attached: ${annexure.title} for tender ${bidNumber}.`,
      attachments: [{ filename, content: buf, contentType: 'application/pdf' }],
    });
    res.json({ success: true });
  } catch (err) {
    console.error('shareAnnexure error:', err);
    res.status(500).json({ success: false, message: 'Failed to send email' });
  }
};

const RECHECK_SYSTEM_PROMPT = `You are re-verifying one specific document requirement against a tender's bid document text. Confirm or correct its classification based on what the text actually says now.
Output ONLY this JSON: {"annexure_ref":"...","title":"...","type":"affidavit|declaration|undertaking|authorization|agreement|checklist|financial|technical|sample_submission|other","category":"letter|certificate","dept_tag":"financial|tender_admin|technical|legal|hr|other","doc_group":"annexure|license|certificate","mandatory":true,"has_prescribed_format":true}`;

// @route POST /api/workspace/:bidNumber/doc-prep/:annexureId/recheck
// Targeted single-annexure re-verification against the bid document's own
// text — unlike Re-analyze (which re-runs discovery for the WHOLE tender
// and can add/remove annexures), this only re-confirms/corrects THIS one
// annexure's own classification fields, leaving its draft content and
// every other annexure untouched.
exports.recheckAnnexure = async (req, res) => {
  try {
    const userId = req.user.id;
    const bidNumber = bidFromReq(req);
    const annexure = await DocPrepAnnexure.findOne({ where: { id: req.params.annexureId, userId, bidNumber } });
    if (!annexure) return res.status(404).json({ success: false, message: 'Annexure not found' });

    const session = await getOrCreateSession(userId, bidNumber);
    let bidDocText = '';
    if (session.bidDocPath && fs.existsSync(session.bidDocPath)) {
      try {
        const { extractText } = require('./documentTenderController').helpers;
        bidDocText = (await extractText(session.bidDocPath, session.bidDocName || session.bidDocPath) || '').trim().slice(0, 8000);
      } catch (e) { /* fall through to current fields only */ }
    }

    const userMsg = `Current record:\nReference: ${annexure.annexureRef || ''}\nTitle: ${annexure.title}\nType: ${annexure.type}\n\nBid document text:\n${bidDocText || '(not available — keep the current record as-is)'}`;
    const raw = await ollamaChat(RECHECK_SYSTEM_PROMPT, userMsg, { numPredict: 400 });
    const result = parseJsonResponse(raw);

    const ENUM_TYPE = ['affidavit', 'declaration', 'undertaking', 'authorization', 'agreement', 'checklist', 'financial', 'technical', 'sample_submission', 'tender_checklist', 'other'];
    const ENUM_DEPT = ['financial', 'tender_admin', 'technical', 'legal', 'hr', 'other'];
    const ENUM_GROUP = ['annexure', 'license', 'certificate'];
    if (result?.title) annexure.title = result.title;
    if (result?.annexure_ref) annexure.annexureRef = result.annexure_ref;
    if (ENUM_TYPE.includes(result?.type)) annexure.type = result.type;
    if (result?.category === 'certificate' || result?.category === 'letter') annexure.category = result.category;
    if (ENUM_DEPT.includes(result?.dept_tag)) annexure.deptTag = result.dept_tag;
    if (ENUM_GROUP.includes(result?.doc_group)) annexure.docGroup = result.doc_group;
    if (typeof result?.mandatory === 'boolean') annexure.mandatory = result.mandatory;
    if (typeof result?.has_prescribed_format === 'boolean') annexure.hasPrescribedFormat = result.has_prescribed_format;
    await annexure.save();

    res.json({ success: true, data: annexureForApi(annexure) });
  } catch (err) {
    console.error('recheckAnnexure error:', err);
    res.status(500).json({ success: false, message: 'Recheck failed' });
  }
};

// @route POST /api/workspace/:bidNumber/doc-prep/annexure
// "New Document" in the Annexures list — a blank custom entry (not from
// discovery) the user writes freely in the Word-style editor, with its own
// AI chat. Lands in the "Other Declaration Documents" group by default
// since it isn't a numbered format from the tender; the user can re-group
// it from the card like any other annexure.
exports.createCustomAnnexure = async (req, res) => {
  try {
    const userId = req.user.id;
    const bidNumber = bidFromReq(req);
    const count = await DocPrepAnnexure.count({ where: { userId, bidNumber } });
    const annexure = await DocPrepAnnexure.create({
      userId, bidNumber, title: (req.body.title || 'Untitled Document').trim() || 'Untitled Document',
      docGroup: 'certificate', type: 'other', category: 'letter', deptTag: 'other',
      mandatory: false, hasPrescribedFormat: false, status: 'pending', sortOrder: count,
    });
    res.json({ success: true, data: annexureForApi(annexure) });
  } catch (err) {
    console.error('createCustomAnnexure error:', err);
    res.status(500).json({ success: false, message: 'Failed to create document' });
  }
};

// @route POST /api/workspace/:bidNumber/doc-prep/annexure/upload
// "Upload" in the Annexures list, computer source — creates a brand-new
// annexure entry already carrying the uploaded file (status 'pushed'),
// instead of requiring an existing row to attach to.
exports.uploadNewAnnexureDocument = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    const userId = req.user.id;
    const bidNumber = bidFromReq(req);
    const doc = await WorkspaceDocument.create({
      userId, bidNumber, name: req.file.originalname, filePath: req.file.path, fileSize: req.file.size, mimeType: req.file.mimetype,
    });
    const count = await DocPrepAnnexure.count({ where: { userId, bidNumber } });
    const annexure = await DocPrepAnnexure.create({
      userId, bidNumber, title: req.file.originalname.replace(/\.[^.]+$/, ''),
      docGroup: 'certificate', type: 'other', category: 'letter', deptTag: 'other',
      mandatory: false, hasPrescribedFormat: false, status: 'pushed', importedDocumentId: doc.id, sortOrder: count,
    });
    res.json({ success: true, data: { document: doc.toJSON(), annexure: annexureForApi(annexure) } });
  } catch (err) {
    console.error('uploadNewAnnexureDocument error:', err);
    res.status(500).json({ success: false, message: 'Upload failed' });
  }
};

// @route POST /api/workspace/:bidNumber/doc-prep/annexure/import-library
// Same as above, library source — body: { libraryItemId }.
exports.importNewAnnexureFromLibrary = async (req, res) => {
  try {
    const userId = req.user.id;
    const bidNumber = bidFromReq(req);
    const libItem = await LibraryItem.findOne({ where: { id: req.body.libraryItemId, ownerUserId: userId, type: 'file' } });
    if (!libItem || !libItem.filePath || !fs.existsSync(libItem.filePath)) {
      return res.status(404).json({ success: false, message: 'Library file not found' });
    }
    const uploadDir = path.join(process.env.UPLOAD_DIR || 'uploads', 'workspace');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    const destPath = path.join(uploadDir, `libimport-${Date.now()}-${path.basename(libItem.filePath)}`);
    fs.copyFileSync(libItem.filePath, destPath);
    const doc = await WorkspaceDocument.create({
      userId, bidNumber, name: libItem.name, filePath: destPath, fileSize: libItem.fileSize, mimeType: libItem.mimeType,
    });
    const count = await DocPrepAnnexure.count({ where: { userId, bidNumber } });
    const annexure = await DocPrepAnnexure.create({
      userId, bidNumber, title: libItem.name.replace(/\.[^.]+$/, ''),
      docGroup: 'certificate', type: 'other', category: 'letter', deptTag: 'other',
      mandatory: false, hasPrescribedFormat: false, status: 'pushed', importedDocumentId: doc.id, sortOrder: count,
    });
    res.json({ success: true, data: { document: doc.toJSON(), annexure: annexureForApi(annexure) } });
  } catch (err) {
    console.error('importNewAnnexureFromLibrary error:', err);
    res.status(500).json({ success: false, message: 'Failed to import from library' });
  }
};

// ---- Doc Prep: Library interaction ----

// @route GET /api/workspace/:bidNumber/doc-prep/library-search?q=
// Flat search over this partner's own Library files, for the "Import from
// Library" picker — a simpler stand-in for the original's folder-tree
// breadcrumb browser, since B2G's Library is already small per partner.
exports.searchDocPrepLibrary = async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const where = { ownerUserId: req.user.id, type: 'file' };
    if (q) where.name = { [Op.like]: `%${q}%` };
    const items = await LibraryItem.findAll({ where, order: [['updatedAt', 'DESC']], limit: 100 });
    res.json({ success: true, data: items.map((i) => i.toJSON()) });
  } catch (err) {
    console.error('searchDocPrepLibrary error:', err);
    res.status(500).json({ success: false, message: 'Failed to search library' });
  }
};

// @route POST /api/workspace/:bidNumber/doc-prep/:annexureId/import-library
// Copies a Library file into this tender's Documents (never references the
// original — deleting the library copy later can't break the tender), and
// replaces (not stacks) any file already imported for this annexure.
exports.importLibraryForAnnexure = async (req, res) => {
  try {
    const userId = req.user.id;
    const bidNumber = bidFromReq(req);
    const annexure = await DocPrepAnnexure.findOne({ where: { id: req.params.annexureId, userId, bidNumber } });
    if (!annexure) return res.status(404).json({ success: false, message: 'Annexure not found' });

    const libItem = await LibraryItem.findOne({ where: { id: req.body.libraryItemId, ownerUserId: userId, type: 'file' } });
    if (!libItem || !libItem.filePath || !fs.existsSync(libItem.filePath)) {
      return res.status(404).json({ success: false, message: 'Library file not found' });
    }

    if (annexure.importedDocumentId) {
      const old = await WorkspaceDocument.findByPk(annexure.importedDocumentId);
      if (old) { if (fs.existsSync(old.filePath)) fs.unlink(old.filePath, () => {}); await old.destroy(); }
    }

    const uploadDir = path.join(process.env.UPLOAD_DIR || 'uploads', 'workspace');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    const destPath = path.join(uploadDir, `libimport-${Date.now()}-${path.basename(libItem.filePath)}`);
    fs.copyFileSync(libItem.filePath, destPath);

    const doc = await WorkspaceDocument.create({
      userId, bidNumber, name: libItem.name, filePath: destPath, fileSize: libItem.fileSize, mimeType: libItem.mimeType,
    });

    annexure.importedDocumentId = doc.id;
    annexure.status = 'pushed';
    await annexure.save();

    res.json({ success: true, data: { document: doc.toJSON(), annexure: annexureForApi(annexure) } });
  } catch (err) {
    console.error('importLibraryForAnnexure error:', err);
    res.status(500).json({ success: false, message: 'Failed to import from library' });
  }
};

// @route POST /api/workspace/:bidNumber/doc-prep/:annexureId/stamp-upload
// Signed stamp-paper scan upload for an affidavit-type annexure — only one
// signed copy is ever kept per annexure (replace, not stack).
exports.uploadStampCopy = async (req, res) => {
  try {
    const userId = req.user.id;
    const bidNumber = bidFromReq(req);
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    const annexure = await DocPrepAnnexure.findOne({ where: { id: req.params.annexureId, userId, bidNumber } });
    if (!annexure) return res.status(404).json({ success: false, message: 'Annexure not found' });

    if (annexure.stampDocumentId) {
      const old = await WorkspaceDocument.findByPk(annexure.stampDocumentId);
      if (old) { if (fs.existsSync(old.filePath)) fs.unlink(old.filePath, () => {}); await old.destroy(); }
    }

    const doc = await WorkspaceDocument.create({
      userId, bidNumber, name: req.file.originalname, filePath: req.file.path, fileSize: req.file.size, mimeType: req.file.mimetype,
    });
    annexure.stampDocumentId = doc.id;
    annexure.stampStatus = 'uploaded';
    await annexure.save();

    res.json({ success: true, data: { document: doc.toJSON(), annexure: annexureForApi(annexure) } });
  } catch (err) {
    console.error('uploadStampCopy error:', err);
    res.status(500).json({ success: false, message: 'Upload failed' });
  }
};

// ---- Doc Prep: Checklist ----

// @route GET /api/workspace/:bidNumber/doc-prep/checklist
exports.listChecklist = async (req, res) => {
  try {
    const rows = await DocPrepChecklistRow.findAll({ where: { userId: req.user.id, bidNumber: bidFromReq(req) }, order: [['sortOrder', 'ASC'], ['id', 'ASC']] });
    res.json({ success: true, data: rows.map((r) => r.toJSON()) });
  } catch (err) {
    console.error('listChecklist error:', err);
    res.status(500).json({ success: false, message: 'Failed to load checklist' });
  }
};

// @route POST /api/workspace/:bidNumber/doc-prep/checklist
exports.addChecklistRow = async (req, res) => {
  try {
    const userId = req.user.id;
    const bidNumber = bidFromReq(req);
    const count = await DocPrepChecklistRow.count({ where: { userId, bidNumber } });
    const row = await DocPrepChecklistRow.create({
      userId, bidNumber, section: req.body.section || 'B', details: req.body.details, documentType: req.body.documentType || null,
      source: 'manual', sortOrder: count,
    });
    res.json({ success: true, data: row.toJSON() });
  } catch (err) {
    console.error('addChecklistRow error:', err);
    res.status(500).json({ success: false, message: 'Failed to add row' });
  }
};

// @route POST /api/workspace/:bidNumber/doc-prep/checklist/sync-annexures
// Adds one checklist row per discovered annexure not already represented —
// does not touch rows the user already edited.
exports.syncChecklistFromAnnexures = async (req, res) => {
  try {
    const userId = req.user.id;
    const bidNumber = bidFromReq(req);
    const [annexures, rows] = await Promise.all([
      DocPrepAnnexure.findAll({ where: { userId, bidNumber } }),
      DocPrepChecklistRow.findAll({ where: { userId, bidNumber } }),
    ]);
    const already = new Set(rows.filter((r) => r.annexureId).map((r) => r.annexureId));
    let order = rows.length;
    const toCreate = annexures
      .filter((a) => !already.has(a.id))
      .map((a) => ({
        userId, bidNumber, annexureId: a.id, source: 'annexure',
        section: a.mandatory ? 'A' : 'B', details: a.title, documentType: a.type,
        sortOrder: order++,
      }));
    if (toCreate.length) await DocPrepChecklistRow.bulkCreate(toCreate);
    const all = await DocPrepChecklistRow.findAll({ where: { userId, bidNumber }, order: [['sortOrder', 'ASC'], ['id', 'ASC']] });
    res.json({ success: true, data: all.map((r) => r.toJSON()) });
  } catch (err) {
    console.error('syncChecklistFromAnnexures error:', err);
    res.status(500).json({ success: false, message: 'Failed to sync checklist' });
  }
};

// Shared recompute: matches each non-manual row against the partner's
// current Documents + My Docs pool (in the given order), assigns sequential
// page numbers (1 page per document — B2G doesn't page-count on upload),
// same two-tier matching as the original's recomputeChecklistRows
// (exact annexure link first, then fuzzy title overlap >= 0.4).
async function recomputeChecklist(userId, bidNumber, order) {
  const [rows, documents, myDocs] = await Promise.all([
    DocPrepChecklistRow.findAll({ where: { userId, bidNumber } }),
    WorkspaceDocument.findAll({ where: { userId, bidNumber } }),
    WorkspaceMyDoc.findAll({ where: { userId, bidNumber } }),
  ]);
  const pool = [
    ...documents.map((d) => ({ key: `doc_${d.id}`, name: d.name, pages: d.pages || 1 })),
    ...myDocs.map((d) => ({ key: `mydoc_${d.id}`, name: d.title, pages: 1 })),
  ];
  const ordered = order?.length ? order.map((k) => pool.find((p) => p.key === k)).filter(Boolean) : pool;
  for (const p of pool) if (!ordered.includes(p)) ordered.push(p);

  // Real page-range math, not a flat 1-page-per-doc assumption — a merged
  // My Docs bundle routinely has multi-page sources (annexures with real
  // tables, scanned certificates), so the Checklist's "page 14" answer has
  // to walk actual page counts, same as the final merge itself does.
  const ranges = new Map();
  let cursor = 1;
  for (const doc of ordered) { ranges.set(doc.key, { start: cursor, end: cursor + doc.pages - 1 }); cursor += doc.pages; }

  for (const row of rows) {
    if (row.matchMethod === 'manual') continue;
    let matchedKey = null; let method = null;
    if (row.annexureId) {
      const byAnnexure = documents.find((d) => d.id === row.matchedDocumentId);
      if (byAnnexure) { matchedKey = `doc_${byAnnexure.id}`; method = 'annexure'; }
    }
    if (!matchedKey) {
      let best = null; let bestScore = 0;
      for (const p of pool) {
        const score = fuzzyScore(row.details, p.name);
        if (score > bestScore) { bestScore = score; best = p; }
      }
      if (best && bestScore >= 0.4) { matchedKey = best.key; method = 'fuzzy'; }
    }
    if (matchedKey) {
      const [kind, id] = matchedKey.split('_');
      row.matchedDocumentId = kind === 'doc' ? Number(id) : row.matchedDocumentId;
      row.matchMethod = method;
      row.status = 'yes';
      const range = ranges.get(matchedKey);
      row.pageRange = range.start === range.end ? String(range.start) : `${range.start} - ${range.end}`;
    } else {
      row.matchMethod = null;
      row.status = 'no';
      row.pageRange = null;
    }
    await row.save();
  }
  return DocPrepChecklistRow.findAll({ where: { userId, bidNumber }, order: [['sortOrder', 'ASC'], ['id', 'ASC']] });
}

// @route POST /api/workspace/:bidNumber/doc-prep/checklist/recompute
// Called on every My Documents reorder, same trigger as the original.
exports.recomputeChecklistRows = async (req, res) => {
  try {
    const rows = await recomputeChecklist(req.user.id, bidFromReq(req), req.body.order);
    res.json({ success: true, data: rows.map((r) => r.toJSON()) });
  } catch (err) {
    console.error('recomputeChecklistRows error:', err);
    res.status(500).json({ success: false, message: 'Failed to recompute checklist' });
  }
};

// @route POST /api/workspace/:bidNumber/doc-prep/checklist/apply-page-map
// Lighter-weight than a full recompute — the caller (My Docs' merge/page
// editor) already knows exactly where everything landed after rebuilding
// a PDF, so this just applies that { docId, start, end }[] map directly to
// matching checklist rows instead of re-deriving page positions from
// scratch. Rows for a document id NOT present in the map (removed during
// an edit) are left exactly as they were, per the workflow spec.
exports.applyChecklistPageMap = async (req, res) => {
  try {
    const userId = req.user.id;
    const bidNumber = bidFromReq(req);
    const pageMap = Array.isArray(req.body.pageMap) ? req.body.pageMap : [];
    const byDocId = new Map(pageMap.map((m) => [Number(m.docId), m]));
    const rows = await DocPrepChecklistRow.findAll({ where: { userId, bidNumber } });
    for (const row of rows) {
      if (!row.matchedDocumentId || !byDocId.has(row.matchedDocumentId)) continue;
      const m = byDocId.get(row.matchedDocumentId);
      row.status = 'yes';
      row.pageRange = m.start === m.end ? String(m.start) : `${m.start} - ${m.end}`;
      await row.save();
    }
    const fresh = await DocPrepChecklistRow.findAll({ where: { userId, bidNumber }, order: [['sortOrder', 'ASC'], ['id', 'ASC']] });
    res.json({ success: true, data: fresh.map((r) => r.toJSON()) });
  } catch (err) {
    console.error('applyChecklistPageMap error:', err);
    res.status(500).json({ success: false, message: 'Failed to sync checklist' });
  }
};

// @route PATCH /api/workspace/:bidNumber/doc-prep/checklist/:rowId
// Setting matchedDocumentId manually pins the row (match_method:'manual')
// so future recomputes never override it unless that document is deleted.
exports.updateChecklistRow = async (req, res) => {
  try {
    const row = await DocPrepChecklistRow.findOne({ where: { id: req.params.rowId, userId: req.user.id, bidNumber: bidFromReq(req) } });
    if (!row) return res.status(404).json({ success: false, message: 'Row not found' });
    const { section, details, documentType, matchedDocumentId, status, pageRange } = req.body;
    if (section !== undefined) row.section = section;
    if (details !== undefined) row.details = details;
    if (documentType !== undefined) row.documentType = documentType;
    if (matchedDocumentId !== undefined) { row.matchedDocumentId = matchedDocumentId; row.matchMethod = 'manual'; row.status = matchedDocumentId ? 'yes' : 'no'; }
    if (status !== undefined) { row.status = status; row.matchMethod = 'manual'; }
    if (pageRange !== undefined) row.pageRange = pageRange;
    await row.save();
    res.json({ success: true, data: row.toJSON() });
  } catch (err) {
    console.error('updateChecklistRow error:', err);
    res.status(500).json({ success: false, message: 'Failed to update row' });
  }
};

// @route DELETE /api/workspace/:bidNumber/doc-prep/checklist/:rowId
exports.deleteChecklistRow = async (req, res) => {
  try {
    const deleted = await DocPrepChecklistRow.destroy({ where: { id: req.params.rowId, userId: req.user.id, bidNumber: bidFromReq(req) } });
    if (!deleted) return res.status(404).json({ success: false, message: 'Row not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('deleteChecklistRow error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete row' });
  }
};

// @route POST /api/workspace/:bidNumber/doc-prep/reset
// Hard reset — clears annexures, checklist, and the session itself (field
// memory deliberately survives: it's keyed per-partner, not per-tender, so
// it should keep helping fill future annexures even after this tender's
// Doc Prep is wiped).
exports.resetDocPrep = async (req, res) => {
  try {
    const userId = req.user.id;
    const bidNumber = bidFromReq(req);
    const session = await getOrCreateSession(userId, bidNumber);
    const annexures = await DocPrepAnnexure.findAll({ where: { userId, bidNumber } });
    for (const a of annexures) {
      if (a.importedDocumentId) { const d = await WorkspaceDocument.findByPk(a.importedDocumentId); if (d) { if (fs.existsSync(d.filePath)) fs.unlink(d.filePath, () => {}); await d.destroy(); } }
      if (a.stampDocumentId) { const d = await WorkspaceDocument.findByPk(a.stampDocumentId); if (d) { if (fs.existsSync(d.filePath)) fs.unlink(d.filePath, () => {}); await d.destroy(); } }
    }
    await DocPrepAnnexure.destroy({ where: { userId, bidNumber } });
    await DocPrepChecklistRow.destroy({ where: { userId, bidNumber } });
    session.status = 'idle';
    session.annexures = [];
    session.errorMessage = null;
    await session.save();
    res.json({ success: true, data: sessionForApi(session) });
  } catch (err) {
    console.error('resetDocPrep error:', err);
    res.status(500).json({ success: false, message: 'Reset failed' });
  }
};

// ---- Settings: team reference (Setup-Profile contacts) ----

exports.listTeam = async (req, res) => {
  try {
    const profile = await PartnerProfile.findOne({ where: { userId: req.user.id }, include: [{ model: PartnerContact, as: 'contacts' }] });
    res.json({ success: true, data: (profile?.contacts || []).map((c) => c.toJSON()) });
  } catch (err) {
    console.error('listTeam error:', err);
    res.status(500).json({ success: false, message: 'Failed to load team' });
  }
};
