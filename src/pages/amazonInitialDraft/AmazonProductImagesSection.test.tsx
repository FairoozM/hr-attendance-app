import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import AmazonProductImagesSection from './AmazonProductImagesSection'
import type { ImagePreview, ImageRecord } from '../../api/amazonInitialDraft'

const BASE = 'https://images.lifesmile.ae/amazon-public/amazon-ae'

function record(overrides: Partial<ImageRecord> = {}): ImageRecord {
  return {
    sourceKey: `marketplace-originals/amazon-ae/batch/${overrides.filename || 'file.jpg'}`,
    filename: 'file.jpg',
    sku: 'NSEL-20',
    detectedSku: 'NSEL-20',
    detectedPosition: 'Main',
    positionSlot: 'MAIN',
    positionNumber: 0,
    classification: 'main',
    matchStatus: 'matched',
    channel: 'WEBSITE',
    matchedIdentity: 'NSEL-20',
    matchKind: 'exact',
    suffixQuality: 'clean',
    status: 'ready',
    populationStatus: 'populated',
    publicUrl: `${BASE}/NSEL-20/MAIN.jpg`,
    deliveryKey: 'amazon-public/amazon-ae/NSEL-20/MAIN.jpg',
    deliveryAction: 'created',
    sourceSize: 1_048_576,
    width: 2000,
    height: 2000,
    httpStatus: 200,
    contentType: 'image/jpeg',
    existingExcelValue: '',
    candidates: [],
    warning: '',
    ...overrides,
  }
}

function preview(overrides: Partial<ImagePreview> = {}): ImagePreview {
  return {
    enabled: true,
    configured: true,
    error: null,
    batchPrefix: 'marketplace-originals/amazon-ae/batch-2026-08/',
    retentionNote: 'Amazon normally stores its own copy after successful processing, but retaining the approved AWS originals is recommended.',
    publicBaseUrl: 'https://images.lifesmile.ae',
    sourceBucket: 'lifesmile-amazon-images-2026',
    sourceTruncated: false,
    urlChecksSkipped: 0,
    imageColumns: { mainColumn: 'H', secondaryPositions: [1, 2, 4], outOfScope: [] },
    summary: {
      sourceFiles: 5,
      matchedFiles: 3,
      matchedSkus: 2,
      skusWithMainImage: 1,
      skusMissingMainImage: 1,
      secondaryImages: 2,
      unmatchedFiles: 1,
      ambiguousFiles: 0,
      duplicatePositions: 0,
      unsupportedPositions: 1,
      unsupportedFiles: 0,
      deliveryFailures: 0,
      brokenUrls: 0,
      workbookSkusWithoutImages: 0,
      colourAliasMatches: 0,
      duplicatesDeduplicated: 0,
      duplicatesSuperseded: 0,
      noonFilesNotUsed: 0,
      skusWithoutWebsiteImages: 0,
    },
    skus: [
      {
        sku: 'NSEL-20',
        productName: 'Life Smile Cooking Pot',
        main: record({ filename: 'NSEL-20_Main.jpg' }),
        secondary: [
          record({
            filename: 'NSEL-20_1.jpg',
            classification: 'secondary',
            detectedPosition: '1',
            positionSlot: 'PT01',
            positionNumber: 1,
            publicUrl: `${BASE}/NSEL-20/PT01.jpg`,
          }),
          record({
            filename: 'NSEL-20_4.jpg',
            classification: 'secondary',
            detectedPosition: '4',
            positionSlot: 'PT04',
            positionNumber: 4,
            publicUrl: `${BASE}/NSEL-20/PT04.jpg`,
          }),
        ],
        problems: [],
        hasMainImage: true,
        websiteImagesMissing: false,
      },
      {
        sku: 'LIFEP29-6',
        productName: 'Life Smile Pan',
        main: null,
        secondary: [
          record({
            sku: 'LIFEP29-6',
            filename: 'LIFEP29-6_1.jpg',
            classification: 'secondary',
            detectedPosition: '1',
            positionNumber: 1,
            publicUrl: `${BASE}/LIFEP29-6/PT01.jpg`,
          }),
        ],
        problems: [],
        hasMainImage: false,
        websiteImagesMissing: false,
      },
    ],
    unassigned: [
      record({
        sku: '',
        filename: 'ZZZ-99_Main.jpg',
        status: 'unmatched-filename',
        populationStatus: 'unmatched-filename',
        publicUrl: '',
        warning: 'No exact seller SKU in the uploaded workbook matches this filename.',
      }),
    ],
    ...overrides,
  }
}

// This project runs Vitest with `globals: false`, so Testing Library's automatic cleanup
// is never registered and each render has to be torn down here.
afterEach(cleanup)

