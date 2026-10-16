'use client'

import * as React from 'react'
import { CameraIcon, ImageIcon, RotateCcwIcon, XIcon } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent } from '@/components/ui/sheet'

/**
 * Phone foundation — FRONTEND_RULES_PHONE.md §41.16 rules 1-6: a photo
 * field that lets the person take a photo or choose one from the gallery,
 * shrinks it on the client before upload, shows a thumbnail with its own
 * progress, retries a failed upload up to 3 times on its own and then
 * shows Retry, and opens a tapped thumbnail full screen through the
 * existing Sheet (portaled to body).
 *
 * Generic over `upload`, so any screen can plug in its own endpoint.
 * `uploadExpensePhoto` below is the ready-made helper for
 * `POST /api/expenses/upload`, the first real consumer.
 */

const MAX_LONG_SIDE = 1600
const JPEG_QUALITY = 0.8
const MAX_RETRIES = 3

export type PhotoUploadResult = { url: string }
export type PhotoUpload = (file: Blob) => Promise<PhotoUploadResult>

export type CapturedPhoto = {
  id: string
  /** Local object URL for the thumbnail/full view — revoked on removal. */
  previewUrl: string
  status: 'uploading' | 'done' | 'failed'
  /** Set once the upload succeeds. */
  url?: string
  attempts: number
}

/**
 * `POST /api/expenses/upload` — see src/app/api/expenses/upload/route.ts.
 * Multipart, field name `file`, response `{ url }` on success or
 * `{ error }` (non-2xx) on failure.
 */
export async function uploadExpensePhoto(file: Blob): Promise<PhotoUploadResult> {
  const form = new FormData()
  form.append('file', file, 'photo.jpg')
  const res = await fetch('/api/expenses/upload', { method: 'POST', body: form })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error || 'Upload failed')
  if (!data?.url) throw new Error('Upload failed')
  return { url: data.url as string }
}

/** §41.16 rule 4: shrink to at most 1600px on the long side, JPEG ~0.8. */
async function shrinkImage(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => null)
  if (!bitmap) return file
  const longSide = Math.max(bitmap.width, bitmap.height)
  const scale = longSide > MAX_LONG_SIDE ? MAX_LONG_SIDE / longSide : 1
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return file
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close?.()

  const blob = await new Promise<Blob | null>(resolve =>
    canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY)
  )
  return blob ?? file
}

export type PhotoCaptureProps = {
  photos: CapturedPhoto[]
  onChange: (photos: CapturedPhoto[]) => void
  upload?: PhotoUpload
  label?: string
  max?: number
  className?: string
}

/**
 * `upload` defaults to `uploadExpensePhoto`. Pass a different function for
 * any other photo-accepting record.
 */
