// Every word the app shows, in English and Arabic, and the number and date
// formats of each. The Arabic text is written for the Levant: Levantine month
// names, Western digits for data (as on the public site), right-to-left layout.
import { usePrefs, type Lang } from './prefs.ts';
import type { Level, OrgKind, Role, Status, Why } from './api.ts';

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
/** Arabic counted nouns: 1, 2, 3–10, 11+. */
const ar = (n: number, one: string, two: string, few: string, many: string) =>
  n === 1 ? one : n === 2 ? two : n >= 3 && n <= 10 ? `${n} ${few}` : `${n} ${many}`;

const en = {
  brand: 'Firesight',
  product: 'for Organizations',
  nav: { overview: 'Overview', sites: 'Sites', tools: 'Tools', alerts: 'Alerts', team: 'Team', settings: 'Settings', menu: 'Menu', close: 'Close menu' },
  tools: { briefing: 'Shift briefing', exposure: 'Exposure', planner: 'Work planner', impact: 'Project impact' },
  status: { act: 'Act now', watch: 'Watch', ok: 'OK' } as Record<Status, string>,
  level: { very_low: 'Very low', low: 'Low', moderate: 'Moderate', high: 'High', very_high: 'Very high', extreme: 'Extreme' } as Record<Level, string>,
  levelShort: { very_low: 'VL', low: 'L', moderate: 'M', high: 'H', very_high: 'VH', extreme: 'E' } as Record<Level, string>,
  advice: { go: 'Go', caution: 'Caution', stop: 'Stop' },
  kind: { fire_station: 'Fire station or civil defence', insurer: 'Insurer', company: 'Company', ngo: 'NGO or municipality' } as Record<OrgKind, string>,
  kindHint: {
    fire_station: 'Shift briefings for your coverage area, and alerts to the public once verified.',
    insurer: 'Exposure of an insured portfolio, and satellite evidence for claims.',
    company: 'Farms, factories, resorts, utilities: which days are safe to work, and alerts to staff.',
    ngo: 'Fire in your project areas year by year, and when the critical period starts.',
  } as Record<OrgKind, string>,
  role: { owner: 'Owner', member: 'Member' } as Record<Role, string>,
  compass: { north: 'north', 'north-east': 'north-east', east: 'east', 'south-east': 'south-east', south: 'south', 'south-west': 'south-west', west: 'west', 'north-west': 'north-west' } as Record<string, string>,
  common: {
    save: 'Save', saving: 'Saving…', cancel: 'Cancel', back: 'Back', retry: 'Try again', copy: 'Copy', copied: 'Copied', print: 'Print', csv: 'Download CSV',
    signIn: 'Sign in', signOut: 'Sign out', loading: 'Loading…', email: 'Email', password: 'Password', name: 'Name', yourName: 'Your name',
    refresh: 'Refresh', refreshing: 'Refreshing…', remove: 'Remove', show: 'Show', none: '–', theme: 'Theme', dark: 'Dark', light: 'Light',
    language: 'Language', verified: 'Verified', updated: (t: string) => `Updated ${t}`, km: (n: string) => `${n} km`,
    synthetic: 'Illustration with sample data',
  },
  ago: (min: number) => (min < 1 ? 'just now' : min < 90 ? `${min} min ago` : min < 48 * 60 ? `${Math.round(min / 60)} h ago` : `${Math.round(min / 1440)} days ago`),
  why: (w: Why, f: Fmt): string => {
    switch (w.code) {
      case 'fire_inside': return `${w.count} satellite fire detection${w.count === 1 ? '' : 's'} inside the site, the latest ${f.ago(w.at)}`;
      case 'fire_near': return `Satellite fire ${f.one(w.km)} km ${en.compass[w.compass] ?? w.compass} of the site, seen ${f.ago(w.at)}`;
      case 'reports': return `${w.count} ground report${w.count === 1 ? '' : 's'} of fire or smoke inside the site in the last 48 hours`;
      case 'danger_today': return `${en.level[w.level]} fire danger today`;
      case 'danger_peak': return `${en.level[w.level]} fire danger on ${f.weekday(w.date)}`;
      case 'quiet': return w.forecast ? 'No fire nearby and low fire danger this week' : 'No fire nearby';
    }
  },
  workWhy: (cause: 'danger' | 'wind' | 'humidity', value: number | Level) =>
    cause === 'danger' ? `${en.level[value as Level].toLowerCase()} danger` : cause === 'wind' ? `wind ${value} km/h` : `dry air, ${value}%`,
  errors: {
    offline: 'The Firesight server did not answer. Check your connection and try again.',
    wrong_credentials: 'Wrong email or password.',
    email_taken: 'This email already has an account. Sign in with it to accept the invitation.',
    weak_password: 'The password must be at least 8 characters.',
    bad_email: 'Enter a valid email address.',
    rate_limited: 'Too many attempts. Try again in a few minutes.',
    invite_used: 'This invitation was already used. Sign in instead.',
    invite_expired: 'This invitation has expired. Ask whoever invited you for a new one.',
    invite_not_found: 'This invitation does not exist or was withdrawn. Ask for a new one.',
    outside_coverage: 'A site is outside the four countries Firesight covers.',
    not_verified: 'Only verified organizations can alert the public.',
    last_owner: 'An organization keeps at least one owner.',
    generic: 'Something went wrong. Try again.',
  } as Record<string, string>,
  landing: {
    signIn: 'Sign in',
    request: 'Request access',
    title: 'Which of your sites need attention today, and why?',
    lede: 'Firesight puts every place you answer for on one map and ranks them each morning from three sources: fires NASA satellites see now, the fire danger forecast for the week, and 25 years of harmonized fire history.',
    note: 'Invitation only. Portugal, Greece, Lebanon and Cyprus.',
    sampleTitle: 'A morning at a sample fire station',
    sectorsTitle: 'One map, four ways to work',
    howTitle: 'How it works',
    how: [
      ['Put your sites on the map', 'A site is a circle around a place you answer for: a station\'s area, an insured property, a farm, a project. Add them on the map or import a CSV.'],
      ['Read the ranked board', 'Every site gets a score from 0 to 100 and the plain reasons behind it: fire inside or nearby, fire danger today and this week.'],
      ['Act, and keep the team informed', 'Alert your members, or the public when you are verified. A notification and a morning digest arrive when a site needs action.'],
    ],
    sourcesTitle: 'Built on open data, said plainly',
    sources: [
      ['25 years, one record', 'MODIS (since 2000) and VIIRS (since 2012) detections harmonized into one record, so a site\'s history is measured the same way before and after 2012.'],
      ['Live satellite fires', 'NASA FIRMS near-real-time detections of the last 48 hours, refreshed every 10 minutes.'],
      ['Fire danger, 16 days', 'The Canadian Fire Weather Index on Open-Meteo weather, in the classes EFFIS uses for Europe.'],
    ],
    honest: 'The score is a plain rule table, not a model calibrated on past losses. Fire danger says how easily fires start and spread, not where one will start. Firesight supports decisions; it does not replace official warnings.',
    closeTitle: 'Bring your sites',
    closeLede: 'Tell us who you are and how many places you watch. We set up your organization and send its owner a private link.',
    credits: 'Fire detections: NASA FIRMS (MODIS, VIIRS). Fire danger: Canadian FWI on Open-Meteo weather. Imagery: NASA GIBS. Borders: Natural Earth. An independent project, not a NASA product.',
    publicSite: 'Public fire record',
  },
  request: {
    title: 'Request access',
    lede: 'Firesight for Organizations is by invitation. Tell us about your organization; we reply by email or phone, then send its owner a private link to set up the account.',
    orgName: 'Organization', kind: 'Kind of organization', country: 'Country', countryPick: 'Choose a country', countries: ['Portugal', 'Greece', 'Lebanon', 'Cyprus', 'Several of these', 'Elsewhere'],
    contactName: 'Your name', email: 'Work email', phone: 'Phone (optional)', sites: 'Number of sites (optional)', sitesHint: 'Stations, properties, farms or project areas you watch.',
    message: 'Anything we should know (optional)', submit: 'Send request', sending: 'Sending…',
    doneTitle: 'Request received',
    done: (email: string) => `Thank you. We will reply to ${email}. When your organization is set up, its owner gets a private link to sign in.`,
    already: 'We already have a request from this email; there is no need to send it again.',
    privacy: 'We use these details only to reply to you and set up your organization.',
  },
  login: {
    title: 'Sign in',
    lede: 'Use the email and password from your invitation.',
    submit: 'Sign in', busy: 'Signing in…',
    noAccount: 'No access yet?', request: 'Request access for your organization',
    lost: 'Lost your password or your access? Ask an owner of your organization for a new invitation.',
  },
  invite: {
    checking: 'Opening your invitation…',
    title: (org: string) => `Join ${org}`,
    as: (role: string, email: string) => `You are invited as ${role.toLowerCase()} with ${email}.`,
    createTitle: 'Set your password',
    create: 'Create account and join', creating: 'Joining…',
    haveAccount: 'Already have a Firesight account with this email?', signInInstead: 'Sign in to accept',
    signedInAs: (email: string) => `Signed in as ${email}.`,
    accept: (org: string) => `Join ${org}`, accepting: 'Joining…',
    otherAccount: 'Use another account',
    expires: (d: string) => `This link works once, until ${d}.`,
    ownerNote: 'As an owner you add the sites, invite your team and send alerts.',
    memberNote: 'As a member you see the board, every tool and the alerts.',
  },
  shell: {
    switchOrg: 'Organization', notifications: 'Notifications', markRead: 'Mark all as read', noNotifications: 'Nothing yet. A notification appears here when a site needs action, and each morning at 6.',
    unread: (n: number) => `${n} unread`, account: 'Account', noOrg: 'You are not a member of any organization yet.',
    noOrgHint: 'Ask an owner of your organization for an invitation, or request access for a new one.',
    newNotification: 'New notification', openSite: 'Open site',
  },
  overview: {
    act: (n: number) => `${n} site${plural(n, '', 's')} need${plural(n, 's', '')} action now`,
    watch: (n: number) => `${n} site${plural(n, '', 's')} to watch`,
    allOk: (n: number) => (n === 1 ? 'Your site is OK' : `All ${n} sites are OK`),
    counts: { act: 'Act now', watch: 'Watch', ok: 'OK' },
    atRisk: 'At risk this week', atRiskHint: 'Fire close by, or high fire danger or above.',
    value: 'value', people: 'people',
    board: 'Ranked sites', grid: 'Grid', boardHint: 'Hover a row to find its square on the map.',
    digest: 'This morning', noDigest: 'The first morning digest arrives at 6:00.',
    unavailable: { live: 'Live satellite fires are not available right now.', forecast: 'The fire danger forecast is not available right now.', both: 'Scores are shown without them.' },
    emptyTitle: 'Add your first site',
    emptyOwner: 'A site is a circle around a place you answer for. Firesight then ranks your sites every morning.',
    emptyMember: (org: string) => `An owner of ${org} adds the sites. They appear here when they do.`,
    addOnMap: 'Add sites', reading: 'Reading your sites…',
    note: 'The score is a plain rule table: fires seen now outrank weather.',
    days: '7 days',
    mapLabel: 'Map of your sites, with a lettered grid and live satellite fires',
    fires: (n: number) => `${n} live satellite fire${plural(n, '', 's')} near your sites`,
  },
  sites: {
    title: 'Sites', count: (n: number, max: number) => `${n} of ${max}`,
    search: 'Search sites', all: 'All', filterStatus: 'Status',
    add: 'Add on the map', addHint: 'Click the map where the site is.', addCancel: 'Done adding', outside: (countries: string) => `That place is outside ${countries}. Click inside one of them.`,
    import: 'Import CSV', template: 'Download a template', save: 'Save changes', unsaved: 'Unsaved changes',
    saved: (n: number) => `Saved ${n} site${plural(n, '', 's')}. The board is ranking them now.`,
    imported: (added: number, rows: number, skipped: number, full: boolean, max: number) =>
      [`Added ${added} of ${rows} rows.`, skipped > 0 && `${skipped} had no latitude or longitude.`, full && `An organization holds at most ${max} sites.`, 'Check them, then save.'].filter(Boolean).join(' '),
    importNone: 'No rows with a latitude and a longitude were found. The columns are name, lat, lon, radius_km, value, people, started_year.',
    csvHelp: 'CSV columns: name, lat, lon, radius_km, value, people, started_year. Sites must be in Portugal, Greece, Lebanon or Cyprus.',
    memberNote: 'Only an owner changes the sites.',
    cols: { name: 'Name', grid: 'Grid', status: 'Now', lat: 'Latitude', lon: 'Longitude', radius: 'Radius (km)', value: 'Value', people: 'People', started: 'Project started' },
    newName: (n: number) => `Site ${n}`,
    none: 'No sites match.',
    discard: 'Discard',
  },
  site: {
    back: 'All sites', notFound: 'This site is not in the organization any more.',
    score: 'Score', why: 'Why', firesNow: 'Fires inside now', last48: 'last 48 hours', perYear: 'Fire per year', yearsWith: (a: number, b: number) => `${a} of ${b} years`,
    worst: 'Worst year', cellDays: (n: string) => `${n} cell-days`,
    week: 'Fire danger this week', today: (lvl: string, t: number, w: number, h: number) => `Today: ${lvl.toLowerCase()} danger, ${t}°C, wind ${w} km/h, humidity ${h}%.`,
    hotWork: 'Outdoor hot work today:',
    history: '25 years in this place', historyAxis: 'Active-fire cell-days per year', peak: (n: string) => `peak ${n}`,
    critical: (name: string, share: number) => `Critical period: ${name}, ${share}% of a usual year's fire.`,
    underWay: 'It is under way now.', startsIn: (n: number) => `It starts in ${n} days.`,
    nearby: 'Satellite fires nearby', inside: 'Inside the site', ofCentre: (km: string, dir: string) => `${km} km ${dir} of the centre`,
    ground: 'Reports from people here', pointed: (deg: number) => `pointed ${deg}°`,
    photoAlt: (label: string) => `Photo sent with this ${label.toLowerCase()} report`,
    alert: 'Send an alert about this site',
    label: { wildfire: 'Wildfire', smoke: 'Smoke', agriculturalBurn: 'Agricultural burn', industrial: 'Industrial', falseAlarm: 'False alarm', unsure: 'Unsure' } as Record<string, string>,
    reading: 'Reading the site\'s record…',
    coords: 'Centre', radius: 'Radius',
  },
  claim: {
    title: 'Claim check', lede: 'Did a satellite see fire at this site around a date? Searches every MODIS and VIIRS detection in the record.',
    date: 'Date', days: 'Days either side', km: 'Km beyond the site', check: 'Check', checking: 'Searching…',
    found: 'Fire detected', notFound: 'No detection',
    summaryFound: (days: number, n: number, inside: number, where: string, from: string, to: string) =>
      `Satellites detected fire ${where} on ${days} day${plural(days, '', 's')} between ${from} and ${to}: ${n} detection${plural(n, '', 's')}, ${inside} inside the site.`,
    summaryNone: (where: string, from: string, to: string) => `No satellite detection ${where} between ${from} and ${to}.`,
    outside: (first: string, last: string) => `The record runs from ${first} to ${last}; this window is outside it.`,
    whereInside: 'inside the site', whereWithin: (km: number) => `within ${km} km of the site`,
    caveat: 'A detection is evidence of fire at that place and time. No detection is not proof of no fire: cloud and smoke hide fires, satellites pass only a few times a day, and small or short fires are missed. Each detection marks a pixel of about 375 m (VIIRS) or 1 km (MODIS).',
    cols: { date: 'Date', time: 'Time (UTC)', dist: 'From centre', where: 'Where', sensor: 'Sensor', conf: 'Confidence', frp: 'Power (MW)' },
    outsideSite: 'Outside', csv: 'Download evidence CSV', closest: (n: number) => `Showing the ${n} closest. The CSV has up to 500.`,
    ground: (n: number) => `${n} ground report${plural(n, '', 's')} from people in this window.`,
    confidence: { low: 'low', nominal: 'nominal', high: 'high' } as Record<string, string>,
  },
  briefing: {
    title: 'Shift briefing',
    lede: (act: number, total: number, names: string) => act > 0 ? `${act} of ${total} area${plural(total, '', 's')} need${plural(act, 's', '')} action now: ${names}.` : `No area needs action right now.`,
    burning: (names: string) => `Satellites see fire inside ${names}.`,
    cols: { area: 'Area', now: 'Now', week: 'Next 7 days', high: 'Days high or above', fires: 'Satellite fires', reports: 'Ground reports' },
    unavailable: 'Unavailable', noneNear: 'None within 25 km', inside: (n: number, ago: string) => `${n} inside, latest ${ago}`,
    near: (km: string, dir: string, ago: string) => `${km} km ${dir}, ${ago}`, noForecast: 'No forecast', alert: 'Alert',
    note: 'Fire danger is the Canadian Fire Weather Index in EFFIS classes. It says how easily a fire starts and spreads in this weather, not where one will start.',
    notVerified: 'Alerts reach your members only. Ask Firesight to verify your station to alert the public in your areas.',
    reported: (names: string) => `People reported fire or smoke in ${names} in the last 48 hours.`,
  },
  exposure: {
    title: 'Portfolio exposure',
    tiles: { total: 'Total value', atRisk: 'Value at risk this week', sites: 'Sites at risk this week' },
    share: (p: number) => `${p}% of the portfolio`, addValues: 'Add values to your sites', of: (n: number) => `of ${n}`, sitesN: (n: number) => `${n} site${plural(n, '', 's')}`,
    riskHint: 'Fire close by, or high danger or above',
    cols: { site: 'Site', value: 'Value', perYear: 'Fire per year', worst: 'Worst year', years: 'Years with fire', critical: 'Critical period', peak: 'Peak danger this week', now: 'Now' },
    reading: 'Reading 25 years of fire record for each site…',
    note: '"Fire per year" is the average of active-fire cell-days per year in the box around the site, from the harmonized record since 2000. It counts detections, not burned area or damage: use it to rank sites, not to price one on its own.',
  },
  planner: {
    title: 'Work planner',
    lede: 'Hot work, burning and machinery that can spark: which days to go ahead, take care, or stop, at each site.',
    best: 'Best day', noneBest: 'None this week', noForecast: 'No forecast for this site', unavailable: 'The forecast is not available right now.',
    people: (n: string) => `${n} people`,
    note: 'Stop: high fire danger or above, or wind of 40 km/h or more. Caution: moderate danger, wind of 25 km/h or more, or humidity of 25% or less. Noon weather from Open-Meteo. This is advice, not a permit: follow local burn bans and your own safety rules.',
  },
  impact: {
    title: 'Project impact',
    lede: 'Fire in each project area, year by year since 2000, from one harmonized satellite record: the years before and after are measured the same way.',
    change: (_pct: string, year: number, after: string, ay: number, before: string, by: number) =>
      `fire per year since ${year}: ${after} a year over ${ay} year${plural(ay, '', 's')}, against ${before} over the ${by} before.`,
    noBefore: 'No fire before',
    needYears: 'Not enough complete years on both sides of the start year to compare yet.',
    addYear: 'Add the year the project started to compare before and after.',
    average: 'Average', averageText: (v: string, a: number, b: number) => `${v} cell-days a year, fire in ${a} of ${b} years`,
    critical: 'Critical period', noSeason: 'No fire season on record', underWay: 'under way now', startsIn: (n: number) => `starts in ${n} days`,
    note: 'Fewer detections after a project started is consistent with it working, not proof: weather, a single bad year and what happens around the area move the numbers too. The record counts fire detections, not hectares.',
    empty: 'Add your project areas, with the year each project started, to see their history.',
  },
  alerts: {
    title: 'Alerts',
    lede: (verified: boolean) => verified
      ? 'An alert is about one site. Members see it here and in their notifications. Choose the public to also warn every phone in or watching the site.'
      : 'An alert is about one site. Members see it here and in their notifications. Verified organizations (fire stations, civil defence, municipalities) can also alert the public: ask Firesight to verify yours.',
    site: 'Site', level: 'Level', levels: { info: 'Information', warning: 'Warning', danger: 'Danger' }, hours: 'Active for (hours)',
    who: 'Who receives it', members: (org: string) => `Members of ${org}`, public: 'The public in this site', verifiedOnly: 'verified organizations only',
    titleField: 'Title', titlePh: 'Smoke near the north road', message: 'Message', messagePh: 'What is happening and what people should do.',
    arabic: 'Add Arabic text', titleAr: 'Title in Arabic', messageAr: 'Message in Arabic',
    send: 'Send to members', review: 'Review public alert', confirm: (site: string, org: string) => `This goes to every phone in or watching ${site}, signed "${org}".`,
    sendPublic: 'Alert the public', goBack: 'Go back', sending: 'Sending…',
    sent: (d: number, r: number) => `Sent. ${d} of ${r} phone${plural(r, '', 's')} received it at once.`,
    sentMembers: 'Sent. Your members see it in their notifications.', sentPublic: 'Sent. Phones in the area show it at their next check.',
    history: 'Sent', none: 'Nothing sent yet.', cancel: 'Cancel', cancelled: 'Cancelled', active: 'Active', ended: 'Ended',
    audience: { public: 'public', members: 'members' }, phones: (d: number, r: number) => `${d}/${r} phones`,
    ownerOnly: 'Only an owner sends alerts. You see what was sent below.', addSite: 'Add a site first: an alert is about a place.',
    noPush: 'Instant push is not set up on this server: phones show public alerts at their next check, and members see alerts here.',
  },
  team: {
    title: 'Team', members: 'Members', you: 'you',
    invite: 'Invite someone', inviteLede: 'They get a private link that works once, for 14 days. Send it yourself, by email or WhatsApp.',
    role: 'Role', create: 'Create link', creating: 'Creating…',
    linkTitle: 'Invitation link', linkFor: (email: string, d: string) => `For ${email}. Works once, until ${d}. It is shown only now: copy it before closing.`,
    message: (org: string, url: string, d: string) => `Hello,\n\nYou are invited to ${org} on Firesight for Organizations. Open this link to set your password and join:\n\n${url}\n\nThe link works once and expires on ${d}.`,
    copyLink: 'Copy link', copyMessage: 'Copy message', done: 'Done', readyToSend: 'Ready to send',
    pending: 'Pending invitations', noPending: 'No pending invitations.', expires: (d: string) => `expires ${d}`, withdraw: 'Withdraw',
    removeConfirm: (name: string) => `Remove ${name} from the organization?`,
    leave: 'Leave this organization', leaveConfirm: (org: string) => `Leave ${org}? You will need a new invitation to come back.`,
    delete: 'Delete this organization', deleteConfirm: (org: string) => `Delete ${org}, its sites and its alerts for every member? This cannot be undone.`,
    ownerOnly: 'Only owners invite and remove people.',
  },
  settings: {
    title: 'Settings', org: 'Organization', kind: 'Kind', country: 'Country', countryUnset: 'Not set', saveCountry: 'Save', saving: 'Saving…', verified: 'Can alert the public', yes: 'Yes, verified by Firesight', no: 'No. Ask Firesight to verify your organization.',
    you: 'You', notifications: 'Browser notifications', notifyOn: 'Show a notification on this computer when a site needs action, while Firesight is open in a tab.',
    notifyDenied: 'Notifications are blocked for this site in your browser settings.', notifyUnsupported: 'This browser cannot show notifications.',
    appearance: 'Appearance',
  },
  notification: { act: 'Needs action', fire: 'Fire inside', digest: 'Morning digest', alert: 'Alert' },
  map: { failed: 'This browser cannot draw the map (WebGL is off). The lists still work.' },
  close: 'Close',
};

