# Amazon SP-API — endpoint versions in use

Review [Amazon SP-API release notes](https://developer-docs.amazon.com/sp-api/changelog) and deprecation notices **at least quarterly**. When Amazon announces a version sunset, plan migration before the cutoff.

| API area | Path / version | Purpose | Used by (backend) | Migration risk | Monitoring TODO |
|----------|------------------|---------|-------------------|----------------|------------------|
| Orders | `/orders/v0/orders` | List orders in a time window | `amazonSpApiService.getAmazonOrders` → `amazonOrdersSyncService` | Medium — v0 is long-lived but watch announcements | Track changelog for `orders` API bundle changes |
| Order Items | `/orders/v0/orders/{amazonOrderId}/orderItems` | Line items (PII-filtered before persist) | `amazonSpApiService.getAmazonOrderItems` → sync | Medium | Same as Orders |
| Sellers | `/sellers/v1/marketplaceParticipations` | Resolve marketplace id(s) for the seller | `amazonSpApiService.getMarketplaceParticipations` → orders + `amazonSpApiController` | Low–medium | Confirm no breaking changes to payload shape |
| Catalog Items | `/catalog/2022-04-01/items` | Optional SKU/main image metadata | `amazonSpApiService.searchAmazonCatalogItems` → `amazonSkuImageService`, listing flows | Higher — dated version in path | When Amazon publishes a newer catalog path, add parallel support then cut over |

## Centralization

Path fragments and builders are exported from `backend/src/config/amazonSpApiVersions.js` so future version bumps touch fewer call sites.

## Action checklist (recurring)

1. Subscribe to or periodically read SP-API **release notes** and **deprecation** posts.
2. Re-run integration smoke tests (`npm run test:amazon-*` scripts) after dependency or endpoint changes.
3. Confirm `backend/docs/amazon-spapi-versions.md` still matches code search for `callAmazonSpApi` / path literals.
