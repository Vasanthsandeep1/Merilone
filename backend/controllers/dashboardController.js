const { QueryTypes } = require('sequelize');
const {
  sequelize, StaffUser, PartnerProfile, ProcessDecodeRequest, WorkspaceTask,
  WorkspaceDocPrepSession, SupportTicket, Quotation, Client,
} = require('../models');
const { resolveActor } = require('../utils/orgActor');
const { STATES_BY_ZH, ZH_LIST } = require('../config/zsmOrg');

// Same "active tender" definition as tenderController.js's ACTIVE_WHERE —
// duplicated rather than imported since that constant isn't exported there;
// keep in sync if that definition changes.
const CLASSIFIED_SQL = "LOWER(gt.dept) IN ('diagno', 'endo')";
const RELEVANT_SQL = "(gt.ra_no IS NULL OR TRIM(gt.ra_no) = '') AND gt.perfect_cat = 1";
const ACTIVE_WHERE = `gt.end_date_dt >= NOW() AND (gt.marked_not_relevant IS NULL OR gt.marked_not_relevant = 0) AND ${CLASSIFIED_SQL} AND ${RELEVANT_SQL}`;

// Role-specific landing dashboards (Master Admin/Tender Admin/Tender
// Executive/Zonal Manager/Sales — see boss's brief). Master Admin keeps the
// existing org-wide DashboardPage (tenderController.getDashboardStats)
// unchanged; these four are new, each built from data that's actually
// tracked today rather than fabricating per-executive activity logs this
// app has no schema for (there's one shared login per org, not per-staff
// activity attribution beyond Process Decode's requester/decider fields).

async function getOwnProfile(req) {
  return PartnerProfile.findOne({ where: { userId: req.user.id } });
}

// @route GET /api/dashboard/tender-admin
// "Eagle look" over the org's staff roster + the org-wide approval queue
// (Process Decode is the one real approval chain this app has) + this
// account's own tender pipeline funnel.
exports.getTenderAdminDashboard = async (req, res) => {
  try {
    const profile = await getOwnProfile(req);
    if (!profile) return res.status(404).json({ success: false, message: 'Complete your organization profile first' });

    const [staff, pendingProcessDecodes, recentProcessDecodes, pipelineRows, supportRows, pipelineTrendRows] = await Promise.all([
      StaffUser.findAll({ where: { partnerProfileId: profile.id }, order: [['createdAt', 'DESC']] }),
      ProcessDecodeRequest.count({ where: { partnerProfileId: profile.id, status: 'pending' } }),
      ProcessDecodeRequest.findAll({ where: { partnerProfileId: profile.id }, order: [['createdAt', 'DESC']], limit: 8 }),
      sequelize.query(
        `SELECT status, COUNT(*) AS c FROM (
           SELECT tse.bid_number, tse.status
           FROM tender_status_entries tse
           INNER JOIN (
             SELECT bid_number, MAX(created_at) AS max_created FROM tender_status_entries WHERE user_id = :userId GROUP BY bid_number
           ) latest ON latest.bid_number = tse.bid_number AND latest.max_created = tse.created_at
           WHERE tse.user_id = :userId
         ) x GROUP BY status`,
        { replacements: { userId: req.user.id }, type: QueryTypes.SELECT },
      ),
      SupportTicket.findAll({ attributes: ['status'], raw: true }).catch(() => []),
      sequelize.query(
        `SELECT DATE(created_at) AS day, COUNT(*) AS c FROM tender_status_entries
         WHERE user_id = :userId AND created_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
         GROUP BY DATE(created_at) ORDER BY day ASC`,
        { replacements: { userId: req.user.id }, type: QueryTypes.SELECT },
      ),
    ]);

    const staffByRole = { sales: [], zonal_manager: [], flsp: [] };
    let pendingStaffApprovals = 0;
    for (const s of staff) {
      staffByRole[s.role]?.push({ id: s.id, name: s.name, email: s.email, status: s.status });
      if (s.status === 'pending') pendingStaffApprovals++;
    }

    const pipeline = { proceed: 0, win: 0, lose: 0, close: 0 };
    for (const r of pipelineRows) if (pipeline[r.status] !== undefined) pipeline[r.status] = Number(r.c);

    const supportSummary = supportRows.reduce((acc, t) => {
      const key = (t.status || 'Open').toLowerCase();
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    const trendByDay = new Map(pipelineTrendRows.map((r) => [new Date(r.day).toISOString().slice(0, 10), Number(r.c)]));
    const pipelineTrend = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      const key = d.toISOString().slice(0, 10);
      return { day: key, count: trendByDay.get(key) || 0 };
    });

    res.json({
      success: true,
      data: {
        staffCounts: { sales: staffByRole.sales.length, zonalManager: staffByRole.zonal_manager.length, flsp: staffByRole.flsp.length, total: staff.length },
        pendingStaffApprovals,
        staffRoster: staff.slice(0, 12).map((s) => ({ id: s.id, name: s.name, email: s.email, role: s.role, status: s.status })),
        pendingProcessDecodes,
        recentProcessDecodes: recentProcessDecodes.map((r) => ({
          id: r.id, bidNo: r.bidNo, requesterName: r.requesterName, status: r.status, createdAt: r.createdAt, decidedAt: r.decidedAt, deciderName: r.deciderName,
        })),
        pipeline,
        pipelineTrend,
        supportSummary,
      },
    });
  } catch (err) {
    console.error('getTenderAdminDashboard error:', err);
    res.status(500).json({ success: false, message: 'Failed to load dashboard' });
  }
};

