/** Shrinks a phone photo so a receipt takes roughly 150–400 KB instead of 3–5 MB. */
import { MAX_RECEIPT_BYTES } from '../types/domain'

const MAX_SIDE = 1600

export class PhotoError extends Error {}

export async function shrinkPhoto(file: File | Blob): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new PhotoError('Choose a photo (JPEG, PNG or WebP).')
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new PhotoError('This photo could not be read. Try a JPEG or PNG.')
  }
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new PhotoError('This device cannot process photos.')
    ctx.fillStyle = '#ffffff' // transparent PNGs become white, not black, in JPEG
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    for (const quality of [0.74, 0.6, 0.45]) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
      if (blob && blob.size <= MAX_RECEIPT_BYTES * 0.75) return blob
      if (blob && quality === 0.45 && blob.size <= MAX_RECEIPT_BYTES) return blob
    }
    throw new PhotoError('This photo is still too large after shrinking.')
  } finally {
    bitmap.close()
  }
}
