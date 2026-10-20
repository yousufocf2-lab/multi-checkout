// Courier API integrations: check the login, track AWBs. One entry per "api" courier in the catalog.
import type { CourierCreds } from "~/db/schema";
import { CourierAuthError, http, mapStatusText, parseDate, pool, session, unseal, withSession, type TestResult, type TrackResult } from "./common.server";
import { testDelhiveryToken, trackDelhivery } from "./delhivery.server";

export type Provider = {
  /** Checks the login with the courier. */
  test: (c: CourierCreds) => Promise<TestResult>;
  /** Tracks AWBs. AWBs the courier doesn't know are left out of the result. */
  track: (c: CourierCreds, awbs: string[]) => Promise<TrackResult[]>;
  /** How many AWBs one track() call should get. */
  batch: number;
};

const base = (name: string, fallback: string) => (process.env[name] || fallback).replace(/\/+$/, "");
const msg = (b: Record<string, any> | null) => String(b?.message ?? b?.msg ?? b?.error ?? b?.errors?.[0]?.message ?? "").slice(0, 160);
const result = (awb: string, text: unknown, at: unknown): TrackResult | null => {
  const raw = String(text ?? "").trim();
  return raw ? { awb, status: mapStatusText(raw), raw, at: parseDate(at) } : null;
};
const auth = (status: number) => status === 401 || status === 403;

async function testLogin(label: string, login: () => Promise<string>): Promise<TestResult> {
  try {
    await login();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : `${label} login failed` };
  }
}

// ---------------- Shiprocket ----------------
// Login with an API user (Settings → API → Configure). Token lasts 10 days; we refresh every 8.
const SR = () => base("SHIPROCKET_BASE_URL", "https://apiv2.shiprocket.in") + "/v1/external";

async function shiprocketLogin(c: CourierCreds) {
  const r = await http(`${SR()}/auth/login`, { method: "POST", body: JSON.stringify({ email: c.email, password: unseal(c.password) }), label: "Shiprocket" });
  if (r.ok && r.body?.token) return String(r.body.token);
  if (r.status >= 400 && r.status < 500) throw new CourierAuthError(`Shiprocket didn't accept this email and password${msg(r.body) ? ` (${msg(r.body)})` : ""}. Use the API user from Settings → API, not your main Shiprocket login.`);
  throw new Error(`Shiprocket returned an error (${r.status}). Try again in a minute.`);
}

function shiprocketParse(awb: string, body: Record<string, any> | null): TrackResult | null {
  const td = body?.tracking_data ?? body?.[awb]?.tracking_data;
  if (!td || td.error) return null;
  const track = Array.isArray(td.shipment_track) ? td.shipment_track[0] : null;
  const act = Array.isArray(td.shipment_track_activities) ? td.shipment_track_activities[0] : null;
  return result(awb, track?.current_status || act?.["sr-status-label"] || act?.activity, act?.date ?? track?.updated_time ?? track?.delivered_date);
}

const shiprocket: Provider = {
  batch: 25,
  test: (c) => testLogin("Shiprocket", () => shiprocketLogin(c)),
  track: (c, awbs) => withSession(`shiprocket:${c.email}`, 8 * 86400_000, () => shiprocketLogin(c), async (token) => {
    const out = await pool(awbs, 5, async (awb) => {
      const r = await http(`${SR()}/courier/track/awb/${encodeURIComponent(awb)}`, { headers: { Authorization: `Bearer ${token}` }, label: "Shiprocket" });
      if (auth(r.status)) throw new CourierAuthError("Shiprocket session expired");
      return r.ok ? shiprocketParse(awb, r.body) : null;
    });
    return out.filter((x): x is TrackResult => Boolean(x));
  }),
};