// @route GET /api/dashboard/tender-executive
// Personal working view — my active workspaces, my task board progress, my
// Doc Prep sessions in flight. Same data Active Workspaces / Workdesk
// already expose, just summarized as a landing page.
exports.getTenderExecutiveDashboard = async (req, res) => {
  try {
    const userId = req.user.id;

    const [workspaceRows, taskCountRows, docPrepSessions] = await Promise.all([
      sequelize.query(
        `SELECT tse.bid_number, tse.created_at AS marked_at, gt.items AS title, gt.dept, gt.end_date_dt
         FROM tender_status_entries tse
         INNER JOIN (
           SELECT bid_number, MAX(created_at) AS max_created FROM tender_status_entries WHERE user_id = :userId GROUP BY bid_number
         ) latest ON latest.bid_number = tse.bid_number AND latest.max_created = tse.created_at
         LEFT JOIN gem_tenders gt ON gt.bid_number = tse.bid_number
         WHERE tse.user_id = :userId AND tse.status = 'proceed'
         ORDER BY tse.created_at DESC LIMIT 8`,
        { replacements: { userId }, type: QueryTypes.SELECT },
      ),
      WorkspaceTask.findAll({ where: { userId }, attributes: ['status'], raw: true }),
      WorkspaceDocPrepSession.findAll({ where: { userId }, attributes: ['status', 'bidNumber', 'annexures'], raw: true }),
    ]);

    const taskStats = { todo: 0, in_progress: 0, done: 0 };
    for (const t of taskCountRows) if (taskStats[t.status] !== undefined) taskStats[t.status]++;

    let annexuresDrafted = 0, annexuresDone = 0, annexuresTotal = 0;
    for (const s of docPrepSessions) {
      const list = Array.isArray(s.annexures) ? s.annexures : [];
      annexuresTotal += list.length;
      annexuresDrafted += list.filter((a) => a.status === 'drafted').length;
      annexuresDone += list.filter((a) => a.status === 'done').length;
    }

    res.json({
      success: true,
      data: {
        activeWorkspaces: workspaceRows.map((w) => ({
          bidNumber: w.bid_number, title: w.title, dept: w.dept, markedAt: w.marked_at,
          hoursLeft: w.end_date_dt ? Math.round((new Date(w.end_date_dt).getTime() - Date.now()) / 3.6e6) : null,
        })),
        taskStats,
        docPrep: { sessionsInProgress: docPrepSessions.filter((s) => s.status === 'processing').length, annexuresTotal, annexuresDrafted, annexuresDone },
      },
    });
  } catch (err) {
    console.error('getTenderExecutiveDashboard error:', err);
    res.status(500).json({ success: false, message: 'Failed to load dashboard' });
  }
};

