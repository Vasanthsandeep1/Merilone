'use strict';
// Dealer Management > Distributor Recommendation — a chat box where a staff member
// describes what they need in plain words ("I need an authorised Endo-Surgery
// distributor near AIIMS Delhi who has actually supplied staplers") and gets back
// distributors picked from Distributor Ranking's own scoring (backend/controllers/
// distributorMapController.js's computeRanking) — never invented. The chat only
// turns the sentence into the same filters (state/city/institute/department/
// equipment/division/authorised) the Distributor Ranking page uses; the ranking
// itself, and every number shown, comes straight from the real distributor master
// and GeM contract data.
const { ollamaChat, parseJsonResponse } = require('../utils/ollamaClient');
const { computeRanking, constants, canonState } = require('./distributorMapController');

const { DEPARTMENTS, INDIA_STATES, INSTITUTE_FAMILIES } = constants;
const lc = (s) => String(s || '').trim().toLowerCase();

const EMPTY_FILTERS = { state: null, city: null, institute: null, department: null, equipment: null, division: null, authorisedOnly: null };

// ---- AI parsing: sentence + current filters -> the complete updated filter set ----
function buildParsePrompt(filters, message) {
  return {
    system: `You turn a staff member's request for a medical-equipment distributor into a structured search filter, for an Indian company (Meril).

Fields (use null for anything not mentioned or not being changed):
- state: an Indian state or union territory name (or null)
- city: a city or district name (or null)
- institute: a hospital/institute name or family — e.g. AIIMS, PGIMER, ESIC, CGHS, Medical College, District Hospital, Railway, Armed Forces, ICMR — or a specific hospital name (or null)
- department: exactly one of ${JSON.stringify(DEPARTMENTS)}, or null
- equipment: an equipment/product/category keyword, e.g. "stapler", "blood grouping reagent" (or null)
- division: one of "endo" (Endo-Surgery distributor), "micro" (Endo micro-distributor), "diagno" (Diagnostics) — only if the message clearly says which, else null
- authorisedOnly: true only if the user asks for an authorised/official distributor, else null
- reset: true only if the user asks to start over / clear everything

You are given the CURRENT filters already applied (from earlier in the conversation) and the user's newest message. Reply with the COMPLETE updated filter set as JSON only — carry over every field the new message doesn't change, unless reset is true (then every field becomes null). Do not invent a state/institute/equipment that was not said or implied.`,
    user: `CURRENT FILTERS: ${JSON.stringify(filters)}\n\nMESSAGE: ${message}`,
  };
}

// No-AI fallback: matches the message text against real state names and a few
// institute/keyword families, so the chat still works if the model is unavailable.
function heuristicParse(filters, message) {
  const m = lc(message);
  const isReset = /\b(start over|reset|clear (everything|filters)|forget (that|it))\b/.test(m);
  const next = isReset ? { ...EMPTY_FILTERS } : { ...filters };
  const stateHit = INDIA_STATES.find((s) => m.includes(lc(s)));
  if (stateHit) next.state = stateHit;
  const deptHit = DEPARTMENTS.find((d) => m.includes(lc(d)) || (d === 'Endo-Surgery' && /\bendo\b/.test(m)) || (d === 'Diagnostics' && /\bdiagno/.test(m)));
  if (deptHit) next.department = deptHit;
  const instHit = INSTITUTE_FAMILIES.find((f) => m.includes(lc(f.name)));
  if (instHit) next.institute = instHit.name;
  if (/\bauthoris|authoriz/.test(m)) next.authorisedOnly = true;
  const equipWords = m.match(/\b(stapler|trocar|reagent|analy[sz]er|catheter|clip|kit|suture|scope|guidewire|balloon|forceps|blood grouping|elisa|glucose|rapid test)\w*\b/g);
  if (equipWords && equipWords.length) next.equipment = equipWords[0];
  return next;
}

