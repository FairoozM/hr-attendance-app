# Weekly Sales Stock Movement Source Investigation

Generated at: 2026-05-18T13:55:46.705Z

## Scope

- Investigation only. No production calculation, frontend, export, saved snapshot, or quantity-column changes were made.
- Probes use the existing `zohoInventoryJsonRequest` client, including OAuth, rate guards, safe-stop, usage logging, and bounded retries.
- Each candidate endpoint was probed with page `1` only and a small `per_page` limit.
- Probe date window: `2026-05-01` to `2026-05-18`.
- Warehouse filter: not requested.

## Existing Code Support

- Existing weekly report transaction support is in `backend/src/integrations/zoho/weeklyReportZohoTransactions.js`.
- Existing current stock support comes from `GET /inventory/v1/items` through `backend/src/integrations/zoho/zohoInventoryClient.js`.
- Existing purchase return support uses `GET /inventory/v1/vendorcredits` through `backend/src/integrations/zoho/zohoTransactionsCache.js` and detail fallback in `weeklyReportZohoTransactions.js`.
- Existing composite support uses `GET /inventory/v1/compositeitems` and `GET /inventory/v1/compositeitems/:id` through `backend/src/services/compositeItemsZohoLookup.js`.
- Existing docs already identify adjustments, transfers, stock corrections, and a complete stock ledger as missing for exact historical stock reconstruction.

## Endpoint Probe Results

| Source | Endpoint tested | Status | Date filter | Warehouse filter | item_id/SKU | Quantity movement | Value/cost amount | Needed for accurate reconstruction | Notes |
|---|---|---|---|---|---|---|---|---|---|
| Item adjustments / inventory adjustments | `/inventory/v1/itemadjustments` | unavailable | unavailable | unavailable | unavailable | unavailable | unavailable | yes | ZOHO_API_ERROR: Zoho API HTTP 404 for /inventory/v1/itemadjustments: {"code":5,"message":"Invalid URL Passed"} |
| Item adjustments / inventory adjustments | `/inventory/v1/inventoryadjustments` | available | yes | yes | yes | yes | yes | yes | rows=5 |
| Item adjustments / inventory adjustments | `/inventory/v1/adjustments` | unavailable | unavailable | unavailable | unavailable | unavailable | unavailable | yes | ZOHO_API_ERROR: Zoho API HTTP 404 for /inventory/v1/adjustments: {"code":5,"message":"Invalid URL Passed"} |
| Warehouse transfers / transfer orders | `/inventory/v1/transferorders` | unclear | unclear | unclear | unclear | unclear | unclear | yes | rows=0; endpoint reachable but no sample rows returned |
| Warehouse transfers / transfer orders | `/inventory/v1/warehousetransfers` | unavailable | unavailable | unavailable | unavailable | unavailable | unavailable | yes | ZOHO_API_ERROR: Zoho API HTTP 404 for /inventory/v1/warehousetransfers: {"code":5,"message":"Invalid URL Passed"} |
| Warehouse transfers / transfer orders | `/inventory/v1/inventorytransfers` | unavailable | unavailable | unavailable | unavailable | unavailable | unavailable | yes | ZOHO_API_ERROR: Zoho API HTTP 404 for /inventory/v1/inventorytransfers: {"code":5,"message":"Invalid URL Passed"} |
| Sales returns / credit notes | `/inventory/v1/creditnotes` | available | yes | unclear | yes | yes | yes | yes | rows=3 |
| Sales returns / credit notes | `/inventory/v1/salesreturns` | available | yes | unclear | yes | yes | yes | yes | rows=2 |
| Sales returns / credit notes | `/inventory/v1/returns` | unavailable | unavailable | unavailable | unavailable | unavailable | unavailable | yes | ZOHO_API_ERROR: Zoho API HTTP 404 for /inventory/v1/returns: {"code":5,"message":"Invalid URL Passed"} |
| Purchase returns | `/inventory/v1/vendorcredits` | unclear | unclear | unclear | unclear | unclear | unclear | yes | Used today for returned_to_wholesale, but not a complete purchase return/stock reconstruction source.; rows=0; endpoint reachable but no sample rows returned |
| Stock ledger / stock tracking | `/inventory/v1/reports/stocktracking` | unavailable | unavailable | unavailable | unavailable | unavailable | unavailable | yes | ZOHO_API_ERROR: Zoho API HTTP 404 for /inventory/v1/reports/stocktracking: {"code":5,"message":"We couldnt find any resource for the given ID. Please verify the ID and try again."} |
| Stock ledger / stock tracking | `/inventory/v1/reports/inventorydetails` | unavailable | unavailable | unavailable | unavailable | unavailable | unavailable | yes | ZOHO_API_ERROR: Zoho API HTTP 404 for /inventory/v1/reports/inventorydetails: {"code":5,"message":"We couldnt find any resource for the given ID. Please verify the ID and try again."} |
| Composite / bundle stock movement | `/inventory/v1/compositeitems` | available | not applicable | not applicable | yes | yes | yes | yes | Existing code uses list/detail for BOM lookup, not stock movement reconstruction.; rows=5 |

