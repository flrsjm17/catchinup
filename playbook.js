/* Catchin' Up · Playbook tab: copy-paste replies, phone script, captions. Loaded by manage.html. Edit the text here; keep the structure. */
const PLAYBOOK = {
  intro: "Same voice everywhere: warm, short, one link, one next step. Change the name, paste, send. Taglish is fine when the customer writes Taglish. Every reply carries the one link: catchinup.tablebondgroup.ph",
  sections: [
    { title: "Messenger · Instagram · WhatsApp · Viber", items: [
      { q: "\"May table pa ba / can we reserve a table?\" (up to 6)", a: "Hi [Name]! Yes, you can book your table in under a minute here: catchinup.tablebondgroup.ph. Pick the branch, date and time and it shows you what's open. It's free, no deposit. See you at Catchin' Up!" },
      { q: "\"We're 10 pax / barkada birthday\" (7 to 18)", a: "Hi [Name]! For 7 to 18 guests, book under \"Big group\" here: catchinup.tablebondgroup.ph. It's ₱400 per head minimum consumable (food and drinks), and a ₱100 per head down payment holds your tables; the down payment is deducted from your bill. You can even order your food ahead so it's ready when you arrive. The site shows the QR for the down payment at the end. Just send us the screenshot with your reference number and you're confirmed!" },
      { q: "\"How much for 40 pax / company party?\" (20 and up)", a: "Hi [Name]! Exciting! The fastest way to see packages and get an estimate is here: catchinup.tablebondgroup.ph, tap \"Private event\". Choose your date, number of guests and packages, and it sends us your inquiry with a reference number. Our events team will then confirm the date and your final quote. If you'd rather, tell me the date and headcount and I'll walk you through it." },
      { q: "Down payment screenshot received", a: "Got it, thank you [Name]! Reference [BG-xxxxxx-xxx] is now confirmed for [date, time, branch, pax]. Please arrive within 15 minutes of your time; the tables are yours for 2 hours but stay as long as you like. See you!", note: "Then in the portal: open the booking → Down payment received." },
      { q: "Friday table request (up to 6)", a: "Hi [Name]! Fridays are walk-in only for small tables, so no reservation needed; just come early for the best spots. If you're 7 or more, you can still reserve a Friday as a big group here: catchinup.tablebondgroup.ph." },
      { q: "Big group request between Oct 20 and Dec 20", a: "Hi [Name]! From Oct 20 to Dec 20 we're on private-events season, so big-group bookings are paused. You can still book a free table for up to 6, or if you'd like the place to yourselves, I can set you up as a private event. Which works for you?" },
      { q: "\"The site didn't work\"", a: "Sorry about that [Name]! Can you tell me what it said on the screen (or send a screenshot)? Meanwhile, give me your branch, date, time and number of guests and I'll book it for you from here.", note: "Then in the portal: Bookings → Add by hand." },
      { q: "\"I didn't get an email\"", a: "No worries [Name], your reference is [TR-xxxxxx-xxx]; just show it at the door. See you!", note: "Find them under Bookings by name or mobile." },
      { q: "\"I'm 25 pax but it says private event\"", a: "Yes [Name], from 20 guests up it's a private event: you get the place (or the indoor area) to yourselves, and the minimum is on food and drinks you'd order anyway. Tap \"Private event\" here and pick your date: catchinup.tablebondgroup.ph" }
    ]},
    { title: "Phone · 30 seconds", items: [
      { q: "Opening", a: "Catchin' Up Pub, good [afternoon], this is [Name]!" },
      { q: "Table, up to 6", a: "Sure! The quickest way is our booking page, catchinup dot tablebondgroup dot ph, it shows you the open times right now and it's free. Or I can do it for you now: which branch, what date and time, and how many of you?", note: "Book it under Bookings → Add by hand, then: \"You're set, your reference is TR-[…]. Show it at the door, come within 15 minutes of your time, and the table's yours for 2 hours, stay longer if you like.\"" },
      { q: "7 to 18", a: "For a group that size we do a ₱400 per head minimum on food and drinks, and a ₱100 per head down payment that comes off your bill. I'll text you the link so you can pick your tables and pay the down payment by QR; the moment we get your screenshot you're confirmed." },
      { q: "20 and up", a: "Perfect, that's a private event. May I get your name, the date, and how many guests? I'll send you the link where you can see the packages and build your estimate, and our events team will call you back with the final quote." },
      { q: "Friday, up to 6", a: "Fridays are walk-in only for small tables, so no need to book, just come early. For 7 or more I can still reserve." },
      { q: "Closing", a: "Your reference is [TR-/BG-/CU-…]. Please arrive within 15 minutes of your time. See you at Catchin' Up!", note: "Always read the reference back. Never quote package prices from memory; the site and the proposal PDF are the source." }
    ]},
    { title: "Announcing it", items: [
      { q: "Pinned post / Facebook", a: "Booking at Catchin' Up just got easier. 🍻\nReserve your table, lock in your barkada's big night, or plan your private event in under two minutes: catchinup.tablebondgroup.ph\nLive availability, no deposit for tables up to 6, and your reference number straight to your inbox.\nSan Antonio Place · Jupiter Street · Makati" },
      { q: "Instagram caption", a: "New: book your night at Catchin' Up online. Tap the link in bio, pick your branch and time, done. Tables up to 6 are free to book. 7 to 18? Reserve your corner and order ahead. 20 and up? The whole place can be yours.\n#CatchinUpPub #MakatiNights #BookNow" },
      { q: "Auto-reply / away message", a: "Thanks for messaging Catchin' Up! While you wait, you can book a table or plan an event right now at catchinup.tablebondgroup.ph. We'll reply shortly." },
      { q: "Stories, 3 frames", a: "1. \"May plans tonight?\" over the hero video · link sticker: Book a table\n2. \"Barkada night? 7 to 18 pax, ₱100/head holds your tables\" · link sticker\n3. \"Your event, your venue\" over the San Antonio room · link sticker: Plan a private event", note: "Put the link in the Facebook Website field, Instagram bio, TikTok bio and Google Business. Retire any \"DM to reserve\" wording." }
    ]},
    { title: "Private events · the 6 steps", items: [
      { q: "1 · Pencil booked (automatic)", a: "The website pencil-books the date for 24 hours and emails the customer their reference, the food guide link and a 'plan your menu' link. If someone else also pencil-booked the same slot, both customers are told the first down payment wins.", note: "Open the event in the portal: the 'Where we are' steps show what to do next. Everything you click there emails the customer in the same design." },
      { q: "2 · Contact within 2 hours", a: "Hi [Name], this is [Your name] from Catchin' Up! Thanks for pencil-booking [date, slot] at [branch] for [guests] guests. I'd like to confirm a few details and your menu. Is now a good time? Would you also like to drop by for an ocular visit before we finalize?", note: "Press 'I contacted them' (this is your response-time KPI). If they haven't chosen food yet, plan it with them on the call; the food guide goes out after the down payment." },
      { q: "3 · Ocular visit (optional)", a: "Great, let's set your visit: how about [day, time] at [branch]? I'll walk you through the space and the set-up for [guests] guests.", note: "Press 'Set a visit' (customer gets the email) or 'Not needed'. After the visit, press 'Visit done'." },
      { q: "4 · Send the SOA", a: "Before I send your statement of account, let me confirm: [date and slot], [venue/area], [guests], [menu], [amounts], [50% deposit], [contact details]. Should the SOA be addressed to you or to a company? Any TIN to include?", note: "Press 'Send SOA', tick each line as you confirm it, type who it's addressed to and the TIN, then 'Send SOA by email'. The SOA carries the branch QR codes from Settings. 'Preview / print' gives a PDF for Viber/Messenger." },
      { q: "5 · Down payment received", a: "Received, thank you [Name]! Your [date] at [branch] is now locked. We're checking availability for your advance order and will confirm it shortly.", note: "Press 'Record down payment': channel, amount, date, reference number from the screenshot, Submit. Status turns green and the customer gets the 'date locked' email." },
      { q: "6 · Food guide, then confirm the advance order", a: "Thanks [Name], your date is locked! I'm sending you our food guide now. The food and drinks you chose are still subject to availability; please give us 24 to 48 hours and we'll confirm your order.", note: "Press 'Send food guide' right after the down payment (the email says choices are subject to availability, confirmation within 24–48 h). After checking with the kitchen, press 'Confirm advance order'. For changes of date use 'Reschedule' (pink); for a lost event use 'Cancel event' (red)." }
    ]},
    { title: "Staff registration (internal)", items: [
      { q: "Group-chat message to employees", a: "Hi team! 👋\n\nWe're moving to our own staff system, and the first step is simple: everyone registers once online.\n\n📋 Registration link: https://catchinup.tablebondgroup.ph/register.html\n\nTakes about 5 minutes on your phone. Have these ready:\n• Your mobile number and an email you actually use (this becomes your login later)\n• Home address and an emergency contact\n• SSS, PhilHealth, Pag-IBIG and TIN numbers (leave blank if you don't have one yet, HR will follow up)\n• One valid ID: take a clear photo of the front, flat, all text readable\n• A selfie for your profile: plain background, face clear, no cap or sunglasses\n\nPick your branch (San Antonio, Jupiter, or Funhan Mart Arnaiz) and your position, tick the privacy consent, and submit. You'll see a \"Thanks\" screen; that's it.\n\nWhat happens next: nothing yet on your side. HR reviews each registration, then you'll get an email when your staff-app access is ready. Please don't wait for that email to register.\n\nDeadline: please finish by [day, date]. One registration per person; if you make a mistake, message [HR contact] instead of registering again.\n\nQuestions? Reply here or message [HR contact]. Thanks, everyone!" }
    ]}
  ]
};
/* Call guides: the infographics behind the floating "Call guide" button and the first Playbook tab. Add a guide = add a line. */
const CALL_GUIDES = [
  { cat: "Incoming calls", items: [
    { t: "Phone inquiry script", d: "Tables, big groups and private events: answer, get details, share the link, close.", img: "guide-phone-inquiry-script.webp" },
    { t: "Private event rates", d: "Quick rate overview per branch and what to say if they insist on a number.", img: "guide-private-event-rates.webp" } ] },
  { cat: "Follow-up calls", items: [
    { t: "Cold call · email follow-up", d: "Past inquiries: check they got the email and see if they're still planning.", img: "guide-cold-call-follow-up.webp" } ] },
  { cat: "Menu & prices", items: [
    { t: "Menu & best sellers", d: "Price ranges and top sellers per category (Q4 2025).", img: "guide-menu-best-sellers.webp" } ] },
];
const GUIDE_VER = "20261002";
function guideGrid(onclick){ return CALL_GUIDES.map((c, ci) => `<h3 style="margin:18px 0 8px">${esc(c.cat)}</h3><div class="cg-grid">${c.items.map((g, gi) => `<button class="cg-card" onclick="${onclick}(${ci},${gi})"><img src="${g.img}?v=${GUIDE_VER}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'cg-miss',textContent:'Image not uploaded yet: ${g.img}'}))"><b>${esc(g.t)}</b><span>${esc(g.d)}</span></button>`).join("")}</div>`).join(""); }
function cgOpen(ci, gi){ const sh = document.getElementById("cg-sheet"); if (!sh) return; document.body.classList.add("cg-on");
  const body = document.getElementById("cg-body");
  if (ci == null) { document.getElementById("cg-title").textContent = "Call guide"; document.getElementById("cg-back").hidden = true; body.innerHTML = `<p class="muted small" style="margin:0">Pick the guide for this call. Tap the picture to zoom.</p>${guideGrid("cgOpen")}`; }
  else { const g = CALL_GUIDES[ci].items[gi]; document.getElementById("cg-title").textContent = g.t; document.getElementById("cg-back").hidden = false;
    body.innerHTML = `<div class="muted small" style="margin:0 0 10px">${esc(CALL_GUIDES[ci].cat)} · ${esc(g.d)}</div><a href="${g.img}?v=${GUIDE_VER}" target="_blank" title="Open full size"><img src="${g.img}?v=${GUIDE_VER}" alt="${esc(g.t)}" style="width:100%;height:auto;border-radius:12px;border:1px solid var(--line);display:block"></a>`; }
  body.scrollTop = 0; }