// @route GET /api/dashboard/zonal-manager
// Zone-wise tender + sales picture, built off Tender Tracker's ZH field
// (see backend/scripts/apply_zsm_org_mapping.js) — plus the org's pending
// Process Decode approval queue, which is the one real approval action a
// Zonal Manager takes in this app (decideProcessDecode).
exports.getZonalManagerDashboard = async (req, res) => {
  try {
    const actor = await resolveActor(req);
    if (!actor) return res.status(404).json({ success: false, message: 'Complete your organization profile first' });

    const [zoneRows, pendingDecisions, myDecisions] = await Promise.all([
      sequelize.query(
        `SELECT o.zh, COUNT(*) AS tenderCount,
                SUM(CASE WHEN LOWER(gt.dept) = 'diagno' THEN 1 ELSE 0 END) AS diagnoCount,
                SUM(CASE WHEN LOWER(gt.dept) = 'endo' THEN 1 ELSE 0 END) AS endoCount,
                COALESCE(SUM(CAST(gt.bid_value AS DECIMAL(18,2))), 0) AS pipelineValue
         FROM tender_tracker_overrides o
         LEFT JOIN gem_tenders gt ON gt.bid_number = o.tender_no AND o.source = 'gem'
         WHERE o.user_id = :userId AND o.zh IS NOT NULL AND o.zh != ''
         GROUP BY o.zh ORDER BY tenderCount DESC`,
        { replacements: { userId: req.user.id }, type: QueryTypes.SELECT },
      ),
      ProcessDecodeRequest.findAll({ where: { partnerProfileId: actor.partnerProfileId, status: 'pending' }, order: [['createdAt', 'ASC']] }),
      ProcessDecodeRequest.findAll({ where: { partnerProfileId: actor.partnerProfileId, status: ['approved', 'rejected'] }, order: [['decidedAt', 'DESC']], limit: 8 }),
    ]);

    res.json({
      success: true,
      data: {
        canDecide: actor.isZonalManager,
        // The Zonal Heads this Zonal Manager oversees — see boss's brief
        // ("the zonal manager has the list of zonal heads in it"). ZH_LIST
        // is the full roster from ZSM Org.xlsx; zones (below) only includes
        // ones with tender data, so a ZH with no tenders yet still shows up
        // here with zero counts instead of silently disappearing.
        zonalHeads: ZH_LIST.map((zh) => {
          const match = zoneRows.find((z) => z.zh === zh);
          return {
            zh,
            states: STATES_BY_ZH[zh] || [],
            tenderCount: match ? Number(match.tenderCount) : 0,
            diagnoCount: match ? Number(match.diagnoCount) : 0,
            endoCount: match ? Number(match.endoCount) : 0,
            pipelineValue: match ? Number(match.pipelineValue) : 0,
          };
        }),
        zones: zoneRows.map((z) => ({
          zh: z.zh, states: STATES_BY_ZH[z.zh] || [], tenderCount: Number(z.tenderCount), diagnoCount: Number(z.diagnoCount), endoCount: Number(z.endoCount), pipelineValue: Number(z.pipelineValue),
        })),
        pendingApprovals: pendingDecisions.map((r) => ({
          id: r.id, bidNo: r.bidNo, urlId: r.bidNo.split('/').join('_'), requesterName: r.requesterName, reference: r.reference, remarks: r.remarks, createdAt: r.createdAt,
        })),
        recentDecisions: myDecisions.map((r) => ({
          id: r.id, bidNo: r.bidNo, status: r.status, deciderName: r.deciderName, decidedAt: r.decidedAt,
        })),
      },
    });
  } catch (err) {
    console.error('getZonalManagerDashboard error:', err);
    res.status(500).json({ success: false, message: 'Failed to load dashboard' });
  }
};