## Detected Fields

### /inventory/v1/inventoryadjustments

- Top-level keys: code, inventory_adjustments, message, page_context
- Row keys: adjustment_type, created_by_id, created_by_name, created_time, custom_field_hash, custom_fields, date, description, inventory_adjustment_id, item_id, last_modified_by_id, last_modified_by_name, last_modified_time, name, quantity_adjusted, reason, reference_number, status, tags, total, value_adjusted, warehouse_id, warehouse_name
- Nested line keys: 
- Item fields: created_by_name, item_id, last_modified_by_name, name, warehouse_name
- Quantity fields: quantity_adjusted
- Value/cost fields: total, value_adjusted
- Date fields: created_time, date, last_modified_time
- Warehouse/location fields: warehouse_id, warehouse_name

### /inventory/v1/creditnotes

- Top-level keys: code, creditnotes, message, page_context
- Row keys: applied_invoices, balance, client_viewed_time, color_code, created_time, creditnote_id, creditnote_number, currency_code, currency_id, current_sub_status, current_sub_status_id, customer_id, customer_name, date, exchange_rate, has_attachment, is_emailed, is_viewed_by_client, issued_date, item_price, item_quantity, item_total, item_total_price, item_total_without_tax, last_modified_time, price_precision, reference_number, rounding_mode, salesperson_id, salesperson_name, status, tags, template_id, template_type, total
- Nested line keys: 
- Item fields: customer_name, salesperson_name
- Quantity fields: balance, item_quantity
- Value/cost fields: exchange_rate, item_price, item_total, item_total_price, item_total_without_tax, price_precision, total
- Date fields: created_time, date, issued_date, last_modified_time
- Warehouse/location fields: 

### /inventory/v1/salesreturns

- Top-level keys: code, message, page_context, salesreturns
- Row keys: bcy_total, created_time, creditnotes_number, currency_code, currency_id, customer_id, customer_name, date, last_modified_time, non_receive_quantity, price_precision, quantity, quantity_received, quantity_yet_to_receive, receive_status, refund_status, refunded_amount, return_amount, sales_channel, salesorder_id, salesorder_number, salesreturn_id, salesreturn_number, salesreturn_status
- Nested line keys: 
- Item fields: customer_name
- Quantity fields: non_receive_quantity, quantity, quantity_received, quantity_yet_to_receive
- Value/cost fields: bcy_total, price_precision, refunded_amount, return_amount
- Date fields: created_time, date, last_modified_time
- Warehouse/location fields: 

### /inventory/v1/compositeitems

- Top-level keys: code, composite_items, message, page_context
- Row keys: account_id, account_name, actual_available_stock, assembly_type, available_stock, brand, can_be_purchased, can_be_sold, category_id, category_name, combo_type, composite_item_id, created_time, description, dimension_unit, dimensions_with_unit, ean, height, image_document_id, image_name, image_type, is_combo_product, is_linked_with_zohocrm, is_returnable, is_taxable, isbn, item_type, label_rate, last_modified_time, length, manufacturer, maximum_order_quantity, minimum_order_quantity, name, part_number, product_type, purchase_account_id, purchase_account_name, purchase_description, purchase_rate, rate, reorder_level, sku, source, status, stock_on_hand, tax_category_code, tax_category_name, tax_exemption_code, tax_exemption_id, tax_id, tax_name, tax_percentage, track_inventory, track_serial_number, unit, upc, weight, weight_unit, weight_with_unit, width
- Nested line keys: 
- Item fields: account_name, category_name, composite_item_id, image_name, name, purchase_account_name, sku, tax_category_name, tax_name
- Quantity fields: actual_available_stock, available_stock, maximum_order_quantity, minimum_order_quantity, stock_on_hand
- Value/cost fields: label_rate, purchase_rate, rate
- Date fields: created_time, last_modified_time
- Warehouse/location fields: 