// ---------------- NimbusPost / Xpressbees (same API style) ----------------
// POST users/login {email, password} → { status: true, data: "<token>" }, then Bearer.
function emailApi(label: string, envName: string, url: string, trackPath: string, bulkPath?: string): Provider {
  const B = () => base(envName, url);
  const login = async (c: CourierCreds) => {
    const r = await http(`${B()}/users/login`, { method: "POST", body: JSON.stringify({ email: c.email, password: unseal(c.password) }), label });
    if (r.ok && r.body?.status !== false && typeof r.body?.data === "string") return r.body.data as string;
    if ((r.status >= 400 && r.status < 500) || r.body?.status === false) throw new CourierAuthError(`${label} didn't accept this email and password${msg(r.body) ? ` (${msg(r.body)})` : ""}.`);
    throw new Error(`${label} returned an error (${r.status}). Try again in a minute.`);
  };
  const parse = (awb: string, d: Record<string, any> | null | undefined) =>
    d ? result(String(d.awb_number ?? d.awb ?? awb), d.status ?? d.current_status ?? d.shipment_status, d.status_date ?? d.updated_at ?? d.last_update ?? d.history?.[0]?.event_time) : null;

  return {
    batch: 50,
    test: (c) => testLogin(label, () => login(c)),
    track: (c, awbs) => withSession(`${label}:${c.email}`, 6 * 3600_000, () => login(c), async (token) => {
      const headers = { Authorization: `Bearer ${token}` };
      if (bulkPath && awbs.length > 1) {
        const r = await http(`${B()}${bulkPath}`, { method: "POST", headers, body: JSON.stringify({ awb: awbs }), label });
        if (auth(r.status)) throw new CourierAuthError(`${label} session expired`);
        const list = Array.isArray(r.body?.data) ? r.body!.data : r.body?.data && typeof r.body.data === "object" ? Object.values(r.body.data) : null;
        if (r.ok && r.body?.status !== false && list) {
          return (list as Record<string, any>[]).map((d) => parse("", d)).filter((x): x is TrackResult => Boolean(x?.awb));
        }
        // bulk not available on this account: fall back to one by one
      }
      const out = await pool(awbs, 5, async (awb) => {
        const r = await http(`${B()}${trackPath}${encodeURIComponent(awb)}`, { headers, label });
        if (auth(r.status)) throw new CourierAuthError(`${label} session expired`);
        return r.ok && r.body?.status !== false ? parse(awb, r.body?.data) : null;
      });
      return out.filter((x): x is TrackResult => Boolean(x));
    }),
  };
}

const nimbuspost = emailApi("NimbusPost", "NIMBUSPOST_BASE_URL", "https://api.nimbuspost.com/v1", "/shipments/track/", "/shipments/track/bulk");
const xpressbees = emailApi("Xpressbees", "XPRESSBEES_BASE_URL", "https://shipment.xpressbees.com/api", "/shipments2/track/");

// ---------------- Ekart (Elite) ----------------
// POST /integrations/v2/auth/token/{client_id} {username, password} → access_token (24 h). Tracking: GET /api/v1/track/{awb}.
const EK = () => base("EKART_BASE_URL", "https://app.elite.ekartlogistics.in");

async function ekartLogin(c: CourierCreds) {
  const r = await http(`${EK()}/integrations/v2/auth/token/${encodeURIComponent(c.clientId ?? "")}`, { method: "POST", body: JSON.stringify({ username: c.username, password: unseal(c.password) }), label: "Ekart" });
  if (r.ok && r.body?.access_token) return String(r.body.access_token);
  if (r.status >= 400 && r.status < 500) throw new CourierAuthError(`Ekart didn't accept these details${msg(r.body) ? ` (${msg(r.body)})` : ""}. Check the Client ID, username and password.`);
  throw new Error(`Ekart returned an error (${r.status}). Try again in a minute.`);
}

const ekart: Provider = {
  batch: 50,
  test: (c) => testLogin("Ekart", () => ekartLogin(c)),
  track: async (c, awbs) => {
    const token = await session(`ekart:${c.clientId}:${c.username}`, 20 * 3600_000, () => ekartLogin(c)).catch(() => null);
    const out = await pool(awbs, 5, async (awb) => {
      const r = await http(`${EK()}/api/v1/track/${encodeURIComponent(awb)}`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, label: "Ekart" });
      const t = r.body?.track ?? r.body;
      return r.ok && t ? result(awb, t.status, t.ctime ?? t.time) : null;
    });
    return out.filter((x): x is TrackResult => Boolean(x));
  },
};

// ---------------- Delhivery ----------------
const delhivery: Provider = {
  batch: 50,
  test: (c) => testDelhiveryToken(c.token ?? ""),
  track: (c, awbs) => trackDelhivery(c.token ?? "", awbs),
};

export const PROVIDERS: Record<string, Provider> = { delhivery, shiprocket, nimbuspost, xpressbees, ekart };
