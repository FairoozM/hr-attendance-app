-- Noon's live catalog, from the Noon Partner API Impex export `noon_catalog_catalogexport`.
--
-- Two jobs. First, `sku_child` is the same identifier the Noon orders export calls `sku`, so this is
-- what maps Noon's opaque psku (`ZCCE27171F660309F7B2FZ-1`) to our own item code
-- (`SPHMGL-S-24-BLACK`) — without it the report lists Noon orders under identifiers nobody can read.
--
-- Second, `active_price` is the last-resort value for an order Noon has published no money for at
-- all, which is the normal state of a day only hours old: the OMS orders export carries no money, the
-- finance report waits for settlement 1–8 days out, and the per-SKU sales report is about two days
-- behind. Measured against 22 settled Noon UAE orders, `active_price` matched the settled net
-- proceeds exactly 19 times and was too high 3 times where the price had changed since the order.
-- It is therefore an estimate, and the report labels every amount taken from it as one.
--
-- `price` is the struck-through figure, not a selling price, and is stored only so the two are never
-- confused.

CREATE TABLE IF NOT EXISTS noon_catalog_prices (
  id BIGSERIAL PRIMARY KEY,
  country_code TEXT NOT NULL,
  noon_sku TEXT NOT NULL,
  psku_code TEXT,
  partner_sku TEXT,
  noon_title TEXT,
  active_price NUMERIC(14,2),
  strikethrough_price NUMERIC(14,2),
  seller_price_min NUMERIC(14,2),
  noon_status TEXT,
  is_active BOOLEAN,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (country_code, noon_sku)
);