function cgClose(){ document.body.classList.remove("cg-on"); }
(function(){ const css = document.createElement("style"); css.textContent = `
.cg-fab{position:fixed;right:20px;bottom:20px;z-index:65;display:none;align-items:center;gap:8px;background:#161616;color:#fff;border:0;border-radius:999px;padding:12px 18px 12px 14px;font:600 14px/1 inherit;box-shadow:0 8px 24px rgba(0,0,0,.22);cursor:pointer}
.cg-fab svg{width:18px;height:18px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
body.cg-ready .cg-fab{display:flex}
.cg-scrim{position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:70;display:none}
.cg-sheet{position:fixed;top:0;right:0;bottom:0;width:min(560px,100%);background:#fff;z-index:71;transform:translateX(100%);transition:transform .22s ease;display:flex;flex-direction:column;box-shadow:-12px 0 40px rgba(0,0,0,.18)}
body.cg-on .cg-scrim{display:block}body.cg-on .cg-sheet{transform:none}
.cg-hd{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--line)}.cg-hd h2{margin:0;font-size:18px;flex:1}
#cg-body{overflow:auto;padding:14px 16px 40px;flex:1}
.cg-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px}
.cg-card{display:flex;flex-direction:column;gap:4px;text-align:left;background:#fff;border:1px solid var(--line);border-radius:12px;padding:8px;cursor:pointer;font:inherit;color:inherit}
.cg-miss{height:150px;display:grid;place-items:center;text-align:center;padding:10px;font-size:12px;color:var(--muted);background:var(--soft);border-radius:8px}
.cg-card:hover{border-color:#161616}.cg-card img{width:100%;height:150px;object-fit:cover;object-position:top;border-radius:8px;background:var(--soft)}.cg-card b{font-size:14px;margin-top:4px}.cg-card span{font-size:12.5px;color:var(--muted);line-height:1.4}
@media (max-width:860px){.cg-fab{bottom:calc(84px + env(safe-area-inset-bottom));right:14px;padding:11px 14px}.cg-fab span{display:none}}
@media print{.cg-fab,.cg-sheet,.cg-scrim{display:none!important}}`; document.head.appendChild(css);
  const fab = document.createElement("button"); fab.className = "cg-fab"; fab.title = "Call guide"; fab.innerHTML = `<svg viewBox="0 0 24 24"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg><span>Call guide</span>`; fab.onclick = () => cgOpen();
  const scrim = document.createElement("div"); scrim.className = "cg-scrim"; scrim.onclick = cgClose;
  const sheet = document.createElement("aside"); sheet.className = "cg-sheet"; sheet.id = "cg-sheet"; sheet.setAttribute("aria-label", "Call guide");
  sheet.innerHTML = `<div class="cg-hd"><button class="btn sm ghost" id="cg-back" hidden onclick="cgOpen()">← All guides</button><h2 id="cg-title">Call guide</h2><button class="btn sm ghost" onclick="cgClose()" aria-label="Close">Close</button></div><div id="cg-body"></div>`;
  document.body.append(fab, scrim, sheet);
  document.addEventListener("keydown", e => { if (e.key === "Escape") cgClose(); });
  const sync = () => { const nav = document.getElementById("nav"); document.body.classList.toggle("cg-ready", !!nav && !nav.hidden); };
  sync(); const nav = document.getElementById("nav"); if (nav) new MutationObserver(sync).observe(nav, { attributes: true, attributeFilter: ["hidden"] });
})();
let pbTab = -1;
function playbook(){
  const S = PLAYBOOK.sections;
  document.body.classList.remove("ro"); pageRo = false; $("#main").innerHTML = `<h1>Playbook</h1><p class="muted" style="max-width:70ch">${esc(PLAYBOOK.intro)}</p>
    <div class="tabs"><button aria-pressed="${pbTab === -1}" data-i="-1">Call guides</button>${S.map((s, i) => `<button aria-pressed="${pbTab === i}" data-i="${i}">${esc(s.title)}</button>`).join("")}<a class="btn sm primary" href="guide-marketing.pdf" target="_blank" style="margin-left:auto">Portal guide (PDF)</a><a class="btn sm ghost" href="playbook.pdf" target="_blank">Scripts PDF</a></div>
    ${pbTab === -1 ? `<p class="muted small" style="margin:12px 0 0">The same guides open from the <b>Call guide</b> button at the bottom right of every page, so you can pull one up mid-call.</p>${guideGrid("cgOpen")}` : `<div class="grid">${S[pbTab].items.map((it, k) => `<div class="card"><h3 style="margin-bottom:8px">${esc(it.q)}</h3><div style="white-space:pre-wrap;font-size:14.5px;line-height:1.5;background:var(--soft);border-radius:10px;padding:12px 14px" id="pb-${k}">${esc(it.a)}</div>${it.note ? `<p class="small muted" style="margin:8px 0 0">${esc(it.note)}</p>` : ""}<div class="actions" style="margin-bottom:0"><button class="btn sm primary" onclick="pbCopy(${k})">Copy</button></div></div>`).join("")}</div>`}`;
  document.querySelectorAll(".tabs button").forEach(b => b.onclick = () => { pbTab = +b.dataset.i; playbook(); });
}
function pbCopy(k){ const t = PLAYBOOK.sections[pbTab].items[k].a; (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => toast("Copied, paste it in the chat"), () => { const ta = document.createElement("textarea"); ta.value = t; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove(); toast("Copied"); }); }
