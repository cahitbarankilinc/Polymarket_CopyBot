import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import fs from "fs";
import { spawn, spawnSync } from "child_process";
import { componentTagger } from "lovable-tagger";
import type { IncomingMessage } from "http";
import {
  createTrackerRuntimeManager,
  type DetectedEventsBatch,
  type NormalizedEvent as RuntimeNormalizedEvent,
  type TrackerMonitorRecord,
} from "./src/server/trackerRuntime";

// Lightweight .env loader for server-side process.env usage inside Vite config/runtime.
const localEnvPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(localEnvPath)) {
  const lines = fs.readFileSync(localEnvPath, "utf-8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex <= 0) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    if (!key || process.env[key] !== undefined) continue;
    let value = trimmed.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

const POLL_INTERVAL_MS = 2000;
const FETCH_TIMEOUT_MS = Number(process.env.POLYMARKET_FETCH_TIMEOUT_MS ?? 5000);
const MAX_RECENT_SEEN_IDS = 1500;
const POLY_ALCHEMY_API_KEY = (process.env.POLY_ALCHEMY_API_KEY ?? "").trim();
const POLY_ALCHEMY_WS_URL = (process.env.POLY_ALCHEMY_WS_URL ?? "").trim();
const POLY_ALCHEMY_HTTP_URL = (process.env.POLY_ALCHEMY_HTTP_URL ?? "").trim();
const POLY_ALCHEMY_WS_FALLBACK_URLS = (process.env.POLY_ALCHEMY_WS_FALLBACK_URLS ?? "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const POLY_ALCHEMY_HTTP_FALLBACK_URLS = (process.env.POLY_ALCHEMY_HTTP_FALLBACK_URLS ?? "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const POLY_ENABLE_PENDING_WS = (process.env.POLY_ENABLE_PENDING_WS ?? "1").trim() !== "0";
const ACTIVITY_URL = "https://data-api.polymarket.com/activity";
const TRADES_URL = "https://data-api.polymarket.com/trades";
const TRACKING_ROOT = path.resolve(process.cwd(), "tracked_wallets");
const PROFILE_TRADES_ROOT = path.resolve(process.cwd(), "tracked_profiles");
const PROFILE_SCRIPT_PATH = path.resolve(process.cwd(), "polymarket_profile_extract.py");
const REAL_TRADE_SCRIPT_PATH = path.resolve(process.cwd(), "test_trade.py");
const SCRAPER_SCRIPT_PATH = path.resolve(process.cwd(), "scrapernew.py");
const SCRAPER_PROFILE_DIR = (process.env.POLYMARKET_SCRAPER_PROFILE_DIR ?? path.resolve(process.cwd(), "browser_profiles", "default")).trim();
const SCRAPER_CHROME_USER_DATA_DIR = (process.env.POLYMARKET_CHROME_USER_DATA_DIR ?? "").trim();
const SCRAPER_CHROME_PROFILE_NAME = (process.env.POLYMARKET_CHROME_PROFILE_NAME ?? "Baran").trim();
const SHARED_SCRAPER_PROFILE_DIR = SCRAPER_PROFILE_DIR;
const PROFILE_TRADES_REFRESH_MS = 60 * 60 * 1000;
const SCRAPER_MAX_RUN_MS = Number(process.env.POLYMARKET_SCRAPER_TIMEOUT_MS ?? 180000);
const REAL_ORDER_TIMEOUT_MS = Number(process.env.POLYMARKET_REAL_ORDER_TIMEOUT_MS ?? 45000);
const LIVE_ORDER_CANCEL_AFTER_MS = Math.max(1000, Number(process.env.POLYMARKET_LIVE_CANCEL_AFTER_MS ?? 5000));
const POLYMARKET_PRIVATE_KEY = (process.env.POLYMARKET_PRIVATE_KEY ?? "").trim();
const POLYMARKET_FUNDER_ADDRESS = (process.env.POLYMARKET_FUNDER_ADDRESS ?? "").trim();
const POLYMARKET_EXECUTION_WALLETS_ENV_KEY = "POLYMARKET_EXECUTION_WALLETS_JSON";
const LEGACY_EXECUTION_WALLET_ID = "__legacy_default__";
const DEFAULT_REAL_ORDER_SLIPPAGE_CENTS = Math.max(0, Number(process.env.POLYMARKET_DEFAULT_SLIPPAGE_CENTS ?? 5));
const AUTO_REAL_ORDER_ENABLED = (process.env.POLYMARKET_AUTO_ORDER_ENABLED ?? "0").trim() === "1";
const ORDER_ARM_DEFAULT_MINUTES = Math.max(1, Number(process.env.POLYMARKET_ARM_DEFAULT_MINUTES ?? 10));
const ORDER_ARM_MAX_MINUTES = Math.max(1, Number(process.env.POLYMARKET_ARM_MAX_MINUTES ?? 120));
const OPENAI_MODEL = "gpt-5-mini-2025-08-07";
const OPENAI_API_KEY = (process.env.OPENAI_API_KEY ?? "").trim();
const OPENAI_SYSTEM_INSTRUCTIONS = `Sen bir “Polymarket trade kopyalama analiz motoru”sun. Görevin sadece ANALİZ ve ÖZET üretmektir.
Asla:
- Tavsiye verme, öneri verme, “yapmalısın / dene / test et / paper trading” gibi yönlendirici cümleler kurma.
- Uzun açıklama yazma, gereksiz detay ekleme, eğitim/rehber moduna girme.
- Risk uyarıları, hukuki/finansal disclaimer, “yatırım tavsiyesi değildir” vb. metin yazma.
- Pseudocode, otomasyon adımları, kural listeleri, checklist’ler, simülasyon/deneme önerileri üretme.
- Soru sorma; veri eksikse sadece “Yetersiz veri: …” diye tek satır belirt.

Çıktı formatı KESİN:
1) Trader davranış özeti (profil)
- En fazla 6 madde, her madde 1 satır, sade ve anlaşılır.
- Şunları kapsa (varsa): işlem sıklığı, tipik pozisyon büyüklüğü, market türleri, yönlülük vs market-making, holding süresi izleri, tutarlılık.

2) Net öneri (özet)
- Sadece 3–5 madde.
- “Ölçekleme yaklaşımı”nı tarafsız biçimde seç ve yaz: 
  - “Sabit $”, “Portföy %”, veya “Free balance oranı” (veri varsa).
- Kullanıcının bütçesi (~$100) ile trader’ın ölçeği çok farklıysa bunu 1 cümleyle belirt.
- Her maddede yalnızca net parametre/ilke adı ver (örn: “Sabit $/trade: $X”, “Max açık maruziyet: $Y”, “Günlük toplam: $Z”).
- Gerekçe yazma; sadece net özet.

Dil: Türkçe. Ton: kısa, temiz, doğrudan.`;

const parseStoredExecutionWallet = (value: unknown): StoredExecutionWallet | null => {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const nickName = typeof record.nickName === "string" ? record.nickName.trim() : "";
  const privateKey = typeof record.privateKey === "string" ? record.privateKey.trim() : "";
  const funderAddress = typeof record.funderAddress === "string" ? record.funderAddress.trim() : "";
  const createdAt = typeof record.createdAt === "string" && record.createdAt.trim()
    ? record.createdAt.trim()
    : new Date().toISOString();
  const updatedAt = typeof record.updatedAt === "string" && record.updatedAt.trim()
    ? record.updatedAt.trim()
    : createdAt;
  if (!id || !nickName || !privateKey || !funderAddress) return null;
  return {
    id,
    nickName,
    privateKey,
    funderAddress,
    createdAt,
    updatedAt,
  };
};

const readManagedExecutionWalletsFromEnv = (): StoredExecutionWallet[] => {
  const raw = (process.env[POLYMARKET_EXECUTION_WALLETS_ENV_KEY] ?? "").trim();
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(parseStoredExecutionWallet)
      .filter((item): item is StoredExecutionWallet => item !== null);
  } catch {
    return [];
  }
};

let managedExecutionWallets: StoredExecutionWallet[] = readManagedExecutionWalletsFromEnv();

const writeEnvValue = (key: string, value: string) => {
  const nextLine = `${key}=${value}`;
  const lines = fs.existsSync(localEnvPath)
    ? fs.readFileSync(localEnvPath, "utf-8").split(/\r?\n/)
    : [];
  let replaced = false;
  const nextLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return line;
    const eqIndex = line.indexOf("=");
    if (eqIndex <= 0) return line;
    const currentKey = line.slice(0, eqIndex).trim();
    if (currentKey !== key) return line;
    replaced = true;
    return nextLine;
  });

  if (!replaced) {
    if (nextLines.length > 0 && nextLines[nextLines.length - 1] !== "") nextLines.push("");
    nextLines.push(nextLine);
  }

  fs.writeFileSync(localEnvPath, `${nextLines.join("\n").replace(/\n*$/, "")}\n`, "utf-8");
  process.env[key] = value;
};

const persistManagedExecutionWallets = () => {
  managedExecutionWallets = [...managedExecutionWallets]
    .sort((a, b) => a.nickName.localeCompare(b.nickName, "tr"));
  writeEnvValue(POLYMARKET_EXECUTION_WALLETS_ENV_KEY, JSON.stringify(managedExecutionWallets));
};

const buildLegacyExecutionWallet = (): ExecutionWalletRecord | null => {
  if (!POLYMARKET_PRIVATE_KEY || !POLYMARKET_FUNDER_ADDRESS) return null;
  return {
    id: LEGACY_EXECUTION_WALLET_ID,
    nickName: "Default Wallet",
    privateKey: POLYMARKET_PRIVATE_KEY,
    funderAddress: POLYMARKET_FUNDER_ADDRESS,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    source: "legacy",
  };
};

const listExecutionWalletRecords = (): ExecutionWalletRecord[] => {
  const legacy = buildLegacyExecutionWallet();
  const managed = managedExecutionWallets.map((item) => ({ ...item, source: "managed" as const }));
  return legacy ? [legacy, ...managed] : managed;
};

const toExecutionWalletSummary = (wallet: ExecutionWalletRecord): ExecutionWalletSummary => ({
  id: wallet.id,
  nickName: wallet.nickName,
  privateKey: wallet.privateKey,
  funderAddress: wallet.funderAddress,
  hasPrivateKey: wallet.privateKey.length > 0,
  source: wallet.source,
  createdAt: wallet.createdAt,
  updatedAt: wallet.updatedAt,
});

const listExecutionWalletSummaries = (): ExecutionWalletSummary[] => (
  listExecutionWalletRecords().map(toExecutionWalletSummary)
);

const resolveExecutionWalletRecord = (walletId?: string | null): ExecutionWalletRecord | null => {
  const normalizedId = typeof walletId === "string" ? walletId.trim() : "";
  const wallets = listExecutionWalletRecords();
  if (normalizedId) return wallets.find((item) => item.id === normalizedId) ?? null;
  return wallets[0] ?? null;
};

const createManagedExecutionWallet = (input: {
  nickName: string;
  privateKey: string;
  funderAddress: string;
}): ExecutionWalletRecord => {
  const nickName = input.nickName.trim();
  const privateKey = input.privateKey.trim();
  const funderAddress = input.funderAddress.trim();
  if (!nickName || !privateKey || !funderAddress) {
    throw new Error("Nick_Name, POLYMARKET_PRIVATE_KEY ve POLYMARKET_FUNDER_ADDRESS zorunludur.");
  }

  const existingName = managedExecutionWallets.find((item) => item.nickName.toLowerCase() === nickName.toLowerCase());
  if (existingName) {
    throw new Error("Aynı Nick_Name ile kayıtlı wallet zaten var.");
  }

  const now = new Date().toISOString();
  const wallet: StoredExecutionWallet = {
    id: crypto.randomUUID(),
    nickName,
    privateKey,
    funderAddress,
    createdAt: now,
    updatedAt: now,
  };
  managedExecutionWallets.push(wallet);
  persistManagedExecutionWallets();
  return { ...wallet, source: "managed" };
};

const updateManagedExecutionWallet = (input: {
  id: string;
  nickName: string;
  privateKey: string;
  funderAddress: string;
}): ExecutionWalletRecord => {
  const id = input.id.trim();
  const nickName = input.nickName.trim();
  const privateKey = input.privateKey.trim();
  const funderAddress = input.funderAddress.trim();
  if (!id || !nickName || !privateKey || !funderAddress) {
    throw new Error("Nick_Name, POLYMARKET_PRIVATE_KEY ve POLYMARKET_FUNDER_ADDRESS zorunludur.");
  }

  const index = managedExecutionWallets.findIndex((item) => item.id === id);
  if (index < 0) {
    throw new Error("Düzenlenecek wallet bulunamadı.");
  }

  const existingName = managedExecutionWallets.find((item, itemIndex) => (
    itemIndex !== index && item.nickName.toLowerCase() === nickName.toLowerCase()
  ));
  if (existingName) {
    throw new Error("Aynı Nick_Name ile başka wallet zaten var.");
  }

  const nextWallet: StoredExecutionWallet = {
    ...managedExecutionWallets[index],
    nickName,
    privateKey,
    funderAddress,
    updatedAt: new Date().toISOString(),
  };
  managedExecutionWallets[index] = nextWallet;
  persistManagedExecutionWallets();

  for (const session of copySessions.values()) {
    if (session.executionWalletId !== id) continue;
    session.executionWalletNickname = nickName;
  }
  persistCopySessionsSafe();

  return { ...nextWallet, source: "managed" };
};

type RawEvent = Record<string, unknown>;

type NormalizedEvent = {
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
  raw_source: "activity" | "trades";
};

type MarketQuote = {
  market: string;
  outcome: string;
  assetId: string;
  bid: number | null;
  ask: number | null;
  bidCents: number | null;
  askCents: number | null;
};

type WalletEventStats = {
  total: number;
  last24h: number;
  buyTodayUsd: number;
  sellTodayUsd: number;
};

type ClosedTrade = {
  closed_market: string;
  closed_result: string;
  closed_couldwon: number;
  closed_outcome: string;
  closed_cent: number;
  closed_won: number;
  closed_pnl: number;
  closed_procent: number;
};

type ProfileTradesPayload = {
  username: string;
  trades: ClosedTrade[];
  source: "cache" | "scraped";
  refreshedAt: string | null;
  loading: boolean;
  isRefreshing: boolean;
  lastError: string | null;
};

type TrackerState = {
  seen_ids: string[];
  seen_queue: string[];
  last_check: string | null;
};

type TrackerRuntime = {
  stop: () => void;
  state: TrackerState;
};

type RealTradeOrderRequest = {
  marketSlug?: string;
  market?: string;
  outcome?: string;
  executionWalletId?: string;
  side?: string;
  price?: number;
  size?: number;
  tradeUsd?: number;
  slippageCents?: number;
  assetId?: string;
  walletAddress?: string;
  detectedAt?: string;
  source?: "ws" | "poll" | "ui" | string;
  requestId?: string;
  skipMarketLookup?: boolean;
};

type RealTradeOrderKind = "limit" | "market-like";
type RealTradeOrderType = "GTC" | "FAK" | "FOK" | "GTD";

type BackendCopyMode = "notional" | "proportional" | "multiplier" | "fixed-amount" | "fixed-shares" | "buy-wait";

type BackendCopySessionConfig = {
  mode: BackendCopyMode;
  sourceTradeUsd: number;
  leaderFreeBalance: number;
  multiplier: number;
  fixedAmount: number;
  buyWaitLimit: number;
  fixedShares: number;
  sharePrice: number;
  slippageCents: number;
  centRangeMin: number | null;
  centRangeMax: number | null;
  shareRangeMin: number | null;
  shareRangeMax: number | null;
  budgetBaseUsd: number;
  useSlippage: boolean;
};

type BackendCopySession = {
  sessionId: string;
  addressId: string;
  walletAddress: string;
  strategy: string;
  config: BackendCopySessionConfig;
  executionWalletId: string | null;
  executionWalletNickname: string | null;
  status: "running" | "syncing" | "idle";
  startedAt: string;
  marketBuyCounts: Record<string, number>;
  processedEventKeys: Set<string>;
  processedQueue: string[];
  processedCount: number;
  copiedCount: number;
  failedCount: number;
  startAfterMs: number;
  openOrderKeys: Record<string, {
    requestId: string;
    orderId: string | null;
    openedAt: string;
    marketKey: string;
    outcomeKey: string;
    side: string;
    status: string;
  }>;
};

type RealTradeScriptPayload = {
  success: boolean;
  action?: string;
  status?: string | null;
  response?: Record<string, unknown> | null;
  error?: string;
  assetId?: string;
  marketSlug?: string;
  outcome?: string;
  side?: string;
  price?: number;
  size?: number;
  orderId?: string | null;
  orderKind?: RealTradeOrderKind;
  orderType?: RealTradeOrderType;
};

type StoredExecutionWallet = {
  id: string;
  nickName: string;
  privateKey: string;
  funderAddress: string;
  createdAt: string;
  updatedAt: string;
};

type ExecutionWalletRecord = StoredExecutionWallet & {
  source: "managed" | "legacy";
};

type ExecutionWalletSummary = {
  id: string;
  nickName: string;
  privateKey: string;
  funderAddress: string;
  hasPrivateKey: boolean;
  source: "managed" | "legacy";
  createdAt: string;
  updatedAt: string;
};

const runtimes = new Map<string, TrackerRuntime>();
const profileTradeJobs = new Map<string, Promise<void>>();
const profileTradeJobModes = new Map<string, boolean>();
const profileTradePendingBrowser = new Set<string>();
const profileTradeErrors = new Map<string, string>();
let profileTradeScrapeQueue: Promise<void> = Promise.resolve();
const quoteCache = new Map<string, { expiresAt: number; value: MarketQuote | null }>();
const QUOTE_TTL_MS = 1500;
const ORDER_GLOBAL_CONCURRENCY = Math.max(1, Number(process.env.POLYMARKET_ORDER_GLOBAL_CONCURRENCY ?? 4));
const MAX_SESSION_EVENT_KEYS = 5000;
const HISTORY_DEFAULT_LIMIT = 200;
const COPY_SESSIONS_FILE = path.join(TRACKING_ROOT, "_copy_sessions.json");
const USDC_TOKEN_ADDRESS = "0x2791bca1f2de4661ed88a30c99a7a9449aa84174";
const CTF_TOKEN_ADDRESS = "0x4d97dcd97ec945f40cf65f87097ac5ea0476045";
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const TRANSFER_SINGLE_TOPIC = "0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62";
const copySessions = new Map<string, BackendCopySession>();
let copySessionsRestored = false;

