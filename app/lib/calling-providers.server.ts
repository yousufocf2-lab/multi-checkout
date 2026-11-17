type CallInfo = { verified: boolean; status: string; seconds: number | null; recording: string | null };

export type CallerProvider = {
  id: string;
  label: string;
  start(phone: string, memberId: number | null): Promise<string>;
  info(ref: string): Promise<CallInfo>;
};

type ProviderConfig = { provider: string; apiKey: string; agents: Record<string, string> };

const superfoneOrigin = "https://prod-api.superfone.co.in/superfone";

function superfone(config: ProviderConfig): CallerProvider {
  const get = async (path: string) => {
    const response = await fetch(superfoneOrigin + path, {
      headers: { "x-api-key": config.apiKey },
      signal: AbortSignal.timeout(8_000),
      redirect: "error",
    });
    if (!response.ok) throw new Error(`Superfone returned ${response.status}. Check the Superfone app before retrying.`);
    return (await response.json()).data;
  };
  return {
    id: "superfone",
    label: "Superfone",
    async start(phone, memberId) {
      const agent = config.agents[String(memberId ?? "owner")];
      if (!/^\+91\d{10}$/.test(agent ?? "")) throw new Error("No Superfone agent is mapped to this login.");
      const query = new URLSearchParams({ customer_number: `+91${phone}`, user_number: agent, call_action: "START" });
      const result = await get(`/api/customer/click-2-call?${query}`);
      if (!result?.sentSuccess || typeof result.request_uuid !== "string") throw new Error("Superfone did not return a call reference. Check the app before retrying.");
      return result.request_uuid;
    },
    async info(ref) {
      const call = await get(`/api/call-info/${encodeURIComponent(ref)}`);
      if (!call || typeof call !== "object") throw new Error("Superfone has not returned a call record yet.");
      const recording = typeof call.recording_url === "string" && call.recording_url.startsWith("https://") ? call.recording_url : null;
      const answer = Date.parse(call.answer_time ?? "");
      const end = Date.parse(call.end_time ?? "");
      const seconds = Number.isFinite(answer) && Number.isFinite(end) ? Math.max(0, Math.floor((end - answer) / 1000))
        : Number.isFinite(end) && !call.answer_time ? 0 : null;
      return { verified: Number.isFinite(Date.parse(call.start_time ?? "")), status: String(call.call_status ?? "Pending"), seconds, recording };
    },
  };
}

const adapters: Record<string, (config: ProviderConfig) => CallerProvider> = { superfone };

export function callerProvider(storeId: number): CallerProvider | null {
  const config = (JSON.parse(process.env.ORDER_CALL_PROVIDERS ?? "{}") as Record<string, ProviderConfig>)[String(storeId)];
  if (!config) return null;
  if (!Object.hasOwn(adapters, config.provider) || !config.apiKey || !config.agents) {
    throw new Error("This store's calling provider is not configured. Ask the store administrator.");
  }
  return adapters[config.provider](config);
}
