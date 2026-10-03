/* Catchin' Up · HR & Payroll module (loaded by manage.html) */
const H = { loaded: false, emps: [], sched: [], punches: [], exc: [], runs: [], lines: [], hol: [], leaves: [], imports: [], rules: {}, tab: "pay", from: "", to: "", run: null };
const EMP_BR = { sa: "Catchin' Up · San Antonio Place", ju: "Catchin' Up · Jupiter Street", fm: "Funhan Mart · Arnaiz" };
const brLogo = b => b === "fm" ? `<img src="logo-funhan.png" alt="" style="height:22px;width:auto;vertical-align:middle;margin-right:6px">` : "";
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
  { const { data: ca } = await sb.from("staff_requests").select("*").eq("kind", "cash_advance").eq("status", "approved"); H.ca = ca || []; }
  if (!H.from){ [H.from, H.to] = lastCutoff(); }
  await hrLoadPeriod(); try { await wfLoad(); } catch (e) {} H.loaded = true;
}
async function hrLoadPeriod(){
  const from = H.from, to = H.to;
  const [p, x, l, sc, im, oq] = await Promise.all([
    sb.from("punches").select("*").gte("work_date", from).lte("work_date", to).order("time_in"),
    sb.from("attendance_exceptions").select("*").gte("work_date", from).lte("work_date", to).order("work_date"),
    sb.from("leaves").select("*").gte("leave_date", from).lte("leave_date", to),
    sb.from("schedules").select("*").gte("work_date", from).lte("work_date", to),
    sb.from("timesheet_imports").select("*").order("created_at", { ascending: false }).limit(20),
    sb.from("staff_requests").select("*").in("kind", ["ot", "ut"]).eq("status", "approved").gte("work_date", from).lte("work_date", to)]);
  H.punches = p.data || []; H.exc = x.data || []; H.leaves = l.data || []; H.sched = sc.data || []; H.imports = im.data || []; H.otReq = oq.data || [];
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
  if (!hasBrk && ps.some(p => p.geo && Object.values(p.geo).some(g => g && g.field))) brk = 0; // field work: lunch is optional
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
  const cas = (H.ca || []).filter(c => c.employee_id === e.id && String(c.decided_at || "").slice(0, 10) <= to && +c.amount > +c.ca_paid).map(c => { const left = +c.amount - +c.ca_paid, inst = Math.min(left, Math.ceil(+c.amount / Math.max(1, +c.ca_terms || 1) * 100) / 100); return { id: c.id, amt: Math.round(inst * 100) / 100 }; });
  if (cas.length){ L.other_deductions = cas.reduce((a, c) => a + c.amt, 0); L.flags.push(`Cash advance deduction ${peso(L.other_deductions)}`); }
  L.net = L.gross - L.sss - L.philhealth - L.pagibig - L.tax - L.other_deductions;
  Object.keys(L).forEach(k => { if (typeof L[k] === "number") L[k] = Math.round(L[k] * 100) / 100; });
  L.detail = { days: det, hourly_rate: e.hourly_rate, monthly_base: monthlyBase(e), ca: cas };
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
  fresh.forEach(r => { const want = r.kind === "ot" ? "ot" : r.kind === "undertime" ? "ut" : null; if (want && (H.otReq || []).some(q => q.kind === want && q.employee_id === r.employee_id && q.work_date === r.work_date)) { r.status = "approved"; r.decision_note = "Pre-approved request from the staff app"; } });
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
    <div class="actions"><button class="btn primary" id="imp-go">Import ${matched.reduce((a, p) => a + p.punches.length, 0)} punches</button><button class="btn ghost keep" onclick="closeModal()">Cancel</button></div>`);
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
const HR_CAT = { pay: "H", rules: "H", exc: "G", time: "G", lineup: "G", floorplan: "G", hol: "G", emps: "F", wfcal: "G", wfreq: "G", wffeed: "G", wfann: "G", wflab: "H", wfrec: "F", opsinv: "G", opstoilet: "G", opshud: "G", opsrcv: "G" };
function hrRender(){
  const grps = Object.keys(HR_GRP).filter(g => HR_GRP_PERM[g]());
  if (!grps.length) return $("#main").innerHTML = `<div class="empty">No HR access.</div>`;
  if (!hrGrp || !grps.includes(hrGrp)) hrGrp = Object.keys(HR_GRP).find(g => grps.includes(g) && HR_GRP[g].tabs.some(([k]) => k === H.tab)) || grps[0];
  const G = HR_GRP[hrGrp], tabs = G.tabs.filter(([k]) => can(HR_CAT[k]));
  if (!tabs.some(([k]) => k === H.tab)) H.tab = tabs[0][0];
  syncNav(); ro(HR_CAT[H.tab]);
  const pend = H.exc.filter(x => x.status === "pending").length, pendEmp = H.emps.filter(e => e.status === "pending").length;
  const badge = n => n ? ` <span class="chip" style="background:#fff3df;color:#9a5f00">${n}</span>` : "";
  const sub = { people: "Everyone on payroll: details, documents, staff app access.", schedule: "Who works when, where they stand, and days off.", pay: "Each cut-off: upload the timesheet, decide the exceptions, then generate payroll.", wf: "Who is working each day, plus leave, absences, overtime and cash advance requests from the staff app.", ops: "What the team logs from the staff app: inventory movements, toilet audits, pre-shift huddles and deliveries received." }[hrGrp];
  $("#main").innerHTML = `<h1>${G.title}<span class="ro-badge">view only</span></h1><p class="ph-sub">${sub}</p>${tabs.length > 1 ? `<div class="tabs">${tabs.map(([k, l, n]) => `<button aria-pressed="${H.tab === k}" data-t="${k}">${n ? `<span class="step">${n}</span>` : ""}${l}${k === "exc" ? badge(pend) : ""}${k === "emps" ? badge(pendEmp) : ""}${k === "wfreq" ? badge(W.pend) : ""}</button>`).join("")}</div>` : ""}<div id="hr-body"></div>`;
  document.querySelectorAll("#main .tabs button").forEach(b => b.onclick = () => { H.tab = b.dataset.t; hrRender(); });
  ({ pay: tabPay, exc: tabExc, time: tabTime, lineup: tabLineup, emps: tabEmps, floorplan: tabFloor, hol: tabHol, rules: tabRules, wfcal: tabWfCal, wfreq: tabWfReq, wffeed: tabWfFeed, wfann: tabWfAnn, wflab: tabWfLabor, wfrec: tabWfRec, opsinv: tabOpsInv, opstoilet: tabOpsToilet, opshud: tabOpsHuddle, opsrcv: tabOpsRcv })[H.tab](); if (H.tab !== "wffeed") wfFeedOff();
  const nbHr = (g, n) => { const b = document.querySelector(`#nav button[data-g=${g}]`); if (!b) return; b.querySelector(".nb")?.remove(); if (n) b.insertAdjacentHTML("beforeend", `<span class="nb">${n}</span>`); };
  nbHr("pay", pend); nbHr("people", pendEmp); nbHr("wf", W.pend);
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
    ${regBanner()}${pending.length ? `<div class="card" style="border-color:#d98e04;margin-bottom:12px">⏳ <b>${pending.length}</b> registration${pending.length > 1 ? "s" : ""} waiting for your review. Click a row to check the details and ID, set the rate, then approve.</div>` : ""}
    <p class="muted small">Send the registration link to new hires: <a href="${regLink}" target="_blank">${regLink}</a>. They fill in their details, government numbers, a photo of their valid ID and a selfie. ${rows.length} of ${H.emps.length} shown.</p>
    <div style="overflow:auto"><table><tr><th></th><th>Employee</th><th>Branch</th><th>Position</th><th>Mobile</th><th>SSS · PhilHealth · Pag-IBIG · TIN</th><th>Hired</th><th>Rate/h</th><th>Status</th><th>Staff app</th></tr>
    ${rows.map(e => `<tr class="row" onclick="showEmp('${e.id}')"><td><div class="avatar" data-sf="${esc(e.selfie || "")}" id="av-${e.id}"></div></td><td><b>${esc(ename(e))}</b>${e.middle_name ? ` <span class="muted small">${esc(e.middle_name)}</span>` : ""}<br><span class="small muted">${esc(e.email || "")}</span></td><td class="small">${brLogo(e.branch)}${EMP_BR[e.branch] || esc(e.branch || "")}</td><td class="small">${esc(e.position || "")}${e.role ? ` · <b>${esc(e.role)}</b>` : ""}<br><span class="muted">${esc(e.employment_type || "")}${e.access ? " · " + Object.entries(e.access).filter(([, v]) => v).map(([k]) => ({ clock: "clock", schedule: "sched", payslips: "pay", floor: "floor" })[k]).join(", ") : ""}</span></td><td class="small">${esc(e.mobile || "")}</td><td class="small muted">${[e.sss_no, e.philhealth_no, e.pagibig_no, e.tin].map(x => x ? esc(x) : "<span style='color:#c62828'>—</span>").join(" · ")}</td><td class="small">${e.date_hired ? fmt(pd(e.date_hired)) : e.registered_at ? `<span class="muted">reg. ${fmt(pd(e.registered_at))}</span>` : ""}</td><td class="num">${+e.hourly_rate ? "₱" + p2(e.hourly_rate) : "<span class='chip' style='background:#fff3df;color:#9a5f00'>set</span>"}</td><td>${stChip(e)}${regChip(e)}<br><span class="hpc" data-hp="${e.id}"></span></td>
      <td onclick="event.stopPropagation()">${e.status !== "active" ? "" : e.invited_at ? `<span class="small muted">invited ${fmt(pd(e.invited_at))}</span><br><button class="btn sm ghost" onclick="inviteEmp('${e.id}')">Resend</button>` : e.email ? `<button class="btn sm" onclick="inviteEmp('${e.id}')">Send invite</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="10" class="empty">No employees match.</td></tr>`}</table></div>`;
  ["q", "br", "st", "sort"].forEach(k => { const el = $(`#ef-${k}`); el[k === "q" ? "oninput" : "onchange"] = () => { ef[k] = el.value; hrRender(); }; });
  if (!document.getElementById("av-css")) { const st = document.createElement("style"); st.id = "av-css"; st.textContent = ".avatar{width:38px;height:38px;border-radius:50%;background:var(--soft) center/cover no-repeat;border:1px solid var(--line)}"; document.head.appendChild(st); }
  hpFill();
  rows.filter(e => e.selfie).forEach(async e => { const { data } = await sb.storage.from("employee-docs").createSignedUrl(e.selfie, 600); const el = document.getElementById("av-" + e.id); if (data && el) el.style.backgroundImage = `url(${data.signedUrl})`; });
}
const EMPD_CSS = `<style id="empd-css">.empd{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;margin-top:16px}.empd section{border:1px solid var(--line);border-radius:12px;padding:14px 16px;background:var(--card,transparent)}.empd h4{margin:0 0 10px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted,#888)}.empd .r{padding:7px 0;border-top:1px solid var(--line)}.empd .r:first-of-type{border-top:0;padding-top:0}.empd .k{font-size:12px;color:var(--muted,#888);margin-bottom:2px}.empd .v{font-size:15px;line-height:1.45;word-break:break-word}.empd .n{font-variant-numeric:tabular-nums;letter-spacing:.03em}.empd .sub{font-size:12.5px;color:var(--muted,#888);margin-top:2px}.empd .big{font-size:20px;font-weight:700}</style>`;
function empDetail(e){
  if (!document.getElementById("empd-css")) document.head.insertAdjacentHTML("beforeend", EMPD_CSS);
  const r = (k, v, o = {}) => v || v === 0 ? `<div class="r"><div class="k">${k}</div><div class="v${o.num ? " n" : ""}${o.big ? " big" : ""}">${o.raw ? v : esc(String(v))}</div>${o.sub ? `<div class="sub">${esc(o.sub)}</div>` : ""}</div>` : "";
  const sec = (t, body) => body.trim() ? `<section><h4>${t}</h4>${body}</section>` : "";
  const yrs = e.date_hired ? (() => { const d = pd(e.date_hired), t = new Date(); let m = (t.getFullYear() - d.getFullYear()) * 12 + t.getMonth() - d.getMonth(); if (t.getDate() < d.getDate()) m--; const y = Math.floor(m / 12); m %= 12; return `${y ? y + " yr" + (y > 1 ? "s" : "") : ""}${y && m ? " " : ""}${m ? m + " mo" : ""}` || "new"; })() : "";
  const full = d => d ? pd(d).toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" }) : "";
  const age = e.birthdate ? (() => { const d = pd(e.birthdate), t = new Date(); let a = t.getFullYear() - d.getFullYear(); if (t < new Date(t.getFullYear(), d.getMonth(), d.getDate())) a--; return a > 0 && a < 100 ? `${a} years old` : ""; })() : "";
  return `<div class="empd">
    ${sec("Contact", r("Email", e.email) + r("Mobile", e.mobile, { num: 1 }) + r("Address", e.address))}
    ${sec("Personal", r("Birthdate", full(e.birthdate), { sub: age }) + r("Gender", e.gender) + r("Civil status", e.civil_status) + r("Emergency contact", e.emergency_name, { sub: [e.emergency_relation, e.emergency_mobile].filter(Boolean).join(" · ") }))}
    ${sec("Employment", r("Employee no.", e.emp_no, { num: 1 }) + r("Date hired", full(e.date_hired), { sub: yrs ? yrs + " of service" : "" }) + r("Hourly rate", +e.hourly_rate ? "₱" + p2(e.hourly_rate) : "", { num: 1 }))}
    ${sec("Leave", e.vl_credits != null ? r("Leave credits", `${+e.vl_credits} hrs`, { big: 1, sub: `= ${(+e.vl_credits / 8).toFixed(1).replace(".0", "")} days` }) + (e.date_hired ? r("Next +40 hours", full(iso(nextAnniv(e.date_hired)))) : "") : "")}
    ${sec("Government numbers", r("SSS", e.sss_no, { num: 1 }) + r("PhilHealth", e.philhealth_no, { num: 1 }) + r("Pag-IBIG", e.pagibig_no, { num: 1 }) + r("TIN", e.tin, { num: 1 }) + r("Valid ID", e.id_type, { sub: e.id_number || "" }))}
    ${sec("Notes", r("From the employee", e.notes) + r("Privacy consent", e.consent?.accepted ? "Given " + fmtTs(e.consent.at) : "", { sub: e.consent?.version || "" }))}
  </div>`;
}
async function showEmp(id){
  const e = emp(id); if (!e) return; const st = e.status || (e.active ? "active" : "inactive");
  const kv = (k, v) => v ? `<b>${k}</b><span>${esc(v)}</span>` : "";
  openModal(`<div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap"><div id="em-sf" style="width:96px;height:96px;border-radius:14px;background:var(--soft) center/cover;border:1px solid var(--line);flex:none"></div><div><h2 style="margin:0">${esc(ename(e))}${e.suffix ? " " + esc(e.suffix) : ""}</h2><div class="muted">${esc(e.position || "")} · ${EMP_BR[e.branch] || esc(e.branch || "")} · ${esc(e.employment_type || "")}</div><div style="margin-top:6px"><span class="chip ${st === "active" ? "c-Confirmed" : st === "pending" ? "c-Pencil" : "c-Lost"}">${st}</span>${e.registered_at ? ` <span class="small muted">registered online ${fmtTs(e.registered_at)}</span>` : ""}</div></div></div>
    ${empDetail(e)}
    ${regCard(e)}<div id="em-hp" style="margin-top:12px"></div><div id="em-id" style="margin:10px 0"></div>
    ${st === "pending" ? `<div class="card" style="border-color:#d98e04"><h3>Approve this registration</h3><div class="fields"><label class="f">Hourly rate ₱<input id="ap-rate" type="number" step="0.01" value="${e.hourly_rate || ""}"></label><label class="f">Date hired<input id="ap-hired" type="date" value="${e.date_hired || iso(today)}"></label><label class="f">Default shift start<input id="ap-start" type="time" value="${String(e.default_start || "").slice(0, 5)}"></label><label class="f">Default shift end<input id="ap-end" type="time" value="${String(e.default_end || "").slice(0, 5)}"></label><label class="f">Break minutes<input id="ap-brk" type="number" value="${e.default_break_min ?? 60}"></label><label class="f">Role<select id="ap-role">${["", "Server", "Bartender", "Cashier", "Kitchen", "Floor manager", "Security", "Admin", "Other"].map(r => `<option value="${r}" ${(e.role || "") === r ? "selected" : ""}>${r || "—"}</option>`).join("")}</select></label></div>
      <div class="small muted" style="font-weight:700;margin-top:6px">Staff app access</div><div style="display:flex;gap:14px;flex-wrap:wrap;margin:4px 0 6px">${[["clock", "Time clock"], ["schedule", "Schedule & leave"], ["payslips", "Payroll"], ["team", "Team feed & chat"], ["operations", "Operations"], ["floor", "Floor plan"], ["records", "My file"], ["flex", "Admin log-ins (in/out many times a day, no lunch)"]].map(([k, l]) => `<label><input type="checkbox" class="ap-acc" value="${k}" ${k !== "floor" && k !== "flex" ? "checked" : ""}> ${l}</label>`).join("")}</div>
      <div class="actions"><button class="btn primary" id="ap-go">Approve and send staff-app invite</button><button class="btn ghost" id="ap-no">Reject</button></div></div>` : ""}
    <div class="actions"><button class="btn" onclick="closeModal();editEmp('${e.id}')">Edit details</button>${st === "active" ? `<button class="btn ghost" onclick="setEmpStatus('${e.id}','inactive')">Mark separated</button>` : st === "inactive" ? `<button class="btn ghost" onclick="setEmpStatus('${e.id}','active')">Reactivate</button>` : ""}<button class="btn ghost keep" onclick="closeModal()">Close</button></div>`);
  if (st === "active") hpShow(e.id);
  if (e.selfie){ const { data } = await sb.storage.from("employee-docs").createSignedUrl(e.selfie, 600); if (data) $("#em-sf").style.backgroundImage = `url(${data.signedUrl})`; }
  if (e.id_photo){ const { data } = await sb.storage.from("employee-docs").createSignedUrl(e.id_photo, 600); if (data) $("#em-id").innerHTML = `<div class="small muted" style="margin-bottom:4px">Valid ID (click to open)</div><a href="${data.signedUrl}" target="_blank"><img src="${data.signedUrl}" style="max-width:100%;max-height:260px;border-radius:10px;border:1px solid var(--line)"></a>`; }
  if ($("#ap-go")) $("#ap-go").onclick = async () => { const rate = +$("#ap-rate").value; if (!rate) return toast("Set the hourly rate first");
    const access = Object.fromEntries(["clock", "schedule", "payslips", "team", "operations", "floor", "records", "flex"].map(k => [k, !!document.querySelector(`.ap-acc[value=${k}]:checked`)]));
    const { error } = await sb.from("employees").update({ status: "active", active: true, hourly_rate: rate, role: $("#ap-role").value || null, access, date_hired: $("#ap-hired").value || null, default_start: $("#ap-start").value || null, default_end: $("#ap-end").value || null, default_break_min: +$("#ap-brk").value || 60, updated_at: new Date().toISOString() }).eq("id", e.id); if (error) return toast(error.message);
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
    ${f("date_hired", "Date hired", "date")}${f("sss_no", "SSS no.")}${f("philhealth_no", "PhilHealth no.")}${f("pagibig_no", "Pag-IBIG no.")}${f("tin", "TIN")}${f("vl_credits", "Leave credits (hours)", "number")}
    <label class="f">Role<select id="e-role">${["", "Server", "Bartender", "Cashier", "Kitchen", "Floor manager", "Security", "Admin", "Other"].map(r => `<option value="${r}" ${(e.role || "") === r ? "selected" : ""}>${r || "—"}</option>`).join("")}</select></label>
    <label class="f">Active<select id="e-active"><option value="true" ${e.active ? "selected" : ""}>Yes</option><option value="false" ${!e.active ? "selected" : ""}>No (separated)</option></select></label></div>
    <div class="f" style="font-size:13px;font-weight:700;color:var(--muted)">Staff app access (what they can open)</div><div style="display:flex;gap:14px;flex-wrap:wrap;margin:4px 0 10px">${[["clock", "Time clock"], ["schedule", "Schedule & leave"], ["payslips", "Payroll & timesheet"], ["team", "Team feed & chat"], ["operations", "Operations (inventory, toilet audit, huddle, receiving)"], ["floor", "Floor plan (seat guests, walk-ins)"], ["records", "My file (memos, evaluations)"], ["flex", "Admin log-ins (in/out many times a day, no lunch)"]].map(([k, l]) => `<label><input type="checkbox" class="e-acc" value="${k}" ${({ clock: true, schedule: true, payslips: true, team: true, operations: true, records: true, ...(e.access || {}) })[k] ? "checked" : ""}> ${l}</label>`).join("")}</div>
    <div class="f" style="font-size:13px;font-weight:700;color:var(--muted)">Rest days</div><div style="display:flex;gap:10px;flex-wrap:wrap;margin:4px 0 10px">${DAYS.map((d, i) => `<label><input type="checkbox" class="e-rd" value="${i}" ${(e.rest_days || []).includes(i) ? "checked" : ""}> ${d}</label>`).join("")}</div>
    <label class="f">Notes<textarea id="e-notes" rows="2">${esc(e.notes || "")}</textarea></label>
    <div class="actions"><button class="btn primary" id="e-save">Save</button><button class="btn ghost keep" onclick="closeModal()">Cancel</button></div>`);
  $("#e-save").onclick = async () => {
    const v = {}; ["last_name", "first_name", "email", "mobile", "branch", "position", "employment_type", "sss_no", "philhealth_no", "pagibig_no", "tin", "notes"].forEach(k => v[k] = $(`#e-${k}`).value.trim() || null);
    v.email = v.email ? v.email.toLowerCase() : null; ["hourly_rate", "monthly_rate", "default_break_min", "vl_credits"].forEach(k => v[k] = $(`#e-${k}`).value === "" ? null : +$(`#e-${k}`).value);
    v.hourly_rate = v.hourly_rate || 0; v.default_break_min = v.default_break_min ?? 60; v.mwe = $("#e-mwe").value === "true"; v.active = $("#e-active").value === "true"; v.status = v.active ? "active" : "inactive";
    v.default_start = $("#e-default_start").value || null; v.default_end = $("#e-default_end").value || null; v.date_hired = $("#e-date_hired").value || null;
    v.rest_days = [...document.querySelectorAll(".e-rd:checked")].map(x => +x.value); v.updated_at = new Date().toISOString();
    v.role = $("#e-role").value || null; v.access = Object.fromEntries(["clock", "schedule", "payslips", "team", "operations", "floor", "records", "flex"].map(k => [k, !!document.querySelector(`.e-acc[value=${k}]:checked`)]));
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
    <div class="actions"><button class="btn primary" id="sh-save">Save</button>${s.id ? `<button class="btn ghost" id="sh-del">Clear day</button>` : ""}<button class="btn ghost keep" onclick="closeModal()">Cancel</button></div>`);
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
    ${(() => { const none = H.emps.filter(e => e.active && !(byEmp[e.id] || []).length); return !H.punches.length ? `<div class="empty">No punches for this period yet. Upload the timesheet CSV to start.</div>` : none.length ? `<p class="muted small"><b>No punches yet (${none.length}):</b> ${none.map(e => esc(ename(e))).join(", ")}</p>` : ""; })()}
    <div class="grid">${H.emps.filter(e => e.active && (byEmp[e.id] || []).length).map(e => { const ps = (byEmp[e.id] || []); const byDay = {}; ps.forEach(p => (byDay[p.work_date] = byDay[p.work_date] || []).push(p));
      return `<div class="card"><h3>${esc(ename(e))} <span class="muted small">${Object.keys(byDay).length} days</span></h3>${ps.length ? `<table>${Object.entries(byDay).sort().map(([d, xs]) => { const a = analyzeDay(e, d); return `<tr><td>${fmt(pd(d))}</td><td class="num">${xs.map(p => `${hhmm(p.time_in)}–${p.time_out ? hhmm(p.time_out) : "<b style='color:#c62828'>?</b>"}${p.lunch_out ? ` <span class="muted">(L ${hhmm(p.lunch_out)}–${hhmm(p.lunch_in)})</span>` : ""}${p.source === "app" ? ` <a href="#" onclick="viewSelfie('${p.selfie_in || ""}','${p.selfie_out || ""}');return false" title="selfies">📱</a>` : ""}${fieldChip(p)}${p.offsite ? ` <span class="chip c-Lost" title="${esc(geoNote(p))}">off-site</span>` : ""}`).join("<br>")}</td><td class="num">${hm(a.paid)}</td><td class="small">${a.exc.map(x => `<span class="chip" style="background:${NEEDS_OK.includes(x[0]) ? "#fff3df" : "#f1f1f1"};color:#555">${KINDN[x[0]]}</span>`).join(" ")}</td></tr>`; }).join("")}</table>` : `<div class="muted small">No punches in this period</div>`}</div>`; }).join("")}</div>`;
  bindPeriod(); $("#ts-file").onchange = ev => { if (ev.target.files[0]) importTimesheet(ev.target.files[0]); };
}
function manualPunch(){
  openModal(`<h2>Add a punch by hand</h2><div class="fields"><label class="f">Employee<select id="mp-e">${H.emps.filter(e => e.active).map(e => `<option value="${e.id}">${esc(ename(e))}</option>`).join("")}</select></label><label class="f">Work date<input id="mp-d" type="date" value="${H.to}"></label><label class="f">Time in<input id="mp-in" type="datetime-local"></label><label class="f">Time out<input id="mp-out" type="datetime-local"></label><label class="f">Note<input id="mp-note"></label></div>
    <div class="actions"><button class="btn primary" id="mp-save">Save</button><button class="btn ghost keep" onclick="closeModal()">Cancel</button></div>`);
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
  const canProcess = can("H", "edit"), canApprove = sw("H3");
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
  if ($("#pr-release")) $("#pr-release").onclick = () => releaseRun(run);
  if ($("#pr-csv")) $("#pr-csv").onclick = () => exportCSV(run, lines);
  if ($("#pr-slips")) $("#pr-slips").onclick = () => payslips(run, lines);
}
async function setRun(run, patch, msg){ const { error } = await sb.from("payroll_runs").update(patch).eq("id", run.id); if (error) return toast(error.message); await logAct(`PAY ${run.period_start}`, msg); await hrLoad(true); hrRender(); toast(msg); }
async function releaseRun(run){ // marks cash-advance installments as paid, then releases payslips
  if (run.status === "Released") return; const { data: lines } = await sb.from("payroll_lines").select("employee_id,detail").eq("run_id", run.id);
  const paid = {}; (lines || []).forEach(l => (l.detail?.ca || []).forEach(c => paid[c.id] = (paid[c.id] || 0) + c.amt));
  for (const [id, amt] of Object.entries(paid)){ const c = (H.ca || []).find(x => x.id === id); if (!c) continue; const { error } = await sb.from("staff_requests").update({ ca_paid: Math.min(+c.amount, Math.round((+c.ca_paid + amt) * 100) / 100) }).eq("id", id); if (error) return toast(error.message); }
  await setRun(run, { status: "Released" }, "Released"); await hrLoad(true); hrRender(); }
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
  const R = H.rules, owner = sw("H4"), f = (k, l, step = "0.01") => `<label class="f">${l}<input id="r-${k}" type="number" step="${step}" value="${R[k] ?? ""}" ${owner ? "" : "disabled"}></label>`;
  $("#hr-body").innerHTML = `<div class="grid"><div class="card"><h3>Time rules</h3><div class="fields">${f("std_hours", "Standard paid hours per day", "0.5")}${f("break_min", "Lunch break (minutes) assumed when not punched", "5")}${f("tol_min", "Tolerance before a hit is listed (minutes)", "1")}${f("round_min", "Round paid time to (minutes)", "1")}</div></div>
    <div class="card"><h3>Rates (multipliers on the hourly rate)</h3><div class="fields">${f("ot_rate", "Overtime")}${f("nd_rate", "Night differential (10 PM–6 AM)")}${f("rest_day", "Rest day")}${f("special_holiday", "Special non-working day")}${f("regular_holiday", "Regular holiday")}${f("rest_day_special", "Rest day + special")}${f("rest_day_regular", "Rest day + regular holiday")}${f("ot_on_premium", "OT on a rest day / holiday")}</div>
      <label><input type="checkbox" id="r-hup" ${R.regular_holiday_unworked_paid ? "checked" : ""} ${owner ? "" : "disabled"}> Pay regular holidays even when not worked (regular employees)</label></div>
    <div class="card"><h3>Government contributions</h3><p class="small muted">Employee shares, computed on the monthly basis (employee's monthly rate, or hourly × 8 × 26). Deducted on: <select id="r-con" ${owner ? "" : "disabled"}><option value="second" ${R.contrib_on === "second" ? "selected" : ""}>the 26–10 run (once a month)</option><option value="first" ${R.contrib_on === "first" ? "selected" : ""}>the 11–25 run (once a month)</option><option value="split" ${R.contrib_on === "split" ? "selected" : ""}>both runs, half each</option></select></p>
      <div class="kv"><b>SSS</b><span>${(R.sss.ee_rate * 100).toFixed(1)}% of the monthly salary credit (₱${R.sss.min_msc.toLocaleString()}–₱${R.sss.max_msc.toLocaleString()}, steps of ₱${R.sss.step})</span><b>PhilHealth</b><span>${(R.philhealth.rate * 100).toFixed(1)}% of basic (₱${R.philhealth.min_base.toLocaleString()}–₱${R.philhealth.max_base.toLocaleString()}), employee pays half</span><b>Pag-IBIG</b><span>${(R.pagibig.ee_rate * 100).toFixed(0)}% of basic up to ₱${R.pagibig.max_base.toLocaleString()}</span><b>Withholding tax</b><span>BIR semi-monthly table; minimum wage earners exempt</span></div>
      <p class="small muted">The percentages and tables are in Supabase → settings → payroll if they change.</p></div></div>
    <div class="card"><h3>Leave credits</h3><p class="small muted">Added to every active employee's balance on the 1st of each month. Approved paid leave is deducted automatically; days beyond the balance are approved as unpaid.</p><div class="fields"><label class="f">Vacation leave per month<input id="r-lvl" type="number" step="0.25" value="${R.leave_accrual?.vl ?? 0}" ${owner ? "" : "disabled"}></label><label class="f">Sick leave per month<input id="r-lsl" type="number" step="0.25" value="${R.leave_accrual?.sl ?? 0}" ${owner ? "" : "disabled"}></label><label class="f">Who earns credits<select id="r-lty" ${owner ? "" : "disabled"}><option value="regular" ${(R.leave_accrual?.types || ["regular"]).length === 1 ? "selected" : ""}>Regular employees only</option><option value="all" ${(R.leave_accrual?.types || []).length > 1 ? "selected" : ""}>Regular and probationary</option></select></label></div></div>
    ${owner ? `<div class="actions"><button class="btn primary" id="r-save">Save rules</button></div>` : ""}
    <div class="card" id="att-card"><h3>Attendance health</h3><p class="small muted">Loading…</p></div>`;
  attCard(owner);
  if ($("#r-save")) $("#r-save").onclick = async () => { const v = { ...R }; v.leave_accrual = { vl: +$("#r-lvl").value || 0, sl: +$("#r-lsl").value || 0, types: $("#r-lty").value === "all" ? ["regular", "probationary"] : ["regular"] }; ["std_hours", "break_min", "tol_min", "round_min", "ot_rate", "nd_rate", "rest_day", "special_holiday", "regular_holiday", "rest_day_special", "rest_day_regular", "ot_on_premium"].forEach(k => v[k] = +$(`#r-${k}`).value); v.regular_holiday_unworked_paid = $("#r-hup").checked; v.contrib_on = $("#r-con").value;
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

/* Floor plan editor: drag tables into the real layout; staff see it in their app */
let fp = { branch: "sa", area: "", tables: [] };
async function tabFloor(){
  const { data } = await sb.from("floor_tables").select("*").eq("branch", fp.branch).order("code"); fp.tables = data || [];
  const areas = [...new Set(fp.tables.map(t => t.area))]; if (!fp.area || !areas.includes(fp.area)) fp.area = areas[0] || "";
  const list = fp.tables.filter(t => t.area === fp.area && t.active); const W = Math.max(...list.map(t => t.x), 600) + 140, Hh = Math.max(...list.map(t => t.y), 300) + 120;
  $("#hr-body").innerHTML = `<div class="toolbar"><select id="fp-br">${Object.entries(BRN).map(([k, v]) => `<option value="${k}" ${fp.branch === k ? "selected" : ""}>${v}</option>`).join("")}</select><select id="fp-area">${areas.map(a => `<option ${a === fp.area ? "selected" : ""}>${a}</option>`).join("")}</select><button class="btn sm" id="fp-add">Add table</button><button class="btn sm primary" id="fp-save">Save layout</button><span class="muted small">Drag tables to match the room. Double-click a table to rename, change seats, square/round, or retire it. ${list.length} tables in ${esc(fp.area)}.</span></div>
    <div style="overflow:auto;border:1px solid var(--line);border-radius:12px;background:#fafafa"><div id="fp-canvas" style="position:relative;width:${W}px;height:${Hh}px;background-image:linear-gradient(#eee 1px,transparent 1px),linear-gradient(90deg,#eee 1px,transparent 1px);background-size:20px 20px">${list.map(t => `<div class="fp-t" data-id="${t.id}" style="position:absolute;left:${t.x}px;top:${t.y}px;width:84px;height:72px;border-radius:${t.shape === "square" ? "12px" : "50%"};border:2px solid var(--ink);background:#fff;display:grid;place-items:center;cursor:grab;user-select:none;font-weight:700">${esc(t.code)}<span class="small muted" style="font-weight:400">${t.seats} seats</span></div>`).join("")}</div></div>`;
  $("#fp-br").onchange = e => { fp.branch = e.target.value; fp.area = ""; hrRender(); }; $("#fp-area").onchange = e => { fp.area = e.target.value; hrRender(); };
  const cv = $("#fp-canvas"); let drag = null;
  cv.querySelectorAll(".fp-t").forEach(el => { el.onpointerdown = e => { drag = { el, dx: e.clientX - el.offsetLeft, dy: e.clientY - el.offsetTop }; el.setPointerCapture(e.pointerId); };
    el.onpointermove = e => { if (!drag || drag.el !== el) return; el.style.left = Math.max(0, Math.round((e.clientX - drag.dx) / 10) * 10) + "px"; el.style.top = Math.max(0, Math.round((e.clientY - drag.dy) / 10) * 10) + "px"; };
    el.onpointerup = () => { drag = null; }; el.ondblclick = () => editTable(el.dataset.id); });
  $("#fp-save").onclick = async () => { const rows = [...cv.querySelectorAll(".fp-t")].map(el => ({ id: el.dataset.id, x: parseInt(el.style.left), y: parseInt(el.style.top) })); for (const r of rows){ await sb.from("floor_tables").update({ x: r.x, y: r.y }).eq("id", r.id); } toast("Layout saved"); };
  $("#fp-add").onclick = async () => { const code = prompt("Table code (e.g. I44 or VIP1)"); if (!code) return; const { error } = await sb.from("floor_tables").insert({ branch: fp.branch, area: fp.area, code: code.trim(), x: 40, y: 40 }); if (error) return toast(error.message); hrRender(); };
}
function editTable(id){ const t = fp.tables.find(x => x.id === id);
  openModal(`<h2>Table ${esc(t.code)}</h2><div class="fields"><label class="f">Code<input id="ft-code" value="${esc(t.code)}"></label><label class="f">Seats<input id="ft-seats" type="number" value="${t.seats}"></label><label class="f">Shape<select id="ft-shape"><option value="round" ${t.shape === "round" ? "selected" : ""}>Round</option><option value="square" ${t.shape === "square" ? "selected" : ""}>Square</option></select></label><label class="f">Area<input id="ft-area" value="${esc(t.area)}"></label></div>
    <div class="actions"><button class="btn primary" id="ft-save">Save</button><button class="btn ghost" id="ft-retire">Retire table</button><button class="btn ghost keep" onclick="closeModal()">Cancel</button></div>`);
  $("#ft-save").onclick = async () => { const { error } = await sb.from("floor_tables").update({ code: $("#ft-code").value.trim(), seats: +$("#ft-seats").value || 2, shape: $("#ft-shape").value, area: $("#ft-area").value.trim() }).eq("id", id); if (error) return toast(error.message); closeModal(); hrRender(); };
  $("#ft-retire").onclick = async () => { if (!confirm("Retire this table? It disappears from the floor plan; bookings keep their history.")) return; await sb.from("floor_tables").update({ active: false }).eq("id", id); closeModal(); hrRender(); };
}

/* ---------- Workforce Management: team calendar + staff requests ---------- */
const REQ_N = { late: "Running late", absent_sick: "Absent · sick", absent_emergency: "Absent · emergency", absent_other: "Absent · other reason", ot: "Overtime request", ut: "Undertime request", cash_advance: "Cash advance", leave: "Leave request" };
const LEAVE_N = { VL: "Vacation leave", SL: "Sick leave", EL: "Emergency leave", unpaid: "Leave without pay", other: "Other leave" };
const W = { m: null, br: "", sched: [], leaves: [], reqs: [], sel: null, filt: "pending", pend: 0 };
async function wfLoad(){
  if (!W.m){ const t = new Date(); W.m = new Date(t.getFullYear(), t.getMonth(), 1); }
  const a = new Date(W.m), b = new Date(W.m.getFullYear(), W.m.getMonth() + 1, 0);
  const from = iso(a), to = iso(b);
  const [sc, lv, rq, rqAll, lvP] = await Promise.all([
    sb.from("schedules").select("*").gte("work_date", from).lte("work_date", to),
    sb.from("leaves").select("*").gte("leave_date", from).lte("leave_date", to),
    sb.from("staff_requests").select("*").gte("work_date", from).lte("work_date", to),
    sb.from("staff_requests").select("*").order("created_at", { ascending: false }).limit(300),
    sb.from("leaves").select("*").order("created_at", { ascending: false }).limit(400)]);
  const [sw, ms] = await Promise.all([sb.from("shift_swaps").select("*").order("created_at", { ascending: false }).limit(200), sb.from("missed_alerts").select("*").gte("work_date", iso(new Date(Date.now() - 2 * 86400000))).is("resolved_at", null)]);
  W.swaps = sw.data || []; W.missed = ms.data || [];
  const pu = await sb.from("punches").select("id,employee_id,work_date,time_in,lunch_out,lunch_in,time_out,geo").gte("work_date", from).lte("work_date", to).limit(5000); W.punches = pu.data || [];
  W.sched = sc.data || []; W.leaves = lv.data || []; W.reqs = rq.data || []; W.all = rqAll.data || []; W.allLeaves = lvP.data || [];
  W.pend = W.all.filter(r => r.status === "pending").length + leaveGroups(W.allLeaves).filter(g => g.status === "pending").length + W.swaps.filter(w => w.status === "accepted").length + W.missed.length;
}
function wfSched(e, d){ // same rules as the payroll engine, read from this month's line-up
  const s = W.sched.find(x => x.employee_id === e.id && x.work_date === d);
  if (s) return s.kind === "work" ? { kind: "work", st: s.start_time, en: s.end_time } : { kind: s.kind === "rest" ? "rest" : s.kind };
  if ((e.rest_days || []).includes(pd(d).getDay())) return { kind: "rest" };
  if (e.default_start) return { kind: "work", st: e.default_start, en: e.default_end };
  return { kind: "none" };
}
function wfDay(d){
  const out = { work: [], off: [], leave: [], sick: [], absent: [], late: [], pendLeave: [] };
  H.emps.filter(e => e.active && (!W.br || e.branch === W.br) && (!e.date_hired || e.date_hired <= d)).forEach(e => {
    const lv = W.leaves.find(l => l.employee_id === e.id && l.leave_date === d && l.status !== "rejected");
    const rq = W.reqs.filter(r => r.employee_id === e.id && r.work_date === d && r.status !== "declined");
    const sc = wfSched(e, d);
    if (lv && lv.status === "approved") return out.leave.push([e, LEAVE_N[lv.kind] || lv.kind]);
    if (rq.some(r => r.kind === "absent_sick")) return out.sick.push([e, rq.find(r => r.kind === "absent_sick").reason || ""]);
    if (rq.some(r => r.kind.startsWith("absent"))) { const r = rq.find(r => r.kind.startsWith("absent")); return out.absent.push([e, REQ_N[r.kind] + (r.reason ? " · " + r.reason : "")]); }
    if (sc.kind === "rest" || sc.kind === "none") return out.off.push([e, sc.kind === "rest" ? "Rest day" : "No shift set"]);
    if (sc.kind !== "work") return out.leave.push([e, sc.kind]);
    out.work.push([e, `${String(sc.st || "").slice(0, 5)}–${String(sc.en || "").slice(0, 5)}`]);
    if (rq.some(r => r.kind === "late")) out.late.push([e, "ETA " + (rq.find(r => r.kind === "late").eta || "—")]);
    if (lv && lv.status === "pending") out.pendLeave.push([e, (LEAVE_N[lv.kind] || lv.kind) + " · awaiting approval"]);
  });
  return out;
}
async function tabWfCal(){
  $("#hr-body").innerHTML = `<div class="empty">Loading…</div>`; await wfLoad();
  const y = W.m.getFullYear(), mo = W.m.getMonth(), first = new Date(y, mo, 1), days = new Date(y, mo + 1, 0).getDate(), todayK = iso(new Date());
  const cells = []; for (let k = 0; k < first.getDay(); k++) cells.push(`<div></div>`);
  for (let dd = 1; dd <= days; dd++){ const k = iso(new Date(y, mo, dd)), x = wfDay(k);
    cells.push(`<div class="day${k === todayK ? " today" : ""}${W.sel === k ? " wf-sel" : ""}" onclick="W.sel='${k}';tabWfCalDraw()"><div class="d"><span>${dd}</span></div>
      <div class="wf-n"><span class="wf-c wf-w" title="Scheduled">${x.work.length}</span><span>on shift</span></div>
      ${x.off.length ? `<div class="wf-n"><span class="wf-c wf-o">${x.off.length}</span><span>off</span></div>` : ""}
      ${x.leave.length ? `<div class="wf-n"><span class="wf-c wf-l">${x.leave.length}</span><span>leave</span></div>` : ""}
      ${x.sick.length + x.absent.length ? `<div class="wf-n"><span class="wf-c wf-s">${x.sick.length + x.absent.length}</span><span>${x.absent.length ? "absent" : "sick"}</span></div>` : ""}
      ${x.pendLeave.length ? `<div class="wf-n muted"><span class="wf-c wf-p">${x.pendLeave.length}</span><span>to approve</span></div>` : ""}</div>`); }
  W.cells = cells;
  $("#hr-body").innerHTML = `<div class="toolbar" style="align-items:flex-end"><div style="display:flex;gap:8px;align-items:center"><button class="btn sm ghost" onclick="W.m=new Date(W.m.getFullYear(),W.m.getMonth()-1,1);W.sel=null;tabWfCal()">‹</button><b style="min-width:150px;text-align:center">${W.m.toLocaleDateString("en-PH", { month: "long", year: "numeric" })}</b><button class="btn sm ghost" onclick="W.m=new Date(W.m.getFullYear(),W.m.getMonth()+1,1);W.sel=null;tabWfCal()">›</button></div>
    <label class="f">Branch<select id="wf-br" onchange="W.br=this.value;tabWfCalDraw()"><option value="">All branches</option>${Object.entries(EMP_BR).map(([k, v]) => `<option value="${k}" ${W.br === k ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></label></div>
    <div class="legend"><span><i class="wf-w"></i>On shift</span><span><i class="wf-o"></i>Off / rest day</span><span><i class="wf-l"></i>On leave</span><span><i class="wf-s"></i>Called in sick / absent</span><span><i class="wf-p"></i>Leave awaiting approval</span></div>
    <div class="wf-wrap"><div><div class="cal">${["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d => `<div class="dow">${d}</div>`).join("")}<span id="wf-cells" style="display:contents"></span></div></div><div class="card wf-side" id="wf-side"></div></div>`;
  tabWfCalDraw();
}
function tabWfCalDraw(){
  if (!$("#wf-cells")) return tabWfCal();
  const y = W.m.getFullYear(), mo = W.m.getMonth(), first = new Date(y, mo, 1), days = new Date(y, mo + 1, 0).getDate(), todayK = iso(new Date());
  if (!W.sel || !W.sel.startsWith(iso(first).slice(0, 7))) W.sel = todayK.startsWith(iso(first).slice(0, 7)) ? todayK : iso(first);
  const cells = []; for (let k = 0; k < first.getDay(); k++) cells.push(`<div></div>`);
  for (let dd = 1; dd <= days; dd++){ const k = iso(new Date(y, mo, dd)), x = wfDay(k);
    cells.push(`<div class="day${k === todayK ? " today" : ""}${W.sel === k ? " wf-sel" : ""}" onclick="W.sel='${k}';tabWfCalDraw()"><div class="d"><span>${dd}</span></div>
      <div class="wf-n"><span class="wf-c wf-w">${x.work.length}</span><span>on shift</span></div>
      ${x.off.length ? `<div class="wf-n"><span class="wf-c wf-o">${x.off.length}</span><span>off</span></div>` : ""}
      ${x.leave.length ? `<div class="wf-n"><span class="wf-c wf-l">${x.leave.length}</span><span>leave</span></div>` : ""}
      ${x.sick.length + x.absent.length ? `<div class="wf-n"><span class="wf-c wf-s">${x.sick.length + x.absent.length}</span><span>${x.absent.length ? "absent" : "sick"}</span></div>` : ""}
      ${x.pendLeave.length ? `<div class="wf-n"><span class="wf-c wf-p">${x.pendLeave.length}</span><span>to approve</span></div>` : ""}</div>`); }
  $("#wf-cells").innerHTML = cells.join("");
  clearInterval(W.tick); if (W.sel === iso(new Date())) W.tick = setInterval(() => { if (H.tab !== "wfcal" || !$("#wf-side")) return clearInterval(W.tick); wfLoad().then(tabWfCalDraw); }, 60000);
  const x = wfDay(W.sel), list = (t, arr, cls, st) => arr.length ? `<div class="wf-grp"><div class="wf-gt"><i class="${cls}"></i>${t} <span class="muted">${arr.length}</span></div>${arr.map(([e, s]) => { const z = st ? wfStatus(e, W.sel, s) : null; return `<div class="wf-row"><span>${esc(e.first_name)} ${esc(e.last_name)}<br><span class="small muted">${esc(e.position || "")}${W.br ? "" : " · " + (e.branch || "").toUpperCase()}</span>${z && z.html ? `<br>${z.html}` : ""}</span><span class="small">${esc(s)}</span></div>`; }).join("")}</div>` : "";
  const sts = x.work.map(([e, s]) => wfStatus(e, W.sel, s)), nIn = sts.filter(z => z.k === "in" || z.k === "lunch").length, nMiss = sts.filter(z => z.k === "missing").length, nDone = sts.filter(z => z.k === "done").length;
  const workIds = new Set(x.work.map(([e]) => e.id)), extra = H.emps.filter(e => e.active && (!W.br || e.branch === W.br) && !workIds.has(e.id) && W.punches.some(p => p.employee_id === e.id && p.work_date === W.sel)).map(e => [e, "No shift set"]);
  const isPastOrToday = W.sel <= iso(new Date());
  $("#wf-side").innerHTML = `<h3 style="margin:0 0 4px">${fmt(pd(W.sel))}</h3><p class="small muted" style="margin:0 0 10px">${x.work.length} on shift · ${x.off.length} off · ${x.leave.length} on leave · ${x.sick.length + x.absent.length} absent</p>
    ${isPastOrToday && x.work.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin:0 0 12px"><span class="chip" style="background:#e3f6ea;color:#1b7a3d">🟢 ${nIn} clocked in</span>${nDone ? `<span class="chip" style="background:var(--soft)">✓ ${nDone} done</span>` : ""}${nMiss ? `<span class="chip" style="background:#fde8e8;color:#b42318">🔴 ${nMiss} not in yet</span>` : ""}<button class="btn sm ghost" style="margin-left:auto" onclick="wfLoad().then(tabWfCalDraw)">↻ Refresh</button></div>` : ""}
    ${list("On shift", x.work, "wf-w", 1)}${list("Clocked in without a shift", extra, "wf-o", 1)}${list("Running late", x.late, "wf-p")}${list("Called in sick", x.sick, "wf-s")}${list("Absent", x.absent, "wf-s")}${list("On leave", x.leave, "wf-l")}${list("Leave awaiting approval", x.pendLeave, "wf-p")}${list("Off", x.off, "wf-o")}`;
}
function wfStatus(e, d, shiftTxt){
  const ps = (W.punches || []).filter(p => p.employee_id === e.id && p.work_date === d).sort((a, b) => String(a.time_in).localeCompare(String(b.time_in)));
  const now = new Date(), todayK = iso(now), tag = (bg, fg, t) => `<span class="chip" style="background:${bg};color:${fg};margin-top:4px;display:inline-block">${t}</span>`;
  const st = /^\d\d:\d\d/.test(shiftTxt || "") ? shiftTxt.slice(0, 5) : null, startAt = st ? new Date(`${d}T${st}:00`) : null, tol = H.rules?.tol_min ?? 15;
  const field = ps.some(p => p.geo && Object.values(p.geo).some(g => g && g.field)) ? " · 🚗 field" : "";
  if (ps.length){ const first = ps[0], open = ps.find(p => !p.time_out), late = startAt && new Date(first.time_in) - startAt > tol * 60000 ? ` · late ${Math.round((new Date(first.time_in) - startAt) / 60000)} min` : "";
    if (open && open.lunch_out && !open.lunch_in) return { k: "lunch", html: tag("#fff4dc", "#8a5a00", `🍽 On lunch since ${hhmm(open.lunch_out)}${field}`) };
    if (open) return { k: "in", html: tag("#e3f6ea", "#1b7a3d", `🟢 In since ${hhmm(first.time_in)}${late}${field}`) };
    return { k: "done", html: tag("var(--soft)", "inherit", `✓ ${hhmm(first.time_in)} – ${hhmm(ps[ps.length - 1].time_out)}${late}${field}`) }; }
  if (d > todayK) return { k: "future", html: "" };
  if (d === todayK && startAt && now < startAt) return { k: "later", html: tag("var(--soft)", "var(--muted)", `Not in yet · starts ${st}`) };
  if (!startAt) return { k: "none", html: "" };
  return { k: "missing", html: tag("#fde8e8", "#b42318", d === todayK ? `🔴 Not clocked in · ${(m => m >= 60 ? Math.floor(m / 60) + " h " + (m % 60) + " min" : m + " min")(Math.round((now - startAt) / 60000))} past start` : "🔴 No punch") };
}
function leaveGroups(rows){ // one staff request covers several dates: group by employee + filing time
  const g = {}; rows.forEach(l => { const k = l.employee_id + "|" + String(l.created_at).slice(0, 16) + "|" + l.kind; (g[k] = g[k] || []).push(l); });
  return Object.values(g).map(a => { a.sort((x, y) => x.leave_date < y.leave_date ? -1 : 1); return { kind: "leave", lk: a[0].kind, employee_id: a[0].employee_id, ids: a.map(x => x.id), from: a[0].leave_date, to: a[a.length - 1].leave_date, n: a.length, reason: a[0].reason || a[0].note || "", created_at: a[0].created_at, status: a.some(x => x.status === "pending") ? "pending" : a[0].status, paid: a[0].paid }; });
}
async function tabWfReq(){
  $("#hr-body").innerHTML = `<div class="empty">Loading…</div>`; await wfLoad();
  const items = [...W.all.map(r => ({ ...r, src: "req" })), ...leaveGroups(W.allLeaves).map(g => ({ ...g, src: "leave" })), ...W.swaps.filter(w => w.status !== "open").map(w => ({ ...w, src: "swap", kind: "swap", employee_id: w.requester_id, work_date: w.work_date, status: w.status === "accepted" ? "pending" : w.status, reason: w.note, note: null }))]
    .filter(r => W.filt === "all" || (W.filt === "pending" ? r.status === "pending" : r.kind === W.filt || (W.filt === "absent" && String(r.kind).startsWith("absent"))))
    .sort((a, b) => { const rank = r => r.status !== "pending" ? 3 : ["late", "absent_sick", "absent_emergency", "absent_other"].includes(r.kind) ? 0 : r.src === "leave" ? 2 : 1; return rank(a) - rank(b) || (a.created_at < b.created_at ? 1 : -1); });
  const stCls = s => s === "approved" ? "c-Confirmed" : s === "declined" || s === "rejected" ? "c-Lost" : s === "noted" ? "c-Contacted" : "c-Pencil";
  const when = r => r.src === "leave" ? `${fmt(pd(r.from))}${r.n > 1 ? " – " + fmt(pd(r.to)) + ` (${r.n} days)` : ""}` : `${r.work_date ? fmt(pd(r.work_date)) : ""}${r.start_time ? ` · ${String(r.start_time).slice(0, 5)}–${String(r.end_time || "").slice(0, 5)}` : ""}${r.eta ? " · ETA " + esc(r.eta) : ""}`;
  const what = r => r.src === "swap" ? `Shift swap → <b>${esc(ename2(r.partner_id))}</b>` : r.src === "leave" ? (LEAVE_N[r.lk] || r.lk) : REQ_N[r.kind] + (r.kind === "cash_advance" ? ` · <b>₱${(+r.amount || 0).toLocaleString("en-PH", { minimumFractionDigits: 2 })}</b>` : "");
  const acts = r => r.status !== "pending" ? `<span class="small muted">${r.decided_by ? esc(who(r.decided_by)) : ""}${r.decision_note ? " · " + esc(r.decision_note) : ""}</span>`
    : r.src === "swap" ? `<button class="btn sm primary" onclick="wfSwap('${r.id}',true)">Approve swap</button><button class="btn sm ghost" onclick="wfSwap('${r.id}',false)">Decline</button>`
    : r.src === "leave" ? `<button class="btn sm primary" onclick="wfLeave('${r.ids.join(",")}','approved')">Approve</button><button class="btn sm ghost" onclick="wfLeave('${r.ids.join(",")}','rejected')">Decline</button>`
    : ["late", "absent_sick", "absent_emergency", "absent_other"].includes(r.kind) ? `<button class="btn sm primary" onclick="wfDecide('${r.id}','noted')">Acknowledge</button>`
    : `<button class="btn sm primary" onclick="wfDecide('${r.id}','approved')">Approve</button><button class="btn sm ghost" onclick="wfDecide('${r.id}','declined',true)">Decline</button>`;
  const F = [["pending", "Needs action"], ["all", "All"], ["leave", "Leave"], ["absent", "Absences"], ["late", "Late"], ["ot", "Overtime"], ["ut", "Undertime"], ["swap", "Shift swaps"], ["cash_advance", "Cash advance"]];
  const missed = W.missed.map(m => ({ m, e: emp(m.employee_id) })).filter(x => x.e);
  $("#hr-body").innerHTML = `${missed.length ? `<div class="card" style="border-color:#f3b4b4;background:#fff5f5;margin-bottom:12px"><h3 style="color:#a22020">No time-in yet</h3><p class="small muted" style="margin:0 0 8px">Scheduled, 15+ minutes past their start, no punch and no notice. Call them, then mark it handled.</p>${missed.map(({ m, e }) => `<div class="wf-row"><span><b>${esc(e.first_name)} ${esc(e.last_name)}</b> · ${esc(e.position || "")} · ${(e.branch || "").toUpperCase()}<br><span class="small muted">${fmt(pd(m.work_date))} · shift ${String(m.shift_start || "").slice(0, 5)} · flagged ${fmtTs(m.created_at)}${e.mobile ? " · " + esc(e.mobile) : ""}</span></span><span><button class="btn sm ghost" onclick="wfMissed('${m.employee_id}','${m.work_date}')">Handled</button></span></div>`).join("")}</div>` : ""}<div class="toolbar" style="flex-wrap:wrap;gap:6px">${F.map(([k, l]) => `<button class="btn sm ${W.filt === k ? "primary" : "ghost"}" onclick="W.filt='${k}';tabWfReq()">${l}</button>`).join("")}</div>
    <div class="card" style="padding:0"><table><tr><th>Employee</th><th>Request</th><th>For</th><th>Reason</th><th>Filed</th><th>Status</th><th></th></tr>${items.map(r => { const e = emp(r.employee_id); return `<tr><td><b>${esc(e ? e.first_name + " " + e.last_name : "?")}</b><br><span class="small muted">${esc(e?.position || "")} · ${(e?.branch || "").toUpperCase()}</span></td><td>${what(r)}</td><td>${when(r)}</td><td style="max-width:280px">${esc(r.reason || "")}${r.note ? `<br><span class="small muted">To approver: ${esc(r.note)}</span>` : ""}</td><td class="small">${fmtTs(r.created_at)}</td><td><span class="chip ${stCls(r.status)}">${r.status === "pending" ? "Pending" : r.status === "noted" ? "Acknowledged" : r.status === "rejected" ? "Declined" : r.status[0].toUpperCase() + r.status.slice(1)}</span></td><td><div class="actions" style="margin:0;flex-wrap:nowrap">${acts(r)}</div></td></tr>`; }).join("") || `<tr><td colspan="7" class="empty">${W.filt === "pending" ? "Nothing waiting. New notices and requests from the staff app land here." : "No requests yet."}</td></tr>`}</table></div>
    <p class="small muted">Approved overtime and undertime requests are applied automatically when you generate exceptions for that cut-off. Approved cash advances are deducted automatically from the next payslips, split over the number of pay periods you choose, and marked paid when you release each payroll.</p>`;
}
async function wfDecide(id, status, askNote){
  let note = null, extra = {}; if (askNote){ note = prompt("Reason for declining (the employee will see this)"); if (note === null) return; }
  const r = W.all.find(x => x.id === id);
  if (r && r.kind === "cash_advance" && status === "approved"){ const t = prompt(`Approve ₱${(+r.amount).toLocaleString("en-PH")}. Deduct over how many pay periods? (1–6)`, "2"); if (t === null) return; extra.ca_terms = Math.min(6, Math.max(1, parseInt(t) || 1)); note = `Deducted over ${extra.ca_terms} pay period${extra.ca_terms > 1 ? "s" : ""}`; }
  const { error } = await sb.from("staff_requests").update({ status, decided_by: me.email, decided_at: new Date().toISOString(), decision_note: note, ...extra }).eq("id", id);
  if (error) return toast(error.message); toast(status === "noted" ? "Acknowledged" : status === "approved" ? "Approved" : "Declined"); tabWfReq(); }
async function wfLeave(ids, status){
  const rows = W.allLeaves.filter(l => ids.split(",").includes(l.id)).sort((a, b) => a.leave_date < b.leave_date ? -1 : 1), e = emp(rows[0]?.employee_id), now = new Date().toISOString();
  if (status === "approved" && e && ["VL", "SL"].includes(rows[0].kind)){ const col = "vl_credits", bal = e[col], hpd = +(H.rules?.std_hours) || 8;
    if (bal != null){ const paidN = Math.max(0, Math.min(rows.length, Math.floor(+bal / hpd))); if (paidN < rows.length && !confirm(`${e.first_name} has ${+bal} leave hours left (${hpd} hours per day). Approve ${paidN} day${paidN === 1 ? "" : "s"} as paid and ${rows.length - paidN} as unpaid?`)) return;
      for (let i = 0; i < rows.length; i++){ const { error } = await sb.from("leaves").update({ status, paid: i < paidN, decided_by: me.email, decided_at: now }).eq("id", rows[i].id); if (error) return toast(error.message); }
      const nb = Math.round((+bal - paidN * hpd) * 100) / 100; const { error } = await sb.from("employees").update({ [col]: nb }).eq("id", e.id); if (error) return toast(error.message); e[col] = nb;
      toast(`Leave approved · ${paidN} paid day${paidN === 1 ? "" : "s"}, ${nb} leave hours left`); return tabWfReq(); } }
  const { error } = await sb.from("leaves").update({ status, decided_by: me.email, decided_at: now }).in("id", ids.split(","));
  if (error) return toast(error.message); toast(status === "approved" ? "Leave approved" : "Leave declined"); tabWfReq(); }
const ename2 = id => { const e = emp(id); return e ? `${e.first_name} ${e.last_name}` : "anyone at the branch"; };
const fieldChip = p => { const f = Object.entries(p.geo || {}).filter(([, g]) => g && g.field && g.lat != null); return f.length ? ` <span class="chip" style="background:#e8f1ff;color:#1d4f91" title="${esc(f.map(([, g]) => g.note || "").filter(Boolean)[0] || "")}">🚗 field ${f.map(([k, g]) => `<a href="https://maps.google.com/?q=${g.lat},${g.lng}" target="_blank" style="color:inherit">${({ time_in: "in", lunch_out: "L-out", lunch_in: "L-in", time_out: "out" })[k] || k}</a>`).join(" · ")}</span>` : ""; };
const geoNote = p => Object.entries(p.geo || {}).map(([k, g]) => `${k}: ${g.field ? "🚗 field work · " + (g.note || "") + (g.lat != null ? ` (${(+g.lat).toFixed(5)}, ${(+g.lng).toFixed(5)})` : "") : g.denied ? "location off" : g.dist != null ? g.dist + " m from branch" : "branch location not set"}`).join(" · ");
async function wfMissed(eid, d){ const { error } = await sb.from("missed_alerts").update({ resolved_at: new Date().toISOString() }).eq("employee_id", eid).eq("work_date", d); if (error) return toast(error.message); tabWfReq(); }
async function wfSwap(id, ok){ const w = W.swaps.find(x => x.id === id); if (!w) return; const now = new Date().toISOString(), a = emp(w.requester_id), b = emp(w.partner_id);
  if (ok){ if (!b) return toast("Nobody has taken this shift yet");
    const { data: bs } = await sb.from("schedules").select("*").eq("employee_id", b.id).eq("work_date", w.work_date);
    const bWorks = bs && bs[0] ? bs[0].kind === "work" : !(b.rest_days || []).includes(pd(w.work_date).getDay()) && !!b.default_start;
    if (bWorks && !confirm(`${b.first_name} is also scheduled on ${fmt(pd(w.work_date))}. Approve anyway? ${b.first_name} will take ${a.first_name}'s shift times instead of their own.`)) return;
    const rows = [{ employee_id: a.id, work_date: w.work_date, kind: "rest", note: `Shift swapped to ${b.first_name}`, created_by: me.email }, { employee_id: b.id, work_date: w.work_date, kind: "work", start_time: w.start_time, end_time: w.end_time, branch: w.branch, note: `Covering for ${a.first_name}`, created_by: me.email }];
    const { error: e1 } = await sb.from("schedules").upsert(rows, { onConflict: "employee_id,work_date" }); if (e1) return toast(e1.message); }
  const { error } = await sb.from("shift_swaps").update({ status: ok ? "approved" : "declined", decided_by: me.email, decided_at: now }).eq("id", id); if (error) return toast(error.message);
  toast(ok ? "Swap approved · line-up updated" : "Swap declined"); tabWfReq(); }


/* ---------- Workforce: live feed + chat moderation ---------- */
let WF = { room: "all", ch: null, urls: {} };
function wfFeedOff(){ if (WF.ch){ try { sb.removeChannel(WF.ch); } catch (e) {} WF.ch = null; } }
async function tabWfFeed(){
  const since = new Date(Date.now() - 2 * 86400000).toISOString();
  const [{ data: posts }, { data: msgs }] = await Promise.all([sb.from("feed_posts").select("*").gte("at", since).order("at", { ascending: false }).limit(120), sb.from("chat_messages").select("*").eq("room", WF.room).order("created_at", { ascending: false }).limit(150)]);
  const P = posts || [], M = (msgs || []).reverse(); const ids = P.map(p => p.id);
  const { data: rx } = ids.length ? await sb.from("feed_reactions").select("*").in("post_id", ids) : { data: [] };
  const need = P.map(p => p.selfie).filter(x => x && !WF.urls[x]); if (need.length){ const { data: u } = await sb.storage.from("selfies").createSignedUrls(need, 3600); (u || []).forEach(x => { if (x.signedUrl) WF.urls[x.path] = x.signedUrl; }); }
  WF.idp = WF.idp || {}; const needId = [...new Set(P.map(p => (emp(p.employee_id) || {}).selfie).filter(x => x && !WF.idp[x]))]; if (needId.length){ const { data: u } = await sb.storage.from("employee-docs").createSignedUrls(needId, 3600); (u || []).forEach(x => { if (x.signedUrl) WF.idp[x.path] = x.signedUrl; }); }
  const onNow = new Set(); [...P].reverse().forEach(p => { if (p.kind === "in") onNow.add(p.employee_id); else onNow.delete(p.employee_id); });
  const rxFor = id => { const c = {}; (rx || []).filter(r => r.post_id === id).forEach(r => c[r.emoji] = (c[r.emoji] || 0) + 1); return Object.entries(c).map(([e, n]) => `<span class="chip" style="background:var(--soft)">${e} ${n}</span>`).join(" "); };
  $("#hr-body").innerHTML = `<div class="wf-wrap" style="grid-template-columns:minmax(0,1fr) minmax(0,1fr)">
    <div class="card"><h3 style="margin:0 0 4px">Live time-in feed</h3><p class="small muted" style="margin:0 0 10px">${onNow.size} on shift now · updates live · each punch selfie sits next to the person's registration photo so you can check it was really them · photos kept 30 days</p>
      ${P.map(p => { const e = emp(p.employee_id); return `<div class="wf-row" style="align-items:flex-start;gap:12px"><span style="display:flex;gap:10px;min-width:0">${e && e.selfie && WF.idp[e.selfie] ? `<img src="${WF.idp[e.selfie]}" title="Registration photo" style="width:44px;height:56px;object-fit:cover;border-radius:8px;opacity:.85;align-self:flex-end">` : ""}${p.selfie && WF.urls[p.selfie] ? `<img src="${WF.urls[p.selfie]}" style="width:56px;height:72px;object-fit:cover;border-radius:8px;transform:scaleX(-1);cursor:zoom-in" onclick="openModal('<img src=&quot;${WF.urls[p.selfie]}&quot; style=&quot;max-width:100%;border-radius:12px;transform:scaleX(-1)&quot;>')">` : `<span style="width:56px;height:72px;border-radius:8px;background:var(--soft);display:grid;place-items:center;font-weight:700">${esc((p.name || "?")[0])}</span>`}
        <span><b>${esc(p.name)}</b>${e ? ` <span class="small muted">(${esc(e.first_name)} ${esc(e.last_name)})</span>` : ""}<br><span class="small">${p.kind === "in" ? "Timed in" : "Timed out"} · ${fmtTs(p.at)} · ${(p.branch || "").toUpperCase()}</span>${p.offsite ? ` <span class="chip c-Lost">off-site</span>` : ""}<br>${rxFor(p.id)}</span></span><span></span></div>`; }).join("") || `<div class="empty">No time-ins from the staff app in the last two days.</div>`}</div>
    <div class="card"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><h3 style="margin:0">Team chat</h3><select onchange="WF.room=this.value;tabWfFeed()" style="min-width:200px;font-weight:600">${[["all", "All staff"], ["sa", "San Antonio"], ["ju", "Jupiter"], ["fm", "Funhan Mart"]].map(([k, l]) => `<option value="${k}" ${WF.room === k ? "selected" : ""}>💬 ${l}</option>`).join("")}</select></div>
      <div id="wf-chat" style="max-height:520px;overflow:auto;margin:10px 0">${M.map(m => `<div class="wf-row" style="${m.deleted_at ? "opacity:.45" : ""}"><span style="min-width:0"><b>${esc(m.author || "")}</b> <span class="small muted">${fmtTs(m.created_at)}</span><br><span style="white-space:pre-wrap;word-break:break-word">${m.deleted_at ? "<i>deleted</i>" : esc(m.body)}</span></span><span>${m.deleted_at ? "" : `<button class="btn sm ghost" onclick="wfDelMsg('${m.id}')">Remove</button>`}</span></div>`).join("") || `<div class="empty">No messages in the last 7 days.</div>`}</div>
      <div style="display:flex;gap:8px"><input id="wf-msg" maxlength="1000" placeholder="Message ${({ all: "all staff", sa: "San Antonio", ju: "Jupiter", fm: "Funhan Mart" })[WF.room]} as management" style="flex:1"><button class="btn sm primary" onclick="wfPost()">Send</button></div>
      <p class="small muted">Messages delete automatically after 7 days. Removed messages disappear for staff right away.</p></div></div>`;
  const c = $("#wf-chat"); if (c) c.scrollTop = c.scrollHeight;
  wfFeedOff(); WF.ch = sb.channel("wf-" + Date.now()).on("postgres_changes", { event: "*", schema: "public", table: "feed_posts" }, () => H.tab === "wffeed" && tabWfFeed()).on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" }, () => H.tab === "wffeed" && tabWfFeed()).subscribe(); }
async function wfPost(){ const v = $("#wf-msg").value.trim(); if (!v) return; const { error } = await sb.from("chat_messages").insert({ room: WF.room, body: v }); if (error) return toast(error.message); tabWfFeed(); }
async function wfDelMsg(id){ const { error } = await sb.rpc("chat_delete", { p_id: id }); if (error) return toast(error.message); tabWfFeed(); }

/* ---------- Workforce: announcements ---------- */
async function tabWfAnn(){
  const [{ data: a }, { data: r }] = await Promise.all([sb.from("announcements").select("*").order("created_at", { ascending: false }).limit(30), sb.from("announcement_reads").select("*")]);
  const A = a || [], R = r || [];
  const aud = x => H.emps.filter(e => e.active && (!x.branch || e.branch === x.branch));
  $("#hr-body").innerHTML = `<div class="grid"><div class="card"><h3>New announcement</h3><p class="small muted">Shows at the top of the staff app until each person taps "Got it". Use it for menu changes, events tonight and policy reminders.</p>
      <label class="f">Title<input id="an-t" maxlength="120" placeholder="Private event tonight at San Antonio: 120 pax"></label>
      <label class="f">Message<textarea id="an-b" rows="4" placeholder="Doors close to walk-ins at 6 PM. All servers report by 4:30 PM for briefing."></textarea></label>
      <div class="fields"><label class="f">Who sees it<select id="an-br"><option value="">Everyone</option><option value="sa">San Antonio Place</option><option value="ju">Jupiter Street</option></select></label><label class="f">Hide after<input id="an-x" type="date"></label></div>
      <button class="btn primary" onclick="wfAnnPost()">Post announcement</button></div>
    <div class="card" style="grid-column:span 2"><h3>Posted</h3><table><tr><th>Announcement</th><th>For</th><th>Read</th><th></th></tr>${A.map(x => { const au = aud(x), rd = R.filter(y => y.announcement_id === x.id), names = au.filter(e => !rd.some(y => y.employee_id === e.id)); return `<tr><td><b>${esc(x.title)}</b><br><span class="small muted">${fmtTs(x.created_at)}${x.expires_at ? " · until " + fmt(pd(x.expires_at.slice(0, 10))) : ""}</span></td><td>${x.branch ? x.branch.toUpperCase() : "Everyone"}</td><td><b>${rd.length}</b> of ${au.length}${names.length && names.length <= 12 ? `<br><span class="small muted">Not yet: ${names.map(e => esc(e.first_name)).join(", ")}</span>` : ""}</td><td><button class="btn sm ghost" onclick="wfAnnDel('${x.id}')">Remove</button></td></tr>`; }).join("") || "<tr><td colspan='4' class='empty'>Nothing posted yet.</td></tr>"}</table></div></div>`; }
async function wfAnnPost(){ const t = $("#an-t").value.trim(); if (!t) return toast("Add a title"); const x = $("#an-x").value;
  const { error } = await sb.from("announcements").insert({ title: t, body: $("#an-b").value.trim() || null, branch: $("#an-br").value || null, created_by: me.email, expires_at: x ? x + "T23:59:00+08:00" : null }); if (error) return toast(error.message); toast("Posted to the staff app"); tabWfAnn(); }
async function wfAnnDel(id){ if (!confirm("Remove this announcement from the staff app?")) return; await sb.from("announcements").delete().eq("id", id); tabWfAnn(); }

/* ---------- Workforce: labor cost vs sales ---------- */
let WL = { m: null, br: "sa" };
async function tabWfLabor(){
  if (!WL.m){ const t = new Date(); WL.m = new Date(t.getFullYear(), t.getMonth(), 1); }
  const a = iso(WL.m), b = iso(new Date(WL.m.getFullYear(), WL.m.getMonth() + 1, 0));
  const [{ data: sales }, { data: pun }, { data: sc }] = await Promise.all([sb.from("daily_sales").select("*").eq("branch", WL.br).gte("sale_date", a).lte("sale_date", b), sb.from("punches").select("*").gte("work_date", a).lte("work_date", b), sb.from("schedules").select("*").gte("work_date", a).lte("work_date", b)]);
  const E = H.emps.filter(e => e.branch === WL.br), rate = e => +e.hourly_rate || (+e.monthly_rate ? +e.monthly_rate / 26 / (H.rules.std_hours ?? 8) : 0), today = iso(new Date());
  const days = []; for (let d = new Date(WL.m); d.getMonth() === WL.m.getMonth(); d.setDate(d.getDate() + 1)) days.push(iso(d));
  let tS = 0, tC = 0, tH = 0, tF = 0; const K = { basic: 0, nd: 0, m13: 0, sil: 0, er: 0 };
  const R = H.rules, ndRate = R.nd_rate ?? 0.1, silH = 40, yrH = 26 * 12 * (R.std_hours ?? 8);
  const erHr = e => { const base = +e.monthly_rate || rate(e) * (R.std_hours ?? 8) * 26; if (!base) return 0; const S = R.sss || {}, msc = Math.min(S.max_msc || 35000, Math.max(S.min_msc || 5000, Math.round(base / (S.step || 500)) * (S.step || 500)));
    const sss = msc * 0.10 + (msc < 15000 ? 10 : 30), P = R.philhealth || {}, ph = Math.min(P.max_base || 100000, Math.max(P.min_base || 10000, base)) * (P.rate || 0.05) * (1 - (P.ee_share ?? 0.5)), G = R.pagibig || {}, pi = Math.min(G.max_base || 10000, base) * 0.02;
    return (sss + ph + pi) / (26 * (R.std_hours ?? 8)); };
  const add = (e, h, ndH, row) => { const r = rate(e), b = h * r, nd = ndH * r * ndRate, m13 = b / 12, sil = 0, er = h * erHr(e); row.cost += b; row.full += b + nd + m13 + er; Object.assign(row.k, { basic: row.k.basic + b, nd: row.k.nd + nd, m13: row.k.m13 + m13, sil: row.k.sil + sil, er: row.k.er + er }); };
  const rows = days.map(d => { let hrs = 0, src = "actual"; const row = { cost: 0, full: 0, k: { basic: 0, nd: 0, m13: 0, sil: 0, er: 0 } };
    const ps = (pun || []).filter(p => p.work_date === d && E.some(e => e.id === p.employee_id));
    if (ps.length) ps.forEach(p => { if (!p.time_out) return; let m = (new Date(p.time_out) - new Date(p.time_in)) / 60000; if (p.lunch_out && p.lunch_in) m -= (new Date(p.lunch_in) - new Date(p.lunch_out)) / 60000; const e = E.find(x => x.id === p.employee_id); hrs += m / 60; add(e, m / 60, ndMinutes(p.time_in, p.time_out) / 60, row); });
    else { src = d > today ? "line-up" : "line-up (no punches)"; E.filter(e => e.active).forEach(e => { const s = (sc || []).find(x => x.employee_id === e.id && x.work_date === d); let st, en; if (s){ if (s.kind !== "work") return; st = s.start_time; en = s.end_time; } else { if ((e.rest_days || []).includes(pd(d).getDay()) || !e.default_start) return; st = e.default_start; en = e.default_end; } let m = tmin(en) - tmin(st); if (m <= 0) m += 1440; m -= (H.rules.break_min ?? 60); const sA = new Date(`${d}T${String(st).slice(0, 5)}:00`), eA = new Date(sA.getTime() + (m + (H.rules.break_min ?? 60)) * 60000); hrs += m / 60; add(e, m / 60, Math.max(0, ndMinutes(sA, eA) - (H.rules.break_min ?? 60) / 2) / 60, row); }); }
    E.filter(e => e.active && (!e.date_hired || e.date_hired <= d) && (!e.date_separated || e.date_separated >= d)).forEach(e => { const v = silH * rate(e) / 365; row.k.sil += v; row.full += v; }); // fixed: 40 h a year per employee, spread evenly over every day
    const cost = row.cost, full = row.full;
    const sale = (sales || []).find(x => x.sale_date === d), sv = sale ? +sale.net_sales : null, pct = sv ? full / sv * 100 : null;
    if (sv) { tS += sv; tC += cost; tF += full; Object.keys(K).forEach(k => K[k] += row.k[k]); } tH += hrs;
    return { d, hrs, cost, full, sv, pct, src }; });
  const tone = p => p == null ? "" : p <= 25 ? "color:#1f9d55" : p <= 35 ? "color:#8a5a00" : "color:#c62828;font-weight:700";
  $("#hr-body").innerHTML = `<div class="toolbar" style="align-items:flex-end"><div style="display:flex;gap:8px;align-items:center"><button class="btn sm ghost" onclick="WL.m=new Date(WL.m.getFullYear(),WL.m.getMonth()-1,1);tabWfLabor()">‹</button><b style="min-width:150px;text-align:center">${WL.m.toLocaleDateString("en-PH", { month: "long", year: "numeric" })}</b><button class="btn sm ghost" onclick="WL.m=new Date(WL.m.getFullYear(),WL.m.getMonth()+1,1);tabWfLabor()">›</button></div>
    <label class="f">Branch<select onchange="WL.br=this.value;tabWfLabor()"><option value="sa" ${WL.br === "sa" ? "selected" : ""}>San Antonio Place</option><option value="ju" ${WL.br === "ju" ? "selected" : ""}>Jupiter Street</option></select></label></div>
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));margin-bottom:12px"><div class="card"><div class="small muted">Net sales entered</div><div style="font-size:22px;font-weight:700">${peso(tS)}</div></div><div class="card"><div class="small muted">Full labor cost on those days</div><div style="font-size:22px;font-weight:700">${peso(tF)}</div><div class="small muted">basic ${peso(tC)}</div></div><div class="card"><div class="small muted">Labor % of sales (full cost)</div><div style="font-size:22px;${tone(tS ? tF / tS * 100 : null)}">${tS ? (tF / tS * 100).toFixed(1) + "%" : "—"}</div></div><div class="card"><div class="small muted">Staff hours this month</div><div style="font-size:22px;font-weight:700">${Math.round(tH).toLocaleString()} h</div></div></div>
    <div class="card" style="padding:0"><table><tr><th>Date</th><th>Net sales ₱</th><th>Staff hours</th><th>Basic pay</th><th>Full labor cost</th><th>Labor %</th><th>Hours from</th></tr>${rows.map(r => `<tr><td>${fmt(pd(r.d))}</td><td><input type="number" step="0.01" value="${r.sv ?? ""}" placeholder="enter sales" style="max-width:140px" onchange="wfSale('${r.d}',this.value)"></td><td class="num">${r.hrs ? r.hrs.toFixed(1) : "—"}</td><td class="num muted">${r.cost ? peso(r.cost) : "—"}</td><td class="num"><b>${r.full ? peso(r.full) : "—"}</b></td><td class="num" style="${tone(r.pct)}">${r.pct != null ? r.pct.toFixed(1) + "%" : "—"}</td><td class="small muted">${r.src}</td></tr>`).join("")}</table></div>
    ${tS ? `<div class="card"><h3 style="margin:0 0 8px">What's in the full labor cost (days with sales)</h3><div class="kv"><b>Basic pay</b><span>${peso(K.basic)}</span><b>Night differential (${Math.round(ndRate * 100)}%, 10 pm–6 am)</b><span>${peso(K.nd)}</span><b>13th month pay (1/12 of basic)</b><span>${peso(K.m13)}</span><b>Leave credits (fixed ${silH} h a year per employee, ÷ 365 a day)</b><span>${peso(K.sil)}</span><b>Employer SSS + EC, PhilHealth, Pag-IBIG</b><span>${peso(K.er)}</span><b>Total</b><span><b>${peso(tF)}</b></span></div></div>` : ""}
    <p class="small muted">Full labor cost = basic pay (paid hours × hourly rate; monthly-rated staff ÷ 26 days ÷ ${H.rules.std_hours ?? 8} h) + night differential + 13th month (1/12) + leave credits (a fixed ${silH} hours a year per active employee at their rate, counted every day ÷ 365, whether or not they worked) + the employer's share of SSS (10% + EC), PhilHealth (2.5%) and Pag-IBIG (2%, max ₱200). Overtime and holiday premiums aren't included. Past days use actual punches; future days use the line-up. Under 25% is healthy for a bar; over 35% means the night was over-staffed for its sales.</p>`; }
async function wfSale(d, v){ if (v === "") { await sb.from("daily_sales").delete().eq("branch", WL.br).eq("sale_date", d); return tabWfLabor(); }
  const { error } = await sb.from("daily_sales").upsert({ branch: WL.br, sale_date: d, net_sales: +v, entered_by: me.email, updated_at: new Date().toISOString() }, { onConflict: "branch,sale_date" }); if (error) return toast(error.message); toast("Saved"); tabWfLabor(); }

/* ---------- Operations: what the team logs from the staff app ---------- */
const OPS_BR = { "": "All branches", sa: "San Antonio", ju: "Jupiter", fm: "Funhan Mart" };
let OPF = { br: "", days: 14, cat: "" }, OPU = {};
async function opsPhotos(rows){ const need = rows.map(r => r.photo).filter(x => x && !OPU[x]); if (!need.length) return; const { data } = await sb.storage.from("ops-photos").createSignedUrls(need, 3600); (data || []).forEach(x => { if (x.signedUrl) OPU[x.path] = x.signedUrl; }); }
const opsThumb = p => p && OPU[p] ? `<img src="${OPU[p]}" style="width:56px;height:56px;object-fit:cover;border-radius:8px;cursor:zoom-in" onclick="openModal('<img src=&quot;${OPU[p]}&quot; style=&quot;max-width:100%;border-radius:12px&quot;>')">` : "";
function opsBar(extra){ return `<div class="toolbar" style="align-items:flex-end;flex-wrap:wrap"><label class="f">Branch<select onchange="OPF.br=this.value;hrRender()">${Object.entries(OPS_BR).map(([k, v]) => `<option value="${k}" ${OPF.br === k ? "selected" : ""}>${v}</option>`).join("")}</select></label><label class="f">Period<select onchange="OPF.days=+this.value;hrRender()">${[[1, "Today"], [7, "Last 7 days"], [14, "Last 14 days"], [31, "Last 31 days"], [92, "Last 3 months"]].map(([k, v]) => `<option value="${k}" ${OPF.days === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>${extra || ""}</div>`; }
async function opsLoad(table, dateCol = "created_at"){ const since = new Date(); since.setDate(since.getDate() - OPF.days + 1); since.setHours(0, 0, 0, 0);
  let q = sb.from(table).select("*").gte(dateCol, dateCol === "created_at" ? since.toISOString() : iso(since)).order(dateCol, { ascending: false }).limit(500); if (OPF.br) q = q.eq("branch", OPF.br);
  const { data, error } = await q; if (error) { $("#hr-body").innerHTML = `<div class="empty">Couldn't load: ${esc(error.message)}</div>`; return null; } await opsPhotos(data || []); return data || []; }
const byName = r => { const e = emp(r.employee_id); return r.by_name || (e ? `${e.first_name} ${e.last_name}` : ""); };
async function tabOpsInv(){ const R = await opsLoad("inventory_logs"); if (!R) return; const rows = R.filter(r => !OPF.cat || r.category === OPF.cat);
  const cnt = {}; rows.forEach(r => cnt[r.action] = (cnt[r.action] || 0) + 1);
  $("#hr-body").innerHTML = opsBar(`<label class="f">Area<select onchange="OPF.cat=this.value;hrRender()"><option value="">All areas</option>${["Kitchen", "Bar", "Dine-in", "Utilities", "Others"].map(c => `<option ${OPF.cat === c ? "selected" : ""}>${c}</option>`).join("")}</select></label>`) +
    `<div class="legend">${Object.entries(cnt).map(([k, n]) => `<span><b>${n}</b> ${esc(k)}</span>`).join("") || ""}</div>
    <div class="card" style="padding:0"><table><tr><th>When</th><th>Item</th><th>Qty</th><th>What happened</th><th>Area</th><th>By</th><th>Note</th><th></th></tr>${rows.map(r => `<tr><td class="small">${fmtTs(r.created_at)}<br>${OPS_BR[r.branch] || ""}</td><td><b>${esc(r.item)}</b></td><td class="num">${+r.qty} ${esc(r.unit || "")}</td><td>${/spoil|damag|missing/i.test(r.action) ? `<span class="chip c-Lost">${esc(r.action)}</span>` : esc(r.action)}</td><td>${esc(r.category)}${r.subcategory ? `<br><span class="small muted">${esc(r.subcategory)}</span>` : ""}</td><td class="small">${esc(byName(r))}</td><td class="small" style="max-width:220px">${esc(r.note || "")}</td><td>${opsThumb(r.photo)}</td></tr>`).join("") || `<tr><td colspan="8" class="empty">No inventory entries in this period.</td></tr>`}</table></div>`; }
/* CR audit quota (shared by staff app and portal) */
const CRQ_DEF = { start: "2026-10-04", enforce_from: "2026-11-01", before: 15, after: 45, window_days: 30, ladder: ["Verbal warning (documented)", "Written warning", "Notice to explain"], owner: { sa: "supervisor|manager|oic", ju: "supervisor|manager|oic" },
  sa: [0, 1, 2, 3, 4, 5, 6].map(d => [2, 5, 6].includes(d) ? ["17:30", "19:00", "20:00", "21:00", "22:00", "23:00", "00:00", "01:00", "02:00", "02:45"] : ["17:30", "19:30", "21:30", "23:30", "01:30", "02:45"]),
  ju: [0, 1, 2, 3, 4, 5, 6].map(d => [1, 2].includes(d) ? ["18:30", "00:00", "02:45"] : [3, 4].includes(d) ? ["18:30", "20:30", "22:30", "00:30", "02:45"] : ["18:30", "21:00", "23:30", "02:45"]) };
let CRQ = null;
async function crCfg(){ if (CRQ) return CRQ; try { const { data } = await sb.from("settings").select("value").eq("key", "cr_quota").maybeSingle(); CRQ = data?.value && data.value.sa ? data.value : CRQ_DEF; } catch (e) { CRQ = CRQ_DEF; } return CRQ; }
function crSlots(cfg, br, d){ const list = ((cfg[br] || [])[new Date(d + "T12:00:00").getDay()]) || [];
  return list.map(t => { const [h, m] = t.split(":").map(Number), at = new Date(d + "T00:00:00"); if (h < 6) at.setDate(at.getDate() + 1); at.setHours(h, m, 0, 0); return { t, at }; }); }
function crMatch(cfg, slots, audits){ const used = new Set(), now = Date.now(), B = cfg.before * 60000, A = cfg.after * 60000;
  return slots.map(s => { const hit = audits.filter(x => !used.has(x.id)).map(x => ({ x, ts: +new Date(x.created_at) })).filter(o => o.ts >= +s.at - B && o.ts <= +s.at + A).sort((p, q) => p.ts - q.ts)[0];
    if (hit) used.add(hit.x.id); const st = hit ? "done" : now < +s.at - B ? "upcoming" : now <= +s.at + A ? "due" : "missed"; return { ...s, audit: hit ? hit.x : null, st }; }); }
const crNightRange = d => { const a = new Date(d + "T12:00:00"), b = new Date(d + "T12:00:00"); b.setDate(b.getDate() + 1); b.setHours(6, 0, 0, 0); return [a, b]; };
const crT12 = t => { const [h, m] = t.split(":").map(Number); return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };

async function crCompliance(R){
  const cfg = await crCfg(), brs = (OPF.br ? [OPF.br] : ["sa", "ju"]).filter(b => cfg[b]); if (!brs.length) return `<div class="card small muted">Funhan Mart has no CR audit quota.</div>`;
  const now = new Date(), tonight = new Date(now); if (now.getHours() < 6) tonight.setDate(tonight.getDate() - 1);
  const nights = []; for (let k = 0; k < Math.min(OPF.days, 92); k++){ const d = new Date(tonight); d.setDate(d.getDate() - k); const ds = iso(d); if (ds >= (cfg.start || "2000-01-01") || k === 0) nights.push(ds); }
  if (!nights.length) return `<div class="card small muted">CR quota counting starts ${fmt(pd(cfg.start))}.</div>`;
  const wStart = new Date(tonight); wStart.setDate(wStart.getDate() - (cfg.window_days || 30) + 1); const first = [nights[nights.length - 1], iso(wStart)].sort()[0];
  const [{ data: sc }, { data: au }, { data: ro }] = await Promise.all([sb.from("schedules").select("employee_id,work_date,branch,kind,note").eq("kind", "work").gte("work_date", first).lte("work_date", iso(tonight)), sb.from("toilet_audits").select("id,created_at,branch,by_name").gte("created_at", new Date(first + "T12:00:00").toISOString()), sb.from("shift_roles").select("*").gte("work_date", first)]);
  const owners = (br, d) => { if ((cfg.owner || {})[br] === "floor") return (ro || []).filter(x => x.work_date === d && x.branch === br && x.role === "floor").map(x => x.employee_id); const on = (sc || []).filter(x => x.work_date === d && (x.branch || (emp(x.employee_id) || {}).branch) === br); const oic = on.filter(x => /oic/i.test(x.note || "")); const re = new RegExp((cfg.owner || {})[br] || "supervisor", "i");
    return (oic.length ? oic : on.filter(x => re.test((emp(x.employee_id) || {}).position || ""))).map(x => x.employee_id); };
  const night = (br, d) => { const m = crMatch(cfg, crSlots(cfg, br, d), (au || []).filter(a => a.branch === br)); const fin = m.filter(x => x.st === "done" || x.st === "missed"); return { m, req: fin.length, done: fin.filter(x => x.st === "done").length, miss: fin.filter(x => x.st === "missed"), own: owners(br, d) }; };
  const rows = []; nights.forEach(d => brs.forEach(br => rows.push({ d, br, ...night(br, d) })));
  const tally = {}; const wNights = []; for (let d = new Date(wStart); iso(d) <= iso(tonight); d.setDate(d.getDate() + 1)) if (iso(d) >= (cfg.start || "2000-01-01")) wNights.push(iso(d));
  wNights.forEach(d => ["sa", "ju"].filter(b => cfg[b]).forEach(br => { const n = night(br, d); if (!n.miss.length) return; n.own.forEach(id => { const t = tally[id] = tally[id] || { short: 0, counted: 0, list: [] }; t.short++; if (d >= cfg.enforce_from) t.counted++; t.list.push(`${fmt(pd(d))} ${OPS_BR[br]}: missed ${n.miss.map(x => crT12(x.t)).join(", ")}`); }); }));
  const enforced = iso(tonight) >= cfg.enforce_from;
  const tot = rows.filter(r => r.d >= (cfg.start || "")).reduce((a, r) => [a[0] + r.done, a[1] + r.req], [0, 0]);
  return `<div class="card"><h3 style="margin:0 0 4px">CR audit quota · ${tot[1] ? Math.round(tot[0] / tot[1] * 100) : 100}% met</h3><p class="small muted" style="margin:0 0 10px">${tot[0]} of ${tot[1]} required checks done in this period. A check counts from ${cfg.before} min before to ${cfg.after} min after its time. ${enforced ? "Penalties are active." : `Practice period: everything is counted, and penalties start ${fmt(pd(cfg.enforce_from))}.`}</p>
    <table><tr><th>Night</th><th>Branch</th><th>Done</th><th>Missed checks</th><th>Accountable (Floor role at San Antonio · supervisor at Jupiter)</th></tr>${rows.map(r => `<tr><td>${fmt(pd(r.d))}${r.d < (cfg.start || "") ? `<br><span class="chip c-Pencil">dry run · not counted</span>` : ""}</td><td>${OPS_BR[r.br]}</td><td><span class="chip ${r.req && r.done === r.req ? "c-Confirmed" : r.done ? "c-Pencil" : "c-Lost"}">${r.done}/${r.req}${r.req < r.m.length ? ` <span class="muted">(${r.m.length - r.req} still to come)</span>` : ""}</span></td><td class="small">${r.miss.map(x => crT12(x.t)).join(", ") || "—"}</td><td class="small">${r.own.map(id => esc(ename(emp(id)) || "")).join(", ") || `<span style="color:#c62828">${r.br === "sa" ? "Nobody picked the Floor role" : "No supervisor on the schedule"}</span>`}</td></tr>`).join("")}</table></div>
    <div class="card"><h3 style="margin:0 0 4px">Nights short of quota · last ${cfg.window_days || 30} days</h3><p class="small muted" style="margin:0 0 10px">1st night short = ${esc(cfg.ladder[0])} · 2nd = ${esc(cfg.ladder[1])} · 3rd or more = ${esc(cfg.ladder[2])} (due process). No salary deductions.</p>
    ${Object.keys(tally).length ? `<table><tr><th>Person</th><th>Nights short</th><th>Next step</th><th></th></tr>${Object.entries(tally).sort((a, b) => b[1].short - a[1].short).map(([id, t]) => { const lv = t.counted ? cfg.ladder[Math.min(t.counted, cfg.ladder.length) - 1] : null;
      return `<tr><td><b>${esc(ename(emp(id)) || "")}</b><br><span class="small muted">${t.list.slice(0, 4).map(esc).join("<br>")}${t.list.length > 4 ? `<br>+${t.list.length - 4} more` : ""}</span></td><td class="num">${t.short}${t.counted !== t.short ? `<br><span class="small muted">${t.counted} after ${fmt(pd(cfg.enforce_from))}</span>` : ""}</td><td class="small">${lv ? esc(lv) : "Practice period: reminder only"}</td><td>${lv ? `<button class="btn sm" onclick='crIssue(${JSON.stringify(id)},${JSON.stringify(lv)},${JSON.stringify(t.list.join("\n"))})'>Issue</button>` : ""}</td></tr>`; }).join("")}</table>` : `<div class="empty">Nobody is short of the quota.</div>`}</div>`; }
async function crIssue(id, level, list){ const e = emp(id); if (!e || !confirm(`Issue "${level}" to ${ename(e)} for missed CR checks? It goes to their My file and they must acknowledge it.`)) return;
  const body = `This is issued to ${e.first_name} ${e.last_name} as a staff member assigned to the Floor role (or the shift supervisor) and accountable for the CR (toilet) audit quota.\n\nNights the quota was not met:\n${list}\n\nThe CR must be checked and logged in the staff app at every scheduled time. Repeated failure to meet the quota will lead to the next step of the progressive discipline policy.`;
  const { error } = await sb.from("employee_records").insert({ employee_id: id, kind: "progressive", level, title: "CR audit quota not met", body, issued_date: iso(today), issued_by: me.email });
  if (error) return toast(error.message); await logAct(`EMP ${e.last_name}`, `${level} issued: CR audit quota not met`); toast("Issued. It's in their My file."); }
async function tabOpsToilet(){ const R = await opsLoad("toilet_audits"); if (!R) return; const crq = await crCompliance(R);
  $("#hr-body").innerHTML = opsBar() + crq + `<div class="card" style="padding:0"><table><tr><th>When</th><th>Toilet</th><th>Result</th><th>Failed checks</th><th>By</th><th>Note</th><th></th></tr>${R.map(a => { const f = Object.entries(a.checks || {}).filter(([, v]) => !v).map(([k]) => k); return `<tr><td class="small">${fmtTs(a.created_at)}<br>${OPS_BR[a.branch] || ""}</td><td>${esc(a.toilet)}</td><td><span class="chip ${a.passed === a.total ? "c-Confirmed" : "c-Lost"}">${a.passed}/${a.total}</span></td><td class="small">${f.map(esc).join(", ") || "—"}</td><td class="small">${esc(byName(a))}</td><td class="small" style="max-width:220px">${esc(a.note || "")}</td><td>${opsThumb(a.photo)}</td></tr>`; }).join("") || `<tr><td colspan="7" class="empty">No toilet audits in this period.</td></tr>`}</table></div>
`; }
async function tabOpsHuddle(){ const R = await opsLoad("huddles", "shift_date"); if (!R) return;
  const days = []; for (let k = 0; k < Math.min(OPF.days, 31); k++){ const d = new Date(); d.setDate(d.getDate() - k); days.push(iso(d)); }
  const brs = OPF.br ? [OPF.br] : ["sa", "ju"];
  $("#hr-body").innerHTML = opsBar() + `<div class="card"><h3 style="margin:0 0 8px">Huddle done?</h3>${brs.map(b => `<div style="display:flex;gap:8px;align-items:center;margin:6px 0"><span class="small" style="width:90px;font-weight:700">${OPS_BR[b]}</span><div style="display:flex;gap:4px;flex-wrap:wrap">${days.slice().reverse().map(d => { const h = R.find(x => x.shift_date === d && x.branch === b); return `<span title="${fmt(pd(d))}" style="width:26px;height:26px;border-radius:6px;display:inline-grid;place-items:center;font-size:10px;font-weight:700;${h ? "background:#dff3e6;color:#115a30" : "background:#fde3e3;color:#a22020"}">${pd(d).getDate()}</span>`; }).join("")}</div></div>`).join("")}<p class="small muted" style="margin:8px 0 0">Green = huddle recorded · red = none</p></div>
    <div class="card" style="padding:0"><table><tr><th>Shift</th><th>Led by</th><th>Covered</th><th>Attended</th><th>Key points</th></tr>${R.map(h => `<tr><td>${fmt(pd(h.shift_date))}<br><span class="small muted">${OPS_BR[h.branch] || ""} · ${new Date(h.created_at).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}</span></td><td>${esc(byName(h))}</td><td><span class="chip ${h.covered >= 7 ? "c-Confirmed" : "c-Pencil"}">${h.covered}/${Object.keys(h.checks || {}).length}</span></td><td class="small">${esc(h.attendees || "")}</td><td class="small" style="max-width:320px;white-space:pre-wrap">${esc(h.notes || "")}</td></tr>`).join("") || `<tr><td colspan="5" class="empty">No huddles recorded in this period.</td></tr>`}</table></div>`; }
async function tabOpsRcv(){ const R = await opsLoad("receiving_reports", "received_date"); if (!R) return;
  const tot = R.reduce((a, r) => a + (+r.amount || 0), 0), sup = {}; R.forEach(r => sup[r.supplier] = (sup[r.supplier] || 0) + (+r.amount || 0));
  $("#hr-body").innerHTML = opsBar() + `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr));margin-bottom:12px"><div class="card"><div class="small muted">Deliveries received</div><div style="font-size:22px;font-weight:700">${R.length}</div></div><div class="card"><div class="small muted">Total on receipts</div><div style="font-size:22px;font-weight:700">${peso(tot)}</div></div><div class="card"><div class="small muted">Top suppliers</div><div class="small">${Object.entries(sup).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${esc(k)} · <b>${peso(v)}</b>`).join("<br>") || "—"}</div></div></div>
    <div class="card" style="padding:0"><table><tr><th>Received</th><th>Supplier</th><th>Amount</th><th>Receipt no.</th><th>Area</th><th>By</th><th>Note</th><th>Receipt</th></tr>${R.map(r => `<tr><td>${fmt(pd(r.received_date))}<br><span class="small muted">${OPS_BR[r.branch] || ""}</span></td><td><b>${esc(r.supplier)}</b></td><td class="num">${peso(r.amount)}</td><td class="small">${esc(r.invoice_no || "")}</td><td class="small">${esc(r.category || "")}</td><td class="small">${esc(byName(r))}</td><td class="small" style="max-width:220px">${esc(r.note || "")}</td><td>${opsThumb(r.photo)}</td></tr>`).join("") || `<tr><td colspan="8" class="empty">No receiving reports in this period.</td></tr>`}</table></div>`; }

/* ---------- Workforce: employee file (memos, evaluations, incident reports, disciplinary notices) ---------- */
const REC_K = { memo: "Memo", evaluation: "Evaluation result", incident: "Incident report", progressive: "Disciplinary notice" };
const REC_LV = ["Notice to explain", "Verbal warning (documented)", "Written warning", "Final written warning", "Notice of suspension", "Notice of decision"];
async function tabWfRec(){
  const [{ data: r }, { data: a }] = await Promise.all([sb.from("employee_records").select("*").order("issued_date", { ascending: false }).limit(200), sb.from("record_acks").select("*")]);
  const R = r || [], A = a || [], act = H.emps.filter(e => e.active);
  $("#hr-body").innerHTML = `<div class="grid"><div class="card"><h3>Add to an employee's file</h3><p class="small muted">Shows in the person's "My file" tab in the staff app. They acknowledge receipt there; the date and any comment they leave are kept here.</p>
      <div class="fields"><label class="f">Type<select id="rc-k" onchange="$('#rc-lvw').hidden=this.value!=='progressive'">${Object.entries(REC_K).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></label><label class="f" id="rc-lvw" hidden>Level<select id="rc-lv">${REC_LV.map(x => `<option>${x}</option>`).join("")}</select></label>
      <label class="f">For<select id="rc-to"><option value="all">All staff</option><option value="br:sa">San Antonio team</option><option value="br:ju">Jupiter team</option><option value="br:fm">Funhan Mart team</option>${act.map(e => `<option value="${e.id}">${esc(ename(e))}</option>`).join("")}</select></label><label class="f">Date issued<input id="rc-d" type="date" value="${iso(new Date())}"></label></div>
      <label class="f">Title<input id="rc-t" maxlength="140" placeholder="e.g. Memo: New cash handling procedure"></label>
      <label class="f">Details<textarea id="rc-b" rows="5" placeholder="Write the memo, evaluation summary or incident details here."></textarea></label>
      <label class="f">Attachment (PDF or photo, optional)<input id="rc-f" type="file" accept="application/pdf,image/*"></label>
      <button class="btn primary" onclick="wfRecAdd()">Add to file</button><p class="small muted">Memos to a team are visible to everyone on that team. Evaluations, incident reports and disciplinary notices should go to one person.</p></div>
    <div class="card" style="grid-column:span 2"><h3>Issued</h3><table><tr><th>Date</th><th>Type</th><th>Title</th><th>For</th><th>Acknowledged</th><th></th></tr>${R.map(x => { const au = x.employee_id ? act.filter(e => e.id === x.employee_id) : act.filter(e => !x.branch || e.branch === x.branch), ak = A.filter(y => y.record_id === x.id);
        return `<tr><td>${fmt(pd(x.issued_date))}</td><td>${REC_K[x.kind]}${x.level ? `<br><span class="small muted">${esc(x.level)}</span>` : ""}</td><td><b>${esc(x.title)}</b>${x.file ? ` <a href="#" onclick="wfRecOpen('${esc(x.file)}','${x.employee_id ? "employee-docs" : "memos"}');return false">📄</a>` : ""}</td><td>${x.employee_id ? esc(ename(emp(x.employee_id))) : x.branch ? OPS_BR[x.branch] + " team" : "All staff"}</td>
          <td class="small">${x.employee_id ? (ak[0] ? `✓ ${fmtTs(ak[0].ack_at)}${ak[0].comment ? `<br><i>"${esc(ak[0].comment)}"</i>` : ""}` : `<span style="color:#a22020">Not yet</span>`) : `<b>${ak.length}</b> of ${au.length}`}</td><td><button class="btn sm ghost" onclick="wfRecDel('${x.id}')">Remove</button></td></tr>`; }).join("") || "<tr><td colspan='6' class='empty'>Nothing issued yet.</td></tr>"}</table></div></div>`; }
async function wfRecAdd(){ const t = $("#rc-t").value.trim(); if (!t) return toast("Add a title"); const to = $("#rc-to").value, k = $("#rc-k").value, f = $("#rc-f").files[0];
  const row = { kind: k, level: k === "progressive" ? $("#rc-lv").value : null, title: t, body: $("#rc-b").value.trim() || null, issued_date: $("#rc-d").value, issued_by: me.email, employee_id: to.length > 20 ? to : null, branch: to.startsWith("br:") ? to.slice(3) : null };
  if (f){ const ext = (f.name.split(".").pop() || "pdf").toLowerCase(), bucket = row.employee_id ? "employee-docs" : "memos", path = `${row.employee_id || "all"}/records/${Date.now()}.${ext}`;
    const { error } = await sb.storage.from(bucket).upload(path, f, { contentType: f.type }); if (error) return toast("Upload failed: " + error.message); row.file = path; }
  const { error } = await sb.from("employee_records").insert(row); if (error) return toast(error.message); toast("Added. It's in the staff app now."); tabWfRec(); }
async function wfRecOpen(path, bucket){ const { data } = await sb.storage.from(bucket).createSignedUrl(path, 600); if (data) window.open(data.signedUrl, "_blank"); }
async function wfRecDel(id){ if (!confirm("Remove this from the employee's file?")) return; const { error } = await sb.from("employee_records").delete().eq("id", id); if (error) return toast(error.message); tabWfRec(); }

/* ---------- attendance health ---------- */
const ATT_DEF = { period: "month", grace: 5, late_1: 2, late_2: 4, late_3: 6, notified_factor: 0.5, notice_min: 120, absent_notice: 5, absent_late_notice: 8, no_show: 20, missed_punch: 2, undertime: 3, offsite: 3, clean_week_bonus: 2, band_excellent: 90, band_good: 75, band_warn: 60 };
const ATT_F = [["Lateness", [["grace", "Grace period (minutes, no deduction)"], ["late_1", "Late 1–15 min (points off)"], ["late_2", "Late 16–30 min"], ["late_3", "Late more than 30 min"], ["notified_factor", "If they sent a ‘running late’ notice before the shift, multiply by", "0.1"]]],
  ["Absences", [["notice_min", "Notice counts as ‘ahead’ if sent this many minutes before the shift", "15"], ["absent_notice", "Absent, notified ahead"], ["absent_late_notice", "Absent, notified late"], ["no_show", "No call, no show"]]],
  ["Punches", [["missed_punch", "No time-out"], ["undertime", "Left early without approved UT"], ["offsite", "Punched outside the branch location"]]],
  ["Recovery and bands", [["clean_week_bonus", "Points back for a clean week (every scheduled day on time)"], ["band_excellent", "Excellent from"], ["band_good", "Good from"], ["band_warn", "Needs improvement from (below = At risk)"]]]];
const hpBand = sc => { const c = { ...ATT_DEF, ...(H.att || {}) }; return sc >= c.band_excellent ? ["Excellent", "#1f9d55"] : sc >= c.band_good ? ["Good", "#2b7bb9"] : sc >= c.band_warn ? ["Needs improvement", "#d98e04"] : ["At risk", "#c0392b"]; };
async function attCard(owner){
  const { data } = await sb.from("settings").select("value").eq("key", "attendance").maybeSingle(); H.att = data?.value || {};
  const c = { ...ATT_DEF, ...H.att }, box = $("#att-card"); if (!box) return;
  box.innerHTML = `<h3>Attendance health</h3><p class="small muted">Every employee starts at <b>100</b>. Points come off for the issues below and come back for clean weeks. Approved leave and rest days never count. The score shows on their profile, in the People list and in their staff app.</p>
    <div class="fields"><label class="f">Score resets<select id="at-period" ${owner ? "" : "disabled"}><option value="month" ${c.period === "month" ? "selected" : ""}>Every 1st of the month</option><option value="rolling30" ${c.period === "rolling30" ? "selected" : ""}>Rolling: last 30 days</option></select></label></div>
    ${ATT_F.map(([t, fs]) => `<div class="small muted" style="font-weight:700;margin-top:10px">${t}</div><div class="fields">${fs.map(([k, l, st]) => `<label class="f">${l}<input id="at-${k}" type="number" step="${st || 1}" min="0" value="${c[k]}" ${owner ? "" : "disabled"}></label>`).join("")}</div>`).join("")}
    ${owner ? `<div class="actions"><button class="btn primary" onclick="attSave()">Save attendance rules</button><button class="btn ghost" onclick="attReset()">Back to standard</button></div>` : `<p class="small muted">Only the owner can change these.</p>`}`;
}
async function attSave(){ const v = { period: $("#at-period").value }; Object.keys(ATT_DEF).filter(k => k !== "period").forEach(k => v[k] = +$(`#at-${k}`).value || 0);
  if (!(v.band_excellent > v.band_good && v.band_good > v.band_warn)) return toast("Bands must go Excellent > Good > Needs improvement");
  const { error } = await sb.from("settings").upsert({ key: "attendance", value: v }); if (error) return toast(error.message); H.att = v; H.hp = null; toast("Attendance rules saved"); }
async function attReset(){ if (!confirm("Use the standard attendance rules?")) return; const { error } = await sb.from("settings").upsert({ key: "attendance", value: ATT_DEF }); if (error) return toast(error.message); H.hp = null; attCard(true); toast("Standard rules restored"); }
async function hpFill(){
  if (!H.hp || Date.now() - H.hpAt > 120000){ const { data, error } = await sb.rpc("attendance_health_all"); if (error) return; H.hp = data || {}; H.hpAt = Date.now(); }
  document.querySelectorAll(".hpc").forEach(el => { const h = H.hp[el.dataset.hp]; if (!h) return; const [b, col] = hpBand(+h.score); el.innerHTML = `<span class="small" style="color:${col};font-weight:700" title="Attendance health · ${b}">♥ ${+h.score}</span>`; });
}
async function hpShow(id){
  const box = $("#em-hp"); if (!box) return; const { data: h, error } = await sb.rpc("attendance_health", { p_emp: id }); if (error || !h) return;
  const [b, col] = hpBand(+h.score);
  box.innerHTML = `<div class="card" style="margin:0;border-color:${col}"><div style="display:flex;align-items:center;gap:14px"><div style="width:64px;height:64px;border-radius:50%;border:5px solid ${col};display:grid;place-items:center;font-size:20px;font-weight:800;color:${col}">${+h.score}</div><div><b>Attendance health · <span style="color:${col}">${b}</span></b><div class="small muted">${fmt(pd(h.from))} – ${fmt(pd(h.to))} · −${+h.deducted} pts${+h.bonus ? ` · +${+h.bonus} back` : ""}</div></div></div>
    ${h.items.length ? `<table style="margin-top:10px">${h.items.map(i => `<tr><td class="small">${fmt(pd(i.date))}</td><td class="small">${esc(i.kind)}</td><td class="small" style="text-align:right;font-weight:700;color:${i.points < 0 ? "#c0392b" : "#1f9d55"}">${i.points > 0 ? "+" : ""}${+i.points}</td></tr>`).join("")}</table>` : `<p class="small muted" style="margin:8px 0 0">No issues this period.</p>`}</div>`;
}

function nextAnniv(d){ const h = pd(d), t = new Date(); t.setHours(0, 0, 0, 0); let a = new Date(t.getFullYear(), h.getMonth(), h.getDate()); if (a <= t) a = new Date(t.getFullYear() + 1, h.getMonth(), h.getDate()); return a; }

/* incomplete registrations (48-hour acknowledgment) */
const regMiss = e => [...(!e.id_photo || !e.id_type ? ["Valid ID"] : []), ...(!e.sss_no ? ["SSS"] : []), ...(!e.philhealth_no ? ["PhilHealth"] : []), ...(!e.pagibig_no ? ["Pag-IBIG"] : []), ...(!e.tin ? ["TIN"] : [])];
const regInc = e => { const i = e.consent?.incomplete; if (!i || i.completed_at || !["active", "pending"].includes(e.status)) return null; const m = regMiss(e); if (!m.length) return null; const left = new Date(i.due) - Date.now(); return { ...i, miss: m, left, over: left <= 0 }; };
const regChip = e => { const r = regInc(e); if (!r) return ""; return ` <span class="chip" style="background:${r.over ? "#fde2e2" : "#fff4dc"};color:${r.over ? "#a22020" : "#8a5a00"}" title="Missing: ${r.miss.join(", ")}">${r.over ? "⚠️ overdue" : `📝 ${Math.ceil(r.left / 3600000)}h left`}</span>`; };
function regBanner(){ const list = H.emps.map(e => ({ e, r: regInc(e) })).filter(x => x.r); if (!list.length) return ""; const over = list.filter(x => x.r.over);
  return `<div class="card" style="border-color:${over.length ? "#c0392b" : "#d98e04"};margin-bottom:12px">📝 <b>${list.length}</b> incomplete registration${list.length > 1 ? "s" : ""}${over.length ? ` · <b style="color:#c0392b">${over.length} overdue</b>` : ""}: ${list.map(x => `<a href="#" onclick="showEmp('${x.e.id}');return false">${esc(ename(x.e))}</a> <span class="small muted">(${x.r.miss.join(", ")})</span>`).join(" · ")}</div>`; }
function regCard(e){ const r = regInc(e); if (!r) return "";
  return `<div class="card" style="margin-top:12px;border-color:${r.over ? "#c0392b" : "#d98e04"}"><b>${r.over ? "⚠️ Registration overdue" : "📝 Registration incomplete"}</b><div class="small" style="margin:6px 0">Missing: <b>${r.miss.join(", ")}</b> · acknowledged ${fmtTs(r.acknowledged_at)} · due ${fmtTs(r.due)}</div>
    ${r.over ? `<button class="btn sm" onclick="regLetter('${e.id}')">Issue letter of non-compliance</button>` : `<span class="small muted">They can submit it in the staff app (Clock tab).</span>`}</div>`; }
async function regLetter(id){ const e = emp(id), r = regInc(e); if (!e || !r) return; if (!confirm(`Issue a letter of non-compliance to ${ename(e)}? It appears in their My file and they must acknowledge it.`)) return;
  const body = `This letter is issued to ${e.first_name} ${e.last_name} for not completing the employment registration requirements within 48 hours, as acknowledged on ${fmtTs(r.acknowledged_at)}.\n\nMissing: ${r.miss.join(", ")}.\n\nPlease submit the missing requirements through the staff app immediately. Continued non-compliance may lead to further disciplinary action under the company's progressive discipline policy.`;
  const { error } = await sb.from("employee_records").insert({ employee_id: id, kind: "progressive", level: REC_LV?.[0] || null, title: "Letter of non-compliance: incomplete registration requirements", body, issued_date: iso(today), issued_by: me.email });
  if (error) return toast(error.message); await logAct(`EMP ${e.last_name}`, `Letter of non-compliance issued (registration incomplete: ${r.miss.join(", ")})`); toast("Letter issued. It's in their My file."); }