const trackerRuntime = createTrackerRuntimeManager({
  trackingRoot: TRACKING_ROOT,
  pollIntervalMs: POLL_INTERVAL_MS,
  fetchTimeoutMs: FETCH_TIMEOUT_MS,
  maxRecentSeenIds: MAX_RECENT_SEEN_IDS,
  alchemyApiKey: POLY_ALCHEMY_API_KEY || undefined,
  alchemyWsUrl: POLY_ALCHEMY_WS_URL || undefined,
  alchemyHttpUrl: POLY_ALCHEMY_HTTP_URL || undefined,
  alchemyWsUrls: POLY_ALCHEMY_WS_FALLBACK_URLS,
  alchemyHttpUrls: POLY_ALCHEMY_HTTP_FALLBACK_URLS,
  enablePendingWs: POLY_ENABLE_PENDING_WS,
  activityUrl: ACTIVITY_URL,
  tradesUrl: TRADES_URL,
  onEventsDetected: processDetectedEventsBatch,
});

type QueuedOrderTask<T> = {
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

const orderQueues = new Map<string, QueuedOrderTask<unknown>[]>();
const orderWalletBusy = new Set<string>();
let orderGlobalInFlight = 0;
let autoOrderArmedUntilMs = 0;

const hasPrivateKey = () => POLYMARKET_PRIVATE_KEY.length > 0;
const hasFunderAddress = () => POLYMARKET_FUNDER_ADDRESS.length > 0;
const isAutoOrderArmed = () => Date.now() < autoOrderArmedUntilMs;

const getAutoOrderControlStatus = () => ({
  enabled: AUTO_REAL_ORDER_ENABLED,
  armed: isAutoOrderArmed(),
  armedUntil: isAutoOrderArmed() ? new Date(autoOrderArmedUntilMs).toISOString() : null,
  hasPrivateKey: hasPrivateKey(),
  hasFunderAddress: hasFunderAddress(),
  defaultArmMinutes: ORDER_ARM_DEFAULT_MINUTES,
  maxArmMinutes: ORDER_ARM_MAX_MINUTES,
});

const armAutoOrder = (minutes?: number) => {
  const candidateMinutes = Number.isFinite(minutes) ? Number(minutes) : ORDER_ARM_DEFAULT_MINUTES;
  const boundedMinutes = Math.max(1, Math.min(ORDER_ARM_MAX_MINUTES, Math.floor(candidateMinutes)));
  autoOrderArmedUntilMs = Date.now() + (boundedMinutes * 60_000);
  return getAutoOrderControlStatus();
};

const disarmAutoOrder = () => {
  autoOrderArmedUntilMs = 0;
  return getAutoOrderControlStatus();
};

const scheduleQueuedOrders = () => {
  if (orderGlobalInFlight >= ORDER_GLOBAL_CONCURRENCY) return;

  for (const [walletKey, queue] of orderQueues.entries()) {
    if (orderGlobalInFlight >= ORDER_GLOBAL_CONCURRENCY) break;
    if (orderWalletBusy.has(walletKey)) continue;
    const item = queue.shift();
    if (!item) {
      orderQueues.delete(walletKey);
      continue;
    }
    if (queue.length === 0) {
      orderQueues.delete(walletKey);
    }

    orderWalletBusy.add(walletKey);
    orderGlobalInFlight += 1;

    item.run()
      .then((result) => item.resolve(result))
      .catch((error) => item.reject(error))
      .finally(() => {
        orderGlobalInFlight = Math.max(0, orderGlobalInFlight - 1);
        orderWalletBusy.delete(walletKey);
        queueMicrotask(scheduleQueuedOrders);
      });
  }
};

const enqueueOrderJob = <T>(walletKey: string, run: () => Promise<T>): Promise<T> => (
  new Promise<T>((resolve, reject) => {
    const normalizedWalletKey = walletKey.trim().toLowerCase() || "__global__";
    const current = orderQueues.get(normalizedWalletKey) ?? [];
    current.push({
      run: run as () => Promise<unknown>,
      resolve: resolve as (value: unknown) => void,
      reject,
    });
    orderQueues.set(normalizedWalletKey, current);
    queueMicrotask(scheduleQueuedOrders);
  })
);
const envVenvPython = (() => {
  const venvRoot = (process.env.VIRTUAL_ENV ?? "").trim();
  if (!venvRoot) return null;
  return process.platform === "win32"
    ? path.resolve(venvRoot, "Scripts", "python.exe")
    : path.resolve(venvRoot, "bin", "python");
})();

const LOCAL_VENV_PYTHON_CANDIDATES: ReadonlyArray<readonly [string, ...string[]]> = [
  ...(envVenvPython ? [[envVenvPython] as const] : []),
  ...(process.platform === "win32"
    ? [
      [path.resolve(process.cwd(), ".venv", "Scripts", "python.exe")] as const,
      [path.resolve(process.cwd(), "venv", "Scripts", "python.exe")] as const,
    ]
    : [
      [path.resolve(process.cwd(), ".venv", "bin", "python")] as const,
      [path.resolve(process.cwd(), "venv", "bin", "python")] as const,
    ]),
];

const DEFAULT_PYTHON_COMMAND_CANDIDATES: ReadonlyArray<readonly [string, ...string[]]> = process.platform === "win32"
  ? [...LOCAL_VENV_PYTHON_CANDIDATES, ["py", "-3"], ["py"], ["python"], ["python3"]]
  : [...LOCAL_VENV_PYTHON_CANDIDATES, ["python3"], ["python"]];

const isUsablePythonCommand = (candidate: readonly [string, ...string[]]) => {
  const [bin, ...args] = candidate;
  const probe = spawnSync(bin, [...args, "--version"], { stdio: "pipe" });
  return probe.status === 0;
};

const PYTHON_COMMAND_CANDIDATES: ReadonlyArray<readonly [string, ...string[]]> = (() => {
  const fromEnvRaw = (process.env.POLYMARKET_PYTHON_CMD ?? "").trim();
  if (fromEnvRaw) {
    const parts = fromEnvRaw.split(/\s+/).filter(Boolean);
    if (parts.length > 0) {
      return [parts as [string, ...string[]]];
    }
  }

  const usable = DEFAULT_PYTHON_COMMAND_CANDIDATES.filter(isUsablePythonCommand);
  return usable.length > 0 ? usable : DEFAULT_PYTHON_COMMAND_CANDIDATES;
})();

const utcNowIso = () => new Date().toISOString();

const toFloat = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const normalizeWallet = (address: string) => address.trim().toLowerCase();

const parseProfileUsername = (profileUrl: string) => {
  const match = profileUrl.match(/@([^?/#]+)/i);
  return (match?.[1] ?? "unknown_user").replace(/\//g, "").toLowerCase();
};

const profileTradesPath = (username: string) => path.join(PROFILE_TRADES_ROOT, `${username}_trades.json`);

const parseClosedTrade = (value: unknown): ClosedTrade | null => {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;

  const closed_market = typeof row.closed_market === "string" ? row.closed_market : "";
  const closed_result = typeof row.closed_result === "string" ? row.closed_result : "";
  const closed_outcome = typeof row.closed_outcome === "string" ? row.closed_outcome : "";

  return {
    closed_market,
    closed_result,
    closed_outcome,
    closed_couldwon: toFloat(row.closed_couldwon) ?? 0,
    closed_cent: toFloat(row.closed_cent) ?? 0,
    closed_won: toFloat(row.closed_won) ?? 0,
    closed_pnl: toFloat(row.closed_pnl) ?? 0,
    closed_procent: toFloat(row.closed_procent) ?? 0,
  };
};

const runScraperForProfile = async (
  profileUrl: string,
  options?: { showBrowser?: boolean; profileDir?: string },
): Promise<ClosedTrade[]> => {
  const safeUrl = profileUrl.trim();
  if (!safeUrl) throw new Error("profileUrl is required");

  const username = parseProfileUsername(safeUrl);
  const outputPath = profileTradesPath(username);
  let lastError = "Scraper command failed";
  const candidateErrors: string[] = [];

  const profileDir = (options?.profileDir ?? SCRAPER_PROFILE_DIR).trim();
  const showBrowser = Boolean(options?.showBrowser);

  fs.mkdirSync(profileDir, { recursive: true });

  for (const candidate of PYTHON_COMMAND_CANDIDATES) {
    const [bin, ...baseArgs] = candidate;
    try {
      await new Promise<void>((resolve, reject) => {
        const scraperArgs = [...baseArgs, SCRAPER_SCRIPT_PATH, safeUrl, "--profile-dir", profileDir];
        if (SCRAPER_CHROME_USER_DATA_DIR) {
          scraperArgs.push("--chrome-user-data-dir", SCRAPER_CHROME_USER_DATA_DIR);
          if (SCRAPER_CHROME_PROFILE_NAME) {
            scraperArgs.push("--chrome-profile-name", SCRAPER_CHROME_PROFILE_NAME);
          }
        }
        if (showBrowser) {
          scraperArgs.push("--show-browser");
        }

        const child = spawn(bin, scraperArgs, {
          cwd: process.cwd(),
          stdio: ["ignore", "pipe", "pipe"],
          env: {
            ...process.env,
            PYTHONIOENCODING: process.env.PYTHONIOENCODING || "utf-8",
            PYTHONUTF8: process.env.PYTHONUTF8 || "1",
          },
        });

        let stderr = "";
        let stdout = "";
        let timedOut = false;

        const timeoutId = setTimeout(() => {
          timedOut = true;
          try {
            child.kill("SIGTERM");
          } catch {
            // noop
          }

          setTimeout(() => {
            try {
              child.kill("SIGKILL");
            } catch {
              // noop
            }
          }, 1500);
        }, SCRAPER_MAX_RUN_MS);

        child.stdout.on("data", (chunk) => {
          stdout += chunk.toString();
        });
        child.stderr.on("data", (chunk) => {
          stderr += chunk.toString();
        });

        child.on("error", (error) => {
          clearTimeout(timeoutId);
          reject(error);
        });

        child.on("close", (code) => {
          clearTimeout(timeoutId);

          if (code === 0 && !timedOut) {
            resolve();
            return;
          }

          const stderrTail = stderr.trim().split(/\r?\n/).slice(-8).join("\n");
          const stdoutTail = stdout.trim().split(/\r?\n/).slice(-8).join("\n");
          const fallback = `${bin} exited with ${code}`;
          if (timedOut) {
            reject(new Error(`Scraper ${SCRAPER_MAX_RUN_MS}ms timeout. stdout/stderr tail:\n${stderrTail || stdoutTail || fallback}`.trim()));
            return;
          }

          reject(new Error((stderrTail || stdoutTail || fallback).trim()));
        });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastError = message;
      candidateErrors.push(`${bin} ${baseArgs.join(" ")}`.trim() + ` => ${message}`);
      continue;
    }

    const generatedOutputPath = path.resolve(process.cwd(), `${username}_trades.json`);
    if (!fs.existsSync(generatedOutputPath)) {
      throw new Error(`Scraper çıktısı bulunamadı: ${generatedOutputPath}`);
    }

    fs.copyFileSync(generatedOutputPath, outputPath);

    const raw = fs.readFileSync(outputPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error("Scraper çıktısı geçerli bir liste değil");
    }

    return parsed.map(parseClosedTrade).filter((trade): trade is ClosedTrade => trade !== null);
  }

  throw new Error(candidateErrors.length > 0 ? candidateErrors.join("\n") : lastError);
};

const readCachedProfileTrades = (username: string): ClosedTrade[] => {
  const raw = fs.readFileSync(profileTradesPath(username), "utf-8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed.map(parseClosedTrade).filter((trade): trade is ClosedTrade => trade !== null);
};

const scheduleProfileTradesRefresh = (
  username: string,
  profileUrl: string,
  options?: { showBrowser?: boolean },
) => {
  const requestedBrowserMode = Boolean(options?.showBrowser);
  if (profileTradeJobs.has(username)) {
    if (requestedBrowserMode && !profileTradeJobModes.get(username)) {
      profileTradePendingBrowser.add(username);
    }
    return;
  }
  profileTradeErrors.delete(username);
  profileTradeJobModes.set(username, requestedBrowserMode);

  const job = Promise.resolve().then(async () => {
    profileTradeScrapeQueue = profileTradeScrapeQueue
      .catch(() => {
        // previous queued scrape failures should not block next jobs
      })
      .then(async () => {
        console.log(`[tracker] profile scrape start user=${username} showBrowser=${requestedBrowserMode}`);
        await runScraperForProfile(profileUrl, {
          showBrowser: requestedBrowserMode,
          profileDir: SHARED_SCRAPER_PROFILE_DIR,
        });
      });

    await profileTradeScrapeQueue;
  }).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    profileTradeErrors.set(username, message);
    console.error(`[tracker] profile scrape error user=${username}: ${message}`);
  }).finally(() => {
    console.log(`[tracker] profile scrape end user=${username}`);
    profileTradeJobs.delete(username);
    profileTradeJobModes.delete(username);

    if (profileTradePendingBrowser.delete(username)) {
      scheduleProfileTradesRefresh(username, profileUrl, { showBrowser: true });
    }
  });

  profileTradeJobs.set(username, job);
};

const getProfileTradesPayload = (
  profileUrl: string,
  options?: { forceRefresh?: boolean; showBrowser?: boolean },
): ProfileTradesPayload => {
  const safeUrl = profileUrl.trim();
  if (!safeUrl) throw new Error("profileUrl is required");

  fs.mkdirSync(PROFILE_TRADES_ROOT, { recursive: true });
  const username = parseProfileUsername(safeUrl);
  const targetPath = profileTradesPath(username);
  const hasFile = fs.existsSync(targetPath);
  const hasRunningJob = profileTradeJobs.has(username);
  const forceRefresh = Boolean(options?.forceRefresh);
  const showBrowser = Boolean(options?.showBrowser);

  if (forceRefresh) {
    scheduleProfileTradesRefresh(username, safeUrl, { showBrowser });
  }

  if (!hasFile) {
    if (!hasRunningJob) {
      scheduleProfileTradesRefresh(username, safeUrl, { showBrowser: false });
    }

    return {
      username,
      trades: [],
      source: "scraped",
      refreshedAt: null,
      loading: true,
      isRefreshing: true,
      lastError: profileTradeErrors.get(username) ?? null,
    };
  }

  const stat = fs.statSync(targetPath);
  const ageMs = Date.now() - stat.mtimeMs;
  const stale = ageMs >= PROFILE_TRADES_REFRESH_MS;
  if (stale && !hasRunningJob) {
    scheduleProfileTradesRefresh(username, safeUrl, { showBrowser: false });
  }

  return {
    username,
    trades: readCachedProfileTrades(username),
    source: stale ? "cache" : "cache",
    refreshedAt: stat.mtime.toISOString(),
    loading: false,
    isRefreshing: stale || hasRunningJob || forceRefresh,
    lastError: profileTradeErrors.get(username) ?? null,
  };
};

const toTimestampMs = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;

  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
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

const walletDir = (address: string) => path.join(TRACKING_ROOT, normalizeWallet(address));
const stateFile = (address: string) => path.join(walletDir(address), "state.json");
const eventsFile = (address: string) => path.join(walletDir(address), "events.ndjson");
const errorsFile = (address: string) => path.join(walletDir(address), "errors.log");
const walletStorageExists = (address: string) => fs.existsSync(walletDir(address));

const ensureWalletDir = (address: string) => {
  fs.mkdirSync(walletDir(address), { recursive: true });
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
  if (!walletStorageExists(address)) return;
  fs.writeFileSync(stateFile(address), JSON.stringify(state, null, 2), "utf-8");
};

const readEvents = (address: string, options?: { limit?: number }): NormalizedEvent[] => {
  try {
    const lines = fs.readFileSync(eventsFile(address), "utf-8").split("\n").filter(Boolean);
    const limit = options?.limit;
    const targetLines = typeof limit === "number" && Number.isFinite(limit) && limit > 0
      ? lines.slice(-Math.floor(limit))
      : lines;

    const parsed = targetLines
      .map((line) => {
        try {
          return JSON.parse(line) as NormalizedEvent;
        } catch {
          return null;
        }
      })
      .filter((event): event is NormalizedEvent => event !== null);

    return parsed;
  } catch {
    return [];
  }
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

const appendEvents = (address: string, events: NormalizedEvent[]) => {
  if (events.length === 0) return;
  if (!walletStorageExists(address)) return;
  const data = events.map((event) => JSON.stringify(event)).join("\n");
  fs.appendFileSync(eventsFile(address), `${data}\n`, "utf-8");
};

const appendError = (address: string, message: string) => {
  try {
    if (!walletStorageExists(address)) return;
    fs.appendFileSync(errorsFile(address), `[${utcNowIso()}] ${message}\n`, "utf-8");
  } catch {
    // Ignore file write failures during tracker cleanup.
  }
};

const generateEventId = (raw: RawEvent, source: "activity" | "trades") => {
  const txHash = raw.transactionHash ?? raw.txHash ?? raw.hash;
  if (txHash) return String(txHash);
  const eventTime = raw.timestamp ?? raw.createdAt ?? raw.time ?? raw.eventTime;
  const market = raw.question ?? raw.slug ?? raw.market ?? raw.marketId;
  const side = raw.side ?? raw.action ?? "";
  const size = raw.size ?? raw.amount ?? raw.shares ?? "";
  return `${source}:${String(eventTime)}|${String(market)}|${String(side)}|${String(size)}`;
};

const normalizeEvent = (raw: RawEvent, source: "activity" | "trades"): NormalizedEvent => {
  const price = toFloat(raw.price ?? raw.avgPrice);
  const size = toFloat(raw.size ?? raw.amount ?? raw.shares);
  const valueFromEvent = toFloat(raw.value ?? raw.valueUSD ?? raw.usdcSize ?? raw.usdc_size);

  const normalizedEventTime = toTimestampMs(raw.timestamp ?? raw.createdAt ?? raw.time ?? raw.eventTime);

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
    raw_source: source,
  };
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

const normalizeToken = (value: string) => value.trim().toLowerCase();

const resolveQuoteFromMarket = async (marketSlug: string, outcome: string): Promise<MarketQuote | null> => {
  const marketResponse = await fetch(`https://gamma-api.polymarket.com/markets/slug/${encodeURIComponent(marketSlug)}`, { cache: "no-store" });
  if (!marketResponse.ok) return null;

  const marketPayload = await marketResponse.json() as Record<string, unknown>;
  const tokenIds = maybeJson(marketPayload.clobTokenIds);
  const outcomes = maybeJson(marketPayload.outcomes);

  if (!Array.isArray(tokenIds) || tokenIds.length === 0 || !Array.isArray(outcomes) || outcomes.length === 0) {
    return null;
  }

  const normalizedOutcome = normalizeToken(outcome);
  let outcomeIndex = outcomes.findIndex((candidate) => normalizeToken(String(candidate)) === normalizedOutcome);
  if (outcomeIndex === -1) {
    outcomeIndex = outcomes.findIndex((candidate) => normalizeToken(String(candidate)).includes(normalizedOutcome));
  }
  if (outcomeIndex === -1 || outcomeIndex >= tokenIds.length) return null;

  const assetId = String(tokenIds[outcomeIndex]);
  const bookResponse = await fetch(`https://clob.polymarket.com/book?token_id=${encodeURIComponent(assetId)}`, { cache: "no-store" });
  if (!bookResponse.ok) return null;

  const bookPayload = await bookResponse.json() as Record<string, unknown>;
  const bids = Array.isArray(bookPayload.bids) ? bookPayload.bids : [];
  const asks = Array.isArray(bookPayload.asks) ? bookPayload.asks : [];

  let bid: number | null = null;
  let ask: number | null = null;

  const bidPrices = bids
    .map((row) => (row && typeof row === "object" ? toFloat((row as Record<string, unknown>).price) : null))
    .filter((price): price is number => typeof price === "number");
  if (bidPrices.length > 0) bid = Math.max(...bidPrices);

  const askPrices = asks
    .map((row) => (row && typeof row === "object" ? toFloat((row as Record<string, unknown>).price) : null))
    .filter((price): price is number => typeof price === "number");
  if (askPrices.length > 0) ask = Math.min(...askPrices);

  return {
    market: marketSlug,
    outcome,
    assetId,
    bid,
    ask,
    bidCents: bid === null ? null : Number((bid * 100).toFixed(4)),
    askCents: ask === null ? null : Number((ask * 100).toFixed(4)),
  };
};

const getLiveQuote = async (marketSlug: string, outcome: string): Promise<MarketQuote | null> => {
  const cleanMarket = marketSlug.trim();
  const cleanOutcome = outcome.trim();
  if (!cleanMarket || !cleanOutcome) return null;

  const cacheKey = `${normalizeToken(cleanMarket)}|${normalizeToken(cleanOutcome)}`;
  const now = Date.now();
  const cached = quoteCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.value;

  const value = await resolveQuoteFromMarket(cleanMarket, cleanOutcome);
  quoteCache.set(cacheKey, { value, expiresAt: now + QUOTE_TTL_MS });
  return value;
};

const getBookQuoteByAssetId = async (
  assetId: string,
  marketSlug?: string,
  outcome?: string,
): Promise<MarketQuote | null> => {
  const cleanAssetId = assetId.trim();
  if (!cleanAssetId) return null;

  const bookResponse = await fetch(`https://clob.polymarket.com/book?token_id=${encodeURIComponent(cleanAssetId)}`, { cache: "no-store" });
  if (!bookResponse.ok) return null;

  const bookPayload = await bookResponse.json() as Record<string, unknown>;
  const bids = Array.isArray(bookPayload.bids) ? bookPayload.bids : [];
  const asks = Array.isArray(bookPayload.asks) ? bookPayload.asks : [];

  let bid: number | null = null;
  let ask: number | null = null;

  const bidPrices = bids
    .map((row) => (row && typeof row === "object" ? toFloat((row as Record<string, unknown>).price) : null))
    .filter((price): price is number => typeof price === "number");
  if (bidPrices.length > 0) bid = Math.max(...bidPrices);

  const askPrices = asks
    .map((row) => (row && typeof row === "object" ? toFloat((row as Record<string, unknown>).price) : null))
    .filter((price): price is number => typeof price === "number");
  if (askPrices.length > 0) ask = Math.min(...askPrices);

  return {
    market: marketSlug?.trim() || `asset-${cleanAssetId.slice(0, 12)}`,
    outcome: outcome?.trim() || "Unknown",
    assetId: cleanAssetId,
    bid,
    ask,
    bidCents: bid === null ? null : Number((bid * 100).toFixed(4)),
    askCents: ask === null ? null : Number((ask * 100).toFixed(4)),
  };
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const normalizeOrderTypeValue = (value: unknown): RealTradeOrderType => {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (normalized === "FAK" || normalized === "FOK" || normalized === "GTD") return normalized;
  return "GTC";
};

const normalizeOrderLifecycleStatus = (value: unknown): string => {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!normalized) return "";
  if (normalized === "matched" || normalized === "filled" || normalized === "complete" || normalized === "completed") {
    return "matched";
  }
  if (normalized === "cancelled" || normalized === "canceled") {
    return "cancelled";
  }
  if (normalized === "error" || normalized === "failed" || normalized === "rejected") {
    return "error";
  }
  if (normalized === "live" || normalized === "open" || normalized === "delayed" || normalized === "pending") {
    return "live";
  }
  return normalized;
};

const extractOrderIdFromPayload = (payload: unknown): string | null => {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const directOrderId = record.orderId ?? record.orderID;
  if (typeof directOrderId === "string" && directOrderId.trim()) return directOrderId.trim();
  const response = record.response;
  if (response && typeof response === "object") {
    const responseOrderId = (response as Record<string, unknown>).orderId ?? (response as Record<string, unknown>).orderID;
    if (typeof responseOrderId === "string" && responseOrderId.trim()) return responseOrderId.trim();
  }
  return null;
};

const parseJsonFromOutput = (output: string): Record<string, unknown> | null => {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      const parsed = JSON.parse(lines[i]) as unknown;
      if (parsed && typeof parsed === "object") {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // continue
    }
  }

  return null;
};

const toPositiveFiniteNumber = (value: unknown): number | null => {
  const parsed = toFloat(value);
  if (parsed === null || !Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
};

const normalizeSideValue = (side: unknown): "BUY" | "SELL" | null => {
  if (typeof side !== "string") return null;
  const normalized = side.trim().toUpperCase();
  if (normalized === "BUY" || normalized === "SELL") return normalized;
  return null;
};

const normalizeStrategyName = (value: string | undefined): string => {
  const trimmed = (value ?? "").trim();
  return trimmed || "1e1 Direct Copy";
};

const buildSessionId = (addressId: string, strategy: string): string => `${addressId}::${normalizeStrategyName(strategy)}`;

const parseOptionalFinite = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const parsed = toFloat(value);
  if (parsed === null || !Number.isFinite(parsed)) return null;
  return parsed;
};

const toNonNegative = (value: unknown, fallback = 0): number => {
  const parsed = parseOptionalFinite(value);
  if (parsed === null) return fallback;
  return Math.max(0, parsed);
};

const parseCopySessionConfig = (raw: Record<string, unknown>): BackendCopySessionConfig => {
  const modeRaw = typeof raw.mode === "string" ? raw.mode.trim() : "notional";
  const mode: BackendCopyMode = (
    ["notional", "proportional", "multiplier", "fixed-amount", "fixed-shares", "buy-wait"].includes(modeRaw)
      ? modeRaw
      : "notional"
  ) as BackendCopyMode;

  return {
    mode,
    sourceTradeUsd: toNonNegative(raw.sourceTradeUsd, 0),
    leaderFreeBalance: toNonNegative(raw.leaderFreeBalance, 0),
    multiplier: toNonNegative(raw.multiplier, 1),
    fixedAmount: toNonNegative(raw.fixedAmount, 0),
    buyWaitLimit: Math.floor(toNonNegative(raw.buyWaitLimit, 0)),
    fixedShares: toNonNegative(raw.fixedShares, 0),
    sharePrice: toNonNegative(raw.sharePrice, 0),
    slippageCents: toNonNegative(raw.slippageCents, DEFAULT_REAL_ORDER_SLIPPAGE_CENTS),
    centRangeMin: parseOptionalFinite(raw.centRangeMin),
    centRangeMax: parseOptionalFinite(raw.centRangeMax),
    shareRangeMin: parseOptionalFinite(raw.shareRangeMin),
    shareRangeMax: parseOptionalFinite(raw.shareRangeMax),
    budgetBaseUsd: toNonNegative(raw.budgetBaseUsd, 0),
    useSlippage: typeof raw.useSlippage === "boolean" ? raw.useSlippage : true,
  };
};

const persistCopySessions = () => {
  fs.mkdirSync(TRACKING_ROOT, { recursive: true });
  const payload = {
    sessions: Array.from(copySessions.values())
      .filter((session) => session.status !== "idle")
      .map((session) => ({
        sessionId: session.sessionId,
        addressId: session.addressId,
        walletAddress: session.walletAddress,
        strategy: session.strategy,
        config: session.config,
        executionWalletId: session.executionWalletId,
        executionWalletNickname: session.executionWalletNickname,
        status: session.status,
        startedAt: session.startedAt,
        marketBuyCounts: session.marketBuyCounts,
        processedQueue: session.processedQueue,
        processedCount: session.processedCount,
        copiedCount: session.copiedCount,
        failedCount: session.failedCount,
        startAfterMs: session.startAfterMs,
        openOrderKeys: session.openOrderKeys,
      })),
  };
  fs.writeFileSync(COPY_SESSIONS_FILE, JSON.stringify(payload, null, 2), "utf-8");
};

const persistCopySessionsSafe = () => {
  try {
    persistCopySessions();
  } catch (error) {
    console.error(`[copy-sessions] persist failed: ${error instanceof Error ? error.message : String(error)}`);
  }
};

const restoreCopySessions = () => {
  if (copySessionsRestored) return;
  copySessionsRestored = true;
  fs.mkdirSync(TRACKING_ROOT, { recursive: true });
  if (!fs.existsSync(COPY_SESSIONS_FILE)) return;

  try {
    const raw = JSON.parse(fs.readFileSync(COPY_SESSIONS_FILE, "utf-8")) as { sessions?: Array<Record<string, unknown>> };
    const sessions = Array.isArray(raw.sessions) ? raw.sessions : [];
    for (const item of sessions) {
      const addressId = typeof item.addressId === "string" ? item.addressId.trim() : "";
      const walletAddress = trackerRuntime.normalizeWallet(item.walletAddress ?? "");
      const strategy = normalizeStrategyName(typeof item.strategy === "string" ? item.strategy : undefined);
      if (!addressId || !walletAddress) continue;
      const executionWalletId = typeof item.executionWalletId === "string" && item.executionWalletId.trim()
        ? item.executionWalletId.trim()
        : null;
      const executionWallet = resolveExecutionWalletRecord(executionWalletId);
      const restoredAtMs = Date.now();

      const processedQueue = Array.isArray(item.processedQueue)
        ? item.processedQueue.filter((value): value is string => typeof value === "string" && value.trim().length > 0).slice(-MAX_SESSION_EVENT_KEYS)
        : [];

      const sessionId = buildSessionId(addressId, strategy);
      copySessions.set(sessionId, {
        sessionId,
        addressId,
        walletAddress,
        strategy,
        config: parseCopySessionConfig((item.config && typeof item.config === "object") ? item.config as Record<string, unknown> : {}),
        executionWalletId: executionWallet?.id ?? executionWalletId,
        executionWalletNickname: executionWallet?.nickName ?? (typeof item.executionWalletNickname === "string" ? item.executionWalletNickname.trim() || null : null),
        status: item.status === "syncing" ? "syncing" : "running",
        startedAt: typeof item.startedAt === "string" && item.startedAt.trim() ? item.startedAt : utcNowIso(),
        marketBuyCounts: item.marketBuyCounts && typeof item.marketBuyCounts === "object"
          ? Object.fromEntries(Object.entries(item.marketBuyCounts as Record<string, unknown>).filter(([, value]) => typeof value === "number" && Number.isFinite(value)))
          : {},
        processedEventKeys: new Set(processedQueue),
        processedQueue,
        processedCount: typeof item.processedCount === "number" && Number.isFinite(item.processedCount) ? item.processedCount : 0,
        copiedCount: typeof item.copiedCount === "number" && Number.isFinite(item.copiedCount) ? item.copiedCount : 0,
        failedCount: typeof item.failedCount === "number" && Number.isFinite(item.failedCount) ? item.failedCount : 0,
        startAfterMs: restoredAtMs,
        openOrderKeys: item.openOrderKeys && typeof item.openOrderKeys === "object"
          ? Object.fromEntries(
            Object.entries(item.openOrderKeys as Record<string, unknown>)
              .map(([key, value]) => {
                if (!value || typeof value !== "object") return null;
                const record = value as Record<string, unknown>;
                const requestId = typeof record.requestId === "string" ? record.requestId.trim() : "";
                const openedAt = typeof record.openedAt === "string" ? record.openedAt.trim() : "";
                const marketKey = typeof record.marketKey === "string" ? record.marketKey.trim().toLowerCase() : "";
                const outcomeKey = typeof record.outcomeKey === "string" ? record.outcomeKey.trim().toLowerCase() : "";
                const side = typeof record.side === "string" ? record.side.trim().toUpperCase() : "";
                const status = typeof record.status === "string" ? record.status.trim().toLowerCase() : "live_open";
                const orderId = typeof record.orderId === "string" && record.orderId.trim() ? record.orderId.trim() : null;
                if (!requestId || !openedAt || !marketKey || !outcomeKey || !side) return null;
                return [key, { requestId, openedAt, marketKey, outcomeKey, side, status, orderId }] as const;
              })
              .filter((entry): entry is readonly [string, { requestId: string; orderId: string | null; openedAt: string; marketKey: string; outcomeKey: string; side: string; status: string }] => Boolean(entry)),
          )
          : {},
      });
      const restoredSession = copySessions.get(sessionId);
      if (restoredSession) rebuildSessionStateFromMonitor(restoredSession);
      trackerRuntime.startTracker(walletAddress);
    }
  } catch (error) {
    console.error(`[copy-sessions] restore failed: ${error instanceof Error ? error.message : String(error)}`);
  }
};

const removeCopySessionsForWallet = (walletAddress: string) => {
  const normalizedWallet = trackerRuntime.normalizeWallet(walletAddress);
  if (!normalizedWallet) return 0;
  let removed = 0;
  for (const [sessionId, session] of copySessions.entries()) {
    if (session.walletAddress !== normalizedWallet) continue;
    copySessions.delete(sessionId);
    removed += 1;
  }
  persistCopySessionsSafe();
  return removed;
};

const resolveEventKey = (event: RuntimeNormalizedEvent): string => {
  const txHash = (event.tx_hash ?? "").toLowerCase();
  const assetId = event.asset_id ?? "";
  const side = (event.side ?? "").toUpperCase();
  if (txHash) return `${txHash}:${assetId}:${side}`;
  return `${event.seen_at_utc}:${event.market_slug ?? event.market ?? ""}:${side}:${event.price ?? ""}:${event.size ?? ""}`;
};

const resolveMarketKey = (event: RuntimeNormalizedEvent): string | null => {
  const slug = typeof event.market_slug === "string" ? event.market_slug.trim().toLowerCase() : "";
  if (slug) return slug;
  const market = typeof event.market === "string" ? event.market.trim().toLowerCase() : "";
  if (market) return market;
  const assetId = typeof event.asset_id === "string" ? event.asset_id.trim() : "";
  if (assetId) return `asset:${assetId.toLowerCase()}`;
  return null;
};

const resolveOutcomeKey = (event: RuntimeNormalizedEvent): string => {
  const outcome = typeof event.outcome === "string" ? event.outcome.trim().toLowerCase() : "";
  if (outcome) return outcome;
  const assetId = typeof event.asset_id === "string" ? event.asset_id.trim().toLowerCase() : "";
  if (assetId) return `asset:${assetId}`;
  return "unknown";
};

const resolveSessionOpenOrderKey = (event: RuntimeNormalizedEvent, sideOverride?: string | null): string | null => {
  const marketKey = resolveMarketKey(event);
  const side = (sideOverride ?? normalizeSideValue(event.side))?.trim().toUpperCase() ?? "";
  if (!marketKey || !side) return null;
  return `${marketKey}|${resolveOutcomeKey(event)}|${side}`;
};

const isOpenOrderLifecycleStatus = (status: string) => {
  const normalized = status.trim().toLowerCase();
  return normalized === "live" || normalized === "live_open";
};

const normalizeMarketLikeLifecycleStatus = (
  status: string,
  orderKind?: string | null,
): string => {
  const normalizedStatus = status.trim().toLowerCase();
  const normalizedOrderKind = typeof orderKind === "string" ? orderKind.trim().toLowerCase() : "";
  if (normalizedOrderKind === "market-like" && (normalizedStatus === "live" || normalizedStatus === "live_open")) {
    return "matched";
  }
  return normalizedStatus;
};

const shouldConsumeBuyWaitSlot = (status: string) => {
  const normalized = status.trim().toLowerCase();
  return normalized === "matched" || normalized === "live_open" || normalized === "cancelled_after_timeout";
};

const rebuildSessionStateFromMonitor = (session: BackendCopySession) => {
  const startedAtMs = Date.parse(session.startedAt);
  const rows = trackerRuntime.getMonitor(session.walletAddress, 5000)
    .filter((row) => row.kind === "order")
    .sort((a, b) => (Date.parse(a.created_at) || 0) - (Date.parse(b.created_at) || 0));

  const rebuiltMarketBuyCounts: Record<string, number> = {};
  const rebuiltOpenOrderKeys: BackendCopySession["openOrderKeys"] = {};

  for (const row of rows) {
    const rowCreatedAtMs = Date.parse(row.created_at);
    if (Number.isFinite(startedAtMs) && Number.isFinite(rowCreatedAtMs) && rowCreatedAtMs < startedAtMs) {
      continue;
    }

    const monitorEvent: RuntimeNormalizedEvent = {
      seen_at_utc: row.detected_at ?? row.created_at,
      market: row.market ?? null,
      market_slug: row.market_slug ?? null,
      outcome: row.outcome ?? null,
      asset_id: row.asset_id ?? null,
      side: row.side ?? null,
      price: row.price ?? null,
      size: row.size ?? null,
      value_usd: row.value_usd ?? null,
      tx_hash: row.tx_hash ?? null,
      raw_source: row.source === "poll" ? "activity" : "webhook",
      source_stage: row.source_stage ?? null,
      pending_seen_at: row.pending_seen_at ?? null,
      mined_seen_at: row.mined_seen_at ?? null,
      decoded_at: row.decoded_at ?? null,
      reconcile_status: row.reconcile_status ?? null,
    };

    const storedFinalStatus = typeof row.final_status === "string" && row.final_status.trim()
      ? row.final_status
      : row.status;
    const finalStatus = normalizeMarketLikeLifecycleStatus(storedFinalStatus, row.order_kind);
    const marketKey = resolveMarketKey(monitorEvent);
    const openOrderKey = resolveSessionOpenOrderKey(monitorEvent, typeof row.side === "string" ? row.side : null);

    if (session.config.mode === "buy-wait" && marketKey && shouldConsumeBuyWaitSlot(finalStatus)) {
      rebuiltMarketBuyCounts[marketKey] = (rebuiltMarketBuyCounts[marketKey] || 0) + 1;
    }

    if (!openOrderKey) continue;
    if (isOpenOrderLifecycleStatus(finalStatus)) {
      rebuiltOpenOrderKeys[openOrderKey] = {
        requestId: typeof row.request_id === "string" && row.request_id.trim() ? row.request_id.trim() : row.id,
        orderId: typeof row.open_order_id === "string" && row.open_order_id.trim() ? row.open_order_id.trim() : null,
        openedAt: row.order_posted_at ?? row.created_at,
        marketKey: marketKey ?? "unknown",
        outcomeKey: resolveOutcomeKey(monitorEvent),
        side: typeof row.side === "string" ? row.side.trim().toUpperCase() : "BUY",
        status: finalStatus.trim().toLowerCase(),
      };
    } else {
      delete rebuiltOpenOrderKeys[openOrderKey];
    }
  }

  if (session.config.mode === "buy-wait") {
    session.marketBuyCounts = rebuiltMarketBuyCounts;
  }
  session.openOrderKeys = rebuiltOpenOrderKeys;
};

const resolveEventTradeUsd = (event: RuntimeNormalizedEvent, fallbackUsd: number): number => {
  const valueUsd = toNonNegative(event.value_usd, 0);
  if (valueUsd > 0) return valueUsd;
  const price = toNonNegative(event.price, 0);
  const size = toNonNegative(event.size, 0);
  const calc = price * size;
  if (calc > 0) return calc;
  return fallbackUsd > 0 ? fallbackUsd : 0;
};

const resolveEventTimestampMs = (event: RuntimeNormalizedEvent): number | null => {
  const eventTimeMs = Date.parse(String(event.event_time ?? ""));
  if (Number.isFinite(eventTimeMs)) return eventTimeMs;
  const seenAtMs = Date.parse(String(event.seen_at_utc ?? ""));
  if (Number.isFinite(seenAtMs)) return seenAtMs;
  return null;
};

const isTradeEvent = (event: RuntimeNormalizedEvent): boolean => {
  const type = (event.type ?? "").trim().toUpperCase();
  return type === "TRADE";
};

const isEventInConfiguredRanges = (eventPrice: number, eventSize: number, config: BackendCopySessionConfig): boolean => {
  const eventCent = eventPrice * 100;

  const hasCentMin = config.centRangeMin !== null;
  const hasCentMax = config.centRangeMax !== null;
  if (hasCentMin || hasCentMax) {
    const centMin = hasCentMin ? (config.centRangeMin as number) : 1;
    const centMax = hasCentMax ? (config.centRangeMax as number) : 99;
    if (eventCent < centMin || eventCent > centMax) return false;
  }

  const hasShareMin = config.shareRangeMin !== null;
  const hasShareMax = config.shareRangeMax !== null;
  if (hasShareMin && eventSize < (config.shareRangeMin as number)) return false;
  if (hasShareMax && eventSize > (config.shareRangeMax as number)) return false;
  return true;
};

const calculateTradeUsd = (config: BackendCopySessionConfig, eventTradeUsd: number): number => {
  switch (config.mode) {
    case "notional":
      return eventTradeUsd;
    case "proportional": {
      if (eventTradeUsd <= 0 || config.leaderFreeBalance <= 0 || config.budgetBaseUsd <= 0) return 0;
      const ratio = eventTradeUsd / config.leaderFreeBalance;
      return ratio * config.budgetBaseUsd;
    }
    case "multiplier":
      return eventTradeUsd * (config.multiplier > 0 ? config.multiplier : 1);
    case "fixed-amount":
    case "buy-wait":
      return config.fixedAmount;
    case "fixed-shares":
      return config.fixedShares * config.sharePrice;
    default:
      return eventTradeUsd;
  }
};

const appendSessionEventKey = (session: BackendCopySession, key: string) => {
  if (session.processedEventKeys.has(key)) return false;
  session.processedEventKeys.add(key);
  session.processedQueue.push(key);
  while (session.processedQueue.length > MAX_SESSION_EVENT_KEYS) {
    const oldest = session.processedQueue.shift();
    if (oldest) session.processedEventKeys.delete(oldest);
  }
  persistCopySessionsSafe();
  return true;
};

const runScriptCandidate = (
  bin: string,
  args: string[],
): Promise<{ status: number | null; stdout: string; stderr: string; error?: Error }> => (
  new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill("SIGKILL");
      } catch {
        // noop
      }
      resolve({
        status: null,
        stdout,
        stderr,
        error: new Error(`real order script timeout after ${REAL_ORDER_TIMEOUT_MS}ms`),
      });
    }, REAL_ORDER_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
      if (stdout.length > 1024 * 1024) {
        stdout = stdout.slice(-1024 * 1024);
      }
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
      if (stderr.length > 1024 * 1024) {
        stderr = stderr.slice(-1024 * 1024);
      }
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ status: null, stdout, stderr, error });
    });

    child.on("close", (status) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ status, stdout, stderr });
    });
  })
);

