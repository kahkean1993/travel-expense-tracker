import { settingsRepo } from '../../db/repositories'
import { createBackup } from '../../lib/export/backup'
import { downloadText, todayStamp } from '../../lib/export/csv'

/** Downloads a full JSON backup and resets the reminder counter. */
export async function downloadBackup() {
  const backup = await createBackup()
  downloadText(`travel-expenses-backup-${todayStamp()}.json`, JSON.stringify(backup, null, 2), 'application/json')
  await settingsRepo.markBackedUp()
}
