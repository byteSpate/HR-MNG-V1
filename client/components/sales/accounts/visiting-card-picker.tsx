"use client"

import { useEffect, useId, useRef, useState } from "react"
import { RiImageAddLine } from "@remixicon/react"

import { CARD_ACCEPT, checkCardFile, formatBytes } from "@/lib/visiting-card"
import { TONE } from "@/components/dashboard/record-kit"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * The area you click, press Enter on, or drop a picture onto.
 *
 * It is a real `<label>` around a real file input, so the keyboard and screen
 * readers get the standard file button for free. The input is visually hidden,
 * not `display: none`, or it could not take focus. A picture that cannot be used
 * is refused here, in words, before anything is sent.
 *
 * The shared `ui/file-upload.tsx` is a hidden input with a button. It has no
 * drop area and no preview, and this field needs both, so it is not reused.
 */
export function CardDropZone({
  onFile,
  onProblem,
  disabled,
  title,
  hint,
}: {
  onFile: (file: File) => void
  /** Called with a sentence when the chosen file cannot be used, and with null when a good one is chosen. */
  onProblem: (message: string | null) => void
  disabled?: boolean
  title: string
  hint: string
}) {
  const id = useId()
  const [dragging, setDragging] = useState(false)

  const take = (file: File | undefined) => {
    if (!file) return
    const problem = checkCardFile(file)
    onProblem(problem)
    if (!problem) onFile(file)
  }

  return (
    <label
      htmlFor={id}
      onDragOver={(e) => {
        if (disabled) return
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        if (!disabled) take(e.dataTransfer.files[0])
      }}
      className={cn(
        "flex cursor-pointer items-center gap-3 rounded-md border border-dashed px-4 py-4 transition-[border-color,background-color] duration-150 ease-out focus-within:ring-2 focus-within:ring-[#17191C]/25 motion-reduce:transition-none",
        dragging ? "border-[#17191C] bg-[#F1F4F8]" : "border-[#CBD3DE] bg-[#F7F9FB] hover:border-[#8A94A2] hover:bg-[#F1F4F8]",
        disabled && "pointer-events-none opacity-60",
      )}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-white text-[#5F6B7C] shadow-[0_1px_2px_rgba(28,39,51,0.08)]">
        <RiImageAddLine className="size-5" aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-bold">{title}</span>
        <span className={cn("block text-[12px]", TONE.muted)}>{hint}</span>
      </span>
      <input
        id={id}
        type="file"
        accept={CARD_ACCEPT}
        disabled={disabled}
        className="sr-only"
        onChange={(e) => {
          take(e.target.files?.[0])
          // The same file chosen twice must still fire a change.
          e.target.value = ""
        }}
      />
    </label>
  )
}

/**
 * A picture the browser can draw for a chosen file.
 *
 * Read with a `FileReader` and set from its callback. The result is kept with
 * the file it belongs to, so a preview is only ever shown for the file that is
 * chosen now, never the one before it while the new one is still being read.
 */
function usePreviewUrl(file: File | null): string | null {
  const [read, setRead] = useState<{ file: File; url: string } | null>(null)
  useEffect(() => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setRead({ file, url: String(reader.result) })
    reader.readAsDataURL(file)
    return () => {
      reader.onload = null
      if (reader.readyState === FileReader.LOADING) reader.abort()
    }
  }, [file])
  return file && read?.file === file ? read.url : null
}

/**
 * The optional "Visiting card" field on the create-account form.
 *
 * Nothing is sent from here: the picture is held until the account is saved,
 * because it needs the new account's id. Once one is chosen the drop area turns
 * into a preview row, so the choice can be seen and taken back.
 */
export function VisitingCardPicker({
  file,
  onChange,
  disabled,
}: {
  file: File | null
  onChange: (file: File | null) => void
  disabled?: boolean
}) {
  const [problem, setProblem] = useState<string | null>(null)
  const preview = usePreviewUrl(file)
  const changeRef = useRef<HTMLInputElement>(null)

  return (
    <div className="space-y-2">
      {file ? (
        <div className="rise-in flex items-center gap-3 rounded-md border border-[#E4E9EF] bg-white p-2.5 motion-reduce:animate-none">
          <span className="flex h-[52px] w-[84px] shrink-0 items-center justify-center overflow-hidden rounded-md border border-[#E4E9EF] bg-[#F7F9FB]">
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="The chosen visiting card" className="max-h-full max-w-full object-contain" />
            ) : null}
          </span>
          {/* `w-0 flex-1`, not just `min-w-0`: a long file name would otherwise count
              toward the dialog's minimum width and push its footer out sideways. */}
          <span className="w-0 min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold">{file.name}</span>
            <span className={cn("block text-[12px]", TONE.muted)}>{formatBytes(file.size)}</span>
          </span>
          <span className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="outline"
              disabled={disabled}
              onClick={() => changeRef.current?.click()}
              className="h-8 px-2.5 text-[12px] font-bold"
            >
              Change
            </Button>
            <Button
              type="button"
              variant="link"
              disabled={disabled}
              onClick={() => {
                setProblem(null)
                onChange(null)
              }}
              className="h-8 px-2 text-[12px] font-bold text-[#5F6B7C] underline"
            >
              Remove
            </Button>
            <input
              ref={changeRef}
              type="file"
              accept={CARD_ACCEPT}
              className="sr-only"
              tabIndex={-1}
              aria-label="Choose a different visiting card picture"
              onChange={(e) => {
                const picked = e.target.files?.[0]
                e.target.value = ""
                if (!picked) return
                const issue = checkCardFile(picked)
                setProblem(issue)
                if (!issue) onChange(picked)
              }}
            />
          </span>
        </div>
      ) : (
        <CardDropZone
          onFile={onChange}
          onProblem={setProblem}
          disabled={disabled}
          title="Choose a picture"
          hint="Or drop it here. JPG, PNG or WebP, up to 5 MB."
        />
      )}
      {problem ? (
        <p role="alert" className="text-[12px] font-semibold text-[#B03A3A]">
          {problem}
        </p>
      ) : null}
    </div>
  )
}
