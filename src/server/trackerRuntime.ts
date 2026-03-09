import fs from "fs";
import path from "path";
import WebSocket from "ws";

type RawEvent = Record<string, unknown>;

export type NormalizedEvent = {
  seen_at_utc: string;
  event_time?: string | null;
  type?: string | null;
  side?: string | null;
  market?: string | null;
  market_slug?: string | null;
  outcome?: string | null;
  asset_id?: string | null;
  price?: number | null;
  size?: number | null;
  value_usd?: number | null;
  tx_hash?: string | null;
  log_index?: number | null;
  raw_source: "activity" | "trades" | "ws" | "webhook";
  source_stage?: "pending" | "mined" | "poll" | "webhook";
  pending_seen_at?: string | null;
  mined_seen_at?: string | null;
  decoded_at?: string | null;
  reconcile_status?: "pending_confirmed" | "mined_only" | "poll_only" | "webhook_ingested" | null;
};

export type WalletEventStats = {
  total: number;
  last24h: number;
  buyTodayUsd: number;
  sellTodayUsd: number;
};

type TrackerState = {
  seen_ids: string[];
  seen_queue: string[];
  last_check: string | null;
};

export type TrackerMonitorRecord = {
  id: string;
  kind: "event" | "order";
  created_at: string;
  wallet: string;
  source: "ws" | "poll" | "ui" | "webhook";
  tx_hash?: string | null;
  market?: string | null;
  market_slug?: string | null;
  outcome?: string | null;
  asset_id?: string | null;
  side?: string | null;
  price?: number | null;
  size?: number | null;
  value_usd?: number | null;
  status: string;
  final_status?: string | null;
  error?: string | null;
  detected_at?: string | null;
  order_posted_at?: string | null;
  detect_to_order_ms?: number | null;
  attempt_count?: number | null;
  order_kind?: string | null;
  order_type?: string | null;
  quantity_kind?: string | null;
  open_order_id?: string | null;
  cancelled_at?: string | null;
  webhook_received_at?: string | null;
  decoded_at?: string | null;
  request_id?: string | null;
  request_payload?: Record<string, unknown> | null;
  response_payload?: Record<string, unknown> | null;
  source_stage?: "pending" | "mined" | "poll" | "webhook" | null;
  pending_seen_at?: string | null;
  mined_seen_at?: string | null;
  reconcile_status?: "pending_confirmed" | "mined_only" | "poll_only" | "webhook_ingested" | null;
};

export type DetectedEventsBatch = {
  wallet: string;
  source: "ws" | "poll" | "webhook";
  events: NormalizedEvent[];
  isInitialSync: boolean;
};

type RuntimeStatus = {
  wsConnected: boolean;
  lastWsMessageAt: string | null;
  lastPendingMessageAt: string | null;
  lastEventDetectedAt: string | null;
  wsProvider: string | null;
  httpProvider: string | null;
};

type InternalRuntime = {
  address: string;
  state: TrackerState;
  active: boolean;
  timeout: NodeJS.Timeout | null;
  isSyncing: boolean;
  pendingImmediate: boolean;
  ws: WebSocket | null;
  wsReconnectTimer: NodeJS.Timeout | null;
  wsSubIds: {
    mined: string | null;
    pending: string | null;
    logs: Set<string>;
  };
  hasCompletedInitialSync: boolean;
  status: RuntimeStatus;
  knownAssetMeta: Map<string, { marketSlug?: string; market?: string; outcome?: string }>;
  txTimeline: Map<string, { pendingSeenAt?: string; minedSeenAt?: string; decodedAt?: string }>;
  inFlightReceiptTxs: Set<string>;
  wsProviderIndex: number;
  httpProviderIndex: number;
};

type TrackerRuntimeManagerOptions = {
  trackingRoot: string;
  pollIntervalMs: number;
  fetchTimeoutMs: number;
  maxRecentSeenIds: number;
  activityUrl: string;
  tradesUrl: string;
  alchemyApiKey?: string;
  alchemyWsUrl?: string;
  alchemyHttpUrl?: string;
  alchemyWsUrls?: string[];
  alchemyHttpUrls?: string[];
  enablePendingWs?: boolean;
  usdcAddress?: string;
  outcomeTokenContract?: string;
  usdcDecimals?: number;
  outcomeDecimals?: number;
  onEventsDetected?: (batch: DetectedEventsBatch) => void | Promise<void>;
};

export type TrackerWalletInfo = {
  address: string;
  eventCount: number;
  latestEvent: NormalizedEvent | null;
  lastCheck: string | null;
  isActive: boolean;
  storagePath: string;
  wsConnected: boolean;
  lastWsMessageAt: string | null;
  lastPendingMessageAt?: string | null;
  lastEventDetectedAt: string | null;
  wsProvider?: string | null;
  httpProvider?: string | null;
};

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const TRANSFER_SINGLE_TOPIC = "0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62";
const DEFAULT_USDC = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174".toLowerCase();
const DEFAULT_CTF = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045".toLowerCase();
const DEFAULT_MONITOR_LIMIT = 200;

const utcNowIso = () => new Date().toISOString();
const normalizeWallet = (address: string) => address.trim().toLowerCase();

const toFloat = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const toTimestampMs = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;

  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1e12 ? value : value * 1000;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;

    if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
      const numeric = Number(trimmed);
      if (!Number.isFinite(numeric)) return null;
      return numeric > 1e12 ? numeric : numeric * 1000;
    }

    const parsed = new Date(trimmed).getTime();
    return Number.isNaN(parsed) ? null : parsed;
  }

  return null;
};

const maybeJson = (value: unknown): unknown => {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value) || typeof value === "object") return value;
  if (typeof value !== "string") return value;

  const trimmed = value.trim();
  if (!trimmed) return value;
  if (!((trimmed.startsWith("[") && trimmed.endsWith("]")) || (trimmed.startsWith("{") && trimmed.endsWith("}")))) {
    return value;
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
};

const percentile = (values: number[], p: number): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[rank] ?? null;
};

const normalizeWsProvider = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "ws:" || parsed.protocol === "wss:") return parsed.toString();
    if (parsed.protocol === "http:") {
      parsed.protocol = "ws:";
      return parsed.toString();
    }
    if (parsed.protocol === "https:") {
      parsed.protocol = "wss:";
      return parsed.toString();
    }
    return "";
  } catch {
    return "";
  }
};

