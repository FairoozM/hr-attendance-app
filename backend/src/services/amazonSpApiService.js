/**
 * Amazon Selling Partner API (LWA access token + REST calls).
 * Uses process.env (load dotenv in entrypoints/scripts). Never logs secrets or full tokens.
 */

const axios = require('axios');
const zlib = require('zlib');
const amazonRateLimit = require('./amazonRateLimitService');
const {
  MAX_AMAZON_RETRIES,
  MAX_SYNC_RANGE_DAYS,
  MAX_CATALOG_IMAGE_ASINS_PER_REQUEST,
  SYNC_CREATED_BEFORE_BUFFER_MS,
} = require('../config/amazonSpApiGuardrails');
const {
  SELLERS_MARKETPLACE_PARTICIPATIONS_PATH,
  ORDERS_PATH,
  orderItemsPath,
  CATALOG_ITEMS_2022_PATH,
  FBA_INVENTORY_SUMMARIES_PATH,
  REPORTS_2021_PATH,
  reportPath,
  reportDocumentPath,
} = require('../config/amazonSpApiVersions');

const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';
const DEFAULT_USER_AGENT = 'LifeSmile-HRBI-SPAPI-Sandbox-Test/1.0';

const SANDBOX_DEFAULT_MARKETPLACE_ID = 'ATVPDKIKX0DER';
const AMAZON_LISTINGS_REPORT_TYPE = 'GET_MERCHANT_LISTINGS_DATA';

/** @returns {'production'|'sandbox'} */
function getAmazonSpApiMode() {
  const m = String(process.env.AMAZON_SP_API_MODE || '').trim().toLowerCase();
  return m === 'production' ? 'production' : 'sandbox';
}

/** @returns {'uae'|'ksa'} */
function normalizeMarketplaceKey(marketplaceKey) {
  const k = String(marketplaceKey == null ? 'uae' : marketplaceKey)
    .trim()
    .toLowerCase();
  return k === 'ksa' ? 'ksa' : 'uae';
}

/**
 * Resolved SP-API host + LWA credentials + default catalog marketplace id for a region.
 * @param {string} [marketplaceKey='uae'] - "uae" | "ksa" (sandbox ignores region for LWA; same single app credentials)
 */
function getAmazonConfig(marketplaceKey = 'uae') {
  const key = normalizeMarketplaceKey(marketplaceKey);
  const mode = getAmazonSpApiMode();

  if (mode === 'production') {
    const isKsa = key === 'ksa';
    return {
      mode,
      marketplaceKey: key,
      endpoint: String(process.env.AMAZON_PROD_SP_API_ENDPOINT || '').trim(),
      lwaClientId: String(isKsa ? process.env.AMAZON_KSA_LWA_CLIENT_ID : process.env.AMAZON_UAE_LWA_CLIENT_ID || '').trim(),
      lwaClientSecret: String(
        isKsa ? process.env.AMAZON_KSA_LWA_CLIENT_SECRET : process.env.AMAZON_UAE_LWA_CLIENT_SECRET || ''
      ).trim(),
      refreshToken: String(isKsa ? process.env.AMAZON_KSA_REFRESH_TOKEN : process.env.AMAZON_UAE_REFRESH_TOKEN || '').trim(),
      defaultMarketplaceId: String(
        isKsa ? process.env.AMAZON_KSA_MARKETPLACE_ID : process.env.AMAZON_UAE_MARKETPLACE_ID || ''
      ).trim(),
    };
  }

  const endpoint =
    String(process.env.AMAZON_SP_API_ENDPOINT || '').trim() ||
    String(process.env.AMAZON_SANDBOX_SP_API_ENDPOINT || '').trim();

  return {
    mode: 'sandbox',
    marketplaceKey: key,
    endpoint,
    lwaClientId: String(process.env.AMAZON_LWA_CLIENT_ID || '').trim(),
    lwaClientSecret: String(process.env.AMAZON_LWA_CLIENT_SECRET || '').trim(),
    refreshToken: String(process.env.AMAZON_REFRESH_TOKEN || '').trim(),
    defaultMarketplaceId: SANDBOX_DEFAULT_MARKETPLACE_ID,
  };
}

