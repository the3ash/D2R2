import { useEffect, useMemo, useRef, useState } from 'react'

export type DropdownOption = {
  label: string
  value: string
}

type Props = {
  id?: string
  value: string
  options: DropdownOption[]
  disabled?: boolean
  menuPlacement?: 'up' | 'down'
  onChange: (value: string) => void
}

function valuesEqual(a: string, b: string): boolean {
  if (a === b) return true
  const aNum = Number.parseFloat(a)
  const bNum = Number.parseFloat(b)
  if (!Number.isFinite(aNum) || !Number.isFinite(bNum)) return false
  return Math.abs(aNum - bNum) < 1e-6
}

export function Dropdown({
  id,
  value,
  options,
  disabled,
  menuPlacement = 'down',
  onChange,
}: Props) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  const selected = useMemo(() => {
    const match = options.find((o) => valuesEqual(o.value, value))
    return match ?? options[0]
  }, [options, value])

  const selectedValue = selected?.value ?? options[0]?.value ?? ''

  useEffect(() => {
    if (!open) return

    const onMouseDown = (e: MouseEvent) => {
      if (!rootRef.current) return
      if (rootRef.current.contains(e.target as Node)) return
      setOpen(false)
    }

    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open])

  return (
    <div ref={rootRef} className="dropdown">
      <button
        id={id}
        type="button"
        className="dropdown-trigger font-body"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="dropdown-value">{selected?.label}</span>
        <svg
          className="dropdown-arrow"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            d="M6 9l6 6 6-6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && !disabled && (
        <div
          className={`dropdown-menu ${menuPlacement === 'up' ? 'dropdown-menu--up' : ''}`}
          role="listbox"
          aria-labelledby={id}
        >
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className="dropdown-option font-body"
              role="option"
              aria-selected={valuesEqual(opt.value, selectedValue)}
              onClick={() => {
                onChange(opt.value)
                setOpen(false)
              }}
            >
              <span className="dropdown-option-label">{opt.label}</span>
              <span className="dropdown-option-check" aria-hidden="true">
                ✓
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
