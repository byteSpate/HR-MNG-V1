import Image from "next/image"

import { cx } from "./classes"

/**
 * A picture. `alt` is required (pass "" only for a picture that is pure decoration).
 * Uses next/image with `unoptimized`, because the sources here are uploads, blob
 * previews and signed URLs that the optimizer cannot be told about in advance.
 * Give width and height, or `fill` inside a `relative` parent.
 */
export function Img(
  props: { src: string; alt: string; className?: string; sizes?: string } & (
    | { width: number; height: number; fill?: never }
    | { fill: true; width?: never; height?: never }
  ),
) {
  const { src, alt, className, sizes, ...size } = props
  return <Image src={src} alt={alt} sizes={sizes} unoptimized className={cx(className)} {...size} />
}