const USE_PERSISTENT_ORDER_WORKER = (process.env.POLYMARKET_PERSISTENT_ORDER_WORKER ?? "1").trim() !== "0";
const ORDER_WORKER_IDLE_MS = Math.max(15_000, Number(process.env.POLYMARKET_ORDER_WORKER_IDLE_MS ?? 60_000));

let pythonOrderWorker:
  | {
    bin: string;
    baseArgs: string[];
    process: ReturnType<typeof spawn>;
    buffer: string;
    pending: Map<string, {
      resolve: (value: RealTradeScriptPayload) => void;
      reject: (reason?: unknown) => void;
      timer: NodeJS.Timeout;
    }>;
    idleTimer: NodeJS.Timeout | null;
  }
  | null = null;

const closePythonOrderWorker = () => {
  if (!pythonOrderWorker) return;
  const current = pythonOrderWorker;
  pythonOrderWorker = null;
  if (current.idleTimer) {
    clearTimeout(current.idleTimer);
    current.idleTimer = null;
  }
  for (const item of current.pending.values()) {
    clearTimeout(item.timer);
    item.reject(new Error("Python order worker kapandı"));
  }
  current.pending.clear();
  try {
    current.process.kill();
  } catch {
    // noop
  }
};

const refreshPythonWorkerIdleTimer = () => {
  if (!pythonOrderWorker) return;
  if (pythonOrderWorker.idleTimer) clearTimeout(pythonOrderWorker.idleTimer);
  pythonOrderWorker.idleTimer = setTimeout(() => {
    closePythonOrderWorker();
  }, ORDER_WORKER_IDLE_MS);
};

