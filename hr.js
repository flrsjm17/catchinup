/* Catchin' Up · HR & Payroll module (loaded by manage.html) */
const H = { loaded: false, emps: [], sched: [], punches: [], exc: [], runs: [], lines: [], hol: [], leaves: [], imports: [], rules: {}, tab: "pay", from: "", to: "", run: null };
const EMP_BR = { sa: "Catchin' Up · San Antonio Place", ju: "Catchin' Up · Jupiter Street", fm: "Funhan Mart · Arnaiz" };
const KINDN = { early_in: "Early in", ot: "Overtime", late_in: "Late in", undertime: "Undertime", under_break: "Under lunch", over_break: "Over lunch", missed_punch: "Missed punch", absent: "Absent", unscheduled: "Unscheduled", short_day: "Short day", rest_day_work: "Rest day work", holiday_work: "Holiday work" };
const NEEDS_OK = ["early_in", "ot", "under_break", "rest_day_work"];   // paid only when approved
const ename = e => e ? `${e.last_name}, ${e.first_name}` : "?";
const hm = m => { m = Math.round(m); const s = m < 0 ? "-" : ""; m = Math.abs(m); return m >= 60 ? `${s}${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${s}${m}m`; };
const tmin = t => { const m = String(t || "").match(/(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : null; };
const hhmm = d => { if (!d) return ""; const x = new Date(d); return `${String(x.getHours()).padStart(2, "0")}:${String(x.getMinutes()).padStart(2, "0")}`; };
const p2 = n => (Math.round((+n || 0) * 100) / 100).toFixed(2);
const addDays = (s, n) => { const d = pd(s); d.setDate(d.getDate() + n); return iso(d); };
const dayList = (a, b) => { const out = []; for (let d = a; d <= b; d = addDays(d, 1)) out.push(d); return out; };

/* ---------- cut-offs ---------- */
function cutoffs(y, m){ const c = H.rules.cutoffs || [[11, 25], [26, 10]]; const out = [];
  for (const [a, b] of c){ if (a <= b) out.push([iso(new Date(y, m, a)), iso(new Date(y, m, b))]); else out.push([iso(new Date(y, m, a)), iso(new Date(y, m + 1, b))]); } return out; }
function currentCutoff(){ const t = new Date(); for (const k of [-1, 0]){ for (const [a, b] of cutoffs(t.getFullYear(), t.getMonth() + k)) if (iso(t) >= a && iso(t) <= b) return [a, b]; } return cutoffs(t.getFullYear(), t.getMonth())[0]; }
function lastCutoff(){ const [a] = currentCutoff(); const d = pd(a); d.setDate(d.getDate() - 1); for (const k of [-1, 0]) for (const [x, y] of cutoffs(d.getFullYear(), d.getMonth() + k)) if (iso(d) >= x && iso(d) <= y) return [x, y]; return [a, a]; }

/* ---------- data ---------- */
async function hrLoad(force){
  if (H.loaded && !force) return;
  const [e, h, r, s] = await Promise.all([sb.from("employees").select("*").order("last_name"), sb.from("holidays").select("*").order("hdate"), sb.from("payroll_runs").select("*").order("period_start", { ascending: false }), sb.from("settings").select("*").eq("key", "payroll")]);
  H.emps = e.data || []; H.hol = h.data || []; H.runs = r.data || []; H.rules = (s.data || [])[0]?.value || {};
  if (!H.from){ [H.from, H.to] = lastCutoff(); }
  await hrLoadPeriod(); H.loaded = true;
}
async function hrLoadPeriod(){
  const from = H.from, to = H.to;
  const [p, x, l, sc, im] = await Promise.all([
    sb.from("punches").select("*").gte("work_date", from).lte("work_date", to).order("time_in"),
    sb.from("attendance_exceptions").select("*").gte("work_date", from).lte("work_date", to).order("work_date"),
    sb.from("leaves").select("*").gte("leave_date", from).lte("leave_date", to),
    sb.from("schedules").select("*").gte("work_date", from).lte("work_date", to),
    sb.from("timesheet_imports").select("*").order("created_at", { ascending: false }).limit(20)]);
  H.punches = p.data || []; H.exc = x.data || []; H.leaves = l.data || []; H.sched = sc.data || []; H.imports = im.data || [];
}
const emp = id => H.emps.find(e => e.id === id);
const hol = d => H.hol.find(h => h.hdate === d);

/* ---------- attendance engine ---------- */
function schedFor(e, d){
  const s = H.sched.find(x => x.employee_id === e.id && x.work_date === d);
  if (s) return s.kind === "work" ? { kind: "work", start: tmin(s.start_time), end: tmin(s.end_time), brk: s.break_min ?? 60, src: "lineup" } : { kind: s.kind, src: "lineup" };
  const dow = pd(d).getDay();
  if ((e.rest_days || []).includes(dow)) return { kind: "rest", src: "default" };
  if (e.default_start && e.default_end) return { kind: "work", start: tmin(e.default_start), end: tmin(e.default_end), brk: e.default_break_min ?? 60, src: "default" };
  return { kind: "none", src: "none" };
}
function mins(a, b){ return (new Date(b) - new Date(a)) / 60000; }
function ndMinutes(a, b){ // minutes of [a,b] inside 22:00–06:00
  const f = tmin(H.rules.nd_from || "22:00"), t = tmin(H.rules.nd_to || "06:00"); let n = 0; const cur = new Date(a), end = new Date(b);
  while (cur < end){ const m = cur.getHours() * 60 + cur.getMinutes(); if (f > t ? (m >= f || m < t) : (m >= f && m < t)) n++; cur.setMinutes(cur.getMinutes() + 1); } return n;
}
function dayType(e, d, sc){ const h = hol(d); const rest = sc.kind === "rest"; return { rest, hol: h ? h.kind : null, holName: h?.name }; }
function analyzeDay(e, d, opts){
  const R = H.rules, tol = R.tol_min ?? 15, std = (R.std_hours ?? 8) * 60;
  const sc = schedFor(e, d), ps = H.punches.filter(p => p.employee_id === e.id && p.work_date === d).sort((a, b) => (a.time_in || "").localeCompare(b.time_in || ""));
  const lv = H.leaves.find(l => l.employee_id === e.id && l.leave_date === d && l.status === "approved");
  const out = { date: d, sched: sc, exc: [], clocked: 0, paid: 0, reg: 0, ot: 0, nd: 0, brk: 0, type: dayType(e, d, sc), leave: lv || null, segs: ps, note: "" };
  const ex = kind => H.exc.find(x => x.employee_id === e.id && x.work_date === d && x.kind === kind);
  const okd = kind => (ex(kind) || {}).status === "approved";
  if (!ps.length){
    if (lv) out.note = `${lv.kind} leave${lv.paid ? " (paid)" : " (unpaid)"}`;
    else if (sc.kind === "work" && !out.type.hol && d <= iso(today) && (sc.src === "lineup" || (e.rest_days || []).length)) out.exc.push(["absent", std, `Scheduled ${hhmmM(sc.start)}–${hhmmM(sc.end)}, no punch`]);
    return out;
  }
  if (ps.some(p => !p.time_out)){ out.exc.push(["missed_punch", 0, `In ${hhmm(ps.find(p => !p.time_out).time_in)}, no time out`]); return out; }
  const firstIn = ps[0].time_in, lastOut = ps[ps.length - 1].time_out;
  let clocked = 0, brkKnown = 0, hasBrk = false;
  ps.forEach(p => { clocked += mins(p.time_in, p.time_out); if (p.lunch_out && p.lunch_in){ brkKnown += mins(p.lunch_out, p.lunch_in); hasBrk = true; } });
  for (let k = 0; k < ps.length - 1; k++){ const g = mins(ps[k].time_out, ps[k + 1].time_in); if (g <= 240){ brkKnown += g; hasBrk = true; } }
  const lunchInside = ps.reduce((a, p) => a + (p.lunch_out && p.lunch_in ? mins(p.lunch_out, p.lunch_in) : 0), 0);
  clocked -= lunchInside;
  out.clocked = clocked;
  const brkStd = sc.kind === "work" ? (sc.brk ?? R.break_min ?? 60) : (clocked >= 300 ? (R.break_min ?? 60) : 0);
  let brk = hasBrk ? brkKnown : (clocked >= 300 ? brkStd : 0);
  let paid = hasBrk ? clocked : clocked - brk;   // assumed break comes out of clocked time
  if (hasBrk && brkStd){
    if (brk < brkStd - tol){ out.exc.push(["under_break", brkStd - brk, `${hm(brk)} break instead of ${hm(brkStd)}`]); if (!okd("under_break")) paid -= (brkStd - brk); }
    else if (brk > brkStd + tol){ out.exc.push(["over_break", brk - brkStd, `${hm(brk)} break instead of ${hm(brkStd)} (deducted)`]); }
  }
  out.brk = brk;
  if (sc.kind === "work"){
    const inM = tmin(hhmm(firstIn)) + (iso(new Date(firstIn)) > d ? 1440 : 0), outM = tmin(hhmm(lastOut)); const endAdj = sc.end < sc.start ? sc.end + 1440 : sc.end; const outAdj = iso(new Date(lastOut)) > d ? outM + 1440 : outM;
    const early = sc.start - inM, late = inM - sc.start, over = outAdj - endAdj, under = endAdj - outAdj;
    if (early >= tol && early <= 240){ out.exc.push(["early_in", early, `In ${hhmmM(inM)}, scheduled ${hhmmM(sc.start)}`]); if (!okd("early_in")) paid -= early; }
    if (late >= tol && late <= 240) out.exc.push(["late_in", late, `In ${hhmmM(inM)}, scheduled ${hhmmM(sc.start)} (deducted)`]);
    if (over >= tol){ out.exc.push(["ot", over, `Out ${hhmmM(outM)}, scheduled ${hhmmM(sc.end)}`]); if (!okd("ot")) paid -= over; }
    if (under >= tol && under <= 240) out.exc.push(["undertime", under, `Out ${hhmmM(outM)}, scheduled ${hhmmM(sc.end)} (deducted)`]);
    if (Math.abs(early) > 240 || Math.abs(over) > 240) out.exc.push(["unscheduled", clocked, `Worked ${hhmm(firstIn)}–${hhmm(lastOut)}, scheduled ${hhmmM(sc.start)}–${hhmmM(sc.end)}`]);
  } else if (sc.kind === "rest"){ out.exc.push(["rest_day_work", clocked, `Worked ${hhmm(firstIn)}–${hhmm(lastOut)} on a rest day`]); if (!okd("rest_day_work")) { /* still paid at base; premium only when approved */ } }
  else if (sc.kind === "none" && e.employment_type !== "part_time") out.exc.push(["unscheduled", clocked, `No schedule for this day`]);
  if (out.type.hol) out.exc.push(["holiday_work", clocked, `Worked on ${out.type.holName} (${out.type.hol})`]);
  if (e.employment_type !== "part_time" && paid > 0 && paid < 300 && !out.exc.some(x => ["late_in", "undertime"].includes(x[0]))) out.exc.push(["short_day", std - paid, `Only ${hm(paid)} paid`]);
  paid = Math.max(0, paid);
  out.paid = paid; out.reg = Math.min(paid, std); out.ot = Math.max(0, paid - std);
  // night differential over the paid intervals (assumed break scaled out)
  let nd = 0; ps.forEach(p => { nd += ndMinutes(p.time_in, p.time_out); if (p.lunch_out && p.lunch_in) nd -= ndMinutes(p.lunch_out, p.lunch_in); });
  out.nd = clocked > 0 ? nd * (paid / clocked) : 0;
  return out;
}
function hhmmM(m){ if (m == null) return ""; m = ((m % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; }

/* ---------- pay engine ---------- */
function roundQ(min){ const q = H.rules.round_min || 1; return Math.round(min / q) * q; }
function payDay(e, a){
  const R = H.rules, rate = +e.hourly_rate || 0, std = (R.std_hours ?? 8);
  const mult = a.type.rest ? (a.type.hol === "regular" ? R.rest_day_regular : a.type.hol === "special" ? R.rest_day_special : R.rest_day) : (a.type.hol === "regular" ? R.regular_holiday : a.type.hol === "special" ? R.special_holiday : 1);
  const okRest = !a.type.rest || (H.exc.find(x => x.employee_id === e.id && x.work_date === a.date && x.kind === "rest_day_work") || {}).status === "approved";
  const m = okRest ? mult : 1;
  const regH = roundQ(a.reg) / 60, otH = roundQ(a.ot) / 60, ndH = roundQ(a.nd) / 60;
  const basic = regH * rate, prem = regH * rate * (m - 1);
  const otm = m > 1 ? (R.ot_on_premium || 1.3) : (R.ot_rate || 1.25);
  const ot = otH * rate * m * otm, nd = ndH * rate * m * (R.nd_rate || 0.1);
  let leave = 0, holUnworked = 0;
  if (!a.segs.length){
    if (a.leave && a.leave.paid) leave = std * rate;
    else if (a.type.hol === "regular" && R.regular_holiday_unworked_paid && e.employment_type !== "part_time" && a.sched.kind !== "none") holUnworked = std * rate;
  }
  return { regH, otH, ndH, basic, prem, ot, nd, leave, holUnworked, mult: m, worked: a.segs.length > 0 };
}
function monthlyBase(e){ return +e.monthly_rate || (+e.hourly_rate || 0) * (H.rules.std_hours ?? 8) * 26; }
function contributions(e, periodStart){
  const R = H.rules, base = monthlyBase(e), on = R.contrib_on || "second", day = pd(periodStart).getDate();
  const share = on === "split" ? 0.5 : (on === "first" ? (day < 16 ? 1 : 0) : (day >= 16 ? 1 : 0));
  if (!share || !base) return { sss: 0, philhealth: 0, pagibig: 0 };
  const S = R.sss, msc = Math.min(S.max_msc, Math.max(S.min_msc, Math.round(base / S.step) * S.step));
  const sss = msc * S.ee_rate, P = R.philhealth, ph = Math.min(P.max_base, Math.max(P.min_base, base)) * P.rate * P.ee_share, G = R.pagibig, pi = Math.min(G.max_base, base) * G.ee_rate;
  return { sss: sss * share, philhealth: ph * share, pagibig: pi * share };
}
function withholding(e, taxable){ // table rows: [lower bound, tax on the bound, rate on the excess]
  if (e.mwe || taxable <= 0) return 0; const T = (H.rules.tax_semi_monthly || []).slice().sort((a, b) => a[0] - b[0]); let row = T[0] || [0, 0, 0];
  for (const r of T) if (taxable > r[0]) row = r; return Math.max(0, row[1] + (taxable - row[0]) * row[2]);
}
function computeLine(e, from, to){
  const days = dayList(from, to), det = [], L = { days_worked: 0, reg_hours: 0, ot_hours: 0, nd_hours: 0, rd_hours: 0, hol_hours: 0, leave_hours: 0, basic_pay: 0, ot_pay: 0, nd_pay: 0, premium_pay: 0, leave_pay: 0, other_earnings: 0, flags: [] };
  for (const d of days){
    const a = analyzeDay(e, d), p = payDay(e, a);
    if (p.worked) L.days_worked++;
    L.reg_hours += p.regH; L.ot_hours += p.otH; L.nd_hours += p.ndH; if (a.type.rest && p.worked) L.rd_hours += p.regH + p.otH; if (a.type.hol && p.worked) L.hol_hours += p.regH + p.otH;
    L.basic_pay += p.basic + p.holUnworked; L.ot_pay += p.ot; L.nd_pay += p.nd; L.premium_pay += p.prem; L.leave_pay += p.leave; if (p.leave) L.leave_hours += H.rules.std_hours ?? 8;
    const pend = a.exc.filter(x => NEEDS_OK.includes(x[0])).filter(x => (H.exc.find(y => y.employee_id === e.id && y.work_date === d && y.kind === x[0]) || {}).status === "pending");
    pend.forEach(x => L.flags.push(`${d} ${KINDN[x[0]]} ${hm(x[1])} pending`));
    if (p.worked || p.leave || p.holUnworked) det.push({ d, in: a.segs[0] ? hhmm(a.segs[0].time_in) : "", out: a.segs.length ? hhmm(a.segs[a.segs.length - 1].time_out) : "", brk: Math.round(a.brk), reg: p.regH, ot: p.otH, nd: p.ndH, mult: p.mult, type: a.type.rest ? "RD" : "", hol: a.type.hol || "", pay: p.basic + p.prem + p.ot + p.nd + p.leave + p.holUnworked, note: a.note || a.exc.map(x => KINDN[x[0]]).join(", ") });
  }
  L.gross = L.basic_pay + L.ot_pay + L.nd_pay + L.premium_pay + L.leave_pay + L.other_earnings;
  const c = contributions(e, from); L.sss = c.sss; L.philhealth = c.philhealth; L.pagibig = c.pagibig;
  L.tax = withholding(e, L.gross - L.sss - L.philhealth - L.pagibig); L.other_deductions = 0;
  L.net = L.gross - L.sss - L.philhealth - L.pagibig - L.tax - L.other_deductions;
  Object.keys(L).forEach(k => { if (typeof L[k] === "number") L[k] = Math.round(L[k] * 100) / 100; });
  L.detail = { days: det, hourly_rate: e.hourly_rate, monthly_base: monthlyBase(e) };
  if (!+e.hourly_rate) L.flags.unshift("No hourly rate set");
  return L;
}

/* ---------- exceptions: generate for the period ---------- */
async function generateExceptions(){
  const rows = [];
  for (const e of H.emps.filter(e => e.active)) for (const d of dayList(H.from, H.to)){
    const a = analyzeDay(e, d); a.exc.forEach(([kind, minutes, detail]) => rows.push({ employee_id: e.id, work_date: d, kind, minutes: Math.round(minutes), detail }));
  }
  // keep decisions already made; refresh detail/minutes for pending ones; drop pending ones that no longer apply
  const stale = H.exc.filter(x => x.status === "pending" && !rows.some(r => r.employee_id === x.employee_id && r.work_date === x.work_date && r.kind === x.kind));
  if (stale.length){ const { error } = await sb.from("attendance_exceptions").delete().in("id", stale.map(s => s.id)); if (error) return toast(error.message); }
  const fresh = rows.filter(r => !H.exc.some(x => x.employee_id === r.employee_id && x.work_date === r.work_date && x.kind === r.kind && x.status !== "pending"));
  for (let i = 0; i < fresh.length; i += 200){ const { error } = await sb.from("attendance_exceptions").upsert(fresh.slice(i, i + 200), { onConflict: "employee_id,work_date,kind" }); if (error) return toast(error.message); }
  await hrLoadPeriod(); toast(`${rows.length} exceptions listed`); hrRender();
}
async function decide(ids, status, note){ const { error } = await sb.from("attendance_exceptions").update({ status, decision_note: note || null }).in("id", ids); if (error) return toast(error.message); await hrLoadPeriod(); hrRender(); }

/* ---------- timesheet import (the export format) ---------- */
function parseCSV(text){ const rows = []; let row = [], cell = "", q = false; text = text.replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++){ const c = text[i]; if (q){ if (c === '"'){ if (text[i + 1] === '"'){ cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true; else if (c === ","){ row.push(cell); cell = ""; } else if (c === "\n" || c === "\r"){ if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; } else cell += c; }
  if (cell || row.length){ row.push(cell); rows.push(row); } return rows.filter(r => r.some(x => x !== "")); }
function parseStamp(s){ const m = String(s).match(/(\d{2})\/(\d{2})\/(\d{4})\D+(\d{1,2}):(\d{2})/); return m ? new Date(+m[3], +m[1] - 1, +m[2], +m[4], +m[5]) : null; }
function parseTimesheet(text){
  const rows = parseCSV(text), head = rows[0].map(h => h.trim().toLowerCase()), ix = n => head.indexOf(n);
  const iL = ix("last name"), iF = ix("first name"), iE = ix("email"), iI = ix("time in"), iO = ix("time out");
  if (iI < 0 || iO < 0) throw new Error("This doesn't look like the timesheet export (needs Time In / Time Out columns).");
  const people = []; let cur = null;
  for (const r of rows.slice(1)){
    if (r[iL] || r[iF] || r[iE]){ cur = { last: r[iL], first: r[iF], email: (r[iE] || "").trim().toLowerCase(), punches: [] }; people.push(cur); }
    else if (cur && r[iI] && r[iO]){ const a = parseStamp(r[iI]), b = parseStamp(r[iO]); if (a && b) cur.punches.push([a, b]); }
  }
  return people;
}
function matchEmployee(p){ return H.emps.find(e => e.email && e.email.toLowerCase() === p.email) || H.emps.find(e => e.last_name.toLowerCase() === (p.last || "").toLowerCase() && e.first_name.toLowerCase() === (p.first || "").toLowerCase()); }
function workDateFor(e, a){ // punches that start after midnight belong to the previous service date for night staff
  const st = tmin(e.default_start); const h = a.getHours() * 60 + a.getMinutes();
  if (st != null && st >= 720 && h < 360) { const d = new Date(a); d.setDate(d.getDate() - 1); return iso(d); } return iso(a);
}
async function importTimesheet(file){
  const text = await file.text(); let people; try { people = parseTimesheet(text); } catch (err){ return toast(err.message); }
  const all = people.flatMap(p => p.punches.map(x => x[0])); if (!all.length) return toast("No punches found in the file.");
  const from = iso(new Date(Math.min(...all))), to = iso(new Date(Math.max(...all)));
  const unmatched = people.filter(p => !matchEmployee(p)); const matched = people.filter(p => matchEmployee(p));
  openModal(`<h2>Import timesheet</h2><p class="muted">${esc(file.name)} · ${people.length} people · ${all.length} punches · ${fmt(pd(from))} to ${fmt(pd(to))}</p>
    ${unmatched.length ? `<div class="card" style="border-color:#d98e04;margin-bottom:10px"><b>Not on the employee list (skipped):</b> ${unmatched.map(p => esc(`${p.last}, ${p.first} <${p.email}>`)).join("; ")}<br><span class="small muted">Add them under Employees (same email) and import again.</span></div>` : ""}
    <p class="small muted">Imported punches for these people in this date range replace any earlier import for the same days. Punches made from the staff app are kept.</p>
    <div class="actions"><button class="btn primary" id="imp-go">Import ${matched.reduce((a, p) => a + p.punches.length, 0)} punches</button><button class="btn ghost" onclick="closeModal()">Cancel</button></div>`);
  $("#imp-go").onclick = async () => {
    $("#imp-go").disabled = true;
    const { data: im, error: e1 } = await sb.from("timesheet_imports").insert({ filename: file.name, period_start: from, period_end: to, uploaded_by: me.email, row_count: all.length, unmatched: unmatched.map(p => p.email || `${p.last}, ${p.first}`) }).select().single();
    if (e1) return toast(e1.message);
    const ids = matched.map(p => matchEmployee(p).id);
    const { error: e2 } = await sb.from("punches").delete().eq("source", "import").in("employee_id", ids).gte("work_date", from).lte("work_date", to); if (e2) return toast(e2.message);
    const rows = matched.flatMap(p => { const e = matchEmployee(p); return p.punches.map(([a, b]) => ({ employee_id: e.id, work_date: workDateFor(e, a), time_in: a.toISOString(), time_out: b.toISOString(), source: "import", import_id: im.id })); });
    for (let i = 0; i < rows.length; i += 200){ const { error } = await sb.from("punches").insert(rows.slice(i, i + 200)); if (error) return toast(error.message); }
    H.from = from; H.to = to; closeModal(); await hrLoadPeriod(); toast("Imported. Now list the exceptions."); H.tab = "time"; hrRender();
  };
}

/* ---------- UI ---------- */
async function hr(){
  $("#main").innerHTML = `<div class="empty">Loading HR…</div>`; await hrLoad(); hrRender();
}
function periodBar(extra){
  const opts = []; const t = new Date(); for (let k = -3; k <= 1; k++){ cutoffs(t.getFullYear(), t.getMonth() + k).forEach(([a, b]) => opts.push([a, b])); }
  return `<div class="toolbar"><label class="f">Pay period<select id="hr-period">${opts.map(([a, b]) => `<option value="${a}|${b}" ${a === H.from && b === H.to ? "selected" : ""}>${fmt(pd(a))} – ${fmt(pd(b))}</option>`).join("")}</select></label>${extra || ""}</div>`;
}
function bindPeriod(){ const s = $("#hr-period"); if (s) s.onchange = async () => { [H.from, H.to] = s.value.split("|"); await hrLoadPeriod(); hrRender(); }; }
function hrRender(){
  const tabs = [["pay", "Payroll"], ["exc", "Exceptions"], ["time", "Timesheets"], ["lineup", "Line-up"], ["emps", "Employees"], ["hol", "Holidays & leave"], ["rules", "Rules"]];
  const pend = H.exc.filter(x => x.status === "pending").length, pendEmp = H.emps.filter(e => e.status === "pending").length;
  $("#main").innerHTML = `<h1>HR & Payroll</h1><div class="tabs">${tabs.map(([k, l]) => `<button aria-pressed="${H.tab === k}" data-t="${k}">${l}${k === "exc" && pend ? ` <span class="chip" style="background:#fff3df;color:#9a5f00">${pend}</span>` : ""}${k === "emps" && pendEmp ? ` <span class="chip" style="background:#fff3df;color:#9a5f00">${pendEmp}</span>` : ""}</button>`).join("")}</div><div id="hr-body"></div>`;
  document.querySelectorAll(".tabs button").forEach(b => b.onclick = () => { H.tab = b.dataset.t; hrRender(); });
  ({ pay: tabPay, exc: tabExc, time: tabTime, lineup: tabLineup, emps: tabEmps, hol: tabHol, rules: tabRules })[H.tab]();
}

/* Employees · master list */
let ef = { br: "", st: "", q: "", sort: "name" };
function tabEmps(){
  const pending = H.emps.filter(e => e.status === "pending");
  let rows = H.emps.filter(e => (!ef.br || e.branch === ef.br) && (!ef.st || (e.status || (e.active ? "active" : "inactive")) === ef.st) && (!ef.q || (ename(e) + " " + (e.email || "") + " " + (e.position || "")).toLowerCase().includes(ef.q.toLowerCase())));
  const key = { name: e => ename(e), branch: e => (e.branch || "") + ename(e), position: e => (e.position || "") + ename(e), hired: e => e.date_hired || e.registered_at || "", status: e => (e.status || "") + ename(e) }[ef.sort];
  rows = rows.sort((a, b) => String(key(a)).localeCompare(String(key(b))));
  const regLink = location.href.replace(/manage\.html.*$/, "register.html");
  const stChip = e => { const st = e.status || (e.active ? "active" : "inactive"); return `<span class="chip ${st === "active" ? "c-Confirmed" : st === "pending" ? "c-Pencil" : "c-Lost"}">${st}</span>`; };
  $("#hr-body").innerHTML = `<div class="toolbar">
      <input id="ef-q" placeholder="Search name, email, position" value="${esc(ef.q)}" style="min-width:220px">
      <select id="ef-br"><option value="">All branches</option>${Object.entries(EMP_BR).map(([k, v]) => `<option value="${k}" ${ef.br === k ? "selected" : ""}>${v}</option>`).join("")}</select>
      <select id="ef-st"><option value="">All statuses</option>${["pending", "active", "inactive", "rejected"].map(k => `<option ${ef.st === k ? "selected" : ""}>${k}</option>`).join("")}</select>
      <select id="ef-sort">${[["name", "Sort: name"], ["branch", "Sort: branch"], ["position", "Sort: position"], ["hired", "Sort: date hired"], ["status", "Sort: status"]].map(([k, l]) => `<option value="${k}" ${ef.sort === k ? "selected" : ""}>${l}</option>`).join("")}</select>
      <button class="btn sm primary" onclick="editEmp()">Add by hand</button>
      <button class="btn sm ghost" onclick="navigator.clipboard.writeText('${regLink}').then(()=>toast('Registration link copied'))">Copy registration link</button>
      <button class="btn sm ghost" onclick="exportEmps()">Download list (CSV)</button></div>
    ${pending.length ? `<div class="card" style="border-color:#d98e04;margin-bottom:12px">⏳ <b>${pending.length}</b> registration${pending.length > 1 ? "s" : ""} waiting for your review. Click a row to check the details and ID, set the rate, then approve.</div>` : ""}
    <p class="muted small">Send the registration link to new hires: <a href="${regLink}" target="_blank">${regLink}</a>. They fill in their details, government numbers, a photo of their valid ID and a selfie. ${rows.length} of ${H.emps.length} shown.</p>
    <div style="overflow:auto"><table><tr><th></th><th>Employee</th><th>Branch</th><th>Position</th><th>Mobile</th><th>SSS · PhilHealth · Pag-IBIG · TIN</th><th>Hired</th><th>Rate/h</th><th>Status</th><th>Staff app</th></tr>
    ${rows.map(e => `<tr class="row" onclick="showEmp('${e.id}')"><td><div class="avatar" data-sf="${esc(e.selfie || "")}" id="av-${e.id}"></div></td><td><b>${esc(ename(e))}</b>${e.middle_name ? ` <span class="muted small">${esc(e.middle_name)}</span>` : ""}<br><span class="small muted">${esc(e.email || "")}</span></td><td class="small">${EMP_BR[e.branch] || esc(e.branch || "")}</td><td class="small">${esc(e.position || "")}<br><span class="muted">${esc(e.employment_type || "")}</span></td><td class="small">${esc(e.mobile || "")}</td><td class="small muted">${[e.sss_no, e.philhealth_no, e.pagibig_no, e.tin].map(x => x ? esc(x) : "<span style='color:#c62828'>—</span>").join(" · ")}</td><td class="small">${e.date_hired ? fmt(pd(e.date_hired)) : e.registered_at ? `<span class="muted">reg. ${fmt(pd(e.registered_at))}</span>` : ""}</td><td class="num">${+e.hourly_rate ? "₱" + p2(e.hourly_rate) : "<span class='chip' style='background:#fff3df;color:#9a5f00'>set</span>"}</td><td>${stChip(e)}</td>
      <td onclick="event.stopPropagation()">${e.status !== "active" ? "" : e.invited_at ? `<span class="small muted">invited ${fmt(pd(e.invited_at))}</span><br><button class="btn sm ghost" onclick="inviteEmp('${e.id}')">Resend</button>` : e.email ? `<button class="btn sm" onclick="inviteEmp('${e.id}')">Send invite</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="10" class="empty">No employees match.</td></tr>`}</table></div>`;
  ["q", "br", "st", "sort"].forEach(k => { const el = $(`#ef-${k}`); el[k === "q" ? "oninput" : "onchange"] = () => { ef[k] = el.value; hrRender(); }; });
  if (!document.getElementById("av-css")) { const st = document.createElement("style"); st.id = "av-css"; st.textContent = ".avatar{width:38px;height:38px;border-radius:50%;background:var(--soft) center/cover no-repeat;border:1px solid var(--line)}"; document.head.appendChild(st); }
  rows.filter(e => e.selfie).forEach(async e => { const { data } = await sb.storage.from("employee-docs").createSignedUrl(e.selfie, 600); const el = document.getElementById("av-" + e.id); if (data && el) el.style.backgroundImage = `url(${data.signedUrl})`; });
}
async function showEmp(id){
  const e = emp(id); if (!e) return; const st = e.status || (e.active ? "active" : "inactive");
  const kv = (k, v) => v ? `<b>${k}</b><span>${esc(v)}</span>` : "";
  openModal(`<div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap"><div id="em-sf" style="width:96px;height:96px;border-radius:14px;background:var(--soft) center/cover;border:1px solid var(--line);flex:none"></div><div><h2 style="margin:0">${esc(ename(e))}${e.suffix ? " " + esc(e.suffix) : ""}</h2><div class="muted">${esc(e.position || "")} · ${EMP_BR[e.branch] || esc(e.branch || "")} · ${esc(e.employment_type || "")}</div><div style="margin-top:6px"><span class="chip ${st === "active" ? "c-Confirmed" : st === "pending" ? "c-Pencil" : "c-Lost"}">${st}</span>${e.registered_at ? ` <span class="small muted">registered online ${fmtTs(e.registered_at)}</span>` : ""}</div></div></div>
    <div class="kv" style="margin-top:14px">${kv("Email", e.email)}${kv("Mobile", e.mobile)}${kv("Birthdate", e.birthdate ? fmt(pd(e.birthdate)) : "")}${kv("Gender", e.gender)}${kv("Civil status", e.civil_status)}${kv("Address", e.address)}${kv("Emergency contact", e.emergency_name ? `${e.emergency_name} (${e.emergency_relation || "—"}) · ${e.emergency_mobile || ""}` : "")}
      ${kv("SSS", e.sss_no)}${kv("PhilHealth", e.philhealth_no)}${kv("Pag-IBIG", e.pagibig_no)}${kv("TIN", e.tin)}${kv("Valid ID", e.id_type ? `${e.id_type}${e.id_number ? " · " + e.id_number : ""}` : "")}${kv("Date hired", e.date_hired ? fmt(pd(e.date_hired)) : "")}${kv("Hourly rate", +e.hourly_rate ? "₱" + p2(e.hourly_rate) : "")}${kv("Notes", e.notes)}${kv("Consent", e.consent?.accepted ? `given ${fmtTs(e.consent.at)} (${e.consent.version})` : "")}</div>
    <div id="em-id" style="margin:10px 0"></div>
    ${st === "pending" ? `<div class="card" style="border-color:#d98e04"><h3>Approve this registration</h3><div class="fields"><label class="f">Hourly rate ₱<input id="ap-rate" type="number" step="0.01" value="${e.hourly_rate || ""}"></label><label class="f">Date hired<input id="ap-hired" type="date" value="${e.date_hired || iso(today)}"></label><label class="f">Default shift start<input id="ap-start" type="time" value="${String(e.default_start || "").slice(0, 5)}"></label><label class="f">Default shift end<input id="ap-end" type="time" value="${String(e.default_end || "").slice(0, 5)}"></label><label class="f">Break minutes<input id="ap-brk" type="number" value="${e.default_break_min ?? 60}"></label></div>
      <div class="actions"><button class="btn primary" id="ap-go">Approve and send staff-app invite</button><button class="btn ghost" id="ap-no">Reject</button></div></div>` : ""}
    <div class="actions"><button class="btn" onclick="closeModal();editEmp('${e.id}')">Edit details</button>${st === "active" ? `<button class="btn ghost" onclick="setEmpStatus('${e.id}','inactive')">Mark separated</button>` : st === "inactive" ? `<button class="btn ghost" onclick="setEmpStatus('${e.id}','active')">Reactivate</button>` : ""}<button class="btn ghost" onclick="closeModal()">Close</button></div>`);
  if (e.selfie){ const { data } = await sb.storage.from("employee-docs").createSignedUrl(e.selfie, 600); if (data) $("#em-sf").style.backgroundImage = `url(${data.signedUrl})`; }
  if (e.id_photo){ const { data } = await sb.storage.from("employee-docs").createSignedUrl(e.id_photo, 600); if (data) $("#em-id").innerHTML = `<div class="small muted" style="margin-bottom:4px">Valid ID (click to open)</div><a href="${data.signedUrl}" target="_blank"><img src="${data.signedUrl}" style="max-width:100%;max-height:260px;border-radius:10px;border:1px solid var(--line)"></a>`; }
  if ($("#ap-go")) $("#ap-go").onclick = async () => { const rate = +$("#ap-rate").value; if (!rate) return toast("Set the hourly rate first");
    const { error } = await sb.from("employees").update({ status: "active", active: true, hourly_rate: rate, date_hired: $("#ap-hired").value || null, default_start: $("#ap-start").value || null, default_end: $("#ap-end").value || null, default_break_min: +$("#ap-brk").value || 60, updated_at: new Date().toISOString() }).eq("id", e.id); if (error) return toast(error.message);
    await logAct(`EMP ${e.last_name}`, `Registration approved by ${me.email}`); closeModal(); await hrLoad(true); hrRender(); inviteEmp(e.id); };
  if ($("#ap-no")) $("#ap-no").onclick = () => setEmpStatus(e.id, "rejected");
}
async function setEmpStatus(id, status){ const { error } = await sb.from("employees").update({ status, active: status === "active", date_separated: status === "inactive" ? iso(today) : null, updated_at: new Date().toISOString() }).eq("id", id); if (error) return toast(error.message); closeModal(); await hrLoad(true); hrRender(); toast("Saved"); }
function exportEmps(){ const cols = ["last_name", "first_name", "middle_name", "suffix", "email", "mobile", "birthdate", "gender", "civil_status", "address", "branch", "position", "employment_type", "date_hired", "hourly_rate", "sss_no", "philhealth_no", "pagibig_no", "tin", "id_type", "id_number", "emergency_name", "emergency_mobile", "emergency_relation", "status"];
  const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`; const csv = [cols.join(",")].concat(H.emps.map(e => cols.map(c => q(c === "branch" ? (EMP_BR[e.branch] || e.branch) : e[c])).join(","))).join("\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv" })); a.download = `employees-${iso(today)}.csv`; a.click(); }
function editEmp(id){
  const e = H.emps.find(x => x.id === id) || { last_name: "", first_name: "", email: "", mobile: "", branch: "sa", position: "", employment_type: "regular", hourly_rate: "", monthly_rate: "", mwe: true, sss_no: "", philhealth_no: "", pagibig_no: "", tin: "", date_hired: "", active: true, rest_days: [], default_start: "", default_end: "", default_break_min: 60, vl_credits: 0, sl_credits: 0, notes: "" };
  const f = (k, l, t = "text", extra = "") => `<label class="f">${l}<input id="e-${k}" type="${t}" value="${esc(e[k] ?? "")}" ${extra}></label>`;
  openModal(`<h2>${id ? esc(ename(e)) : "New employee"}</h2><div class="fields">${f("last_name", "Last name")}${f("first_name", "First name")}${f("email", "Email (used for the staff app and the timesheet)", "email")}${f("mobile", "Mobile")}
    <label class="f">Branch<select id="e-branch">${Object.entries(EMP_BR).map(([k, v]) => `<option value="${k}" ${e.branch === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>${f("position", "Position")}
    <label class="f">Employment<select id="e-employment_type">${["regular", "probationary", "part_time", "contractual"].map(k => `<option ${e.employment_type === k ? "selected" : ""}>${k}</option>`).join("")}</select></label>
    ${f("hourly_rate", "Hourly rate ₱", "number", 'step="0.01"')}${f("monthly_rate", "Monthly basis for SSS/PhilHealth/Pag-IBIG ₱ (blank = hourly × 8 × 26)", "number")}
    <label class="f">Minimum wage earner (no withholding tax)<select id="e-mwe"><option value="true" ${e.mwe ? "selected" : ""}>Yes</option><option value="false" ${!e.mwe ? "selected" : ""}>No</option></select></label>
    ${f("default_start", "Default shift start", "time")}${f("default_end", "Default shift end", "time")}${f("default_break_min", "Break minutes (gap between split punches, or lunch)", "number")}
    ${f("date_hired", "Date hired", "date")}${f("sss_no", "SSS no.")}${f("philhealth_no", "PhilHealth no.")}${f("pagibig_no", "Pag-IBIG no.")}${f("tin", "TIN")}${f("vl_credits", "VL credits", "number")}${f("sl_credits", "SL credits", "number")}
    <label class="f">Active<select id="e-active"><option value="true" ${e.active ? "selected" : ""}>Yes</option><option value="false" ${!e.active ? "selected" : ""}>No (separated)</option></select></label></div>
    <div class="f" style="font-size:13px;font-weight:700;color:var(--muted)">Rest days</div><div style="display:flex;gap:10px;flex-wrap:wrap;margin:4px 0 10px">${DAYS.map((d, i) => `<label><input type="checkbox" class="e-rd" value="${i}" ${(e.rest_days || []).includes(i) ? "checked" : ""}> ${d}</label>`).join("")}</div>
    <label class="f">Notes<textarea id="e-notes" rows="2">${esc(e.notes || "")}</textarea></label>
    <div class="actions"><button class="btn primary" id="e-save">Save</button><button class="btn ghost" onclick="closeModal()">Cancel</button></div>`);
  $("#e-save").onclick = async () => {
    const v = {}; ["last_name", "first_name", "email", "mobile", "branch", "position", "employment_type", "sss_no", "philhealth_no", "pagibig_no", "tin", "notes"].forEach(k => v[k] = $(`#e-${k}`).value.trim() || null);
    v.email = v.email ? v.email.toLowerCase() : null; ["hourly_rate", "monthly_rate", "default_break_min", "vl_credits", "sl_credits"].forEach(k => v[k] = $(`#e-${k}`).value === "" ? null : +$(`#e-${k}`).value);
    v.hourly_rate = v.hourly_rate || 0; v.default_break_min = v.default_break_min ?? 60; v.mwe = $("#e-mwe").value === "true"; v.active = $("#e-active").value === "true"; v.status = v.active ? "active" : "inactive";
    v.default_start = $("#e-default_start").value || null; v.default_end = $("#e-default_end").value || null; v.date_hired = $("#e-date_hired").value || null;
    v.rest_days = [...document.querySelectorAll(".e-rd:checked")].map(x => +x.value); v.updated_at = new Date().toISOString();
    if (!v.last_name || !v.first_name) return toast("Name is required");
    const res = id ? await sb.from("employees").update(v).eq("id", id).select().single() : await sb.from("employees").insert(v).select().single(); if (res.error) return toast(res.error.message);
    closeModal(); await hrLoad(true); hrRender(); toast("Saved");
    if (!id && v.email && v.active) inviteEmp(res.data.id);
  };
}

/* Line-up (month schedule) */
let lu = { y: today.getFullYear(), m: today.getMonth(), branch: "" };
async function tabLineup(){
  const first = iso(new Date(lu.y, lu.m, 1)), last = iso(new Date(lu.y, lu.m + 1, 0));
  const { data } = await sb.from("schedules").select("*").gte("work_date", first).lte("work_date", last); const S = data || [];
  const days = dayList(first, last), emps = H.emps.filter(e => e.active && (!lu.branch || e.branch === lu.branch));
  const cell = (e, d) => { const s = S.find(x => x.employee_id === e.id && x.work_date === d); const dow = pd(d).getDay();
    if (s) return s.kind === "work" ? `<b>${String(s.start_time).slice(0, 5)}</b><br>${String(s.end_time).slice(0, 5)}` : `<span class="muted">${s.kind === "rest" ? "RD" : s.kind}</span>`;
    return (e.rest_days || []).includes(dow) ? `<span class="muted" style="opacity:.5">rd</span>` : `<span class="muted" style="opacity:.35">·</span>`; };
  $("#hr-body").innerHTML = `<div class="toolbar"><button class="btn sm ghost" id="lu-prev">‹</button><b style="min-width:160px;text-align:center">${monthLabel(lu.y, lu.m)}</b><button class="btn sm ghost" id="lu-next">›</button>
    <select id="lu-branch"><option value="">All branches</option>${Object.entries(EMP_BR).map(([k, v]) => `<option value="${k}" ${lu.branch === k ? "selected" : ""}>${v}</option>`).join("")}</select>
    <button class="btn sm" id="lu-fill">Fill empty days from default shifts</button><span class="muted small">Click a day to set a shift. Grey "rd" = default rest day, "·" = nothing set (default shift applies).</span></div>
    <div style="overflow:auto"><table style="font-size:12px"><tr><th style="position:sticky;left:0;background:var(--soft)">Employee</th>${days.map(d => `<th style="padding:6px 4px;text-align:center;${[0, 6].includes(pd(d).getDay()) ? "background:#eef6f8" : ""}${hol(d) ? "color:#c62828" : ""}">${pd(d).getDate()}<br><span style="font-weight:400">${DAYS[pd(d).getDay()][0]}</span></th>`).join("")}</tr>
    ${emps.map(e => `<tr><td style="position:sticky;left:0;background:#fff;white-space:nowrap"><b>${esc(e.last_name)}</b> ${esc(e.first_name.split(" ")[0])}</td>${days.map(d => `<td class="lu" data-e="${e.id}" data-d="${d}" style="padding:4px;text-align:center;cursor:pointer;line-height:1.2;${hol(d) ? "background:#fff0f0" : ""}">${cell(e, d)}</td>`).join("")}</tr>`).join("")}</table></div>`;
  $("#lu-prev").onclick = () => { lu.m--; if (lu.m < 0){ lu.m = 11; lu.y--; } hrRender(); }; $("#lu-next").onclick = () => { lu.m++; if (lu.m > 11){ lu.m = 0; lu.y++; } hrRender(); };
  $("#lu-branch").onchange = ev => { lu.branch = ev.target.value; hrRender(); };
  $("#lu-fill").onclick = async () => { const rows = []; emps.forEach(e => days.forEach(d => { if (S.some(x => x.employee_id === e.id && x.work_date === d)) return; const dow = pd(d).getDay();
      if ((e.rest_days || []).includes(dow)) rows.push({ employee_id: e.id, work_date: d, kind: "rest", created_by: me.email }); else if (e.default_start && e.default_end) rows.push({ employee_id: e.id, work_date: d, kind: "work", start_time: e.default_start, end_time: e.default_end, break_min: e.default_break_min ?? 60, branch: e.branch, created_by: me.email }); }));
    if (!rows.length) return toast("Nothing to fill"); for (let i = 0; i < rows.length; i += 200){ const { error } = await sb.from("schedules").insert(rows.slice(i, i + 200)); if (error) return toast(error.message); } toast(`${rows.length} days filled`); hrRender(); };
  document.querySelectorAll("td.lu").forEach(td => td.onclick = () => editShift(td.dataset.e, td.dataset.d, S));
}
function editShift(eid, d, S){
  const e = emp(eid), s = S.find(x => x.employee_id === eid && x.work_date === d) || { kind: "work", start_time: e.default_start || "18:00", end_time: e.default_end || "03:00", break_min: e.default_break_min ?? 60 };
  openModal(`<h2>${esc(ename(e))} · ${fmt(pd(d))}</h2><div class="fields"><label class="f">Day<select id="sh-kind">${["work", "rest", "off", "leave"].map(k => `<option ${s.kind === k ? "selected" : ""}>${k}</option>`).join("")}</select></label>
    <label class="f">Start<input id="sh-start" type="time" value="${String(s.start_time || "").slice(0, 5)}"></label><label class="f">End<input id="sh-end" type="time" value="${String(s.end_time || "").slice(0, 5)}"></label><label class="f">Break minutes<input id="sh-brk" type="number" value="${s.break_min ?? 60}"></label></div>
    <label><input type="checkbox" id="sh-rep"> Apply to every ${DAYS[pd(d).getDay()]} for the rest of the month</label>
    <div class="actions"><button class="btn primary" id="sh-save">Save</button>${s.id ? `<button class="btn ghost" id="sh-del">Clear day</button>` : ""}<button class="btn ghost" onclick="closeModal()">Cancel</button></div>`);
  $("#sh-save").onclick = async () => {
    const kind = $("#sh-kind").value, base = { employee_id: eid, kind, start_time: kind === "work" ? $("#sh-start").value : null, end_time: kind === "work" ? $("#sh-end").value : null, break_min: +$("#sh-brk").value || 0, branch: e.branch, created_by: me.email };
    const dates = [d]; if ($("#sh-rep").checked){ const last = iso(new Date(lu.y, lu.m + 1, 0)); for (let x = addDays(d, 7); x <= last; x = addDays(x, 7)) dates.push(x); }
    const { error } = await sb.from("schedules").upsert(dates.map(work_date => ({ ...base, work_date })), { onConflict: "employee_id,work_date" }); if (error) return toast(error.message); closeModal(); hrRender(); };
  if ($("#sh-del")) $("#sh-del").onclick = async () => { await sb.from("schedules").delete().eq("id", s.id); closeModal(); hrRender(); };
}

/* Timesheets */
function tabTime(){
  const byEmp = {}; H.punches.forEach(p => (byEmp[p.employee_id] = byEmp[p.employee_id] || []).push(p));
  $("#hr-body").innerHTML = periodBar(`<label class="btn sm primary" style="cursor:pointer">Upload timesheet CSV<input type="file" id="ts-file" accept=".csv,text/csv" hidden></label><button class="btn sm" onclick="generateExceptions()">List exceptions for this period</button><button class="btn sm ghost" onclick="manualPunch()">Add punch by hand</button>`) +
    `<p class="muted small">Imports so far: ${H.imports.slice(0, 5).map(i => `${esc(i.filename)} (${fmt(pd(i.period_start))}–${fmt(pd(i.period_end))}, ${i.row_count} rows)`).join(" · ") || "none"}</p>
    <div class="grid">${H.emps.filter(e => e.active).map(e => { const ps = (byEmp[e.id] || []); const byDay = {}; ps.forEach(p => (byDay[p.work_date] = byDay[p.work_date] || []).push(p));
      return `<div class="card"><h3>${esc(ename(e))} <span class="muted small">${Object.keys(byDay).length} days</span></h3>${ps.length ? `<table>${Object.entries(byDay).sort().map(([d, xs]) => { const a = analyzeDay(e, d); return `<tr><td>${fmt(pd(d))}</td><td class="num">${xs.map(p => `${hhmm(p.time_in)}–${p.time_out ? hhmm(p.time_out) : "<b style='color:#c62828'>?</b>"}${p.lunch_out ? ` <span class="muted">(L ${hhmm(p.lunch_out)}–${hhmm(p.lunch_in)})</span>` : ""}${p.source === "app" ? ` <a href="#" onclick="viewSelfie('${p.selfie_in || ""}','${p.selfie_out || ""}');return false" title="selfies">📱</a>` : ""}`).join("<br>")}</td><td class="num">${hm(a.paid)}</td><td class="small">${a.exc.map(x => `<span class="chip" style="background:${NEEDS_OK.includes(x[0]) ? "#fff3df" : "#f1f1f1"};color:#555">${KINDN[x[0]]}</span>`).join(" ")}</td></tr>`; }).join("")}</table>` : `<div class="muted small">No punches in this period</div>`}</div>`; }).join("")}</div>`;
  bindPeriod(); $("#ts-file").onchange = ev => { if (ev.target.files[0]) importTimesheet(ev.target.files[0]); };
}
function manualPunch(){
  openModal(`<h2>Add a punch by hand</h2><div class="fields"><label class="f">Employee<select id="mp-e">${H.emps.filter(e => e.active).map(e => `<option value="${e.id}">${esc(ename(e))}</option>`).join("")}</select></label><label class="f">Work date<input id="mp-d" type="date" value="${H.to}"></label><label class="f">Time in<input id="mp-in" type="datetime-local"></label><label class="f">Time out<input id="mp-out" type="datetime-local"></label><label class="f">Note<input id="mp-note"></label></div>
    <div class="actions"><button class="btn primary" id="mp-save">Save</button><button class="btn ghost" onclick="closeModal()">Cancel</button></div>`);
  $("#mp-save").onclick = async () => { const { error } = await sb.from("punches").insert({ employee_id: $("#mp-e").value, work_date: $("#mp-d").value, time_in: new Date($("#mp-in").value).toISOString(), time_out: $("#mp-out").value ? new Date($("#mp-out").value).toISOString() : null, source: "manual", note: `${$("#mp-note").value} (by ${me.email})` }); if (error) return toast(error.message); closeModal(); await hrLoadPeriod(); hrRender(); };
}

/* Exceptions */
let xf = { st: "pending", kind: "" };
function tabExc(){
  const rows = H.exc.filter(x => (!xf.st || x.status === xf.st) && (!xf.kind || x.kind === xf.kind)).sort((a, b) => (ename(emp(a.employee_id)) + a.work_date).localeCompare(ename(emp(b.employee_id)) + b.work_date));
  const groups = {}; rows.forEach(x => (groups[x.kind] = groups[x.kind] || []).push(x));
  $("#hr-body").innerHTML = periodBar(`<select id="xf-st"><option value="pending" ${xf.st === "pending" ? "selected" : ""}>Pending</option><option value="approved" ${xf.st === "approved" ? "selected" : ""}>Approved</option><option value="rejected" ${xf.st === "rejected" ? "selected" : ""}>Rejected</option><option value="" ${!xf.st ? "selected" : ""}>All</option></select>
    <select id="xf-kind"><option value="">All kinds</option>${Object.entries(KINDN).map(([k, v]) => `<option value="${k}" ${xf.kind === k ? "selected" : ""}>${v}</option>`).join("")}</select>
    <button class="btn sm" onclick="generateExceptions()">Refresh list from punches</button><button class="btn sm ghost" onclick="window.print()">Print</button>`) +
    `<p class="muted small">Orange kinds are paid only when approved (early-in, overtime, under-lunch, rest-day work). Grey kinds are information or automatic deductions (late, undertime, over-lunch, absent).</p>
    ${rows.length ? Object.entries(groups).map(([k, xs]) => `<div class="card" style="margin-bottom:12px"><h3>${KINDN[k]} <span class="muted small">${xs.length}</span> ${xf.st === "pending" && NEEDS_OK.includes(k) ? `<button class="btn sm ghost" style="float:right" onclick="decide(${JSON.stringify(xs.map(x => x.id)).replace(/"/g, "&quot;")},'approved')">Approve all ${KINDN[k].toLowerCase()}</button>` : ""}</h3>
      <table><tr><th>Employee</th><th>Date</th><th>Minutes</th><th>Detail</th><th>Status</th><th></th></tr>${xs.map(x => `<tr><td>${esc(ename(emp(x.employee_id)))}</td><td>${fmt(pd(x.work_date))}</td><td class="num">${x.minutes ? hm(x.minutes) : ""}</td><td>${esc(x.detail || "")}${x.decision_note ? `<br><span class="small muted">${esc(x.decision_note)}</span>` : ""}</td><td>${x.status === "pending" ? `<span class="chip c-Pencil">pending</span>` : `<span class="chip ${x.status === "approved" ? "c-Confirmed" : "c-Lost"}">${x.status}</span><br><span class="small muted">${esc(x.decided_by || "")}</span>`}</td>
        <td style="white-space:nowrap">${x.status === "pending" ? (NEEDS_OK.includes(x.kind) ? `<button class="btn sm primary" onclick="decide(['${x.id}'],'approved')">Approve</button> <button class="btn sm ghost" onclick="rejectExc('${x.id}')">Reject</button>` : `<button class="btn sm ghost" onclick="decide(['${x.id}'],'approved')">Noted</button>`) : `<button class="btn sm ghost" onclick="decide(['${x.id}'],'pending')">Reopen</button>`}</td></tr>`).join("")}</table></div>`).join("") : `<div class="empty">Nothing here. Upload a timesheet and press "List exceptions".</div>`}`;
  bindPeriod(); $("#xf-st").onchange = ev => { xf.st = ev.target.value; hrRender(); }; $("#xf-kind").onchange = ev => { xf.kind = ev.target.value; hrRender(); };
}
function rejectExc(id){ const n = prompt("Reason (optional)"); if (n === null) return; decide([id], "rejected", n); }

/* Payroll */
async function tabPay(){
  const run = H.runs.find(r => r.period_start === H.from && r.period_end === H.to);
  const pend = H.exc.filter(x => x.status === "pending" && NEEDS_OK.includes(x.kind)).length;
  const canProcess = ["owner", "manager"].includes(myRole), canApprove = myRole === "owner";
  let lines = []; if (run){ const { data } = await sb.from("payroll_lines").select("*").eq("run_id", run.id); lines = (data || []).sort((a, b) => ename(emp(a.employee_id)).localeCompare(ename(emp(b.employee_id)))); H.lines = lines; }
  const frozen = run && ["Approved", "Released"].includes(run.status);
  const tot = k => lines.reduce((a, l) => a + (+l[k] || 0), 0);
  $("#hr-body").innerHTML = periodBar(run ? `<span class="chip c-${run.status.split(" ")[0]}">${run.status}</span><span class="small muted">prepared by ${esc(run.prepared_by || "")}${run.approved_by ? ` · approved by ${esc(run.approved_by)}` : ""}</span>` : "") +
    `<div class="actions">
      ${canProcess && !frozen ? `<button class="btn primary" id="pr-gen">${run ? "Recompute" : "Generate payroll"} for this period</button>` : ""}
      ${run && run.status === "Draft" && canProcess ? `<button class="btn" id="pr-review">Send for review</button>` : ""}
      ${run && run.status === "For review" && canApprove ? `<button class="btn primary" id="pr-approve">Approve</button><button class="btn ghost" id="pr-reject">Send back</button>` : ""}
      ${run && run.status === "Approved" && canApprove ? `<button class="btn primary" id="pr-release">Mark released (paid)</button>` : ""}
      ${run && lines.length ? `<button class="btn ghost" id="pr-csv">Download CSV</button><button class="btn ghost" id="pr-slips">Payslips</button>` : ""}
    </div>
    ${pend ? `<div class="card" style="border-color:#d98e04;margin-bottom:12px">⚠️ ${pend} exception${pend > 1 ? "s" : ""} still pending for this period. Pending overtime and early-ins are <b>not</b> paid until approved; decide them under Exceptions, then recompute.</div>` : ""}
    ${run && run.review_notes ? `<div class="card" style="margin-bottom:12px"><b>Review notes:</b> ${esc(run.review_notes)}</div>` : ""}
    ${lines.length ? `<div style="overflow:auto"><table class="num"><tr><th>Employee</th><th>Days</th><th>Reg h</th><th>OT h</th><th>ND h</th><th>Basic</th><th>Premiums</th><th>OT</th><th>ND</th><th>Leave</th><th>Gross</th><th>SSS</th><th>PhilHealth</th><th>Pag-IBIG</th><th>Tax</th><th>Net</th><th></th></tr>
      ${lines.map(l => `<tr class="row" onclick="showLine('${l.id}')"><td style="white-space:nowrap"><b>${esc(ename(emp(l.employee_id)))}</b>${(l.flags || []).length ? `<br><span class="small" style="color:#9a5f00">⚠ ${l.flags.length} flag${l.flags.length > 1 ? "s" : ""}</span>` : ""}</td><td>${l.days_worked}</td><td>${p2(l.reg_hours)}</td><td>${p2(l.ot_hours)}</td><td>${p2(l.nd_hours)}</td><td>${p2(l.basic_pay)}</td><td>${p2(l.premium_pay)}</td><td>${p2(l.ot_pay)}</td><td>${p2(l.nd_pay)}</td><td>${p2(l.leave_pay)}</td><td><b>${p2(l.gross)}</b></td><td>${p2(l.sss)}</td><td>${p2(l.philhealth)}</td><td>${p2(l.pagibig)}</td><td>${p2(l.tax)}</td><td><b>${p2(l.net)}</b></td><td></td></tr>`).join("")}
      <tr style="background:var(--soft);font-weight:700"><td>Total · ${lines.length}</td><td></td><td>${p2(tot("reg_hours"))}</td><td>${p2(tot("ot_hours"))}</td><td>${p2(tot("nd_hours"))}</td><td>${p2(tot("basic_pay"))}</td><td>${p2(tot("premium_pay"))}</td><td>${p2(tot("ot_pay"))}</td><td>${p2(tot("nd_pay"))}</td><td>${p2(tot("leave_pay"))}</td><td>${p2(tot("gross"))}</td><td>${p2(tot("sss"))}</td><td>${p2(tot("philhealth"))}</td><td>${p2(tot("pagibig"))}</td><td>${p2(tot("tax"))}</td><td>${p2(tot("net"))}</td><td></td></tr></table></div>`
      : `<div class="empty">${run ? "No lines yet." : "No payroll run for this period yet."} ${canProcess ? "Upload the timesheet, decide the exceptions, then generate." : ""}</div>`}
    <h3 style="margin-top:20px">Past runs</h3><table>${H.runs.map(r => `<tr class="row" onclick="H.from='${r.period_start}';H.to='${r.period_end}';hrLoadPeriod().then(hrRender)"><td>${fmt(pd(r.period_start))} – ${fmt(pd(r.period_end))}</td><td>${chip(r.status)}</td><td class="small muted">prepared ${esc(r.prepared_by || "")}${r.approved_by ? ` · approved ${esc(r.approved_by)}` : ""}</td><td class="num">${r.totals?.net != null ? "₱" + p2(r.totals.net) : ""}</td></tr>`).join("") || "<tr><td class='muted'>none yet</td></tr>"}</table>`;
  bindPeriod();
  if ($("#pr-gen")) $("#pr-gen").onclick = () => generatePayroll(run);
  if ($("#pr-review")) $("#pr-review").onclick = () => setRun(run, { status: "For review" }, "Sent for review");
  if ($("#pr-approve")) $("#pr-approve").onclick = () => { if (confirm("Approve this payroll run? Lines are frozen after approval.")) setRun(run, { status: "Approved" }, "Approved"); };
  if ($("#pr-reject")) $("#pr-reject").onclick = () => { const n = prompt("What should the processor fix?"); if (n === null) return; setRun(run, { status: "Draft", review_notes: n }, "Sent back"); };
  if ($("#pr-release")) $("#pr-release").onclick = () => setRun(run, { status: "Released" }, "Released");
  if ($("#pr-csv")) $("#pr-csv").onclick = () => exportCSV(run, lines);
  if ($("#pr-slips")) $("#pr-slips").onclick = () => payslips(run, lines);
}
async function setRun(run, patch, msg){ const { error } = await sb.from("payroll_runs").update(patch).eq("id", run.id); if (error) return toast(error.message); await logAct(`PAY ${run.period_start}`, msg); await hrLoad(true); hrRender(); toast(msg); }
async function generatePayroll(run){
  const emps = H.emps.filter(e => e.active);
  if (!run){ const { data, error } = await sb.from("payroll_runs").insert({ period_start: H.from, period_end: H.to, prepared_by: me.email, rules: H.rules }).select().single(); if (error) return toast(error.message); run = data; }
  else { const { error } = await sb.from("payroll_runs").update({ prepared_by: me.email, prepared_at: new Date().toISOString(), rules: H.rules }).eq("id", run.id); if (error) return toast(error.message); }
  const lines = emps.map(e => ({ run_id: run.id, employee_id: e.id, ...computeLine(e, H.from, H.to) }));
  const { error } = await sb.from("payroll_lines").upsert(lines, { onConflict: "run_id,employee_id" }); if (error) return toast(error.message);
  const totals = { gross: 0, net: 0, sss: 0, philhealth: 0, pagibig: 0, tax: 0 }; lines.forEach(l => Object.keys(totals).forEach(k => totals[k] += l[k])); Object.keys(totals).forEach(k => totals[k] = Math.round(totals[k] * 100) / 100);
  await sb.from("payroll_runs").update({ totals }).eq("id", run.id); await logAct(`PAY ${H.from}`, `Payroll computed for ${lines.length} employees, net ${peso(totals.net)}`);
  await hrLoad(true); hrRender(); toast("Payroll computed");
}
function showLine(id){
  const l = H.lines.find(x => x.id === id), e = emp(l.employee_id), D_ = l.detail?.days || [];
  openModal(`<h2>${esc(ename(e))}</h2><p class="muted small">₱${p2(e.hourly_rate)}/hour · monthly basis for contributions ₱${p2(l.detail?.monthly_base)} · ${e.mwe ? "minimum wage earner, no tax" : "taxable"}</p>
    ${(l.flags || []).length ? `<div class="card" style="border-color:#d98e04;margin-bottom:10px">${l.flags.map(f => `⚠ ${esc(f)}`).join("<br>")}</div>` : ""}
    <table class="num small"><tr><th>Date</th><th>In</th><th>Out</th><th>Break</th><th>Reg h</th><th>OT h</th><th>ND h</th><th>Rate ×</th><th>Pay</th><th>Notes</th></tr>${D_.map(d => `<tr><td>${fmt(pd(d.d))}${d.type ? ` <b>${d.type}</b>` : ""}${d.hol ? ` <span style="color:#c62828">${d.hol}</span>` : ""}</td><td>${d.in}</td><td>${d.out}</td><td>${d.brk}m</td><td>${p2(d.reg)}</td><td>${p2(d.ot)}</td><td>${p2(d.nd)}</td><td>${d.mult}</td><td>${p2(d.pay)}</td><td class="muted">${esc(d.note || "")}</td></tr>`).join("")}</table>
    <div class="kv" style="margin-top:12px"><b>Basic</b><span>₱${p2(l.basic_pay)}</span><b>Premiums (RD/holiday)</b><span>₱${p2(l.premium_pay)}</span><b>Overtime</b><span>₱${p2(l.ot_pay)}</span><b>Night differential</b><span>₱${p2(l.nd_pay)}</span><b>Leave pay</b><span>₱${p2(l.leave_pay)}</span><b>Gross</b><span><b>₱${p2(l.gross)}</b></span>
    <b>SSS</b><span>₱${p2(l.sss)}</span><b>PhilHealth</b><span>₱${p2(l.philhealth)}</span><b>Pag-IBIG</b><span>₱${p2(l.pagibig)}</span><b>Withholding tax</b><span>₱${p2(l.tax)}</span><b>Other deductions</b><span>₱${p2(l.other_deductions)}</span><b>Net pay</b><span><b>₱${p2(l.net)}</b></span></div>
    ${["Approved", "Released"].includes((H.runs.find(r => r.id === l.run_id) || {}).status) ? "" : `<div class="fields"><label class="f">Other earnings ₱ (allowance, incentive)<input id="ln-oe" type="number" value="${l.other_earnings}"></label><label class="f">Other deductions ₱ (cash advance, loan)<input id="ln-od" type="number" value="${l.other_deductions}"></label></div><div class="actions"><button class="btn primary" id="ln-save">Save adjustments</button></div>`}`);
  if ($("#ln-save")) $("#ln-save").onclick = async () => { const oe = +$("#ln-oe").value || 0, od = +$("#ln-od").value || 0; const gross = l.gross - l.other_earnings + oe; const net = gross - l.sss - l.philhealth - l.pagibig - l.tax - od;
    const { error } = await sb.from("payroll_lines").update({ other_earnings: oe, other_deductions: od, gross, net }).eq("id", l.id); if (error) return toast(error.message); closeModal(); hrRender(); };
}
function exportCSV(run, lines){
  const cols = ["employee", "days_worked", "reg_hours", "ot_hours", "nd_hours", "basic_pay", "premium_pay", "ot_pay", "nd_pay", "leave_pay", "other_earnings", "gross", "sss", "philhealth", "pagibig", "tax", "other_deductions", "net"];
  const csv = [cols.join(",")].concat(lines.map(l => cols.map(c => c === "employee" ? `"${ename(emp(l.employee_id))}"` : l[c]).join(","))).join("\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = `payroll_${run.period_start}_${run.period_end}.csv`; a.click();
}
function payslips(run, lines){
  const w = window.open("", "_blank"); const R = l => { const e = emp(l.employee_id), d = l.detail?.days || []; return `<div class="slip"><div class="hd"><b>Catchin' Up Pub</b><span>Payslip · ${fmt(pd(run.period_start))} – ${fmt(pd(run.period_end))}</span></div><h3>${esc(ename(e))}</h3><div class="muted">${esc(e.position || "")} · ${EMP_BR[e.branch] || ""} · ₱${p2(e.hourly_rate)}/h</div>
    <table class="d"><tr><th>Date</th><th>In</th><th>Out</th><th>Reg</th><th>OT</th><th>ND</th><th>Pay</th></tr>${d.map(x => `<tr><td>${fmt(pd(x.d))}${x.type ? " " + x.type : ""}${x.hol ? " " + x.hol : ""}</td><td>${x.in}</td><td>${x.out}</td><td>${p2(x.reg)}</td><td>${p2(x.ot)}</td><td>${p2(x.nd)}</td><td>${p2(x.pay)}</td></tr>`).join("")}</table>
    <table class="t"><tr><td>Basic pay</td><td>${p2(l.basic_pay)}</td><td>SSS</td><td>${p2(l.sss)}</td></tr><tr><td>Premiums</td><td>${p2(l.premium_pay)}</td><td>PhilHealth</td><td>${p2(l.philhealth)}</td></tr><tr><td>Overtime</td><td>${p2(l.ot_pay)}</td><td>Pag-IBIG</td><td>${p2(l.pagibig)}</td></tr><tr><td>Night differential</td><td>${p2(l.nd_pay)}</td><td>Withholding tax</td><td>${p2(l.tax)}</td></tr><tr><td>Leave / other</td><td>${p2(l.leave_pay + l.other_earnings)}</td><td>Other deductions</td><td>${p2(l.other_deductions)}</td></tr><tr><th>Gross</th><th>${p2(l.gross)}</th><th>Net pay</th><th>₱${p2(l.net)}</th></tr></table>
    <div class="sig"><span>Prepared: ${esc(run.prepared_by || "")}</span><span>Approved: ${esc(run.approved_by || "—")}</span><span>Received by: ____________________</span></div></div>`; };
  w.document.write(`<!doctype html><title>Payslips</title><style>body{font:11px/1.35 Arial;margin:12mm;color:#111}.slip{page-break-after:always;border:1px solid #999;padding:10px 14px;margin-bottom:10px}.hd{display:flex;justify-content:space-between;border-bottom:2px solid #111;padding-bottom:4px;margin-bottom:6px}h3{margin:4px 0 0}.muted{color:#666;margin-bottom:8px}table{border-collapse:collapse;width:100%;margin-top:6px}td,th{padding:2px 5px;border-bottom:1px solid #ddd;text-align:right}td:first-child,th:first-child{text-align:left}.t td:nth-child(3),.t th:nth-child(3){text-align:left;padding-left:24px}.sig{display:flex;justify-content:space-between;margin-top:18px;font-size:10px}@media print{.slip{page-break-after:always}}</style>${lines.map(R).join("")}<script>print()</script>`); w.document.close();
}

/* Holidays & leave */
function tabHol(){
  $("#hr-body").innerHTML = `<div class="grid"><div class="card"><h3>Holidays ${new Date().getFullYear()}</h3><table>${H.hol.map(h => `<tr><td>${fmt(pd(h.hdate))}</td><td>${esc(h.name)}</td><td>${h.kind === "regular" ? "<b>Regular</b>" : h.kind === "special" ? "Special non-working" : "Special working"}</td><td><button class="btn sm ghost" onclick="delHol('${h.id}')">✕</button></td></tr>`).join("")}</table>
      <div class="fields" style="margin-top:10px"><label class="f">Date<input id="h-date" type="date"></label><label class="f">Name<input id="h-name"></label><label class="f">Kind<select id="h-kind"><option value="regular">Regular holiday (200%)</option><option value="special">Special non-working (130%)</option><option value="special_working">Special working (no premium)</option></select></label></div><button class="btn sm" onclick="addHol()">Add holiday</button><p class="small muted">Check each year's Malacañang proclamation and adjust; Eid'l Fitr and Eid'l Adha are proclaimed separately.</p></div>
    <div class="card"><h3>Leave in this period</h3>${periodBar()}<table>${H.leaves.map(l => `<tr><td>${esc(ename(emp(l.employee_id)))}</td><td>${fmt(pd(l.leave_date))}</td><td>${l.kind}${l.paid ? "" : " (unpaid)"}</td><td>${chip(l.status === "approved" ? "Confirmed" : l.status === "rejected" ? "Lost" : "Pencil")}</td><td>${l.status === "pending" ? `<button class="btn sm" onclick="setLeave('${l.id}','approved')">Approve</button> <button class="btn sm ghost" onclick="setLeave('${l.id}','rejected')">Reject</button>` : ""}</td></tr>`).join("") || "<tr><td class='muted'>none</td></tr>"}</table>
      <div class="fields" style="margin-top:10px"><label class="f">Employee<select id="lv-e">${H.emps.filter(e => e.active).map(e => `<option value="${e.id}">${esc(ename(e))}</option>`).join("")}</select></label><label class="f">Date<input id="lv-d" type="date" value="${H.to}"></label><label class="f">Kind<select id="lv-k"><option>VL</option><option>SL</option><option>unpaid</option><option>other</option></select></label><label class="f">Paid<select id="lv-p"><option value="true">Yes</option><option value="false">No</option></select></label></div><button class="btn sm" onclick="addLeave()">Add approved leave</button></div></div>`;
  bindPeriod();
}
async function addHol(){ const { error } = await sb.from("holidays").insert({ hdate: $("#h-date").value, name: $("#h-name").value, kind: $("#h-kind").value }); if (error) return toast(error.message); await hrLoad(true); hrRender(); }
async function delHol(id){ if (!confirm("Remove this holiday?")) return; await sb.from("holidays").delete().eq("id", id); await hrLoad(true); hrRender(); }
async function addLeave(){ const { error } = await sb.from("leaves").upsert({ employee_id: $("#lv-e").value, leave_date: $("#lv-d").value, kind: $("#lv-k").value, paid: $("#lv-p").value === "true", status: "approved", decided_by: me.email, decided_at: new Date().toISOString() }, { onConflict: "employee_id,leave_date" }); if (error) return toast(error.message); await hrLoadPeriod(); hrRender(); }
async function setLeave(id, status){ const { error } = await sb.from("leaves").update({ status, decided_by: me.email, decided_at: new Date().toISOString() }).eq("id", id); if (error) return toast(error.message); await hrLoadPeriod(); hrRender(); }

/* Rules */
function tabRules(){
  const R = H.rules, owner = myRole === "owner", f = (k, l, step = "0.01") => `<label class="f">${l}<input id="r-${k}" type="number" step="${step}" value="${R[k] ?? ""}" ${owner ? "" : "disabled"}></label>`;
  $("#hr-body").innerHTML = `<div class="grid"><div class="card"><h3>Time rules</h3><div class="fields">${f("std_hours", "Standard paid hours per day", "0.5")}${f("break_min", "Lunch break (minutes) assumed when not punched", "5")}${f("tol_min", "Tolerance before a hit is listed (minutes)", "1")}${f("round_min", "Round paid time to (minutes)", "1")}</div></div>
    <div class="card"><h3>Rates (multipliers on the hourly rate)</h3><div class="fields">${f("ot_rate", "Overtime")}${f("nd_rate", "Night differential (10 PM–6 AM)")}${f("rest_day", "Rest day")}${f("special_holiday", "Special non-working day")}${f("regular_holiday", "Regular holiday")}${f("rest_day_special", "Rest day + special")}${f("rest_day_regular", "Rest day + regular holiday")}${f("ot_on_premium", "OT on a rest day / holiday")}</div>
      <label><input type="checkbox" id="r-hup" ${R.regular_holiday_unworked_paid ? "checked" : ""} ${owner ? "" : "disabled"}> Pay regular holidays even when not worked (regular employees)</label></div>
    <div class="card"><h3>Government contributions</h3><p class="small muted">Employee shares, computed on the monthly basis (employee's monthly rate, or hourly × 8 × 26). Deducted on: <select id="r-con" ${owner ? "" : "disabled"}><option value="second" ${R.contrib_on === "second" ? "selected" : ""}>the 26–10 run (once a month)</option><option value="first" ${R.contrib_on === "first" ? "selected" : ""}>the 11–25 run (once a month)</option><option value="split" ${R.contrib_on === "split" ? "selected" : ""}>both runs, half each</option></select></p>
      <div class="kv"><b>SSS</b><span>${(R.sss.ee_rate * 100).toFixed(1)}% of the monthly salary credit (₱${R.sss.min_msc.toLocaleString()}–₱${R.sss.max_msc.toLocaleString()}, steps of ₱${R.sss.step})</span><b>PhilHealth</b><span>${(R.philhealth.rate * 100).toFixed(1)}% of basic (₱${R.philhealth.min_base.toLocaleString()}–₱${R.philhealth.max_base.toLocaleString()}), employee pays half</span><b>Pag-IBIG</b><span>${(R.pagibig.ee_rate * 100).toFixed(0)}% of basic up to ₱${R.pagibig.max_base.toLocaleString()}</span><b>Withholding tax</b><span>BIR semi-monthly table; minimum wage earners exempt</span></div>
      <p class="small muted">The percentages and tables are in Supabase → settings → payroll if they change.</p></div></div>
    ${owner ? `<div class="actions"><button class="btn primary" id="r-save">Save rules</button></div>` : ""}`;
  if ($("#r-save")) $("#r-save").onclick = async () => { const v = { ...R }; ["std_hours", "break_min", "tol_min", "round_min", "ot_rate", "nd_rate", "rest_day", "special_holiday", "regular_holiday", "rest_day_special", "rest_day_regular", "ot_on_premium"].forEach(k => v[k] = +$(`#r-${k}`).value); v.regular_holiday_unworked_paid = $("#r-hup").checked; v.contrib_on = $("#r-con").value;
    const { error } = await sb.from("settings").upsert({ key: "payroll", value: v }); if (error) return toast(error.message); H.rules = v; toast("Saved"); };
}

async function viewSelfie(a, b){ const urls = []; for (const p of [a, b].filter(Boolean)){ const { data } = await sb.storage.from("selfies").createSignedUrl(p, 300); if (data) urls.push(data.signedUrl); }
  if (!urls.length) return toast("No selfie stored"); openModal(`<h2>Selfies</h2><div style="display:flex;gap:10px;flex-wrap:wrap">${urls.map(u => `<img src="${u}" style="max-width:300px;border-radius:12px">`).join("")}</div>`); }

async function inviteEmp(id){
  const e = emp(id); if (!e) return; toast(`Sending invite to ${e.email}…`);
  const { data: { session } } = await sb.auth.getSession();
  const r = await fetch(`${CFG.SUPABASE_URL}/functions/v1/hr-invite`, { method: "POST", headers: { "Content-Type": "application/json", apikey: CFG.ANON_KEY, Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ employee_id: id, redirect: location.href.replace(/manage\.html.*$/, "staff.html") }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return toast(j.error || "Invite failed");
  toast(j.mode === "invite" ? `Invite sent to ${j.email}` : `Password link sent to ${j.email}`); await hrLoad(true); hrRender();
}
