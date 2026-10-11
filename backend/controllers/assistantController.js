const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { PDFParse } = require('pdf-parse');
const mammoth = require('mammoth');
const { ollamaChat, isOllamaAvailable } = require('../utils/ollamaClient');
const tenderController = require('./tenderController');
const queryController = require('./queryController');
const taskController = require('./taskController');
const teamRankController = require('./teamRankController');
const salesIncentiveController = require('./salesIncentiveController');
const { coach } = require('../utils/salesCoach');

// A sales login asking about their GP / AR / target / incentive.
const SALES_Q = /\b(gp|gross\s*profit|margin|ar|receivable|outstanding|collection|dues?|incentive|eligib\w*|target|achiev\w*|improve|low|high)\b/i;

// Without the AI model: just the coaching sections the question is about.
function focusCoaching(text, question) {
  const parts = text.split('\n\n');
  const pick = [];
  if (/\b(gp|gross\s*profit|margin|cost|price)\b/i.test(question)) pick.push(...parts.filter((p) => p.startsWith('GP ')));
  if (/\b(ar|receivable|outstanding|collect\w*|dues?|payment)\b/i.test(question)) pick.push(...parts.filter((p) => p.startsWith('AR ')));
  if (/\b(target|achiev\w*|sales)\b/i.test(question)) pick.push(...parts.filter((p) => p.startsWith('TARGET')));
  return [parts[0], ...(pick.length ? pick : parts.slice(1))].join('\n\n');
}

// Runs another controller's (req, res) handler and hands back its JSON body
// instead of writing an HTTP response — the same "borrow the real handler
// instead of re-deriving its numbers" trick trackerExport.js's collectRows
// uses for Excel exports, so the assistant's figures can never drift from
// what the same login sees on the actual dashboard/tracker pages.
function callHandler(handler, req) {
  return new Promise((resolve) => {
    const fakeRes = { status() { return this; }, json(payload) { resolve(payload); } };
    Promise.resolve(handler(req, fakeRes)).catch(() => resolve(null));
  });
}

// Pulls exactly what the user's own dashboard/trackers already show, live,
// right before answering — so "how many tenders are there" gets today's real
// count instead of an invented figure or a "go check this page" deflection.
async function getLiveStats(req) {
  const emptyQuery = { ...req, query: {} };
  const [dashboard, queries, tasks, team] = await Promise.all([
    callHandler(tenderController.getDashboardStats, req),
    callHandler(queryController.list, emptyQuery),
    callHandler(taskController.list, emptyQuery),
    req.user.userType === 'staff' ? Promise.resolve(null) : callHandler(teamRankController.rank, req),
  ]);
  const d = dashboard?.data;
  const lines = [];
  if (d) {
    lines.push(`Active/live tenders on the GeM feed right now: ${d.activeTenders} (closing within 7 days: ${d.closingSoon}).`);
    lines.push(`Manually uploaded (offline) tenders still open: ${d.openTenders}.`);
    lines.push(`Contracts on record (Diagno+Endo): ${d.contracts.count}, total value ₹${Math.round(d.contracts.count ? d.contracts.totalValue : 0).toLocaleString('en-IN')}.`);
    lines.push(`EMD currently locked across active tenders: ₹${Math.round(d.emdLocked).toLocaleString('en-IN')}.`);
    lines.push(`Distributors on record: ${d.distributors.total} (${d.distributors.active} active). Approved reseller/authorization partners for this org: ${d.resellersCount}.`);
    lines.push(`Support tickets (legacy system): ${d.supportTickets.total} total — ${d.supportTickets.open} open, ${d.supportTickets.inProgress} in progress, ${d.supportTickets.resolved} resolved, ${d.supportTickets.closed} closed.`);
  }
  if (queries?.stats) {
    const s = queries.stats;
    lines.push(`This organisation's own Query Management: ${s.total} total queries — ${s.open} open, ${s.inProgress} in progress, ${s.resolved} resolved, ${s.closed} closed, ${s.overdue} overdue, ${s.highPriority} high priority currently open.`);
  }
  if (tasks?.stats) {
    const s = tasks.stats;
    lines.push(`This organisation's own Task Management: ${s.total} total tasks — ${s.todo} to do, ${s.inProgress} in progress, ${s.completed} completed, ${s.cancelled} cancelled, ${s.overdue} overdue, ${s.dueSoon} due within 2 days.`);
  }
  if (team?.data?.length) {
    lines.push(`Team Ranking: ${team.total} active staff ranked, average score ${Math.round(team.data.reduce((sum, r) => sum + r.score, 0) / team.data.length)}, top performer: ${team.data[0].name} (${team.data[0].score}).`);
  }
  return lines.join('\n');
}

