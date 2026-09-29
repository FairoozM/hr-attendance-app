-- Tabby clearing: one combined settlement journal per statement.
ALTER TABLE tabby_clearing_components DROP CONSTRAINT IF EXISTS tabby_clearing_components_component_check;
ALTER TABLE tabby_clearing_components ADD CONSTRAINT tabby_clearing_components_component_check CHECK (component IN (
  'SALE_NET', 'SALE_CHARGES', 'REFUND_CREDIT_NOTE', 'REFUND_PAYMENT', 'REFUND_COMMISSION_REVERSAL',
  'REFUND_FEE_REVERSAL', 'REFUND_VAT_REVERSAL', 'CHARGE_EXPENSE_CLEARING', 'PAYOUT_FEE', 'SETTLEMENT_JOURNAL', 'BANK_SETTLEMENT'));
