// Buff Beauty Bar — booking configuration.
// Everything the shop may want to change lives in this file.
// TODO(Buff): confirm hours, service durations, and provider list.

window.BUFF_CONFIG = {
  // Live database. Leave both blank to run in demo mode (sample data, saved
  // only in this browser). The key is the *publishable* one — safe to share.
  // When these are set, hours, providers, services and booking settings come
  // from the database, and the values further down this file are ignored.
  backend: {
    supabaseUrl: 'https://iufxhcpepyeiwjcyfbtr.supabase.co',
    supabaseKey: 'sb_publishable_Fl3KS93zeOiIiRp9_rXBig_xaF5Wh0x',
  },

  business: {
    name: 'Buff Beauty Bar',
    phone: '504-522-2833',
    phoneHref: 'tel:5045222833',
    address: '720 Carondelet St, New Orleans, LA 70130',
    timezone: 'America/Chicago',
    cancellationPolicyUrl: 'https://buffbeautybar.com/cancellation-policy',
    cancellationWindowHours: 24,
  },

  // Order of the category buttons on the booking page. Categories not listed
  // here follow in menu order.
  categoryOrder: ['Jewelry', 'Tanning', 'Hair', 'Wax', 'Nails', 'Face'],

  // "Celebrating something?" choices on the booking pages (all optional).
  occasions: ['Birthday', 'Bridal / wedding', 'Bachelorette', 'Anniversary', 'Graduation', 'Prom / formal', 'Date night', 'Photoshoot'],

  booking: {
    maxGuests: 3,          // group bookings in v1: up to 3 people
    slotStepMinutes: 15,   // start times offered every 15 minutes
    daysAhead: 30,         // how far out clients can book
    minNoticeMinutes: 60,  // no same-hour bookings
  },

  // Opening hours by weekday (0 = Sunday). null = closed.
  // TODO(Buff): replace with real hours.
  hours: {
    0: { open: '10:00', close: '17:00' },
    1: { open: '09:00', close: '19:00' },
    2: { open: '09:00', close: '19:00' },
    3: { open: '09:00', close: '19:00' },
    4: { open: '09:00', close: '19:00' },
    5: { open: '09:00', close: '19:00' },
    6: { open: '09:00', close: '18:00' },
  },

  // v1: every provider performs every service at the menu price.
  providers: [
    { id: 'p1', name: 'Provider 1', initials: 'P1', blurb: 'Hair · Makeup' },
    { id: 'p2', name: 'Provider 2', initials: 'P2', blurb: 'Wax · Brows · Lashes' },
    { id: 'p3', name: 'Provider 3', initials: 'P3', blurb: 'Nails' },
    { id: 'p4', name: 'Provider 4', initials: 'P4', blurb: 'Spray tan · Jewelry' },
  ],

  // Prices from buffbeautybar.com/get-buff. Durations (mins) are estimates — TODO(Buff): confirm.
  // priceNote: shown next to price (e.g. "+" for "starting at").
  services: [
    { cat: 'Hair', name: 'Blow Out', price: 55, mins: 45 },
    { cat: 'Hair', name: 'Dry Style', price: 35, mins: 30 },
    { cat: 'Hair', name: 'Updo', price: 70, mins: 60 },
    { cat: 'Hair', name: 'Styling Add-on', price: 10, mins: 15, priceNote: '+' },
    { cat: 'Hair', name: 'Conditioning Treatment', price: 25, mins: 15 },
    { cat: 'Hair', name: 'Smoothing Treatment', price: 150, mins: 90 },

    { cat: 'Wax', name: 'Brow Wax', price: 25, mins: 15 },
    { cat: 'Wax', name: 'Brow Tweeze', price: 25, mins: 15 },
    { cat: 'Wax', name: 'Bikini', price: 45, mins: 20 },
    { cat: 'Wax', name: 'Extended Bikini', price: 55, mins: 25 },
    { cat: 'Wax', name: 'Brazilian', price: 65, mins: 30 },
    { cat: 'Wax', name: 'Half Leg Lower', price: 45, mins: 30 },
    { cat: 'Wax', name: 'Half Leg Upper', price: 55, mins: 30 },
    { cat: 'Wax', name: 'Full Leg', price: 80, mins: 45 },
    { cat: 'Wax', name: 'Chin and Jaw', price: 20, mins: 10 },
    { cat: 'Wax', name: 'Sideburns', price: 20, mins: 10 },
    { cat: 'Wax', name: 'Under Arm', price: 25, mins: 15 },
    { cat: 'Wax', name: 'Half Arm', price: 35, mins: 20 },
    { cat: 'Wax', name: 'Full Arm', price: 50, mins: 30 },
    { cat: 'Wax', name: 'Neck', price: 20, mins: 10 },
    { cat: 'Wax', name: 'Shoulders', price: 20, mins: 15 },
    { cat: 'Wax', name: 'Half Back', price: 45, mins: 25 },
    { cat: 'Wax', name: 'Full Back', price: 75, mins: 40 },

    { cat: 'Nails', name: 'Manicure', price: 30, mins: 30 },
    { cat: 'Nails', name: 'Pedicure', price: 50, mins: 45 },
    { cat: 'Nails', name: 'Dazzle Dry Manicure', price: 45, mins: 45 },
    { cat: 'Nails', name: 'Dazzle Dry Pedicure', price: 65, mins: 60 },
    { cat: 'Nails', name: 'Gel Manicure', price: 45, mins: 45 },
    { cat: 'Nails', name: 'Gel Manicure with Removal', price: 50, mins: 55 },
    { cat: 'Nails', name: 'Gel Pedicure', price: 65, mins: 60 },
    { cat: 'Nails', name: 'Gel Pedicure with Removal', price: 70, mins: 70 },
    { cat: 'Nails', name: 'Gel Removal', price: 10, mins: 15 },
    { cat: 'Nails', name: 'Dip Manicure', price: 55, mins: 60 },
    { cat: 'Nails', name: 'Dip Manicure with Removal', price: 70, mins: 75 },
    { cat: 'Nails', name: 'Dip Removal', price: 20, mins: 20 },

    { cat: 'Face', name: 'Brow Tint', price: 25, mins: 15 },
    { cat: 'Face', name: 'Lash Tint', price: 25, mins: 20 },
    { cat: 'Face', name: 'Eyes Only Makeup Application', price: 45, mins: 30 },
    { cat: 'Face', name: 'Full Face Makeup Application', price: 85, mins: 60 },
    { cat: 'Face', name: 'Strip Lashes', price: 20, mins: 10 },
    { cat: 'Face', name: 'Individual Lashes', price: 40, mins: 20 },

    { cat: 'Tanning', name: 'Spray Tan', price: 55, mins: 20 },
    { cat: 'Tanning', name: 'Basecoat', price: 10, mins: 5 },
    { cat: 'Tanning', name: 'Topcoat', price: 10, mins: 5 },

    { cat: 'Jewelry', name: 'Permanent Bracelet', price: 75, mins: 30 },
    { cat: 'Jewelry', name: 'Permanent Anklet', price: 90, mins: 30 },
    { cat: 'Jewelry', name: 'Permanent Necklace', price: 165, mins: 45 },
  ],
};