// @route GET /api/dashboard/zonal-head?zone=<ZH name>
// A single Zonal Head's own scoped dashboard — their states, their tenders
// (from Tender Tracker's ZH field), department split, and pipeline value.
// Zonal Heads report to the Zonal Manager (see boss's brief) but each gets
// their own narrow view rather than the Zonal Manager's org-wide one.
exports.getZonalHeadDashboard = async (req, res) => {
  try {
    const zone = req.query.zone;
    if (!zone || !ZH_LIST.includes(zone)) {
      return res.status(400).json({ success: false, message: 'Unknown or missing zone. Pick a Zonal Head from the roster.' });
    }

    const [summaryRows, tenderRows] = await Promise.all([
      sequelize.query(
        `SELECT COUNT(*) AS tenderCount,
                SUM(CASE WHEN LOWER(gt.dept) = 'diagno' THEN 1 ELSE 0 END) AS diagnoCount,
                SUM(CASE WHEN LOWER(gt.dept) = 'endo' THEN 1 ELSE 0 END) AS endoCount,
                COALESCE(SUM(CAST(gt.bid_value AS DECIMAL(18,2))), 0) AS pipelineValue,
                SUM(CASE WHEN ${ACTIVE_WHERE} THEN 1 ELSE 0 END) AS activeCount
         FROM tender_tracker_overrides o
         LEFT JOIN gem_tenders gt ON gt.bid_number = o.tender_no AND o.source = 'gem'
         WHERE o.user_id = :userId AND o.zh = :zone`,
        { replacements: { userId: req.user.id, zone }, type: QueryTypes.SELECT },
      ),
      sequelize.query(
        `SELECT o.tender_no, o.source, o.flsp,
                COALESCE(gt.items, od.tender_title) AS title,
                COALESCE(gt.dept, od.dept) AS dept,
                COALESCE(gt.state, od.state) AS state,
                COALESCE(gt.end_date_dt, STR_TO_DATE(od.closing_date, '%d-%M-%Y %h:%i %p')) AS end_date_dt,
                gt.bid_value
         FROM tender_tracker_overrides o
         LEFT JOIN gem_tenders gt ON gt.bid_number = o.tender_no AND o.source = 'gem'
         LEFT JOIN open_tender_details od ON od.tender_refno = o.tender_no AND o.source = 'open'
         WHERE o.user_id = :userId AND o.zh = :zone
         ORDER BY (COALESCE(gt.end_date_dt, STR_TO_DATE(od.closing_date, '%d-%M-%Y %h:%i %p')) IS NULL) ASC,
                  COALESCE(gt.end_date_dt, STR_TO_DATE(od.closing_date, '%d-%M-%Y %h:%i %p')) ASC
         LIMIT 25`,
        { replacements: { userId: req.user.id, zone }, type: QueryTypes.SELECT },
      ),
    ]);

    const summary = summaryRows[0] || {};

    res.json({
      success: true,
      data: {
        zone,
        states: STATES_BY_ZH[zone] || [],
        tenderCount: Number(summary.tenderCount || 0),
        activeCount: Number(summary.activeCount || 0),
        diagnoCount: Number(summary.diagnoCount || 0),
        endoCount: Number(summary.endoCount || 0),
        pipelineValue: Number(summary.pipelineValue || 0),
        tenders: tenderRows.map((t) => ({
          tenderNo: t.tender_no,
          source: t.source,
          urlId: t.source === 'gem' ? t.tender_no.split('/').join('_') : null,
          title: t.title,
          dept: t.dept,
          state: t.state,
          flsp: t.flsp,
          bidValue: Number(t.bid_value || 0),
          hoursLeft: t.end_date_dt ? Math.round((new Date(t.end_date_dt).getTime() - Date.now()) / 3.6e6) : null,
        })),
      },
    });
  } catch (err) {
    console.error('getZonalHeadDashboard error:', err);
    res.status(500).json({ success: false, message: 'Failed to load dashboard' });
  }
};