function sanitise(f) {
  const dept = DEPARTMENTS.includes(f.department) ? f.department : null;
  const state = f.state ? (INDIA_STATES.find((s) => canonState(s) === canonState(f.state)) || f.state) : null;
  return {
    state: state || null, city: f.city || null, institute: f.institute || null, department: dept,
    equipment: f.equipment || null, division: ['endo', 'micro', 'diagno'].includes(f.division) ? f.division : null,
    authorisedOnly: f.authorisedOnly === true ? true : null,
  };
}

const filterCount = (f) => Object.entries(f).filter(([k, v]) => k !== 'reset' && v).length;

function buildReply(filters, out, usedAi) {
  const n = filterCount(filters);
  if (!n) return "I didn't catch a state, institute, department or equipment to search by — tell me more, e.g. \"an Endo-Surgery distributor in Kerala who has supplied to AIIMS\".";
  const parts = [];
  if (filters.department) parts.push(filters.department);
  if (filters.equipment) parts.push(`for ${filters.equipment}`);
  if (filters.institute) parts.push(`near ${filters.institute}`);
  if (filters.city) parts.push(`in ${filters.city}`);
  else if (filters.state) parts.push(`in ${filters.state}`);
  if (filters.authorisedOnly) parts.push('(authorised only)');
  const ask = parts.join(' ') || 'your request';
  if (!out.length) return `I couldn't find a distributor matching ${ask}. Try dropping one of the filters — for instance just the state, or just the equipment.${usedAi ? '' : ' (Running without AI right now, so this used a simple keyword match — a stronger model would understand more.)'}`;
  const top = out[0];
  const lines = [`Found ${out.length} distributor${out.length === 1 ? '' : 's'} matching ${ask}. Top pick: **${top.name}** — ${top.tier} tier, ${top.score}/100`];
  if (top.facts.contracts) lines.push(`with ${top.facts.contracts} GeM contracts (${top.facts.states} states, last one ${top.facts.lastContract || 'unknown date'}).`);
  else lines.push('— no GeM history yet, but it matches what you asked for.');
  if (out.length > 1) lines.push(`${Math.min(out.length, 8) - 1} more below.`);
  if (!usedAi) lines.push('(AI is unavailable right now — this used a simple keyword match.)');
  return lines.join(' ');
}

// @route POST /api/distributor-recommend/chat  { message, filters }
// `filters` is the conversation's current filter set (client keeps it and sends it back
// each turn, same pattern as Agreement's chat) — start with {} for a new conversation.
exports.chat = async (req, res) => {
  const message = String(req.body?.message || '').trim();
  if (!message) return res.status(400).json({ success: false, message: 'message is required' });
  const prevFilters = { ...EMPTY_FILTERS, ...(req.body?.filters || {}) };

  try {
    let parsed = null; let usedAi = false;
    try {
      const { system, user } = buildParsePrompt(prevFilters, message);
      let raw = '';
      for (let attempt = 0; attempt < 2 && !raw; attempt++) raw = await ollamaChat(system, user, { json: true, temperature: attempt ? 0.3 : 0.1, numPredict: 400 });
      const j = raw ? parseJsonResponse(raw) : null;
      if (j && typeof j === 'object') { parsed = j.reset ? { ...EMPTY_FILTERS, ...j } : { ...prevFilters, ...j }; usedAi = true; }
    } catch (e) { console.warn('[distributor-recommend] AI parse failed, using keyword match:', e.message); }
    if (!parsed) parsed = heuristicParse(prevFilters, message);
    const filters = sanitise(parsed);

    const query = {
      state: filters.state, city: filters.city, institute: filters.institute, department: filters.department,
      equipment: filters.equipment, division: filters.division, authorised: filters.authorisedOnly ? '1' : undefined,
    };
    const { out, fitOn } = await computeRanking(req.user.id, query);
    const top = out.slice(0, 8);

    res.json({ success: true, filters, fitOn, usedAi, reply: buildReply(filters, out, usedAi), total: out.length, data: top });
  } catch (err) {
    console.error('[distributor-recommend] chat error:', err);
    res.status(500).json({ success: false, message: 'Failed to work out a recommendation' });
  }
};
