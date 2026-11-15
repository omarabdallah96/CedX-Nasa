// User accounts for the phone app. Signing in is optional: everything works as
// a guest. An account is what paid features and synced settings hang off later.
//
// Email + password. Passwords are hashed with scrypt (node:crypto). Signing in
// hands out an opaque bearer token; only its SHA-256 is stored, so a leaked
// database cannot be used to sign in. Stored in SQLite next to the reports.
import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const MIN_PASSWORD = 8;
export const MAX_PASSWORD = 200;
export const MAX_NAME = 60;
export const MAX_EMAIL = 254;
/** A session lasts this long after it was last used. */
export const SESSION_DAYS = 180;

/** 'pro' unlocks paid features in the app (unlimited alert zones, zone reports). */
export const PLANS = ['free', 'pro'] as const;
export type Plan = (typeof PLANS)[number];

export interface User {
  id: string;
  email: string;
  name: string;
  plan: Plan;
  createdAt: string;
}

interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  plan: string;
  created_at: string;
}

export class AccountError extends Error {
  code: 'email_taken' | 'wrong_credentials';
  constructor(code: AccountError['code'], message: string) {
    super(message);
    this.code = code;
  }
}

const toUser = (r: UserRow): User => ({
  id: r.id,
  email: r.email,
  name: r.name,
  plan: r.plan === 'pro' ? 'pro' : 'free',
  createdAt: r.created_at,
});
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Trims and lower-cases; returns null when it does not look like an email. */
export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (email.length > MAX_EMAIL || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

// scrypt with N=2^14, r=8, p=1 (Node's defaults), 32-byte key.
const KEYLEN = 32;
function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password.normalize('NFKC'), salt, KEYLEN, (err, key) => (err ? reject(err) : resolve(key))));
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('base64url')}$${(await derive(password, salt)).toString('base64url')}`;
}

async function checkPassword(password: string, stored: string): Promise<boolean> {
  const [kind, saltText, keyText] = stored.split('$');
  if (kind !== 'scrypt' || !saltText || !keyText) return false;
  const want = Buffer.from(keyText, 'base64url');
  const got = await derive(password, Buffer.from(saltText, 'base64url'));
  return want.length === got.length && timingSafeEqual(want, got);
}

/** Checked against when the email is unknown, so both answers take as long. */
const DUMMY_HASH = `scrypt$${randomBytes(16).toString('base64url')}$${randomBytes(KEYLEN).toString('base64url')}`;

export interface AccountStore {
  /** Creates an account and signs it in. Throws AccountError('email_taken'). */
  register(input: { email: string; password: string; name: string }): Promise<{ user: User; token: string }>;
  /** Throws AccountError('wrong_credentials'). */
  login(input: { email: string; password: string }): Promise<{ user: User; token: string }>;
  /** The user a token belongs to, or null when it is unknown or expired. Extends the session. */
  authenticate(token: string): User | null;
  logout(token: string): void;
  updateName(userId: string, name: string): User | null;
  /** Newest first; `query` matches part of the email. For the admin page. */
  search(query: string, limit: number): { users: User[]; total: number };
  /** Sets the plan by email (admin, or a payment webhook later). Null when there is no such account. */
  setPlan(email: string, plan: Plan): User | null;
  /** Deletes the account and every session of it. */
  remove(userId: string): boolean;
  /** Removes expired sessions; returns how many. */
  prune(now?: number): number;
  count(): number;
  close(): void;
}

/** `dir` holds accounts.db; ':memory:' keeps everything in memory (tests). */
export function createAccountStore(dir: string, { now = Date.now }: { now?: () => number } = {}): AccountStore {
  const memory = dir === ':memory:';
  if (!memory) mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(memory ? ':memory:' : path.join(dir, 'accounts.db'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);
    CREATE INDEX IF NOT EXISTS sessions_expires ON sessions (expires_at);
  `);
  // Columns added after the first release.
  const columns = new Set((db.prepare('PRAGMA table_info(users)').all() as unknown as { name: string }[]).map((c) => c.name));
  if (!columns.has('plan')) db.exec(`ALTER TABLE users ADD COLUMN plan TEXT NOT NULL DEFAULT 'free'`);

  const userByEmail = db.prepare('SELECT * FROM users WHERE email = ?');
  const userById = db.prepare('SELECT * FROM users WHERE id = ?');
  const insertUser = db.prepare('INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)');
  const insertSession = db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)');
  const sessionUser = db.prepare(`
    SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?`);
  const extend = db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?');
  const dropSession = db.prepare('DELETE FROM sessions WHERE token_hash = ?');

  const iso = (ms: number) => new Date(ms).toISOString();
  const expiry = () => iso(now() + SESSION_DAYS * 86_400_000);

  function openSession(userId: string): string {
    const token = randomBytes(32).toString('base64url');
    insertSession.run(sha256(token), userId, iso(now()), expiry());
    return token;
  }

  return {
    async register({ email, password, name }) {
      if (userByEmail.get(email)) throw new AccountError('email_taken', 'An account with this email already exists.');
      const hash = await hashPassword(password);
      const id = randomUUID();
      try {
        insertUser.run(id, email, name, hash, iso(now()));
      } catch {
        // Two sign-ups for the same email at once.
        throw new AccountError('email_taken', 'An account with this email already exists.');
      }
      return { user: toUser(userById.get(id) as unknown as UserRow), token: openSession(id) };
    },

    async login({ email, password }) {
      const row = userByEmail.get(email) as UserRow | undefined;
      const ok = await checkPassword(password, row?.password_hash ?? DUMMY_HASH);
      if (!row || !ok) throw new AccountError('wrong_credentials', 'Wrong email or password.');
      return { user: toUser(row), token: openSession(row.id) };
    },

    authenticate(token) {
      const h = sha256(token);
      const row = sessionUser.get(h, iso(now())) as UserRow | undefined;
      if (!row) return null;
      extend.run(expiry(), h);
      return toUser(row);
    },

    logout(token) {
      dropSession.run(sha256(token));
    },

    updateName(userId, name) {
      db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, userId);
      const row = userById.get(userId) as UserRow | undefined;
      return row ? toUser(row) : null;
    },

    search(query, limit) {
      const like = `%${query.trim().toLowerCase().replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
      const rows = db.prepare(`SELECT * FROM users WHERE email LIKE ? ESCAPE '\\' ORDER BY created_at DESC LIMIT ?`).all(like, limit);
      const total = Number((db.prepare(`SELECT COUNT(*) AS n FROM users WHERE email LIKE ? ESCAPE '\\'`).get(like) as { n: number }).n);
      return { users: (rows as unknown as UserRow[]).map(toUser), total };
    },

    setPlan(email, plan) {
      db.prepare('UPDATE users SET plan = ? WHERE email = ?').run(plan, email);
      const row = userByEmail.get(email) as UserRow | undefined;
      return row ? toUser(row) : null;
    },

    remove(userId) {
      return Number(db.prepare('DELETE FROM users WHERE id = ?').run(userId).changes) > 0;
    },

    prune(at = now()) {
      return Number(db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(iso(at)).changes);
    },

    count() {
      return Number((db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n);
    },

    close() {
      db.close();
    },
  };
}