const getPythonOrderWorker = () => {
  if (pythonOrderWorker) {
    refreshPythonWorkerIdleTimer();
    return pythonOrderWorker;
  }
  const [bin, ...baseArgs] = PYTHON_COMMAND_CANDIDATES[0];
  const child = spawn(bin, [...baseArgs, REAL_TRADE_SCRIPT_PATH, "--worker", "--json"], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
  });
  const state = {
    bin,
    baseArgs,
    process: child,
    buffer: "",
    pending: new Map<string, {
      resolve: (value: RealTradeScriptPayload) => void;
      reject: (reason?: unknown) => void;
      timer: NodeJS.Timeout;
    }>(),
    idleTimer: null as NodeJS.Timeout | null,
  };
  pythonOrderWorker = state;

  child.stdout.on("data", (chunk) => {
    if (!pythonOrderWorker || pythonOrderWorker !== state) return;
    state.buffer += chunk.toString();
    let newlineIndex = state.buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = state.buffer.slice(0, newlineIndex).trim();
      state.buffer = state.buffer.slice(newlineIndex + 1);
      if (line) {
        try {
          const parsed = JSON.parse(line) as RealTradeScriptPayload & { id?: string };
          const id = typeof parsed.id === "string" ? parsed.id : "";
          const pending = id ? state.pending.get(id) : null;
          if (pending) {
            clearTimeout(pending.timer);
            state.pending.delete(id);
            pending.resolve(parsed);
          }
        } catch {
          // ignore malformed worker output line
        }
      }
      newlineIndex = state.buffer.indexOf("\n");
    }
  });

  child.on("error", () => {
    closePythonOrderWorker();
  });
  child.on("close", () => {
    closePythonOrderWorker();
  });
  child.stderr.on("data", () => {
    // worker stderr is ignored by design for speed mode
  });
  refreshPythonWorkerIdleTimer();
  return state;
};

const runRealTradeScriptViaWorker = async (input: {
  action?: "place" | "get" | "cancel";
  marketSlug: string;
  outcome: string;
  assetId: string;
  side: "BUY" | "SELL";
  price: number;
  size: number;
  privateKey?: string;
  funderAddress?: string;
  signatureType: number;
  orderKind?: RealTradeOrderKind;
  orderType?: RealTradeOrderType;
  orderId?: string;
}): Promise<RealTradeScriptPayload> => {
  const worker = getPythonOrderWorker();
  const reqId = crypto.randomUUID();
  const payload = {
    id: reqId,
    payload: {
      action: input.action ?? "place",
      marketSlug: input.marketSlug,
      outcome: input.outcome,
      assetId: input.assetId,
      side: input.side,
      price: input.price,
      size: input.size,
      privateKey: input.privateKey ?? "",
      signatureType: input.signatureType,
      funderAddress: input.funderAddress ?? "",
      orderKind: input.orderKind ?? "limit",
      orderType: input.orderType ?? "GTC",
      orderId: input.orderId ?? "",
    },
  };

  const response = await new Promise<RealTradeScriptPayload>((resolve, reject) => {
    const timeout = setTimeout(() => {
      worker.pending.delete(reqId);
      reject(new Error("Python order worker timeout"));
    }, REAL_ORDER_TIMEOUT_MS);
    worker.pending.set(reqId, { resolve, reject, timer: timeout });
    worker.process.stdin.write(`${JSON.stringify(payload)}\n`, (error) => {
      if (error) {
        clearTimeout(timeout);
        worker.pending.delete(reqId);
        reject(error);
      }
    });
  });
  refreshPythonWorkerIdleTimer();
  return response;
};

const runRealTradeScript = async (input: {
  action?: "place" | "get" | "cancel";
  marketSlug: string;
  outcome: string;
  assetId: string;
  side: "BUY" | "SELL";
  price: number;
  size: number;
  privateKey?: string;
  funderAddress?: string;
  signatureType: number;
  orderKind?: RealTradeOrderKind;
  orderType?: RealTradeOrderType;
  orderId?: string;
}): Promise<RealTradeScriptPayload> => {
  if (USE_PERSISTENT_ORDER_WORKER) {
    try {
      const payload = await runRealTradeScriptViaWorker(input);
      if (payload.success) return payload;
    } catch {
      closePythonOrderWorker();
    }
  }

  const candidateErrors: string[] = [];

  for (const candidate of PYTHON_COMMAND_CANDIDATES) {
    const [bin, ...baseArgs] = candidate;
    const args = [
      ...baseArgs,
      REAL_TRADE_SCRIPT_PATH,
      "--action",
      input.action ?? "place",
      "--market-slug",
      input.marketSlug,
      "--outcome",
      input.outcome,
      "--asset-id",
      input.assetId,
      "--side",
      input.side,
      "--price",
      String(input.price),
      "--size",
      String(input.size),
      "--signature-type",
      String(input.signatureType),
      "--order-kind",
      input.orderKind ?? "limit",
      "--order-type",
      input.orderType ?? "GTC",
      "--json",
    ];
    if (input.orderId?.trim()) {
      args.push("--order-id", input.orderId.trim());
    }

    const privateKey = (input.privateKey ?? "").trim();
    const funderAddress = (input.funderAddress ?? "").trim();
    if (privateKey) {
      args.push("--private-key", privateKey);
    }
    if (funderAddress) {
      args.push("--funder", funderAddress);
    }

    const result = await runScriptCandidate(bin, args);

    if (result.error) {
      candidateErrors.push(`${bin} ${baseArgs.join(" ")} => ${result.error.message}`);
      continue;
    }

    const combinedOutput = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
    const parsed = parseJsonFromOutput(combinedOutput);

    if (result.status !== 0) {
      const scriptError = parsed && typeof parsed.error === "string" ? parsed.error : combinedOutput || `${bin} exited with ${result.status}`;
      candidateErrors.push(`${bin} ${baseArgs.join(" ")} => ${scriptError}`);
      continue;
    }

    if (!parsed) {
      candidateErrors.push(`${bin} ${baseArgs.join(" ")} => script output is not valid JSON`);
      continue;
    }

    const payload = parsed as unknown as RealTradeScriptPayload;
    if (!payload.success) {
      candidateErrors.push(`${bin} ${baseArgs.join(" ")} => ${payload.error || "unknown script error"}`);
      continue;
    }

    return payload;
  }

  throw new Error(candidateErrors.join("\n") || "Could not execute real trade script");
};

