const { Op } = require('sequelize');
const { StaffUser, PartnerProfile, TaskItem, QueryTicket } = require('../models');

// Support > User Management > Team Ranking — scores every active staff login
// in this organisation (Sales / Zonal Manager / FLSP) purely from what they've
// actually done inside the portal: how they handle the tasks and queries
// assigned to them via Task Management / Query Management (both already carry
// a real assigneeId/assignedToStaffId FK to StaffUser, so this is real
// activity data, not a guess) — completion rate, how often they beat their due
// date, how fast they resolve things relative to the rest of the team, and how
// many items are currently overdue on their desk. Same 0-100 scored + tiered
// shape as Distributor Ranking / OEM Ranking, adapted for people instead of
// companies.

const ROLE_LABELS = { sales: 'Sales', zonal_manager: 'Zonal Manager', flsp: 'FLSP', rsm: 'RSM' };
const OPEN_TASK = ['todo', 'in_progress'];
const OPEN_QUERY = ['open', 'in_progress'];

const days = (a, b) => Math.max(0, (new Date(b).getTime() - new Date(a).getTime()) / 86400000);
const avg = (arr) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

function tierOf(score) {
  if (score >= 85) return 'Top Performer';
  if (score >= 70) return 'Strong';
  if (score >= 50) return 'Developing';
  return 'Needs Support';
}
function starsOf(score) { return clamp(score / 20, 0.5, 5); }

// @route GET /api/team-rank
exports.rank = async (req, res) => {
  try {
    const profile = await PartnerProfile.findOne({ where: { userId: req.user.id } });
    const staff = profile
      ? await StaffUser.findAll({ where: { partnerProfileId: profile.id, status: 'active' }, order: [['createdAt', 'ASC']] })
      : [];
    if (!staff.length) return res.json({ success: true, data: [], total: 0, orgAvgTurnaroundDays: null });

    const [tasks, queries] = await Promise.all([
      TaskItem.findAll({ where: { userId: req.user.id, assigneeKind: 'staff' }, raw: true }),
      QueryTicket.findAll({ where: { userId: req.user.id, assignedToStaffId: { [Op.ne]: null } }, raw: true }),
    ]);

    // Org-wide average turnaround, used so "fast" is relative to this team rather than an arbitrary constant.
    const allTurnarounds = [];
    tasks.filter((t) => t.status === 'completed' && t.completedAt).forEach((t) => allTurnarounds.push(days(t.createdAt, t.completedAt)));
    queries.filter((q) => ['resolved', 'closed'].includes(q.status)).forEach((q) => allTurnarounds.push(days(q.createdAt, q.updatedAt)));
    const orgAvgTurnaround = avg(allTurnarounds);

    const rows = staff.map((s) => {
      const myTasks = tasks.filter((t) => t.assigneeId === s.id);
      const myQueries = queries.filter((q) => q.assignedToStaffId === s.id);

      const taskTotal = myTasks.length;
      const taskCompleted = myTasks.filter((t) => t.status === 'completed');
      const taskCancelled = myTasks.filter((t) => t.status === 'cancelled').length;
      const taskOverdue = myTasks.filter((t) => OPEN_TASK.includes(t.status) && t.dueDate && t.dueDate < new Date().toISOString().slice(0, 10)).length;
      const taskOnTime = taskCompleted.filter((t) => !t.dueDate || new Date(t.completedAt).toISOString().slice(0, 10) <= t.dueDate).length;

      const queryTotal = myQueries.length;
      const queryResolved = myQueries.filter((q) => ['resolved', 'closed'].includes(q.status));
      const queryOverdue = myQueries.filter((q) => OPEN_QUERY.includes(q.status) && q.lastActivityAt && days(q.lastActivityAt, new Date()) > 3).length;

      const myTurnarounds = [
        ...taskCompleted.filter((t) => t.completedAt).map((t) => days(t.createdAt, t.completedAt)),
        ...queryResolved.map((q) => days(q.createdAt, q.updatedAt)),
      ];
      const avgTurnaroundDays = avg(myTurnarounds);

      const taskCompletionRate = taskTotal ? taskCompleted.length / taskTotal : null;
      const taskOnTimeRate = taskCompleted.length ? taskOnTime / taskCompleted.length : null;
      const queryResolutionRate = queryTotal ? queryResolved.length / queryTotal : null;

      // Task delivery (40): completion rate + on-time rate. No tasks assigned yet → neutral half-credit.
      const taskScore = taskTotal === 0 ? 20
        : (taskCompletionRate * 25) + (taskOnTimeRate === null ? 0 : taskOnTimeRate * 15);

      // Query resolution (30): resolution rate. No queries yet → neutral half-credit.
      const queryScore = queryTotal === 0 ? 15 : queryResolutionRate * 30;

      // Speed (15): this person's average turnaround vs. the whole team's average — faster than
      // the team scores higher, slower scores lower, nobody with data yet gets a neutral half-credit.
      const speedScore = avgTurnaroundDays === null || !orgAvgTurnaround
        ? 7.5
        : clamp((orgAvgTurnaround / Math.max(avgTurnaroundDays, 0.5)) * 7.5, 0, 15);

      // Reliability (15): every item currently overdue on their desk costs 3 points.
      const reliabilityScore = clamp(15 - (taskOverdue + queryOverdue) * 3, 0, 15);

      const score = clamp(Math.round(taskScore + queryScore + speedScore + reliabilityScore), 0, 100);

      return {
        staffId: s.id,
        name: s.name,
        email: s.email,
        role: s.role,
        roleLabel: ROLE_LABELS[s.role] || s.role,
        joinedAt: s.createdAt,
        score,
        tier: tierOf(score),
        stars: Number(starsOf(score).toFixed(1)),
        breakdown: {
          taskScore: Math.round(taskScore), queryScore: Math.round(queryScore),
          speedScore: Math.round(speedScore), reliabilityScore: Math.round(reliabilityScore),
        },
        tasks: { total: taskTotal, completed: taskCompleted.length, cancelled: taskCancelled, overdue: taskOverdue, onTimeRate: taskOnTimeRate },
        queries: { total: queryTotal, resolved: queryResolved.length, overdue: queryOverdue },
        avgTurnaroundDays: avgTurnaroundDays === null ? null : Math.round(avgTurnaroundDays * 10) / 10,
        activeItems: myTasks.filter((t) => OPEN_TASK.includes(t.status)).length + myQueries.filter((q) => OPEN_QUERY.includes(q.status)).length,
      };
    }).sort((a, b) => b.score - a.score);

    res.json({ success: true, data: rows, total: rows.length, orgAvgTurnaroundDays: orgAvgTurnaround === null ? null : Math.round(orgAvgTurnaround * 10) / 10 });
  } catch (err) {
    console.error('team rank error:', err);
    res.status(500).json({ success: false, message: 'Failed to compute team ranking' });
  }
};
