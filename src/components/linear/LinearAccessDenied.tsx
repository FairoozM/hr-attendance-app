import { ShieldAlert } from 'lucide-react'
import { LinearSidebar } from './LinearSidebar'

type Props = {
  title?: string
  message?: string
}

export function LinearAccessDenied({
  title = 'Access Denied',
  message = 'You do not have permission to view this page.',
}: Props) {
  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#0b1020' }}>
      <LinearSidebar />
      <main
        style={{
          flex: 1,
          display: 'grid',
          placeItems: 'center',
          padding: '32px',
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: '560px',
            border: '1px solid rgba(148, 163, 184, 0.22)',
            borderRadius: '18px',
            background: 'rgba(15, 23, 42, 0.92)',
            padding: '28px',
            color: '#e5e7eb',
            boxShadow: '0 24px 60px rgba(2, 6, 23, 0.35)',
          }}
        >
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '10px',
              padding: '8px 12px',
              borderRadius: '999px',
              background: 'rgba(251, 191, 36, 0.12)',
              color: '#fbbf24',
              marginBottom: '16px',
            }}
          >
            <ShieldAlert size={16} />
            Restricted
          </div>
          <h1 style={{ margin: '0 0 10px', fontSize: '28px', lineHeight: 1.2 }}>{title}</h1>
          <p style={{ margin: 0, color: '#94a3b8', lineHeight: 1.6 }}>{message}</p>
        </div>
      </main>
    </div>
  )
}

export default LinearAccessDenied
