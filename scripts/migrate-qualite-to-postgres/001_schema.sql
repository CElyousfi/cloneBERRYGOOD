-- ============================================================
-- Smart BERRY — Qualité Schema
-- Idempotent: safe to run multiple times.
-- Apply via: Supabase SQL Editor → paste full file → Run ▶
-- ============================================================

-- 1. Create schema
CREATE SCHEMA IF NOT EXISTS qualite;

-- 2. Helper functions (fully qualified — no SET search_path)
CREATE OR REPLACE FUNCTION qualite.update_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION qualite.current_user_profile()
RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT current_setting('app.user_profile', true);
$$;

CREATE OR REPLACE FUNCTION qualite.current_user_role()
RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT current_setting('app.user_role', true);
$$;

-- 3. Tables

CREATE TABLE IF NOT EXISTS qualite.inspections (
    id               SERIAL PRIMARY KEY,
    firestore_id     TEXT UNIQUE,
    ferme            TEXT,
    variete          TEXT,
    date_inspection  TIMESTAMPTZ,
    inspecteur       TEXT,
    defaut_type      TEXT,
    defaut_pct       NUMERIC,
    classification   TEXT,
    lot_id           TEXT,
    created_at       TIMESTAMPTZ DEFAULT now(),
    updated_at       TIMESTAMPTZ DEFAULT now(),
    created_by       TEXT
);
COMMENT ON TABLE qualite.inspections IS 'Inspections qualite — migrated from Firestore';

CREATE TABLE IF NOT EXISTS qualite.expeditions (
    id               SERIAL PRIMARY KEY,
    firestore_id     TEXT UNIQUE,
    ferme            TEXT,
    variete          TEXT,
    date_expedition  TIMESTAMPTZ,
    type_expedition  TEXT,
    poids_brut       NUMERIC,
    poids_tare       NUMERIC,
    poids_net        NUMERIC,
    nb_colis         INTEGER,
    statut           TEXT,
    client           TEXT,
    destination      TEXT,
    created_at       TIMESTAMPTZ DEFAULT now(),
    updated_at       TIMESTAMPTZ DEFAULT now(),
    created_by       TEXT
);
COMMENT ON TABLE qualite.expeditions IS 'Expeditions — migrated from Firestore';

CREATE TABLE IF NOT EXISTS qualite.ecarts (
    id               SERIAL PRIMARY KEY,
    firestore_id     TEXT UNIQUE,
    quinzaine        TEXT,
    ferme            TEXT,
    variete          TEXT,
    kg_attendu       NUMERIC,
    kg_reel          NUMERIC,
    ecart_volume     NUMERIC,
    ecart_pct        NUMERIC,
    classification   TEXT,
    created_at       TIMESTAMPTZ DEFAULT now(),
    updated_at       TIMESTAMPTZ DEFAULT now(),
    created_by       TEXT
);
COMMENT ON TABLE qualite.ecarts IS 'Ecarts qualite — migrated from Firestore';

CREATE TABLE IF NOT EXISTS qualite.brix_readings (
    id               SERIAL PRIMARY KEY,
    firestore_id     TEXT UNIQUE,
    ferme            TEXT,
    variete          TEXT,
    date_lecture     TIMESTAMPTZ,
    brix_value       NUMERIC,
    lot_id           TEXT,
    conforme         BOOLEAN,
    created_at       TIMESTAMPTZ DEFAULT now(),
    updated_at       TIMESTAMPTZ DEFAULT now(),
    created_by       TEXT
);
COMMENT ON TABLE qualite.brix_readings IS 'Lectures Brix — migrated from Firestore';

CREATE TABLE IF NOT EXISTS qualite.bons_apport (
    id               SERIAL PRIMARY KEY,
    firestore_id     TEXT UNIQUE,
    date_bon         TIMESTAMPTZ,
    ferme            TEXT,
    fournisseur      TEXT,
    variete          TEXT,
    kg_apporte       NUMERIC,
    prix_unitaire    NUMERIC,
    montant          NUMERIC,
    statut           TEXT,
    validated_by     TEXT,
    created_at       TIMESTAMPTZ DEFAULT now(),
    updated_at       TIMESTAMPTZ DEFAULT now(),
    created_by       TEXT
);
COMMENT ON TABLE qualite.bons_apport IS 'Bons apport — migrated from Firestore';

CREATE TABLE IF NOT EXISTS qualite.pfq_records (
    id               SERIAL PRIMARY KEY,
    firestore_id     TEXT UNIQUE,
    ferme            TEXT,
    semaine          TEXT,
    categorie        TEXT,
    valeur           NUMERIC,
    seuil            NUMERIC,
    conforme         BOOLEAN,
    created_at       TIMESTAMPTZ DEFAULT now(),
    updated_at       TIMESTAMPTZ DEFAULT now(),
    created_by       TEXT
);
COMMENT ON TABLE qualite.pfq_records IS 'Indicateurs PFQ — migrated from Firestore';

