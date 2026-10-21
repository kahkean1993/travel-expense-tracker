/** Draws the settle-up summary as a PNG, for sharing into a chat where a table reads better than text. */
import type { TripData } from '../../db/hooks'
import { formatMoney } from '../../lib/money/money'
import { settlementFor } from './settlement'

export async function summaryImage(data: TripData): Promise<Blob | null> {
  const { trip } = data
  const cur = trip.baseCurrency
  const { names, balances, transfers } = settlementFor(data)
  const rows: { text: string; right?: string; bold?: boolean; muted?: boolean }[] = []
  rows.push({ text: transfers.length ? 'Who pays whom' : 'Everyone is settled up', bold: true })
  for (const t of transfers) rows.push({ text: `${names.get(t.fromTravellerId)} → ${names.get(t.toTravellerId)}`, right: formatMoney(t.amount, cur) })
  rows.push({ text: '' })
  rows.push({ text: 'Balances', bold: true })
  for (const b of balances) {
    rows.push({
      text: names.get(b.travellerId) ?? '?',
      right: `${b.net > 0 ? 'gets back' : b.net < 0 ? 'owes' : 'settled'} ${b.net === 0 ? '' : formatMoney(Math.abs(b.net), cur)}`.trim(),
    })
  }
  const W = 720
  const line = 52
  const H = 170 + rows.length * line + 60
  const canvas = document.createElement('canvas')
  canvas.width = W * 2
  canvas.height = H * 2
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.scale(2, 2)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = '#0f766e'
  ctx.fillRect(0, 0, W, 110)
  const font = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
  ctx.fillStyle = '#ffffff'
  ctx.font = `700 34px ${font}`
  ctx.fillText(trip.name.slice(0, 34), 40, 55)
  ctx.font = `400 20px ${font}`
  ctx.fillText('Settle up', 40, 88)
  let y = 160
  for (const r of rows) {
    ctx.fillStyle = r.bold ? '#0f766e' : '#121b18'
    ctx.font = `${r.bold ? 700 : 500} ${r.bold ? 22 : 26}px ${font}`
    ctx.textAlign = 'left'
    ctx.fillText(r.text, 40, y)
    if (r.right) {
      ctx.textAlign = 'right'
      ctx.font = `600 26px ${font}`
      ctx.fillText(r.right, W - 40, y)
    }
    y += line
  }
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'))
}
