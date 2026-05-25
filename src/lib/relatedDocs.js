/**
 * relatedDocs.js
 * Compatibility shim — delegates to linearDocsMatcher.js.
 * Used in IssueDetailPanel to show "Related Docs" chips.
 */
export { getRelatedDocsForIssue as loadDocsForIssue } from './linearDocsMatcher'
