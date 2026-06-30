import { describe, expect, it } from 'vitest'
import { resolveSubscriptionIconKey } from './subscriptionIconMap'

describe('resolveSubscriptionIconKey', () => {
  it('maps known subscription names', () => {
    expect(resolveSubscriptionIconKey('ChatGPT')).toBe('chatgpt')
    expect(resolveSubscriptionIconKey('Cursor')).toBe('cursor')
    expect(resolveSubscriptionIconKey('Amazon AWS', 'Amazon')).toBe('aws')
    expect(resolveSubscriptionIconKey('Zoho Books')).toBe('zoho')
    expect(resolveSubscriptionIconKey('Adobe Creative Cloud')).toBe('adobe')
    expect(resolveSubscriptionIconKey('Envato Elements')).toBe('envato')
    expect(resolveSubscriptionIconKey('Respond.io')).toBe('respondio')
    expect(resolveSubscriptionIconKey('Vercel')).toBe('vercel')
    expect(resolveSubscriptionIconKey('Freepik')).toBe('freepik')
    expect(resolveSubscriptionIconKey('Alibaba Seller Account')).toBe('alibaba')
    expect(resolveSubscriptionIconKey('Indeed Jobs')).toBe('indeed')
    expect(resolveSubscriptionIconKey('360 Dialog')).toBe('360dialog')
  })

  it('falls back to default for unknown brands', () => {
    expect(resolveSubscriptionIconKey('Pecdora')).toBe('default')
    expect(resolveSubscriptionIconKey('Random SaaS Tool')).toBe('default')
  })
})