## Final Summary

### 1. Can we reconstruct historical Opening Stock Value and Closing Stock Value accurately from available APIs?

Not safely yet. The current API coverage is not enough to claim exact historical stock value reconstruction because at least one required movement source is unavailable or unproven in these probes, and date/warehouse filtering was not fully proven by small list calls alone.

### 2. Which movement sources are available?

- Item adjustments / inventory adjustments: `/inventory/v1/inventoryadjustments`
- Sales returns / credit notes: `/inventory/v1/creditnotes`, `/inventory/v1/salesreturns`
- Composite / bundle stock movement: `/inventory/v1/compositeitems`
- Reachable but unclear from this probe: Warehouse transfers / transfer orders: `/inventory/v1/transferorders`
- Reachable but unclear from this probe: Purchase returns: `/inventory/v1/vendorcredits`

### 3. Which movement sources are missing?

- Stock ledger / stock tracking: no tested endpoint was available in this probe.

### 4. Which ones include value amount vs only quantity?

- Includes value/cost-like fields: Item adjustments / inventory adjustments.
- Includes value/cost-like fields: Sales returns / credit notes.
- Includes value/cost-like fields: Composite / bundle stock movement.

### 5. Recommended calculation strategy now

- Do not replace Opening Stock Value or Closing Stock Value logic yet.
- Continue showing the existing `report_meta` warning that historical stock values are reconstructed/current-live and incomplete.
- Before production calculation changes, validate reachable movement endpoints against Zoho UI exports for the same date range, warehouse, and item set.
- If exact value fields are unavailable for movements, reconstruct quantities from a complete stock ledger and value them with an explicit, documented costing basis rather than mixing current item rates with historical movements silently.
- Treat composite items separately: BOM endpoints describe components, but they do not by themselves prove bundle assembly/disassembly stock movement history.
- Treat endpoints with zero returned rows as reachable but unproven; run targeted probes against known adjustment, transfer, return, and vendor-credit document dates before implementation.

## Deep Probe: Available / Unclear Movement Sources

Second-pass investigation for endpoints that were available or unclear in the first pass.

- Each endpoint: `GET` list with **no date filter**, then `GET` list with `from_date` / `to_date`, then `GET /endpoint/:id` for the first document when available.
- Date range tested: `2026-05-01` to `2026-05-18`.
- Page `1`, `per_page` = 5 only. Existing Zoho client rate guards used.

| Endpoint | List works | Detail works | Date filter works | Doc date field | Line array field | Item id | SKU | Qty field | Value/cost field | Warehouse field | Stock direction | Include in reconstruction? |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `/inventory/v1/inventoryadjustments` | yes | yes | unclear | date | line_items | item_id | sku | quantity_adjusted | item_total | warehouse_id | depends on adjustment_type and sign of quantity_adjusted | Candidate for inclusion after Zoho UI validation — has list (+ detail if needed), item mapping, quantity, and value or costing path. |
| `/inventory/v1/creditnotes` | yes | yes | unclear | date | line_items | item_id | sku | quantity | rate | warehouse_id | typically increases stock when received (customer return); confirm receive_status on salesreturns | Candidate for inclusion after Zoho UI validation — has list (+ detail if needed), item mapping, quantity, and value or costing path. |
| `/inventory/v1/salesreturns` | yes | yes | unclear | date | line_items | item_id | sku | quantity | rate | warehouse_id | typically increases stock when received (customer return); confirm receive_status on salesreturns | Candidate for inclusion after Zoho UI validation — has list (+ detail if needed), item mapping, quantity, and value or costing path. |
| `/inventory/v1/vendorcredits` | yes | yes | unclear | date | line_items | item_id | sku | quantity | rate | warehouse_id | typically decreases stock (purchase return to vendor); already partially used in weekly report | Candidate for inclusion after Zoho UI validation — has list (+ detail if needed), item mapping, quantity, and value or costing path. |
| `/inventory/v1/transferorders` | yes | yes | unclear | date | line_items | item_id | sku | quantity_transfer | amount | from_warehouse_id | warehouse-neutral at org level; increases source warehouse and decreases destination warehouse | Candidate for per-warehouse reconstruction after UI validation — use detail line_items with quantity_transfer; net-zero org-wide but required for warehouse-scoped opening stock. |

