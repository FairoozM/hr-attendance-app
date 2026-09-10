import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { IsoStatusBadge } from './IsoStatusBadge'

describe('IsoStatusBadge', () => {
  it('renders status text', () => {
    const { getByText } = render(<IsoStatusBadge status="Current" />)
    expect(getByText('Current')).toBeTruthy()
  })
})
