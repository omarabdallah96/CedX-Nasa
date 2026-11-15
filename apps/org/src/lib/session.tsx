// Who is signed in, their organizations, the current one's board and its
// notifications. One provider so every screen reads the same, fresh data:
// the board every 5 minutes, notifications every minute.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, session, type Board, type Org, type OrgNotification, type Site, type User } from './api.ts';
import { makeGrid, refOf, type Grid } from './grid.ts';
import { prefs } from './prefs.ts';

const ORG_KEY = 'firesight.org.current';
const BOARD_EVERY = 5 * 60_000;
const NOTES_EVERY = 60_000;

export interface MyOrg extends Org {
  sites: Site[];
}

interface SessionValue {
  booting: boolean;
  user: User | null;
  orgs: MyOrg[] | null;
  org: MyOrg | null;
  board: Board | null;
  boardError: unknown;
  boardLoading: boolean;
  grid: Grid | null;
  /** Grid reference of each site of the current organization. */
  refs: Map<string, string>;
  notifications: OrgNotification[];
  unread: number;
  /** A notification that arrived while the app was open, for the toast. */
  fresh: OrgNotification | null;
  signedIn(user: User, token: string): Promise<void>;
  signOut(): void;
  pickOrg(id: string): void;
  reloadOrgs(): Promise<MyOrg[] | null>;
  reloadBoard(): Promise<void>;
  markRead(): Promise<void>;
  dismissFresh(): void;
}

const Ctx = createContext<SessionValue | null>(null);

const remembered = () => {
  try {
    return window.localStorage.getItem(ORG_KEY);
  } catch {
    return null;
  }
};

export function SessionProvider({ children }: { children: ReactNode }) {
  const [booting, setBooting] = useState(session.token !== null);
  const [user, setUser] = useState<User | null>(null);
  const [orgs, setOrgs] = useState<MyOrg[] | null>(null);
  const [orgId, setOrgId] = useState<string | null>(remembered);
  const [board, setBoard] = useState<Board | null>(null);
  const [boardError, setBoardError] = useState<unknown>(null);
  const [boardLoading, setBoardLoading] = useState(false);
  const [notifications, setNotifications] = useState<OrgNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [fresh, setFresh] = useState<OrgNotification | null>(null);
  const seen = useRef<Set<string> | null>(null);

  const org = useMemo(() => orgs?.find((o) => o.id === orgId) ?? orgs?.[0] ?? null, [orgs, orgId]);

  const reloadOrgs = useCallback(async () => {
    try {
      const list = (await api<{ orgs: MyOrg[] }>('GET', '/orgs')).orgs;
      setOrgs(list);
      return list;
    } catch {
      setOrgs((o) => o ?? []);
      return null;
    }
  }, []);

  const clear = useCallback(() => {
    setUser(null);
    setOrgs(null);
    setBoard(null);
    setNotifications([]);
    setUnread(0);
    seen.current = null;
  }, []);

  useEffect(() => session.onSignedOut(clear), [clear]);

  useEffect(() => {
    if (!session.token) return;
    api<{ user: User }>('GET', '/auth/me')
      .then(async ({ user: u }) => {
        setUser(u);
        await reloadOrgs();
      })
      .catch(() => session.set(null))
      .finally(() => setBooting(false));
  }, [reloadOrgs]);

  const signedIn = useCallback(async (u: User, token: string) => {
    session.set(token);
    setUser(u);
    await reloadOrgs();
  }, [reloadOrgs]);

  const signOut = useCallback(() => {
    void api('POST', '/auth/logout').catch(() => {});
    session.set(null);
    clear();
  }, [clear]);

  const pickOrg = useCallback((id: string) => {
    setOrgId(id);
    setBoard(null);
    setNotifications([]);
    setUnread(0);
    seen.current = null;
    try {
      window.localStorage.setItem(ORG_KEY, id);
    } catch {
      // The choice holds for this visit.
    }
  }, []);

  // ---- The board ----
  const orgKey = org?.id ?? null;
  const reloadBoard = useCallback(async () => {
    if (!orgKey) return;
    setBoardLoading(true);
    try {
      setBoard(await api<Board>('GET', `/orgs/${orgKey}/board`));
      setBoardError(null);
    } catch (err) {
      setBoardError(err);
    } finally {
      setBoardLoading(false);
    }
  }, [orgKey]);

  useEffect(() => {
    if (!orgKey) return;
    void reloadBoard();
    const id = setInterval(() => void reloadBoard(), BOARD_EVERY);
    return () => clearInterval(id);
  }, [orgKey, reloadBoard]);

  // ---- Notifications ----
  const pollNotes = useCallback(async () => {
    if (!orgKey) return;
    try {
      const d = await api<{ notifications: OrgNotification[]; unread: number }>('GET', `/orgs/${orgKey}/notifications`);
      setNotifications(d.notifications);
      setUnread(d.unread);
      const first = seen.current === null;
      const known = seen.current ?? new Set<string>();
      const arrived = first ? [] : d.notifications.filter((n) => !known.has(n.id));
      seen.current = new Set(d.notifications.map((n) => n.id));
      const urgent = arrived.find((n) => n.kind === 'act' || n.kind === 'fire') ?? arrived[0];
      if (urgent) {
        setFresh(urgent);
        // Something changed at a site: the board catches up at once.
        if (urgent.kind !== 'digest') void reloadBoard();
        if (prefs.get().notify && 'Notification' in window && Notification.permission === 'granted') {
          const n = new Notification(urgent.title, { body: urgent.body, tag: urgent.id, icon: '/org/favicon.svg' });
          n.onclick = () => {
            window.focus();
            if (urgent.siteId) window.location.assign(`/org/app/sites/${urgent.siteId}`);
          };
        }
      }
    } catch {
      // Offline: the next poll tries again.
    }
  }, [orgKey, reloadBoard]);

  useEffect(() => {
    if (!orgKey) return;
    void pollNotes();
    const id = setInterval(() => void pollNotes(), NOTES_EVERY);
    return () => clearInterval(id);
  }, [orgKey, pollNotes]);

  const markRead = useCallback(async () => {
    if (!orgKey) return;
    setUnread(0);
    await api('POST', `/orgs/${orgKey}/notifications/read`).catch(() => {});
  }, [orgKey]);

  const sites = org?.sites;
  const grid = useMemo(() => makeGrid(sites ?? []), [sites]);
  const refs = useMemo(() => new Map((sites ?? []).map((s) => [s.id, grid ? refOf(grid, s.lat, s.lon) : ''])), [sites, grid]);

  const value: SessionValue = {
    booting, user, orgs, org, board, boardError, boardLoading, grid, refs, notifications, unread, fresh,
    signedIn, signOut, pickOrg, reloadOrgs, reloadBoard, markRead, dismissFresh: () => setFresh(null),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession outside SessionProvider');
  return v;
}

/** The current organization, for screens that only render inside one. */
export function useOrg() {
  const s = useSession();
  if (!s.org) throw new Error('useOrg without an organization');
  return { ...s, org: s.org };
}
