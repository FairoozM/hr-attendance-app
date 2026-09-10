import { IsoPageHeader } from './components/IsoPageHeader'
import { IsoLinkedDocumentsPanel } from './components/IsoLinkedDocumentsPanel'
import './isoQms.css'

export function IsoWarehouseEvidencePage() {
  return (
    <div className="page"><div className="iso-page">
      <IsoPageHeader
        title="Warehouse Evidence"
        subtitle="Operational evidence aligned with LIF-QMS-PR-11 — receiving, storage, packing, delivery and nonconforming stock records."
      />
      <IsoLinkedDocumentsPanel title="Warehouse / operations evidence" filters={{ category: 'Warehouse' }} />
      <IsoLinkedDocumentsPanel title="Procedure PR-11 related documents" filters={{ search: 'PR-11' }} />
    </div></div>
  )
}