const normalizeHttpProvider = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return parsed.toString();
    if (parsed.protocol === "ws:") {
      parsed.protocol = "http:";
      return parsed.toString();
    }
    if (parsed.protocol === "wss:") {
      parsed.protocol = "https:";
      return parsed.toString();
    }
    return "";
  } catch {
    return "";
  }
};

export const createTrackerRuntimeManager = (options: TrackerRuntimeManagerOptions) => {
  const runtimes = new Map<string, InternalRuntime>();
  const trackingRoot = options.trackingRoot;
  const pollIntervalMs = Math.max(250, options.pollIntervalMs);
  const fetchTimeoutMs = Math.max(500, options.fetchTimeoutMs);
  const maxRecentSeenIds = Math.max(200, options.maxRecentSeenIds);
  const alchemyKey = (options.alchemyApiKey ?? "").trim();
  const keyAlchemyWsUrl = (alchemyKey ? `wss://polygon-mainnet.g.alchemy.com/v2/${alchemyKey}` : "").trim();
  const keyAlchemyHttpUrl = (alchemyKey ? `https://polygon-mainnet.g.alchemy.com/v2/${alchemyKey}` : "").trim();
  const configuredAlchemyWsUrl = (options.alchemyWsUrl ?? "").trim();
  const configuredAlchemyHttpUrl = (options.alchemyHttpUrl ?? "").trim();
  const uniqNonEmpty = (values: Array<string | null | undefined>) => {
    const seen = new Set<string>();
    const output: string[] = [];
    for (const value of values) {
      const trimmed = (value ?? "").trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      output.push(trimmed);
    }
    return output;
  };
  const wsProviders = uniqNonEmpty([
    ...(options.alchemyWsUrls ?? []),
    configuredAlchemyWsUrl,
    keyAlchemyWsUrl,
  ].map(normalizeWsProvider));
  const httpProviders = uniqNonEmpty([
    ...(options.alchemyHttpUrls ?? []),
    configuredAlchemyHttpUrl,
    keyAlchemyHttpUrl,
  ].map(normalizeHttpProvider));
  const enablePendingWs = options.enablePendingWs !== false;
  const usdcAddress = (options.usdcAddress ?? DEFAULT_USDC).toLowerCase();
  const outcomeTokenContract = (options.outcomeTokenContract ?? DEFAULT_CTF).toLowerCase();
  const usdcDecimals = Number.isFinite(options.usdcDecimals) ? Number(options.usdcDecimals) : 6;
  const outcomeDecimals = Number.isFinite(options.outcomeDecimals) ? Number(options.outcomeDecimals) : 6;
  const onEventsDetected = options.onEventsDetected;

  const walletDir = (address: string) => path.join(trackingRoot, normalizeWallet(address));
  const stateFile = (address: string) => path.join(walletDir(address), "state.json");
  const eventsFile = (address: string) => path.join(walletDir(address), "events.ndjson");
  const monitorFile = (address: string) => path.join(walletDir(address), "monitor.ndjson");
  const errorsFile = (address: string) => path.join(walletDir(address), "errors.log");

  const ensureWalletDir = (address: string) => {
    fs.mkdirSync(walletDir(address), { recursive: true });
  };

  const appendError = (address: string, message: string) => {
    fs.appendFileSync(errorsFile(address), `[${utcNowIso()}] ${message}\n`, "utf-8");
  };

  const readState = (address: string): TrackerState => {
    try {
      const content = fs.readFileSync(stateFile(address), "utf-8");
      const parsed = JSON.parse(content) as Partial<TrackerState>;
      return {
        seen_ids: Array.isArray(parsed.seen_ids) ? parsed.seen_ids : [],
        seen_queue: Array.isArray(parsed.seen_queue) ? parsed.seen_queue : [],
        last_check: typeof parsed.last_check === "string" ? parsed.last_check : null,
      };
    } catch {
      return { seen_ids: [], seen_queue: [], last_check: null };
    }
  };

  const writeState = (address: string, state: TrackerState) => {
    fs.writeFileSync(stateFile(address), JSON.stringify(state, null, 2), "utf-8");
  };

  const readNdjson = <T>(targetFile: string, limit?: number): T[] => {
    try {
      const lines = fs.readFileSync(targetFile, "utf-8").split("\n").filter(Boolean);
      const bounded = typeof limit === "number" && Number.isFinite(limit) && limit > 0
        ? lines.slice(-Math.floor(limit))
        : lines;
      return bounded.map((line) => JSON.parse(line) as T);
    } catch {
      return [];
    }
  };

  const appendNdjson = (targetFile: string, rows: unknown[]) => {
    if (rows.length === 0) return;
    const payload = rows.map((row) => JSON.stringify(row)).join("\n");
    fs.appendFileSync(targetFile, `${payload}\n`, "utf-8");
  };

  const readEvents = (address: string, limit?: number): NormalizedEvent[] => readNdjson<NormalizedEvent>(eventsFile(address), limit);
  const readMonitor = (address: string, limit?: number): TrackerMonitorRecord[] => readNdjson<TrackerMonitorRecord>(monitorFile(address), limit);

  const appendEvents = (address: string, events: NormalizedEvent[]) => appendNdjson(eventsFile(address), events);

  const appendMonitor = (address: string, entries: TrackerMonitorRecord[]) => {
    appendNdjson(monitorFile(address), entries);
  };

  const clearOrderHistory = (address: string) => {
    const normalizedAddress = normalizeWallet(address);
    ensureWalletDir(normalizedAddress);
    const rows = readMonitor(normalizedAddress);
    const keptRows = rows.filter((row) => row.kind !== "order");
    const removed = Math.max(0, rows.length - keptRows.length);
    const payload = keptRows.length > 0 ? `${keptRows.map((row) => JSON.stringify(row)).join("\n")}\n` : "";
    fs.writeFileSync(monitorFile(normalizedAddress), payload, "utf-8");
    return {
      address: normalizedAddress,
      total: rows.length,
      removed,
      kept: keptRows.length,
    };
  };

  const dedupeKeyFromEvent = (event: Partial<NormalizedEvent>) => {
    const txHash = (event.tx_hash ?? "").toString().toLowerCase();
    const assetId = (event.asset_id ?? "").toString();
    const side = (event.side ?? "").toString().toUpperCase();
    if (txHash) return `${txHash}:${assetId}:${side}`;
    const eventTime = event.event_time ?? event.seen_at_utc ?? "";
    const market = event.market_slug ?? event.market ?? "";
    return `fallback:${String(eventTime)}:${String(market)}:${assetId}:${side}`;
  };

  const normalizeEvent = (raw: RawEvent, source: "activity" | "trades"): NormalizedEvent => {
    const price = toFloat(raw.price ?? raw.avgPrice);
    const size = toFloat(raw.size ?? raw.amount ?? raw.shares);
    const valueFromEvent = toFloat(raw.value ?? raw.valueUSD ?? raw.usdcSize ?? raw.usdc_size);
    const normalizedEventTime = toTimestampMs(raw.timestamp ?? raw.createdAt ?? raw.time ?? raw.eventTime);
    const logIndexRaw = toFloat(raw.logIndex ?? raw.log_index);
    const logIndex = logIndexRaw === null ? null : Math.trunc(logIndexRaw);

    return {
      seen_at_utc: utcNowIso(),
      event_time: normalizedEventTime === null ? null : new Date(normalizedEventTime).toISOString(),
      type: (raw.type ?? raw.eventType ?? (source === "trades" ? "TRADE" : null)) as string | null,
      side: (raw.side ?? raw.action ?? null) as string | null,
      market: (raw.question ?? raw.slug ?? raw.market ?? raw.marketId ?? null) as string | null,
      market_slug: (raw.slug ?? raw.marketSlug ?? raw.market_slug ?? null) as string | null,
      outcome: (raw.outcome ?? raw.outcomeName ?? raw.token ?? null) as string | null,
      asset_id: (raw.asset_id ?? raw.assetId ?? raw.asset ?? raw.tokenId ?? raw.token_id ?? null) as string | null,
      price,
      size,
      value_usd: valueFromEvent ?? (price !== null && size !== null ? Number((price * size).toFixed(6)) : null),
      tx_hash: (raw.transactionHash ?? raw.txHash ?? raw.hash ?? null) as string | null,
      log_index: Number.isFinite(logIndex) ? logIndex : null,
      raw_source: source,
      source_stage: "poll",
      pending_seen_at: null,
      mined_seen_at: null,
      decoded_at: null,
      reconcile_status: "poll_only",
    };
  };

  const generateEventId = (raw: RawEvent, source: "activity" | "trades") => {
    const txHash = (raw.transactionHash ?? raw.txHash ?? raw.hash) ? String(raw.transactionHash ?? raw.txHash ?? raw.hash).toLowerCase() : "";
    const side = String(raw.side ?? raw.action ?? "").toUpperCase();
    const assetId = String(raw.asset_id ?? raw.assetId ?? raw.asset ?? raw.tokenId ?? raw.token_id ?? "");
    if (txHash) return `${txHash}:${assetId}:${side}`;
    const eventTime = raw.timestamp ?? raw.createdAt ?? raw.time ?? raw.eventTime;
    const market = raw.question ?? raw.slug ?? raw.market ?? raw.marketId;
    return `${source}:${String(eventTime)}|${String(market)}|${String(side)}|${String(assetId)}`;
  };

  const computeEventStats = (events: NormalizedEvent[]): WalletEventStats => {
    const now = Date.now();
    const last24HoursMs = 24 * 60 * 60 * 1000;
    let last24h = 0;
    let buyTodayUsd = 0;
    let sellTodayUsd = 0;

    for (const event of events) {
      const eventTime = toTimestampMs(event.event_time) ?? toTimestampMs(event.seen_at_utc);
      if (eventTime === null || now - eventTime > last24HoursMs) continue;

      last24h += 1;
      const value = event.value_usd ?? 0;
      const side = (event.side ?? "").toUpperCase();
      if (side === "BUY") buyTodayUsd += value;
      if (side === "SELL") sellTodayUsd += value;
    }

    return {
      total: events.length,
      last24h,
      buyTodayUsd,
      sellTodayUsd,
    };
  };

  const rpcRequest = async (
    method: string,
    params: unknown[],
    runtime?: InternalRuntime,
  ): Promise<unknown> => {
    if (!httpProviders.length) return null;
    const startIndex = runtime ? runtime.httpProviderIndex : 0;
    const providerCount = httpProviders.length;

    for (let offset = 0; offset < providerCount; offset += 1) {
      const idx = (startIndex + offset) % providerCount;
      const rpcUrl = httpProviders[idx];
      try {
        const response = await fetch(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: Date.now(),
            method,
            params,
          }),
        });
        if (!response.ok) continue;
        const payload = await response.json() as { result?: unknown };
        if (runtime) {
          runtime.httpProviderIndex = idx;
          runtime.status.httpProvider = rpcUrl;
        }
        return payload.result ?? null;
      } catch {
        // try next provider
      }
    }
    return null;
  };

  const fromHexTopicAddress = (topic: string): string => {
    const clean = topic.startsWith("0x") ? topic.slice(2) : topic;
    return `0x${clean.slice(24).toLowerCase()}`;
  };

  const toTopicAddress = (address: string): string => {
    const clean = address.toLowerCase().replace(/^0x/, "");
    return `0x${clean.padStart(64, "0")}`;
  };

  const parseHex = (hexLike: string | null | undefined): bigint => {
    if (!hexLike) return 0n;
    const clean = hexLike.startsWith("0x") ? hexLike : `0x${hexLike}`;
    try {
      return BigInt(clean);
    } catch {
      return 0n;
    }
  };

  const decodeWsEventsFromReceipt = (
    runtime: Pick<InternalRuntime, "address" | "knownAssetMeta">,
    receipt: Record<string, unknown>,
    txHash: string,
    source: "ws" | "webhook" = "ws",
    seenAtIso?: string,
  ): NormalizedEvent[] => {
    const logs = Array.isArray(receipt.logs) ? receipt.logs as Array<Record<string, unknown>> : [];
    const wallet = runtime.address;

    const usdcTransfers: Array<{ from: string; to: string; amountRaw: bigint }> = [];
    const outcomeTransfers: Array<{ assetId: string; amountRaw: bigint; side: "BUY" | "SELL"; logIndex: number }> = [];

    for (const log of logs) {
      const topics = Array.isArray(log.topics) ? (log.topics as string[]) : [];
      const address = typeof log.address === "string" ? log.address.toLowerCase() : "";
      if (!topics.length || !address) continue;

      const topic0 = topics[0]?.toLowerCase() ?? "";
      if (topic0 === TRANSFER_TOPIC && address === usdcAddress && topics.length >= 3) {
        const from = fromHexTopicAddress(topics[1] ?? "");
        const to = fromHexTopicAddress(topics[2] ?? "");
        if (from !== wallet && to !== wallet) continue;
        usdcTransfers.push({
          from,
          to,
          amountRaw: parseHex(typeof log.data === "string" ? log.data : ""),
        });
      }

      if (topic0 === TRANSFER_SINGLE_TOPIC && address === outcomeTokenContract && topics.length >= 4) {
        const from = fromHexTopicAddress(topics[2] ?? "");
        const to = fromHexTopicAddress(topics[3] ?? "");
        if (from !== wallet && to !== wallet) continue;
        const data = typeof log.data === "string" ? log.data.replace(/^0x/, "") : "";
        if (data.length < 128) continue;
        const idHex = data.slice(0, 64);
        const valueHex = data.slice(64, 128);
        const assetId = parseHex(idHex).toString();
        const amountRaw = parseHex(valueHex);
        const logIndexRaw = toFloat(log.logIndex);
        const logIndex = logIndexRaw === null ? 0 : Math.trunc(logIndexRaw);

        if (amountRaw <= 0n) continue;
        outcomeTransfers.push({
          assetId,
          amountRaw,
          side: to === wallet ? "BUY" : "SELL",
          logIndex,
        });
      }
    }

    if (!outcomeTransfers.length) return [];

    const usdcOutRaw = usdcTransfers
      .filter((row) => row.from === wallet)
      .reduce((sum, row) => sum + row.amountRaw, 0n);
    const usdcInRaw = usdcTransfers
      .filter((row) => row.to === wallet)
      .reduce((sum, row) => sum + row.amountRaw, 0n);

    const totalOutcomeRawBySide = {
      BUY: outcomeTransfers.filter((row) => row.side === "BUY").reduce((sum, row) => sum + row.amountRaw, 0n),
      SELL: outcomeTransfers.filter((row) => row.side === "SELL").reduce((sum, row) => sum + row.amountRaw, 0n),
    };

    const nowIso = seenAtIso || utcNowIso();
    const events: NormalizedEvent[] = [];

    for (const transfer of outcomeTransfers) {
      const assetMeta = runtime.knownAssetMeta.get(transfer.assetId);
      const size = Number(transfer.amountRaw) / Math.pow(10, outcomeDecimals);
      if (!Number.isFinite(size) || size <= 0) continue;

      const sideUsdcRaw = transfer.side === "BUY" ? usdcOutRaw : usdcInRaw;
      const sideOutcomeRaw = totalOutcomeRawBySide[transfer.side];
      const ratio = sideOutcomeRaw > 0n ? Number(transfer.amountRaw) / Number(sideOutcomeRaw) : 1;
      const valueUsd = (Number(sideUsdcRaw) / Math.pow(10, usdcDecimals)) * ratio;
      const price = size > 0 ? valueUsd / size : 0;

      events.push({
        seen_at_utc: nowIso,
        event_time: null,
        type: "TRADE",
        side: transfer.side,
        market: assetMeta?.market ?? null,
        market_slug: assetMeta?.marketSlug ?? null,
        outcome: assetMeta?.outcome ?? null,
        asset_id: transfer.assetId,
        price: Number.isFinite(price) && price > 0 ? Number(price.toFixed(6)) : null,
        size: Number.isFinite(size) ? Number(size.toFixed(6)) : null,
        value_usd: Number.isFinite(valueUsd) && valueUsd > 0 ? Number(valueUsd.toFixed(6)) : null,
        tx_hash: txHash,
        log_index: transfer.logIndex,
        raw_source: source,
        source_stage: source === "webhook" ? "webhook" : "mined",
        pending_seen_at: null,
        mined_seen_at: nowIso,
        decoded_at: utcNowIso(),
        reconcile_status: source === "webhook" ? "webhook_ingested" : "mined_only",
      });
    }

    return events;
  };

  const fetchEndpoint = async (url: string, address: string): Promise<RawEvent[]> => {
    const requestTs = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), fetchTimeoutMs);
    let response: Response;

    try {
      response = await fetch(`${url}?user=${address}&limit=50&offset=0&_=${requestTs}`, {
        cache: "no-store",
        headers: {
          "cache-control": "no-cache",
          pragma: "no-cache",
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
    const payload = await response.json();
    if (Array.isArray(payload)) return payload as RawEvent[];
    if (payload && typeof payload === "object") {
      const keys = ["data", "activities", "trades", "activity"] as const;
      for (const key of keys) {
        const candidate = (payload as Record<string, unknown>)[key];
        if (Array.isArray(candidate)) return candidate as RawEvent[];
      }
    }
    return [];
  };

  const updateAssetCache = (runtime: InternalRuntime, events: NormalizedEvent[]) => {
    for (const event of events) {
      const assetId = (event.asset_id ?? "").trim();
      if (!assetId) continue;
      const marketSlug = event.market_slug ?? undefined;
      const market = event.market ?? undefined;
      const outcome = event.outcome ?? undefined;
      if (!marketSlug && !market && !outcome) continue;
      runtime.knownAssetMeta.set(assetId, { marketSlug, market, outcome });
    }
  };

  const appendDetectedEvents = (
    runtime: InternalRuntime,
    events: NormalizedEvent[],
    source: "ws" | "poll" | "webhook",
    isInitialSync = false,
  ) => {
    if (!events.length) return;
    appendEvents(runtime.address, events);
    runtime.status.lastEventDetectedAt = utcNowIso();
    updateAssetCache(runtime, events);

    const monitorRows: TrackerMonitorRecord[] = events.map((event) => ({
      id: dedupeKeyFromEvent(event),
      kind: "event",
      created_at: utcNowIso(),
      wallet: runtime.address,
      source,
      tx_hash: event.tx_hash ?? null,
      market: event.market ?? null,
      market_slug: event.market_slug ?? null,
      outcome: event.outcome ?? null,
      asset_id: event.asset_id ?? null,
      side: event.side ?? null,
      price: event.price ?? null,
      size: event.size ?? null,
      status: "detected",
      error: null,
      detected_at: event.seen_at_utc,
      request_payload: null,
      response_payload: null,
      source_stage: event.source_stage ?? (source === "poll" ? "poll" : source === "webhook" ? "webhook" : "mined"),
      pending_seen_at: event.pending_seen_at ?? null,
      mined_seen_at: event.mined_seen_at ?? null,
      reconcile_status: event.reconcile_status ?? null,
    }));
    appendMonitor(runtime.address, monitorRows);

    if (onEventsDetected) {
      Promise.resolve(onEventsDetected({
        wallet: runtime.address,
        source,
        events: [...events],
        isInitialSync,
      })).catch((error) => {
        appendError(runtime.address, `onEventsDetected error: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
  };

  const schedulePoll = (runtime: InternalRuntime, delayMs: number) => {
    if (!runtime.active) return;
    if (runtime.timeout) clearTimeout(runtime.timeout);
    runtime.timeout = setTimeout(() => {
      void runSyncCycle(runtime);
    }, Math.max(0, delayMs));
  };

  const runSyncCycle = async (runtime: InternalRuntime) => {
    if (!runtime.active) return;
    if (runtime.isSyncing) {
      runtime.pendingImmediate = true;
      return;
    }
    runtime.isSyncing = true;
    if (runtime.timeout) {
      clearTimeout(runtime.timeout);
      runtime.timeout = null;
    }
    const startedAt = Date.now();
    const isInitialSync = !runtime.hasCompletedInitialSync;
    let markInitialSyncComplete = false;
    const seenIds = new Set(runtime.state.seen_ids);
    const seenQueue = [...runtime.state.seen_queue];

    try {
      const [activityResult, tradesResult] = await Promise.allSettled([
        fetchEndpoint(options.activityUrl, runtime.address),
        fetchEndpoint(options.tradesUrl, runtime.address),
      ]);

      const activity = activityResult.status === "fulfilled" ? activityResult.value : [];
      const trades = tradesResult.status === "fulfilled" ? tradesResult.value : [];

      if (activityResult.status === "rejected" && tradesResult.status === "rejected") {
        const a = activityResult.reason instanceof Error ? activityResult.reason.message : String(activityResult.reason);
        const t = tradesResult.reason instanceof Error ? tradesResult.reason.message : String(tradesResult.reason);
        throw new Error(`activity=${a}; trades=${t}`);
      }

      const newEvents: NormalizedEvent[] = [];
      for (const [payload, source] of [
        [activity, "activity" as const],
        [trades, "trades" as const],
      ]) {
        for (const item of payload) {
          const rawId = generateEventId(item, source);
          if (seenIds.has(rawId)) continue;
          seenIds.add(rawId);
          seenQueue.push(rawId);
          while (seenQueue.length > maxRecentSeenIds) {
            const oldest = seenQueue.shift();
            if (oldest) seenIds.delete(oldest);
          }
          newEvents.push(normalizeEvent(item, source));
        }
      }

      if (newEvents.length > 0) {
        appendDetectedEvents(runtime, newEvents, "poll", isInitialSync);
      }

      const elapsedMs = Date.now() - startedAt;
      console.log(
        `[poll-cycle] wallet=${runtime.address} activity=${activity.length} trades=${trades.length} new=${newEvents.length} duration_ms=${elapsedMs}`,
      );

      runtime.state.seen_ids = [...seenIds];
      runtime.state.seen_queue = seenQueue;
      runtime.state.last_check = utcNowIso();
      writeState(runtime.address, runtime.state);
      markInitialSyncComplete = true;
    } catch (error) {
      appendError(runtime.address, error instanceof Error ? error.message : "Unknown polling error");
    } finally {
      if (markInitialSyncComplete) {
        runtime.hasCompletedInitialSync = true;
      }
      runtime.isSyncing = false;
      if (runtime.active) {
        if (runtime.pendingImmediate) {
          runtime.pendingImmediate = false;
          queueMicrotask(() => {
            void runSyncCycle(runtime);
          });
        } else {
          const elapsedMs = Date.now() - startedAt;
          schedulePoll(runtime, Math.max(0, pollIntervalMs - elapsedMs));
        }
      }
    }
  };

  const upsertTxTimeline = (
    runtime: InternalRuntime,
    txHash: string,
    updates: { pendingSeenAt?: string; minedSeenAt?: string; decodedAt?: string },
  ) => {
    const key = txHash.trim().toLowerCase();
    if (!key) return;
    const current = runtime.txTimeline.get(key) ?? {};
    const next = {
      pendingSeenAt: updates.pendingSeenAt ?? current.pendingSeenAt,
      minedSeenAt: updates.minedSeenAt ?? current.minedSeenAt,
      decodedAt: updates.decodedAt ?? current.decodedAt,
    };
    runtime.txTimeline.set(key, next);
  };

  const ingestDecodedEvents = (
    runtime: InternalRuntime,
    decodedEvents: NormalizedEvent[],
  ) => {
    if (!decodedEvents.length) return 0;
    const seenIds = new Set(runtime.state.seen_ids);
    const seenQueue = [...runtime.state.seen_queue];
    const unique: NormalizedEvent[] = [];
    for (const event of decodedEvents) {
      const key = dedupeKeyFromEvent(event);
      if (seenIds.has(key)) continue;
      seenIds.add(key);
      seenQueue.push(key);
      while (seenQueue.length > maxRecentSeenIds) {
        const oldest = seenQueue.shift();
        if (oldest) seenIds.delete(oldest);
      }
      unique.push(event);
    }
    if (unique.length) {
      appendDetectedEvents(runtime, unique, "ws", false);
      runtime.state.seen_ids = [...seenIds];
      runtime.state.seen_queue = seenQueue;
      runtime.state.last_check = utcNowIso();
      writeState(runtime.address, runtime.state);
    }
    return unique.length;
  };

  const handleWsMinedTxHash = async (
    runtime: InternalRuntime,
    txHashRaw: unknown,
    seenAtIso?: string,
  ) => {
    const txHash = typeof txHashRaw === "string" ? txHashRaw.trim().toLowerCase() : "";
    if (!txHash) return;
    if (runtime.inFlightReceiptTxs.has(txHash)) return;
    const minedSeenAt = seenAtIso || utcNowIso();
    upsertTxTimeline(runtime, txHash, { minedSeenAt });
    runtime.inFlightReceiptTxs.add(txHash);

    try {
      const receiptRaw = await rpcRequest("eth_getTransactionReceipt", [txHash], runtime);
      if (!receiptRaw || typeof receiptRaw !== "object") {
        void runSyncCycle(runtime);
        return;
      }

      const decodedAt = utcNowIso();
      upsertTxTimeline(runtime, txHash, { decodedAt });
      const receipt = receiptRaw as Record<string, unknown>;
      const decoded = decodeWsEventsFromReceipt(runtime, receipt, txHash, "ws", decodedAt)
        .map((event) => {
          const timeline = runtime.txTimeline.get(txHash);
          const pendingSeenAt = timeline?.pendingSeenAt ?? null;
          return {
            ...event,
            seen_at_utc: decodedAt,
            source_stage: "mined" as const,
            mined_seen_at: minedSeenAt,
            pending_seen_at: pendingSeenAt,
            decoded_at: decodedAt,
            reconcile_status: pendingSeenAt ? "pending_confirmed" : "mined_only",
          };
        });

      if (ingestDecodedEvents(runtime, decoded) === 0) {
        void runSyncCycle(runtime);
      }
    } catch (error) {
      appendError(runtime.address, `ws decode error: ${error instanceof Error ? error.message : String(error)}`);
      void runSyncCycle(runtime);
    } finally {
      runtime.inFlightReceiptTxs.delete(txHash);
    }
  };

  const handleWsPendingTxHash = async (
    runtime: InternalRuntime,
    txHashRaw: unknown,
    seenAtIso?: string,
  ) => {
    if (!enablePendingWs) return;
    const txHash = typeof txHashRaw === "string" ? txHashRaw.trim().toLowerCase() : "";
    if (!txHash) return;
    const pendingSeenAt = seenAtIso || utcNowIso();
    runtime.status.lastPendingMessageAt = pendingSeenAt;
    upsertTxTimeline(runtime, txHash, { pendingSeenAt });

    // Fast path: if tx is already mined by the time pending message arrives, decode immediately.
    try {
      const receiptRaw = await rpcRequest("eth_getTransactionReceipt", [txHash], runtime);
      if (receiptRaw && typeof receiptRaw === "object") {
        await handleWsMinedTxHash(runtime, txHash, utcNowIso());
      }
    } catch {
      // no-op: mined stream or polling fallback will catch it
    }
  };

  const connectWs = (runtime: InternalRuntime) => {
    if (!wsProviders.length || !runtime.active) return;
    const wsUrl = wsProviders[runtime.wsProviderIndex % wsProviders.length] ?? wsProviders[0];
    if (!wsUrl) return;

    if (runtime.ws) {
      try {
        runtime.ws.close();
      } catch {
        // noop
      }
    }

    const ws = new WebSocket(wsUrl);
    runtime.ws = ws;

    ws.on("open", () => {
      runtime.status.wsConnected = true;
      runtime.status.lastWsMessageAt = utcNowIso();
      runtime.status.wsProvider = wsUrl;
      const walletTopic = toTopicAddress(runtime.address);
      const logPayloads = [
        {
          id: 3,
          payload: {
            jsonrpc: "2.0",
            id: 3,
            method: "eth_subscribe",
            params: ["logs", { address: usdcAddress, topics: [TRANSFER_TOPIC, walletTopic] }],
          },
        },
        {
          id: 4,
          payload: {
            jsonrpc: "2.0",
            id: 4,
            method: "eth_subscribe",
            params: ["logs", { address: usdcAddress, topics: [TRANSFER_TOPIC, null, walletTopic] }],
          },
        },
        {
          id: 5,
          payload: {
            jsonrpc: "2.0",
            id: 5,
            method: "eth_subscribe",
            params: ["logs", { address: outcomeTokenContract, topics: [TRANSFER_SINGLE_TOPIC, null, walletTopic] }],
          },
        },
        {
          id: 6,
          payload: {
            jsonrpc: "2.0",
            id: 6,
            method: "eth_subscribe",
            params: ["logs", { address: outcomeTokenContract, topics: [TRANSFER_SINGLE_TOPIC, null, null, walletTopic] }],
          },
        },
      ] as const;
      for (const item of logPayloads) {
        ws.send(JSON.stringify(item.payload));
      }
    });

    ws.on("message", (message) => {
      runtime.status.lastWsMessageAt = utcNowIso();
      let parsed: Record<string, unknown> | null = null;
      try {
        parsed = JSON.parse(typeof message === "string" ? message : message.toString("utf-8")) as Record<string, unknown>;
      } catch {
        return;
      }
      if (!parsed) return;
      if (parsed.error) {
        appendError(runtime.address, `ws provider error: ${JSON.stringify(parsed.error)}`);
        return;
      }

      if (typeof parsed.result === "string" && typeof parsed.id === "number") {
        if (parsed.id >= 3 && parsed.id <= 6) runtime.wsSubIds.logs.add(parsed.result);
        return;
      }

      const params = parsed.params as Record<string, unknown> | undefined;
      if (!params || typeof params !== "object") return;
      const result = params.result;
      if (!result) return;
      const subscription = typeof params.subscription === "string" ? params.subscription : "";

      let txHash: unknown = null;
      if (typeof result === "string") {
        txHash = result;
      } else if (result && typeof result === "object") {
        const txObj = (result as Record<string, unknown>).transaction;
        if (txObj && typeof txObj === "object") {
          txHash = (txObj as Record<string, unknown>).hash;
        } else {
          const resultObj = result as Record<string, unknown>;
          txHash = resultObj.hash ?? resultObj.transactionHash;
        }
      }
      if (subscription && runtime.wsSubIds.pending && subscription === runtime.wsSubIds.pending) {
        void handleWsPendingTxHash(runtime, txHash, utcNowIso());
        return;
      }
      if (subscription && runtime.wsSubIds.logs.has(subscription)) {
        void handleWsMinedTxHash(runtime, txHash, utcNowIso());
        return;
      }
      void handleWsMinedTxHash(runtime, txHash, utcNowIso());
    });

    ws.on("error", (error) => {
      runtime.status.wsConnected = false;
      appendError(runtime.address, `ws error: ${error instanceof Error ? error.message : String(error)}`);
    });

    ws.on("close", (code, reason) => {
      runtime.status.wsConnected = false;
      runtime.wsSubIds.mined = null;
      runtime.wsSubIds.pending = null;
      runtime.wsSubIds.logs.clear();
      const reasonText = typeof reason === "string" ? reason : Buffer.isBuffer(reason) ? reason.toString("utf-8") : "";
      appendError(runtime.address, `ws close: code=${code}${reasonText ? ` reason=${reasonText}` : ""}`);
      if (!runtime.active) return;
      if (runtime.wsReconnectTimer) clearTimeout(runtime.wsReconnectTimer);
      if (wsProviders.length > 0) {
        runtime.wsProviderIndex = (runtime.wsProviderIndex + 1) % wsProviders.length;
      }
      runtime.wsReconnectTimer = setTimeout(() => {
        connectWs(runtime);
      }, 2000);
    });
  };

  const startTracker = (address: string) => {
    const normalizedAddress = normalizeWallet(address);
    if (!normalizedAddress) return;
    if (runtimes.has(normalizedAddress)) return;

    ensureWalletDir(normalizedAddress);
    const state = readState(normalizedAddress);

    const runtime: InternalRuntime = {
      address: normalizedAddress,
      state,
      active: true,
      timeout: null,
      isSyncing: false,
      pendingImmediate: false,
      ws: null,
      wsReconnectTimer: null,
      wsSubIds: { mined: null, pending: null, logs: new Set<string>() },
      hasCompletedInitialSync: state.seen_ids.length > 0,
      status: {
        wsConnected: false,
        lastWsMessageAt: null,
        lastPendingMessageAt: null,
        lastEventDetectedAt: null,
        wsProvider: wsProviders[0] ?? null,
        httpProvider: httpProviders[0] ?? null,
      },
      knownAssetMeta: new Map<string, { marketSlug?: string; market?: string; outcome?: string }>(),
      txTimeline: new Map<string, { pendingSeenAt?: string; minedSeenAt?: string; decodedAt?: string }>(),
      inFlightReceiptTxs: new Set<string>(),
      wsProviderIndex: 0,
      httpProviderIndex: 0,
    };

    // hydrate cache from recent history
    const recentEvents = readEvents(normalizedAddress, 500);
    updateAssetCache(runtime, recentEvents);

    runtimes.set(normalizedAddress, runtime);
    void runSyncCycle(runtime);
    connectWs(runtime);
  };

  const stopTracker = (address: string) => {
    const normalizedAddress = normalizeWallet(address);
    const runtime = runtimes.get(normalizedAddress);
    if (!runtime) return;
    runtime.active = false;
    if (runtime.timeout) clearTimeout(runtime.timeout);
    runtime.timeout = null;
    if (runtime.wsReconnectTimer) clearTimeout(runtime.wsReconnectTimer);
    runtime.wsReconnectTimer = null;
    if (runtime.ws) {
      try {
        runtime.ws.close();
      } catch {
        // noop
      }
      runtime.ws = null;
    }
    runtimes.delete(normalizedAddress);
  };

  const removeTrackerData = (address: string) => {
    const normalizedAddress = normalizeWallet(address);
    stopTracker(normalizedAddress);
    fs.rmSync(walletDir(normalizedAddress), { recursive: true, force: true });
  };

  const listWallets = (): TrackerWalletInfo[] => fs
    .readdirSync(trackingRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const address = entry.name;
      const events = readEvents(address);
      const state = readState(address);
      const runtime = runtimes.get(address);
      return {
        address,
        eventCount: events.length,
        latestEvent: events.at(-1) ?? null,
        lastCheck: state.last_check,
        isActive: runtimes.has(address),
        storagePath: walletDir(address),
        wsConnected: runtime?.status.wsConnected ?? false,
        lastWsMessageAt: runtime?.status.lastWsMessageAt ?? null,
        lastPendingMessageAt: runtime?.status.lastPendingMessageAt ?? null,
        lastEventDetectedAt: runtime?.status.lastEventDetectedAt ?? null,
        wsProvider: runtime?.status.wsProvider ?? null,
        httpProvider: runtime?.status.httpProvider ?? null,
      };
    });

  const getMonitorSummary = () => {
    const runtimeStatuses = Array.from(runtimes.entries()).map(([address, runtime]) => ({
      address,
      wsConnected: runtime.status.wsConnected,
      lastWsMessageAt: runtime.status.lastWsMessageAt,
      lastPendingMessageAt: runtime.status.lastPendingMessageAt,
      lastEventDetectedAt: runtime.status.lastEventDetectedAt,
      lastCheck: runtime.state.last_check,
      wsProvider: runtime.status.wsProvider,
      httpProvider: runtime.status.httpProvider,
    }));

    const latencies: number[] = [];
    for (const row of listWallets()) {
      const monitorRows = readMonitor(row.address, DEFAULT_MONITOR_LIMIT);
      for (const monitorRow of monitorRows) {
        if (typeof monitorRow.detect_to_order_ms === "number" && Number.isFinite(monitorRow.detect_to_order_ms)) {
          latencies.push(monitorRow.detect_to_order_ms);
        }
      }
    }

    return {
      generatedAt: utcNowIso(),
      activeRuntimeCount: runtimes.size,
      wsConnectedCount: runtimeStatuses.filter((item) => item.wsConnected).length,
      p95DetectToOrderMs: percentile(latencies, 95),
      samples: latencies.length,
      wsProviders: wsProviders,
      httpProviders: httpProviders,
      runtimes: runtimeStatuses,
    };
  };

  fs.mkdirSync(trackingRoot, { recursive: true });

  const triggerImmediateRefresh = (address: string) => {
    const normalizedAddress = normalizeWallet(address);
    const runtime = runtimes.get(normalizedAddress);
    if (!runtime || !runtime.active) {
      return { address: normalizedAddress, triggered: false, pending: false };
    }
    if (runtime.isSyncing) {
      runtime.pendingImmediate = true;
      return { address: normalizedAddress, triggered: false, pending: true };
    }
    if (runtime.timeout) {
      clearTimeout(runtime.timeout);
      runtime.timeout = null;
    }
    queueMicrotask(() => {
      void runSyncCycle(runtime);
    });
    return { address: normalizedAddress, triggered: true, pending: false };
  };

  const triggerImmediateRefreshAll = () => {
    const results = Array.from(runtimes.keys()).map((address) => triggerImmediateRefresh(address));
    return {
      runtimeCount: runtimes.size,
      triggeredCount: results.filter((item) => item.triggered).length,
      pendingCount: results.filter((item) => item.pending).length,
      results,
    };
  };

  const decodeReceiptForAddress = (
    address: string,
    receipt: Record<string, unknown>,
    txHash: string,
    options?: { source?: "ws" | "webhook"; seenAt?: string },
  ): NormalizedEvent[] => {
    const normalizedAddress = normalizeWallet(address);
    if (!normalizedAddress) return [];
    const runtime = runtimes.get(normalizedAddress);
    if (runtime) {
      return decodeWsEventsFromReceipt(
        runtime,
        receipt,
        txHash,
        options?.source ?? "webhook",
        options?.seenAt,
      );
    }

    const knownAssetMeta = new Map<string, { marketSlug?: string; market?: string; outcome?: string }>();
    const recentEvents = readEvents(normalizedAddress, 500);
    for (const event of recentEvents) {
      const assetId = (event.asset_id ?? "").trim();
      if (!assetId) continue;
      knownAssetMeta.set(assetId, {
        marketSlug: event.market_slug ?? undefined,
        market: event.market ?? undefined,
        outcome: event.outcome ?? undefined,
      });
    }

    return decodeWsEventsFromReceipt(
      { address: normalizedAddress, knownAssetMeta },
      receipt,
      txHash,
      options?.source ?? "webhook",
      options?.seenAt,
    );
  };

  const ingestExternalEvents = (
    address: string,
    events: NormalizedEvent[],
    source: "webhook" | "ws" = "webhook",
  ) => {
    const normalizedAddress = normalizeWallet(address);
    if (!normalizedAddress || !events.length) {
      return { accepted: 0, duplicates: 0, total: 0 };
    }

    ensureWalletDir(normalizedAddress);
    const runtime = runtimes.get(normalizedAddress);
    const state = runtime?.state ?? readState(normalizedAddress);
    const seenIds = new Set(state.seen_ids);
    const seenQueue = [...state.seen_queue];

    const acceptedEvents: NormalizedEvent[] = [];
    let duplicates = 0;

    for (const item of events) {
      const event: NormalizedEvent = {
        ...item,
        seen_at_utc: item.seen_at_utc || utcNowIso(),
        raw_source: source,
        source_stage: item.source_stage ?? (source === "webhook" ? "webhook" : "mined"),
        pending_seen_at: item.pending_seen_at ?? null,
        mined_seen_at: item.mined_seen_at ?? null,
        decoded_at: item.decoded_at ?? null,
        reconcile_status: item.reconcile_status ?? (source === "webhook" ? "webhook_ingested" : null),
      };
      const key = dedupeKeyFromEvent(event);
      if (seenIds.has(key)) {
        duplicates += 1;
        continue;
      }

      seenIds.add(key);
      seenQueue.push(key);
      while (seenQueue.length > maxRecentSeenIds) {
        const oldest = seenQueue.shift();
        if (oldest) seenIds.delete(oldest);
      }
      acceptedEvents.push(event);
    }

    if (acceptedEvents.length > 0) {
      if (runtime) {
        appendDetectedEvents(runtime, acceptedEvents, source, false);
      } else {
        appendEvents(normalizedAddress, acceptedEvents);
        const monitorRows: TrackerMonitorRecord[] = acceptedEvents.map((event) => ({
          id: dedupeKeyFromEvent(event),
          kind: "event",
          created_at: utcNowIso(),
          wallet: normalizedAddress,
          source,
          tx_hash: event.tx_hash ?? null,
          market: event.market ?? null,
          market_slug: event.market_slug ?? null,
          outcome: event.outcome ?? null,
          asset_id: event.asset_id ?? null,
          side: event.side ?? null,
          price: event.price ?? null,
          size: event.size ?? null,
          status: "detected",
          error: null,
          detected_at: event.seen_at_utc,
          request_payload: null,
          response_payload: null,
          source_stage: event.source_stage ?? null,
          pending_seen_at: event.pending_seen_at ?? null,
          mined_seen_at: event.mined_seen_at ?? null,
          reconcile_status: event.reconcile_status ?? null,
        }));
        appendMonitor(normalizedAddress, monitorRows);
      }
    }

    state.seen_ids = [...seenIds];
    state.seen_queue = seenQueue;
    state.last_check = utcNowIso();
    writeState(normalizedAddress, state);
    if (runtime) runtime.state = state;

    return {
      total: events.length,
      accepted: acceptedEvents.length,
      duplicates,
    };
  };

  return {
    startTracker,
    stopTracker,
    removeTrackerData,
    isActive: (address: string) => runtimes.has(normalizeWallet(address)),
    listWallets,
    getEvents: (address: string, limit?: number) => readEvents(address, limit),
    getStats: (events: NormalizedEvent[]) => computeEventStats(events),
    getState: (address: string) => readState(address),
    appendMonitor: (address: string, entries: TrackerMonitorRecord[]) => appendMonitor(address, entries),
    getMonitor: (address: string, limit?: number) => readMonitor(address, limit),
    clearOrderHistory,
    getMonitorSummary,
    triggerImmediateRefresh,
    triggerImmediateRefreshAll,
    decodeReceiptForAddress,
    ingestExternalEvents,
    normalizeWallet,
    walletDir,
  };
};

export type TrackerRuntimeManager = ReturnType<typeof createTrackerRuntimeManager>;
