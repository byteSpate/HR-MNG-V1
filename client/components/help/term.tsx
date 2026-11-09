"use client"

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

/**
 * One accounting term inside help copy, marked with a dotted underline.
 *
 * Click opens a popover with the one-line definition; hover shows it as a
 * tooltip. The two are composed on the same trigger so both paths exist — a
 * mouse gets the quick answer, a deliberate read gets the stable one.
 *
 * `lang` typesets and pronounces the term as English (Decision 3): a term like
 * **Trial balance** inside Bangla prose keeps the Latin face and the English
 * voice while its definition — here, the Bangla one — stays Bangla. Defaults
 * to undefined so the all-English panel is unchanged.
 */
export function Term({
  term,
  definition,
  lang,
}: {
  term: string
  definition: string
  lang?: "en"
}) {
  return (
    <Tooltip>
      <Popover>
        <PopoverTrigger
          nativeButton={false}
          render={
            <TooltipTrigger
              render={
                <span
                  lang={lang}
                  className={`relative cursor-help pointer-coarse:after:absolute pointer-coarse:after:-inset-x-1 pointer-coarse:after:-inset-y-3 pointer-coarse:after:content-[''] border-b border-dotted border-line-strong ${lang ? "font-sans" : ""}`}
                >
                  {term}
                </span>
              }
            />
          }
        />
        <PopoverContent className="w-64">
          <p lang={lang} className="text-caption leading-[1.6] text-ink-soft">
            {definition}
          </p>
        </PopoverContent>
      </Popover>
      <TooltipContent>
        <span lang={lang} className="text-caption">
          {definition}
        </span>
      </TooltipContent>
    </Tooltip>
  )
}