### /inventory/v1/inventoryadjustments

- Existing code note: Not used in weekly report today.
- List (no date): 5 rows
- List (dated): 5 rows
- First document id probed: `4265011000036258001`
- Detail: ok
- List appears line-level (no nested line_items): no
- All detected item id fields: item_id
- All detected SKU fields: sku
- All detected quantity fields: advanced_tracking_missing_quantity, quantity_adjusted, quantity_adjusted_formatted
- All detected value/cost fields: item_total, label_rate
- All detected warehouse/location fields: is_storage_location_enabled, warehouse_id, warehouse_name
- Sample list row keys: inventory_adjustment_id, status, adjustment_type, date, reason, description, total, created_time, last_modified_time, item_id, name, tags, quantity_adjusted, value_adjusted, custom_fields, custom_field_hash, reference_number, created_by_id, created_by_name, last_modified_by_id, last_modified_by_name, warehouse_id, warehouse_name, _docId
- Sample detail keys: inventory_adjustment_id, date, adjustment_account_id, adjustment_account_name, reason, reason_id, description, status, reference_number, documents, adjustment_type, submitter_id, approver_id, submitted_date, submitted_by, submitted_by_name, submitted_by_email, submitted_by_photo_url, approvers_list, line_items, comments, total, warehouse_id, warehouse_name, created_time, last_modified_time, created_by_id, last_modified_by_id, created_by_name, custom_fields, custom_field_hash, is_advanced_tracking_missing, is_inventory_valuation_pending
- Sample detail line keys: line_item_id, item_id, item_order, name, sku, description, is_combo_product, adjustment_account_id, adjustment_account_name, asset_account_id, asset_account_name, quantity_adjusted, quantity_adjusted_formatted, advanced_tracking_missing_quantity, item_total, price, label_rate, asset_price, unit, image_name, image_document_id, project_id, serial_numbers, serial_number_details, batches, is_storage_location_enabled, track_serial_number, track_batch_number, warehouse_id, warehouse_name, tags

### /inventory/v1/creditnotes

