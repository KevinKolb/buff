// Possible legal issues for the front desk's Legal tab (managers).
// A starting list to go over with a lawyer and an accountant, not legal advice.
// when: 'launch' = sort out before going live; 'later' = before that feature or as the business grows.

window.BuffLegal = [
  { cat: 'Licenses and permits', items: [
    { when: 'launch', title: 'Salon and staff licenses', why: 'Hair, nails, waxing, lashes and makeup are licensed work in Louisiana (State Board of Cosmetology). The shop and each provider need current licenses, usually on display.', todo: 'Keep copies and renewal dates for every provider. Only list services on the Team tab that each person is licensed for.' },
    { when: 'launch', title: 'City business license and registrations', why: 'New Orleans requires a business (occupational) license, and the business needs its state and parish tax registrations.', todo: 'Confirm with the city and the Louisiana Department of Revenue.' },
    { when: 'later', title: 'Newer services (permanent jewelry, spray tan)', why: 'Rules for newer services can be unclear or change.', todo: 'Check with the board before adding a new kind of service to the menu.' },
  ] },
  { cat: 'Health, safety and client consent', items: [
    { when: 'launch', title: 'Intake and consent forms', why: 'Waxing, tinting, lashes and spray tans carry risks (skin reactions, allergies; some medications like retinoids make waxing unsafe).', todo: 'Have clients complete an intake and consent form; consider patch tests for tints and lash glue. The booking page could ask these questions later.' },
    { when: 'launch', title: 'Minors', why: 'Services for under-18s, especially intimate waxing, need a parent or guardian’s consent.', todo: 'Set a written policy; the booking page could ask for age or a guardian later.' },
    { when: 'launch', title: 'Sanitation and chemicals', why: 'Board sanitation rules and workplace safety rules (chemical labels, safety data sheets, gloves, eye protection for jewelry welding, ventilation for spray tans).', todo: 'Keep a written sanitation routine and safety data sheets on hand.' },
    { when: 'later', title: 'Health details are sensitive', why: 'If the site starts storing allergies or medications, that information needs extra care.', todo: 'Collect only what’s needed and limit who can see it.' },
  ] },
  { cat: 'Booking, cancellations and no-show fees', items: [
    { when: 'launch', title: 'Clear cancellation policy', why: 'A no-show or late-cancellation fee is easier to enforce, and to defend in a chargeback, when the client agreed to it before booking.', todo: 'The site requires agreeing to the policy. Make sure the linked policy page states the fee amounts and the time window.' },
    { when: 'later', title: 'Charging a card on file', why: 'Card networks require written permission to charge a saved card later, and clients can dispute charges.', todo: 'When the card processor is set up, use its saved-card consent wording and keep the record of agreement with each booking.' },
    { when: 'later', title: 'Refunds and unhappy clients', why: 'Disputes over results are common in beauty services.', todo: 'Write a redo and refund policy and post it.' },
  ] },
  { cat: 'Payments and card security', items: [
    { when: 'launch', title: 'Never store card numbers', why: 'Card data rules (PCI DSS) apply to anyone taking cards. Storing card numbers ourselves would bring heavy requirements and risk.', todo: 'Card entry must go straight to the processor (as planned). The site never sees or saves card numbers.' },
    { when: 'later', title: 'Tips and fees', why: 'How card tips are paid to providers, and any card surcharge, are regulated.', todo: 'Ask the processor and an accountant before adding tips or surcharges online.' },
  ] },
  { cat: 'Gift cards', items: [
    { when: 'launch', title: 'Expiration dates and fees', why: 'Federal law and Louisiana law limit gift card expiration dates and fees; generally they can’t expire within 5 years, and inactivity fees are restricted.', todo: 'Don’t put an expiration date on gift cards without checking with a lawyer. They currently have none.' },
    { when: 'launch', title: 'Selling before being paid', why: 'Gift cards currently start unpaid; a printed card could be used before it’s paid for.', todo: 'Staff check the Gift cards tab before honoring a card. Online payment fixes this.' },
    { when: 'later', title: 'Unused balances and bookkeeping', why: 'Unspent gift card money is a liability on the books, and some states require reporting old balances as unclaimed property.', todo: 'Ask an accountant how to record gift card sales and whether unused balances must be reported.' },
    { when: 'later', title: 'Lost or stolen codes', why: 'Anyone with the code can use a card.', todo: 'Write a policy for lost cards (for example, reissue only to the buyer after checking ID).' },
  ] },
  { cat: 'Prices, specials and advertising', items: [
    { when: 'launch', title: 'Honor posted prices', why: 'Prices and specials on the site are advertising; charging more than shown invites complaints.', todo: 'Keep the menu and specials current; turn off a special on the Specials tab when it ends.' },
    { when: 'launch', title: 'Real “regular” prices', why: 'Showing a crossed-out regular price is only fair if that’s the normal price.', todo: 'Don’t raise menu prices just to make a special look bigger.' },
    { when: 'later', title: 'Reviews and testimonials', why: 'Rules prohibit fake reviews and paying for reviews without disclosure.', todo: 'Only post real reviews, with permission.' },
  ] },
  { cat: 'Client privacy and data', items: [
    { when: 'launch', title: 'Privacy policy', why: 'The site collects names, phone numbers, emails, notes and visit history. Clients should be told what’s collected and why.', todo: 'Post a privacy policy and link it from the booking page.' },
    { when: 'launch', title: 'Who can see client data', why: 'Staff logins can see client details.', todo: 'Give each person the smallest role they need, remove logins when staff leave, and turn on Supabase’s security advisor before launch.' },
    { when: 'launch', title: 'Data breaches', why: 'Louisiana law requires notifying people if their personal information is exposed.', todo: 'Know who to call (lawyer, insurer) and keep backups. Consider cyber insurance.' },
    { when: 'later', title: 'Staff notes and client ratings', why: 'Notes about clients could be seen by the client if they ask for their records, or come up in a dispute.', todo: 'Keep notes factual and professional. Applies to the planned provider-rates-client feature too.' },
    { when: 'later', title: 'Deleting a client’s data', why: 'Clients may ask to be removed.', todo: 'Decide what to keep (for tax and dispute records) and what to delete.' },
  ] },
  { cat: 'Texts, emails and calls', items: [
    { when: 'later', title: 'Permission to text', why: 'Federal rules (TCPA) require consent for automated texts; marketing texts need stronger written consent. Carriers also require registration.', todo: 'Keep reminders separate from promotions, add a consent checkbox for marketing, and honor STOP replies.' },
    { when: 'later', title: 'Marketing emails', why: 'Marketing email needs a working unsubscribe link and the business address (CAN-SPAM).', todo: 'Use the email sender’s unsubscribe features for any newsletters.' },
    { when: 'later', title: 'Voice assistant and call recording', why: 'Louisiana allows recording with one party’s consent, but callers from other states may need everyone’s consent; an AI voice should say it isn’t a person.', todo: 'Announce recording and the automated assistant at the start of each call.' },
  ] },
  { cat: 'Website and accessibility', items: [
    { when: 'launch', title: 'Accessible booking', why: 'Businesses open to the public can face ADA claims if clients with disabilities can’t book online.', todo: 'The site is built for screen readers and large text; keep testing new features that way.' },
    { when: 'launch', title: 'Terms of use', why: 'Sets the rules for using the site and booking.', todo: 'Post terms alongside the privacy policy.' },
    { when: 'launch', title: 'Logo and photos', why: 'Images need permission from whoever owns them. The logo was copied from a screenshot of the current website.', todo: 'Get the original logo file from its designer. Get written permission before posting photos of clients or staff.' },
  ] },
  { cat: 'Staff and providers', items: [
    { when: 'launch', title: 'Employees or contractors', why: 'Calling someone a contractor (or booth renter) when they work like an employee can bring back taxes and penalties.', todo: 'Review each provider’s arrangement with an accountant or lawyer.' },
    { when: 'launch', title: 'Wages, tips and paperwork', why: 'Wage, overtime and tip rules apply to employees, plus hiring paperwork (I-9) and workers’ compensation insurance.', todo: 'Use a payroll service if there are employees.' },
    { when: 'later', title: 'Provider photos and Instagram links', why: 'Using a provider’s photo or social account on the site needs their OK, and should come down when they leave.', todo: 'Get written permission; remove photos when someone leaves.' },
  ] },
  { cat: 'Insurance', items: [
    { when: 'launch', title: 'Liability coverage', why: 'Burns, cuts, allergic reactions and slip-and-falls happen.', todo: 'Carry general liability and professional liability coverage; check that it covers every service on the menu, including permanent jewelry and spray tans.' },
    { when: 'later', title: 'Cyber insurance', why: 'Covers costs if client data is exposed or the booking system is attacked.', todo: 'Get a quote once the site holds real client data.' },
  ] },
  { cat: 'Taxes and records', items: [
    { when: 'launch', title: 'Sales tax', why: 'Retail products are taxed; whether services are taxed depends on state and parish rules.', todo: 'Confirm what’s taxable in Orleans Parish with an accountant.' },
    { when: 'launch', title: 'Keeping records', why: 'Bookings, payments, gift cards and cancellations may be needed for taxes and disputes.', todo: 'Don’t delete old bookings; hide or cancel instead (the site already works this way).' },
  ] },
  { cat: 'Platform, multiple businesses and the co-op', items: [
    { when: 'later', title: 'Contracts with businesses and providers', why: 'Once other businesses or independent providers use the software, terms are needed: fees, who owns client data, who is responsible for the work.', todo: 'Have a lawyer draft platform terms before the first outside business joins.' },
    { when: 'later', title: 'Handling other people’s money', why: 'Collecting payments for providers and paying them out can count as money transmission.', todo: 'Use a marketplace payments service (like Stripe Connect) instead of holding the money.' },
    { when: 'later', title: 'Checking providers', why: 'Listing a provider who isn’t licensed or insured could create liability.', todo: 'Verify licenses and insurance when providers sign up, and re-check yearly.' },
    { when: 'later', title: 'Name and trademark', why: 'Using “Buff” for both the software and the salon, and possibly in other cities, could clash with others’ trademarks.', todo: 'Do a trademark search before branding the platform.' },
  ] },
];
