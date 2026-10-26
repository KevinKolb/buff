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
| `staff.html`, `js/staff.js`, `css/staff.css` | Front desk: schedule, waitlist, time off, team (photos, Instagram) and staff logins, menu, specials, gift cards, business details, hours and booking rules |
| `book.html`, `js/book.js` | Staff booking for phone and walk-in clients, with the day's schedule alongside |
| `account.html`, `js/account.js` | Client sign-in: upcoming and past visits, cancel, update name and mobile |
| `services.html`, `js/services.js` | Services, descriptions and prices by category; + starts booking with that service picked |
| `giftcard.html`, `js/giftcard.js` | A gift card to show or print (opened from the gift link) |
| `specials.html`, `js/specials.js`, `js/pricing.js` | Specials page; pricing.js works out special prices for display (the database decides the booked price) |
| `assets/buff-logo.png` | Logo, taken from a screenshot of buffbeautybar.com |
| `assets/og-image.png`, `assets/*icon*`, `favicon.ico`, `*.webmanifest` | Link-preview image, browser and home-screen icons (blush background so they read in dark mode). Share tags use absolute URLs for `kevinkolb.github.io/buff/`: update them if the site moves to its own domain |

## Status and to-do

The site runs on Supabase (`backend` in `js/config.js`; setup in `supabase/SETUP.md`). Managers edit the menu, team, hours, booking rules, business details and closed days on the front desk. Clearing the two `backend` values switches back to demo mode (sample data, saved only in the browser).

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

- **Where, not just when:** each provider's availability carries a place (a location on the platform, their own address, or a travel area for house calls). Clients search by neighborhood or distance as well as time, and travel time between places blocks the calendar.
- **Provider accounts:** providers sign up, set their own services, prices, hours, photos and Instagram, and manage their own calendar. Builds on the multiple businesses and locations plan above (a solo provider is a business of one).
- **Membership billing:** monthly or per-booking fees charged to providers (for example Stripe Billing), with listing paused when unpaid.
- **Payouts:** client payments go to the provider who did the work (a marketplace setup such as Stripe Connect), with any platform fee taken out.
- **Trust:** license and insurance checks where required, reviews, and rules for disputes and no-shows.

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