const executeRealTradeOrder = async (raw: RealTradeOrderRequest) => {
  const source = (typeof raw.source === "string" && raw.source.trim()
    ? raw.source.trim().toLowerCase()
    : "ui") as "ws" | "poll" | "ui" | "webhook";
  const requestId = (typeof raw.requestId === "string" && raw.requestId.trim())
    ? raw.requestId.trim()
    : crypto.randomUUID();
  const walletAddress = normalizeWallet(String(raw.walletAddress ?? ""));
  const executionWalletId = typeof raw.executionWalletId === "string" ? raw.executionWalletId.trim() : "";
  const executionWallet = resolveExecutionWalletRecord(executionWalletId);
  if (!executionWallet) {
    throw new Error("Execution wallet bulunamadı");
  }
  if (!executionWallet.privateKey) {
    throw new Error("Seçili execution wallet private key içermiyor");
  }
  if (!executionWallet.funderAddress) {
    throw new Error("Seçili execution wallet funder address içermiyor");
  }

  const detectedAtCandidate = String(raw.detectedAt ?? "").trim();
  const detectedAt = detectedAtCandidate && !Number.isNaN(Date.parse(detectedAtCandidate))
    ? new Date(detectedAtCandidate).toISOString()
    : utcNowIso();

  let marketSlug = String(raw.marketSlug ?? raw.market ?? "").trim();
  let outcome = String(raw.outcome ?? "").trim();
  const side = normalizeSideValue(raw.side);
  const sourcePrice = toPositiveFiniteNumber(raw.price);
  const sourceSize = toPositiveFiniteNumber(raw.size);
  const skipMarketLookup = raw.skipMarketLookup === true;
  const useSlippage = !skipMarketLookup;
  const slippageCents = useSlippage ? Math.max(0, toFloat(raw.slippageCents) ?? 0) : 0;

  if (!side) throw new Error("side sadece BUY veya SELL olabilir");
  if (sourcePrice === null) throw new Error("price 0'dan büyük sayı olmalı");
  if (sourceSize === null) throw new Error("size 0'dan büyük sayı olmalı");

  const tradeUsd = toPositiveFiniteNumber(raw.tradeUsd ?? Number((sourcePrice * sourceSize).toFixed(6)));
  if (tradeUsd === null) throw new Error("tradeUsd 0'dan büyük sayı olmalı");

  let assetId = String(raw.assetId ?? "").trim();
  if (!assetId && useSlippage && (!marketSlug || !outcome)) {
    throw new Error("market/outcome veya assetId zorunludur");
  }
  if (!assetId && !useSlippage) {
    throw new Error("assetId zorunlu (instant mode)");
  }

  if (!assetId) {
    const quote = await resolveQuoteFromMarket(marketSlug, outcome);
    if (!quote?.assetId) {
      throw new Error("assetId çözümlenemedi");
    }
    assetId = quote.assetId;
  }

  if (!marketSlug) marketSlug = `asset-${assetId.slice(0, 12)}`;
  if (!outcome) outcome = "Unknown";

  let orderKind: RealTradeOrderKind = useSlippage ? "limit" : "market-like";
  let orderType: RealTradeOrderType = useSlippage ? "GTC" : "FAK";
  let quantityKind: "usd" | "shares" = side === "BUY" && !useSlippage ? "usd" : "shares";
  let limitPrice: number | null = null;
  let submittedSize = sourceSize;
  let marketQuotePrice: number | null = null;
  let quote: MarketQuote | null = null;

  if (useSlippage) {
    quote = await getBookQuoteByAssetId(assetId, marketSlug, outcome);
    if (!quote) {
      throw new Error("Canlı quote alınamadı");
    }

    const bestPrice = side === "BUY" ? quote.ask : quote.bid;
    if (!Number.isFinite(bestPrice ?? Number.NaN) || bestPrice === null || bestPrice <= 0) {
      throw new Error(side === "BUY" ? "Best ask bulunamadı" : "Best bid bulunamadı");
    }

    marketQuotePrice = Number(bestPrice.toFixed(6));
    const slippageDelta = slippageCents / 100;
    const withinSlippage = side === "BUY"
      ? marketQuotePrice <= sourcePrice + slippageDelta
      : marketQuotePrice >= sourcePrice - slippageDelta;

    if (!withinSlippage) {
      const postedAt = utcNowIso();
      const detectTs = Date.parse(detectedAt);
      const postedTs = Date.parse(postedAt);
      const detectToOrderMs = Number.isFinite(detectTs) && Number.isFinite(postedTs)
        ? Math.max(0, postedTs - detectTs)
        : null;

      return {
        ok: false,
        resultIcon: "❌",
        status: "blocked",
        finalStatus: "blocked",
        error: side === "BUY"
          ? `Canlı ask slippage dışında (${marketQuotePrice.toFixed(4)} > ${(sourcePrice + slippageDelta).toFixed(4)})`
          : `Canlı bid slippage dışında (${marketQuotePrice.toFixed(4)} < ${(sourcePrice - slippageDelta).toFixed(4)})`,
        marketSlug,
        outcome,
        side,
        assetId,
        requestedPrice: sourcePrice,
        marketQuotePrice,
        limitPrice: marketQuotePrice,
        size: sourceSize,
        submittedSize: null,
        sourceSize,
        sourceValueUsd: tradeUsd,
        tradeUsd,
        slippageCents,
        quantityKind,
        walletAddress: walletAddress || null,
        source,
        requestId,
        detectedAt,
        postedAt,
        detectToOrderMs,
        attemptCount: 0,
        orderKind,
        orderType,
        rawResponse: null,
        orderStateResponse: null,
        cancelResponse: null,
        openOrderId: null,
        cancelledAt: null,
      };
    }

    limitPrice = marketQuotePrice;
    submittedSize = Number((tradeUsd / limitPrice).toFixed(6));
    quantityKind = "shares";
  } else {
    limitPrice = null;
    submittedSize = side === "BUY"
      ? Number(tradeUsd.toFixed(6))
      : Number((tradeUsd / sourcePrice).toFixed(6));
  }

  if (!Number.isFinite(submittedSize) || submittedSize <= 0) {
    throw new Error("Hesaplanan emir boyutu geçersiz");
  }

  let scriptPayload: RealTradeScriptPayload | null = null;
  const attemptCount = 1;
  try {
    scriptPayload = await runRealTradeScript({
      action: "place",
      marketSlug,
      outcome,
      assetId,
      side,
      price: limitPrice ?? 0,
      size: submittedSize,
      privateKey: executionWallet.privateKey,
      funderAddress: executionWallet.funderAddress,
      signatureType: 1,
      orderKind,
      orderType,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Real order script failed";
    throw new Error(message);
  }

  const rawStatus = normalizeOrderLifecycleStatus(scriptPayload.status);
  const postedAt = utcNowIso();
  const detectTs = Date.parse(detectedAt);
  const postedTs = Date.parse(postedAt);
  const detectToOrderMs = Number.isFinite(detectTs) && Number.isFinite(postedTs)
    ? Math.max(0, postedTs - detectTs)
    : null;
  const openOrderId = extractOrderIdFromPayload(scriptPayload) ?? null;

  let status = rawStatus || "error";
  let finalStatus = status;
  let resultIcon: "✅" | "⏳" | "❌" = "❌";
  let orderStateResponse: Record<string, unknown> | null = null;
  let cancelResponse: Record<string, unknown> | null = null;
  let cancelledAt: string | null = null;

  if (status === "matched") {
    resultIcon = "✅";
  } else if (status === "live") {
    if (orderKind === "market-like") {
      status = "matched";
      finalStatus = "matched";
      resultIcon = "✅";
    } else if (openOrderId) {
      await sleep(LIVE_ORDER_CANCEL_AFTER_MS);

      try {
        const orderStatePayload = await runRealTradeScript({
          action: "get",
          marketSlug,
          outcome,
          assetId,
          side,
          price: limitPrice ?? 0,
          size: submittedSize,
          privateKey: executionWallet.privateKey,
          funderAddress: executionWallet.funderAddress,
          signatureType: 1,
          orderKind,
          orderType,
          orderId: openOrderId,
        });
        orderStateResponse = orderStatePayload.response ?? null;
        const orderStateStatus = normalizeOrderLifecycleStatus(orderStatePayload.status);
        if (orderStateStatus === "matched") {
          status = "matched";
          finalStatus = "matched";
          resultIcon = "✅";
        } else {
          const cancelPayload = await runRealTradeScript({
            action: "cancel",
            marketSlug,
            outcome,
            assetId,
            side,
            price: limitPrice ?? 0,
            size: submittedSize,
            privateKey: executionWallet.privateKey,
            funderAddress: executionWallet.funderAddress,
            signatureType: 1,
            orderKind,
            orderType,
            orderId: openOrderId,
          });
          cancelResponse = cancelPayload.response ?? null;
          cancelledAt = utcNowIso();
          const cancelStatus = normalizeOrderLifecycleStatus(cancelPayload.status);
          if (cancelStatus === "matched") {
            status = "matched";
            finalStatus = "matched";
            resultIcon = "✅";
          } else {
            status = cancelPayload.success || cancelStatus === "cancelled"
              ? "cancelled_after_timeout"
              : "live_open";
            finalStatus = status;
            resultIcon = status === "live_open" ? "⏳" : "❌";
          }
        }
      } catch (error) {
        status = "live_open";
        finalStatus = "live_open";
        resultIcon = "⏳";
        cancelResponse = {
          error: error instanceof Error ? error.message : "Live order lifecycle check failed",
        };
      }
    } else {
      status = "live_open";
      finalStatus = "live_open";
      resultIcon = "⏳";
    }
  }

  if (status === "error" || status === "blocked" || status === "cancelled_after_timeout") {
    resultIcon = "❌";
  }

  return {
    ok: status === "matched",
    resultIcon,
    status,
    finalStatus,
    marketSlug,
    outcome,
    side,
    assetId,
    requestedPrice: sourcePrice,
    marketQuotePrice,
    limitPrice,
    size: sourceSize,
    submittedSize,
    sourceSize,
    sourceValueUsd: tradeUsd,
    tradeUsd,
    slippageCents,
    quantityKind,
    walletAddress: walletAddress || null,
    source,
    requestId,
    detectedAt,
    postedAt,
    detectToOrderMs,
    attemptCount,
    orderKind,
    orderType,
    openOrderId,
    cancelledAt,
    rawResponse: scriptPayload.response ?? null,
    orderStateResponse,
    cancelResponse,
    script: {
      place: scriptPayload,
      get: orderStateResponse ? { response: orderStateResponse } : null,
      cancel: cancelResponse ? { response: cancelResponse } : null,
    },
  };
};

const normalizeIsoTimestamp = (value: unknown): string => {
  const candidate = typeof value === "string" ? value.trim() : "";
  if (!candidate) return utcNowIso();
  const parsedMs = Date.parse(candidate);
  if (!Number.isFinite(parsedMs)) return utcNowIso();
  return new Date(parsedMs).toISOString();
};

const toMonitorRequestPayload = (payload: {
  marketSlug?: string;
  market?: string;
  outcome?: string;
  assetId?: string;
  side?: string;
  price?: number;
  size?: number;
  tradeUsd?: number;
  slippageCents?: number;
  orderKind?: string;
  orderType?: string;
  quantityKind?: string;
}) => ({
  marketSlug: payload.marketSlug ?? null,
  market: payload.market ?? null,
  outcome: payload.outcome ?? null,
  assetId: payload.assetId ?? null,
  side: payload.side ?? null,
  price: payload.price ?? null,
  size: payload.size ?? null,
  tradeUsd: payload.tradeUsd ?? null,
  slippageCents: payload.slippageCents ?? null,
  orderKind: payload.orderKind ?? null,
  orderType: payload.orderType ?? null,
  quantityKind: payload.quantityKind ?? null,
});

const appendBlockedOrderMonitor = (
  walletAddress: string,
  source: "ws" | "poll" | "webhook",
  event: RuntimeNormalizedEvent,
  reason: string,
) => {
  const requestId = crypto.randomUUID();
  const detectedAt = normalizeIsoTimestamp(event.seen_at_utc);
  const postedAt = utcNowIso();
  const detectTs = Date.parse(detectedAt);
  const postedTs = Date.parse(postedAt);
  const detectToOrderMs = Number.isFinite(detectTs) && Number.isFinite(postedTs)
    ? Math.max(0, postedTs - detectTs)
    : null;

  const row: TrackerMonitorRecord = {
    id: requestId,
    kind: "order",
    created_at: postedAt,
    wallet: walletAddress,
    source,
    tx_hash: event.tx_hash ?? null,
    market: event.market ?? null,
    market_slug: event.market_slug ?? null,
    outcome: event.outcome ?? null,
    asset_id: event.asset_id ?? null,
    side: typeof event.side === "string" ? event.side : null,
    price: toFloat(event.price),
    size: toFloat(event.size),
    value_usd: toFloat(event.value_usd),
    status: "blocked",
    final_status: "blocked",
    error: reason,
    detected_at: detectedAt,
    order_posted_at: postedAt,
    detect_to_order_ms: detectToOrderMs,
    attempt_count: null,
    source_stage: event.source_stage ?? (source === "poll" ? "poll" : "mined"),
    pending_seen_at: event.pending_seen_at ?? null,
    mined_seen_at: event.mined_seen_at ?? null,
    decoded_at: event.decoded_at ?? null,
    reconcile_status: event.reconcile_status ?? null,
    request_id: requestId,
    request_payload: null,
    response_payload: {
      ok: false,
      status: "blocked",
      error: reason,
    },
  };
  trackerRuntime.appendMonitor(walletAddress, [row]);
};

const processDetectedEvent = async (
  walletAddress: string,
  source: "ws" | "poll" | "webhook",
  event: RuntimeNormalizedEvent,
) => {
  const side = normalizeSideValue(event.side);
  const price = toPositiveFiniteNumber(event.price);
  const size = toPositiveFiniteNumber(event.size);
  if (!side || price === null || size === null) return;

  if (!AUTO_REAL_ORDER_ENABLED) {
    appendBlockedOrderMonitor(walletAddress, source, event, "Auto-order disabled (POLYMARKET_AUTO_ORDER_ENABLED=1 değil)");
    return;
  }
  if (!isAutoOrderArmed()) {
    appendBlockedOrderMonitor(walletAddress, source, event, "Auto-order kilidi kapalı (ARM edilmedi)");
    return;
  }
  if (!hasPrivateKey()) {
    appendBlockedOrderMonitor(walletAddress, source, event, "POLYMARKET_PRIVATE_KEY eksik");
    return;
  }

  const marketSlug = typeof event.market_slug === "string" ? event.market_slug.trim() : "";
  const market = typeof event.market === "string" ? event.market.trim() : "";
  const outcome = typeof event.outcome === "string" ? event.outcome.trim() : "";
  const assetId = typeof event.asset_id === "string" ? event.asset_id.trim() : "";
  const detectedAt = normalizeIsoTimestamp(event.seen_at_utc);
  const requestId = crypto.randomUUID();

  const requestPayload: Record<string, unknown> = toMonitorRequestPayload({
    marketSlug: marketSlug || undefined,
    market: market || undefined,
    outcome: outcome || undefined,
    assetId: assetId || undefined,
    side,
    price,
    size,
    slippageCents: DEFAULT_REAL_ORDER_SLIPPAGE_CENTS,
  });

  const appendOrderMonitor = (
    payload: Record<string, unknown>,
    status: string,
    error: string | null,
    postedAt: string,
    attemptCount: number | null,
    detectToOrderMs: number | null,
  ) => {
    const monitorRow: TrackerMonitorRecord = {
      id: requestId,
      kind: "order",
      created_at: utcNowIso(),
      wallet: walletAddress,
      source,
      tx_hash: event.tx_hash ?? null,
      market: typeof payload.marketSlug === "string" ? payload.marketSlug : (market || null),
      market_slug: typeof payload.marketSlug === "string" ? payload.marketSlug : (marketSlug || null),
      outcome: typeof payload.outcome === "string" ? payload.outcome : (outcome || null),
      asset_id: typeof payload.assetId === "string" ? payload.assetId : (assetId || null),
      side,
      price: typeof payload.limitPrice === "number" ? payload.limitPrice : price,
      size,
      status,
      error,
      detected_at: detectedAt,
      order_posted_at: postedAt,
      detect_to_order_ms: detectToOrderMs,
      attempt_count: attemptCount,
      request_id: requestId,
      request_payload: requestPayload,
      response_payload: payload,
    };
    trackerRuntime.appendMonitor(walletAddress, [monitorRow]);
  };

  try {
    const response = await enqueueOrderJob(walletAddress, async () => executeRealTradeOrder({
      marketSlug: marketSlug || undefined,
      market: market || undefined,
      outcome: outcome || undefined,
      assetId: assetId || undefined,
      side,
      price,
      size,
      slippageCents: DEFAULT_REAL_ORDER_SLIPPAGE_CENTS,
      walletAddress,
      detectedAt,
      source,
      requestId,
    })) as Record<string, unknown>;

    const postedAt = typeof response.postedAt === "string" ? response.postedAt : utcNowIso();
    appendOrderMonitor(
      response,
      typeof response.status === "string" ? response.status : "error",
      typeof response.error === "string" ? response.error : null,
      postedAt,
      typeof response.attemptCount === "number" ? response.attemptCount : null,
      typeof response.detectToOrderMs === "number" ? response.detectToOrderMs : null,
    );
  } catch (error) {
    const postedAt = utcNowIso();
    const detectTs = Date.parse(detectedAt);
    const postedTs = Date.parse(postedAt);
    const detectToOrderMs = Number.isFinite(detectTs) && Number.isFinite(postedTs)
      ? Math.max(0, postedTs - detectTs)
      : null;
    appendOrderMonitor(
      {
        ok: false,
        resultIcon: "❌",
        status: "error",
        error: error instanceof Error ? error.message : "Real trade request failed",
        requestId,
        source,
        detectedAt,
        postedAt,
      },
      "error",
      error instanceof Error ? error.message : "Real trade request failed",
      postedAt,
      null,
      detectToOrderMs,
    );
  }
};

async function processDetectedEventsBatch(batch: DetectedEventsBatch): Promise<void> {
  if (batch.isInitialSync) return;
  const walletAddress = trackerRuntime.normalizeWallet(batch.wallet ?? "");
  if (!walletAddress || !Array.isArray(batch.events) || batch.events.length === 0) return;
  await processCopySessionsForWalletEvents(walletAddress, batch.events, { source: batch.source });
}

const listCopySessionsPayload = () => ({
  sessions: Array.from(copySessions.values()).map((session) => ({
    sessionId: session.sessionId,
    addressId: session.addressId,
    walletAddress: session.walletAddress,
    strategy: session.strategy,
    config: session.config,
    executionWalletId: session.executionWalletId,
    executionWalletNickname: session.executionWalletNickname,
    status: session.status,
    startedAt: session.startedAt,
    processedCount: session.processedCount,
    copiedCount: session.copiedCount,
    failedCount: session.failedCount,
    marketBuyCounts: session.marketBuyCounts,
    openOrderKeys: session.openOrderKeys,
  })),
});

const toTrimmedText = (value: unknown): string | null => {
  return typeof value === "string" && value.trim() ? value.trim() : null;
};

const isPlaceholderHistoryMarket = (value: string | null) => {
  if (!value) return true;
  const normalized = value.trim().toLowerCase();
  return !normalized || normalized === "-" || normalized.startsWith("asset-");
};

const isPlaceholderHistoryOutcome = (value: string | null) => {
  if (!value) return true;
  const normalized = value.trim().toLowerCase();
  return !normalized || normalized === "-" || normalized === "unknown";
};

type OrderHistoryMeta = {
  market: string | null;
  marketSlug: string | null;
  outcome: string | null;
};

const mergeOrderHistoryMeta = (base: OrderHistoryMeta, candidate: OrderHistoryMeta): OrderHistoryMeta => ({
  market: !isPlaceholderHistoryMarket(base.market) ? base.market : candidate.market,
  marketSlug: !isPlaceholderHistoryMarket(base.marketSlug) ? base.marketSlug : candidate.marketSlug,
  outcome: !isPlaceholderHistoryOutcome(base.outcome) ? base.outcome : candidate.outcome,
});

const enrichHistoryPayloadMeta = (
  payload: Record<string, unknown> | null | undefined,
  meta: OrderHistoryMeta,
): Record<string, unknown> | null | undefined => {
  if (!payload) return payload;

  const nextPayload: Record<string, unknown> = { ...payload };

  const payloadMarketSlug = toTrimmedText(nextPayload.marketSlug);
  if (isPlaceholderHistoryMarket(payloadMarketSlug) && meta.marketSlug) nextPayload.marketSlug = meta.marketSlug;

  const payloadMarket = toTrimmedText(nextPayload.market);
  if (isPlaceholderHistoryMarket(payloadMarket) && meta.market) nextPayload.market = meta.market;

  const payloadOutcome = toTrimmedText(nextPayload.outcome);
  if (isPlaceholderHistoryOutcome(payloadOutcome) && meta.outcome) nextPayload.outcome = meta.outcome;

  const script = nextPayload.script;
  if (script && typeof script === "object") {
    const nextScript = { ...(script as Record<string, unknown>) };
    const place = nextScript.place;
    if (place && typeof place === "object") {
      const nextPlace = { ...(place as Record<string, unknown>) };
      const placeMarketSlug = toTrimmedText(nextPlace.marketSlug);
      if (isPlaceholderHistoryMarket(placeMarketSlug) && meta.marketSlug) nextPlace.marketSlug = meta.marketSlug;
      const placeMarket = toTrimmedText(nextPlace.market);
      if (isPlaceholderHistoryMarket(placeMarket) && meta.market) nextPlace.market = meta.market;
      const placeOutcome = toTrimmedText(nextPlace.outcome);
      if (isPlaceholderHistoryOutcome(placeOutcome) && meta.outcome) nextPlace.outcome = meta.outcome;
      nextScript.place = nextPlace;
    }
    nextPayload.script = nextScript;
  }

  return nextPayload;
};

const buildOrderHistoryMetaLookup = (rows: TrackerMonitorRecord[]) => {
  const byTxAssetSide = new Map<string, OrderHistoryMeta>();
  const byTxAsset = new Map<string, OrderHistoryMeta>();
  const byAssetSide = new Map<string, OrderHistoryMeta>();

  for (const row of rows) {
    if (row.kind !== "event") continue;

    const market = toTrimmedText(row.market);
    const marketSlug = toTrimmedText(row.market_slug);
    const outcome = toTrimmedText(row.outcome);
    const meta: OrderHistoryMeta = { market, marketSlug, outcome };

    if (isPlaceholderHistoryMarket(meta.market) && isPlaceholderHistoryMarket(meta.marketSlug) && isPlaceholderHistoryOutcome(meta.outcome)) {
      continue;
    }

    const txHash = toTrimmedText(row.tx_hash)?.toLowerCase() ?? "";
    const assetId = toTrimmedText(row.asset_id) ?? "";
    const side = toTrimmedText(row.side)?.toUpperCase() ?? "";

    const assignMeta = (map: Map<string, OrderHistoryMeta>, key: string) => {
      if (!key) return;
      const existing = map.get(key);
      map.set(key, existing ? mergeOrderHistoryMeta(existing, meta) : meta);
    };

    assignMeta(byTxAssetSide, `${txHash}|${assetId}|${side}`);
    assignMeta(byTxAsset, `${txHash}|${assetId}`);
    assignMeta(byAssetSide, `${assetId}|${side}`);
  }

  return { byTxAssetSide, byTxAsset, byAssetSide };
};

const enrichOrderHistoryRow = (
  row: TrackerMonitorRecord,
  lookup: ReturnType<typeof buildOrderHistoryMetaLookup>,
): TrackerMonitorRecord => {
  const effectiveStatus = getEffectiveHistoryStatus(row);
  const effectiveFinalStatus = getEffectiveHistoryFinalStatus(row);
  const txHash = toTrimmedText(row.tx_hash)?.toLowerCase() ?? "";
  const assetId = toTrimmedText(row.asset_id) ?? "";
  const side = toTrimmedText(row.side)?.toUpperCase() ?? "";

  const meta = lookup.byTxAssetSide.get(`${txHash}|${assetId}|${side}`)
    || lookup.byTxAsset.get(`${txHash}|${assetId}`)
    || lookup.byAssetSide.get(`${assetId}|${side}`);

  if (!meta) {
    return {
      ...row,
      status: effectiveStatus,
      final_status: effectiveFinalStatus,
    };
  }

  const nextRow: TrackerMonitorRecord = {
    ...row,
    status: effectiveStatus,
    final_status: effectiveFinalStatus,
    market: !isPlaceholderHistoryMarket(toTrimmedText(row.market))
      ? row.market
      : (meta.market ?? meta.marketSlug ?? row.market),
    market_slug: !isPlaceholderHistoryMarket(toTrimmedText(row.market_slug))
      ? row.market_slug
      : (meta.marketSlug ?? meta.market ?? row.market_slug),
    outcome: !isPlaceholderHistoryOutcome(toTrimmedText(row.outcome))
      ? row.outcome
      : (meta.outcome ?? row.outcome),
    request_payload: enrichHistoryPayloadMeta(row.request_payload, meta),
    response_payload: enrichHistoryPayloadMeta(row.response_payload, meta),
  };

  return nextRow;
};

type OrderHistoryFilterStatus = "all" | "matched" | "open" | "cancelled" | "blocked" | "error";

const normalizeOrderHistoryFilterStatus = (value: string | null | undefined): OrderHistoryFilterStatus => {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "matched" || normalized === "open" || normalized === "cancelled" || normalized === "blocked" || normalized === "error") {
    return normalized;
  }
  return "all";
};

const getAllOrderHistory = (
  limit: number,
  walletFilter?: string,
  walletFilters?: string[],
  statusFilter: OrderHistoryFilterStatus = "all",
) => {
  const normalizedFilter = (walletFilter ?? "").trim().toLowerCase();
  const normalizedWalletFilters = new Set(
    (walletFilters ?? [])
      .map((wallet) => wallet.trim().toLowerCase())
      .filter(Boolean),
  );
  const wallets = trackerRuntime.listWallets()
    .map((item) => item.address)
    .filter((address) => {
      if (normalizedWalletFilters.size > 0) return normalizedWalletFilters.has(address);
      if (normalizedFilter) return address === normalizedFilter;
      return true;
    });

  const rows = wallets
    .flatMap((address) => {
      const monitorRows = trackerRuntime.getMonitor(address, Math.max(limit * 4, 1000));
      const metaLookup = buildOrderHistoryMetaLookup(monitorRows);
      return monitorRows
        .filter((row) => row.kind === "order")
        .map((row) => enrichOrderHistoryRow(row, metaLookup));
    })
    .filter((row) => {
      if (statusFilter === "all") return true;
      const effectiveStatus = getEffectiveHistoryStatus(row);
      if (statusFilter === "matched") return effectiveStatus === "matched";
      if (statusFilter === "open") return effectiveStatus === "live_open" || effectiveStatus === "live";
      if (statusFilter === "cancelled") return effectiveStatus === "cancelled_after_timeout";
      if (statusFilter === "blocked") return effectiveStatus === "blocked";
      if (statusFilter === "error") return effectiveStatus === "error";
      return true;
    })
    .sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0))
    .slice(0, limit);

  return rows;
};

