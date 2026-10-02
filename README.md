# Catchin' Up booking site

Customer booking site (`index.html`) and management portal (`manage.html`) for Catchin' Up Pub, backed by Supabase project **catchinup-bookings** (Singapore).

## Go live: three short steps

### 1. Put the site on GitHub Pages (5 minutes)

1. On github.com, click **New repository**, name it `catchinup`, keep it **Public**, click **Create repository**.
2. On the empty repo page click **uploading an existing file**, drag in the four files (`index.html`, `manage.html`, `config.js`, `README.md`), then **Commit changes**.
3. Go to **Settings → Pages**. Under *Build and deployment* choose **Deploy from a branch**, branch **main**, folder **/ (root)**, click **Save**.
4. After a minute the site is live at `https://flrsjm17.github.io/catchinup/`. The management portal is `https://flrsjm17.github.io/catchinup/manage.html`.

To use your own address later, add it under **Settings → Pages → Custom domain** and point a CNAME at `flrsjm17.github.io`.

### 2. Supabase: emails and your login (5 minutes)

Open https://supabase.com/dashboard/project/fmjoslnzppvxctoplrdg

- **Edge Functions → Secrets**, add:
  - `RESEND_API_KEY` — from resend.com → API Keys (free account). Until you verify your domain there, Resend only delivers to your own email; after adding the two DNS records Resend shows for `tablebondgroup.ph`, set `FROM_EMAIL` to `Catchin' Up Pub <bookings@tablebondgroup.ph>`.
  - `NOTIFY_EMAILS` — where new bookings go, e.g. `flrsjm17@gmail.com, maybelle@…` (commas between).
- **Authentication → Users → Add user**: your email `flrsjm17@gmail.com` with a password. That's your portal login (you're already on the staff list as owner).
- **Authentication → URL Configuration**: set *Site URL* to `https://flrsjm17.github.io/catchinup/manage.html` so sign-in links land on the portal.

### 3. Test (3 minutes)

Open the site on your phone, book a table for tonight, then open the portal: it's under **Today**. Mark it Cancelled to free the tables.

## How it works

- Customers never touch the database directly. The page calls one Edge Function (`public-api`) which checks table availability inside a database lock (two people can't take the last tables at once), writes the booking and emails both sides.
- Table (1–6): status **Booked**. Big group (7–18): status **Pencil** with the ₱400-a-head minimum and ₱100-a-head down payment recorded; mark *Down payment received* in the portal to move it to **Booked**. Cancelled and No-show free the tables.
- Private events: inquiries land as **New**; the portal moves them through Contacted → Quoted → Pencil (holds the slot 24 h) → Deposit paid → Confirmed. Pencil, Deposit paid and Confirmed show the slot as taken on the customer page.
- The portal is for people on the **staff** table only (Settings → Staff). Roles: owner (settings and staff), events, manager, consultant.
- Marketing tab: posting calendar, monthly checklist and the enquiry log with reply-time and commission (0.5% of verified bookings ≥ ₱30,000, retainer ₱10,000, 2-hour reply window; edit in the `consultant_terms` table).
- No payment gateway. Down payments are sent by GCash or bank (details in Settings → Contact and payment) and marked by hand.

## Changing things

- Rates, tables, opening hours: tables `branches` and `settings` in Supabase (owner can edit most of `settings` from the portal).
- Menu, packages and the page itself: edit `index.html` and re-upload to GitHub.
- The booking API: Supabase → Edge Functions → `public-api`.

## HR & Payroll (manager and owner only)

Files: `hr.js` (loaded by `manage.html`) and `staff.html` (the staff app: time clock, schedule, timesheet, payslips). Open **HR & Payroll** in the portal.

**Two layers.** A *manager* prepares payroll (processor). The *owner* approves and releases it (controller). The database refuses an approval by the same person who prepared the run, and approved runs are frozen.

**Each cut-off (11–25, 26–10):**
1. *Line-up* — set the month's schedule (or press "Fill empty days from default shifts"). With no line-up, each employee's default shift and rest days are used.
2. *Timesheets* — upload the timesheet export CSV (same format as today), or let staff punch on `staff.html`. Then press **List exceptions**.
3. *Exceptions* — approve or reject early-ins, overtime, under-lunch and rest-day work. Only approved ones are paid. Late, undertime and over-lunch are deducted automatically; absences are listed for information.
4. *Payroll* — **Generate**. Check each line (click it for the day-by-day breakdown, add allowances or cash-advance deductions). **Send for review** → owner **Approves** → **Mark released**. Download the CSV or print payslips.

**Rules** tab holds the multipliers (OT 125%, ND 10%, rest day 130%, special 130%, regular holiday 200%…), the 1-hour assumed lunch, the 15-minute tolerance, and when SSS/PhilHealth/Pag-IBIG are deducted (default: once a month on the 26–10 run). Contribution tables and the BIR semi-monthly tax table live in Supabase → `settings` → `payroll`. Minimum-wage earners (flag on the employee) have no withholding tax.

**Staff app** (`staff.html`): add an employee under Employees with their email and the invite goes out automatically (or press *Send invite* / *Resend link*). The email carries a link to `staff.html` where they create a password. After that they sign in on their phone and see only their own schedule (next 30 days), timesheet for the current cut-off, and payslips for released cut-offs, plus the time clock: Time in → Lunch out → Lunch in → Time out, each with a selfie. Selfies go to the private `selfies` bucket; only management can view them (📱 icon under Timesheets).

**One-time setup for invites (Supabase → Authentication):**
- *URL Configuration → Redirect URLs*: add `https://flrsjm17.github.io/catchinup/staff.html` and `https://flrsjm17.github.io/catchinup/manage.html`.
- *Emails → SMTP settings*: turn on custom SMTP and use Resend (host `smtp.resend.com`, port 465, user `resend`, password = your Resend API key, sender = the address you verified). Without this, Supabase's built-in sender allows only a couple of emails an hour and lands in spam.
- *Emails → Templates → Invite user*: optional, reword it ("You've been added to the Catchin' Up staff app. Tap to create your password.").

## Privacy notice (Data Privacy Act of 2012)

Customers see the notice (with the NPC mark, over a blurred page) the first time they reach a booking form, and must tick and press **I accept and continue** before a booking or inquiry can be sent. The database refuses a booking without consent. Each booking and inquiry stores what was accepted, when and which version (`consent` column; shown in the portal under Privacy). The PDF is at `privacy-notice.pdf`. To change the wording, edit the text inside `<div id="pv">` in `index.html` and bump `PV_VERSION`; customers will be asked again.

## Employee registration and master list

Send new hires the registration link (Employees tab → *Copy registration link*, it is `register.html`). They fill in personal details, branch (Catchin' Up San Antonio, Catchin' Up Jupiter, or Funhan Mart Arnaiz), position, SSS/PhilHealth/Pag-IBIG/TIN, emergency contact, a photo of a valid ID and a selfie, and accept the employee privacy consent. The registration lands as **pending** in the Employees master list. Click it to see everything including the ID photo, set the hourly rate and default shift, and press **Approve and send staff-app invite**. The list filters by branch and status, sorts, and downloads as CSV. ID photos and selfies are in the private `employee-docs` bucket; only owner/manager can open them.

Funhan Mart staff use the same staff app, line-up, timesheets and payroll. They never see bookings; the booking pages are only for the owner, events and manager accounts.
