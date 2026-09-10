-- ISO & QMS schema (ISO 9001:2015 support)
-- Safe / non-destructive: CREATE IF NOT EXISTS, ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS
-- Clause titles are short INTERNAL labels only — no copyrighted ISO standard text.

-- ---------------------------------------------------------------------------
-- users.role: allow 'auditor'
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_role_check' AND conrelid = 'users'::regclass
  ) THEN
    ALTER TABLE users DROP CONSTRAINT users_role_check;
  END IF;
EXCEPTION
  WHEN undefined_table THEN NULL;
  WHEN undefined_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE users
    ADD CONSTRAINT users_role_check
    CHECK (role IN ('admin', 'employee', 'warehouse', 'auditor'));
EXCEPTION
  WHEN undefined_table THEN NULL;
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Categories
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS iso_categories (
  id SERIAL PRIMARY KEY,
  code VARCHAR(64) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Clauses (numbers + short internal titles only)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS iso_clauses (
  id SERIAL PRIMARY KEY,
  clause_number VARCHAR(32) UNIQUE NOT NULL,
  title VARCHAR(255) NOT NULL,
  parent_clause_number VARCHAR(32),
  sort_order INTEGER NOT NULL DEFAULT 0,
  responsible_department VARCHAR(255),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_iso_clauses_parent ON iso_clauses (parent_clause_number);
CREATE INDEX IF NOT EXISTS idx_iso_clauses_sort ON iso_clauses (sort_order);

-- ---------------------------------------------------------------------------
-- Controlled documents
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS iso_documents (
  id BIGSERIAL PRIMARY KEY,
  title VARCHAR(512) NOT NULL,
  document_code VARCHAR(128),
  document_type VARCHAR(64) NOT NULL DEFAULT 'Other Evidence',
  category_id INTEGER REFERENCES iso_categories(id) ON DELETE SET NULL,
  department VARCHAR(255),
  revision VARCHAR(64) DEFAULT '00',
  issue_date DATE,
  revision_date DATE,
  review_date DATE,
  expiry_date DATE,
  prepared_by VARCHAR(255),
  reviewed_by VARCHAR(255),
  approved_by VARCHAR(255),
  owner_name VARCHAR(255),
  status VARCHAR(64) NOT NULL DEFAULT 'Draft',
  description TEXT,
  retention_period VARCHAR(128),
  master_copy_location VARCHAR(512),
  distribution VARCHAR(128),
  confidentiality VARCHAR(64) NOT NULL DEFAULT 'Internal',
  publish_to_auditor_room BOOLEAN NOT NULL DEFAULT FALSE,
  auditor_download_allowed BOOLEAN NOT NULL DEFAULT FALSE,
  current_version_id BIGINT,
  obsolete_date DATE,
  obsolete_reason TEXT,
  is_external BOOLEAN NOT NULL DEFAULT FALSE,
  remarks TEXT,
  soft_deleted_at TIMESTAMPTZ,
  soft_deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_iso_documents_code ON iso_documents (document_code);
CREATE INDEX IF NOT EXISTS idx_iso_documents_status ON iso_documents (status);
CREATE INDEX IF NOT EXISTS idx_iso_documents_department ON iso_documents (department);
CREATE INDEX IF NOT EXISTS idx_iso_documents_type ON iso_documents (document_type);
CREATE INDEX IF NOT EXISTS idx_iso_documents_category ON iso_documents (category_id);
CREATE INDEX IF NOT EXISTS idx_iso_documents_review_date ON iso_documents (review_date);
CREATE INDEX IF NOT EXISTS idx_iso_documents_expiry_date ON iso_documents (expiry_date);
CREATE INDEX IF NOT EXISTS idx_iso_documents_auditor ON iso_documents (publish_to_auditor_room, status)
  WHERE soft_deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_iso_documents_soft_deleted ON iso_documents (soft_deleted_at);

-- ---------------------------------------------------------------------------
-- Document versions (files in S3 — never DB blobs)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS iso_document_versions (
  id BIGSERIAL PRIMARY KEY,
  document_id BIGINT NOT NULL REFERENCES iso_documents(id) ON DELETE CASCADE,
  revision_number VARCHAR(64) NOT NULL DEFAULT '00',
  status VARCHAR(64) NOT NULL DEFAULT 'Draft',
  original_filename VARCHAR(512),
  file_type VARCHAR(128),
  file_size BIGINT,
  storage_key TEXT NOT NULL,
  checksum_sha256 VARCHAR(64),
  extracted_text TEXT,
  extraction_status VARCHAR(64) NOT NULL DEFAULT 'Pending',
  extraction_error TEXT,
  search_vector tsvector,
  revision_comments TEXT,
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  superseded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT iso_document_versions_storage_key_unique UNIQUE (storage_key)
);

CREATE INDEX IF NOT EXISTS idx_iso_document_versions_document ON iso_document_versions (document_id);
CREATE INDEX IF NOT EXISTS idx_iso_document_versions_status ON iso_document_versions (status);
CREATE INDEX IF NOT EXISTS idx_iso_document_versions_checksum ON iso_document_versions (checksum_sha256);
CREATE INDEX IF NOT EXISTS idx_iso_document_versions_search ON iso_document_versions USING GIN (search_vector);

-- Only one current/approved version per document
CREATE UNIQUE INDEX IF NOT EXISTS idx_iso_document_versions_one_current
  ON iso_document_versions (document_id)
  WHERE status IN ('Approved', 'Current');

DO $$
BEGIN
  ALTER TABLE iso_documents
    ADD CONSTRAINT iso_documents_current_version_fk
    FOREIGN KEY (current_version_id) REFERENCES iso_document_versions(id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Document links
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS iso_document_clauses (
  document_id BIGINT NOT NULL REFERENCES iso_documents(id) ON DELETE CASCADE,
  clause_id INTEGER NOT NULL REFERENCES iso_clauses(id) ON DELETE CASCADE,
  PRIMARY KEY (document_id, clause_id)
);

CREATE TABLE IF NOT EXISTS iso_document_tags (
  id BIGSERIAL PRIMARY KEY,
  document_id BIGINT NOT NULL REFERENCES iso_documents(id) ON DELETE CASCADE,
  tag VARCHAR(128) NOT NULL,
  UNIQUE (document_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_iso_document_tags_tag ON iso_document_tags (tag);

CREATE TABLE IF NOT EXISTS iso_document_relations (
  id BIGSERIAL PRIMARY KEY,
  document_id BIGINT NOT NULL REFERENCES iso_documents(id) ON DELETE CASCADE,
  related_document_id BIGINT NOT NULL REFERENCES iso_documents(id) ON DELETE CASCADE,
  relation_type VARCHAR(64) NOT NULL DEFAULT 'related',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (document_id, related_document_id, relation_type)
);

CREATE TABLE IF NOT EXISTS iso_document_approvals (
  id BIGSERIAL PRIMARY KEY,
  document_id BIGINT NOT NULL REFERENCES iso_documents(id) ON DELETE CASCADE,
  version_id BIGINT REFERENCES iso_document_versions(id) ON DELETE SET NULL,
  action VARCHAR(64) NOT NULL,
  from_status VARCHAR(64),
  to_status VARCHAR(64),
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  comments TEXT,
  controlled_fields_changed JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_iso_document_approvals_document ON iso_document_approvals (document_id);

-- ---------------------------------------------------------------------------
-- Record types (FO-* catalogue — metadata only, no fake records)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS iso_record_types (
  id SERIAL PRIMARY KEY,
  format_code VARCHAR(64) UNIQUE NOT NULL,
  format_description VARCHAR(512) NOT NULL,
  department VARCHAR(255),
  medium VARCHAR(64) DEFAULT 'Both',
  issue_date DATE,
  revision VARCHAR(64) DEFAULT '00',
  revision_date DATE,
  retention_period VARCHAR(128),
  custodian VARCHAR(255),
  location VARCHAR(512),
  record_status VARCHAR(64) NOT NULL DEFAULT 'Active',
  remarks TEXT,
  category_code VARCHAR(64),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Audits
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS iso_audits (
  id BIGSERIAL PRIMARY KEY,
  audit_reference VARCHAR(128) UNIQUE,
  audit_type VARCHAR(64) NOT NULL DEFAULT 'Internal',
  audit_year INTEGER,
  status VARCHAR(64) NOT NULL DEFAULT 'Draft',
  standard VARCHAR(128) DEFAULT 'ISO 9001:2015',
  scope TEXT,
  location VARCHAR(255),
  planned_date DATE,
  actual_date DATE,
  lead_auditor VARCHAR(255),
  additional_auditors TEXT,
  auditees TEXT,
  departments TEXT,
  applicable_clauses TEXT,
  opening_meeting_at TIMESTAMPTZ,
  closing_meeting_at TIMESTAMPTZ,
  opening_meeting_notes TEXT,
  closing_meeting_notes TEXT,
  audit_objective TEXT,
  audit_criteria TEXT,
  notes TEXT,
  access_start_date DATE,
  access_end_date DATE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_iso_audits_status ON iso_audits (status);
CREATE INDEX IF NOT EXISTS idx_iso_audits_year ON iso_audits (audit_year);
CREATE INDEX IF NOT EXISTS idx_iso_audits_reference ON iso_audits (audit_reference);

CREATE TABLE IF NOT EXISTS iso_audit_sections (
  id BIGSERIAL PRIMARY KEY,
  audit_id BIGINT NOT NULL REFERENCES iso_audits(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  clause_number VARCHAR(32),
  process_name VARCHAR(255),
  department VARCHAR(255),
  sort_order INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_iso_audit_sections_audit ON iso_audit_sections (audit_id);

CREATE TABLE IF NOT EXISTS iso_audit_checklist_items (
  id BIGSERIAL PRIMARY KEY,
  audit_id BIGINT NOT NULL REFERENCES iso_audits(id) ON DELETE CASCADE,
  section_id BIGINT REFERENCES iso_audit_sections(id) ON DELETE SET NULL,
  question TEXT NOT NULL,
  clause_number VARCHAR(32),
  process_name VARCHAR(255),
  department VARCHAR(255),
  auditor_note TEXT,
  outcome VARCHAR(64),
  responsible_person VARCHAR(255),
  auditor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_iso_audit_checklist_audit ON iso_audit_checklist_items (audit_id);

CREATE TABLE IF NOT EXISTS iso_audit_evidence (
  id BIGSERIAL PRIMARY KEY,
  audit_id BIGINT NOT NULL REFERENCES iso_audits(id) ON DELETE CASCADE,
  checklist_item_id BIGINT REFERENCES iso_audit_checklist_items(id) ON DELETE CASCADE,
  document_id BIGINT REFERENCES iso_documents(id) ON DELETE SET NULL,
  version_id BIGINT REFERENCES iso_document_versions(id) ON DELETE SET NULL,
  notes TEXT,
  linked_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_iso_audit_evidence_audit ON iso_audit_evidence (audit_id);
CREATE INDEX IF NOT EXISTS idx_iso_audit_evidence_item ON iso_audit_evidence (checklist_item_id);

-- ---------------------------------------------------------------------------
-- Findings & corrective actions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS iso_findings (
  id BIGSERIAL PRIMARY KEY,
  nc_number VARCHAR(128) UNIQUE,
  finding_date DATE,
  source VARCHAR(64),
  audit_id BIGINT REFERENCES iso_audits(id) ON DELETE SET NULL,
  checklist_item_id BIGINT REFERENCES iso_audit_checklist_items(id) ON DELETE SET NULL,
  department VARCHAR(255),
  customer_supplier VARCHAR(255),
  order_reference VARCHAR(255),
  product_sku VARCHAR(255),
  quantity NUMERIC,
  stage_of_operation VARCHAR(255),
  clause_number VARCHAR(32),
  description TEXT NOT NULL,
  evidence TEXT,
  classification VARCHAR(64),
  immediate_correction TEXT,
  responsible_owner VARCHAR(255),
  status VARCHAR(64) NOT NULL DEFAULT 'Open',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_iso_findings_status ON iso_findings (status);
CREATE INDEX IF NOT EXISTS idx_iso_findings_audit ON iso_findings (audit_id);
CREATE INDEX IF NOT EXISTS idx_iso_findings_nc ON iso_findings (nc_number);

CREATE TABLE IF NOT EXISTS iso_corrective_actions (
  id BIGSERIAL PRIMARY KEY,
  ca_number VARCHAR(128) UNIQUE,
  finding_id BIGINT REFERENCES iso_findings(id) ON DELETE SET NULL,
  description TEXT,
  immediate_correction TEXT,
  root_cause TEXT,
  corrective_action_details TEXT,
  evidence_notes TEXT,
  effectiveness_review TEXT,
  responsible_person VARCHAR(255),
  due_date DATE,
  status VARCHAR(64) NOT NULL DEFAULT 'Open',
  verifier_name VARCHAR(255),
  verified_at DATE,
  closed_at DATE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_iso_ca_status ON iso_corrective_actions (status);
CREATE INDEX IF NOT EXISTS idx_iso_ca_due ON iso_corrective_actions (due_date);
CREATE INDEX IF NOT EXISTS idx_iso_ca_finding ON iso_corrective_actions (finding_id);
CREATE INDEX IF NOT EXISTS idx_iso_ca_number ON iso_corrective_actions (ca_number);

CREATE TABLE IF NOT EXISTS iso_corrective_action_updates (
  id BIGSERIAL PRIMARY KEY,
  corrective_action_id BIGINT NOT NULL REFERENCES iso_corrective_actions(id) ON DELETE CASCADE,
  update_text TEXT NOT NULL,
  previous_status VARCHAR(64),
  new_status VARCHAR(64),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_iso_ca_updates_ca ON iso_corrective_action_updates (corrective_action_id);

-- ---------------------------------------------------------------------------
-- Management reviews
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS iso_management_reviews (
  id BIGSERIAL PRIMARY KEY,
  reference VARCHAR(128) UNIQUE,
  meeting_date DATE,
  location VARCHAR(255),
  chairperson VARCHAR(255),
  attendees TEXT,
  status VARCHAR(64) NOT NULL DEFAULT 'Draft',
  summary TEXT,
  next_review_date DATE,
  document_id BIGINT REFERENCES iso_documents(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS iso_management_review_items (
  id BIGSERIAL PRIMARY KEY,
  management_review_id BIGINT NOT NULL REFERENCES iso_management_reviews(id) ON DELETE CASCADE,
  agenda_item VARCHAR(512) NOT NULL,
  discussion TEXT,
  decision TEXT,
  action_owner VARCHAR(255),
  due_date DATE,
  status VARCHAR(64) DEFAULT 'Open',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Risks & objectives
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS iso_risk_assessments (
  id BIGSERIAL PRIMARY KEY,
  reference VARCHAR(128) UNIQUE,
  title VARCHAR(512) NOT NULL,
  assessment_date DATE,
  status VARCHAR(64) NOT NULL DEFAULT 'Active',
  notes TEXT,
  document_id BIGINT REFERENCES iso_documents(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS iso_risks (
  id BIGSERIAL PRIMARY KEY,
  risk_assessment_id BIGINT REFERENCES iso_risk_assessments(id) ON DELETE SET NULL,
  risk_number VARCHAR(128),
  description TEXT NOT NULL,
  category VARCHAR(128),
  likelihood INTEGER,
  impact INTEGER,
  score INTEGER,
  treatment TEXT,
  owner_name VARCHAR(255),
  due_date DATE,
  status VARCHAR(64) NOT NULL DEFAULT 'Open',
  clause_number VARCHAR(32),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_iso_risks_status ON iso_risks (status);
CREATE INDEX IF NOT EXISTS idx_iso_risks_due ON iso_risks (due_date);

CREATE TABLE IF NOT EXISTS iso_quality_objectives (
  id BIGSERIAL PRIMARY KEY,
  objective_code VARCHAR(128),
  title VARCHAR(512) NOT NULL,
  description TEXT,
  department VARCHAR(255),
  target_value VARCHAR(255),
  unit VARCHAR(64),
  period VARCHAR(64),
  owner_name VARCHAR(255),
  status VARCHAR(64) NOT NULL DEFAULT 'Active',
  due_date DATE,
  document_id BIGINT REFERENCES iso_documents(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS iso_objective_updates (
  id BIGSERIAL PRIMARY KEY,
  objective_id BIGINT NOT NULL REFERENCES iso_quality_objectives(id) ON DELETE CASCADE,
  update_date DATE,
  actual_value VARCHAR(255),
  notes TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Suppliers
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS iso_suppliers (
  id BIGSERIAL PRIMARY KEY,
  supplier_code VARCHAR(128),
  name VARCHAR(512) NOT NULL,
  category VARCHAR(128),
  contact_name VARCHAR(255),
  contact_email VARCHAR(255),
  contact_phone VARCHAR(64),
  status VARCHAR(64) NOT NULL DEFAULT 'Approved',
  approved_date DATE,
  next_evaluation_date DATE,
  notes TEXT,
  document_id BIGINT REFERENCES iso_documents(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_iso_suppliers_name ON iso_suppliers (name);
CREATE INDEX IF NOT EXISTS idx_iso_suppliers_status ON iso_suppliers (status);

CREATE TABLE IF NOT EXISTS iso_supplier_qualifications (
  id BIGSERIAL PRIMARY KEY,
  supplier_id BIGINT NOT NULL REFERENCES iso_suppliers(id) ON DELETE CASCADE,
  qualification_date DATE,
  result VARCHAR(64),
  notes TEXT,
  document_id BIGINT REFERENCES iso_documents(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS iso_supplier_evaluations (
  id BIGSERIAL PRIMARY KEY,
  supplier_id BIGINT NOT NULL REFERENCES iso_suppliers(id) ON DELETE CASCADE,
  evaluation_date DATE,
  score NUMERIC,
  result VARCHAR(64),
  notes TEXT,
  document_id BIGINT REFERENCES iso_documents(id) ON DELETE SET NULL,
  next_evaluation_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- External certificates
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS iso_external_certificates (
  id BIGSERIAL PRIMARY KEY,
  title VARCHAR(512) NOT NULL,
  certificate_number VARCHAR(128),
  issuer VARCHAR(255),
  issue_date DATE,
  expiry_date DATE,
  status VARCHAR(64) NOT NULL DEFAULT 'Active',
  document_id BIGINT REFERENCES iso_documents(id) ON DELETE SET NULL,
  notes TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_iso_ext_certs_expiry ON iso_external_certificates (expiry_date);

-- ---------------------------------------------------------------------------
-- Equipment / maintenance / calibration
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS iso_equipment (
  id BIGSERIAL PRIMARY KEY,
  equipment_number VARCHAR(128) UNIQUE,
  name VARCHAR(512) NOT NULL,
  category VARCHAR(128),
  location VARCHAR(255),
  manufacturer VARCHAR(255),
  model VARCHAR(255),
  serial_number VARCHAR(128),
  status VARCHAR(64) NOT NULL DEFAULT 'Active',
  purchase_date DATE,
  notes TEXT,
  document_id BIGINT REFERENCES iso_documents(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_iso_equipment_number ON iso_equipment (equipment_number);

CREATE TABLE IF NOT EXISTS iso_equipment_inspections (
  id BIGSERIAL PRIMARY KEY,
  equipment_id BIGINT NOT NULL REFERENCES iso_equipment(id) ON DELETE CASCADE,
  inspection_date DATE,
  result VARCHAR(64),
  notes TEXT,
  inspector_name VARCHAR(255),
  document_id BIGINT REFERENCES iso_documents(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS iso_maintenance_logs (
  id BIGSERIAL PRIMARY KEY,
  equipment_id BIGINT NOT NULL REFERENCES iso_equipment(id) ON DELETE CASCADE,
  maintenance_date DATE,
  maintenance_type VARCHAR(128),
  description TEXT,
  performed_by VARCHAR(255),
  next_due_date DATE,
  document_id BIGINT REFERENCES iso_documents(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_iso_maintenance_due ON iso_maintenance_logs (next_due_date);

CREATE TABLE IF NOT EXISTS iso_calibrations (
  id BIGSERIAL PRIMARY KEY,
  equipment_id BIGINT REFERENCES iso_equipment(id) ON DELETE SET NULL,
  calibration_date DATE,
  next_due_date DATE,
  result VARCHAR(64),
  certificate_number VARCHAR(128),
  performed_by VARCHAR(255),
  status VARCHAR(64) NOT NULL DEFAULT 'Scheduled',
  document_id BIGINT REFERENCES iso_documents(id) ON DELETE SET NULL,
  notes TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_iso_calibrations_due ON iso_calibrations (next_due_date);

-- ---------------------------------------------------------------------------
-- Activity log (append-only)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS iso_activity_log (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(128) NOT NULL,
  entity_type VARCHAR(128) NOT NULL,
  entity_id BIGINT,
  version_id BIGINT,
  previous_value JSONB,
  new_value JSONB,
  ip VARCHAR(64),
  user_agent TEXT,
  message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_iso_activity_entity ON iso_activity_log (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_iso_activity_created ON iso_activity_log (created_at DESC);

-- ---------------------------------------------------------------------------
-- Auditor assignments & settings
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS iso_auditor_assignments (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  audit_id BIGINT REFERENCES iso_audits(id) ON DELETE SET NULL,
  access_start_date DATE,
  access_expiry_date DATE,
  revoked_at TIMESTAMPTZ,
  revoked_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  can_create_findings BOOLEAN NOT NULL DEFAULT FALSE,
  can_add_comments BOOLEAN NOT NULL DEFAULT TRUE,
  last_activity_at TIMESTAMPTZ,
  notes TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_iso_auditor_assignments_user ON iso_auditor_assignments (user_id);

CREATE TABLE IF NOT EXISTS iso_settings (
  id SERIAL PRIMARY KEY,
  setting_key VARCHAR(128) UNIQUE NOT NULL,
  setting_value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS iso_notification_dedupe (
  id BIGSERIAL PRIMARY KEY,
  dedupe_key VARCHAR(512) UNIQUE NOT NULL,
  notification_type VARCHAR(128) NOT NULL,
  entity_type VARCHAR(128),
  entity_id BIGINT,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_iso_notification_dedupe_type ON iso_notification_dedupe (notification_type);

-- ---------------------------------------------------------------------------
-- Seeds: categories (idempotent)
-- ---------------------------------------------------------------------------
INSERT INTO iso_categories (code, name, description, sort_order) VALUES
  ('quality_manual', 'Quality Manual', 'QMS manual and annexures', 10),
  ('policies', 'Policies', 'Quality and supporting policies', 20),
  ('procedures', 'Procedures', 'Controlled QMS procedures', 30),
  ('work_instructions', 'Work Instructions', 'Operational work instructions', 40),
  ('forms', 'Forms', 'Form templates and completed forms', 50),
  ('records', 'Records', 'Controlled records and registers', 60),
  ('audit', 'Audit', 'Internal and external audit evidence', 70),
  ('management_review', 'Management Review', 'MRM minutes and inputs/outputs', 80),
  ('risk', 'Risk & Opportunity', 'Risk register and related evidence', 90),
  ('supplier', 'Supplier Controls', 'Supplier qualification and evaluation', 100),
  ('hr_competence', 'HR / Competence', 'Training and competence evidence', 110),
  ('warehouse_ops', 'Warehouse / Operations', 'Operational and warehouse controls', 120),
  ('maintenance_calibration', 'Maintenance / Calibration', 'Equipment, PM and calibration', 130),
  ('external_certificates', 'External Certificates', 'Licenses and third-party certificates', 140),
  ('other', 'Other Evidence', 'Other QMS evidence', 150)
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Seeds: clauses (numbers + short internal titles ONLY)
-- ---------------------------------------------------------------------------
INSERT INTO iso_clauses (clause_number, title, parent_clause_number, sort_order) VALUES
  ('4', 'Context of the Organization', NULL, 400),
  ('4.1', 'Organization and its context', '4', 410),
  ('4.2', 'Needs of interested parties', '4', 420),
  ('4.3', 'Scope of the QMS', '4', 430),
  ('4.4', 'QMS and its processes', '4', 440),
  ('5', 'Leadership', NULL, 500),
  ('5.1', 'Leadership and commitment', '5', 510),
  ('5.2', 'Policy', '5', 520),
  ('5.3', 'Roles, responsibilities and authorities', '5', 530),
  ('6', 'Planning', NULL, 600),
  ('6.1', 'Risks and opportunities', '6', 610),
  ('6.2', 'Quality objectives and planning', '6', 620),
  ('6.3', 'Planning of changes', '6', 630),
  ('7', 'Support', NULL, 700),
  ('7.1', 'Resources', '7', 710),
  ('7.1.2', 'People', '7.1', 712),
  ('7.1.3', 'Infrastructure', '7.1', 713),
  ('7.1.4', 'Environment for operation', '7.1', 714),
  ('7.1.5', 'Monitoring and measuring resources', '7.1', 715),
  ('7.1.6', 'Organizational knowledge', '7.1', 716),
  ('7.2', 'Competence', '7', 720),
  ('7.3', 'Awareness', '7', 730),
  ('7.4', 'Communication', '7', 740),
  ('7.5', 'Documented information', '7', 750),
  ('7.5.2', 'Creating and updating', '7.5', 752),
  ('7.5.3', 'Control of documented information', '7.5', 753),
  ('8', 'Operation', NULL, 800),
  ('8.1', 'Operational planning and control', '8', 810),
  ('8.2', 'Requirements for products and services', '8', 820),
  ('8.3', 'Design and development', '8', 830),
  ('8.4', 'External providers', '8', 840),
  ('8.5', 'Production and service provision', '8', 850),
  ('8.6', 'Release of products and services', '8', 860),
  ('8.7', 'Control of nonconforming outputs', '8', 870),
  ('9', 'Performance Evaluation', NULL, 900),
  ('9.1', 'Monitoring, measurement, analysis', '9', 910),
  ('9.2', 'Internal audit', '9', 920),
  ('9.3', 'Management review', '9', 930),
  ('10', 'Improvement', NULL, 1000),
  ('10.1', 'General improvement', '10', 1010),
  ('10.2', 'Nonconformity and corrective action', '10', 1020),
  ('10.3', 'Continual improvement', '10', 1030)
ON CONFLICT (clause_number) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Seeds: record types (FO-01A … FO-13D catalogue)
-- ---------------------------------------------------------------------------
INSERT INTO iso_record_types (format_code, format_description, department, medium, sort_order) VALUES
  ('FO-01A', 'Master List of Internal/External Documents', 'Quality', 'Both', 10),
  ('FO-01B', 'Amendment Change Record', 'Quality', 'Both', 20),
  ('FO-01C', 'Document Creation/Change Request', 'Quality', 'Both', 30),
  ('FO-02A', 'Master List of Records', 'Quality', 'Both', 40),
  ('FO-03A', 'Internal Audit Plan', 'Quality', 'Both', 50),
  ('FO-03B', 'Internal Audit Schedule', 'Quality', 'Both', 60),
  ('FO-03C', 'Audit Report', 'Quality', 'Both', 70),
  ('FO-03D', 'Audit Report (alternate)', 'Quality', 'Both', 80),
  ('FO-03E', 'Internal Audit Summary', 'Quality', 'Both', 90),
  ('FO-03F', 'Corrective Action Audit Tracking', 'Quality', 'Both', 100),
  ('FO-04A', 'Management Review Minutes', 'Quality', 'Both', 110),
  ('FO-05A', 'Nonconforming Product/Service Register', 'Quality', 'Both', 120),
  ('FO-05B', 'Corrective Action Report', 'Quality', 'Both', 130),
  ('FO-05C', 'Corrective Action Tracker', 'Quality', 'Both', 140),
  ('FO-06A', 'Customer Complaint Register', 'Quality', 'Both', 150),
  ('FO-06B', 'Customer Satisfaction Survey', 'Quality', 'Both', 160),
  ('FO-07A', 'Approved Supplier List', 'Procurement', 'Both', 170),
  ('FO-07B', 'Supplier Prequalification', 'Procurement', 'Both', 180),
  ('FO-07C', 'Supplier Reevaluation', 'Procurement', 'Both', 190),
  ('FO-08A', 'MOC Change Request', 'Quality', 'Both', 200),
  ('FO-09A', 'Calibration History and Schedule', 'Maintenance', 'Both', 210),
  ('FO-10A', 'Recruitment Requisition', 'HR', 'Both', 220),
  ('FO-10B', 'Job Responsibilities', 'HR', 'Both', 230),
  ('FO-10C', 'Competency Matrix', 'HR', 'Both', 240),
  ('FO-10D', 'Induction Record', 'HR', 'Both', 250),
  ('FO-10E', 'Organization Chart', 'HR', 'Both', 260),
  ('FO-10F', 'Annual Training Plan', 'HR', 'Both', 270),
  ('FO-10G', 'Training Record', 'HR', 'Both', 280),
  ('FO-10H', 'Training Effectiveness', 'HR', 'Both', 290),
  ('FO-10I', 'Passport Submission', 'HR', 'Both', 300),
  ('FO-10J', 'Passport Request and Release', 'HR', 'Both', 310),
  ('FO-10K', 'Leave Application', 'HR', 'Both', 320),
  ('FO-12A', 'Risk and Opportunity Register', 'Quality', 'Both', 330),
  ('FO-13A', 'Machinery and Tools List', 'Maintenance', 'Both', 340),
  ('FO-13B', 'Annual Preventive Maintenance Plan', 'Maintenance', 'Both', 350),
  ('FO-13C', 'Equipment History Card', 'Maintenance', 'Both', 360),
  ('FO-13D', 'Maintenance Log', 'Maintenance', 'Both', 370)
ON CONFLICT (format_code) DO NOTHING;