function missingLwaFieldsForConfig(cfg) {
  const missing = [];
  if (!cfg.lwaClientId) missing.push('client id');
  if (!cfg.lwaClientSecret) missing.push('client secret');
  if (!cfg.refreshToken) missing.push('refresh token');
  return missing;
}

function normalizeApiPath(p) {
  const s = String(p || '').trim();
  if (!s) {
    const err = new Error('Amazon SP-API path is required');
    err.code = 'AMAZON_SPAPI_INVALID_PATH';
    throw err;
  }
  return s.startsWith('/') ? s : `/${s}`;
}

/**
 * Build absolute URL: SP-API base + path (same rules as test-amazon-spapi-sandbox.js).
 * @param {string} endpointRaw
 * @param {string} apiPath
 */
function buildSpApiUrl(endpointRaw, apiPath) {
  const path = normalizeApiPath(apiPath);
  const trimmed = String(endpointRaw || '').trim();
  try {
    const u = new URL(trimmed);
    if (!u.hostname || !u.protocol.startsWith('http')) {
      const err = new Error('Invalid SP-API endpoint URL');
      err.code = 'AMAZON_SPAPI_INVALID_ENDPOINT';
      throw err;
    }
    const base = `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
    return `${base}${path}`;
  } catch (e) {
    if (e.code === 'AMAZON_SPAPI_INVALID_ENDPOINT' || e.code === 'AMAZON_SPAPI_INVALID_PATH') {
      throw e;
    }
    const err = new Error('Invalid SP-API endpoint URL');
    err.code = 'AMAZON_SPAPI_INVALID_ENDPOINT';
    throw err;
  }
}

/**
 * Exchange refresh token for an LWA access token (same request shape as test-amazon-lwa-token.js).
 * @param {string} [marketplaceKey='uae'] - which seller app / region in production
 * @returns {Promise<string>}
 */
async function getAmazonAccessToken(marketplaceKey = 'uae') {
  const mk = normalizeMarketplaceKey(marketplaceKey);
  const cfg = getAmazonConfig(mk);
  const miss = missingLwaFieldsForConfig(cfg);
  if (miss.length > 0) {
    const err = new Error(`Missing Amazon LWA configuration (${cfg.mode}, ${cfg.marketplaceKey})`);
    err.code = 'AMAZON_LWA_CONFIG';
    err.missingParts = miss;
    throw err;
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: cfg.refreshToken,
    client_id: cfg.lwaClientId,
    client_secret: cfg.lwaClientSecret,
  });

  const { data, status } = await axios.post(LWA_TOKEN_URL, body.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    validateStatus: () => true,
  });

  if (status !== 200 || !data || typeof data.access_token !== 'string') {
    const err = new Error('LWA_TOKEN_FAILED');
    err.code = 'AMAZON_LWA_TOKEN_FAILED';
    err.lwaStatus = status;
    err.lwaBody = data;
    throw err;
  }

  return data.access_token;
}

function pickRateLimitHeader(res) {
  if (!res || !res.headers) return null;
  const h = res.headers['x-amzn-ratelimit-limit'] || res.headers['x-amzn-RateLimit-Limit'];
  return h != null ? String(h).slice(0, 512) : null;
}

/** Amazon correlation id (safe to surface to admins / support). Case-insensitive header match. */
function pickAmazonRequestId(res) {
  if (!res || !res.headers || typeof res.headers !== 'object') return null;
  const h = res.headers;
  const direct =
    h['x-amzn-requestid'] ||
    h['x-amzn-RequestId'] ||
    h['x-amzn-request-id'] ||
    h['x-amzn-Request-ID'];
  if (direct != null) {
    const s = String(direct).trim();
    return s ? s.slice(0, 128) : null;
  }
  for (const [key, val] of Object.entries(h)) {
    if (val == null) continue;
    const k = String(key).toLowerCase();
    if (k === 'x-amzn-requestid' || k === 'x-amzn-request-id') {
      const s = String(val).trim();
      return s ? s.slice(0, 128) : null;
    }
  }
  return null;
}

function describeAmazonSpApiFailure(result, operation, marketplaceKey) {
  if (result && result.status >= 200 && result.status < 300) return null;
  const err = buildAmazonSpHttpErrorFromResult(
    result || { status: 0, data: null, amazonRequestId: null },
    operation,
    marketplaceKey
  );
  return {
    operation: err.operation,
    marketplaceKey: err.marketplaceKey,
    statusCode: err.statusCode,
    safeErrorMessage: err.safeErrorMessage,
    amazonRequestId: err.amazonRequestId,
  };
}

/**
 * @param {{ status: number, data: object | null, amazonRequestId?: string | null }} result
 * @param {string} operation
 * @param {string} marketplaceKey
 */
function buildAmazonSpHttpErrorFromResult(result, operation, marketplaceKey) {
  const mk = normalizeMarketplaceKey(marketplaceKey);
  const op = String(operation || 'genericSpApi').slice(0, 64);
  const statusCode = Number(result && result.status);
  const sc = Number.isFinite(statusCode) ? statusCode : 0;
  const safeErrorMessage =
    safeAmazonErrorSnippet(result && result.data) || (sc ? `HTTP ${sc}` : 'Amazon SP-API request failed');
  const msg = String(safeErrorMessage).slice(0, 500);
  const err = new Error(msg);
  err.name = 'AmazonSpApiHttpError';
  err.code = 'AMAZON_SP_HTTP';
  err.statusCode = sc;
  err.amazonRequestId =
    result && result.amazonRequestId != null && String(result.amazonRequestId).trim()
      ? String(result.amazonRequestId).trim().slice(0, 128)
      : null;
  err.safeErrorMessage = msg;
  err.operation = op;
  err.marketplaceKey = mk;
  return err;
}

/**
 * Throw when SP-API returned a non-2xx after retries (for controller flows).
 * @param {{ status: number, data: object | null, amazonRequestId?: string | null }} result
 * @param {string} operation
 * @param {string} marketplaceKey
 */
function throwAmazonSpApiIfFailed(result, operation, marketplaceKey) {
  if (!result || result.status < 200 || result.status >= 300) {
    throw buildAmazonSpHttpErrorFromResult(result || { status: 0, data: null }, operation, marketplaceKey);
  }
}

/** HTTP status to return to browser for an upstream Amazon failure (never pass 2xx). */
function suggestedClientHttpStatusForAmazonUpstream(statusCode) {
  const n = Number(statusCode);
  if (!Number.isFinite(n) || n < 400 || n >= 600) return 502;
  return n;
}

/**
 * JSON body fragment for AMAZON_SP_HTTP (no secrets).
 * @param {Error & { code?: string, statusCode?: number, amazonRequestId?: string|null, safeErrorMessage?: string }} err
 */
function amazonSpApiHttpErrorJson(err) {
  if (!err || err.code !== 'AMAZON_SP_HTTP') return null;
  const out = {
    success: false,
    error: err.safeErrorMessage != null ? String(err.safeErrorMessage).slice(0, 500) : String(err.message || '').slice(0, 500),
    statusCode: Number.isFinite(Number(err.statusCode)) ? Number(err.statusCode) : 502,
  };
  if (err.amazonRequestId) out.amazonRequestId = String(err.amazonRequestId).slice(0, 128);
  return out;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeAmazonErrorSnippet(data) {
  if (!data || typeof data !== 'object') return null;
  if (Array.isArray(data.errors) && data.errors[0]) {
    const e = data.errors[0];
    const c = e.code != null ? String(e.code) : '';
    const m = e.message != null ? String(e.message).slice(0, 400) : '';
    return [c, m].filter(Boolean).join(': ').slice(0, 500) || null;
  }
  return null;
}

/**
 * Single HTTP round-trip to SP-API (no guard / no retry). Use safeAmazonRequest for live calls.
 * @returns {Promise<{ status: number, data: object | null, rateLimitHeader: string | null, amazonRequestId: string | null, retryAfterMs: number }>}
 */
async function callAmazonSpApiHttp(path, options = {}) {
  const {
    marketplaceKey = 'uae',
    method = 'GET',
    headers: extraHeaders = {},
    params,
    paramsSerializer,
    data,
    timeout,
  } = options;

  const mk = normalizeMarketplaceKey(marketplaceKey);
  const cfg = getAmazonConfig(mk);

  if (!cfg.endpoint) {
    const err = new Error(
      cfg.mode === 'production'
        ? 'AMAZON_PROD_SP_API_ENDPOINT is not set'
        : 'AMAZON_SP_API_ENDPOINT or AMAZON_SANDBOX_SP_API_ENDPOINT is not set'
    );
    err.code = 'AMAZON_SPAPI_CONFIG';
    throw err;
  }

  const url = buildSpApiUrl(cfg.endpoint, path);
  const accessToken = await getAmazonAccessToken(mk);

  const res = await axios({
    method: String(method || 'GET').toUpperCase(),
    url,
    params,
    paramsSerializer,
    data,
    timeout,
    headers: {
      'x-amz-access-token': accessToken,
      'user-agent': DEFAULT_USER_AGENT,
      accept: 'application/json',
      ...extraHeaders,
    },
    validateStatus: () => true,
    responseType: 'text',
    transformResponse: [(body) => body],
  });

  const status = res.status;
  const rateLimitHeader = pickRateLimitHeader(res);
  const amazonRequestId = pickAmazonRequestId(res);
  let retryAfterMs = 0;
  const raH = res.headers && (res.headers['retry-after'] || res.headers['Retry-After']);
  if (raH != null) {
    const n = parseInt(String(raH), 10);
    if (Number.isFinite(n)) retryAfterMs = Math.min(120_000, Math.max(0, n * 1000));
  }
  const text = typeof res.data === 'string' ? res.data : String(res.data ?? '');
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }

  return { status, data: parsed, rateLimitHeader, amazonRequestId, retryAfterMs };
}

async function callAmazonReportDocument(url, options = {}) {
  const href = String(url || '').trim();
  if (!href || !/^https:\/\//i.test(href)) {
    const err = new Error('Invalid Amazon report document URL');
    err.code = 'AMAZON_REPORT_DOCUMENT_URL';
    throw err;
  }
  const res = await axios({
    method: 'GET',
    url: href,
    timeout: options.timeout || 60_000,
    responseType: 'arraybuffer',
    transformResponse: [(body) => body],
    validateStatus: () => true,
  });
  let buffer = Buffer.from(res.data || Buffer.alloc(0));
  if (String(options.compressionAlgorithm || '').trim().toUpperCase() === 'GZIP') {
    buffer = zlib.gunzipSync(buffer);
  }
  return {
    status: res.status,
    data: buffer.toString('utf8'),
    rateLimitHeader: pickRateLimitHeader(res),
    amazonRequestId: pickAmazonRequestId(res),
    retryAfterMs: 0,
  };
}

/**
 * Guarded SP-API call with spacing, logging, and limited 429 retries (no secrets logged).
 * @param {string} operation - e.g. getOrders, getOrderItems
 * @param {string} marketplaceKey
 * @param {() => Promise<{ status: number, data: object | null, rateLimitHeader: string | null, amazonRequestId: string | null, retryAfterMs?: number }>} exec
 */
async function safeAmazonRequest(operation, marketplaceKey, exec) {
  const mk = normalizeMarketplaceKey(marketplaceKey);
  const backoffs = [2000, 5000, 10000];
  const maxAttempts = Math.max(1, MAX_AMAZON_RETRIES);
  let last = { status: 0, data: null, rateLimitHeader: null, amazonRequestId: null, retryAfterMs: 0 };

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    await amazonRateLimit.waitForAmazonOperation(operation, mk);
    let result;
    try {
      result = await exec();
    } catch (e) {
      const msg = e && e.message ? String(e.message).slice(0, 400) : 'sp_api_error';
      await amazonRateLimit.recordAmazonApiCall(operation, mk, {
        success: false,
        safeError: msg,
        amazonRequestId: null,
      });
      throw e;
    }

    last = result;
    const success = result.status >= 200 && result.status < 300;
    const safeErr = success ? null : safeAmazonErrorSnippet(result.data) || `HTTP ${result.status}`;
    await amazonRateLimit.recordAmazonApiCall(operation, mk, {
      statusCode: result.status,
      rateLimitHeader: result.rateLimitHeader,
      success,
      safeError: safeErr,
      amazonRequestId: result.amazonRequestId || null,
    });

    if (success) {
      return {
        status: result.status,
        data: result.data,
        amazonRequestId: result.amazonRequestId || null,
        rateLimitHeader: result.rateLimitHeader || null,
      };
    }

    if (result.status === 429 && attempt < maxAttempts - 1) {
      const waitMs = (backoffs[attempt] || 10000) + (result.retryAfterMs || 0);
      await sleep(waitMs);
      continue;
    }

    return {
      status: result.status,
      data: result.data,
      amazonRequestId: result.amazonRequestId || null,
      rateLimitHeader: result.rateLimitHeader || null,
    };
  }

  return {
    status: last.status,
    data: last.data,
    amazonRequestId: last.amazonRequestId || null,
    rateLimitHeader: last.rateLimitHeader || null,
  };
}

/**
 * Call SP-API with guardrails (spacing + 429 retries + audit log).
 * Pass `amazonOperation` on options: getOrders | getOrderItems | getMarketplaceParticipations | searchCatalogItems | genericSpApi
 * @param {string} path
 * @param {object} [options]
 */
async function callAmazonSpApi(path, options = {}) {
  const opts = { ...options };
  const op = opts.amazonOperation || 'genericSpApi';
  delete opts.amazonOperation;
  const mk = opts.marketplaceKey != null ? opts.marketplaceKey : 'uae';
  return safeAmazonRequest(op, mk, () => callAmazonSpApiHttp(path, opts));
}

/**
 * GET /sellers/v1/marketplaceParticipations
 * @param {object} [options]
 * @param {string} [options.marketplaceKey='uae']
 * @returns {Promise<{ status: number, data: object | null }>}
 */
async function getMarketplaceParticipations(options = {}) {
  const opts = options && typeof options === 'object' ? options : {};
  const mk = normalizeMarketplaceKey(opts.marketplaceKey != null ? opts.marketplaceKey : 'uae');
  return callAmazonSpApi(SELLERS_MARKETPLACE_PARTICIPATIONS_PATH, {
    marketplaceKey: mk,
    amazonOperation: 'getMarketplaceParticipations',
  });
}

/** Amazon examples often use second precision (no millis). */
function iso8601Z(d) {
  if (typeof d === 'string') {
    const parsed = new Date(d);
    if (!Number.isNaN(parsed.getTime())) return iso8601Z(parsed);
    return d;
  }
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * GET /orders/v0/orders (sandbox-friendly defaults).
 * When `MarketplaceIds` is omitted, uses the first marketplace from `getMarketplaceParticipations()`
 * so the ID matches the seller account (e.g. EU vs US); falls back to config default marketplace id.
 *
 * @param {object} [params]
 * @param {string} [params.marketplaceKey='uae']
 * @param {string} [params.MarketplaceIds] - comma-separated marketplace id(s); default from participations or config default
 * @param {string} [params.CreatedAfter] - ISO 8601; defaults to seven days ago (UTC)
 * @param {string} [params.CreatedBefore] - ISO 8601; defaults to ~2+ minutes ago
 * @param {boolean} [params.preferConfigMarketplaceId] - when true and MarketplaceIds unset, use config default before participations
 * @returns {Promise<{ status: number, data: object | null }>}
 */
async function getAmazonOrders(params = {}) {
  const p = params && typeof params === 'object' ? params : {};
  const mk = normalizeMarketplaceKey(p.marketplaceKey != null ? p.marketplaceKey : 'uae');
  const cfg = getAmazonConfig(mk);

  let marketplaceIds =
    p.MarketplaceIds != null && String(p.MarketplaceIds).trim()
      ? String(p.MarketplaceIds).trim()
      : '';
  if (!marketplaceIds && p.preferConfigMarketplaceId) {
    marketplaceIds = cfg.defaultMarketplaceId ? String(cfg.defaultMarketplaceId).trim() : '';
  }
  if (!marketplaceIds) {
    try {
      const { status, data } = await getMarketplaceParticipations({ marketplaceKey: mk });
      if (status === 200 && data && Array.isArray(data.payload) && data.payload.length > 0) {
        const first = data.payload[0]?.marketplace?.id;
        if (typeof first === 'string' && first.trim()) {
          marketplaceIds = first.trim();
        }
      }
    } catch (_) {
      /* fall through to static default */
    }
    if (!marketplaceIds) {
      marketplaceIds = cfg.defaultMarketplaceId || SANDBOX_DEFAULT_MARKETPLACE_ID;
    }
  }

  const idList = marketplaceIds.split(',').map((s) => s.trim()).filter(Boolean);
  const marketplaceIdParams =
    idList.length > 0 ? idList : [cfg.defaultMarketplaceId || SANDBOX_DEFAULT_MARKETPLACE_ID];

  const now = new Date();
  const sevenDaysAgo = iso8601Z(
    new Date(now.getTime() - MAX_SYNC_RANGE_DAYS * 24 * 60 * 60 * 1000)
  );
  const windowEnd = iso8601Z(new Date(now.getTime() - SYNC_CREATED_BEFORE_BUFFER_MS));

  let createdAfter = p.CreatedAfter;
  if (createdAfter == null || !String(createdAfter).trim()) {
    createdAfter = sevenDaysAgo;
  } else {
    createdAfter = iso8601Z(String(createdAfter).trim());
  }
  let createdBefore = p.CreatedBefore;
  if (createdBefore == null || !String(createdBefore).trim()) {
    createdBefore = windowEnd;
  } else {
    createdBefore = iso8601Z(String(createdBefore).trim());
  }

  const queryParams = {
    MarketplaceIds: marketplaceIdParams,
    CreatedAfter: createdAfter,
    CreatedBefore: createdBefore,
  };
  if (p.MaxResultsPerPage != null && Number.isFinite(Number(p.MaxResultsPerPage))) {
    const n = Math.floor(Number(p.MaxResultsPerPage));
    queryParams.MaxResultsPerPage = Math.min(100, Math.max(1, n));
  }

  return callAmazonSpApi(ORDERS_PATH, {
    marketplaceKey: mk,
    method: 'GET',
    params: queryParams,
    paramsSerializer: { indexes: null },
    amazonOperation: 'getOrders',
  });
}

/** Whitelist only non-PII catalog / fulfillment fields (excludes buyer, tax address, gift message, etc.). */
const SAFE_ORDER_ITEM_KEYS = [
  'ASIN',
  'SellerSKU',
  'Title',
  'QuantityOrdered',
  'QuantityShipped',
  'ItemPrice',
  'PromotionDiscount',
  'IsGift',
  'ConditionId',
];

/**
 * Pick safe fields from one Orders API `OrderItem` object.
 * @param {object} row
 * @returns {object | null}
 */
function mapAmazonOrderItemSafe(row) {
  if (!row || typeof row !== 'object') return null;
  const out = {};
  for (const key of SAFE_ORDER_ITEM_KEYS) {
    if (Object.prototype.hasOwnProperty.call(row, key)) {
      out[key] = row[key];
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * GET /orders/v0/orders/{amazonOrderId}/orderItems
 * @param {string} amazonOrderId
 * @param {object} [options]
 * @param {string} [options.marketplaceKey='uae']
 * @param {string} [options.NextToken] - pagination (optional)
 * @returns {Promise<{ status: number, data: object | null }>}
 */
async function getAmazonOrderItems(amazonOrderId, options = {}) {
  const id = String(amazonOrderId ?? '').trim();
  if (!id) {
    const err = new Error('amazonOrderId is required');
    err.code = 'AMAZON_ORDER_ID_REQUIRED';
    throw err;
  }
  const opts = options && typeof options === 'object' ? options : {};
  const mk = normalizeMarketplaceKey(opts.marketplaceKey != null ? opts.marketplaceKey : 'uae');
  const path = orderItemsPath(id);
  const params = {};
  if (opts.NextToken != null && String(opts.NextToken).trim()) {
    params.NextToken = String(opts.NextToken).trim();
  }
  const callOpts = {
    marketplaceKey: mk,
    method: 'GET',
    paramsSerializer: { indexes: null },
    amazonOperation: 'getOrderItems',
  };
  if (Object.keys(params).length > 0) {
    callOpts.params = params;
  }
  return callAmazonSpApi(path, callOpts);
}

/**
 * GET /catalog/2022-04-01/items (search catalog items).
 * Default keywords=pan; default marketplace id from config when `marketplaceIds` is omitted.
 *
 * @param {object} [params]
 * @param {string} [params.marketplaceKey='uae']
 * @param {string} [params.marketplaceIds] - comma-separated; first id used (API allows one marketplace for this operation)
 * @param {string} [params.keywords] - comma-separated keywords
 * @param {string|string[]} [params.identifiers] - when set, keywords are omitted
 * @param {string} [params.identifiersType] - required by Amazon when identifiers are sent
 * @param {string|string[]} [params.includedData] - dataset names (array or comma-separated)
 * @returns {Promise<{ status: number, data: object | null }>}
 */
async function searchAmazonCatalogItems(params = {}) {
  const p = params && typeof params === 'object' ? params : {};
  const mk = normalizeMarketplaceKey(p.marketplaceKey != null ? p.marketplaceKey : 'uae');
  const cfg = getAmazonConfig(mk);

  const marketplaceIdsRaw =
    p.marketplaceIds != null && String(p.marketplaceIds).trim()
      ? String(p.marketplaceIds).trim()
      : cfg.defaultMarketplaceId || SANDBOX_DEFAULT_MARKETPLACE_ID;
  const firstMarketplaceId =
    marketplaceIdsRaw.split(',').map((s) => s.trim()).filter(Boolean)[0] ||
    cfg.defaultMarketplaceId ||
    SANDBOX_DEFAULT_MARKETPLACE_ID;

  let identifiersList = [];
  if (p.identifiers != null) {
    if (Array.isArray(p.identifiers)) {
      identifiersList = p.identifiers.map((x) => String(x).trim()).filter(Boolean);
    } else {
      identifiersList = String(p.identifiers)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
    identifiersList = identifiersList.slice(0, MAX_CATALOG_IMAGE_ASINS_PER_REQUEST);
  }

  const queryParams = {
    marketplaceIds: firstMarketplaceId,
  };

  if (identifiersList.length > 0) {
    queryParams.identifiers = identifiersList.join(',');
    if (p.identifiersType != null && String(p.identifiersType).trim()) {
      queryParams.identifiersType = String(p.identifiersType).trim();
    }
  } else {
    const kwRaw =
      p.keywords != null && String(p.keywords).trim() ? String(p.keywords).trim() : 'pan';
    const kwList = kwRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, MAX_CATALOG_IMAGE_ASINS_PER_REQUEST);
    queryParams.keywords = kwList.length > 0 ? kwList : ['pan'];
  }

  if (p.includedData != null) {
    let parts = []
    if (Array.isArray(p.includedData)) {
      parts = p.includedData.map((x) => String(x).trim()).filter(Boolean)
    } else {
      const raw = String(p.includedData).trim()
      if (raw) parts = raw.split(',').map((s) => s.trim()).filter(Boolean)
    }
    if (parts.length > 0) {
      queryParams.includedData = parts.join(',')
    }
  }

  return callAmazonSpApi(CATALOG_ITEMS_2022_PATH, {
    marketplaceKey: mk,
    method: 'GET',
    params: queryParams,
    paramsSerializer: { indexes: null },
    amazonOperation: 'searchCatalogItems',
  });
}

function marketplaceIdForKey(marketplaceKey) {
  const mk = normalizeMarketplaceKey(marketplaceKey);
  const cfg = getAmazonConfig(mk);
  return cfg.defaultMarketplaceId || SANDBOX_DEFAULT_MARKETPLACE_ID;
}

async function createAmazonListingsReport(params = {}) {
  const p = params && typeof params === 'object' ? params : {};
  const mk = normalizeMarketplaceKey(p.marketplaceKey != null ? p.marketplaceKey : 'uae');
  const marketplaceId = String(p.marketplaceId || marketplaceIdForKey(mk)).trim();
  const reportType = String(p.reportType || AMAZON_LISTINGS_REPORT_TYPE).trim() || AMAZON_LISTINGS_REPORT_TYPE;
  return callAmazonSpApi(REPORTS_2021_PATH, {
    marketplaceKey: mk,
    method: 'POST',
    data: {
      reportType,
      marketplaceIds: [marketplaceId],
    },
    amazonOperation: 'createListingsReport',
  });
}

async function getAmazonReport(reportId, options = {}) {
  const opts = options && typeof options === 'object' ? options : {};
  const mk = normalizeMarketplaceKey(opts.marketplaceKey != null ? opts.marketplaceKey : 'uae');
  return callAmazonSpApi(reportPath(reportId), {
    marketplaceKey: mk,
    method: 'GET',
    amazonOperation: 'getListingsReport',
  });
}

async function getAmazonReportDocument(reportDocumentId, options = {}) {
  const opts = options && typeof options === 'object' ? options : {};
  const mk = normalizeMarketplaceKey(opts.marketplaceKey != null ? opts.marketplaceKey : 'uae');
  return callAmazonSpApi(reportDocumentPath(reportDocumentId), {
    marketplaceKey: mk,
    method: 'GET',
    amazonOperation: 'getListingsReportDocument',
  });
}

async function downloadAmazonReportDocument(url, options = {}) {
  const opts = options && typeof options === 'object' ? options : {};
  const mk = normalizeMarketplaceKey(opts.marketplaceKey != null ? opts.marketplaceKey : 'uae');
  return safeAmazonRequest('downloadListingsReportDocument', mk, () => callAmazonReportDocument(url, opts));
}

async function getAmazonFbaInventorySummaries(params = {}) {
  const p = params && typeof params === 'object' ? params : {};
  const mk = normalizeMarketplaceKey(p.marketplaceKey != null ? p.marketplaceKey : 'uae');
  const marketplaceId = String(p.marketplaceId || marketplaceIdForKey(mk)).trim();
  const queryParams = {
    granularityType: 'Marketplace',
    granularityId: marketplaceId,
    marketplaceIds: [marketplaceId],
    details: 'true',
  };
  if (p.nextToken != null && String(p.nextToken).trim()) {
    queryParams.nextToken = String(p.nextToken).trim();
  }
  if (p.startDateTime != null && String(p.startDateTime).trim()) {
    queryParams.startDateTime = String(p.startDateTime).trim();
  }
  const sellerSkus = Array.isArray(p.sellerSkus)
    ? p.sellerSkus.map((x) => String(x).trim()).filter(Boolean).slice(0, 50)
    : [];
  if (sellerSkus.length > 0) {
    queryParams.sellerSkus = sellerSkus;
  }
  return callAmazonSpApi(FBA_INVENTORY_SUMMARIES_PATH, {
    marketplaceKey: mk,
    method: 'GET',
    params: queryParams,
    paramsSerializer: { indexes: null },
    amazonOperation: 'getFbaInventorySummaries',
  });
}

module.exports = {
  getAmazonSpApiMode,
  normalizeMarketplaceKey,
  getAmazonConfig,
  getAmazonAccessToken,
  callAmazonSpApi,
  getMarketplaceParticipations,
  getAmazonOrders,
  getAmazonOrderItems,
  mapAmazonOrderItemSafe,
  searchAmazonCatalogItems,
  marketplaceIdForKey,
  createAmazonListingsReport,
  getAmazonReport,
  getAmazonReportDocument,
  downloadAmazonReportDocument,
  getAmazonFbaInventorySummaries,
  AMAZON_LISTINGS_REPORT_TYPE,
  buildAmazonSpHttpErrorFromResult,
  describeAmazonSpApiFailure,
  throwAmazonSpApiIfFailed,
  suggestedClientHttpStatusForAmazonUpstream,
  amazonSpApiHttpErrorJson,
};
