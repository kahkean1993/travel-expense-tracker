import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { receiptsRepo } from '../../db/repositories'
import { Button, Card, ConfirmDialog, Sheet } from '../../components/ui'
import { IconPlus, IconX } from '../../components/Icons'
import { useBusy } from '../../components/useBusy'
import { PhotoError, shrinkPhoto } from '../../lib/image'
import { syncEngine } from '../../sync/cloud'
import { MAX_RECEIPTS_PER_EXPENSE, type Receipt } from '../../types/domain'

/** An object URL for a blob, released when no longer needed. */
function useObjectUrl(blob: Blob | null | undefined) {
  const [created, setCreated] = useState<{ blob: Blob; url: string } | null>(null)
  useEffect(() => {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    // Creating and releasing the URL is a subscription to an external resource, so state is set here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCreated({ blob, url })
    return () => URL.revokeObjectURL(url)
  }, [blob])
  return created && created.blob === blob ? created.url : null
}

/** The photo of a receipt, fetched from the server when another phone added it. */
function useReceiptBlob(receipt: Receipt) {
  const [downloaded, setDownloaded] = useState<Blob | null>(null)
  const [failed, setFailed] = useState(false)
  const { id, tripId, blob: local } = receipt
  useEffect(() => {
    if (local || !syncEngine) return
    let live = true
    void syncEngine.receiptBlob({ id, tripId }).then((b) => {
      if (!live) return
      if (b) setDownloaded(b)
      else setFailed(true)
    })
    return () => {
      live = false
    }
  }, [id, tripId, local])
  return { blob: receipt.blob ?? downloaded, failed: failed && !receipt.blob }
}

function Thumb({ blob, failed, label, onClick, large = false }: { blob: Blob | null; failed: boolean; label: string; onClick?: () => void; large?: boolean }) {
  const url = useObjectUrl(blob)
  const box = large ? 'max-h-[70dvh] w-full rounded-xl object-contain' : 'size-20 rounded-xl object-cover'
  if (!url) {
    return (
      <span className={`flex ${large ? 'h-40 w-full' : 'size-20'} items-center justify-center rounded-xl bg-slate-100 p-2 text-center text-[11px] text-slate-600`}>
        {failed ? 'Not downloaded yet. Connect to see it.' : 'Loading…'}
      </span>
    )
  }
  const img = <img src={url} alt={label} className={box} />
  return onClick ? (
    <button type="button" onClick={onClick} className="press rounded-xl" aria-label={`Open ${label}`}>
      {img}
    </button>
  ) : (
    img
  )
}

/** Opens a camera or the photo library and returns shrunk photos. */
function PhotoButton({ disabled, onPhotos, onError }: { disabled?: boolean; onPhotos: (photos: Blob[]) => void | Promise<void>; onError: (message: string) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, run] = useBusy()
  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])]
          e.target.value = ''
          if (files.length === 0) return
          void run(async () => {
            try {
              await onPhotos(await Promise.all(files.map((f) => shrinkPhoto(f))))
            } catch (error) {
              onError(error instanceof PhotoError || error instanceof Error ? error.message : 'Could not add the photo.')
            }
          })
        }}
      />
      <Button disabled={disabled || busy} onClick={() => input.current?.click()}>
        <IconPlus width={18} height={18} /> {busy ? 'Preparing…' : 'Add photo'}
      </Button>
    </>
  )
}

/** Receipt photos of a saved expense: view, add and remove. */
export function ReceiptGallery({ expenseId, canEdit }: { expenseId: string; canEdit: boolean }) {
  const receipts = useLiveQuery(() => receiptsRepo.listByExpense(expenseId), [expenseId])
  const [open, setOpen] = useState<Receipt | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<Receipt | null>(null)
  const [busy, run] = useBusy()
  if (!receipts) return null
  if (receipts.length === 0 && !canEdit) return null
  const full = receipts.length >= MAX_RECEIPTS_PER_EXPENSE

  return (
    <Card>
      <h2 className="mb-2 text-[15px] font-semibold">Receipt photos</h2>
      {receipts.length === 0 ? <p className="mb-3 text-sm text-slate-500">No photos yet. Add one so everyone can see what this was.</p> : null}
      <ul className="mb-3 flex flex-wrap gap-2">
        {receipts.map((r, i) => (
          <li key={r.id}>
            <ReceiptThumb receipt={r} label={`Receipt photo ${i + 1}`} onOpen={() => setOpen(r)} />
          </li>
        ))}
      </ul>
      {canEdit ? (
        <PhotoButton
          disabled={full}
          onError={setError}
          onPhotos={async (photos) => {
            setError(null)
            for (const p of photos) await receiptsRepo.add(expenseId, p)
          }}
        />
      ) : null}
      {full && canEdit ? <p className="mt-2 text-xs text-slate-500">Up to {MAX_RECEIPTS_PER_EXPENSE} photos per expense.</p> : null}
      {error ? <p role="alert" className="mt-2 text-sm text-red-700">{error}</p> : null}

      <Sheet open={open !== null} title="Receipt photo" onClose={() => setOpen(null)}>
        {open ? (
          <div className="space-y-3">
            <LargePhoto receipt={open} />
            {canEdit ? (
              <div className="flex justify-end">
                <Button variant="danger" onClick={() => { setConfirm(open); setOpen(null) }}>Remove photo</Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </Sheet>
      <ConfirmDialog
        open={confirm !== null}
        title="Remove this photo?"
        confirmLabel="Remove photo"
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => confirm && void run(async () => { await receiptsRepo.remove(confirm.id); setConfirm(null) })}
      >
        The photo is removed for everyone on this trip.
      </ConfirmDialog>
    </Card>
  )
}

function ReceiptThumb({ receipt, label, onOpen }: { receipt: Receipt; label: string; onOpen: () => void }) {
  const { blob, failed } = useReceiptBlob(receipt)
  return <Thumb blob={blob} failed={failed} label={label} onClick={blob ? onOpen : undefined} />
}

function LargePhoto({ receipt }: { receipt: Receipt }) {
  const { blob, failed } = useReceiptBlob(receipt)
  return <Thumb blob={blob} failed={failed} label="Receipt photo" large />
}

/** Photos picked on the add-expense form; they are attached once the expense is saved. */
export function PendingReceipts({ photos, onChange }: { photos: Blob[]; onChange: (photos: Blob[]) => void }) {
  const [error, setError] = useState<string | null>(null)
  return (
    <div>
      <p className="mb-2 text-sm font-medium text-slate-700">Receipt photos (optional)</p>
      {photos.length > 0 ? (
        <ul className="mb-3 flex flex-wrap gap-2">
          {photos.map((p, i) => (
            <li key={i} className="relative">
              <Thumb blob={p} failed={false} label={`Photo ${i + 1}`} />
              <button
                type="button"
                aria-label={`Remove photo ${i + 1}`}
                onClick={() => onChange(photos.filter((_, j) => j !== i))}
                className="press absolute -top-2 -right-2 inline-flex size-7 items-center justify-center rounded-full bg-black/70 text-white"
              >
                <IconX width={14} height={14} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <PhotoButton
        disabled={photos.length >= MAX_RECEIPTS_PER_EXPENSE}
        onError={setError}
        onPhotos={(added) => {
          setError(null)
          onChange([...photos, ...added].slice(0, MAX_RECEIPTS_PER_EXPENSE))
        }}
      />
      {error ? <p role="alert" className="mt-2 text-sm text-red-700">{error}</p> : null}
    </div>
  )
}
