import { tones, type Tone } from "@/components/dashboard/types"

export function Tag({ label, tone }: { label: string; tone: Tone }) {
  const { bg, color } = tones[tone]
  return (
    <span
      className="inline-flex shrink-0 items-center rounded whitespace-nowrap px-2.5 py-0.5 text-caption font-bold"
      style={{ background: bg, color }}
    >
      {label}
    </span>
  )
}
