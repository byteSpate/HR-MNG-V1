import { randomUUID } from "node:crypto"

import { AppError } from "../../middleware/errorHandler"
import { getCloudinary } from "./media.provider"
import type { UploadedAsset } from "./media.types"

export const DOCUMENT_URL_TTL_SECONDS = 300

/**
 * Stable per employee, so a new photo replaces the old one and no orphaned
 * assets accumulate.
 */
export function avatarPublicId(employeeId: string): string {
  return `hr/avatars/${employeeId}`
}

export function documentFolderPrefix(employeeId: string): string {
  return `hr/documents/${employeeId}/`
}

/** Random, because two contracts for the same person are two documents. */
export function documentPublicId(employeeId: string): string {
  return `${documentFolderPrefix(employeeId)}${randomUUID()}`
}

export function costFolderPrefix(costId: string): string {
  return `hr/costs/${costId}/`
}

/** Random, because two receipts for the same bill are two files. */
export function costPublicId(costId: string): string {
  return `${costFolderPrefix(costId)}${randomUUID()}`
}

export function expenseFolderPrefix(claimId: string): string {
  return `hr/expenses/${claimId}/`
}

/** Random, because two receipts for the same claim are two files. */
export function expensePublicId(claimId: string): string {
  return `${expenseFolderPrefix(claimId)}${randomUUID()}`
}

/** Random, because two receipts for the same journal are two files. */
export function journalPublicId(journalId: string): string {
  return `journals/${journalId}/${randomUUID()}`
}

/**
 * Condition photos are stored under the **asset's** folder, not the
 * assignment's: an assignment is a moment and an asset is the thing, so
 * grouping by asset keeps every photograph of one laptop together.
 */
export function assetFolderPrefix(assetId: string): string {
  return `assets/${assetId}`
}

export function assetPublicId(assetId: string): string {
  return `${assetFolderPrefix(assetId)}/${randomUUID()}`
}

/**
 * Streams an in-memory buffer to Cloudinary.
 *
 * `public_id` carries the full path and **no `folder` option is passed**.
 * Cloudinary concatenates the two when both are present, so sending
 * `folder: "hr/avatars"` alongside `public_id: "hr/avatars/emp-1"` would store
 * the asset at `hr/avatars/hr/avatars/emp-1`.
 *
 * `resource_type: "image"` is pinned rather than left as `auto`. Every format
 * this API accepts — pdf, jpg, jpeg, png, webp — is an `image` resource to
 * Cloudinary, and pinning it keeps upload and delivery in agreement:
 * `private_download_url` defaults to `image`, so an `auto` upload that
 * classified something as `raw` would produce a download URL that 404s.
 */
export function uploadBuffer(buffer: Buffer, publicId: string): Promise<UploadedAsset> {
  const cloudinary = getCloudinary()
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        public_id: publicId,
        // No default in the SDK. Omitting this yields a permanently public
        // CDN URL — for an NID scan, that is a data breach.
        type: "authenticated",
        resource_type: "image",
        overwrite: true,
        invalidate: true,
      },
      (error: unknown, result: { public_id: string; version: number; bytes: number; format: string } | undefined) => {
        if (error || !result) {
          console.error("Cloudinary upload failed", error)
          return reject(new AppError(502, "Upload to the file store failed. Please try again."))
        }
        resolve({
          publicId: result.public_id,
          version: result.version,
          bytes: result.bytes,
          format: result.format,
        })
      }
    )
    stream.end(buffer)
  })
}

/**
 * A stable, signed, non-expiring URL for an avatar.
 *
 * `sign_url` makes the URL unguessable without the API secret; it does not
 * expire. That is the right trade for a headshot rendered inline on every page
 * — the alternative breaks CDN caching and adds a round trip per page load.
 * Documents get the expiring mechanism instead.
 *
 * `version` matters because the avatar public id is stable: a re-upload
 * replaces the asset behind an unchanged URL, which a CDN keeps serving from
 * cache. Without the version, changing your photo appears to do nothing.
 */
export function signedAvatarUrl(publicId: string, version?: number): string {
  const cloudinary = getCloudinary()
  return cloudinary.url(publicId, {
    type: "authenticated",
    resource_type: "image",
    sign_url: true,
    secure: true,
    ...(version === undefined ? {} : { version }),
  })
}

/**
 * A five-minute signed download URL for a document.
 *
 * Deliberately not `generate_auth_token`: token-based delivery authentication
 * is gated to Cloudinary's higher plans, and building the document vault on it
 * would make the feature stop working on a plan change. The download API has
 * no such gate.
 */
export function signedDocumentUrl(
  publicId: string,
  format: string
): { url: string; expiresAt: string } {
  const cloudinary = getCloudinary()
  const expiresAtSeconds = Math.floor(Date.now() / 1000) + DOCUMENT_URL_TTL_SECONDS
  const url = cloudinary.utils.private_download_url(publicId, format, {
    type: "authenticated",
    resource_type: "image",
    expires_at: expiresAtSeconds,
  })
  return { url, expiresAt: new Date(expiresAtSeconds * 1000).toISOString() }
}

/**
 * Destroys the asset, tolerating one that is already gone.
 *
 * Called *before* the row is deleted. The reverse order can orphan a paid
 * asset with no record that it exists; this order can at worst leave a row
 * pointing at a destroyed asset, which the URL endpoint surfaces as a clean
 * 404. A dangling row is recoverable, a dangling asset is invisible.
 */
export async function destroyAsset(publicId: string): Promise<void> {
  const cloudinary = getCloudinary()
  try {
    await cloudinary.uploader.destroy(publicId, {
      type: "authenticated",
      resource_type: "image",
      invalidate: true,
    })
  } catch (err) {
    console.error("Failed to destroy Cloudinary asset", publicId, err)
  }
}
