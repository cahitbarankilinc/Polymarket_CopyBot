export type WalletTrackerEvent = {
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
  raw_source: 'activity' | 'trades' | 'ws' | 'webhook';
};

export type MarketQuote = {
  market: string;
  outcome: string;
  assetId: string;
  bid: number | null;
  ask: number | null;
  bidCents: number | null;
  askCents: number | null;
};

export type WalletTrackerInfo = {
  address: string;
  eventCount: number;
  latestEvent: WalletTrackerEvent | null;
  lastCheck: string | null;
  isActive: boolean;
  storagePath: string;
  wsConnected?: boolean;
  lastWsMessageAt?: string | null;
  lastPendingMessageAt?: string | null;
  lastEventDetectedAt?: string | null;
  wsProvider?: string | null;
  httpProvider?: string | null;
};

export type WalletTrackerStats = {
  total: number;
  last24h: number;
  buyTodayUsd: number;
  sellTodayUsd: number;
};

export type WalletEventsResponse = {
  address: string;
  events: WalletTrackerEvent[];
  stats?: WalletTrackerStats;
};

export type CopytradeAdvisorResponse = {
  analysis: string;
  model: string;
};

export type ClosedTrade = {
  closed_market: string;
  closed_result: 'Won' | 'Lost' | string;
  closed_couldwon: number;
  closed_outcome: string;
  closed_cent: number;
  closed_won: number;
  closed_pnl: number;
  closed_procent: number;
};

export type PolymarketProfileResponse = {
  proxyWallet: string;
  username?: string | null;
  trades?: number | null;
  largestWin?: number | null;
  views?: number | null;
  joinDate?: string | null;
  amount?: number | null;
  pnl?: number | null;
  polygonscanUrl?: string | null;
  polygonscanTopTotalValText?: string | null;
};

export type ProfileTradesResponse = {
  profileUrl: string;
  username: string;
  trades: ClosedTrade[];
  source: 'cache' | 'scraped';
  refreshedAt: string | null;
  loading: boolean;
  isRefreshing: boolean;
  lastError?: string | null;
};

export type RealTradeOrderRequest = {
  marketSlug?: string;
  market?: string;
  outcome?: string;
  assetId?: string;
  side: 'BUY' | 'SELL';
  price: number;
  size: number;
  tradeUsd?: number;
  slippageCents: number;
  walletAddress?: string;
  detectedAt?: string;
  source?: 'ws' | 'poll' | 'ui' | 'webhook';
  requestId?: string;
  skipMarketLookup?: boolean;
};

export type RealTradeOrderResult = {
  ok: boolean;
  resultIcon: '✅' | '☑️' | '⏳' | '❌';
  status: 'matched' | 'live' | 'live_open' | 'cancelled_after_timeout' | 'blocked' | 'error' | string;
  finalStatus?: string;
  error?: string;
  marketSlug?: string;
  outcome?: string;
  side?: 'BUY' | 'SELL';
  assetId?: string;
  requestedPrice?: number;
  marketQuotePrice?: number | null;
  limitPrice?: number | null;
  size?: number | null;
  submittedSize?: number | null;
  sourceSize?: number | null;
  sourceValueUsd?: number | null;
  tradeUsd?: number | null;
  slippageCents?: number;
  quantityKind?: 'usd' | 'shares' | string;
  detectedAt?: string;
  postedAt?: string;
  detectToOrderMs?: number | null;
  attemptCount?: number | null;
  source?: 'ws' | 'poll' | 'ui' | 'webhook' | string;
  requestId?: string;
  orderKind?: 'limit' | 'market-like' | string;
  orderType?: 'GTC' | 'FAK' | 'FOK' | 'GTD' | string;
  openOrderId?: string | null;
  cancelledAt?: string | null;
  rawResponse?: Record<string, unknown> | null;
  orderStateResponse?: Record<string, unknown> | null;
  cancelResponse?: Record<string, unknown> | null;
};

export type TrackerMonitorRecord = {
  id: string;
  kind: 'event' | 'order';
  created_at: string;
  wallet: string;
  source: 'ws' | 'poll' | 'ui' | 'webhook';
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
  source_stage?: 'pending' | 'mined' | 'poll' | 'webhook' | null;
  pending_seen_at?: string | null;
  mined_seen_at?: string | null;
  reconcile_status?: 'pending_confirmed' | 'mined_only' | 'poll_only' | 'webhook_ingested' | null;
};

export type TrackerMonitorSummary = {
  generatedAt: string;
  activeRuntimeCount: number;
  wsConnectedCount: number;
  p95DetectToOrderMs: number | null;
  samples: number;
  wsProviders?: string[];
  httpProviders?: string[];
  runtimes: Array<{
    address: string;
    wsConnected: boolean;
    lastWsMessageAt: string | null;
    lastPendingMessageAt?: string | null;
    lastEventDetectedAt: string | null;
    lastCheck: string | null;
    wsProvider?: string | null;
    httpProvider?: string | null;
  }>;
};

