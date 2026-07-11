export type StepStatus = 'not_started' | 'in_progress' | 'blocked' | 'completed' | 'ready'

export interface ClearingStep {
  id: number
  key: string
  title: string
  description: string
}

export const CLEARING_STEPS: ClearingStep[] = [
  {
    id: 1,
    key: 'select',
    title: 'Select Settlement',
    description:
      'Open a saved settlement batch from the database, or fetch a new Amazon KSA settlement report. Saved batches load instantly without calling Amazon again.',
  },
  {
    id: 2,
    key: 'parse',
    title: 'Parsed Settlement Rows',
    description:
      'Every settlement line classified by category and row type, with a resolved status so you can trace any warning down to the exact rows.',
  },
  {
    id: 3,
    key: 'sales',
    title: 'Match Sales to Zoho Invoices',
    description:
      'Match Amazon order IDs to Zoho invoices by PO number or invoice number. Review unmatched sales, missing order IDs, and amount differences.',
  },
  {
    id: 4,
    key: 'returns',
    title: 'Reconcile Returns to Credit Notes',
    description:
      'Match Amazon refund/return rows to existing Zoho credit notes, or mark returns for create-and-apply in step 10 after sales payments are posted.',
  },
  {
    id: 5,
    key: 'reconcile',
    title: 'Settlement Reconciliation',
    description:
      'Reconcile order-level earnings, refunds/returns, and settlement-level deductions to the actual Amazon deposit.',
  },
  {
    id: 6,
    key: 'approve',
    title: 'Approve Settlement',
    description:
      'Approval is gated until sales, hard-blocked returns, and settlement totals are clean.',
  },
  {
    id: 7,
    key: 'fee-journals',
    title: 'Amazon Fee Journal Mapping',
    description:
      'Group account-level Amazon fee rows by fee type and prepare manual journal debit/credit mappings for Zoho.',
  },
  {
    id: 8,
    key: 'preview',
    title: 'Payment Preview',
    description:
      'Generate the Zoho sales payment plan: net balance, commission, and shipping/FBA clearing for matched invoices.',
  },
  {
    id: 9,
    key: 'post',
    title: 'Post Sales Payments to Zoho',
    description:
      'Dry run, then post grouped Zoho Record Payments and account-level Amazon fee journals. Return refunds are handled in steps 10–11 after payments land.',
  },
  {
    id: 10,
    key: 'apply-credit-notes',
    title: 'Refund Credit Notes',
    description:
      'After sales payments are posted, refund warehouse credit notes to undeposited funds. Create missing credit notes first when needed.',
  },
  {
    id: 11,
    key: 'return-fees',
    title: 'Return Fee Clearing',
    description:
      'After credit notes are applied, review return fee asymmetry and post commission/shipping return journals to Zoho.',
  },
]

export const STEP_STATUS_LABEL: Record<StepStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  blocked: 'Blocked',
  ready: 'Ready',
  completed: 'Completed',
}

export type LifecycleStatusUi =
  | 'draft'
  | 'ready_for_review'
  | 'ready_to_post'
  | 'approved'
  | 'posted'
  | 'force_repost_required'

export const LIFECYCLE_LABEL: Record<string, string> = {
  draft: 'Draft',
  ready_for_review: 'Ready for review',
  ready_to_post: 'Ready to post',
  approved: 'Approved',
  posted: 'Posted',
  force_repost_required: 'Force repost required',
}
