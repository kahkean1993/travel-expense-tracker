import { useSettings } from '../../db/hooks'
import { settingsRepo } from '../../db/repositories'
import { useBusy } from '../../components/useBusy'
import { useRoute } from '../../app/router'
import { downloadBackup } from './backupActions'

const REMIND_AFTER = 20

/** Quiet banner after many unsaved-to-file changes. Never shown on forms. */
export function BackupReminder() {
  const settings = useSettings()
  const route = useRoute()
  const [busy, run] = useBusy()
  if (!settings) return null
  if (!['trips', 'dashboard', 'expenses', 'settings'].includes(route.name)) return null
  const due = settings.changesSinceBackup >= REMIND_AFTER && settings.changesSinceBackup >= settings.backupReminderSnoozedUntil
  if (!due) return null
  return (
    <div className="no-print mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700" role="status">
      <p className="min-w-0 flex-1">
        {settings.changesSinceBackup} changes since your last backup. Data lives only in this browser, so download a backup
        now and then.
      </p>
      <div className="flex gap-3">
        <button type="button" className="font-medium text-accent-700 underline" disabled={busy} onClick={() => void run(downloadBackup)}>
          Back up now
        </button>
        <button
          type="button"
          className="text-slate-600 underline"
          onClick={() => void settingsRepo.update({ backupReminderSnoozedUntil: settings.changesSinceBackup + REMIND_AFTER })}
        >
          Later
        </button>
      </div>
    </div>
  )
}