- Existing code note: Not used in weekly report today (invoices used for sales).
- List (no date): 5 rows
- List (dated): 5 rows
- First document id probed: `4265011000039667393`
- Detail: ok
- List appears line-level (no nested line_items): no
- All detected item id fields: item_id
- All detected SKU fields: sku
- All detected quantity fields: advanced_tracking_missing_quantity, quantity
- All detected value/cost fields: bcy_rate, discount_amount, item_total, label_rate, non_taxable_amount, rate, tax_amount, value, value_formatted
- All detected warehouse/location fields: is_storage_location_enabled, warehouse_id, warehouse_name
- Sample list row keys: creditnote_id, creditnote_number, status, reference_number, date, issued_date, total, balance, customer_id, customer_name, applied_invoices, is_emailed, has_attachment, salesperson_name, salesperson_id, is_viewed_by_client, client_viewed_time, color_code, current_sub_status_id, current_sub_status, currency_id, currency_code, created_time, last_modified_time, exchange_rate, template_id, template_type, rounding_mode, price_precision, tags, _docId
- Sample detail keys: creditnote_id, creditnote_number, status, date, issued_date, reference_number, is_emailed, notes, terms, created_time, created_by_id, last_modified_by_id, last_modified_time, subject_content, created_by_name, offline_created_date_with_time, invoice_id, sales_channel, invoice_number, invoices_credited, customer_id, customer_name, customer_name_sec_lang, is_viewed_by_client, client_viewed_time, contact_persons, contact_persons_associated, salesperson_id, salesperson_name, tds_calculation_type, tax_reg_no, place_of_supply, filed_in_vat_return_id, filed_in_vat_return_name, filed_in_vat_return_type, contact_category, is_taxable, tax_treatment, tax_rounding, is_partial_exemption_applied, exceptions, color_code, current_sub_status_id, current_sub_status, sub_statuses, template_id, template_type, template_name, page_width, page_height, orientation, currency_id, currency_code, currency_symbol, currency_name_formatted, exchange_rate, price_precision, is_inclusive_tax, discount, discount_applied_on_amount, is_discount_before_tax, discount_type, discount_account_id, discount_account_name, is_reverse_charge_applied, salesreturn_id, salesreturn_number, salesorder_id, salesorder_number, line_items, submitter_id, approver_id, submitted_date, submitted_by, submitted_by_name, submitted_by_email, submitted_by_photo_url, documents, custom_fields, custom_field_hash, shipping_charge_account_id, shipping_charge_account_name, shipping_charge, shipping_charge_taxes, adjustment, adjustment_description, roundoff_value, transaction_rounding_type, rounding_mode, bcy_rounding_mode, sub_total, sub_total_inclusive_of_tax, tax_total, total, total_credits_used, total_refunded_amount, balance, taxes, computation_type, creditnote_refunds, billing_address, shipping_address, lock_details, locked_actions, lock_detail, approvers_list, is_advanced_tracking_missing
- Sample detail line keys: item_id, line_item_id, sku, account_id, account_name, name, internal_name, name_sec_lang, description, item_order, invoice_id, invoice_item_id, quantity, advanced_tracking_missing_quantity, pricing_scheme, unit, item_custom_fields, is_storage_location_enabled, line_item_category, project_id, pricebook_id, discount_amount, discount, discounts, discount_account_id, discount_account_name, bcy_rate, rate, sales_margin, label_rate, tax_id, tax_name, tax_type, tax_percentage, tax_treatment_code, non_taxable_amount, line_item_taxes, tax_category_code, tax_category_name, package_details, is_combo_product, combo_type, item_total, product_type, item_type, tags, image_document_id, track_serial_number, serial_numbers, serial_number_details, track_batch_number, batches, returnable_batches, track_serial_for_package, track_batch_for_package, salesreturn_item_id, can_skip_stock_tracking, is_credit_only_item, warehouse_id, warehouse_name, mapped_items, is_modifier_item, product_tax_category

### /inventory/v1/salesreturns

- Existing code note: Not used in weekly report today.
- List (no date): 5 rows
- List (dated): 5 rows
- First document id probed: `4265011000039667367`
- Detail: ok
- List appears line-level (no nested line_items): no
- All detected item id fields: item_id
- All detected SKU fields: sku
- All detected quantity fields: non_receive_quantity, quantity, quantity_received
- All detected value/cost fields: item_total, rate
- All detected warehouse/location fields: warehouse_id, warehouse_name
- Sample list row keys: date, salesreturn_id, customer_name, customer_id, quantity, quantity_yet_to_receive, quantity_received, salesreturn_status, salesreturn_number, salesorder_id, salesorder_number, creditnotes_number, currency_id, currency_code, price_precision, non_receive_quantity, refund_status, refunded_amount, receive_status, return_amount, bcy_total, created_time, last_modified_time, sales_channel, _docId
- Sample detail keys: salesreturn_id, salesreturn_number, customer_id, customer_name, beat_number, journey_plan_id, reason, date, closure_id, total, refunded_amount, salesreturn_status, salesreturn_type, return_type, refund_status, receive_status, discount, created_by_id, last_modified_by_id, created_date, sales_channel, line_items, shipping_address, contact_person_email, salesreturnreceives, creditnotes, salesorders, salesorder_id, salesorder_number, channel_return_id, channel_return_number, channel_sales_order_id, account_identifier, custom_fields, custom_field_hash, template_id, template_name, template_type
- Sample detail line keys: item_id, line_item_id, salesorder_item_id, account_id, name, group_name, description, sku, image_document_id, image_name, rate, is_combo_product, combo_type, track_serial_number, track_batch_number, quantity, item_total, quantity_received, non_receive_quantity, item_order, item_type, unit, warehouse_id, warehouse_name, mapped_items

### /inventory/v1/vendorcredits

