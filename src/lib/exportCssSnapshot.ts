/**
 * html2canvas renders into a cloned document, and the clone fetches every
 * `<link rel="stylesheet">` again by URL. Asset filenames are content-hashed, so a tab
 * that was loaded before a deploy keeps rendering correctly from its already-parsed
 * stylesheet while that URL is gone from the bucket. The clone then gets a 404, and the
 * export comes out with no styling at all.
 *
 * Snapshotting the parsed rules and injecting them into the clone keeps captures
 * independent of the network and of which build the tab was loaded from.
 */

/** Serialize every readable stylesheet in `doc` into one CSS string. */
export function snapshotDocumentCss(doc: Document = document): string {
  return Array.from(doc.styleSheets)
    .map((sheet) => serializeSheet(sheet))
    .filter(Boolean)
    .join('\n')
}

/** Inject a snapshot from `snapshotDocumentCss` into an html2canvas clone. */
export function applyCssSnapshot(clone: Document, cssText: string): void {
  if (!cssText) return
  const style = clone.createElement('style')
  style.setAttribute('data-export-css-snapshot', '')
  style.textContent = cssText
  clone.head.appendChild(style)
}

function serializeSheet(sheet: CSSStyleSheet): string {
  let rules: CSSRuleList
  try {
    rules = sheet.cssRules
  } catch {
    // Cross-origin sheet (e.g. Google Fonts). Its <link> stays in the clone, which is
    // the best available fallback for webfonts.
    return ''
  }
  if (!rules) return ''

  const css = Array.from(rules)
    .map((rule) => serializeRule(rule))
    .filter(Boolean)
    .join('\n')

  const media = sheet.media?.mediaText
  return media ? `@media ${media}{${css}}` : css
}

function serializeRule(rule: CSSRule): string {
  // Flatten @import: its rules live on a separate sheet, and an @import emitted after
  // other rules would be dropped by the parser.
  if (rule.type === CSSRule.IMPORT_RULE) {
    const imported = (rule as CSSImportRule).styleSheet
    return imported ? serializeSheet(imported) : ''
  }
  return rule.cssText
}
