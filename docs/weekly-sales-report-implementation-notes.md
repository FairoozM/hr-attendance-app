# Weekly Sales Report Implementation Notes

## Files Touched For Phase 1
- `backend/src/controllers/weeklyReportsController.js`
- `backend/src/services/zohoService.js`
- `backend/src/services/weeklyReportZohoData.js`
- `backend/src/integrations/zoho/weeklyReportZohoTransactions.js`
- `backend/src/services/weeklyReportCache.js`
- `src/hooks/useWeeklySalesReport.js`
- `src/pages/reports/WeeklySalesReportPage.jsx`
- `src/pages/reports/WeeklyCombinedSalesReportPage.jsx`

## Current Data Path
`WeeklySalesReportPage.jsx` increments `loadToken`, `useWeeklySalesReport.js` calls
`GET /api/weekly-reports/by-group/:group`, and `weeklyReportsController.loadWeeklyReportPayload()`
wraps `zohoService.getInventoryByGroup()` in the weekly report cache. `getInventoryByGroup()`
loads `item_report_groups` members, intersects them with Zoho Inventory items, applies Zoho
transaction maps, then aggregates item rows into family rows.

## Current Export Path
Live Excel export calls `GET /api/weekly-reports/by-group/:group/export.xlsx`, which rebuilds the
same cached report payload and writes the workbook with `weeklyReportXlsxService`. Opened saved
snapshots export from the saved snapshot in the browser so they do not require a live Zoho reload.

## Current Saved Snapshot Path
Weekly Sales saved snapshots are stored in `user_preferences` under
`PREF_WEEKLY_SALES_SAVED_REPORTS`. Weekly Ads uses the server-side
`weekly_ads_report_history` PostgreSQL table and can be used as a model for a later Weekly Sales
history migration.

## Risk Points Found
- Opening stock is reconstructed from current stock and transaction deltas; it is not a direct
  Zoho historical inventory snapshot.
- Closing stock can be current/live item stock, not necessarily a historical stock-as-of the report
  end date.
- Value columns use mixed valuation rules: item `rate`, `purchase_rate`, implied sales average, and
  vendor credit line totals depending on data availability.
- Sales normally uses `/inventory/v1/reports/salesbyitem`; invoice detail is a fallback.
- Bills and vendor credits are cached and may be filtered by vendor/contact configuration.
- Report result cache and transaction caches protect Zoho quotas but make cache status important
  for operator trust.
- Pagination truncation, fallback use, and source warnings must be visible in the UI, not only logs.