- Existing code note: Already used for returned_to_wholesale column; detail fetch exists in weeklyReportZohoTransactions.js.
- List (no date): 5 rows
- List (dated): 5 rows
- First document id probed: `4265011000039390005`
- Detail: ok
- List appears line-level (no nested line_items): no
- All detected item id fields: item_id
- All detected SKU fields: sku
- All detected quantity fields: advanced_tracking_missing_quantity, quantity
- All detected value/cost fields: bcy_rate, item_total, label_rate, rate, value, value_formatted
- All detected warehouse/location fields: is_storage_location_enabled, warehouse_id, warehouse_name
- Sample list row keys: vendor_credit_id, vendor_credit_number, entity_type, status, color_code, current_sub_status_id, current_sub_status, reference_number, date, total, balance, vendor_id, vendor_name, currency_id, currency_code, created_time, last_modified_time, has_attachment, tags, applied_bills, _docId
- Sample detail keys: vendor_credit_id, entity_type, vendor_credit_number, date, status, color_code, current_sub_status_id, current_sub_status, sub_statuses, reference_number, vendor_id, vendor_name, currency_id, currency_code, currency_symbol, exchange_rate, price_precision, place_of_supply, is_inclusive_tax, tax_rounding, tax_reg_no, tds_calculation_type, subject_content, bill_id, bill_number, contact_category, tax_treatment, filed_in_vat_return_id, filed_in_vat_return_name, filed_in_vat_return_type, is_reverse_charge_applied, line_items, billing_address_id, billing_address, submitted_date, submitter_id, submitted_by, submitted_by_name, submitted_by_email, submitted_by_photo_url, approver_id, documents, custom_fields, custom_field_hash, adjustment, adjustment_description, discount_setting, discount_type, discount_amount, discount, discount_applied_on_amount, is_discount_before_tax, created_by_id, created_by_name, last_modified_by_id, last_modified_by_name, discount_account_id, discount_account_name, sub_total, sub_total_inclusive_of_tax, discount_total, discount_percent, total, total_credits_used, total_refunded_amount, balance, taxes, computation_type, notes, comments, vendor_credit_refunds, bills_credited, created_time, last_modified_time, template_id, template_name, page_width, page_height, orientation, template_type, approvers_list, is_advanced_tracking_missing
- Sample detail line keys: item_id, line_item_id, bill_item_id, sku, account_id, account_name, name, discount, discount_account_id, discount_account_name, discounts, line_item_category, description, item_order, itc_eligibility, tax_treatment_code, quantity, advanced_tracking_missing_quantity, image_document_id, unit, bcy_rate, rate, label_rate, pricebook_id, package_details, tax_id, tax_exemption_id, tax_exemption_code, tax_category_code, tax_category_name, tax_name, tax_type, tax_percentage, line_item_taxes, item_total, product_type, item_type, reverse_charge_tax_id, tags, item_custom_fields, track_serial_number, serial_numbers, serial_number_details, track_batch_number, batches, is_storage_location_enabled, warehouse_id, warehouse_name, project_id, is_combo_product, product_tax_category

### /inventory/v1/transferorders

- Existing code note: Not used in weekly report today.
- List (no date): 5 rows
- List (dated): 5 rows
- First document id probed: `4265011000039628076`
- Detail: ok
- List appears line-level (no nested line_items): no
- All detected item id fields: item_id
- All detected SKU fields: sku
- All detected quantity fields: advanced_tracking_missing_quantity, quantity_transfer, quantity_transferred
- All detected value/cost fields: amount, label_rate, sales_rate
- All detected warehouse/location fields: cf_location, cf_location_unformatted, from_warehouse_id, from_warehouse_name, is_storage_location_enabled, to_warehouse_id, to_warehouse_name
- Sample list row keys: transfer_order_id, transfer_order_number, date, description, created_time, last_modified_time, created_by_id, created_by_name, last_modified_by_id, last_modified_by_name, quantity_transfer, quantity_transferred, from_warehouse_id, from_warehouse_name, to_warehouse_id, to_warehouse_name, status, _docId
- Sample detail keys: transfer_order_id, from_warehouse_id, from_warehouse_name, to_warehouse_id, place_of_supply, to_warehouse_name, date, is_restricted_view, transferred_date, description, transfer_order_number, created_by_id, last_modified_by_id, created_by_name, status, quantity_transfer, total, submitter_id, approver_id, submitted_date, submitted_by, submitted_by_name, submitted_by_email, submitted_by_photo_url, approvers_list, sales_tax_type, line_items, show_convert_to_receive, documents, comments, custom_fields, custom_field_hash, tracking_number, tracking_link, carrier, delivery_method, delivery_method_id, is_tracking_enabled, tracking_statuses, created_time, last_modified_time, is_advanced_tracking_missing
- Sample detail line keys: line_item_id, item_id, item_order, name, description, quantity_transfer, quantity_transferred, advanced_tracking_missing_quantity, price, amount, asset_price, unit, sku, image_name, image_type, image_document_id, project_id, track_serial_number, track_batch_number, is_storage_location_enabled, serial_numbers, serial_number_details, batches, is_combo_product, sales_rate, label_rate, item_custom_fields, custom_field_hash

