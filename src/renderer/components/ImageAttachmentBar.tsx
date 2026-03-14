import { useCallback, useRef, useState } from 'react';
import { ImageLightbox } from './ImageLightbox';
import type { AttachedImage } from '../hooks/useImageAttachment';

interface ImageAttachmentBarProps {
  images: AttachedImage[];
  onRemove: (index: number) => void;
  onAddFiles: (files: FileList | File[]) => void;
  /** Render as a tight inline strip (for action-area inputs in job detail panel) */
  compact?: boolean;
}

/**
 * Compact image attachment UI:
 * - Minimal "Attach" button with image icon
 * - Tight thumbnail strip with click-to-preview lightbox
 * - Hover × badge to remove, positioned outside the click area
 *
 * Used by NewJobDialog and all ActionArea inputs in JobDetailPanel.
 */
export function ImageAttachmentBar({ images, onRemove, onAddFiles, compact }: ImageAttachmentBarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [thumbSize, setThumbSize] = useState(0);

  /* Measure the attach button so thumbnails match its height exactly */
  const attachBtnRef = useCallback((node: HTMLButtonElement | null) => {
    if (node) setThumbSize(node.offsetHeight);
  }, []);

  return (
    <>
      {/* Inline strip: attach button + thumbnails on same row */}
      <div className={`flex items-center gap-1.5 ${compact ? '' : 'mb-4'}`}>
        {/* Attach button */}
        <button
          ref={attachBtnRef}
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="shrink-0 flex items-center gap-1 rounded-md border border-chrome text-content-secondary hover:bg-surface-tertiary hover:text-content-primary transition-all duration-150 px-2 py-1 text-[11px]"
        >
          <svg
            width={12}
            height={12}
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="opacity-90"
          >
            <rect x="2" y="2" width="12" height="12" rx="2" />
            <circle cx="5.5" cy="5.5" r="1" />
            <path d="M14 10l-3-3-7 7" />
          </svg>
          <span>Attach</span>
        </button>

        {/* Thumbnail strip — each thumb is a square matching the button height */}
        {images.length > 0 && thumbSize > 0 && (
          <div className="flex items-center gap-1.5 min-w-0">
            {images.map((img, i) => (
              <div
                key={i}
                className="relative group/thumb shrink-0"
                style={{ width: thumbSize, height: thumbSize }}
              >
                {/* Thumbnail — click to preview */}
                <button
                  type="button"
                  onClick={() => setLightboxIndex(i)}
                  className="w-full h-full rounded-md overflow-hidden border border-chrome hover:border-content-tertiary/60 transition-colors cursor-pointer block focus:outline-none focus:ring-1 focus:ring-focus-ring/40"
                >
                  <img
                    src={img.dataUrl}
                    alt={img.name}
                    className="w-full h-full object-cover"
                  />
                </button>
                {/* Remove × — edge badge, overflows outside thumbnail */}
                <button
                  type="button"
                  onClick={() => onRemove(i)}
                  className="absolute -top-1.5 -right-1.5 z-10 w-[14px] h-[14px] rounded-full bg-content-primary flex items-center justify-center opacity-0 group-hover/thumb:opacity-100 transition-opacity"
                >
                  <svg width="6" height="6" viewBox="0 0 6 6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-content-inverted">
                    <path d="M1 1l4 4M5 1l-4 4" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = e.target.files;
            if (files) onAddFiles(files);
            e.target.value = '';
          }}
        />
      </div>

      {/* Lightbox */}
      {lightboxIndex !== null && (
        <ImageLightbox
          images={images}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </>
  );
}