const getEffectiveHistoryStatus = (row: TrackerMonitorRecord) => {
  const status = typeof row.status === "string" ? row.status : "";
  const orderKind = typeof row.order_kind === "string" ? row.order_kind : null;
  return normalizeMarketLikeLifecycleStatus(status, orderKind);
};

const getEffectiveHistoryFinalStatus = (row: TrackerMonitorRecord) => {
  const finalStatus = typeof row.final_status === "string" && row.final_status.trim()
    ? row.final_status
    : row.status;
  const orderKind = typeof row.order_kind === "string" ? row.order_kind : null;
  return normalizeMarketLikeLifecycleStatus(finalStatus, orderKind);
};

const getOrderStats = (rows: TrackerMonitorRecord[]) => {
  const total = rows.length;
  const matched = rows.filter((row) => getEffectiveHistoryStatus(row) === "matched").length;
  const open = rows.filter((row) => getEffectiveHistoryStatus(row) === "live_open" || getEffectiveHistoryStatus(row) === "live").length;
  const cancelled = rows.filter((row) => getEffectiveHistoryStatus(row) === "cancelled_after_timeout").length;
  const blocked = rows.filter((row) => getEffectiveHistoryStatus(row) === "blocked").length;
  const failed = rows.filter((row) => getEffectiveHistoryStatus(row) === "error").length;
  const applied = matched;
  const unapplied = cancelled + failed;
  const pending = open;
  const denominator = matched + cancelled + failed;
  const successRate = denominator > 0 ? Number(((matched / denominator) * 100).toFixed(2)) : 0;

  return {
    generatedAt: utcNowIso(),
    total,
    matched,
    open,
    cancelled,
    blocked,
    failed,
    applied,
    unapplied,
    pending,
    successRate,
  };
};

const computePercentile = (values: number[], p: number): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[rank] ?? null;
};

const getLatencyBreakdown = (rows: TrackerMonitorRecord[]) => {
  const toMs = (value: unknown) => {
    const iso = typeof value === "string" ? value.trim() : "";
    if (!iso) return null;
    const ts = Date.parse(iso);
    return Number.isFinite(ts) ? ts : null;
  };

  const detailed = rows.map((row) => {
    const pendingTs = toMs(row.pending_seen_at);
    const minedTs = toMs(row.mined_seen_at);
    const decodedTs = toMs(row.decoded_at);
    const detectedTs = toMs(row.detected_at);
    const postedTs = toMs(row.order_posted_at);
    const visibilityTs = pendingTs ?? minedTs;

    const chainVisibilityToDetectMs = visibilityTs !== null && detectedTs !== null
      ? Math.max(0, detectedTs - visibilityTs)
      : null;
    const minedSeenToDetectMs = minedTs !== null && detectedTs !== null
      ? Math.max(0, detectedTs - minedTs)
      : null;
    const detectToOrderMs = detectedTs !== null && postedTs !== null
      ? Math.max(0, postedTs - detectedTs)
      : (typeof row.detect_to_order_ms === "number" ? row.detect_to_order_ms : null);

    return {
      id: row.id,
      wallet: row.wallet,
      txHash: row.tx_hash ?? null,
      source: row.source,
      sourceStage: row.source_stage ?? null,
      status: row.status,
      pendingSeenAt: row.pending_seen_at ?? null,
      minedSeenAt: row.mined_seen_at ?? null,
      decodedAt: row.decoded_at ?? null,
      detectedAt: row.detected_at ?? null,
      orderPostedAt: row.order_posted_at ?? null,
      chainVisibilityToDetectMs,
      minedSeenToDetectMs,
      detectToOrderMs,
      reconcileStatus: row.reconcile_status ?? null,
    };
  });

  const chainValues = detailed
    .map((item) => item.chainVisibilityToDetectMs)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const minedValues = detailed
    .map((item) => item.minedSeenToDetectMs)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const detectValues = detailed
    .map((item) => item.detectToOrderMs)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  return {
    generatedAt: utcNowIso(),
    samples: detailed.length,
    p95ChainVisibilityToDetectMs: computePercentile(chainValues, 95),
    p95MinedSeenToDetectMs: computePercentile(minedValues, 95),
    p95DetectToOrderMs: computePercentile(detectValues, 95),
    rows: detailed,
  };
};

const appendOrderMonitor = (args: {
  wallet: string;
  source: "ui" | "webhook" | "ws" | "poll";
  requestId: string;
  event: RuntimeNormalizedEvent;
  status: string;
  error: string | null;
  requestPayload: Record<string, unknown> | null;
  responsePayload: Record<string, unknown>;
  detectedAt: string;
  postedAt: string;
  detectToOrderMs: number | null;
  attemptCount: number | null;
  webhookReceivedAt?: string | null;
  decodedAt?: string | null;
}) => {
  const responsePayload = args.responsePayload;
  const requestPayload = args.requestPayload;
  const row: TrackerMonitorRecord = {
    id: args.requestId,
    kind: "order",
    created_at: utcNowIso(),
    wallet: args.wallet,
    source: args.source,
    tx_hash: args.event.tx_hash ?? null,
    market: args.event.market ?? null,
    market_slug: args.event.market_slug ?? null,
    outcome: args.event.outcome ?? null,
    asset_id: args.event.asset_id ?? null,
    side: args.event.side ?? null,
    price: toFloat(args.event.price),
    size: toFloat(args.event.size),
    value_usd: toFloat(args.event.value_usd),
    status: args.status,
    final_status: typeof responsePayload.finalStatus === "string" ? responsePayload.finalStatus : args.status,
    error: args.error,
    detected_at: args.detectedAt,
    order_posted_at: args.postedAt,
    detect_to_order_ms: args.detectToOrderMs,
    attempt_count: args.attemptCount,
    order_kind: typeof responsePayload.orderKind === "string"
      ? responsePayload.orderKind
      : requestPayload && typeof requestPayload.orderKind === "string"
        ? requestPayload.orderKind
        : null,
    order_type: typeof responsePayload.orderType === "string"
      ? responsePayload.orderType
      : requestPayload && typeof requestPayload.orderType === "string"
        ? requestPayload.orderType
        : null,
    quantity_kind: typeof responsePayload.quantityKind === "string"
      ? responsePayload.quantityKind
      : requestPayload && typeof requestPayload.quantityKind === "string"
        ? requestPayload.quantityKind
        : null,
    open_order_id: typeof responsePayload.openOrderId === "string" ? responsePayload.openOrderId : null,
    cancelled_at: typeof responsePayload.cancelledAt === "string" ? responsePayload.cancelledAt : null,
    webhook_received_at: args.webhookReceivedAt ?? null,
    decoded_at: args.decodedAt ?? args.event.decoded_at ?? null,
    source_stage: args.event.source_stage ?? (args.source === "poll" ? "poll" : args.source === "webhook" ? "webhook" : "mined"),
    pending_seen_at: args.event.pending_seen_at ?? null,
    mined_seen_at: args.event.mined_seen_at ?? null,
    reconcile_status: args.event.reconcile_status ?? null,
    request_id: args.requestId,
    request_payload: requestPayload,
    response_payload: responsePayload,
  };
  trackerRuntime.appendMonitor(args.wallet, [row]);
};