/** The English dictionary's shape with every text widened to string, so each language fills it in its own words. */
type Widen<T> = T extends string ? string
  : T extends (...a: infer A) => infer R ? (...a: A) => Widen<R>
  : T extends readonly (infer U)[] ? Widen<U>[]
  : T extends object ? { [K in keyof T]: Widen<T[K]> }
  : T;
type Dict = Widen<typeof en>;

const arDict: Dict = {
  brand: 'Firesight',
  product: 'للمؤسسات',
  nav: { overview: 'نظرة عامة', sites: 'المواقع', tools: 'الأدوات', alerts: 'التنبيهات', team: 'الفريق', settings: 'الإعدادات', menu: 'القائمة', close: 'إغلاق القائمة' },
  tools: { briefing: 'إحاطة المناوبة', exposure: 'التعرّض للخطر', planner: 'مخطط العمل', impact: 'أثر المشاريع' },
  status: { act: 'تحرّك الآن', watch: 'مراقبة', ok: 'سليم' },
  level: { very_low: 'منخفض جداً', low: 'منخفض', moderate: 'متوسط', high: 'مرتفع', very_high: 'مرتفع جداً', extreme: 'شديد' },
  levelShort: { very_low: 'م.ج', low: 'م', moderate: 'و', high: 'ر', very_high: 'ر.ج', extreme: 'ش' },
  advice: { go: 'نفّذ', caution: 'بحذر', stop: 'أوقف' },
  kind: { fire_station: 'إطفاء أو دفاع مدني', insurer: 'شركة تأمين', company: 'شركة', ngo: 'منظمة أو بلدية' },
  kindHint: {
    fire_station: 'إحاطات مناوبة لنطاق تغطيتك، وتنبيه السكان بعد التوثيق.',
    insurer: 'تعرّض المحفظة المؤمَّنة للخطر، وأدلة الأقمار الصناعية للمطالبات.',
    company: 'مزارع ومصانع ومنتجعات ومرافق: أي الأيام آمنة للعمل، وتنبيه الموظفين.',
    ngo: 'الحرائق في مناطق مشاريعك سنة بعد سنة، وموعد بدء الفترة الحرجة.',
  },
  role: { owner: 'مالك', member: 'عضو' },
  compass: { north: 'شمال', 'north-east': 'شمال شرق', east: 'شرق', 'south-east': 'جنوب شرق', south: 'جنوب', 'south-west': 'جنوب غرب', west: 'غرب', 'north-west': 'شمال غرب' },
  common: {
    save: 'حفظ', saving: 'جارٍ الحفظ…', cancel: 'إلغاء', back: 'رجوع', retry: 'أعد المحاولة', copy: 'نسخ', copied: 'تم النسخ', print: 'طباعة', csv: 'تنزيل CSV',
    signIn: 'تسجيل الدخول', signOut: 'تسجيل الخروج', loading: 'جارٍ التحميل…', email: 'البريد الإلكتروني', password: 'كلمة المرور', name: 'الاسم', yourName: 'اسمك',
    refresh: 'تحديث', refreshing: 'جارٍ التحديث…', remove: 'إزالة', show: 'عرض', none: '–', theme: 'المظهر', dark: 'داكن', light: 'فاتح',
    language: 'اللغة', verified: 'موثّقة', updated: (t: string) => `حُدّث ${t}`, km: (n: string) => `${n} كم`,
    synthetic: 'رسم توضيحي ببيانات نموذجية',
  },
  ago: (min: number) => (min < 1 ? 'الآن' : min < 90 ? `قبل ${min} دقيقة` : min < 48 * 60 ? `قبل ${Math.round(min / 60)} ساعة` : `قبل ${Math.round(min / 1440)} يوماً`),
  why: (w: Why, f: Fmt): string => {
    switch (w.code) {
      case 'fire_inside': return `${ar(w.count, 'رصد واحد', 'رصدان', 'رصدات', 'رصداً')} لحريق بالأقمار الصناعية داخل الموقع، آخرها ${f.ago(w.at)}`;
      case 'fire_near': return `حريق رصدته الأقمار الصناعية على بعد ${f.one(w.km)} كم ${arDict.compass[w.compass] ?? w.compass} الموقع، ${f.ago(w.at)}`;
      case 'reports': return `${ar(w.count, 'بلاغ ميداني واحد', 'بلاغان ميدانيان', 'بلاغات ميدانية', 'بلاغاً ميدانياً')} عن حريق أو دخان داخل الموقع خلال 48 ساعة`;
      case 'danger_today': return `خطر حرائق ${arDict.level[w.level]} اليوم`;
      case 'danger_peak': return `خطر حرائق ${arDict.level[w.level]} يوم ${f.weekday(w.date)}`;
      case 'quiet': return w.forecast ? 'لا حرائق قريبة وخطر منخفض هذا الأسبوع' : 'لا حرائق قريبة';
    }
  },
  workWhy: (cause, value) => (cause === 'danger' ? `خطر ${arDict.level[value as Level]}` : cause === 'wind' ? `رياح ${value} كم/س` : `هواء جاف، ${value}%`),
  errors: {
    offline: 'لم يستجب خادم Firesight. تحقّق من الاتصال وأعد المحاولة.',
    wrong_credentials: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
    email_taken: 'لهذا البريد حساب بالفعل. سجّل الدخول به لقبول الدعوة.',
    weak_password: 'يجب أن تتكون كلمة المرور من 8 أحرف على الأقل.',
    bad_email: 'أدخل بريداً إلكترونياً صحيحاً.',
    rate_limited: 'محاولات كثيرة. حاول مجدداً بعد بضع دقائق.',
    invite_used: 'استُخدمت هذه الدعوة من قبل. سجّل الدخول بدلاً من ذلك.',
    invite_expired: 'انتهت صلاحية هذه الدعوة. اطلب دعوة جديدة ممن دعاك.',
    invite_not_found: 'هذه الدعوة غير موجودة أو سُحبت. اطلب دعوة جديدة.',
    outside_coverage: 'أحد المواقع خارج البلدان الأربعة التي يغطيها Firesight.',
    not_verified: 'المؤسسات الموثّقة فقط يمكنها تنبيه السكان.',
    last_owner: 'تبقى للمؤسسة مالكٌ واحد على الأقل.',
    generic: 'حدث خطأ. أعد المحاولة.',
  },
  landing: {
    signIn: 'تسجيل الدخول',
    request: 'اطلب الوصول',
    title: 'أيّ مواقعك يحتاج انتباهك اليوم، ولماذا؟',
    lede: 'يضع Firesight كل مكان أنت مسؤول عنه على خريطة واحدة ويرتّبها كل صباح من ثلاثة مصادر: الحرائق التي تراها أقمار ناسا الآن، وتوقعات خطر الحرائق للأسبوع، و25 سنة من سجل الحرائق الموحّد.',
    note: 'بالدعوة فقط. البرتغال واليونان ولبنان وقبرص.',
    sampleTitle: 'صباح في مركز إطفاء نموذجي',
    sectorsTitle: 'خريطة واحدة، أربع طرق للعمل',
    howTitle: 'كيف يعمل',
    how: [
      ['ضع مواقعك على الخريطة', 'الموقع دائرة حول مكان أنت مسؤول عنه: نطاق مركز، عقار مؤمَّن، مزرعة، مشروع. أضفها على الخريطة أو استوردها من ملف CSV.'],
      ['اقرأ اللوحة المرتّبة', 'يحصل كل موقع على درجة من 0 إلى 100 مع أسبابها بوضوح: حريق داخله أو قربه، وخطر الحرائق اليوم وخلال الأسبوع.'],
      ['تحرّك وأبقِ فريقك على علم', 'نبّه أعضاءك، أو السكان إن كانت مؤسستك موثّقة. يصلك إشعار وملخص صباحي حين يحتاج موقع إلى تحرّك.'],
    ],
    sourcesTitle: 'مبني على بيانات مفتوحة، بلا مبالغة',
    sources: [
      ['25 سنة في سجل واحد', 'رصدات MODIS (منذ 2000) وVIIRS (منذ 2012) موحّدة في سجل واحد، فيُقاس تاريخ الموقع بالطريقة نفسها قبل 2012 وبعدها.'],
      ['حرائق حيّة من الأقمار الصناعية', 'رصدات ناسا FIRMS شبه الآنية لآخر 48 ساعة، تُحدَّث كل 10 دقائق.'],
      ['خطر الحرائق، 16 يوماً', 'مؤشر طقس الحرائق الكندي على بيانات Open-Meteo، بالفئات التي يعتمدها EFFIS في أوروبا.'],
    ],
    honest: 'الدرجة جدول قواعد بسيط، لا نموذج معايَر على خسائر سابقة. يدلّ خطر الحرائق على سهولة اندلاعها وانتشارها، لا على مكان اندلاعها. Firesight يدعم القرار ولا يحلّ محل التحذيرات الرسمية.',
    closeTitle: 'أحضر مواقعك',
    closeLede: 'أخبرنا من أنتم وكم مكاناً تراقبون. نجهّز مؤسستكم ونرسل لمالكها رابطاً خاصاً.',
    credits: 'رصد الحرائق: ناسا FIRMS (MODIS وVIIRS). خطر الحرائق: المؤشر الكندي على طقس Open-Meteo. الصور: ناسا GIBS. الحدود: Natural Earth. مشروع مستقل، ليس من منتجات ناسا.',
    publicSite: 'سجل الحرائق العام',
  },
  request: {
    title: 'اطلب الوصول',
    lede: 'Firesight للمؤسسات بالدعوة فقط. أخبرنا عن مؤسستك؛ نردّ بالبريد أو الهاتف، ثم نرسل لمالكها رابطاً خاصاً لإعداد الحساب.',
    orgName: 'المؤسسة', kind: 'نوع المؤسسة', country: 'البلد', countryPick: 'اختر بلداً', countries: ['البرتغال', 'اليونان', 'لبنان', 'قبرص', 'أكثر من بلد منها', 'بلد آخر'],
    contactName: 'اسمك', email: 'بريد العمل', phone: 'الهاتف (اختياري)', sites: 'عدد المواقع (اختياري)', sitesHint: 'مراكز أو عقارات أو مزارع أو مناطق مشاريع تراقبها.',
    message: 'ما ينبغي أن نعرفه (اختياري)', submit: 'أرسل الطلب', sending: 'جارٍ الإرسال…',
    doneTitle: 'وصلنا طلبك',
    done: (email: string) => `شكراً لك. سنردّ على ${email}. عند إعداد مؤسستك يصل مالكها رابط خاص لتسجيل الدخول.`,
    already: 'لدينا طلب من هذا البريد بالفعل؛ لا حاجة لإرساله مجدداً.',
    privacy: 'نستخدم هذه البيانات فقط للرد عليك وإعداد مؤسستك.',
  },
  login: {
    title: 'تسجيل الدخول',
    lede: 'استخدم البريد وكلمة المرور من دعوتك.',
    submit: 'تسجيل الدخول', busy: 'جارٍ الدخول…',
    noAccount: 'لا وصول لديك بعد؟', request: 'اطلب الوصول لمؤسستك',
    lost: 'فقدت كلمة المرور أو الوصول؟ اطلب دعوة جديدة من مالك في مؤسستك.',
  },
  invite: {
    checking: 'جارٍ فتح دعوتك…',
    title: (org: string) => `انضم إلى ${org}`,
    as: (role: string, email: string) => `أنت مدعو بصفة ${role} بالبريد ${email}.`,
    createTitle: 'عيّن كلمة المرور',
    create: 'أنشئ الحساب وانضم', creating: 'جارٍ الانضمام…',
    haveAccount: 'لديك حساب Firesight بهذا البريد؟', signInInstead: 'سجّل الدخول للقبول',
    signedInAs: (email: string) => `مسجّل الدخول باسم ${email}.`,
    accept: (org: string) => `انضم إلى ${org}`, accepting: 'جارٍ الانضمام…',
    otherAccount: 'استخدم حساباً آخر',
    expires: (d: string) => `يعمل هذا الرابط مرة واحدة، حتى ${d}.`,
    ownerNote: 'بصفتك مالكاً تضيف المواقع وتدعو فريقك وترسل التنبيهات.',
    memberNote: 'بصفتك عضواً ترى اللوحة وكل الأدوات والتنبيهات.',
  },
  shell: {
    switchOrg: 'المؤسسة', notifications: 'الإشعارات', markRead: 'تعليم الكل كمقروء', noNotifications: 'لا شيء بعد. يظهر إشعار هنا حين يحتاج موقع إلى تحرّك، وكل صباح عند السادسة.',
    unread: (n: number) => `${n} غير مقروء`, account: 'الحساب', noOrg: 'لست عضواً في أي مؤسسة بعد.',
    noOrgHint: 'اطلب دعوة من مالك في مؤسستك، أو اطلب الوصول لمؤسسة جديدة.',
    newNotification: 'إشعار جديد', openSite: 'افتح الموقع',
  },
  overview: {
    act: (n: number) => `${ar(n, 'موقع واحد', 'موقعان', 'مواقع', 'موقعاً')} ${n === 1 ? 'يحتاج' : 'تحتاج'} إلى تحرّك الآن`,
    watch: (n: number) => `${ar(n, 'موقع واحد', 'موقعان', 'مواقع', 'موقعاً')} للمراقبة`,
    allOk: (n: number) => (n === 1 ? 'موقعك سليم' : `جميع المواقع الـ${n} سليمة`),
    counts: { act: 'تحرّك الآن', watch: 'مراقبة', ok: 'سليم' },
    atRisk: 'معرّض للخطر هذا الأسبوع', atRiskHint: 'حريق قريب، أو خطر حرائق مرتفع أو أعلى.',
    value: 'القيمة', people: 'شخص',
    board: 'المواقع مرتّبة', grid: 'المربع', boardHint: 'مرّر على صف لتجد مربعه على الخريطة.',
    digest: 'هذا الصباح', noDigest: 'يصل أول ملخص صباحي عند السادسة.',
    unavailable: { live: 'الحرائق الحيّة من الأقمار الصناعية غير متاحة الآن.', forecast: 'توقعات خطر الحرائق غير متاحة الآن.', both: 'تظهر الدرجات من دونها.' },
    emptyTitle: 'أضف موقعك الأول',
    emptyOwner: 'الموقع دائرة حول مكان أنت مسؤول عنه. يرتّب Firesight مواقعك بعدها كل صباح.',
    emptyMember: (org: string) => `يضيف مالك في ${org} المواقع، وتظهر هنا حين يفعل.`,
    addOnMap: 'أضف مواقع', reading: 'جارٍ قراءة مواقعك…',
    note: 'الدرجة جدول قواعد بسيط: الحرائق المرصودة الآن تتقدّم على الطقس.',
    days: '7 أيام',
    mapLabel: 'خريطة مواقعك مع شبكة مرقّمة وحرائق حيّة من الأقمار الصناعية',
    fires: (n: number) => `${ar(n, 'حريق حيّ واحد', 'حريقان حيّان', 'حرائق حيّة', 'حريقاً حيّاً')} قرب مواقعك`,
  },
  sites: {
    title: 'المواقع', count: (n: number, max: number) => `${n} من ${max}`,
    search: 'ابحث في المواقع', all: 'الكل', filterStatus: 'الحالة',
    add: 'أضف على الخريطة', addHint: 'انقر على الخريطة حيث يقع الموقع.', addCancel: 'إنهاء الإضافة', outside: (countries: string) => `هذا المكان خارج ${countries}. انقر داخل أحدها.`,
    import: 'استورد CSV', template: 'نزّل نموذجاً', save: 'احفظ التغييرات', unsaved: 'تغييرات غير محفوظة',
    saved: (n: number) => `حُفظ ${ar(n, 'موقع واحد', 'موقعان', 'مواقع', 'موقعاً')}. تُرتَّب في اللوحة الآن.`,
    imported: (added: number, rows: number, skipped: number, full: boolean, max: number) =>
      [`أُضيف ${added} من ${rows} صفاً.`, skipped > 0 && `${skipped} بلا خط عرض أو طول.`, full && `تتسع المؤسسة لـ${max} موقعاً على الأكثر.`, 'راجعها ثم احفظ.'].filter(Boolean).join(' '),
    importNone: 'لم نجد صفوفاً فيها خط عرض وطول. الأعمدة: name, lat, lon, radius_km, value, people, started_year.',
    csvHelp: 'أعمدة CSV: name, lat, lon, radius_km, value, people, started_year. يجب أن تكون المواقع في البرتغال أو اليونان أو لبنان أو قبرص.',
    memberNote: 'المالك وحده يغيّر المواقع.',
    cols: { name: 'الاسم', grid: 'المربع', status: 'الآن', lat: 'خط العرض', lon: 'خط الطول', radius: 'نصف القطر (كم)', value: 'القيمة', people: 'الأشخاص', started: 'بدء المشروع' },
    newName: (n: number) => `موقع ${n}`,
    none: 'لا مواقع مطابقة.',
    discard: 'تجاهل',
  },
  site: {
    back: 'كل المواقع', notFound: 'لم يعد هذا الموقع ضمن المؤسسة.',
    score: 'الدرجة', why: 'السبب', firesNow: 'حرائق داخله الآن', last48: 'آخر 48 ساعة', perYear: 'الحرائق سنوياً', yearsWith: (a: number, b: number) => `${a} من ${b} سنة`,
    worst: 'أسوأ سنة', cellDays: (n: string) => `${n} يوم-خلية`,
    week: 'خطر الحرائق هذا الأسبوع', today: (lvl: string, t: number, w: number, h: number) => `اليوم: خطر ${lvl}، ${t}°م، رياح ${w} كم/س، رطوبة ${h}%.`,
    hotWork: 'الأعمال الساخنة في الخارج اليوم:',
    history: '25 سنة في هذا المكان', historyAxis: 'أيام-خلايا الحرائق النشطة سنوياً', peak: (n: string) => `الذروة ${n}`,
    critical: (name: string, share: number) => `الفترة الحرجة: ${name}، ${share}% من حرائق السنة المعتادة.`,
    underWay: 'إنها جارية الآن.', startsIn: (n: number) => `تبدأ بعد ${n} يوماً.`,
    nearby: 'حرائق قريبة من الأقمار الصناعية', inside: 'داخل الموقع', ofCentre: (km: string, dir: string) => `${km} كم ${dir} المركز`,
    ground: 'بلاغات من الناس هنا', pointed: (deg: number) => `باتجاه ${deg}°`,
    photoAlt: (label: string) => `صورة مرسلة مع بلاغ ${label}`,
    alert: 'أرسل تنبيهاً عن هذا الموقع',
    label: { wildfire: 'حريق غابات', smoke: 'دخان', agriculturalBurn: 'حرق زراعي', industrial: 'صناعي', falseAlarm: 'إنذار كاذب', unsure: 'غير متأكد' },
    reading: 'جارٍ قراءة سجل الموقع…',
    coords: 'المركز', radius: 'نصف القطر',
  },
  claim: {
    title: 'التحقق من مطالبة', lede: 'هل رأى قمر صناعي حريقاً في هذا الموقع حول تاريخ معيّن؟ يبحث في كل رصدات MODIS وVIIRS في السجل.',
    date: 'التاريخ', days: 'أيام قبله وبعده', km: 'كم خارج الموقع', check: 'تحقّق', checking: 'جارٍ البحث…',
    found: 'رُصد حريق', notFound: 'لا رصد',
    summaryFound: (days: number, n: number, inside: number, where: string, from: string, to: string) =>
      `رصدت الأقمار الصناعية حريقاً ${where} في ${ar(days, 'يوم واحد', 'يومين', 'أيام', 'يوماً')} بين ${from} و${to}: ${n} رصد، منها ${inside} داخل الموقع.`,
    summaryNone: (where: string, from: string, to: string) => `لا رصد بالأقمار الصناعية ${where} بين ${from} و${to}.`,
    outside: (first: string, last: string) => `يمتد السجل من ${first} إلى ${last}؛ هذه الفترة خارجه.`,
    whereInside: 'داخل الموقع', whereWithin: (km: number) => `على بعد ${km} كم من الموقع`,
    caveat: 'الرصد دليل على حريق في ذلك المكان والوقت. وغياب الرصد ليس دليلاً على غياب الحريق: الغيوم والدخان تحجب الحرائق، والأقمار تمر بضع مرات يومياً، والحرائق الصغيرة أو القصيرة تفوتها. يغطي كل رصد بكسلاً بنحو 375 م (VIIRS) أو 1 كم (MODIS).',
    cols: { date: 'التاريخ', time: 'الوقت (UTC)', dist: 'من المركز', where: 'المكان', sensor: 'المستشعر', conf: 'الثقة', frp: 'القدرة (ميغاواط)' },
    outsideSite: 'خارجه', csv: 'نزّل الأدلة CSV', closest: (n: number) => `يظهر أقرب ${n}. يتضمن ملف CSV حتى 500.`,
    ground: (n: number) => `${ar(n, 'بلاغ ميداني واحد', 'بلاغان ميدانيان', 'بلاغات ميدانية', 'بلاغاً ميدانياً')} في هذه الفترة.`,
    confidence: { low: 'منخفضة', nominal: 'عادية', high: 'مرتفعة' },
  },
  briefing: {
    title: 'إحاطة المناوبة',
    lede: (act: number, total: number, names: string) => act > 0 ? `${act} من ${total} ${act === 1 ? 'منطقة تحتاج' : 'مناطق تحتاج'} إلى تحرّك الآن: ${names}.` : 'لا منطقة تحتاج إلى تحرّك الآن.',
    burning: (names: string) => `ترى الأقمار الصناعية حريقاً داخل ${names}.`,
    cols: { area: 'المنطقة', now: 'الآن', week: 'الأيام السبعة', high: 'أيام مرتفعة أو أعلى', fires: 'حرائق الأقمار الصناعية', reports: 'بلاغات ميدانية' },
    unavailable: 'غير متاح', noneNear: 'لا شيء ضمن 25 كم', inside: (n: number, ago: string) => `${n} داخلها، آخرها ${ago}`,
    near: (km: string, dir: string, ago: string) => `${km} كم ${dir}، ${ago}`, noForecast: 'لا توقعات', alert: 'تنبيه',
    note: 'خطر الحرائق هو مؤشر طقس الحرائق الكندي بفئات EFFIS. يدلّ على سهولة اندلاع الحريق وانتشاره في هذا الطقس، لا على مكان اندلاعه.',
    notVerified: 'تصل التنبيهات إلى أعضائك فقط. اطلب من Firesight توثيق مركزك لتنبيه السكان في مناطقك.',
    reported: (names: string) => `أبلغ ناس عن حريق أو دخان في ${names} خلال 48 ساعة.`,
  },
  exposure: {
    title: 'تعرّض المحفظة للخطر',
    tiles: { total: 'القيمة الإجمالية', atRisk: 'القيمة المعرّضة هذا الأسبوع', sites: 'مواقع معرّضة هذا الأسبوع' },
    share: (p: number) => `${p}% من المحفظة`, addValues: 'أضف قيماً لمواقعك', of: (n: number) => `من ${n}`, sitesN: (n: number) => ar(n, 'موقع واحد', 'موقعان', 'مواقع', 'موقعاً'),
    riskHint: 'حريق قريب، أو خطر مرتفع أو أعلى',
    cols: { site: 'الموقع', value: 'القيمة', perYear: 'الحرائق سنوياً', worst: 'أسوأ سنة', years: 'سنوات فيها حرائق', critical: 'الفترة الحرجة', peak: 'ذروة الخطر هذا الأسبوع', now: 'الآن' },
    reading: 'جارٍ قراءة 25 سنة من سجل الحرائق لكل موقع…',
    note: '«الحرائق سنوياً» هي متوسط أيام-خلايا الحرائق النشطة سنوياً في المربع المحيط بالموقع، من السجل الموحّد منذ 2000. تُحصي الرصدات لا المساحة المحروقة ولا الأضرار: استخدمها لترتيب المواقع، لا لتسعير موقع وحده.',
  },
  planner: {
    title: 'مخطط العمل',
    lede: 'الأعمال الساخنة والحرق والآليات التي قد تقدح شرراً: أي الأيام تنفّذ فيها، وأيها بحذر، وأيها توقف، في كل موقع.',
    best: 'أفضل يوم', noneBest: 'لا يوم هذا الأسبوع', noForecast: 'لا توقعات لهذا الموقع', unavailable: 'التوقعات غير متاحة الآن.',
    people: (n: string) => `${n} شخص`,
    note: 'أوقف: خطر مرتفع أو أعلى، أو رياح 40 كم/س أو أكثر. بحذر: خطر متوسط، أو رياح 25 كم/س أو أكثر، أو رطوبة 25% أو أقل. طقس الظهيرة من Open-Meteo. هذه نصيحة لا تصريح: التزم بقرارات منع الحرق المحلية وقواعد السلامة لديك.',
  },
  impact: {
    title: 'أثر المشاريع',
    lede: 'الحرائق في كل منطقة مشروع سنة بعد سنة منذ 2000، من سجل أقمار صناعية موحّد: تُقاس السنوات قبل المشروع وبعده بالطريقة نفسها.',
    change: (_pct: string, year: number, after: string, ay: number, before: string, by: number) =>
      `في الحرائق سنوياً منذ ${year}: ${after} سنوياً على مدى ${ay} سنة، مقابل ${before} في السنوات الـ${by} السابقة.`,
    noBefore: 'لا حرائق قبله',
    needYears: 'لا سنوات كاملة كافية على جانبي سنة البدء للمقارنة بعد.',
    addYear: 'أضف سنة بدء المشروع للمقارنة بين ما قبله وما بعده.',
    average: 'المتوسط', averageText: (v: string, a: number, b: number) => `${v} يوم-خلية سنوياً، حرائق في ${a} من ${b} سنة`,
    critical: 'الفترة الحرجة', noSeason: 'لا موسم حرائق في السجل', underWay: 'جارية الآن', startsIn: (n: number) => `تبدأ بعد ${n} يوماً`,
    note: 'قلة الرصدات بعد بدء المشروع تنسجم مع نجاحه ولا تثبته: الطقس وسنة سيئة واحدة وما يجري حول المنطقة تحرّك الأرقام أيضاً. يُحصي السجل رصدات الحرائق لا الهكتارات.',
    empty: 'أضف مناطق مشاريعك مع سنة بدء كل مشروع لترى تاريخها.',
  },
  alerts: {
    title: 'التنبيهات',
    lede: (verified: boolean) => verified
      ? 'التنبيه يخص موقعاً واحداً. يراه الأعضاء هنا وفي إشعاراتهم. اختر السكان لتنبيه كل هاتف داخل الموقع أو يراقبه أيضاً.'
      : 'التنبيه يخص موقعاً واحداً. يراه الأعضاء هنا وفي إشعاراتهم. يمكن للمؤسسات الموثّقة (الإطفاء والدفاع المدني والبلديات) تنبيه السكان أيضاً: اطلب من Firesight توثيق مؤسستك.',
    site: 'الموقع', level: 'المستوى', levels: { info: 'معلومة', warning: 'تحذير', danger: 'خطر' }, hours: 'المدة (ساعات)',
    who: 'من يتلقاه', members: (org: string) => `أعضاء ${org}`, public: 'السكان في هذا الموقع', verifiedOnly: 'للمؤسسات الموثّقة فقط',
    titleField: 'العنوان', titlePh: 'دخان قرب الطريق الشمالي', message: 'الرسالة', messagePh: 'ما الذي يحدث وما الذي ينبغي أن يفعله الناس.',
    arabic: 'أضف نصاً بالعربية', titleAr: 'العنوان بالعربية', messageAr: 'الرسالة بالعربية',
    send: 'أرسل إلى الأعضاء', review: 'راجع التنبيه العام', confirm: (site: string, org: string) => `سيصل هذا إلى كل هاتف داخل ${site} أو يراقبه، بتوقيع «${org}».`,
    sendPublic: 'نبّه السكان', goBack: 'رجوع', sending: 'جارٍ الإرسال…',
    sent: (d: number, r: number) => `أُرسل. تلقاه ${d} من ${r} هاتفاً فوراً.`,
    sentMembers: 'أُرسل. يراه أعضاؤك في إشعاراتهم.', sentPublic: 'أُرسل. تعرضه الهواتف في المنطقة عند فحصها التالي.',
    history: 'المرسَلة', none: 'لم يُرسل شيء بعد.', cancel: 'إلغاء', cancelled: 'أُلغي', active: 'نشط', ended: 'انتهى',
    audience: { public: 'السكان', members: 'الأعضاء' }, phones: (d: number, r: number) => `${d}/${r} هاتف`,
    ownerOnly: 'المالك وحده يرسل التنبيهات. ترى أدناه ما أُرسل.', addSite: 'أضف موقعاً أولاً: التنبيه يخص مكاناً.',
    noPush: 'الإشعار الفوري غير مفعّل على هذا الخادم: تعرض الهواتف التنبيهات العامة عند فحصها التالي، ويرى الأعضاء التنبيهات هنا.',
  },
  team: {
    title: 'الفريق', members: 'الأعضاء', you: 'أنت',
    invite: 'ادعُ شخصاً', inviteLede: 'يصله رابط خاص يعمل مرة واحدة لمدة 14 يوماً. أرسله بنفسك بالبريد أو واتساب.',
    role: 'الدور', create: 'أنشئ الرابط', creating: 'جارٍ الإنشاء…',
    linkTitle: 'رابط الدعوة', linkFor: (email: string, d: string) => `لـ${email}. يعمل مرة واحدة حتى ${d}. يظهر الآن فقط: انسخه قبل الإغلاق.`,
    message: (org: string, url: string, d: string) => `مرحباً،\n\nأنت مدعو إلى ${org} على Firesight للمؤسسات. افتح هذا الرابط لتعيين كلمة المرور والانضمام:\n\n${url}\n\nيعمل الرابط مرة واحدة وتنتهي صلاحيته في ${d}.`,
    copyLink: 'انسخ الرابط', copyMessage: 'انسخ الرسالة', done: 'تم', readyToSend: 'جاهزة للإرسال',
    pending: 'دعوات معلّقة', noPending: 'لا دعوات معلّقة.', expires: (d: string) => `تنتهي ${d}`, withdraw: 'اسحب',
    removeConfirm: (name: string) => `إزالة ${name} من المؤسسة؟`,
    leave: 'غادر هذه المؤسسة', leaveConfirm: (org: string) => `مغادرة ${org}؟ ستحتاج دعوة جديدة للعودة.`,
    delete: 'احذف هذه المؤسسة', deleteConfirm: (org: string) => `حذف ${org} ومواقعها وتنبيهاتها لكل الأعضاء؟ لا يمكن التراجع.`,
    ownerOnly: 'المالكون وحدهم يدعون الأشخاص ويزيلونهم.',
  },
  settings: {
    title: 'الإعدادات', org: 'المؤسسة', kind: 'النوع', country: 'البلد', countryUnset: 'غير محدد', saveCountry: 'حفظ', saving: 'جارٍ الحفظ…', verified: 'تنبيه السكان', yes: 'نعم، موثّقة من Firesight', no: 'لا. اطلب من Firesight توثيق مؤسستك.',
    you: 'أنت', notifications: 'إشعارات المتصفح', notifyOn: 'أظهر إشعاراً على هذا الحاسوب حين يحتاج موقع إلى تحرّك، ما دام Firesight مفتوحاً في علامة تبويب.',
    notifyDenied: 'الإشعارات محظورة لهذا الموقع في إعدادات متصفحك.', notifyUnsupported: 'لا يستطيع هذا المتصفح عرض الإشعارات.',
    appearance: 'المظهر',
  },
  notification: { act: 'يحتاج إلى تحرّك', fire: 'حريق داخل الموقع', digest: 'الملخص الصباحي', alert: 'تنبيه' },
  map: { failed: 'لا يستطيع هذا المتصفح رسم الخريطة (WebGL معطّل). القوائم تعمل.' },
  close: 'إغلاق',
};

