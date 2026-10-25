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

## Files

| File | What it does |
|---|---|
| `index.html` | Page shell: header, progress bar, footer |
| `css/styles.css` | Buff colors (blush `#FBE9DD`, slate `#48555E`) and layout |
| `js/config.js` | **Edit this file.** It holds hours, services, prices, durations, providers and policy |
| `js/api.js` | Data layer. It is a **mock** for now (see below) |
| `js/app.js` | The booking flow |
| `assets/buff-logo.png` | Logo, taken from a screenshot of buffbeautybar.com |

## Status and next steps

- **Mock data.** Openings are simulated, and bookings are kept only until the page reloads. Replace the three functions in `js/api.js` (`getAvailability`, `createBooking`, `joinWaitlist`) with calls to a real backend. `app.js` won't need any changes.
- **To confirm with Buff** (marked `TODO(Buff)` in `config.js`):
  - opening hours
  - how long each service takes (current values are estimates)
  - the provider list
  - the street address (the site shows both 20 and 720 Carondelet St)
- **Coming next:**
  - Stripe card on file
  - Twilio text reminders
  - provider schedules with manager approval
  - manager calendar and dashboard
  - gift cards
  - QuickBooks sync
  - later, point of sale
- **Logo:** swap in the original logo file (ideally an SVG) for the sharpest result.
