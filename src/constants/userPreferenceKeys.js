/** Server preference keys (PostgreSQL user_preferences.pref_key). Do not use localStorage for these. */

export const PREF_APP_SETTINGS = 'app_settings'
export const PREF_WEEKLY_HOLIDAY_DAY = 'weekly_holiday_day'
export const PREF_COMPANY_PAYMENTS = 'company_payments_v1'
export const PREF_SALES_VS_EXPENSES = 'sales_vs_expenses_v1'
export const PREF_NOTIFICATIONS_DISMISSED = 'notifications_dismissed_v1'
export const PREF_SAVED_COMPOSITES = 'saved_composites_v1'
/** Saved composites priced with Composite Items Prices (Custom) shared rates. */
export const PREF_SAVED_COMPOSITES_CUSTOM = 'saved_composites_custom_v1'
/** Saved composites priced from the All Prices (UAE) Special Offers catalog. */
export const PREF_SAVED_COMPOSITES_SPECIAL_OFFERS = 'saved_composites_special_offers_v1'
export const PREF_ALL_PRICES_EC = 'all_prices_ecommerce_v1'
export const PREF_ALL_PRICES_SAVED_LISTS = 'all_prices_saved_lists_v1'
export const PREF_ALL_PRICES_RECOVERY_SNAPSHOTS = 'all_prices_recovery_snapshots_v1'
export const PREF_ALL_PRICES_HISTORY = 'all_prices_history_v1'
export const PREF_ALL_PRICES_CLEANUP_BATCHES = 'all_prices_cleanup_batches_v1'
export const PREF_ALL_PRICES_IMPORT_BATCHES = 'all_prices_import_batches_v1'
/** One-time flag: UAE All Prices working draft + saved lists cleared for wholesale re-paste (2026-06-05). */
export const PREF_ALL_PRICES_UAE_WHOLESALE_RESET = 'all_prices_uae_wholesale_reset_20260605_v1'
/** UAE promotional/offer prices — separate catalog from the standard UAE list, any profit % allowed. */
export const PREF_ALL_PRICES_EC_SPECIAL_OFFERS = 'all_prices_special_offers_v1'
export const PREF_ALL_PRICES_SAVED_LISTS_SPECIAL_OFFERS = 'all_prices_saved_lists_special_offers_v1'
export const PREF_ALL_PRICES_RECOVERY_SNAPSHOTS_SPECIAL_OFFERS = 'all_prices_recovery_snapshots_special_offers_v1'
export const PREF_ALL_PRICES_HISTORY_SPECIAL_OFFERS = 'all_prices_history_special_offers_v1'
export const PREF_ALL_PRICES_CLEANUP_BATCHES_SPECIAL_OFFERS = 'all_prices_cleanup_batches_special_offers_v1'
export const PREF_ALL_PRICES_IMPORT_BATCHES_SPECIAL_OFFERS = 'all_prices_import_batches_special_offers_v1'
/** One-time clear of the special offers draft that inherited the standard UAE table. */
export const PREF_ALL_PRICES_SPECIAL_OFFERS_DRAFT_RESET = 'all_prices_special_offers_draft_reset_20260817_v1'
/** KSA shipment-batch landed-cost pricing (separate from UAE ecommerce calculator). */
export const PREF_KSA_PRICING_STORE = 'ksa_pricing_store_v1'
export const PREF_KSA_PRICING_HISTORY = 'ksa_pricing_history_v1'
/** @deprecated Legacy KSA ecommerce mirror of UAE — superseded by PREF_KSA_PRICING_STORE */
export const PREF_ALL_PRICES_EC_KSA = 'all_prices_ecommerce_ksa_v1'
export const PREF_ALL_PRICES_SAVED_LISTS_KSA = 'all_prices_saved_lists_ksa_v1'
export const PREF_ALL_PRICES_RECOVERY_SNAPSHOTS_KSA = 'all_prices_recovery_snapshots_ksa_v1'
export const PREF_ALL_PRICES_HISTORY_KSA = 'all_prices_history_ksa_v1'
export const PREF_ALL_PRICES_CLEANUP_BATCHES_KSA = 'all_prices_cleanup_batches_ksa_v1'
export const PREF_ALL_PRICES_IMPORT_BATCHES_KSA = 'all_prices_import_batches_ksa_v1'
export const PREF_INFLUENCER_PERF = 'influencer_performance_v1'
export const PREF_INFLUENCER_LIST_COLS = 'influencer_list_col_widths_v1'
/** CEO annual leave view — manual last return date per employee when not in API data. */
export const PREF_CEO_AL_LAST_RETURN_DATES = 'ceo_al_last_return_dates_v1'
export const PREF_AI_PLANNER = 'ai_planner_bundle_v2'
export const PREF_THEME = 'theme_pref_v1'
export const PREF_WEEKLY_SALES_SAVED_REPORTS = 'weekly_sales_saved_reports_v1'
