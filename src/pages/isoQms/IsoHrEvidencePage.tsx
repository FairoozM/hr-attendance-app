import { IsoPageHeader } from './components/IsoPageHeader'
import { IsoLinkedDocumentsPanel } from './components/IsoLinkedDocumentsPanel'
import './isoQms.css'

export function IsoHrEvidencePage() {
  return (
    <div className="page"><div className="iso-page">
      <IsoPageHeader
        title="HR & Competency Evidence"
        subtitle="Training, competency, induction and organization-chart evidence linked from the controlled document library. Sensitive HR files are never auto-published to Auditor Room."
      />
      <IsoLinkedDocumentsPanel title="Training records" filters={{ documentType: 'Training Record' }} />
      <IsoLinkedDocumentsPanel title="HR / competency forms" filters={{ category: 'HR' }} emptyMessage="No HR-category documents yet." />
    </div></div>
  )
}