export function PhotoCapture({
  photos,
  onChange,
  upload = uploadExpensePhoto,
  label = 'Photo',
  max,
  className,
}: PhotoCaptureProps) {
  const cameraInputRef = React.useRef<HTMLInputElement | null>(null)
  const galleryInputRef = React.useRef<HTMLInputElement | null>(null)
  const [cameraDenied, setCameraDenied] = React.useState(false)
  const [viewing, setViewing] = React.useState<CapturedPhoto | null>(null)

  const atMax = max !== undefined && photos.length >= max

  function runUpload(id: string, blob: Blob, attemptsSoFar: number) {
    upload(blob)
      .then(({ url }) => {
        onChange(
          photosRef.current.map(p => (p.id === id ? { ...p, status: 'done', url } : p))
        )
      })
      .catch(() => {
        const attempts = attemptsSoFar + 1
        if (attempts < MAX_RETRIES) {
          onChange(photosRef.current.map(p => (p.id === id ? { ...p, attempts } : p)))
          runUpload(id, blob, attempts)
        } else {
          onChange(
            photosRef.current.map(p => (p.id === id ? { ...p, status: 'failed', attempts } : p))
          )
        }
      })
  }

  // Upload callbacks read the latest list through a ref so a fast series of
  // selections (and their async resolutions) never clobber each other.
  const photosRef = React.useRef(photos)
  photosRef.current = photos
  const blobsRef = React.useRef(new Map<string, Blob>())

  async function addFile(file: File) {
    const id = crypto.randomUUID()
    const shrunk = await shrinkImage(file)
    blobsRef.current.set(id, shrunk)
    const previewUrl = URL.createObjectURL(shrunk)
    const next: CapturedPhoto = { id, previewUrl, status: 'uploading', attempts: 0 }
    onChange([...photosRef.current, next])
    runUpload(id, shrunk, 0)
  }

  function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return
    Array.from(fileList).forEach(f => {
      if (f.type.startsWith('image/')) void addFile(f)
    })
  }

  function openCamera() {
    if (cameraDenied) {
      galleryInputRef.current?.click()
      return
    }
    cameraInputRef.current?.click()
  }

  function retry(photo: CapturedPhoto) {
    const blob = blobsRef.current.get(photo.id)
    if (!blob) return
    onChange(
      photosRef.current.map(p => (p.id === photo.id ? { ...p, status: 'uploading' } : p))
    )
    runUpload(photo.id, blob, 0)
  }

  function remove(photo: CapturedPhoto) {
    URL.revokeObjectURL(photo.previewUrl)
    blobsRef.current.delete(photo.id)
    onChange(photosRef.current.filter(p => p.id !== photo.id))
  }

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {photos.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {photos.map(photo => (
            <PhotoThumb key={photo.id} photo={photo} onTap={() => setViewing(photo)} onRetry={() => retry(photo)} onRemove={() => remove(photo)} />
          ))}
        </div>
      ) : null}

      {cameraDenied ? (
        <p className="text-meta text-text-muted">
          Camera access is off. Allow it in your phone&apos;s settings to take a photo, or
          choose one from the gallery below.
        </p>
      ) : null}

      {!atMax ? (
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={openCamera} className="flex-1">
            <CameraIcon aria-hidden /> Take photo
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => galleryInputRef.current?.click()}
            className="flex-1"
          >
            <ImageIcon aria-hidden /> Choose from gallery
          </Button>
        </div>
      ) : null}

      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        aria-label={`Take a photo for ${label}`}
        onChange={event => {
          // No reliable permission-denial signal for <input capture> — if no
          // file comes back we treat the attempt as refused, next time
          // falling back to the gallery per §41.16 rule 3.
          if (!event.target.files || event.target.files.length === 0) {
            setCameraDenied(true)
          } else {
            setCameraDenied(false)
            handleFiles(event.target.files)
          }
          event.target.value = ''
        }}
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        multiple={max === undefined || max > 1}
        className="hidden"
        aria-label={`Choose a photo for ${label}`}
        onChange={event => {
          handleFiles(event.target.files)
          event.target.value = ''
        }}
      />

      <Sheet open={viewing !== null} onOpenChange={open => !open && setViewing(null)}>
        <SheetContent side="bottom" className="h-[100dvh] items-center justify-center bg-black/95 p-0">
          {viewing ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={viewing.previewUrl}
              alt=""
              className="max-h-full max-w-full object-contain"
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  )
}

function PhotoThumb({
  photo,
  onTap,
  onRetry,
  onRemove,
}: {
  photo: CapturedPhoto
  onTap: () => void
  onRetry: () => void
  onRemove: () => void
}) {
  return (
    <div className="relative size-20 shrink-0 overflow-hidden rounded-lg border border-border-light bg-surface-sunken">
      <button type="button" onClick={onTap} className="block size-full">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photo.previewUrl} alt="" className="size-full object-cover" />
      </button>
      {photo.status === 'uploading' ? (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40">
          <div className="size-5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
        </div>
      ) : null}
      {photo.status === 'failed' ? (
        <button
          type="button"
          onClick={onRetry}
          aria-label="Retry upload"
          className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-danger-bg/90 text-danger"
        >
          <RotateCcwIcon aria-hidden className="size-4" />
          <span className="text-meta font-medium">Retry</span>
        </button>
      ) : null}
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove photo"
        className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-black/60 text-white"
      >
        <XIcon aria-hidden className="size-3" />
      </button>
    </div>
  )
}
