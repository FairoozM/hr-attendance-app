import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import { applyCssSnapshot, snapshotDocumentCss } from '../../lib/exportCssSnapshot'
import type { InfluencerPerformanceRankingDatePreset } from '../../pages/influencers/influencerPerformanceRankingUtils'

/** Fixed layout width of the off-screen PDF document (CSS px). */
export const RANKING_PDF_DOC_WIDTH = 1400

/** html2canvas render scale; the PDF page is sized back down by the same factor. */
const PDF_CAPTURE_SCALE = 2

const IMAGE_LOAD_TIMEOUT_MS = 4000

function localDateStamp(date = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function rankingPdfFilename(
  datePreset: InfluencerPerformanceRankingDatePreset,
  customFrom: string,
  customTo: string,
) {
  const period = datePreset === 'custom'
    ? [customFrom || 'start', customTo || 'end'].join('_to_')
    : datePreset
  return `influencer-performance-ranking-${period}-${localDateStamp()}.pdf`
}

function nextPaint() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
}

/** Resolve once every <img> under `root` has loaded (or failed), bounded by a timeout. */
async function waitForImages(root: HTMLElement) {
  const images = Array.from(root.querySelectorAll('img'))
  if (!images.length) return
  await Promise.race([
    Promise.all(images.map((img) => {
      if (img.complete) return Promise.resolve()
      return new Promise<void>((resolve) => {
        img.addEventListener('load', () => resolve(), { once: true })
        img.addEventListener('error', () => resolve(), { once: true })
      })
    })),
    new Promise<void>((resolve) => { setTimeout(resolve, IMAGE_LOAD_TIMEOUT_MS) }),
  ])
}

/** Let webfonts, avatar images and layout settle, then rasterize `target`. */
export async function captureRankingDocumentCanvas(target: HTMLElement): Promise<HTMLCanvasElement> {
  if ('fonts' in document) {
    await document.fonts.ready
  }
  await waitForImages(target)
  await nextPaint()
  const cssSnapshot = snapshotDocumentCss()
  return html2canvas(target, {
    scale: PDF_CAPTURE_SCALE,
    useCORS: true,
    backgroundColor: '#f8f9fc',
    logging: false,
    width: target.offsetWidth,
    height: target.offsetHeight,
    windowWidth: Math.max(target.offsetWidth, document.documentElement.clientWidth),
    windowHeight: Math.max(target.offsetHeight, document.documentElement.clientHeight),
    onclone: (clone) => applyCssSnapshot(clone, cssSnapshot),
  })
}

/** Single PDF page sized to the canvas, so rows are never split across pages. */
export function saveCanvasAsPdf(canvas: HTMLCanvasElement, filename: string) {
  const pageWidth = canvas.width / PDF_CAPTURE_SCALE
  const pageHeight = canvas.height / PDF_CAPTURE_SCALE
  const pdf = new jsPDF({
    orientation: pageWidth > pageHeight ? 'landscape' : 'portrait',
    unit: 'px',
    format: [pageWidth, pageHeight],
  })
  pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, pageWidth, pageHeight)
  pdf.save(filename)
}