export type TrackerLatencyBreakdownRow = {
  id: string;
  wallet: string;
  txHash: string | null;
  source: string;
  sourceStage: string | null;
  status: string;
  pendingSeenAt: string | null;
  minedSeenAt: string | null;
  decodedAt: string | null;
  detectedAt: string | null;
  orderPostedAt: string | null;
  chainVisibilityToDetectMs: number | null;
  minedSeenToDetectMs: number | null;
  detectToOrderMs: number | null;
  reconcileStatus: string | null;
};

export type TrackerLatencyBreakdown = {
  generatedAt: string;
  samples: number;
  p95ChainVisibilityToDetectMs: number | null;
  p95MinedSeenToDetectMs: number | null;
  p95DetectToOrderMs: number | null;
  rows: TrackerLatencyBreakdownRow[];
};

export type AutoOrderControlStatus = {
  enabled: boolean;
  armed: boolean;
  armedUntil: string | null;
  hasPrivateKey: boolean;
  hasFunderAddress: boolean;
  defaultArmMinutes: number;
  maxArmMinutes: number;
};

export type CopySessionConfigPayload = {
  mode: 'notional' | 'proportional' | 'multiplier' | 'fixed-amount' | 'fixed-shares' | 'buy-wait';
  sourceTradeUsd: number;
  leaderFreeBalance: number;
  multiplier: number;
  fixedAmount: number;
  buyWaitLimit: number;
  fixedShares: number;
  sharePrice: number;
  slippageCents: number;
  useSlippage: boolean;
  centRangeMin?: number | null;
  centRangeMax?: number | null;
  shareRangeMin?: number | null;
  shareRangeMax?: number | null;
  budgetBaseUsd: number;
};

export type BackendCopySession = {
  sessionId: string;
  addressId: string;
  walletAddress: string;
  strategy: string;
  status: 'running' | 'syncing' | 'idle';
  startedAt: string;
  processedCount: number;
  copiedCount: number;
  failedCount: number;
};

export type OrderStatsResponse = {
  generatedAt: string;
  total: number;
  matched: number;
  open: number;
  cancelled: number;
  failed: number;
  applied: number;
  unapplied: number;
  pending: number;
  successRate: number;
};

export async function resolvePolymarketProfile(profileUrl: string): Promise<PolymarketProfileResponse> {
  const response = await fetch('/api/tracker/profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profileUrl }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'Profil verisi alınamadı');
  }
  return response.json() as Promise<PolymarketProfileResponse>;
}

export async function startWalletTracking(address: string) {
  const response = await fetch('/api/tracker/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'Takip başlatılamadı');
  }
  return response.json();
}

export async function listTrackedWallets(): Promise<WalletTrackerInfo[]> {
  const response = await fetch('/api/tracker/list', { cache: 'no-store' });
  if (!response.ok) {
    throw new Error('Takip listesi okunamadı');
  }
  const data = await response.json() as { wallets: WalletTrackerInfo[] };
  return data.wallets;
}

export async function getWalletEventsWithStats(
  address: string,
  options?: { limit?: number },
): Promise<WalletEventsResponse> {
  const params = new URLSearchParams();
  if (typeof options?.limit === 'number' && Number.isFinite(options.limit) && options.limit > 0) {
    params.set('limit', String(Math.floor(options.limit)));
  }
  const suffix = params.toString() ? `?${params.toString()}` : '';
  const response = await fetch(`/api/tracker/events/${address.toLowerCase()}${suffix}`, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error('Cüzdan eventleri alınamadı');
  }

  const data = await response.json() as WalletEventsResponse | WalletTrackerEvent[];
  if (Array.isArray(data)) {
    return { address: address.toLowerCase(), events: data };
  }

  return {
    address: data.address ?? address.toLowerCase(),
    events: Array.isArray(data.events) ? data.events : [],
    stats: data.stats,
  };
}

export async function getWalletEvents(address: string): Promise<WalletTrackerEvent[]> {
  const payload = await getWalletEventsWithStats(address);
  return payload.events;
}

export async function stopWalletTracking(address: string) {
  await fetch(`/api/tracker/${address.toLowerCase()}`, { method: 'DELETE' });
}

export async function requestCopytradeAdvisor(context: string): Promise<CopytradeAdvisorResponse> {
  const response = await fetch('/api/tracker/copytrade-advisor', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'OpenAI analizi alınamadı');
  }

  return response.json() as Promise<CopytradeAdvisorResponse>;
}

export async function getMarketQuote(market: string, outcome: string): Promise<MarketQuote> {
  const response = await fetch(`/api/tracker/quote?market=${encodeURIComponent(market)}&outcome=${encodeURIComponent(outcome)}`, {
    cache: 'no-store',
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'Quote alınamadı');
  }

  return response.json() as Promise<MarketQuote>;
}

export async function postRealTradeOrder(payload: RealTradeOrderRequest): Promise<RealTradeOrderResult> {
  const response = await fetch('/api/tracker/real-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'Gerçek trade isteği gönderilemedi');
  }

  return response.json() as Promise<RealTradeOrderResult>;
}