const processSessionEvent = async (
  session: BackendCopySession,
  event: RuntimeNormalizedEvent,
  options: { source?: "ws" | "poll" | "webhook"; webhookReceivedAt?: string; decodedAt?: string },
) => {
  const source = options.source ?? "webhook";
  if (!isTradeEvent(event)) return;

  const eventTimestampMs = resolveEventTimestampMs(event);
  if (eventTimestampMs !== null && eventTimestampMs <= session.startAfterMs) {
    return;
  }

  const eventKey = resolveEventKey(event);
  if (!appendSessionEventKey(session, eventKey)) return;
  session.processedCount += 1;
  persistCopySessionsSafe();

  const side = normalizeSideValue(event.side);
  const price = toPositiveFiniteNumber(event.price);
  const size = toPositiveFiniteNumber(event.size);
  if (!side || price === null || size === null) return;
  const marketKey = resolveMarketKey(event);
  const openOrderKey = resolveSessionOpenOrderKey(event, side);

  if (session.config.mode === "buy-wait" && side !== "BUY") {
    appendOrderMonitor({
      wallet: session.walletAddress,
      source,
      requestId: crypto.randomUUID(),
      event,
      status: "blocked",
      error: "buy-wait modunda sadece BUY kopyalanır",
      requestPayload: null,
      responsePayload: { ok: false, status: "blocked", error: "buy_wait_side_filter" },
      detectedAt: normalizeIsoTimestamp(event.seen_at_utc),
      postedAt: utcNowIso(),
      detectToOrderMs: null,
      attemptCount: null,
      webhookReceivedAt: options.webhookReceivedAt ?? null,
      decodedAt: options.decodedAt ?? null,
    });
    return;
  }

  if (!isEventInConfiguredRanges(price, size, session.config)) {
    const rangeDebug = {
      eventCent: Number((price * 100).toFixed(4)),
      eventSize: Number(size.toFixed(6)),
      centRangeMin: session.config.centRangeMin,
      centRangeMax: session.config.centRangeMax,
      shareRangeMin: session.config.shareRangeMin,
      shareRangeMax: session.config.shareRangeMax,
    };
    appendOrderMonitor({
      wallet: session.walletAddress,
      source,
      requestId: crypto.randomUUID(),
      event,
      status: "blocked",
      error: "Event aralık filtrelerine uymadı",
      requestPayload: null,
      responsePayload: { ok: false, status: "blocked", error: "range_filter", details: rangeDebug },
      detectedAt: normalizeIsoTimestamp(event.seen_at_utc),
      postedAt: utcNowIso(),
      detectToOrderMs: null,
      attemptCount: null,
      webhookReceivedAt: options.webhookReceivedAt ?? null,
      decodedAt: options.decodedAt ?? null,
    });
    return;
  }

  const eventTradeUsd = resolveEventTradeUsd(event, session.config.sourceTradeUsd);
  const tradeUsd = calculateTradeUsd(session.config, eventTradeUsd);
  if (!Number.isFinite(tradeUsd) || tradeUsd <= 0) {
    appendOrderMonitor({
      wallet: session.walletAddress,
      source,
      requestId: crypto.randomUUID(),
      event,
      status: "blocked",
      error: "Hesaplanan tradeUsd <= 0",
      requestPayload: null as unknown as Record<string, unknown>,
      responsePayload: { ok: false, status: "blocked", error: "trade_usd_zero" },
      detectedAt: normalizeIsoTimestamp(event.seen_at_utc),
      postedAt: utcNowIso(),
      detectToOrderMs: null,
      attemptCount: null,
      webhookReceivedAt: options.webhookReceivedAt ?? null,
      decodedAt: options.decodedAt ?? null,
    });
    return;
  }

  if (session.config.mode === "buy-wait") {
    if (!marketKey) {
      appendOrderMonitor({
        wallet: session.walletAddress,
        source,
        requestId: crypto.randomUUID(),
        event,
        status: "blocked",
        error: "buy-wait market anahtarı çözümlenemedi",
        requestPayload: null,
        responsePayload: { ok: false, status: "blocked", error: "buy_wait_market_key_missing" },
        detectedAt: normalizeIsoTimestamp(event.seen_at_utc),
        postedAt: utcNowIso(),
        detectToOrderMs: null,
        attemptCount: null,
        webhookReceivedAt: options.webhookReceivedAt ?? null,
        decodedAt: options.decodedAt ?? null,
      });
      return;
    }
    const copiedCount = session.marketBuyCounts[marketKey] || 0;
    if (copiedCount >= session.config.buyWaitLimit) {
      appendOrderMonitor({
        wallet: session.walletAddress,
        source,
        requestId: crypto.randomUUID(),
        event,
        status: "blocked",
        error: "buy-wait limit doldu",
        requestPayload: null,
        responsePayload: { ok: false, status: "blocked", error: "buy_wait_limit" },
        detectedAt: normalizeIsoTimestamp(event.seen_at_utc),
        postedAt: utcNowIso(),
        detectToOrderMs: null,
        attemptCount: null,
        webhookReceivedAt: options.webhookReceivedAt ?? null,
        decodedAt: options.decodedAt ?? null,
      });
      return;
    }
  }

  if (openOrderKey) {
    const existingOpenOrder = session.openOrderKeys[openOrderKey];
    if (existingOpenOrder) {
      appendOrderMonitor({
        wallet: session.walletAddress,
        source,
        requestId: crypto.randomUUID(),
        event,
        status: "blocked",
        error: "Ayni market/outcome icin acik emir zaten var",
        requestPayload: null,
        responsePayload: {
          ok: false,
          status: "blocked",
          error: "open_order_exists",
          details: {
            requestId: existingOpenOrder.requestId,
            orderId: existingOpenOrder.orderId,
            openedAt: existingOpenOrder.openedAt,
            side: existingOpenOrder.side,
          },
        },
        detectedAt: normalizeIsoTimestamp(event.seen_at_utc),
        postedAt: utcNowIso(),
        detectToOrderMs: null,
        attemptCount: null,
        webhookReceivedAt: options.webhookReceivedAt ?? null,
        decodedAt: options.decodedAt ?? null,
      });
      return;
    }
  }

  const assetId = (event.asset_id ?? "").trim();
  const marketSlug = (event.market_slug ?? "").trim();
  const outcome = (event.outcome ?? "").trim();
  const useSlippage = session.config.useSlippage !== false;
  const requestOrderKind: RealTradeOrderKind = useSlippage ? "limit" : "market-like";
  const requestOrderType: RealTradeOrderType = useSlippage ? "GTC" : "FAK";
  const requestQuantityKind = side === "BUY" && !useSlippage ? "usd" : "shares";

  if (!assetId && (!useSlippage || !marketSlug || !outcome)) {
    appendOrderMonitor({
      wallet: session.walletAddress,
      source,
      requestId: crypto.randomUUID(),
      event,
      status: "blocked",
      error: useSlippage ? "market/outcome/asset eksik" : "instant mode için asset eksik",
      requestPayload: null,
      responsePayload: { ok: false, status: "blocked", error: useSlippage ? "market_outcome_asset_missing" : "instant_asset_missing" },
      detectedAt: normalizeIsoTimestamp(event.seen_at_utc),
      postedAt: utcNowIso(),
      detectToOrderMs: null,
      attemptCount: null,
      webhookReceivedAt: options.webhookReceivedAt ?? null,
      decodedAt: options.decodedAt ?? null,
    });
    return;
  }

  const requestId = crypto.randomUUID();
  const requestPayload: Record<string, unknown> = toMonitorRequestPayload({
    marketSlug: marketSlug || undefined,
    market: event.market ?? undefined,
    outcome: outcome || undefined,
    assetId: assetId || undefined,
    side,
    price,
    size,
    tradeUsd,
    slippageCents: useSlippage ? session.config.slippageCents : 0,
    orderKind: requestOrderKind,
    orderType: requestOrderType,
    quantityKind: requestQuantityKind,
  });
  requestPayload.executionWalletId = session.executionWalletId ?? null;
  requestPayload.executionWalletNickname = session.executionWalletNickname ?? null;

  const detectedAt = normalizeIsoTimestamp(event.seen_at_utc);
  session.status = "syncing";
  persistCopySessionsSafe();

  try {
    if (!session.executionWalletId) {
      throw new Error("Session için execution wallet atanmadı");
    }
    const response = await enqueueOrderJob(session.walletAddress, async () => executeRealTradeOrder({
      marketSlug: marketSlug || undefined,
      market: event.market ?? undefined,
      outcome: outcome || undefined,
      assetId: assetId || undefined,
      executionWalletId: session.executionWalletId,
      side,
      price,
      size,
      tradeUsd,
      slippageCents: useSlippage ? session.config.slippageCents : 0,
      walletAddress: session.walletAddress,
      detectedAt,
      source,
      requestId,
      skipMarketLookup: !useSlippage,
    })) as Record<string, unknown>;

    const status = typeof response.status === "string" ? response.status : "error";
    const finalStatus = typeof response.finalStatus === "string" ? response.finalStatus : status;
    const responseOpenOrderId = typeof response.openOrderId === "string" && response.openOrderId.trim()
      ? response.openOrderId.trim()
      : null;
    appendOrderMonitor({
      wallet: session.walletAddress,
      source,
      requestId,
      event,
      status,
      error: typeof response.error === "string" ? response.error : null,
      requestPayload,
      responsePayload: response,
      detectedAt,
      postedAt: typeof response.postedAt === "string" ? response.postedAt : utcNowIso(),
      detectToOrderMs: typeof response.detectToOrderMs === "number" ? response.detectToOrderMs : null,
      attemptCount: typeof response.attemptCount === "number" ? response.attemptCount : null,
      webhookReceivedAt: options.webhookReceivedAt ?? null,
      decodedAt: options.decodedAt ?? null,
    });
    console.log(
      `[order] wallet=${session.walletAddress} status=${status} latency_ms=${typeof response.detectToOrderMs === "number" ? response.detectToOrderMs : "na"} source=${source} market=${marketSlug || event.market || "-"}`,
    );

    if (openOrderKey) {
      if (isOpenOrderLifecycleStatus(finalStatus)) {
        session.openOrderKeys[openOrderKey] = {
          requestId,
          orderId: responseOpenOrderId,
          openedAt: typeof response.postedAt === "string" ? response.postedAt : utcNowIso(),
          marketKey: marketKey ?? "unknown",
          outcomeKey: resolveOutcomeKey(event),
          side,
          status: finalStatus,
        };
      } else {
        delete session.openOrderKeys[openOrderKey];
      }
    }

    if (status === "matched") {
      session.copiedCount += 1;
    } else if (finalStatus === "error" || finalStatus === "cancelled_after_timeout") {
      session.failedCount += 1;
    }
    if (session.config.mode === "buy-wait" && marketKey && shouldConsumeBuyWaitSlot(finalStatus)) {
      session.marketBuyCounts[marketKey] = (session.marketBuyCounts[marketKey] || 0) + 1;
    }
  } catch (error) {
    session.failedCount += 1;
    const postedAt = utcNowIso();
    const detectTs = Date.parse(detectedAt);
    const postedTs = Date.parse(postedAt);
    appendOrderMonitor({
      wallet: session.walletAddress,
      source,
      requestId,
      event,
      status: "error",
      error: error instanceof Error ? error.message : "Real order request failed",
      requestPayload,
      responsePayload: {
        ok: false,
        status: "error",
        error: error instanceof Error ? error.message : "Real order request failed",
      },
      detectedAt,
      postedAt,
      detectToOrderMs: Number.isFinite(detectTs) && Number.isFinite(postedTs) ? Math.max(0, postedTs - detectTs) : null,
      attemptCount: null,
      webhookReceivedAt: options.webhookReceivedAt ?? null,
      decodedAt: options.decodedAt ?? null,
    });
    console.log(
      `[order] wallet=${session.walletAddress} status=error latency_ms=${Number.isFinite(detectTs) && Number.isFinite(postedTs) ? Math.max(0, postedTs - detectTs) : "na"} source=${source} market=${marketSlug || event.market || "-"} err=${error instanceof Error ? error.message : "Real order request failed"}`,
    );
  } finally {
    session.status = "running";
    persistCopySessionsSafe();
  }
};

const processCopySessionsForWalletEvents = async (
  walletAddress: string,
  events: RuntimeNormalizedEvent[],
  options: { source?: "ws" | "poll" | "webhook"; webhookReceivedAt?: string; decodedAt?: string },
) => {
  const sessions = Array.from(copySessions.values()).filter((session) => (
    session.status !== "idle" && session.walletAddress === walletAddress
  ));
  if (!sessions.length || !events.length) return;

  const orderedEvents = [...events].sort((a, b) => {
    const ta = Date.parse(a.seen_at_utc) || 0;
    const tb = Date.parse(b.seen_at_utc) || 0;
    return ta - tb;
  });

  for (const event of orderedEvents) {
    await Promise.allSettled(sessions.map((session) => processSessionEvent(session, event, options)));
  }
};

const resolveProfileFromUrl = (profileUrl: string) => {
  const safeUrl = profileUrl.trim();
  if (!safeUrl) {
    throw new Error("profileUrl is required");
  }

  let lastError = "Python command failed";
  const candidateErrors: string[] = [];

  for (const candidate of PYTHON_COMMAND_CANDIDATES) {
    const [bin, ...baseArgs] = candidate;
    const result = spawnSync(bin, [...baseArgs, PROFILE_SCRIPT_PATH, safeUrl], { encoding: "utf-8" });
    if (result.error) {
      lastError = result.error.message;
      candidateErrors.push(`${bin} ${baseArgs.join(" ")} => ${lastError}`);
      continue;
    }

    if (result.status !== 0) {
      lastError = (result.stderr || result.stdout || `${bin} exited with ${result.status}`).trim();
      candidateErrors.push(`${bin} ${baseArgs.join(" ")} => ${lastError}`);
      continue;
    }

    const output = result.stdout.trim();
    if (!output) {
      throw new Error("Profil scripti boş cevap döndü");
    }

    const parsed = JSON.parse(output) as Record<string, unknown>;
    const proxyWallet = typeof parsed.proxyWallet === "string" ? normalizeWallet(parsed.proxyWallet) : "";
    if (!proxyWallet) {
      throw new Error("Profil çıktısında proxyWallet bulunamadı");
    }

    return { ...parsed, proxyWallet };
  }

  throw new Error(candidateErrors.length > 0 ? candidateErrors.join("\n") : lastError);
};

const fetchEndpoint = async (url: string, address: string): Promise<RawEvent[]> => {
  const requestTs = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
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
  if (!response.ok) {
    throw new Error(`${url} -> HTTP ${response.status}`);
  }
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

const startTracker = (address: string) => {
  const normalizedAddress = normalizeWallet(address);
  if (!normalizedAddress) return;
  if (runtimes.has(normalizedAddress)) return;

  ensureWalletDir(normalizedAddress);
  const state = readState(normalizedAddress);

  let active = true;
  let timeout: NodeJS.Timeout | null = null;
  let isSyncing = false;

  const scheduleNextPoll = (delayMs: number) => {
    if (!active) return;
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => {
      void runSyncCycle();
    }, Math.max(0, delayMs));
  };

  const runSyncCycle = async () => {
    if (!active) return;
    if (isSyncing) return;

    isSyncing = true;
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
    const startedAt = Date.now();
    const seenIds = new Set(state.seen_ids);
    const seenQueue = [...state.seen_queue];

    try {
      const [activityResult, tradesResult] = await Promise.allSettled([
        fetchEndpoint(ACTIVITY_URL, normalizedAddress),
        fetchEndpoint(TRADES_URL, normalizedAddress),
      ]);

      const activity = activityResult.status === "fulfilled" ? activityResult.value : [];
      const trades = tradesResult.status === "fulfilled" ? tradesResult.value : [];

      if (activityResult.status === "rejected" && tradesResult.status === "rejected") {
        const activityError = activityResult.reason instanceof Error ? activityResult.reason.message : String(activityResult.reason);
        const tradesError = tradesResult.reason instanceof Error ? tradesResult.reason.message : String(tradesResult.reason);
        throw new Error(`activity=${activityError}; trades=${tradesError}`);
      }

      const newEvents: NormalizedEvent[] = [];
      for (const [payload, source] of [
        [activity, "activity" as const],
        [trades, "trades" as const],
      ]) {
        for (const item of payload) {
          const eventId = generateEventId(item, source);
          if (seenIds.has(eventId)) continue;
          seenIds.add(eventId);
          seenQueue.push(eventId);
          while (seenQueue.length > MAX_RECENT_SEEN_IDS) {
            const oldest = seenQueue.shift();
            if (oldest) seenIds.delete(oldest);
          }
          newEvents.push(normalizeEvent(item, source));
        }
      }

      if (newEvents.length > 0) {
        appendEvents(normalizedAddress, newEvents.reverse());
      }

      if (active) {
        state.seen_ids = [...seenIds];
        state.seen_queue = seenQueue;
        state.last_check = utcNowIso();
        writeState(normalizedAddress, state);
      }
    } catch (error) {
      appendError(normalizedAddress, error instanceof Error ? error.message : "Unknown polling error");
    } finally {
      isSyncing = false;
      if (active) {
        const elapsedMs = Date.now() - startedAt;
        scheduleNextPoll(Math.max(0, POLL_INTERVAL_MS - elapsedMs));
      }
    }
  };

  void runSyncCycle();
  runtimes.set(normalizedAddress, {
    state,
    stop: () => {
      active = false;
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
    },
  });
};

const stopTracker = (address: string) => {
  const normalizedAddress = normalizeWallet(address);
  const runtime = runtimes.get(normalizedAddress);
  if (!runtime) return;
  runtime.stop();
  runtimes.delete(normalizedAddress);
};


const readJsonBody = async <T>(req: IncomingMessage): Promise<T> => {
  let rawBody = "";
  await new Promise<void>((resolve) => {
    req.on("data", (chunk) => {
      rawBody += chunk.toString();
    });
    req.on("end", () => resolve());
  });

  return rawBody ? (JSON.parse(rawBody) as T) : ({} as T);
};

const extractResponseText = (payload: Record<string, unknown>): string => {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text;
  }

  if (Array.isArray(payload.output)) {
    const textChunks: string[] = [];

    for (const item of payload.output) {
      if (!item || typeof item !== "object") continue;
      const content = (item as { content?: unknown }).content;
      if (!Array.isArray(content)) continue;

      for (const part of content) {
        if (!part || typeof part !== "object") continue;
        const maybeText = (part as { text?: unknown }).text;
        if (typeof maybeText === "string") textChunks.push(maybeText);
      }
    }

    if (textChunks.length > 0) return textChunks.join("\n").trim();
  }

  return "Model boş yanıt döndürdü.";
};

