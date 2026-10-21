import type { SplitMode } from '../../types/domain'

export const SPLIT_MODE_LABELS: Record<SplitMode, string> = {
  personal: 'Just one person',
  equal: 'Split equally',
  custom_amount: 'Custom amounts',
  custom_weight: 'Custom shares',
}