CREATE TABLE IF NOT EXISTS qualite.liquidations (
    id               SERIAL PRIMARY KEY,
    firestore_id     TEXT UNIQUE,
    quinzaine        TEXT,
    ferme            TEXT,
    variete          TEXT,
    kg_total         NUMERIC,
    prix_kg          NUMERIC,
    montant_total    NUMERIC,
    type_liquidation TEXT,
    statut           TEXT,
    created_at       TIMESTAMPTZ DEFAULT now(),
    updated_at       TIMESTAMPTZ DEFAULT now(),
    created_by       TEXT
);
COMMENT ON TABLE qualite.liquidations IS 'Liquidations qualite — migrated from Firestore';

-- 4. Indexes
CREATE INDEX IF NOT EXISTS idx_qualite_inspections_ferme  ON qualite.inspections(ferme);
CREATE INDEX IF NOT EXISTS idx_qualite_inspections_date   ON qualite.inspections(date_inspection);
CREATE INDEX IF NOT EXISTS idx_qualite_expeditions_ferme  ON qualite.expeditions(ferme);
CREATE INDEX IF NOT EXISTS idx_qualite_expeditions_date   ON qualite.expeditions(date_expedition);
CREATE INDEX IF NOT EXISTS idx_qualite_ecarts_ferme       ON qualite.ecarts(ferme);
CREATE INDEX IF NOT EXISTS idx_qualite_ecarts_quinzaine   ON qualite.ecarts(quinzaine);
CREATE INDEX IF NOT EXISTS idx_qualite_brix_ferme         ON qualite.brix_readings(ferme);
CREATE INDEX IF NOT EXISTS idx_qualite_brix_date          ON qualite.brix_readings(date_lecture);
CREATE INDEX IF NOT EXISTS idx_qualite_bons_ferme         ON qualite.bons_apport(ferme);
CREATE INDEX IF NOT EXISTS idx_qualite_bons_date          ON qualite.bons_apport(date_bon);
CREATE INDEX IF NOT EXISTS idx_qualite_pfq_ferme          ON qualite.pfq_records(ferme);
CREATE INDEX IF NOT EXISTS idx_qualite_pfq_semaine        ON qualite.pfq_records(semaine);
CREATE INDEX IF NOT EXISTS idx_qualite_liquidations_ferme ON qualite.liquidations(ferme);
CREATE INDEX IF NOT EXISTS idx_qualite_liquidations_qz    ON qualite.liquidations(quinzaine);

-- 5. Triggers (DROP IF EXISTS individually — no DO $$ wrapper)
DROP TRIGGER IF EXISTS trg_qualite_inspections_upd  ON qualite.inspections;
DROP TRIGGER IF EXISTS trg_qualite_expeditions_upd  ON qualite.expeditions;
DROP TRIGGER IF EXISTS trg_qualite_ecarts_upd       ON qualite.ecarts;
DROP TRIGGER IF EXISTS trg_qualite_brix_upd         ON qualite.brix_readings;
DROP TRIGGER IF EXISTS trg_qualite_bons_apport_upd  ON qualite.bons_apport;
DROP TRIGGER IF EXISTS trg_qualite_pfq_upd          ON qualite.pfq_records;
DROP TRIGGER IF EXISTS trg_qualite_liquidations_upd ON qualite.liquidations;

CREATE TRIGGER trg_qualite_inspections_upd
  BEFORE UPDATE ON qualite.inspections
  FOR EACH ROW EXECUTE FUNCTION qualite.update_updated_at();

CREATE TRIGGER trg_qualite_expeditions_upd
  BEFORE UPDATE ON qualite.expeditions
  FOR EACH ROW EXECUTE FUNCTION qualite.update_updated_at();

CREATE TRIGGER trg_qualite_ecarts_upd
  BEFORE UPDATE ON qualite.ecarts
  FOR EACH ROW EXECUTE FUNCTION qualite.update_updated_at();

CREATE TRIGGER trg_qualite_brix_upd
  BEFORE UPDATE ON qualite.brix_readings
  FOR EACH ROW EXECUTE FUNCTION qualite.update_updated_at();

CREATE TRIGGER trg_qualite_bons_apport_upd
  BEFORE UPDATE ON qualite.bons_apport
  FOR EACH ROW EXECUTE FUNCTION qualite.update_updated_at();

CREATE TRIGGER trg_qualite_pfq_upd
  BEFORE UPDATE ON qualite.pfq_records
  FOR EACH ROW EXECUTE FUNCTION qualite.update_updated_at();

CREATE TRIGGER trg_qualite_liquidations_upd
  BEFORE UPDATE ON qualite.liquidations
  FOR EACH ROW EXECUTE FUNCTION qualite.update_updated_at();

-- 6. Row-Level Security
ALTER TABLE qualite.inspections   ENABLE ROW LEVEL SECURITY;
ALTER TABLE qualite.expeditions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE qualite.ecarts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE qualite.brix_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE qualite.bons_apport   ENABLE ROW LEVEL SECURITY;
ALTER TABLE qualite.pfq_records   ENABLE ROW LEVEL SECURITY;
ALTER TABLE qualite.liquidations  ENABLE ROW LEVEL SECURITY;

