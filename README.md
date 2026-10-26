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

1. **Services.** Clients pick from the full Buff menu by category. They can book up to 3 guests at the same time.
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
| `staff.html`, `js/staff.js`, `css/staff.css` | Front desk: schedule, waitlist, time off, team and staff logins, menu, business details, hours and booking rules |
| `book.html`, `js/book.js` | Staff booking for phone and walk-in clients, with the day's schedule alongside |
| `account.html`, `js/account.js` | Client sign-in: upcoming and past visits, cancel, update name and mobile |
| `assets/buff-logo.png` | Logo, taken from a screenshot of buffbeautybar.com |
| `assets/og-image.png`, `assets/*icon*`, `favicon.ico`, `*.webmanifest` | Link-preview image, browser and home-screen icons (blush background so they read in dark mode). Share tags use absolute URLs for `kevinkolb.github.io/buff/`: update them if the site moves to its own domain |

## Status and next steps

- **Live database.** The site is connected to Supabase (`backend` in `js/config.js`). Menu, hours and providers now come from the database: edit them in Supabase's table editor, not in `config.js`. Setup steps are in `supabase/SETUP.md`. Clearing the two `backend` values switches back to demo mode (sample data, saved only in the browser).
- **To confirm with Buff** (marked `TODO(Buff)` in `config.js`):
  - opening hours
  - how long each service takes (current values are estimates)
  - the provider list
- **Coming next** (these need a backend):
  - a real database and a staff login
  - Stripe card on file, and charging late-cancel and no-show fees
  - Twilio texts: confirmations, reminders and waitlist alerts sent automatically
  - manager calendar and dashboard
  - gift cards
  - QuickBooks sync
  - later, point of sale
- **Logo:** swap in the original logo file (ideally an SVG) for the sharpest result.