// The "B2G Assistant" — a single, always-available help chatbot (a floating
// widget on every page, not a navbar item — see GlobalAssistant.tsx) that
// covers the whole portal end to end: what a page does, where to find
// something, general GeM/tender/procurement questions, and reading whatever
// the user attaches (a tender PDF, a screenshot of an error, a scanned
// letter). History is the same shared ai_chat_sessions system every other AI
// chat in the app uses (feature 'assistant', no refId — one running
// conversation per login, 7-day life like the rest).

const UPLOAD_DIR = path.join(__dirname, '../uploads/assistant');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const upload = multer({ dest: UPLOAD_DIR, limits: { fileSize: 20 * 1024 * 1024 } });
exports.uploadMiddleware = upload.single('file');

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

// Grounds the model in exactly what this portal actually has, so it points
// people at real pages/features instead of inventing menu items — kept in
// sync with DashboardShell.tsx's nav by hand (there's no runtime introspection
// to drive this from, and the nav rarely changes).
const SYSTEM_PROMPT = `You are the B2G Assistant, the professional in-portal help assistant for Meril One's B2G partner portal (used by Meril's OEM divisions and their authorised Reseller/Distributor partners for GeM and open tenders).

Your job: answer any question about using this portal, procurement/GeM tender process questions, and help interpret documents or screenshots the user attaches. Be concise, professional, and warm — a knowledgeable colleague, not a script. Use short paragraphs or bullet points. Never invent specific data (tender numbers, amounts, contract details, dates) you were not given — if the user's question needs real data you don't have, tell them exactly which page in the portal to check.

The portal's modules, by nav section:
- Tenders: Tenders (live GeM/open tender feed), Offline Tender (manually upload a tender's documents), Participated Tender.
- Tracker: Tender Tracker, Representation Tracker (deviation representations), Authorization Tracker, Contract Tracker, Order Tracker (with late fines), Pricing Tracker, Agreement Tracker.
- Workdesk: Active Workspaces, Library, EMD Management (earnest money deposits / performance bank guarantees — track requested → submitted → refund due → refunded/forfeited), Agreement (AI-assisted letter drafting with company letterheads).
- Analytics: Company Profile, Compare Bidders.
- Order Management: Order Overview, GeM Contracts, Carting Dashboard.
- Sales & Invoices: Our Clients, Quotations, Invoices, Proforma Invoice, Payment Receipts, Pending Payments, Sales Order, Delivery Challan, Credit Note.
- Purchases: Purchases Hub, Our Vendors.
- Dealer Management (OEM side): Distributors, Distributor Mapping (geography/institute/department/equipment coverage map), Distributor Ranking (0-100 scored from real GeM track record), Distributor Recommendation (chat that suggests distributors), Best Reseller, View Authorization.
- Product Management (Reseller side): Our Products, Request Authorization, OEM Ranking (0-100 scored OEMs to request authorization from).
- Support: Query Management (raise/track/reply to queries within your own org, with categories, priority and status), Task Management (assign tasks to anyone in your org with due dates, attachments and email alerts), User Management (owner-only: approve/manage Sales/Zonal Manager/FLSP staff logins) with Team Ranking (owner-only: staff scored from their actual task/query activity).

If asked something outside the portal's scope entirely (unrelated general knowledge), you may still answer briefly and helpfully, but gently note it's outside what this portal tracks when relevant.

You will be given a "LIVE PORTAL DATA" block with real, current figures pulled from the database moments ago. When the user asks for a count, total, number, or status of something ("how many tenders", "how many open queries", "what's our EMD locked amount", etc.) and it appears in that block, answer directly with that number in one or two sentences — do NOT explain how to navigate to a page, do NOT describe steps to find it yourself, and do NOT tell them to export to Excel and count rows. Only give navigation help when they explicitly ask "how do I..." / "where is..." / "how do I find...". If the figure they want is not in the LIVE PORTAL DATA block, say plainly that you don't have that live figure in this conversation, rather than guessing.`;

async function extractFileText(file) {
  if (!file) return null;
  try {
    if (file.mimetype === 'application/pdf') {
      const buf = fs.readFileSync(file.path);
      const { text } = await new PDFParse({ data: buf }).getText();
      return { kind: 'pdf', text: (text || '').trim().slice(0, 8000) };
    }
    if (file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const { value } = await mammoth.extractRawText({ path: file.path });
      return { kind: 'docx', text: (value || '').slice(0, 8000) };
    }
    if (file.mimetype.startsWith('text/')) {
      return { kind: 'text', text: fs.readFileSync(file.path, 'utf8').slice(0, 8000) };
    }
  } catch (err) {
    console.error('assistant extractFileText error:', err.message);
    return { kind: 'error', text: null };
  }
  return null;
}

