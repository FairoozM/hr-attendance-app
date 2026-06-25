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
      'Match Amazon refund/return rows to Zoho credit notes. Missing or mismatched credit notes block posting until resolved.',
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
      'Approval is gated until sales, returns, credit notes, and settlement totals are all clean.',
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
      'Generate the Zoho payment plan: net balance, commission, shipping/FBA, credit-note application, adjustment clearing, and Amazon fee journals.',
  },
  {
    id: 9,
    key: 'post',
    title: 'Post to Zoho',
    description:
      'Dry run, then post grouped Zoho Record Payments and Amazon fee manual journals. Posted batches are view-only unless an admin force reposts.',
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
