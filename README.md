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
