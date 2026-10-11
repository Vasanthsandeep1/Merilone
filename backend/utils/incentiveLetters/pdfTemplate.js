// Workdesk > Incentive Letter Generation — HTML for the target letter PDF:
// page 1 the signed letter, then one landscape target table per business
// (Diagnostics / Endo Surgery) with month, quarter and half-year columns.
// Ported unchanged from the standalone targeting-system tool.
const MONTH_LABELS = ["Apr-26", "May-26", "Jun-26", "Jul-26", "Aug-26", "Sep-26", "Oct-26", "Nov-26", "Dec-26", "Jan-27", "Feb-27", "Mar-27"];
const QUARTERS = [
  { label: "Q1", range: [0, 1, 2] },
  { label: "Q2", range: [3, 4, 5] },
  { label: "Q3", range: [6, 7, 8] },
  { label: "Q4", range: [9, 10, 11] },
];

function fmt(n) {
  if (!n) return "-";
  return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function rowValues(cellMonths) {
  const q = [0, 0, 0, 0];
  for (let i = 0; i < 12; i++) q[Math.floor(i / 3)] += cellMonths[i];
  const h1 = q[0] + q[1];
  const h2 = q[2] + q[3];
  return { months: cellMonths, q, h1, h2, total: h1 + h2 };
}

function renderTable(groupOrder, groups) {
  let bodyRows = "";
  let grand = { months: new Array(12).fill(0) };

  for (const groupName of groupOrder) {
    const group = groups[groupName];
    if (!group) continue;
    const catNames = Object.keys(group.categories).sort();
    let groupTotal = new Array(12).fill(0);
    catNames.forEach((cat, i) => {
      const cell = group.categories[cat];
      const rv = rowValues(cell.months);
      const businessCell = `<td class="rowlabel businesscell">${i === 0 ? groupName : ""}</td>`;
      bodyRows += `<tr>${businessCell}<td class="rowlabel">${cat}</td>${renderRowCells(rv)}</tr>`;
      for (let m = 0; m < 12; m++) {
        groupTotal[m] += cell.months[m];
        grand.months[m] += cell.months[m];
      }
    });
    const gv = rowValues(groupTotal);
    bodyRows += `<tr class="total-row"><td class="rowlabel" colspan="2">${groupName} Total</td>${renderRowCells(gv)}</tr>`;
  }

  const grandTotal = rowValues(grand.months);
  bodyRows += `<tr class="grand-row"><td class="rowlabel" colspan="2">Total</td>${renderRowCells(grandTotal)}</tr>`;

  return { bodyRows, grandTotalValue: grandTotal.total };
}

function renderRowCells(rv) {
  let out = "";
  for (let i = 0; i < 12; i++) {
    out += `<td class="num">${fmt(rv.months[i])}</td>`;
    if (i % 3 === 2) {
      out += `<td class="num subtotal">${fmt(rv.q[Math.floor(i / 3)])}</td>`;
      if (i === 5) out += `<td class="num subtotal">${fmt(rv.h1)}</td>`;
      if (i === 11) out += `<td class="num subtotal">${fmt(rv.h2)}</td>`;
    }
  }
  out += `<td class="num annual-col">${fmt(rv.total)}</td>`;
  return out;
}

const monthHeaderRow = () => {
  let out = "";
  for (let q = 0; q < 4; q++) {
    for (const mi of QUARTERS[q].range) out += `<th>${MONTH_LABELS[mi]}</th>`;
    out += `<th class="subtotal">${QUARTERS[q].label}</th>`;
    if (q === 1) out += `<th class="subtotal">H1</th>`;
    if (q === 3) out += `<th class="subtotal">H2</th>`;
  }
  out += `<th class="annual-col">Ann (Rs. L)</th>`;
  return out;
};

function renderLetterHtml(person, meta) {
  const fy = meta.fyLabel;
  const dateStr = meta.dateStr;

  return `
  <section class="page letter-page">
    <img class="letter-logo" src="${meta.logoDataUri}" alt="Meril" />
    <div class="letter-body">
      <p class="date">Date: - ${dateStr}</p>
      <p class="subject"><u>Subject: Sales Target F.Y. ${fy}</u></p>
      <p>Dear ${person.displayName},</p>
      <p>As we embark on a new fiscal year, Meril is happy to share company's strategic vision and goals for FY ${fy}. This year, we embrace the theme "विस्तार", symbolizing growth, innovation, and the relentless pursuit of excellence.</p>
      <p>Meril's theme, "विस्तार", reflects commitment to expanding horizons-whether it is entering new markets, reaching more customers, or enhancing our service offerings. This year, we aim to set benchmarks that not only challenge our capabilities but also redefine what we can achieve as a team.</p>
      <p>Your target for FY ${fy} has been carefully designed to align with our collective goals and vision of expansion. The details are as follows:</p>
      <p class="bullet-head">Key Focus Areas:</p>
      <ol class="focus-list">
        <li>Maintain existing accounts and increase existing share to 75% from those accounts ("विस्तार" - existing account business share)</li>
        <li>Converting Non-User Accounts into Active Customers ensuring 100% coverage. ("विस्तार" - new account market share)</li>
        <li>Faster supplies and prompt services through District Master Distributor. ("विस्तार" - enhanced distribution network)</li>
        <li>Give direction, guide and monitor your team ("विस्तार" - reach through Manpower)</li>
      </ol>
      <p>Your contribution will be pivotal in making "विस्तार" a reality. Together, let us work towards not only achieving but surpassing our targets. We are confident that with your dedication and our collective efforts, we will make FY ${fy} a landmark year in our journey.</p>
      <p>If you have any questions or require assistance in planning your strategy, please feel free to reach out. Looking forward to a year of remarkable achievements!</p>
    </div>
    <div class="signatures">
      <div class="sig"><img class="sign-img" src="${meta.anjulSignUri}" alt="" /><div class="sig-line"></div>Anjul Jain<br><span class="sig-title">(Business Head)</span></div>
      <div class="sig"><div class="sign-img"></div><div class="sig-line"></div>&nbsp;<br><span class="sig-title">(Zonal Head)</span></div>
      <div class="sig"><img class="sign-img" src="${meta.shailSignUri}" alt="" /><div class="sig-line"></div>Shail Singh Solanki<br><span class="sig-title">(Sr. General Manager FP&amp;A)</span></div>
      <div class="sig"><img class="sign-img" src="${meta.anandSignUri}" alt="" /><div class="sig-line"></div>Anand Gaur<br><span class="sig-title">(HR - Vice President Business)</span></div>
    </div>
  </section>`;
}

function renderBusinessTableHtml({ id, title, nameLabel, personName, target, rsm, zonalHead, groupOrder, groups, footerRoles, businessLabel, categoryLabel, logoDataUri, businessHeadSignUri }) {
  const { bodyRows } = renderTable(groupOrder, groups);
  return `
  <section class="page table-page" id="${id}">
    <img class="table-logo" src="${logoDataUri}" alt="Meril" />
    <div class="table-title">${title}</div>
    <table class="meta-table">
      <tr><td class="meta-label">${nameLabel}</td><td class="meta-value">${personName}</td></tr>
      <tr><td class="meta-label">Target :</td><td class="meta-value">₹ ${fmt(target)} L</td></tr>
      <tr><td class="meta-label">RSM :</td><td class="meta-value">${rsm || "-"}</td></tr>
      <tr><td class="meta-label">Zonal Head :</td><td class="meta-value">${zonalHead || "-"}</td></tr>
    </table>
    <table class="data-table">
      <thead>
        <tr>
          <th rowspan="2">${businessLabel}</th>
          <th rowspan="2">${categoryLabel}</th>
          ${monthHeaderRow()}
        </tr>
      </thead>
      <tbody>
        ${bodyRows}
      </tbody>
    </table>
    <div class="signatures small">
      ${footerRoles.map((r) =>
        r === "Business Head"
          ? `<div class="sig"><div class="sign-slot"><img class="sign-img-small" src="${businessHeadSignUri}" alt="" /></div><div class="sig-line"></div>${r}</div>`
          : `<div class="sig"><div class="sign-slot"></div><div class="sig-line"></div>${r}</div>`
      ).join("")}
    </div>
  </section>`;
}

function wrapDocument(bodyHtml) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  @page { size: A4 landscape; margin: 0; }
  * { box-sizing: border-box; }
  body { font-family: "Calibri", Arial, sans-serif; font-size: 11px; color: #111; }
  .page { page-break-after: always; }
  .page:last-child { page-break-after: auto; }

  .letter-page { font-size: 12.5px; line-height: 1.5; }
  .letter-logo { height: 60px; margin-bottom: 16px; }
  .letter-body p { margin: 10px 0; text-align: justify; font-weight: bold; }
  .letter-body li { font-weight: bold; }
  .date { font-weight: bold; }
  .letter-body p.subject { text-align: center; font-weight: bold; }
  .bullet-head { font-weight: bold; margin-left: 20px; }
  .focus-list { margin: 4px 0 4px 50px; }
  .focus-list li { margin: 4px 0; }
  .signatures { display: flex; justify-content: space-between; margin-top: 30px; }
  .signatures.small { margin-top: 30px; font-size: 10px; }
  .sig { width: 24%; text-align: center; }
  .sign-img { display: block; height: 40px; margin: 0 auto; object-fit: contain; }
  .sig-line { border-top: 1px solid #333; margin-top: 4px; margin-bottom: 4px; }
  .sig-title { font-size: 10px; }

  .table-page { --tfs: 8px; font-size: var(--tfs); position: relative; }
  .table-logo { position: absolute; top: 0; right: 0; height: 32px; }
  .table-title { text-align: center; font-size: 16px; font-weight: bold; color: #1b3a63; margin-bottom: 6px; }
  .sign-slot { height: 30px; display: flex; align-items: flex-end; justify-content: center; }
  .sign-img-small { display: block; max-height: 30px; max-width: 100%; margin: 0 auto; object-fit: contain; }
  .meta-table { margin-bottom: 6px; }
  .meta-label { font-weight: bold; width: 90px; padding: 1px 4px; }
  .meta-value { padding: 1px 4px; font-weight: bold; }

  table.data-table { width: 100%; border-collapse: collapse; }
  table.data-table th, table.data-table td { border: 1px solid #999; padding: calc(var(--tfs) * 0.28) calc(var(--tfs) * 0.4); text-align: center; white-space: nowrap; }
  table.data-table thead th { background: #1b3a63; color: #fff; font-size: var(--tfs); }
  td.rowlabel { text-align: left; }
  td.businesscell { vertical-align: top; font-weight: bold; }
  tr.total-row td { background: #dce6f1; font-weight: bold; }
  tr.grand-row td { background: #1b3a63; color: #fff; font-weight: bold; }
  td.num { text-align: right; }
  td.subtotal, th.subtotal { background: #f2f2f2; }
  td.annual-col, th.annual-col { background: #ffe699; font-weight: bold; }
  tr.total-row td.annual-col, tr.grand-row td.annual-col { background: inherit; color: inherit; }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

module.exports = { renderLetterHtml, renderBusinessTableHtml, wrapDocument };
