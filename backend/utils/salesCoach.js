// Sales coach for the B2G Assistant: turns one sales person's real figures
// (salesIncentiveController.metricsFor) into plain reasons and concrete
// fixes for GP, AR and target — worked out here from the data, so the
// (small, local) chat model only has to explain them, not invent them.
const inr = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;
const pct = (n) => `${Math.round((Number(n) || 0) * 10) / 10}%`;

function coach(m) {
  const L = [];
  const gpMin = m.rules.gpMin; const arMax = m.rules.arMaxDays;
  L.push(`Sales person: ${m.staff.name} · ${m.fyLabel}`);
  L.push(`Incentive rule: GP more than ${gpMin}% AND AR less than ${arMax} days. Status: ${m.eligible ? 'ELIGIBLE' : `NOT ELIGIBLE (${m.reasons.join('; ')})`}.`);

  // ---- Target ----
  L.push('', 'TARGET');
  L.push(`Target ${m.target ? inr(m.target) : 'not set'}; achieved ${inr(m.achievement)} from ${m.opis} OPI(s)${m.achievementPct != null ? ` = ${pct(m.achievementPct)}` : ''}.`);
  if (m.target) {
    const gap = Math.max(0, m.target - m.achievement);
    const monthsLeft = m.monthly.filter((x) => x.future).length;
    if (gap > 0) L.push(`Still to go: ${inr(gap)}${monthsLeft ? ` — about ${inr(gap / monthsLeft)} per month for the ${monthsLeft} month(s) left` : ''}.`);
    const behind = m.monthly.filter((x) => !x.future && (x.targetMonth || 0) > 0 && x.sales < x.targetMonth).map((x) => `${x.month} (${inr(x.sales)} of ${inr(x.targetMonth)})`);
    if (behind.length) L.push(`Months below target so far: ${behind.join(', ')}.`);
  }

  // ---- GP ----
  L.push('', 'GP (gross profit, from OPIs)');
  if (m.gpPct == null) {
    L.push('GP cannot be worked out: none of this year\'s OPI lines has a cost price.');
  } else {
    L.push(`GP is ${pct(m.gpPct)} (${inr(m.gp)} profit) on ${inr(m.achievement - m.uncostedSales)} of costed sales. Needs more than ${gpMin}%.`);
  }
  const costed = (m.products || []).filter((p) => p.gpPct != null);
  const loss = costed.filter((p) => p.gpPct < 0).sort((a, b) => a.gp - b.gp);
  const thin = costed.filter((p) => p.gpPct >= 0 && p.gpPct <= gpMin).sort((a, b) => a.gpPct - b.gpPct);
  const good = costed.filter((p) => p.gpPct > gpMin).sort((a, b) => b.gpPct - a.gpPct);
  const priceFix = (p) => { const cost = p.sales - p.gp; const need = cost / (1 - gpMin / 100); return { need, up: need - p.sales, upPct: p.sales ? ((need - p.sales) / p.sales) * 100 : null }; };
  if (loss.length) {
    L.push(`Sold BELOW COST (pulls GP down the most): ${loss.map((p) => `${p.name} — sales ${inr(p.sales)}, cost ${inr(p.sales - p.gp)}, loss ${inr(-p.gp)}`).join('; ')}.`);
  }
  if (thin.length) {
    L.push(`Below ${gpMin}% GP: ${thin.map((p) => `${p.name} at ${pct(p.gpPct)}`).join('; ')}.`);
  }
  if (good.length) L.push(`Healthy products (above ${gpMin}%): ${good.slice(0, 5).map((p) => `${p.name} at ${pct(p.gpPct)}`).join('; ')}.`);
  if (m.uncostedSales > 0) L.push(`${inr(m.uncostedSales)} of sales has no cost price, so it is left out of GP (Endo products need a cost in Tracker → GP Tracker).`);

  const gpTips = [];
  for (const p of [...loss, ...thin].slice(0, 4)) {
    const f = priceFix(p);
    gpTips.push(`${p.name}: to reach ${gpMin}% GP the order value must be about ${inr(f.need)} instead of ${inr(p.sales)} (raise the price about ${f.upPct != null ? pct(f.upPct) : '—'}), or reduce discounts / free quantity on it.`);
  }
  if (loss.length) gpTips.push('Never quote below the DB price (cost) — for Diagnostics, order price must be above the DB price; avoid giving free kits on low-margin products.');
  if (good.length) gpTips.push(`Push more of the high-margin products (${good.slice(0, 3).map((p) => p.name).join(', ')}) to lift the overall GP mix.`);
  if (m.gpPct != null && m.gpPct <= gpMin) {
    const costedSales = m.achievement - m.uncostedSales;
    const cost = costedSales - m.gp;
    const needSales = cost / (1 - gpMin / 100);
    gpTips.push(`Overall: on today's cost of ${inr(cost)}, costed sales need to be at least ${inr(needSales)} (now ${inr(costedSales)}) for GP to cross ${gpMin}%.`);
  }
  if (m.uncostedSales > 0) gpTips.push('Ask finance to enter cost prices for the uncosted Endo product codes in GP Tracker so GP is complete.');
  if (gpTips.length) L.push('How to improve GP:', ...gpTips.map((t) => `- ${t}`));

  // ---- AR ----
  L.push('', 'AR (accounts receivable)');
  if (m.arDays == null) L.push(`AR days cannot be worked out (money is owed but there are no invoiced sales this year). Owed: ${inr(m.outstanding)}.`);
  else L.push(`AR is ${m.arDays} days (needs less than ${arMax}). Money still to collect: ${inr(m.outstanding)} on ${inr(m.salesWithGst)} of invoiced sales this year (with GST).`);
  const buckets = (m.arBuckets || []).filter((b) => b.amount > 0);
  if (buckets.length) L.push(`By age: ${buckets.map((b) => `${b.label} ${inr(b.amount)}`).join(', ')}.`);
  const owers = (m.byClient || []).filter((c) => c.owed > 0).sort((a, b) => b.owed - a.owed);
  if (owers.length) L.push(`Who owes: ${owers.slice(0, 5).map((c) => `${c.name} ${inr(c.owed)}`).join(', ')}.`);
  const arTips = [];
  if (m.arDays != null && m.arDays >= arMax && m.salesWithGst > 0) {
    const allowed = (arMax - 1) / m.daysGone * m.salesWithGst;
    arTips.push(`Collect about ${inr(m.outstanding - allowed)} to bring AR under ${arMax} days.`);
  }
  const old = (m.arBuckets || []).filter((b) => /61|90/.test(b.label) && b.amount > 0);
  if (old.length) arTips.push(`Start with the oldest dues (${old.map((b) => `${b.label}: ${inr(b.amount)}`).join(', ')}) — they hurt AR the most.`);
  if (owers.length) arTips.push(`Follow up this week with ${owers.slice(0, 3).map((c) => c.name).join(', ')}; record each payment in Sales & Invoices → Payment Receipts so AR updates.`);
  if (owers.length || (m.arDays || 0) > 30) arTips.push('Ask for advance / part payment on new orders, keep to the 30-day credit terms, and share invoice-wise statements with the customer every week.');
  if (arTips.length) L.push('How to improve AR:', ...arTips.map((t) => `- ${t}`));
  if (!owers.length && !(m.outstanding > 0)) L.push('Nothing is owed right now — AR is fine.');

  return L.join('\n');
}

module.exports = { coach };
