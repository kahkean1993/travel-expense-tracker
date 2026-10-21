import { useId, useState } from 'react'
import { COMMON_CURRENCIES, isValidCurrencyCode, normaliseCurrencyCode } from '../lib/money/money'
import { inputClass } from './styles'

const OTHER = '__other__'

/** Dropdown of common currencies with an "Other code" text entry. */
export function CurrencySelect({
  id,
  value,
  onChange,
  extra = [],
  invalid,
  describedBy,
  disabled,
}: {
  id?: string
  value: string
  onChange: (code: string) => void
  /** Additional codes to list first (e.g. recently used on this trip). */
  extra?: string[]
  invalid?: boolean
  describedBy?: string
  disabled?: boolean
}) {
  const autoId = useId()
  const options = [...new Set([...extra, ...COMMON_CURRENCIES])]
  const [custom, setCustom] = useState(() => !options.includes(value))
  const [text, setText] = useState(value)
  const listed = options.includes(value) && !custom

  return (
    <div className="flex gap-2">
      <select
        id={id ?? autoId}
        className={`${inputClass} ${custom ? 'w-28 shrink-0' : ''}`}
        value={listed ? value : OTHER}
        disabled={disabled}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        onChange={(e) => {
          if (e.target.value === OTHER) {
            setCustom(true)
            setText('')
            onChange('')
          } else {
            setCustom(false)
            onChange(e.target.value)
          }
        }}
      >
        {options.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
        <option value={OTHER}>Other…</option>
      </select>
      {custom ? (
        <input
          className={`${inputClass} uppercase`}
          value={text}
          maxLength={3}
          placeholder="e.g. VND"
          aria-label="Currency code"
          aria-invalid={invalid || (text.length === 3 && !isValidCurrencyCode(normaliseCurrencyCode(text)))}
          disabled={disabled}
          autoCapitalize="characters"
          autoComplete="off"
          onChange={(e) => {
            const code = normaliseCurrencyCode(e.target.value).replace(/[^A-Z]/g, '')
            setText(code)
            onChange(code)
          }}
        />
      ) : null}
    </div>
  )
}