/** Number and date formats for one language. */
export interface Fmt {
  int(v: number): string;
  one(v: number): string;
  compact(v: number): string;
  pct(v: number): string;
  date(iso: string): string;
  dayMonth(date: string): string;
  weekday(date: string): string;
  weekdayShort(date: string): string;
  dateTime(iso: string): string;
  time(iso: string): string;
  month(m: number): string;
  ago(iso: string): string;
}

function makeFmt(lang: Lang, dict: Dict): Fmt {
  // Western digits in Arabic too, as on the public site; Levantine month names.
  const loc = lang === 'ar' ? 'ar-LB-u-nu-latn' : 'en-GB';
  const n0 = new Intl.NumberFormat(loc, { maximumFractionDigits: 0 });
  const n1 = new Intl.NumberFormat(loc, { maximumFractionDigits: 1 });
  const nc = new Intl.NumberFormat(loc, { notation: 'compact', maximumFractionDigits: 1 });
  // Forecast dates are the country's calendar dates: read them in UTC so the weekday never shifts.
  const utc = (d: string) => new Date(`${d}T00:00:00Z`);
  const dm = new Intl.DateTimeFormat(loc, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const wd = new Intl.DateTimeFormat(loc, { weekday: 'long', timeZone: 'UTC' });
  const wds = new Intl.DateTimeFormat(loc, { weekday: 'short', timeZone: 'UTC' });
  const dd = new Intl.DateTimeFormat(loc, { day: 'numeric', month: 'long', year: 'numeric' });
  const dt = new Intl.DateTimeFormat(loc, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const tm = new Intl.DateTimeFormat(loc, { hour: '2-digit', minute: '2-digit' });
  const mo = new Intl.DateTimeFormat(loc, { month: 'long', timeZone: 'UTC' });
  return {
    int: (v) => n0.format(v),
    one: (v) => n1.format(v),
    compact: (v) => nc.format(v),
    pct: (v) => `${n0.format(v)}%`,
    date: (iso) => dd.format(new Date(iso)),
    dayMonth: (d) => dm.format(utc(d)),
    weekday: (d) => wd.format(utc(d)),
    weekdayShort: (d) => wds.format(utc(d)),
    dateTime: (iso) => dt.format(new Date(iso)),
    time: (iso) => tm.format(new Date(iso)),
    month: (m) => mo.format(new Date(Date.UTC(2001, m - 1, 1))),
    ago: (iso) => dict.ago(Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000))),
  };
}

const DICTS: Record<Lang, Dict> = { en, ar: arDict };
const FMTS = { en: makeFmt('en', en), ar: makeFmt('ar', arDict) };

/** The words and formats of the language on screen. */
export function useT() {
  const { lang } = usePrefs();
  return { t: DICTS[lang], f: FMTS[lang], lang };
}

export type T = Dict;

/** An API failure in the reader's language. */
export function errorText(t: Dict, err: unknown): string {
  const code = (err as { code?: string })?.code;
  if (code && t.errors[code]) return t.errors[code];
  const msg = (err as { message?: string })?.message;
  return msg && msg !== 'offline' && /[a-z]/i.test(msg) && t === en ? msg : t.errors.generic;
}

/** The critical period's months, named in the reader's language. */
export function periodName(f: Fmt, startMonth: number, months: number) {
  const end = ((startMonth - 1 + months - 1) % 12) + 1;
  return months === 1 ? f.month(startMonth) : `${f.month(startMonth)}–${f.month(end)}`;
}