const createPolymarketTrackerPlugin = (): Plugin => ({
  name: "polymarket-local-tracker",
  configureServer(server) {
    fs.mkdirSync(TRACKING_ROOT, { recursive: true });
    fs.mkdirSync(PROFILE_TRADES_ROOT, { recursive: true });
    restoreCopySessions();

    for (const wallet of trackerRuntime.listWallets()) {
      trackerRuntime.startTracker(wallet.address);
    }

    server.middlewares.use(async (req, res, next) => {
      if (!req.url?.startsWith("/api/tracker")) {
        next();
        return;
      }

      const sendJson = (code: number, payload: unknown) => {
        res.statusCode = code;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(payload));
      };

      try {
        if (req.method === "POST" && req.url === "/api/tracker/profile") {
          const parsed = await readJsonBody<{ profileUrl?: string }>(req);
          const profileData = resolveProfileFromUrl(parsed.profileUrl ?? "");
          sendJson(200, profileData);
          return;
        }

        if (req.method === "POST" && req.url === "/api/tracker/start") {
          const parsed = await readJsonBody<{ address?: string }>(req);
          const address = trackerRuntime.normalizeWallet(parsed.address ?? "");
          if (!address) {
            sendJson(400, { error: "address is required" });
            return;
          }

          trackerRuntime.startTracker(address);
          sendJson(200, { ok: true, address, storagePath: trackerRuntime.walletDir(address) });
          return;
        }

        if (req.method === "GET" && req.url?.startsWith("/api/tracker/profile-trades")) {
          const requestUrl = new URL(req.url, "http://localhost");
          const profileUrl = requestUrl.searchParams.get("profileUrl") ?? "";
          const forceRefresh = requestUrl.searchParams.get("forceRefresh") === "1";
          const showBrowser = requestUrl.searchParams.get("showBrowser") === "1";
          if (!profileUrl.trim()) {
            sendJson(400, { error: "profileUrl is required" });
            return;
          }

          const payload = getProfileTradesPayload(profileUrl, { forceRefresh, showBrowser });
          sendJson(200, {
            profileUrl,
            username: payload.username,
            trades: payload.trades,
            source: payload.source,
            refreshedAt: payload.refreshedAt,
            loading: payload.loading,
            isRefreshing: payload.isRefreshing,
            lastError: payload.lastError,
          });
          return;
        }

        if (req.method === "GET" && req.url === "/api/tracker/list") {
          const wallets = trackerRuntime.listWallets();
          sendJson(200, { wallets });
          return;
        }

        if (req.method === "GET" && req.url === "/api/tracker/execution-wallets") {
          sendJson(200, { wallets: listExecutionWalletSummaries() });
          return;
        }

        if (req.method === "POST" && req.url === "/api/tracker/execution-wallets") {
          const parsed = await readJsonBody<{
            nickName?: string;
            privateKey?: string;
            funderAddress?: string;
          }>(req);

          try {
            const wallet = createManagedExecutionWallet({
              nickName: typeof parsed.nickName === "string" ? parsed.nickName : "",
              privateKey: typeof parsed.privateKey === "string" ? parsed.privateKey : "",
              funderAddress: typeof parsed.funderAddress === "string" ? parsed.funderAddress : "",
            });
            sendJson(200, {
              ok: true,
              wallet: toExecutionWalletSummary(wallet),
              wallets: listExecutionWalletSummaries(),
            });
          } catch (error) {
            sendJson(400, { error: error instanceof Error ? error.message : "Wallet eklenemedi" });
          }
          return;
        }

        if (req.method === "PUT" && req.url === "/api/tracker/execution-wallets") {
          const parsed = await readJsonBody<{
            id?: string;
            nickName?: string;
            privateKey?: string;
            funderAddress?: string;
          }>(req);

          try {
            const wallet = updateManagedExecutionWallet({
              id: typeof parsed.id === "string" ? parsed.id : "",
              nickName: typeof parsed.nickName === "string" ? parsed.nickName : "",
              privateKey: typeof parsed.privateKey === "string" ? parsed.privateKey : "",
              funderAddress: typeof parsed.funderAddress === "string" ? parsed.funderAddress : "",
            });
            sendJson(200, {
              ok: true,
              wallet: toExecutionWalletSummary(wallet),
              wallets: listExecutionWalletSummaries(),
            });
          } catch (error) {
            sendJson(400, { error: error instanceof Error ? error.message : "Wallet güncellenemedi" });
          }
          return;
        }

        if (req.method === "POST" && req.url === "/api/tracker/copy-session/start") {
          const parsed = await readJsonBody<{
            addressId?: string;
            walletAddress?: string;
            strategy?: string;
            executionWalletId?: string;
            config?: Record<string, unknown>;
          }>(req);

          const addressId = typeof parsed.addressId === "string" ? parsed.addressId.trim() : "";
          const walletAddress = trackerRuntime.normalizeWallet(parsed.walletAddress ?? "");
          const strategy = normalizeStrategyName(parsed.strategy);
          const executionWallet = resolveExecutionWalletRecord(typeof parsed.executionWalletId === "string" ? parsed.executionWalletId : "");
          if (!addressId || !walletAddress) {
            sendJson(400, { error: "addressId ve walletAddress zorunludur" });
            return;
          }
          if (!executionWallet) {
            sendJson(400, { error: "Gerçek trade için önce bir execution wallet seçin veya ekleyin." });
            return;
          }

          const sessionId = buildSessionId(addressId, strategy);
          const session: BackendCopySession = {
            sessionId,
            addressId,
            walletAddress,
            strategy,
            config: parseCopySessionConfig(parsed.config ?? {}),
            executionWalletId: executionWallet.id,
            executionWalletNickname: executionWallet.nickName,
            status: "running",
            startedAt: utcNowIso(),
            marketBuyCounts: {},
            processedEventKeys: new Set<string>(),
            processedQueue: [],
            processedCount: 0,
            copiedCount: 0,
            failedCount: 0,
            startAfterMs: Date.now(),
            openOrderKeys: {},
          };
          trackerRuntime.startTracker(walletAddress);
          trackerRuntime.triggerImmediateRefresh(walletAddress);
          copySessions.set(sessionId, session);
          persistCopySessionsSafe();
          sendJson(200, { ok: true, session: listCopySessionsPayload().sessions.find((item) => item.sessionId === sessionId) });
          return;
        }

        if (req.method === "POST" && req.url === "/api/tracker/copy-session/stop") {
          const parsed = await readJsonBody<{ addressId?: string; strategy?: string }>(req);
          const addressId = typeof parsed.addressId === "string" ? parsed.addressId.trim() : "";
          const strategy = normalizeStrategyName(parsed.strategy);
          const sessionId = buildSessionId(addressId, strategy);
          const stopped = copySessions.delete(sessionId);
          persistCopySessionsSafe();
          sendJson(200, { ok: true, sessionId, stopped });
          return;
        }

        if (req.method === "GET" && req.url === "/api/tracker/copy-session/list") {
          sendJson(200, listCopySessionsPayload());
          return;
        }

        if (req.method === "POST" && req.url === "/api/tracker/order-history/clear") {
          const parsed = await readJsonBody<{ wallet?: string }>(req).catch(() => ({}));
          const walletFilter = trackerRuntime.normalizeWallet(String(parsed.wallet ?? ""));
          const wallets = walletFilter
            ? [walletFilter]
            : trackerRuntime.listWallets().map((item) => item.address);

          let removed = 0;
          let total = 0;
          for (const wallet of wallets) {
            const result = trackerRuntime.clearOrderHistory(wallet);
            removed += result.removed;
            total += result.total;
          }

          sendJson(200, {
            ok: true,
            wallet: walletFilter || null,
            wallets: wallets.length,
            removed,
            total,
            clearedAt: utcNowIso(),
          });
          return;
        }

        if (req.method === "GET" && req.url?.startsWith("/api/tracker/order-history")) {
          const requestUrl = new URL(req.url, "http://localhost");
          const rawLimit = Number.parseInt(requestUrl.searchParams.get("limit") ?? "", 10);
          const limit = Number.isFinite(rawLimit) && rawLimit > 0
            ? Math.min(rawLimit, 1000)
            : HISTORY_DEFAULT_LIMIT;
          const wallet = requestUrl.searchParams.get("wallet") ?? "";
          const wallets = requestUrl.searchParams.get("wallets");
          const walletFilters = wallets
            ? wallets.split(",").map((item) => trackerRuntime.normalizeWallet(item)).filter(Boolean)
            : [];
          const status = normalizeOrderHistoryFilterStatus(requestUrl.searchParams.get("status"));
          const rows = getAllOrderHistory(limit, wallet, walletFilters, status);
          sendJson(200, { records: rows });
          return;
        }

        if (req.method === "GET" && req.url?.startsWith("/api/tracker/order-stats")) {
          const requestUrl = new URL(req.url, "http://localhost");
          const rawLimit = Number.parseInt(requestUrl.searchParams.get("limit") ?? "", 10);
          const limit = Number.isFinite(rawLimit) && rawLimit > 0
            ? Math.min(rawLimit, 1000)
            : HISTORY_DEFAULT_LIMIT;
          const wallet = requestUrl.searchParams.get("wallet") ?? "";
          const rows = getAllOrderHistory(limit, wallet);
          sendJson(200, getOrderStats(rows));
          return;
        }

        if (req.method === "GET" && req.url?.startsWith("/api/tracker/latency-breakdown")) {
          const requestUrl = new URL(req.url, "http://localhost");
          const rawLimit = Number.parseInt(requestUrl.searchParams.get("limit") ?? "", 10);
          const limit = Number.isFinite(rawLimit) && rawLimit > 0
            ? Math.min(rawLimit, 1000)
            : HISTORY_DEFAULT_LIMIT;
          const wallet = requestUrl.searchParams.get("wallet") ?? "";
          const rows = getAllOrderHistory(limit, wallet);
          sendJson(200, getLatencyBreakdown(rows));
          return;
        }

        if (req.method === "POST" && req.url === "/api/tracker/alchemy-webhook") {
          sendJson(200, {
            ok: true,
            disabled: true,
            mode: "poll-only",
            message: "Alchemy webhook bu sürümde devre dışı. Sistem yalnızca 2s polling ile çalışır.",
            receivedAt: utcNowIso(),
          });
          return;
        }

        if (req.method === "GET" && req.url === "/api/tracker/order-control") {
          sendJson(200, getAutoOrderControlStatus());
          return;
        }

        if (req.method === "POST" && req.url === "/api/tracker/order-control") {
          const parsed = await readJsonBody<{ action?: string; minutes?: number }>(req);
          const action = typeof parsed.action === "string" ? parsed.action.trim().toLowerCase() : "";

          if (action === "disarm") {
            sendJson(200, disarmAutoOrder());
            return;
          }

          if (action === "arm") {
            if (!AUTO_REAL_ORDER_ENABLED) {
              sendJson(400, { error: "Auto-order devre dışı. Önce POLYMARKET_AUTO_ORDER_ENABLED=1 ayarlayın." });
              return;
            }
            if (!hasPrivateKey()) {
              sendJson(400, { error: "POLYMARKET_PRIVATE_KEY ayarlı değil." });
              return;
            }
            sendJson(200, armAutoOrder(parsed.minutes));
            return;
          }

          sendJson(400, { error: "action sadece arm veya disarm olabilir" });
          return;
        }

        if (req.method === "GET" && req.url === "/api/tracker/monitor-summary") {
          sendJson(200, trackerRuntime.getMonitorSummary());
          return;
        }

        if (req.method === "GET" && req.url?.startsWith("/api/tracker/monitor/")) {
          const requestUrl = new URL(req.url, "http://localhost");
          const address = trackerRuntime.normalizeWallet(requestUrl.pathname.replace("/api/tracker/monitor/", ""));
          const rawLimit = Number.parseInt(requestUrl.searchParams.get("limit") ?? "", 10);
          const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 1000) : 200;
          const records = trackerRuntime.getMonitor(address, limit);
          sendJson(200, { address, records });
          return;
        }

        if (req.method === "GET" && req.url?.startsWith("/api/tracker/events/")) {
          const requestUrl = new URL(req.url, "http://localhost");
          const address = trackerRuntime.normalizeWallet(requestUrl.pathname.replace("/api/tracker/events/", ""));
          const rawLimit = Number.parseInt(requestUrl.searchParams.get("limit") ?? "", 10);
          const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 1000) : undefined;
          const events = trackerRuntime.getEvents(address, limit);
          const stats = trackerRuntime.getStats(events);
          sendJson(200, { address, events, stats });
          return;
        }

        if (req.method === "GET" && req.url?.startsWith("/api/tracker/quote")) {
          const requestUrl = new URL(req.url, "http://localhost");
          const market = requestUrl.searchParams.get("market") ?? "";
          const outcome = requestUrl.searchParams.get("outcome") ?? "";

          if (!market || !outcome) {
            sendJson(400, { error: "market and outcome are required" });
            return;
          }

          const quote = await getLiveQuote(market, outcome);
          if (!quote) {
            sendJson(404, { error: "quote could not be resolved" });
            return;
          }

          sendJson(200, quote);
          return;
        }

        if (req.method === "POST" && req.url === "/api/tracker/real-order") {
          const parsed = await readJsonBody<RealTradeOrderRequest>(req);
          const source = (typeof parsed.source === "string" && parsed.source.trim()
            ? parsed.source.trim().toLowerCase()
            : "ui") as "ws" | "poll" | "ui" | "webhook";
          const isManualUiRequest = source === "ui";

          if (!isManualUiRequest) {
            if (!AUTO_REAL_ORDER_ENABLED) {
              sendJson(403, { error: "Auto-order devre dışı. POLYMARKET_AUTO_ORDER_ENABLED=1 gerekli." });
              return;
            }
            if (!isAutoOrderArmed()) {
              sendJson(423, { error: "Auto-order disarmed. Önce /api/tracker/order-control ile arm edin." });
              return;
            }
          }
          const executionWallet = resolveExecutionWalletRecord(typeof parsed.executionWalletId === "string" ? parsed.executionWalletId : "");
          if (!executionWallet) {
            sendJson(400, { error: "Execution wallet seçilmedi veya bulunamadı." });
            return;
          }

          const walletAddress = trackerRuntime.normalizeWallet(parsed.walletAddress ?? "");
          const requestId = (typeof parsed.requestId === "string" && parsed.requestId.trim())
            ? parsed.requestId.trim()
            : crypto.randomUUID();
          const detectedAtCandidate = String(parsed.detectedAt ?? "").trim();
          const detectedAt = detectedAtCandidate && !Number.isNaN(Date.parse(detectedAtCandidate))
            ? new Date(detectedAtCandidate).toISOString()
            : utcNowIso();

          const monitorRequestPayload: Record<string, unknown> = {
            ...toMonitorRequestPayload({
              marketSlug: parsed.marketSlug ?? undefined,
              market: parsed.market ?? undefined,
              outcome: parsed.outcome ?? undefined,
              assetId: parsed.assetId ?? undefined,
              side: parsed.side ?? undefined,
              price: parsed.price ?? undefined,
              size: parsed.size ?? undefined,
              tradeUsd: parsed.tradeUsd ?? undefined,
              slippageCents: parsed.slippageCents ?? undefined,
            }),
          };

          try {
            const payload = await enqueueOrderJob(walletAddress || "__global__", async () => executeRealTradeOrder({
              ...parsed,
              executionWalletId: executionWallet.id,
              requestId,
              source,
              detectedAt,
              walletAddress,
            }));
            if (walletAddress) {
              const responsePayload = payload as Record<string, unknown>;
              const monitorRow: TrackerMonitorRecord = {
                id: requestId,
                kind: "order",
                created_at: utcNowIso(),
                wallet: walletAddress,
                source,
                tx_hash: null,
                market: typeof responsePayload.marketSlug === "string" ? responsePayload.marketSlug : null,
                market_slug: typeof responsePayload.marketSlug === "string" ? responsePayload.marketSlug : null,
                outcome: typeof responsePayload.outcome === "string" ? responsePayload.outcome : null,
                asset_id: typeof responsePayload.assetId === "string" ? responsePayload.assetId : null,
                side: typeof responsePayload.side === "string" ? responsePayload.side : null,
                price: typeof responsePayload.requestedPrice === "number" ? responsePayload.requestedPrice : toFloat(parsed.price),
                size: typeof responsePayload.size === "number" ? responsePayload.size : toFloat(parsed.size),
                value_usd: typeof responsePayload.tradeUsd === "number" ? responsePayload.tradeUsd : toFloat(parsed.tradeUsd),
                status: typeof responsePayload.status === "string" ? responsePayload.status : "error",
                final_status: typeof responsePayload.finalStatus === "string" ? responsePayload.finalStatus : (typeof responsePayload.status === "string" ? responsePayload.status : "error"),
                error: typeof responsePayload.error === "string" ? responsePayload.error : null,
                detected_at: detectedAt,
                order_posted_at: typeof responsePayload.postedAt === "string" ? responsePayload.postedAt : utcNowIso(),
                detect_to_order_ms: typeof responsePayload.detectToOrderMs === "number" ? responsePayload.detectToOrderMs : null,
                attempt_count: typeof responsePayload.attemptCount === "number" ? responsePayload.attemptCount : null,
                order_kind: typeof responsePayload.orderKind === "string" ? responsePayload.orderKind : null,
                order_type: typeof responsePayload.orderType === "string" ? responsePayload.orderType : null,
                quantity_kind: typeof responsePayload.quantityKind === "string" ? responsePayload.quantityKind : null,
                open_order_id: typeof responsePayload.openOrderId === "string" ? responsePayload.openOrderId : null,
                cancelled_at: typeof responsePayload.cancelledAt === "string" ? responsePayload.cancelledAt : null,
                source_stage: source === "poll" ? "poll" : source === "webhook" ? "webhook" : source === "ui" ? null : "mined",
                pending_seen_at: null,
                mined_seen_at: null,
                reconcile_status: null,
                request_id: requestId,
                request_payload: monitorRequestPayload,
                response_payload: responsePayload,
              };
              trackerRuntime.appendMonitor(walletAddress, [monitorRow]);
            }
            sendJson(200, payload);
          } catch (error) {
            const errorPayload = {
              ok: false,
              resultIcon: "❌",
              status: "error",
              error: error instanceof Error ? error.message : "Real trade request failed",
              requestId,
              source,
              detectedAt,
              postedAt: utcNowIso(),
            };
            if (walletAddress) {
              const detectTs = Date.parse(detectedAt);
              const postedTs = Date.parse(errorPayload.postedAt);
              const monitorRow: TrackerMonitorRecord = {
                id: requestId,
                kind: "order",
                created_at: utcNowIso(),
                wallet: walletAddress,
                source,
                tx_hash: null,
                market: parsed.marketSlug ?? parsed.market ?? null,
                market_slug: parsed.marketSlug ?? null,
                outcome: parsed.outcome ?? null,
                asset_id: parsed.assetId ?? null,
                side: parsed.side ?? null,
                price: toFloat(parsed.price),
                size: toFloat(parsed.size),
                value_usd: toFloat(parsed.tradeUsd),
                status: "error",
                final_status: "error",
                error: errorPayload.error,
                detected_at: detectedAt,
                order_posted_at: errorPayload.postedAt,
                detect_to_order_ms: Number.isFinite(detectTs) && Number.isFinite(postedTs)
                  ? Math.max(0, postedTs - detectTs)
                  : null,
                attempt_count: null,
                order_kind: null,
                order_type: null,
                quantity_kind: null,
                open_order_id: null,
                cancelled_at: null,
                source_stage: source === "poll" ? "poll" : source === "webhook" ? "webhook" : source === "ui" ? null : "mined",
                pending_seen_at: null,
                mined_seen_at: null,
                reconcile_status: null,
                request_id: requestId,
                request_payload: monitorRequestPayload,
                response_payload: errorPayload as unknown as Record<string, unknown>,
              };
              trackerRuntime.appendMonitor(walletAddress, [monitorRow]);
            }
            sendJson(200, errorPayload);
          }
          return;
        }

        if (req.method === "POST" && req.url === "/api/tracker/copytrade-advisor") {
          if (!OPENAI_API_KEY) {
            sendJson(500, { error: "OPENAI_API_KEY ayarlı değil" });
            return;
          }
          const parsed = await readJsonBody<{ context?: string }>(req);
          const context = typeof parsed.context === "string" ? parsed.context.trim() : "";
          if (!context) {
            sendJson(400, { error: "context is required" });
            return;
          }

          const userPrompt = `Bütçem yaklaşık $100.

Aşağıdaki veri bir Polymarket kullanıcısının trade/aktivite geçmişidir. 
Bu trader’ı kopyalamayı planlıyorum. Sadece istenen formatta, kısa çıktı üret.

VERİLER:
${context}`;

          const openAiResponse = await fetch("https://api.openai.com/v1/responses", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${OPENAI_API_KEY}`,
            },
            body: JSON.stringify({
              model: OPENAI_MODEL,
              instructions: OPENAI_SYSTEM_INSTRUCTIONS,
              input: userPrompt,
            }),
          });

          if (!openAiResponse.ok) {
            const errorText = await openAiResponse.text();
            sendJson(openAiResponse.status, { error: errorText || "OpenAI request failed" });
            return;
          }

          const payload = await openAiResponse.json() as Record<string, unknown>;
          sendJson(200, {
            model: OPENAI_MODEL,
            analysis: extractResponseText(payload),
          });
          return;
        }

        if (req.method === "DELETE" && req.url?.startsWith("/api/tracker/")) {
          const address = trackerRuntime.normalizeWallet(req.url.replace("/api/tracker/", "").split("?")[0]);
          const removedSessions = removeCopySessionsForWallet(address);
          trackerRuntime.removeTrackerData(address);
          sendJson(200, { ok: true, address, removedSessions, deletedPath: trackerRuntime.walletDir(address) });
          return;
        }

        sendJson(404, { error: "Not found" });
      } catch (error) {
        sendJson(500, { error: error instanceof Error ? error.message : "Server error" });
      }
    });
  },
});

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 244,
    allowedHosts: true,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), createPolymarketTrackerPlugin(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
