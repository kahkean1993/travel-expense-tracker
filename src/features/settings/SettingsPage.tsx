import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { navigate, paths } from '../../app/router'
import { useCategories, useSettings } from '../../db/hooks'
import { categoriesRepo, settingsRepo } from '../../db/repositories'
import { Button, Card, ConfirmDialog, Disclosure, Field, FieldError, Loading, Notice, PageHeader, SectionTitle, TextInput } from '../../components/ui'
import { CurrencySelect } from '../../components/CurrencySelect'
import { IconDownload, IconPlus, IconUpload } from '../../components/Icons'
import { useBusy } from '../../components/useBusy'
import { importMerge, importReplace, parseBackup, previewImport, type BackupFile, type ImportPreview } from '../../lib/export/backup'
import { isValidCurrencyCode } from '../../lib/money/money'
import type { Category } from '../../types/domain'
import { downloadBackup } from './backupActions'
import { loadSampleData, removeSampleData, sampleTripIds } from './sampleData'
import { AccountCard } from '../sharing/AccountCard'
import { cloudConfigured } from '../../sync/cloud'

export function SettingsPage() {
  const settings = useSettings()
  if (!settings) return <Loading />
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title="Settings & backup" />
      <p className="rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-600">
        {cloudConfigured ? (
          <>Trips you don't share are saved only in this browser on this device. </>
        ) : (
          <>Your trips are saved only in this browser on this device. </>
        )}
        Clearing browser data can erase them, so download a backup now and then.
      </p>

      <SettingsGroup title="Your data">
        <BackupCard lastBackupAt={settings.lastBackupAt} changes={settings.changesSinceBackup} />
        <RestoreCard />
      </SettingsGroup>

      {cloudConfigured ? (
        <SettingsGroup title="Sharing">
          <AccountCard />
        </SettingsGroup>
      ) : null}

      <SettingsGroup title="More">
        <PreferencesCard defaultCurrency={settings.defaultBaseCurrency} />
        <CategoriesCard />
        <StorageCard />
        <SampleDataCard />
      </SettingsGroup>
    </div>
  )
}

function SettingsGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="space-y-3">
      <h2 className="px-1 pt-2 text-xs font-semibold tracking-wider text-slate-500 uppercase">{title}</h2>
      {children}
    </section>
  )
}

function BackupCard({ lastBackupAt, changes }: { lastBackupAt: string | null; changes: number }) {
  const [busy, run] = useBusy()
  const [error, setError] = useState<string | null>(null)
  return (
    <Card>
      <SectionTitle>Back up</SectionTitle>
      <p className="text-sm text-slate-600">
        One file with all your trips and expenses. Keep it somewhere safe (a cloud drive, or email it to yourself) to restore
        later or on another phone.
      </p>
      <p className="mt-2 text-sm text-slate-700">
        {lastBackupAt
          ? `Last backup: ${new Date(lastBackupAt).toLocaleString()} · ${changes} change${changes === 1 ? '' : 's'} since.`
          : 'No backup downloaded yet.'}
      </p>
      <div className="mt-3">
        <Button
          variant="primary"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              try {
                setError(null)
                await downloadBackup()
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Backup failed.')
              }
            })
          }
        >
          <IconDownload width={18} height={18} /> {busy ? 'Preparing…' : 'Download backup'}
        </Button>
      </div>
      {error ? <div className="mt-2"><FieldError>{error}</FieldError></div> : null}
    </Card>
  )
}

