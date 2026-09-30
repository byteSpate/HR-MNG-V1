"use client"

import { RiAddLine } from "@remixicon/react"

import { MAX_CUSTOM_QUESTIONS, type CustomRow } from "@/lib/account-profile"
import { Field } from "@/components/dashboard/record-kit"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

/**
 * The account's own questions: a question and its answer per row. Used on the
 * create form and in the Edit profile dialog, so both work the same way. A new
 * row has `id: null`. Rows are plain controlled inputs, so nothing here talks
 * to the server: the caller decides when to save.
 */
export function CustomQnaEditor({
  rows,
  onChange,
  idPrefix,
  disabled,
}: {
  rows: CustomRow[]
  onChange: (rows: CustomRow[]) => void
  idPrefix: string
  disabled?: boolean
}) {
  const set = (index: number, patch: Partial<CustomRow>) =>
    onChange(rows.map((row, n) => (n === index ? { ...row, ...patch } : row)))

  return (
    <div className="space-y-3">
      {rows.map((row, i) => (
        <div key={i} className="rounded-md border border-[#E4E9EF] bg-white p-3">
          <div className="grid gap-2.5">
            <Field label="Question" htmlFor={`${idPrefix}-q-${i}`}>
              <Input
                id={`${idPrefix}-q-${i}`}
                value={row.question}
                maxLength={200}
                disabled={disabled}
                onChange={(e) => set(i, { question: e.target.value })}
              />
            </Field>
            <Field label="Answer" htmlFor={`${idPrefix}-a-${i}`}>
              <Input
                id={`${idPrefix}-a-${i}`}
                value={row.answer}
                maxLength={500}
                disabled={disabled}
                onChange={(e) => set(i, { answer: e.target.value })}
              />
            </Field>
          </div>
          <Button
            type="button"
            variant="link"
            disabled={disabled}
            onClick={() => onChange(rows.filter((_, n) => n !== i))}
            className="mt-1 h-auto p-0 text-[12px] font-bold text-[#B03A3A] underline"
          >
            Remove
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        disabled={disabled || rows.length >= MAX_CUSTOM_QUESTIONS}
        onClick={() => onChange([...rows, { id: null, question: "", answer: "" }])}
        className="h-8 gap-1.5 px-2.5 text-[12px] font-bold"
      >
        <RiAddLine className="size-3.5" aria-hidden />
        Add a question
      </Button>
    </div>
  )
}
