# Buff Beauty Bar: Booking

A simple, mobile-first booking page for [Buff Beauty Bar](https://buffbeautybar.com) in New Orleans. It's the first screen of a lighter replacement for Booker.

Plain HTML, CSS and JavaScript. No build step and no dependencies.

## Run it

Open `index.html` in a browser. To test on your phone over Wi-Fi, serve the folder locally:

```bash
python3 -m http.server 8080
# then visit http://<your-computer-ip>:8080
```

To host it for free, use GitHub Pages: open the repo's **Settings → Pages**, set **Deploy from branch** to `main` and the folder to `/ (root)`.

## The booking flow

1. **Booking.** Clients pick from the full Buff menu by category (or tap + on the Services page to start with one picked). They can book up to 3 guests at the same time.
2. **Provider.** A specific pro, or "First available".
3. **Date & time.** Open times grouped into morning, afternoon and evening. If nothing works, they can join the waitlist.
4. **Details.** Name, mobile, email and a note. Clients must accept the cancellation policy. A spot for the card-on-file field is ready for Stripe.
5. **Confirmation.** Shows a reference number and an **Add to calendar** button (downloads an .ics file).

No login is required.

## Manage a booking (`manage.html`)

Clients enter their reference and mobile number to see their booking and cancel it. If the visit is within the cancellation window, the page warns that a fee may apply. To reschedule, they cancel and book again. The confirmation screen links straight here.

## Front desk (`staff.html`)

- **Schedule.** A day view with one column per provider. Tap an appointment to check the client in, mark a no-show, or cancel. Cancelling frees the time for online booking straight away. Cancelled visits are listed below the grid.
- **Waitlist.** Everyone waiting from today on, with the times that are open for their visit right now. One tap opens a text with the opening already written.
- **Time off.** A provider requests time off, and the manager approves or denies it. The request lists any appointments already booked in that window. Approved time off blocks online booking. Pending requests show on the schedule but don't block anything yet.

There's no login yet, so don't share the link widely.

## Files

| File | What it does |
|---|---|
| `index.html` | Page shell: header, progress bar, footer |
| `css/styles.css` | Buff colors (blush `#FBE9DD`, slate `#48555E`) and layout |
| `js/config.js` | **Edit this file.** It holds hours, services, prices, durations, providers and policy |
| `js/api.js` | Data layer. It is a **mock** for now (see below) |
| `js/app.js` | The booking flow |
| `manage.html`, `js/manage.js` | Client lookup and cancel |
| `staff.html`, `js/staff.js`, `css/staff.css` | Front desk: schedule, waitlist, time off, team (photos, Instagram), locations (where each provider works, days, travel time) and staff logins, menu, specials, gift cards, business details, hours and booking rules |
| `js/places.js` | Places: where providers work, travel time between places (estimated from the map or set by hand), map lookup. The database (`_works_there`, `_travel_min`, `_free_at`) decides what can be booked |
| `tools/stamp.py` | Adds `?v=<version>` to the CSS and JS links in every page so browsers pick up changes right away. Run it before committing JS or CSS changes |
| `js/legal.js` | The front desk Legal tab: possible legal issues by category (edit the list here) |
| `book.html`, `js/book.js` | Staff booking for phone and walk-in clients, with the day's schedule alongside |
| `account.html`, `js/account.js` | Client sign-in: upcoming and past visits, cancel, update name and mobile |
| `services.html`, `js/services.js` | Services, descriptions and prices by category; + starts booking with that service picked |
| `privacy.html`, `terms.html`, `js/doc.js` | Privacy policy and terms of use (text in the pages; doc.js fills in the business details). Linked at the bottom of every client page and from booking. Update them when card payments, texts or emails go live |
| `giftcard.html`, `js/giftcard.js` | A gift card to show or print (opened from the gift link) |
| `specials.html`, `js/specials.js`, `js/pricing.js` | Specials page; pricing.js works out special prices for display (the database decides the booked price) |
| `assets/buff-logo.png` | Logo, taken from a screenshot of buffbeautybar.com |
| `assets/og-image.png`, `assets/*icon*`, `favicon.ico`, `*.webmanifest` | Link-preview image, browser and home-screen icons (blush background so they read in dark mode). Share tags use absolute URLs for `kevinkolb.github.io/buff/`: update them if the site moves to its own domain |

## Status and to-do

The site runs on Supabase (`backend` in `js/config.js`; setup in `supabase/SETUP.md`). Managers edit the menu, team, hours, booking rules, business details and closed days on the front desk. Clearing the two `backend` values switches back to demo mode (sample data, saved only in the browser).

### To do: pick a name for the platform

The booking software needs its own name, separate from Buff Beauty Bar (see below).

- **Ideas so far:** Pick Me, I Got a Guy
- **More to consider:** My Person, Book My Person, The Chair, Who Do You Use?
- **Before choosing:** do a trademark search (USPTO), check the .com and short domains, and check Instagram and TikTok handles. The name should work for salons and for independent providers in the co-op.

### Planned: multiple businesses and locations

The software will serve several businesses, each with one or more locations. Buff Beauty Bar is the first business. The software itself may also be called Buff, so keep the two names apart in code and copy: the platform versus a business on it.

What it will take:

- **Data:** add `businesses` and `locations` tables. Every per-shop table gets a location (and so business) id: settings, business hours, closed days, providers, services, provider services, bookings, waitlist, time off. Clients and staff logins belong to a business, and staff roles can be per location.
- **Security:** every row-level security policy and function checks that the signed-in person belongs to that business and location, so one business can never see another's clients or bookings.
- **Booking pages:** each business gets its own address, like `book.example.com/buff` or its own domain, with its own logo, colors, share image and icons. With several locations, clients pick a location first.
- **Front desk:** a location switcher; managers of a business see all of its locations, and a platform admin view manages businesses.
- **Payments, email and texts:** each business connects its own card processor account, sender email and texting number.
- **Moving Buff over:** existing data becomes business 1, location 1, without downtime.

Worth deciding before more single-shop features get built, since every new table adds to the move.

### Planned: booking by phone with a voice assistant

One day callers will book by talking to an automated voice assistant instead of using the website: hear open times, book, cancel or join the waitlist, all against the same database.

What it will take:

- **Phone line and voice:** a phone number that answers with speech recognition and a voice (for example Twilio Voice with an AI voice agent). It hands off to a person when the caller asks or gets stuck.
- **Same rules as the website:** the assistant calls the same database functions (availability, holds, booking, cancel), so qualifications, closed days, minimum notice and double-booking protection all apply. A held time works the same way: it's held while the caller decides.
- **Who's calling:** match the caller's number to their client record; confirm identity before changing a booking.
- **Records:** bookings made by voice are marked as such (like "booked by" for staff), with call recordings or transcripts kept per Buff's policy and Louisiana consent rules.
- **Per business:** each business on the platform gets its own number, greeting and voice.

### Someday: a co-op of independent providers

Open the booking system to independent providers wherever they work: their own studio, a salon chair they rent, or the client's home. Providers pay to be listed, and clients search by service, time and place.

What it will take:

- **Where, not just when:** done for named places: providers list where they work (and which days) on the Locations tab, clients pick a place when booking, and travel time between places blocks back-to-back appointments. Still to do: house calls (a travel area instead of an address) and searching by neighborhood or distance.
- **Provider accounts:** providers sign up, set their own services, prices, hours, photos and Instagram, and manage their own calendar. Builds on the multiple businesses and locations plan above (a solo provider is a business of one).
- **Membership billing:** monthly or per-booking fees charged to providers (for example Stripe Billing), with listing paused when unpaid.
- **Payouts:** client payments go to the provider who did the work (a marketplace setup such as Stripe Connect), with any platform fee taken out.
- **Trust:** license and insurance checks where required, reviews, and rules for disputes and no-shows.

### To do: vet providers, and insurance through a partner

**Vetting:** before a provider can be booked, collect and check their license and insurance.

- **On the Team tab:** license type, number, state and expiration date, plus insurance company, policy number, coverage amounts and expiration date, with photos or PDFs of each.
- **Checking:** confirm the license with the Louisiana State Board of Cosmetology lookup (or the provider's state, for the co-op), and that the insurance covers every service they're set up for.
- **Staying current:** reminders to managers 30 days before anything expires; when a license or policy lapses, the provider is hidden from booking automatically until it's renewed.
- **Records:** who checked what and when, kept with the provider. Documents are staff-only, stored privately (Supabase Storage with access rules), never on the public site.

**Insurance partner:** team up with an insurance company so providers who don't have coverage can get it through us.

- **What to offer:** professional and general liability for beauty pros (several insurers sell this to salons and independent stylists), ideally with the business named as additional insured.
- **How it fits:** a "Get covered" link during provider sign-up, with the policy details filled in on the Team tab once bought.
- **Business side:** a referral or partner agreement with the insurer. Selling or recommending insurance for a commission can require an insurance producer license, so check with a lawyer first.
- **Later:** offer clients optional coverage, or require coverage levels for co-op providers.

### To do: revenue reports for providers

A report for each provider (and managers across the team) showing what they earned and what they lost.

- **Earned:** completed visits by day, week and month: services, totals after specials, and gift card amounts used.
- **Lost:** money from late cancellations and no-shows (the visit price), split by type, with the clients involved; plus cancellations made in time, shown separately since those slots could be rebooked.
- **Recovered:** slots refilled from the waitlist or by another booking, and late-cancel and no-show fees actually charged (once card payments are set up), so the net loss is clear.
- **Also useful:** empty bookable hours (open time nobody booked), discounts given through specials, and repeat clients versus new ones.
- **Who sees what:** providers see only their own numbers; managers see everyone, plus totals for the business.
- **Data it needs:** the booking table already records status, who cancelled and when, and the price at booking. Add the fee charged and whether a cancelled slot was rebooked. Providers' pay terms (commission, booth rent) would turn revenue into their actual take-home.
- **Where:** a Reports tab on the front desk, with a date range picker and a download to spreadsheet.

### Someday: providers rate clients

A "Rate My Professor" style rating, turned around: after a visit, the provider rates the client so the team knows who's a pleasure to book and who needs care.

What it will take:

- **Rating after the visit:** on the schedule, once an appointment is checked in (or marked no-show), the provider gives 1–5 stars plus quick tags (on time, late, no-show, great to work with, tips well, rude, haggled over price) and an optional note.
- **Where it shows:** a client's average and recent tags in the front desk client picker and appointment sheet, so reservationists see it when booking.
- **Private to staff:** clients never see ratings; database rules keep them to staff only. Clients may still have a right to ask what's stored about them, so keep notes factual and professional.
- **Fairness:** one rating per visit per provider, editable for a short time; managers can remove a rating that's unfair or abusive. No-show and late counts come from the booking records, not just opinion.
- **Using it (optional):** flag clients below a threshold so booking them asks for a deposit or card on file, once a card processor is set up.
- **With the co-op:** across businesses, share only the facts (no-shows, late cancellations), never the notes, and only if the business agrees.

### Needs an account or a decision

- **Email sender** (for example Resend): without it, clients and most staff can't get sign-in links. Once it's set up, gift cards and gift receipts should be emailed automatically (for now the confirmation page opens the buyer's own email app with the gift link filled in).
- **Card processor:** card on file, no-show fees and paying for gift cards online (Payroc, Helcim or Stripe). Until then gift cards start unpaid and the front desk calls the buyer to take payment.
- **Text messages** (for example Twilio): confirmations, reminders and waitlist alerts. Carrier registration takes 1–3 weeks.
- **Supabase Pro** before launch: the free plan pauses after a week without activity.
- **Go-live:** merge into `main`, point GitHub Pages at it, optionally an own domain, remove sample data, and run Supabase's security advisor.

### To build

- Clients tab on the front desk
- One-step reschedule
- Weekly view per provider
- Schedule updates live when someone books
- Later: manager dashboard, gift cards, QuickBooks sync, point of sale

### To confirm with Buff

- How long each service takes (current values are estimates)
- Real provider names and which services each does
- Logo: swap in the original file (ideally an SVG) for the sharpest result