function RestoreCard() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [backup, setBackup] = useState<BackupFile | null>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [confirm, setConfirm] = useState<'merge' | 'replace' | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [busy, run] = useBusy()

  function reset() {
    setBackup(null)
    setPreview(null)
    setFileName('')
    if (fileRef.current) fileRef.current.value = ''
  }

  async function onFile(file: File | undefined) {
    setError(null)
    setDone(null)
    setBackup(null)
    setPreview(null)
    if (!file) return
    setFileName(file.name)
    if (file.size > 50 * 1024 * 1024) return setError('This file is too large to be a backup from this app.')
    const parsed = parseBackup(await file.text())
    if (!parsed.ok) return setError(parsed.error)
    setBackup(parsed.backup)
    setPreview(await previewImport(parsed.backup))
  }

  function apply(mode: 'merge' | 'replace') {
    if (!backup) return
    void run(async () => {
      try {
        if (mode === 'merge') {
          const r = await importMerge(backup)
          setDone(
            `Added ${r.addedTrips} trip${r.addedTrips === 1 ? '' : 's'}.` +
              (r.skippedTrips ? ` Skipped ${r.skippedTrips} that already exist on this device.` : ''),
          )
        } else {
          await importReplace(backup)
          setDone('All data was replaced with the backup.')
        }
        setConfirm(null)
        reset()
      } catch (e) {
        setConfirm(null)
        setError(`Nothing was changed. ${e instanceof Error ? e.message : 'The restore failed.'}`)
      }
    })
  }

  return (
    <Card>
      <SectionTitle>Restore from backup</SectionTitle>
      <p className="text-sm text-slate-600">
        Choose a backup file. It is checked first, and you'll see what it contains before anything changes.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          id="restore-file"
          type="file"
          accept="application/json,.json"
          className="sr-only"
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
        <label htmlFor="restore-file" className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800 hover:bg-slate-50">
          <IconUpload width={18} height={18} /> Choose backup file
        </label>
        {fileName ? <span className="truncate text-sm text-slate-600">{fileName}</span> : null}
      </div>
      {error ? <div className="mt-3"><Notice tone="danger">{error}</Notice></div> : null}
      {done ? <div className="mt-3"><Notice tone="success">{done}</Notice></div> : null}

      {preview ? (
        <div className="mt-4 rounded-lg border border-slate-200 p-3 text-sm">
          <p className="font-medium text-slate-900">
            Backup{preview.exportedAt ? ` from ${new Date(preview.exportedAt).toLocaleString()}` : ''}: {preview.trips.length} trip
            {preview.trips.length === 1 ? '' : 's'}, {preview.totalExpenses} expense{preview.totalExpenses === 1 ? '' : 's'}
          </p>
          <ul className="mt-2 space-y-1">
            {preview.trips.map((t) => (
              <li key={t.id} className="flex justify-between gap-2">
                <span className="truncate">{t.name} <span className="text-slate-500">· {t.expenses} expenses</span></span>
                <span className={t.exists ? 'text-slate-500' : 'text-accent-700'}>{t.exists ? 'Already on this device' : 'New'}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 space-y-2">
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" disabled={busy || preview.newTrips === 0} onClick={() => setConfirm('merge')}>
                Add {preview.newTrips} new trip{preview.newTrips === 1 ? '' : 's'}
              </Button>
              <Button variant="danger" disabled={busy} onClick={() => setConfirm('replace')}>
                Replace all data…
              </Button>
              <Button variant="ghost" onClick={reset}>Cancel</Button>
            </div>
            <p className="text-xs text-slate-500">
              “Add” keeps everything currently on this device and never overwrites existing trips. “Replace” deletes all current
              data and loads the backup instead.
            </p>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirm === 'merge'}
        title="Add trips from backup?"
        tone="primary"
        confirmLabel="Add trips"
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => apply('merge')}
      >
        {preview?.newTrips} trip(s) and their expenses will be added. Your existing trips stay exactly as they are.
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === 'replace'}
        title="Replace all data?"
        confirmLabel="Delete current data and restore"
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => apply('replace')}
      >
        <p>
          <strong>Every trip and expense currently in this browser will be deleted</strong> and replaced by the backup. If the
          restore fails, nothing is changed.
        </p>
        <p className="mt-2">
          Not sure? Cancel and use “Download backup” first so you can go back.
        </p>
      </ConfirmDialog>
    </Card>
  )
}

function StorageCard() {
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const [estimate, setEstimate] = useState<string | null>(null)
  const supported = typeof navigator !== 'undefined' && !!navigator.storage?.persist

  useEffect(() => {
    if (!navigator.storage) return
    void navigator.storage.persisted?.().then(setPersisted)
    void navigator.storage.estimate?.().then((e) => {
      if (e.usage !== undefined) setEstimate(`${(e.usage / 1024 / 1024).toFixed(1)} MB used by this app`)
    })
  }, [])

  if (!supported) return null
  return (
    <Disclosure title="Storage protection" hint="Keep the browser from clearing your data">
      <p className="text-sm text-slate-600">
        Browsers may clear site data when the device is low on space. You can ask the browser to keep this app's data.
        {estimate ? ` ${estimate}.` : ''}
      </p>
      <p className="mt-2 text-sm text-slate-800">
        Status: {persisted === null ? 'Checking…' : persisted ? 'Protected from automatic clearing' : 'Not protected'}
      </p>
      {persisted === false ? (
        <div className="mt-3">
          <Button
            onClick={() =>
              void navigator.storage.persist().then((ok) => {
                setPersisted(ok)
              })
            }
          >
            Ask browser to keep data
          </Button>
          <p className="mt-1 text-xs text-slate-500">
            Some browsers grant this automatically only after the app is installed or used often. Backups are still recommended.
          </p>
        </div>
      ) : null}
    </Disclosure>
  )
}

