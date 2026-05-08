ALTER TABLE purchase_low_stock_items
  ADD COLUMN IF NOT EXISTS total_sales_last_3_months NUMERIC(12, 2) NOT NULL DEFAULT 0;