// @route GET /api/dashboard/sales
// Field-facing quick view — my Process Decode submissions + their status,
// plus quotation/client counts, kept intentionally light (few, large tiles)
// since Sales is the role explicitly meant to be used from the field.
exports.getSalesDashboard = async (req, res) => {
  try {
    const actor = await resolveActor(req);
    if (!actor) return res.status(404).json({ success: false, message: 'Complete your organization profile first' });

    const where = { partnerProfileId: actor.partnerProfileId };
    if (actor.actorType === 'staff') where.requestedByStaffId = actor.staffId;
    else where.requestedByUserId = actor.userId;

    const [
      myRequests, quotationsCount, clientsCount, recentQuotations, recentClients, quotationValueRow,
      activeTendersRow, closingSoonRow, deptSplitRows, topStatesRows, upcomingDeadlines,
    ] = await Promise.all([
      ProcessDecodeRequest.findAll({ where, order: [['createdAt', 'DESC']], limit: 10 }),
      Quotation.count({ where: { userId: req.user.id, docType: 'quotation' } }).catch(() => 0),
      Client.count({ where: { userId: req.user.id } }).catch(() => 0),
      Quotation.findAll({ where: { userId: req.user.id, docType: 'quotation' }, order: [['createdAt', 'DESC']], limit: 6, raw: true }).catch(() => []),
      Client.findAll({ where: { userId: req.user.id }, order: [['createdAt', 'DESC']], limit: 6, raw: true }).catch(() => []),
      Quotation.findOne({
        where: { userId: req.user.id, docType: 'quotation' },
        attributes: [[sequelize.fn('COALESCE', sequelize.fn('SUM', sequelize.col('grand_total')), 0), 'total']],
        raw: true,
      }).catch(() => null),
      // Field-facing tender snapshot — Sales cares about what's live and
      // closing soon, not just their own paperwork (see boss's follow-up:
      // "more tender based cards ... more creative informative").
      sequelize.query(`SELECT COUNT(*) AS c FROM gem_tenders gt FORCE INDEX (idx_end_date_dt) WHERE ${ACTIVE_WHERE}`, { type: QueryTypes.SELECT }),
      sequelize.query(
        `SELECT COUNT(*) AS c FROM gem_tenders gt FORCE INDEX (idx_end_date_dt) WHERE ${ACTIVE_WHERE} AND gt.end_date_dt <= DATE_ADD(NOW(), INTERVAL 7 DAY)`,
        { type: QueryTypes.SELECT },
      ),
      sequelize.query(`SELECT LOWER(gt.dept) AS dept, COUNT(*) AS c FROM gem_tenders gt FORCE INDEX (idx_end_date_dt) WHERE ${ACTIVE_WHERE} GROUP BY LOWER(gt.dept)`, { type: QueryTypes.SELECT }),
      sequelize.query(
        `SELECT gt.state, COUNT(*) AS c FROM gem_tenders gt FORCE INDEX (idx_end_date_dt) WHERE ${ACTIVE_WHERE} AND gt.state IS NOT NULL AND gt.state != '' GROUP BY gt.state ORDER BY c DESC LIMIT 6`,
        { type: QueryTypes.SELECT },
      ),
      sequelize.query(
        `SELECT gt.bid_number, LEFT(gt.items, 120) AS title, gt.dept, TIMESTAMPDIFF(HOUR, NOW(), gt.end_date_dt) AS hoursLeft
         FROM gem_tenders gt FORCE INDEX (idx_end_date_dt) WHERE ${ACTIVE_WHERE} ORDER BY gt.end_date_dt ASC LIMIT 6`,
        { type: QueryTypes.SELECT },
      ),
    ]);

    // Quotation status breakdown — replaces the Process Decode pie on the
    // dashboard (near-useless when there's no approval activity yet, since
    // Process Decode is opt-in per tender); this reflects Sales's actual,
    // always-present day-to-day paperwork instead.
    const quotationStatusRows = await Quotation.findAll({
      where: { userId: req.user.id, docType: 'quotation' },
      attributes: ['status', [sequelize.fn('COUNT', sequelize.col('id')), 'c']],
      group: ['status'],
      raw: true,
    }).catch(() => []);

    // Competitor picture from the same `contracts` table Compare
    // Bidders/Company Profile use (see analyticsController.js's NUM helper —
    // total_value is scraped free text, sometimes comma-separated) — scoped
    // to THIS sales person's own top-market states so it reads as
    // "competitors near you" rather than a generic org-wide leaderboard.
    // Falls back to org-wide if there's no state data to scope by yet.
    const NUM = (col) => `CAST(REPLACE(IFNULL(${col}, '0'), ',', '') AS DECIMAL(15,2))`;
    const marketStates = topStatesRows.map((r) => r.state).filter(Boolean);
    const stateFilter = marketStates.length ? 'AND state IN (:states)' : '';
    const [topCompetitors, recentContracts] = await Promise.all([
      sequelize.query(
        `SELECT seller_name, COUNT(*) AS c, SUM(${NUM('total_value')}) AS revenue
         FROM contracts WHERE seller_name IS NOT NULL AND seller_name != '' ${stateFilter}
         GROUP BY seller_name ORDER BY revenue DESC LIMIT 6`,
        { replacements: { states: marketStates }, type: QueryTypes.SELECT },
      ),
      sequelize.query(
        `SELECT bid_no, seller_name, state, dept, total_value, contract_date
         FROM contracts WHERE seller_name IS NOT NULL AND seller_name != '' ${stateFilter}
         ORDER BY contract_date DESC LIMIT 6`,
        { replacements: { states: marketStates }, type: QueryTypes.SELECT },
      ),
    ]);

    const counts = { pending: 0, approved: 0, rejected: 0 };
    for (const r of myRequests) if (counts[r.status] !== undefined) counts[r.status]++;

    res.json({
      success: true,
      data: {
        myRequests: myRequests.map((r) => ({ id: r.id, bidNo: r.bidNo, status: r.status, createdAt: r.createdAt, decidedAt: r.decidedAt, decisionNote: r.decisionNote })),
        counts,
        quotationsCount,
        clientsCount,
        quotationValueTotal: Number(quotationValueRow?.total || 0),
        recentQuotations: recentQuotations.map((q) => ({ id: q.id, quotationNo: q.quotationNo, title: q.title, grandTotal: Number(q.grandTotal), status: q.status, quotationDate: q.quotationDate })),
        recentClients: recentClients.map((c) => ({ id: c.id, businessName: c.businessName, clientKind: c.clientKind, industry: c.industry, createdAt: c.createdAt })),
        activeTenders: Number(activeTendersRow[0]?.c || 0),
        closingSoon: Number(closingSoonRow[0]?.c || 0),
        deptSplit: deptSplitRows.reduce((acc, r) => { if (r.dept) acc[r.dept] = Number(r.c); return acc; }, { diagno: 0, endo: 0 }),
        topStates: topStatesRows.map((r) => ({ state: r.state, count: Number(r.c) })),
        upcomingDeadlines: upcomingDeadlines.map((t) => ({ bidNumber: t.bid_number, urlId: t.bid_number.split('/').join('_'), title: t.title, dept: t.dept, hoursLeft: Number(t.hoursLeft) })),
        quotationStatusSplit: quotationStatusRows.reduce((acc, r) => { acc[r.status] = Number(r.c); return acc; }, {}),
        marketScope: marketStates,
        topCompetitors: topCompetitors.map((r) => ({ sellerName: r.seller_name, contracts: Number(r.c), revenue: Number(r.revenue) || 0 })),
        recentContracts: recentContracts.map((r) => ({
          bidNo: r.bid_no, sellerName: r.seller_name, state: r.state, dept: r.dept, totalValue: Number(r.total_value) || 0, contractDate: r.contract_date,
        })),
      },
    });
  } catch (err) {
    console.error('getSalesDashboard error:', err);
    res.status(500).json({ success: false, message: 'Failed to load dashboard' });
  }
};