// @route POST /api/assistant/chat  multipart: message, history (JSON string), file?
exports.chat = async (req, res) => {
  const file = req.file;
  try {
    const message = String(req.body?.message || '').trim();
    if (!message && !file) return res.status(400).json({ success: false, message: 'Say something, or attach a file.' });

    let history = [];
    try { history = JSON.parse(req.body?.history || '[]').slice(-8); } catch (_) { history = []; }

    if (!(await isOllamaAvailable())) {
      // Model offline: a sales question still gets the worked-out answer.
      let coachText = '';
      try { const m = SALES_Q.test(message) ? await salesIncentiveController.metricsForRequest(req) : null; if (m) coachText = coach(m); } catch (_) { /* ignore */ }
      if (coachText) return res.json({ success: true, reply: `The AI model is offline right now, but here is what your own figures show:\n\n${focusCoaching(coachText, message)}`, usedAi: false, attachment: null });
      const reply = "I'm temporarily unable to reach the assistant model. Please try again in a moment — meanwhile, you can find most things under the left-hand navigation (Tenders, Tracker, Workdesk, Support and more), or raise a query in Support > Query Management and your team will follow up.";
      return res.json({ success: true, reply, usedAi: false, attachment: file ? { name: file.originalname, kind: 'unprocessed' } : null });
    }

    let userContent = message || '(no message — see attached file)';
    let attachmentMeta = null;
    const images = [];

    if (file) {
      if (IMAGE_TYPES.includes(file.mimetype)) {
        images.push(fs.readFileSync(file.path).toString('base64'));
        userContent += `\n\n[The user attached an image named "${file.originalname}". If you can see and read it, describe/answer based on it. If you cannot actually process images, say so plainly and ask the user to describe what's in it or paste any error text instead.]`;
        attachmentMeta = { name: file.originalname, kind: 'image' };
      } else {
        const extracted = await extractFileText(file);
        if (extracted?.text) {
          userContent += `\n\n[Attached ${extracted.kind.toUpperCase()} file "${file.originalname}" — extracted content below, may be partial:]\n${extracted.text}`;
          attachmentMeta = { name: file.originalname, kind: extracted.kind };
        } else {
          userContent += `\n\n[The user attached a file named "${file.originalname}" that could not be read as text (unsupported format or a scanned/image-only PDF). Acknowledge it and ask them to describe its contents or paste the relevant text.]`;
          attachmentMeta = { name: file.originalname, kind: 'unreadable' };
        }
      }
    }

    let liveStats = '';
    try { liveStats = await getLiveStats(req); } catch (err) { console.error('assistant getLiveStats error:', err.message); }
    // Sales logins: their real GP / AR / target figures with the reasons and fixes.
    let coaching = '';
    try { const m = await salesIncentiveController.metricsForRequest(req); if (m) coaching = coach(m); } catch (err) { console.error('assistant sales coach error:', err.message); }
    let systemPrompt = liveStats ? `${SYSTEM_PROMPT}\n\nLIVE PORTAL DATA (as of right now):\n${liveStats}` : SYSTEM_PROMPT;
    if (coaching) {
      systemPrompt += `\n\nSALES COACHING DATA for the person you are talking to (their own real figures, worked out moments ago):\n${coaching}\n\nWhen they ask why their GP is low, why their AR is high, how to reach their target, whether they are eligible for the incentive, or how to improve: answer from this block only. Lead with the main reason in one sentence, quote the real numbers and product / customer names from the block, then give the "How to improve" steps from the block as a short numbered list. Do not invent figures, products or customers that are not in the block. GP here is worked out from their OPIs (Diagnostics cost = DB price, Endo cost = GP Tracker cost); AR comes from invoices and payment receipts.`;
    }

    let reply;
    try {
      reply = await ollamaChat(systemPrompt, userContent, { json: false, temperature: 0.3, numPredict: 1200, history, images });
    } catch (err) {
      console.error('assistant ollamaChat error:', err.message);
      reply = '';
    }
    // The model couldn't answer a sales question: give the worked-out coaching directly.
    if (!reply && coaching && SALES_Q.test(message)) reply = `Here is what your figures show:\n\n${focusCoaching(coaching, message)}`;
    if (!reply) {
      reply = "I couldn't quite process that just now — could you try rephrasing, or try again in a moment? If this keeps happening, raise a query under Support > Query Management.";
    }

    res.json({ success: true, reply: reply.trim(), usedAi: true, attachment: attachmentMeta });
  } catch (err) {
    console.error('assistant chat error:', err);
    res.status(500).json({ success: false, message: 'The assistant ran into a problem. Please try again.' });
  } finally {
    if (file) fs.unlink(file.path, () => {});
  }
};
