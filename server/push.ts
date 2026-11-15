// Push notifications through Firebase Cloud Messaging (HTTP v1 API).
//
// Needs a Firebase service account key: set FIREBASE_SERVICE_ACCOUNT to the
// key file's JSON (or to that JSON base64-encoded). Without it, push is off
// and phones still pick alerts up at their next check. No SDK: the OAuth
// token is a JWT signed with node:crypto.
import { createSign } from 'node:crypto';

export interface PushMessage {
  token: string;
  title: string;
  body: string;
  /** Extra string fields the app reads (alert id, kind). */
  data: Record<string, string>;
  urgent: boolean;
}

export interface PushResult {
  sent: number;
  failed: number;
  /** Tokens FCM says no longer exist: the caller should forget them. */
  invalidTokens: string[];
}

export interface Push {
  readonly available: boolean;
  readonly projectId: string | null;
  send(messages: PushMessage[]): Promise<PushResult>;
}

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

/** Reads the service account from FIREBASE_SERVICE_ACCOUNT (JSON or base64 JSON). */
export function parseServiceAccount(raw: string | undefined): ServiceAccount | null {
  if (!raw?.trim()) return null;
  const text = raw.trim().startsWith('{') ? raw.trim() : Buffer.from(raw.trim(), 'base64').toString('utf8');
  const j = JSON.parse(text) as Partial<ServiceAccount>;
  if (!j.project_id || !j.client_email || !j.private_key) throw new Error('FIREBASE_SERVICE_ACCOUNT is missing project_id, client_email or private_key.');
  return { project_id: j.project_id, client_email: j.client_email, private_key: j.private_key };
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) =>
  Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

export function createPush({
  account,
  fetchImpl = fetch as unknown as FetchLike,
  now = Date.now,
  concurrency = 16,
}: { account: ServiceAccount | null; fetchImpl?: FetchLike; now?: () => number; concurrency?: number }): Push {
  let cached: { token: string; expires: number } | null = null;

  async function accessToken(): Promise<string> {
    if (cached && cached.expires > now() + 60_000) return cached.token;
    const iat = Math.floor(now() / 1000);
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
      iss: account!.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat,
      exp: iat + 3600,
    })}`;
    const signature = createSign('RSA-SHA256').update(unsigned).sign(account!.private_key).toString('base64url');
    const res = await fetchImpl('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }).toString(),
    });
    if (!res.ok) throw new Error(`Google OAuth answered ${res.status}: ${await res.text()}`);
    const j = (await res.json()) as { access_token: string; expires_in: number };
    cached = { token: j.access_token, expires: now() + j.expires_in * 1000 };
    return cached.token;
  }

  async function sendOne(m: PushMessage, bearer: string): Promise<'sent' | 'failed' | 'invalid'> {
    const res = await fetchImpl(`https://fcm.googleapis.com/v1/projects/${account!.project_id}/messages:send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          token: m.token,
          notification: { title: m.title, body: m.body },
          data: m.data,
          android: {
            priority: 'high',
            // Channels the app creates (lib/services/notification_service.dart).
            notification: { channel_id: m.urgent ? 'fire_urgent' : 'fire_alerts', icon: 'ic_stat_ember', color: '#FF6B2C' },
          },
          apns: { headers: { 'apns-priority': '10' }, payload: { aps: { sound: 'default' } } },
        },
      }),
    });
    if (res.ok) return 'sent';
    // 404 UNREGISTERED, or 400 for a malformed token: the token is dead.
    if (res.status === 404) return 'invalid';
    if (res.status === 400) {
      const text = await res.text();
      if (text.includes('registration token') || text.includes('UNREGISTERED')) return 'invalid';
    }
    return 'failed';
  }

  return {
    available: account !== null,
    projectId: account?.project_id ?? null,
    async send(messages) {
      const result: PushResult = { sent: 0, failed: 0, invalidTokens: [] };
      if (!account || messages.length === 0) return { ...result, failed: messages.length };
      let bearer: string;
      try {
        bearer = await accessToken();
      } catch (err) {
        console.error('push:', err);
        return { ...result, failed: messages.length };
      }
      let next = 0;
      const worker = async () => {
        while (next < messages.length) {
          const m = messages[next++];
          try {
            const r = await sendOne(m, bearer);
            if (r === 'sent') result.sent++;
            else {
              result.failed++;
              if (r === 'invalid') result.invalidTokens.push(m.token);
            }
          } catch {
            result.failed++;
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(concurrency, messages.length) }, worker));
      return result;
    },
  };
}
