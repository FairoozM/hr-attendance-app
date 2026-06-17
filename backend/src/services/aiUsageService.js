const { query } = require('../db')

function utcDayStart(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0))
}

function utcMonthStart(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0))
}

async function sumSuccessfulCostSince(sinceIso) {
  const r = await query(
    `SELECT COALESCE(SUM(estimated_cost_usd), 0)::float8 AS s
     FROM ai_usage_logs
     WHERE request_status = 'success' AND created_at >= $1`,
    [sinceIso]
  )
  return Number(r.rows[0]?.s || 0)
}

async function getTodaySuccessfulSpend() {
  return sumSuccessfulCostSince(utcDayStart().toISOString())
}

async function getMonthSuccessfulSpend() {
  return sumSuccessfulCostSince(utcMonthStart().toISOString())
}

async function insertUsageLog(row) {
  const r = await query(
    `INSERT INTO ai_usage_logs (
      user_id, module_name, action_name, model,
      input_tokens, output_tokens, total_tokens, estimated_cost_usd,
      request_status, error_message, request_duration_ms
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    RETURNING id`,
    [
      row.user_id,
      row.module_name,
      row.action_name,
      row.model,
      row.input_tokens,
      row.output_tokens,
      row.total_tokens,
      row.estimated_cost_usd,
      row.request_status,
      row.error_message ?? null,
      row.request_duration_ms != null ? Number(row.request_duration_ms) : null,
    ]
  )
  return r.rows[0]
}

async function listRecentLogs(limit = 50) {
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200)
  const r = await query(
    `SELECT l.id, l.user_id, u.username AS user_username,
            l.module_name, l.action_name, l.model,
            l.input_tokens, l.output_tokens, l.total_tokens, l.estimated_cost_usd,
            l.request_status, l.error_message, l.request_duration_ms, l.created_at
     FROM ai_usage_logs l
     LEFT JOIN users u ON u.id = l.user_id
     ORDER BY l.created_at DESC
     LIMIT $1`,
    [lim]
  )
  return r.rows
}

async function getDailyTrend(days = 14) {
  const d = Math.min(Math.max(Number(days) || 14, 1), 90)
  const r = await query(
    `SELECT (created_at AT TIME ZONE 'UTC')::date AS day,
            COALESCE(SUM(estimated_cost_usd), 0)::float8 AS cost_usd,
            COALESCE(SUM(total_tokens), 0)::bigint AS tokens,
            COUNT(*)::int AS requests
     FROM ai_usage_logs
     WHERE request_status = 'success'
       AND created_at >= NOW() - ($1::int * INTERVAL '1 day')
     GROUP BY 1
     ORDER BY 1 ASC`,
    [d]
  )
  return r.rows.map((row) => ({
    day: row.day,
    cost_usd: Number(row.cost_usd),
    tokens: Number(row.tokens),
    requests: Number(row.requests),
  }))
}

async function getModelUsageMonth() {
  const monthStart = utcMonthStart().toISOString()
  const r = await query(
    `SELECT model,
            COUNT(*)::int AS requests,
            COALESCE(SUM(estimated_cost_usd), 0)::float8 AS cost_usd,
            COALESCE(SUM(total_tokens), 0)::bigint AS tokens
     FROM ai_usage_logs
     WHERE request_status = 'success' AND created_at >= $1
     GROUP BY model
     ORDER BY cost_usd DESC`,
    [monthStart]
  )
  return r.rows.map((row) => ({
    model: row.model,
    requests: Number(row.requests),
    cost_usd: Number(row.cost_usd),
    tokens: Number(row.tokens),
  }))
}

async function aggregateDashboard() {
  const todayStart = utcDayStart().toISOString()
  const monthStart = utcMonthStart().toISOString()

  const todayCost = await sumSuccessfulCostSince(todayStart)
  const monthCost = await sumSuccessfulCostSince(monthStart)

  const tokensRow = await query(
    `SELECT COALESCE(SUM(total_tokens), 0)::bigint AS t
     FROM ai_usage_logs
     WHERE request_status = 'success'`
  )
  const totalTokensAllTime = Number(tokensRow.rows[0]?.t || 0)

  const productsRow = await query(
    `SELECT (
       (SELECT COUNT(*)::int FROM amazon_generated_listings) +
       (SELECT COUNT(*)::int FROM amazon_listing_generations)
     ) AS c`
  )
  const productsGenerated = Number(productsRow.rows[0]?.c || 0)

  const avgRow = await query(
    `SELECT
       COUNT(*)::int AS n,
       COALESCE(SUM(estimated_cost_usd), 0)::float8 AS cost_sum
     FROM ai_usage_logs
     WHERE request_status = 'success' AND created_at >= $1`,
    [monthStart]
  )
  const n = Number(avgRow.rows[0]?.n || 0)
  const costSum = Number(avgRow.rows[0]?.cost_sum || 0)
  const avgCostPerRequest = n > 0 ? Math.round((costSum / n) * 1e6) / 1e6 : 0

  const failedRow = await query(
    `SELECT COUNT(*)::int AS c FROM ai_usage_logs
     WHERE created_at >= $1 AND request_status NOT IN ('success')`,
    [monthStart]
  )
  const failedRequestsMonth = Number(failedRow.rows[0]?.c || 0)

  const byModule = await query(
    `SELECT module_name,
            COALESCE(SUM(estimated_cost_usd), 0)::float8 AS cost_usd,
            COUNT(*)::int AS requests
     FROM ai_usage_logs
     WHERE request_status = 'success' AND created_at >= $1
     GROUP BY module_name
     ORDER BY cost_usd DESC`,
    [monthStart]
  )

  return {
    todayCost,
    monthCost,
    totalTokensAllTime,
    productsGenerated,
    avgCostPerRequest,
    failedRequestsMonth,
    byModule: byModule.rows,
  }
}

module.exports = {
  utcDayStart,
  utcMonthStart,
  sumSuccessfulCostSince,
  getTodaySuccessfulSpend,
  getMonthSuccessfulSpend,
  insertUsageLog,
  listRecentLogs,
  aggregateDashboard,
  getDailyTrend,
  getModelUsageMonth,
}