describe('AmazonProductImagesSection', () => {
  it('renders nothing when no image batch was used', () => {
    const { container } = render(<AmazonProductImagesSection images={undefined} />)
    expect(container).toBeEmptyDOMElement()
    cleanup()

    const disabled = render(<AmazonProductImagesSection images={preview({ enabled: false })} />)
    expect(disabled.container).toBeEmptyDOMElement()
  })

  it('shows the counts, the retention note and the delivery domain', () => {
    render(<AmazonProductImagesSection images={preview()} />)

    expect(screen.getByText('Amazon Product Images')).toBeInTheDocument()
    expect(screen.getByText('Source files').nextSibling).toHaveTextContent('5')
    expect(screen.getByText('Missing main').nextSibling).toHaveTextContent('1')
    // "Unmatched files" is also a filter button, so this targets the stat label.
    expect(screen.getByText('Unmatched files', { selector: 'p' }).nextSibling).toHaveTextContent('1')
    expect(screen.getByText(/Amazon normally stores its own copy/)).toBeInTheDocument()
    expect(screen.getByText('https://images.lifesmile.ae')).toBeInTheDocument()
  })

  it('groups thumbnails by SKU with the main image first and secondary images in numeric order', () => {
    render(<AmazonProductImagesSection images={preview()} />)

    const groups = screen.getAllByTestId('image-sku-group')
    expect(groups).toHaveLength(2)

    const images = groups[0].querySelectorAll('img')
    expect([...images].map((image) => image.getAttribute('src'))).toEqual([
      `${BASE}/NSEL-20/MAIN.jpg`,
      `${BASE}/NSEL-20/PT01.jpg`,
      `${BASE}/NSEL-20/PT04.jpg`,
    ])
    expect([...images].map((image) => image.getAttribute('alt'))).toEqual([
      'NSEL-20 Main',
      'NSEL-20 Image 1',
      'NSEL-20 Image 4',
    ])
    for (const image of images) expect(image).toHaveAttribute('loading', 'lazy')
  })

  it('filters to the SKUs missing a main image', () => {
    render(<AmazonProductImagesSection images={preview()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Missing main image' }))

    const groups = screen.getAllByTestId('image-sku-group')
    expect(groups).toHaveLength(1)
    expect(groups[0]).toHaveTextContent('LIFEP29-6')
    expect(groups[0]).toHaveTextContent('missing main image')
  })

  it('filters to ready SKUs only', () => {
    render(<AmazonProductImagesSection images={preview()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Ready' }))

    const groups = screen.getAllByTestId('image-sku-group')
    expect(groups).toHaveLength(1)
    expect(groups[0]).toHaveTextContent('NSEL-20')
  })

  it('lists files that could not be mapped to a workbook SKU', () => {
    render(<AmazonProductImagesSection images={preview()} />)

    expect(screen.getByText('Files not mapped to a workbook SKU')).toBeInTheDocument()
    expect(screen.getByText('ZZZ-99_Main.jpg')).toBeInTheDocument()
    expect(screen.getByText(/No exact seller SKU/)).toBeInTheDocument()
  })

  it('searches by SKU and by product name', () => {
    render(<AmazonProductImagesSection images={preview()} />)
    const box = screen.getByLabelText('Filter images by SKU or product')

    fireEvent.change(box, { target: { value: 'LIFEP29' } })
    expect(screen.getAllByTestId('image-sku-group')).toHaveLength(1)

    fireEvent.change(box, { target: { value: 'Cooking Pot' } })
    const groups = screen.getAllByTestId('image-sku-group')
    expect(groups).toHaveLength(1)
    expect(groups[0]).toHaveTextContent('NSEL-20')
  })

  it('explains a configuration problem instead of showing counts', () => {
    render(
      <AmazonProductImagesSection
        images={preview({ error: 'public-base-url-not-configured', configured: false, skus: [], unassigned: [] })}
      />
    )

    expect(screen.getByText(/Image matching did not run: public-base-url-not-configured/)).toBeInTheDocument()
    expect(screen.getByText(/AMAZON_IMAGE_PUBLIC_BASE_URL/)).toBeInTheDocument()
    expect(screen.getByText(/every image cell was left exactly as uploaded/)).toBeInTheDocument()
    expect(screen.queryByText('Source files')).not.toBeInTheDocument()
  })

  it('marks a conflicting image cell so the preserved Excel value is visible', () => {
    render(
      <AmazonProductImagesSection
        images={preview({
          skus: [
            {
              sku: 'NSEL-20',
              productName: 'Life Smile Cooking Pot',
              main: record({
                filename: 'NSEL-20_Main.jpg',
                populationStatus: 'existing-value-preserved',
                existingExcelValue: 'https://legacy.example.com/main.jpg',
                warning: 'Existing workbook value kept.',
              }),
              secondary: [],
              problems: [],
              hasMainImage: true,
              websiteImagesMissing: false,
            },
          ],
          unassigned: [],
        })}
      />
    )

    expect(screen.getByText('existing-value-preserved')).toBeInTheDocument()
    expect(screen.getByText('Excel conflicts').nextSibling).toHaveTextContent('1')
  })
})