export async function getTrackerMonitor(address: string, limit = 200): Promise<TrackerMonitorRecord[]> {
  const response = await fetch(`/api/tracker/monitor/${address.toLowerCase()}?limit=${Math.max(1, Math.floor(limit))}`, {
    cache: 'no-store',
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'Monitor kayıtları alınamadı');
  }
  const payload = await response.json() as { records?: TrackerMonitorRecord[] };
  return Array.isArray(payload.records) ? payload.records : [];
}

export async function getTrackerMonitorSummary(): Promise<TrackerMonitorSummary> {
  const response = await fetch('/api/tracker/monitor-summary', { cache: 'no-store' });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'Monitor özeti alınamadı');
  }
  return response.json() as Promise<TrackerMonitorSummary>;
}

export async function getAutoOrderControlStatus(): Promise<AutoOrderControlStatus> {
  const response = await fetch('/api/tracker/order-control', { cache: 'no-store' });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'Order kontrol durumu alınamadı');
  }
  return response.json() as Promise<AutoOrderControlStatus>;
}

export async function updateAutoOrderControl(action: 'arm' | 'disarm', minutes?: number): Promise<AutoOrderControlStatus> {
  const response = await fetch('/api/tracker/order-control', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, minutes }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'Order kontrol güncellenemedi');
  }
  return response.json() as Promise<AutoOrderControlStatus>;
}

export async function startCopySession(payload: {
  addressId: string;
  walletAddress: string;
  strategy: string;
  config: CopySessionConfigPayload;
}) {
  const response = await fetch('/api/tracker/copy-session/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'Copy session başlatılamadı');
  }
  return response.json() as Promise<{ ok: true; session: BackendCopySession }>;
}

export async function stopCopySession(payload: {
  addressId: string;
  strategy: string;
}) {
  const response = await fetch('/api/tracker/copy-session/stop', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'Copy session durdurulamadı');
  }
  return response.json() as Promise<{ ok: true; sessionId: string; stopped: boolean }>;
}

export async function listCopySessions(): Promise<{ sessions: BackendCopySession[] }> {
  const response = await fetch('/api/tracker/copy-session/list', { cache: 'no-store' });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'Copy session listesi alınamadı');
  }
  return response.json() as Promise<{ sessions: BackendCopySession[] }>;
}

export async function getOrderHistory(limit = 200, wallet?: string): Promise<{ records: TrackerMonitorRecord[] }> {
  const params = new URLSearchParams();
  params.set('limit', String(Math.max(1, Math.floor(limit))));
  if (wallet?.trim()) params.set('wallet', wallet.trim().toLowerCase());
  const response = await fetch(`/api/tracker/order-history?${params.toString()}`, { cache: 'no-store' });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'Order history alınamadı');
  }
  return response.json() as Promise<{ records: TrackerMonitorRecord[] }>;
}

export async function clearOrderHistory(wallet?: string): Promise<{
  ok: true;
  wallet: string | null;
  wallets: number;
  removed: number;
  total: number;
  clearedAt: string;
}> {
  const response = await fetch('/api/tracker/order-history/clear', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wallet: wallet?.trim() ? wallet.trim().toLowerCase() : undefined }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'Order history temizlenemedi');
  }
  return response.json() as Promise<{
    ok: true;
    wallet: string | null;
    wallets: number;
    removed: number;
    total: number;
    clearedAt: string;
  }>;
}

export async function getOrderStats(limit = 200, wallet?: string): Promise<OrderStatsResponse> {
  const params = new URLSearchParams();
  params.set('limit', String(Math.max(1, Math.floor(limit))));
  if (wallet?.trim()) params.set('wallet', wallet.trim().toLowerCase());
  const response = await fetch(`/api/tracker/order-stats?${params.toString()}`, { cache: 'no-store' });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'Order istatistikleri alınamadı');
  }
  return response.json() as Promise<OrderStatsResponse>;
}

export async function getLatencyBreakdown(limit = 200, wallet?: string): Promise<TrackerLatencyBreakdown> {
  const params = new URLSearchParams();
  params.set('limit', String(Math.max(1, Math.floor(limit))));
  if (wallet?.trim()) params.set('wallet', wallet.trim().toLowerCase());
  const response = await fetch(`/api/tracker/latency-breakdown?${params.toString()}`, { cache: 'no-store' });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'Latency breakdown alınamadı');
  }
  return response.json() as Promise<TrackerLatencyBreakdown>;
}

export async function getProfileTrades(
  profileUrl: string,
  options?: { forceRefresh?: boolean; showBrowser?: boolean },
): Promise<ProfileTradesResponse> {
  const params = new URLSearchParams({ profileUrl });
  if (options?.forceRefresh) params.set('forceRefresh', '1');
  if (options?.showBrowser) params.set('showBrowser', '1');

  const response = await fetch(`/api/tracker/profile-trades?${params.toString()}`, {
    cache: 'no-store',
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'Profil trade verisi alınamadı');
  }

  return response.json() as Promise<ProfileTradesResponse>;
}