-- 7. RLS Policies (DROP IF EXISTS individually — no DO $$ wrapper)
DROP POLICY IF EXISTS qualite_admin_inspections  ON qualite.inspections;
DROP POLICY IF EXISTS qualite_chef_inspections   ON qualite.inspections;
DROP POLICY IF EXISTS qualite_admin_expeditions  ON qualite.expeditions;
DROP POLICY IF EXISTS qualite_chef_expeditions   ON qualite.expeditions;
DROP POLICY IF EXISTS qualite_admin_ecarts       ON qualite.ecarts;
DROP POLICY IF EXISTS qualite_chef_ecarts        ON qualite.ecarts;
DROP POLICY IF EXISTS qualite_admin_brix         ON qualite.brix_readings;
DROP POLICY IF EXISTS qualite_chef_brix          ON qualite.brix_readings;
DROP POLICY IF EXISTS qualite_admin_bons_apport  ON qualite.bons_apport;
DROP POLICY IF EXISTS qualite_chef_bons_apport   ON qualite.bons_apport;
DROP POLICY IF EXISTS qualite_achats_bons_apport ON qualite.bons_apport;
DROP POLICY IF EXISTS qualite_admin_pfq          ON qualite.pfq_records;
DROP POLICY IF EXISTS qualite_chef_pfq           ON qualite.pfq_records;
DROP POLICY IF EXISTS qualite_admin_liquidations ON qualite.liquidations;
DROP POLICY IF EXISTS qualite_chef_liquidations  ON qualite.liquidations;

-- Admin / qualite / dg / finance: full access
CREATE POLICY qualite_admin_inspections  ON qualite.inspections  FOR ALL TO authenticated
  USING (qualite.current_user_role() IN ('qualite', 'dg', 'admin', 'finance'));

CREATE POLICY qualite_admin_expeditions  ON qualite.expeditions  FOR ALL TO authenticated
  USING (qualite.current_user_role() IN ('qualite', 'dg', 'admin', 'finance'));

CREATE POLICY qualite_admin_ecarts       ON qualite.ecarts       FOR ALL TO authenticated
  USING (qualite.current_user_role() IN ('qualite', 'dg', 'admin', 'finance'));

CREATE POLICY qualite_admin_brix         ON qualite.brix_readings FOR ALL TO authenticated
  USING (qualite.current_user_role() IN ('qualite', 'dg', 'admin', 'finance'));

CREATE POLICY qualite_admin_bons_apport  ON qualite.bons_apport  FOR ALL TO authenticated
  USING (qualite.current_user_role() IN ('qualite', 'dg', 'admin', 'achats', 'finance'));

CREATE POLICY qualite_admin_pfq          ON qualite.pfq_records  FOR ALL TO authenticated
  USING (qualite.current_user_role() IN ('qualite', 'dg', 'admin', 'finance'));

CREATE POLICY qualite_admin_liquidations ON qualite.liquidations FOR ALL TO authenticated
  USING (qualite.current_user_role() IN ('qualite', 'dg', 'admin', 'finance'));

-- Chef: read own ferme only
CREATE POLICY qualite_chef_inspections  ON qualite.inspections  FOR SELECT TO authenticated
  USING (qualite.current_user_role() = 'chef' AND ferme = qualite.current_user_profile());

CREATE POLICY qualite_chef_expeditions  ON qualite.expeditions  FOR SELECT TO authenticated
  USING (qualite.current_user_role() = 'chef' AND ferme = qualite.current_user_profile());

CREATE POLICY qualite_chef_ecarts       ON qualite.ecarts       FOR SELECT TO authenticated
  USING (qualite.current_user_role() = 'chef' AND ferme = qualite.current_user_profile());

CREATE POLICY qualite_chef_brix         ON qualite.brix_readings FOR SELECT TO authenticated
  USING (qualite.current_user_role() = 'chef' AND ferme = qualite.current_user_profile());

CREATE POLICY qualite_chef_bons_apport  ON qualite.bons_apport  FOR SELECT TO authenticated
  USING (qualite.current_user_role() = 'chef' AND ferme = qualite.current_user_profile());

CREATE POLICY qualite_chef_pfq          ON qualite.pfq_records  FOR SELECT TO authenticated
  USING (qualite.current_user_role() = 'chef' AND ferme = qualite.current_user_profile());

CREATE POLICY qualite_chef_liquidations ON qualite.liquidations FOR SELECT TO authenticated
  USING (qualite.current_user_role() = 'chef' AND ferme = qualite.current_user_profile());

-- Achats: read bons_apport only
CREATE POLICY qualite_achats_bons_apport ON qualite.bons_apport FOR SELECT TO authenticated
  USING (qualite.current_user_role() = 'achats');

-- ============================================================
-- Done. 7 tables, 14 indexes, 7 triggers, RLS on all.
-- ============================================================
