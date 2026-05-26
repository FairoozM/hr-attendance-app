import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Copy, Save } from 'lucide-react'
import { createLinearDigestOutboxApi } from '../../lib/linearWorkspaceApi'
import {
  buildDigestText,
  LINEAR_DIGEST_OUTBOX_CHANNELS,
  LINEAR_DIGEST_OUTBOX_TYPES,
  type LinearNotificationDigestType,
} from '../../lib/linearNotifications'

type Props = {
  digestContext: any
  initialType?: LinearNotificationDigestType
  enableOutboxSave?: boolean
  externalSaveRequest?: { key: string, digestType?: LinearNotificationDigestType } | null
  onOutboxSaved?: (draft: any) => void
}

const DIGEST_OPTIONS = LINEAR_DIGEST_OUTBOX_TYPES.filter((option) => option.value !== 'custom')

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const area = document.createElement('textarea')
      area.value = text
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      document.execCommand('copy')
      document.body.removeChild(area)
      return true
    } catch {
      return false
    }
  }
}

function actionTitle(type: LinearNotificationDigestType) {
  const label = DIGEST_OPTIONS.find((option) => option.value === type)?.label || 'Digest'
  const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  return `${label} - ${date}`
}

function ActionButton({
  label,
  icon: Icon,
  text,
  onClick,
}: {
  label: string
  icon?: typeof Copy
  text: string
  onClick?: () => Promise<void> | void
}) {
  const [copied, setCopied] = useState(false)

  const handleAction = async () => {
    const ok = await copyText(text)
    if (!ok) return
    if (onClick) await onClick()
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  return (
    <button type="button" className={`lnp-btn ${copied ? 'lnp-btn--success' : ''}`} onClick={handleAction}>
      {copied ? <CheckCircle2 size={14} /> : Icon ? <Icon size={14} /> : <Copy size={14} />}
      {copied ? 'Copied' : label}
    </button>
  )
}

export default function DigestBuilder({
  digestContext,
  initialType = 'daily',
  enableOutboxSave = false,
  externalSaveRequest = null,
  onOutboxSaved,
}: Props) {
  const [digestType, setDigestType] = useState<LinearNotificationDigestType>(initialType)
  const [saveOpen, setSaveOpen] = useState(false)
  const [draftTitle, setDraftTitle] = useState(actionTitle(initialType))
  const [targetChannel, setTargetChannel] = useState<'manual' | 'whatsapp' | 'email'>('manual')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saveSuccess, setSaveSuccess] = useState('')

  const markdownText = useMemo(
    () => buildDigestText(digestType, 'markdown', digestContext),
    [digestType, digestContext]
  )

  const whatsappText = useMemo(
    () => buildDigestText(digestType, 'whatsapp', digestContext),
    [digestType, digestContext]
  )

  const emailText = useMemo(
    () => buildDigestText(digestType, 'email', digestContext),
    [digestType, digestContext]
  )

  useEffect(() => {
    if (saveOpen) return
    setDraftTitle(actionTitle(digestType))
  }, [digestType, saveOpen])

  useEffect(() => {
    if (!externalSaveRequest?.key) return
    if (externalSaveRequest.digestType) setDigestType(externalSaveRequest.digestType)
    setDraftTitle(actionTitle(externalSaveRequest.digestType || digestType))
    setSaveError('')
    setSaveSuccess('')
    setSaveOpen(true)
  }, [externalSaveRequest?.key])

  const handleSaveToOutbox = async () => {
    setSaving(true)
    setSaveError('')
    setSaveSuccess('')
    try {
      const draft = await createLinearDigestOutboxApi({
        title: draftTitle,
        digest_type: digestType,
        target_channel: targetChannel,
        content: markdownText,
      })
      setSaveSuccess('Saved to outbox.')
      setSaveOpen(false)
      onOutboxSaved?.(draft)
    } catch (error: any) {
      setSaveError(error?.message || 'Failed to save digest draft.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="lnp-digest">
      <div className="lnp-section__header">
        <div>
          <h2>Digest Builder</h2>
          <p>Generate short copy-ready updates without sending anything automatically.</p>
        </div>

        <select
          className="lnp-select"
          value={digestType}
          onChange={(event) => setDigestType(event.target.value as DigestType)}
          aria-label="Select digest type"
        >
          {DIGEST_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>

      <div className="lnp-digest__actions">
        <ActionButton label="Copy Digest" text={markdownText} />
        <ActionButton label="Copy WhatsApp Update" text={whatsappText} />
        <ActionButton label="Copy Email Update" text={emailText} />
        {enableOutboxSave && (
          <button type="button" className="lnp-btn" onClick={() => {
            setDraftTitle(actionTitle(digestType))
            setSaveError('')
            setSaveSuccess('')
            setSaveOpen(true)
          }}>
            <Save size={14} />
            Save to Outbox
          </button>
        )}
      </div>

      {saveSuccess && <p className="lnp-digest__hint">{saveSuccess}</p>}

      <textarea
        className="lnp-digest__preview"
        value={markdownText}
        readOnly
        aria-label="Digest preview"
      />

      {saveOpen && (
        <div className="lnp-modal">
          <div className="lnp-modal__card">
            <div className="lnp-section__header">
              <div>
                <h2>Save Digest Draft</h2>
                <p>Store this digest in the outbox so it can be copied manually later.</p>
              </div>
            </div>

            <label className="lnp-modal__field">
              <span>Digest title</span>
              <input value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} />
            </label>

            <label className="lnp-modal__field">
              <span>Digest type</span>
              <select
                className="lnp-select"
                value={digestType}
                onChange={(event) => setDigestType(event.target.value as LinearNotificationDigestType)}
              >
                {DIGEST_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>

            <label className="lnp-modal__field">
              <span>Target channel</span>
              <select
                className="lnp-select"
                value={targetChannel}
                onChange={(event) => setTargetChannel(event.target.value as 'manual' | 'whatsapp' | 'email')}
              >
                {LINEAR_DIGEST_OUTBOX_CHANNELS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>

            <textarea className="lnp-digest__preview lnp-digest__preview--modal" value={markdownText} readOnly />

            {saveError && <p className="lnp-digest__hint lnp-digest__hint--error">{saveError}</p>}

            <div className="lnp-digest__actions">
              <button type="button" className="lnp-btn lnp-btn--primary" onClick={handleSaveToOutbox} disabled={saving}>
                <Save size={14} />
                {saving ? 'Saving…' : 'Save draft'}
              </button>
              <button type="button" className="lnp-btn" onClick={() => setSaveOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
