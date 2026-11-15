// The app's link to the backend: the signed-in session and the shapes
// /api/v1 answers with (see server/org-routes.ts).
const ROOT = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
export const API = `${ROOT}/api/v1`;
const TOKEN_KEY = 'firesight.org.token';

export class ApiFailure extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

let token: string | null = null;
try {
  token = window.localStorage.getItem(TOKEN_KEY);
} catch {
  // Storage is blocked: the session lasts until the page is reloaded.
}
const signedOutListeners = new Set<() => void>();

export const session = {
  get token() {
    return token;
  },
  set(next: string | null) {
    token = next;
    try {
      if (next) window.localStorage.setItem(TOKEN_KEY, next);
      else window.localStorage.removeItem(TOKEN_KEY);
    } catch {
      // See above.
    }
  },
  /** Called when the server says the session has ended. */
  onSignedOut(f: () => void) {
    signedOutListeners.add(f);
    return () => {
      signedOutListeners.delete(f);
    };
  },
};

export async function api<T>(method: string, path: string, body?: unknown, { auth = true }: { auth?: boolean } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      method,
      headers: {
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
        ...(auth && token && { Authorization: `Bearer ${token}` }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiFailure(0, 'offline', 'offline');
  }
  const json = (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
  if (!res.ok) {
    const err = json?.error ?? { code: 'failed', message: `HTTP ${res.status}` };
    if (res.status === 401 && err.code === 'signed_out') {
      session.set(null);
      signedOutListeners.forEach((f) => f());
    }
    throw new ApiFailure(res.status, err.code, err.message);
  }
  return json as T;
}

export type OrgKind = 'fire_station' | 'insurer' | 'company' | 'ngo';
export const ORG_KINDS: OrgKind[] = ['fire_station', 'insurer', 'company', 'ngo'];
export type Level = 'very_low' | 'low' | 'moderate' | 'high' | 'very_high' | 'extreme';
export const LEVELS: Level[] = ['very_low', 'low', 'moderate', 'high', 'very_high', 'extreme'];
export type Status = 'act' | 'watch' | 'ok';
export type Role = 'owner' | 'member';

export interface User {
  id: string;
  email: string;
  name: string;
}

export interface Org {
  id: string;
  name: string;
  kind: OrgKind;
  country: string;
  verified: boolean;
  role: Role;
}

export interface Site {
  id: string;
  name: string;
  lat: number;
  lon: number;
  radiusKm: number;
  country?: string;
  value: number | null;
  people: number | null;
  startedYear: number | null;
}

export interface Member {
  id: string;
  role: Role;
  name: string;
  email: string | null;
  joinedAt: string;
}

export interface Invite {
  id: string;
  email: string;
  role: Role;
  createdAt: string;
  expiresAt: string;
}

export interface Day {
  date: string;
  level: Level;
  fwi: number;
  tempC: number;
  humidity: number;
  windKmh: number;
  rainMm: number;
  work: { advice: 'go' | 'caution' | 'stop'; why: string; cause: 'danger' | 'wind' | 'humidity'; value: number | Level };
}

export type Why =
  | { code: 'fire_inside'; count: number; at: string }
  | { code: 'fire_near'; km: number; compass: string; at: string }
  | { code: 'reports'; count: number }
  | { code: 'danger_today'; level: Level }
  | { code: 'danger_peak'; level: Level; date: string }
  | { code: 'quiet'; forecast: boolean };

export interface Fires {
  inside: number;
  nearest: { edgeKm: number; compass: string; acquiredAt: string; sensor: string; lat: number; lon: number } | null;
}

export interface BoardSite {
  site: Site;
  score: number;
  status: Status;
  reasons: string[];
  why: Why[];
  danger: Day[] | null;
  fires: Fires | null;
  reports: number;
}

export interface Board {
  generatedAt: string;
  unavailable: string[];
  summary: {
    sites: number;
    act: number;
    watch: number;
    ok: number;
    atRisk: { sites: number; value: number; people: number };
    total: { value: number; people: number };
  };
  sites: BoardSite[];
}

export interface History {
  coverageEnd: string;
  years: { year: number; value: number; complete: boolean }[];
  averagePerYear: number;
  worstYear: { year: number; value: number } | null;
  yearsWithFire: number;
  yearsOnRecord: number;
  criticalPeriod: { startMonth: number; months: number; name: string; share: number; inPeriod: boolean; startsInDays: number } | null;
  thisMonth: { level: string; sentence: string } | null;
  project: {
    startedYear: number;
    before: { years: number; averagePerYear: number };
    after: { years: number; averagePerYear: number };
    change: number | null;
  } | null;
}

export interface GroundReport {
  id: string;
  lat: number;
  lon: number;
  createdAt: string;
  label: string;
  note: string;
  bearing: number | null;
  hasPhoto: boolean;
}

export interface Hotspot {
  lat: number;
  lon: number;
  acquiredAt: string;
  sensor: string;
  confidence: string;
  frp: number;
}

export interface SiteReport extends BoardSite {
  unavailable: string[];
  history: History;
  hotspots: (Hotspot & { km: number; inside: boolean; compass: string })[];
  groundReports: GroundReport[];
}

export interface ExposureRow {
  site: Site;
  score: number;
  status: Status;
  atRisk: boolean;
  peakDanger: { date: string; level: Level; fwi: number } | null;
  averagePerYear: number;
  worstYear: { year: number; value: number } | null;
  yearsWithFire: number;
  yearsOnRecord: number;
  history: History;
}

export interface Exposure {
  unavailable: string[];
  totalValue: number;
  valueAtRisk: number;
  sitesAtRisk: number;
  sites: ExposureRow[];
}

export interface Detection {
  date: string; timeUtc: string; lat: number; lon: number; km: number; inside: boolean; compass: string;
  instrument: string; satellite: string; confidence: string; frp: number;
}

export interface Evidence {
  date: string;
  window: { from: string; to: string; searched: { from: string; to: string } | null };
  withinKm: number;
  found: boolean;
  fireDays: string[];
  detections: Detection[];
  detectionsTotal: number;
  groundReports: GroundReport[];
}

export interface Alert {
  id: string;
  title: string;
  message: string;
  level: 'info' | 'warning' | 'danger';
  createdAt: string;
  expiresAt: string;
  cancelled: boolean;
  audience: 'public' | 'members';
  pushed: { recipients: number; delivered: number } | null;
}

export interface OrgNotification {
  id: string;
  kind: 'act' | 'fire' | 'digest' | 'alert';
  title: string;
  body: string;
  siteId: string | null;
  createdAt: string;
}