## Deep Probe Summary

### Production-usable for reconstruction (after UI validation)

- `/inventory/v1/inventoryadjustments` — Candidate for inclusion after Zoho UI validation — has list (+ detail if needed), item mapping, quantity, and value or costing path.
- `/inventory/v1/creditnotes` — Candidate for inclusion after Zoho UI validation — has list (+ detail if needed), item mapping, quantity, and value or costing path.
- `/inventory/v1/salesreturns` — Candidate for inclusion after Zoho UI validation — has list (+ detail if needed), item mapping, quantity, and value or costing path.
- `/inventory/v1/vendorcredits` — Candidate for inclusion after Zoho UI validation — has list (+ detail if needed), item mapping, quantity, and value or costing path.
- `/inventory/v1/transferorders` — Candidate for per-warehouse reconstruction after UI validation — use detail line_items with quantity_transfer; net-zero org-wide but required for warehouse-scoped opening stock.

### Still unclear

- `/inventory/v1/inventoryadjustments` — list=yes, detail=yes, date filter=unclear. Candidate for inclusion after Zoho UI validation — has list (+ detail if needed), item mapping, quantity, and value or costing path.
- `/inventory/v1/creditnotes` — list=yes, detail=yes, date filter=unclear. Candidate for inclusion after Zoho UI validation — has list (+ detail if needed), item mapping, quantity, and value or costing path.
- `/inventory/v1/salesreturns` — list=yes, detail=yes, date filter=unclear. Candidate for inclusion after Zoho UI validation — has list (+ detail if needed), item mapping, quantity, and value or costing path.
- `/inventory/v1/vendorcredits` — list=yes, detail=yes, date filter=unclear. Candidate for inclusion after Zoho UI validation — has list (+ detail if needed), item mapping, quantity, and value or costing path.
- `/inventory/v1/transferorders` — list=yes, detail=yes, date filter=unclear. Candidate for per-warehouse reconstruction after UI validation — use detail line_items with quantity_transfer; net-zero org-wide but required for warehouse-scoped opening stock.

### Unavailable

- None of the five deep-probe endpoints returned HTTP errors.

### Next calculation recommendation

- **Do not change Opening Stock Value / Closing Stock Value calculations yet.**
- **Keep** current path: live `items` stock + invoices/bills/vendor credits reconciliation + `report_meta` incompleteness warning.
- **Strongest new candidate:** `/inventory/v1/inventoryadjustments` — list rows already expose `item_id`, `quantity_adjusted`, `value_adjusted`, `warehouse_id`, and `date`; validate date filter and adjustment sign against Zoho UI.
- **Sales returns path:** prefer `/inventory/v1/salesreturns` and/or `/inventory/v1/creditnotes` only after detail `line_items` are confirmed and matched to report items; list rows may be header-level or aggregated.
- **Vendor credits:** continue using for purchase-return quantity (already in app); extend to opening recon only after confirming dated list + line_items + warehouse on detail for your vendor scope.
- **Transfer orders:** `/inventory/v1/transferorders` + detail `line_items` with `quantity_transfer`, `from_warehouse_id`, `to_warehouse_id` — candidate for per-warehouse recon; validate date filter against Zoho UI.
- **Note:** first-pass probe showed empty vendor credits / transfer orders with date filter only; deep probe returned rows for both list modes — do not treat those endpoints as unavailable.
- **Still missing:** complete stock ledger (`stocktracking` / `inventorydetails` returned 404 in first pass) and production-safe historical valuation API.

