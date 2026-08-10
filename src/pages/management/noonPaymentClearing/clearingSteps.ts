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
    title: 'Select Noon Statement',
    description: 'Upload a Noon settlement statement or reopen a saved batch. Duplicate Reference Nr imports are protected.',
  },
  {
    id: 2,
    key: 'parse',
    title: 'Parse & Classify Rows',
    description: 'Every statement line classified (order, order_update, statement fee) with original Noon fields preserved.',
  },
  {
    id: 3,
    key: 'hierarchy',
    title: 'Noon Order Hierarchy',
    description: 'Parent customer orders with expandable item-level children. Grouping only — invoices stay separate.',
  },
  {
    id: 4,
    key: 'match',
    title: 'Match Item Orders → Zoho',
    description: 'Match Zoho invoices using the full Noon item-level order ID. Parent IDs never clear a child invoice.',
  },
  {
    id: 5,
    key: 'adjustments',
    title: 'Noon Adjustments',
    description: 'order_update and fee-only adjustments associated with parent/item orders when possible.',
  },
  {
    id: 6,
    key: 'parent-charges',
    title: 'Parent Charges & Open Balance',
    description:
      'Parent logistics assigned to child/Zoho invoices. Check live Zoho open balance here and exclude already-paid logistics before approve.',
  },
  {
    id: 7,
    key: 'reconcile',
    title: 'Statement Reconciliation',
    description: 'All statement financial rows must equal the Noon settlement total within tolerance.',
  },
  {
    id: 8,
    key: 'approve',
    title: 'Approve Settlement',
    description:
      'No Zoho writes before approval. Missing fee-account mapping does not block this step — map those in the next step.',
  },
  {
    id: 9,
    key: 'fee-journals',
    title: 'Noon Fee Journal Mapping',
    description:
      'Statement fees only (e.g. Advertising): pick expense after VAT + Input VAT. Commission and shipping clear via invoice payments to uncleared — expense reclass is later.',
  },
  {
    id: 10,
    key: 'preview',
    title: 'Payment Preview',
    description:
      'Each invoice splits into Net (1066), Commission (1067), and Shipping/Fulfillment (1068). Statement fee journals shown separately.',
  },
  {
    id: 11,
    key: 'post',
    title: 'Post to Zoho',
    description:
      'Dry run, then post grouped Record Payments, advertising fee journals, and uncleared→expense reclass journals (commission 1067→2143, shipping 1068→2162, + Input VAT).',
  },
]

export const STEP_STATUS_LABEL: Record<StepStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  blocked: 'Needs attention',
  ready: 'Ready',
  completed: 'Completed',
}
