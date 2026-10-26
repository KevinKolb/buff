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
    { id: 'p1', name: 'Provider 1', initials: 'P1', photo: 'assets/demo/provider-1.svg', blurb: 'Hair · Makeup' },
    { id: 'p2', name: 'Provider 2', initials: 'P2', photo: 'assets/demo/provider-2.svg', blurb: 'Wax · Brows · Lashes' },
    { id: 'p3', name: 'Provider 3', initials: 'P3', photo: 'assets/demo/provider-3.svg', blurb: 'Nails' },
    { id: 'p4', name: 'Provider 4', initials: 'P4', photo: 'assets/demo/provider-4.svg', blurb: 'Spray tan · Jewelry' },
  ],

  // Prices from buffbeautybar.com/get-buff. Durations (mins) are estimates — TODO(Buff): confirm.
  // priceNote: shown next to price (e.g. "+" for "starting at").
  services: [
    { cat: 'Hair', name: 'Blow Out', price: 55, mins: 45, description: 'Wash, condition and a smooth, bouncy blowout styled your way: sleek and straight, soft waves or volume.' },
    { cat: 'Hair', name: 'Dry Style', price: 35, mins: 30, description: 'No wash. We style your clean, dry hair with a flat iron or curling iron for an easy refresh.' },
    { cat: 'Hair', name: 'Updo', price: 70, mins: 60, description: 'An elegant updo or half-up style for weddings, galas and Mardi Gras balls. Come with clean, dry hair, and bring a photo of the look you love.' },
    { cat: 'Hair', name: 'Styling Add-on', price: 10, mins: 15, priceNote: '+', description: 'Add curls, waves or a braid to a blowout. Price depends on the style.' },
    { cat: 'Hair', name: 'Conditioning Treatment', price: 25, mins: 15, description: 'A deep conditioning mask added to your wash to soften, smooth and add shine. Pairs well with a blowout.' },
    { cat: 'Hair', name: 'Smoothing Treatment', price: 150, mins: 90, description: 'A smoothing treatment that cuts frizz and blow-dry time for weeks. Includes a blowout. Ask us about aftercare and when you can wash.' },

    { cat: 'Wax', name: 'Brow Wax', price: 25, mins: 15, description: 'Shaping with wax and a tweezer cleanup for clean, defined brows that suit your face.' },
    { cat: 'Wax', name: 'Brow Tweeze', price: 25, mins: 15, description: 'Shaping by tweezing only, for sensitive skin or anyone avoiding wax.' },
    { cat: 'Wax', name: 'Bikini', price: 45, mins: 20, description: 'Removes hair outside the swimsuit line.' },
    { cat: 'Wax', name: 'Extended Bikini', price: 55, mins: 25, description: 'Goes further than a bikini wax, removing more hair from the front and sides.' },
    { cat: 'Wax', name: 'Brazilian', price: 65, mins: 30, description: 'Removes all hair from the front to the back, with the option to leave a small strip or shape in front.' },
    { cat: 'Wax', name: 'Half Leg Lower', price: 45, mins: 30, description: 'Smooth legs from the knee down to the ankle.' },
    { cat: 'Wax', name: 'Half Leg Upper', price: 55, mins: 30, description: 'Knee to the top of the thigh.' },
    { cat: 'Wax', name: 'Full Leg', price: 80, mins: 45, description: 'From the top of the thigh to the ankle.' },
    { cat: 'Wax', name: 'Chin and Jaw', price: 20, mins: 10, description: 'Removes hair along the chin and jawline.' },
    { cat: 'Wax', name: 'Sideburns', price: 20, mins: 10, description: 'Clears hair along the sides of the face in front of the ears.' },
    { cat: 'Wax', name: 'Under Arm', price: 25, mins: 15, description: 'Smooth underarms for weeks, without daily shaving.' },
    { cat: 'Wax', name: 'Half Arm', price: 35, mins: 20, description: 'Wrist to elbow.' },
    { cat: 'Wax', name: 'Full Arm', price: 50, mins: 30, description: 'Wrist to shoulder.' },
    { cat: 'Wax', name: 'Neck', price: 20, mins: 10, description: 'Cleans up the hairline at the back of the neck.' },
    { cat: 'Wax', name: 'Shoulders', price: 20, mins: 15, description: 'Removes hair across the tops of the shoulders.' },
    { cat: 'Wax', name: 'Half Back', price: 45, mins: 25, description: 'Upper or lower back.' },
    { cat: 'Wax', name: 'Full Back', price: 75, mins: 40, description: 'The whole back, from the shoulders to the waist.' },

    { cat: 'Nails', name: 'Manicure', price: 30, mins: 30, description: 'Nail shaping, cuticle care, a hand massage and regular polish.' },
    { cat: 'Nails', name: 'Pedicure', price: 50, mins: 45, description: 'A foot soak, nail shaping, cuticle care, callus smoothing, a foot and leg massage, and regular polish.' },
    { cat: 'Nails', name: 'Dazzle Dry Manicure', price: 45, mins: 45, description: 'A manicure with Dazzle Dry, a polish system that dries in about five minutes. No UV light needed.' },
    { cat: 'Nails', name: 'Dazzle Dry Pedicure', price: 65, mins: 60, description: 'Our pedicure finished with fast-drying Dazzle Dry polish, so you can slip on shoes and go.' },
    { cat: 'Nails', name: 'Gel Manicure', price: 45, mins: 45, description: 'A manicure with gel polish cured under a light, for a glossy finish that usually lasts two weeks or more without chipping.' },
    { cat: 'Nails', name: 'Gel Manicure with Removal', price: 50, mins: 55, description: 'We take off your old gel polish, then give you a fresh gel manicure.' },
    { cat: 'Nails', name: 'Gel Pedicure', price: 65, mins: 60, description: 'Our pedicure finished with long-lasting gel polish.' },
    { cat: 'Nails', name: 'Gel Pedicure with Removal', price: 70, mins: 70, description: 'We take off your old gel polish, then give you a fresh gel pedicure.' },
    { cat: 'Nails', name: 'Gel Removal', price: 10, mins: 15, description: 'Gentle removal of gel polish, with nails shaped and buffed afterward.' },
    { cat: 'Nails', name: 'Dip Manicure', price: 55, mins: 60, description: 'Dip powder adds strength and long-lasting color. Great if your nails tend to break.' },
    { cat: 'Nails', name: 'Dip Manicure with Removal', price: 70, mins: 75, description: 'We take off your old dip powder, then give you a fresh dip manicure.' },
    { cat: 'Nails', name: 'Dip Removal', price: 20, mins: 20, description: 'Gentle removal of dip powder, with nails shaped and buffed afterward.' },

    { cat: 'Face', name: 'Brow Tint', price: 25, mins: 15, description: 'Semi-permanent color that fills in and defines brows. Usually lasts a few weeks.' },
    { cat: 'Face', name: 'Lash Tint', price: 25, mins: 20, description: 'Darkens your natural lashes so they look fuller without mascara. Usually lasts several weeks.' },
    { cat: 'Face', name: 'Eyes Only Makeup Application', price: 45, mins: 30, description: 'Eyeshadow, liner and mascara for a polished eye look. Add lashes for extra drama.' },
    { cat: 'Face', name: 'Full Face Makeup Application', price: 85, mins: 60, description: 'Complete makeup from skin prep and foundation to eyes, brows and lips, for events, photos or a night out.' },
    { cat: 'Face', name: 'Strip Lashes', price: 20, mins: 10, description: 'A full strip of false lashes applied for the day or night. Add to any makeup service.' },
    { cat: 'Face', name: 'Individual Lashes', price: 40, mins: 20, description: 'Individual false lashes placed for a natural, fuller look that lasts for your event.' },

    { cat: 'Tanning', name: 'Spray Tan', price: 55, mins: 20, description: 'A custom, streak-free airbrush tan in minutes. Exfoliate and shave the day before, and wear loose, dark clothes to your visit.' },
    { cat: 'Tanning', name: 'Basecoat', price: 10, mins: 5, description: 'Applied before your spray tan to help it go on and fade evenly.' },
    { cat: 'Tanning', name: 'Topcoat', price: 10, mins: 5, description: 'Applied after your spray tan to help lock in the color.' },

    { cat: 'Jewelry', name: 'Permanent Bracelet', price: 75, mins: 30, description: 'A dainty chain sized to your wrist and welded closed, with no clasp to break or lose. Pick your chain at your visit.' },
    { cat: 'Jewelry', name: 'Permanent Anklet', price: 90, mins: 30, description: 'A chain fitted to your ankle and welded closed, made to wear every day.' },
    { cat: 'Jewelry', name: 'Permanent Necklace', price: 165, mins: 45, description: 'A delicate chain fitted to your neck and welded closed, a lasting piece to wear every day.' },
  ],
};