function PreferencesCard({ defaultCurrency }: { defaultCurrency: string }) {
  const [value, setValue] = useState(defaultCurrency)
  const valid = isValidCurrencyCode(value)
  return (
    <Disclosure title="Preferences" hint="Default currency for new trips">
      <Field label="Default base currency for new trips" htmlFor="default-currency" error={value && !valid && value.length === 3 ? 'Unknown currency code.' : undefined}>
        <div className="max-w-xs">
          <CurrencySelect
            id="default-currency"
            value={value}
            onChange={(code) => {
              setValue(code)
              if (isValidCurrencyCode(code)) void settingsRepo.update({ defaultBaseCurrency: code })
            }}
          />
        </div>
      </Field>
    </Disclosure>
  )
}

function CategoriesCard() {
  const categories = useCategories()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, run] = useBusy()
  if (!categories) return null
  const global = categories.filter((c) => c.tripId === null)

  function add(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return setError('Enter a category name.')
    void run(async () => {
      try {
        await categoriesRepo.add(name)
        setName('')
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not add the category.')
      }
    })
  }

  return (
    <Disclosure title="Categories" hint="Add or rename your own">
      <ul className="divide-y divide-slate-100 text-sm">
        {global.map((c) => (
          <CategoryRow key={c.id} category={c} />
        ))}
      </ul>
      <form onSubmit={add} className="mt-3 flex gap-2" noValidate>
        <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="New category, e.g. Gifts" aria-label="New category name" maxLength={40} />
        <Button type="submit" disabled={busy}>
          <IconPlus width={18} height={18} /> Add
        </Button>
      </form>
      {error ? <div className="mt-2"><FieldError>{error}</FieldError></div> : null}
    </Disclosure>
  )
}

function CategoryRow({ category }: { category: Category }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(category.name)
  const [error, setError] = useState<string | null>(null)
  const [busy, run] = useBusy()
  const usage = useLiveQuery(() => categoriesRepo.usageCount(category.id), [category.id])

  if (editing)
    return (
      <li className="py-2">
        <form
          className="flex flex-wrap gap-2"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            if (!name.trim()) return setError('Name cannot be empty.')
            void run(async () => {
              try {
                await categoriesRepo.rename(category.id, name)
                setEditing(false)
                setError(null)
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Could not rename.')
              }
            })
          }}
        >
          <TextInput value={name} onChange={(e) => setName(e.target.value)} aria-label="Category name" autoFocus maxLength={40} />
          <Button type="submit" variant="primary" disabled={busy}>Save</Button>
          <Button onClick={() => { setEditing(false); setName(category.name); setError(null) }}>Cancel</Button>
          {error ? <div className="w-full"><FieldError>{error}</FieldError></div> : null}
        </form>
      </li>
    )

  return (
    <li className="flex min-h-11 items-center gap-2 py-1">
      <span className="flex-1">
        {category.name}
        {usage ? <span className="text-slate-500"> · used {usage}×</span> : null}
      </span>
      {category.isCustom ? (
        <>
          <Button variant="ghost" onClick={() => setEditing(true)}>Rename</Button>
          {usage === 0 ? (
            <Button variant="ghost" className="text-red-700 hover:bg-red-50" disabled={busy} onClick={() => void run(() => categoriesRepo.remove(category.id))}>
              Delete
            </Button>
          ) : null}
        </>
      ) : (
        <span className="text-xs text-slate-500">Built-in</span>
      )}
    </li>
  )
}

function SampleDataCard() {
  const sampleIds = useLiveQuery(sampleTripIds)
  const [busy, run] = useBusy()
  const [confirm, setConfirm] = useState(false)
  if (!sampleIds) return null
  return (
    <Disclosure title="Sample data" hint="Try the app with a fictional trip">
      <p className="text-sm text-slate-600">
        Load a fictional trip with a few expenses to explore the app. It is labelled “Sample” and can be removed in one tap
        without touching your own trips.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const trip = await loadSampleData()
              navigate(paths.dashboard(trip.id))
            })
          }
        >
          Load sample data
        </Button>
        {sampleIds.length ? (
          <Button variant="danger" disabled={busy} onClick={() => setConfirm(true)}>
            Remove sample data ({sampleIds.length} trip{sampleIds.length === 1 ? '' : 's'})
          </Button>
        ) : null}
      </div>
      <ConfirmDialog
        open={confirm}
        title="Remove sample data?"
        confirmLabel="Remove sample trips"
        busy={busy}
        onCancel={() => setConfirm(false)}
        onConfirm={() => void run(async () => { await removeSampleData(); setConfirm(false) })}
      >
        Only trips marked “Sample” are deleted, with their expenses. Your own trips are not affected.
      </ConfirmDialog>
    </Disclosure>
  )
}

