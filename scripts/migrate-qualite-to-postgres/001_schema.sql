-- ============================================================
-- Smart BERRY — Qualité Schema
-- Idempotent: safe to run multiple times.
-- Apply via: Supabase SQL Editor → paste full file → Run ▶
-- ============================================================

CREATE SCHEMA IF NOT EXISTS qualite;

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

-- Indexes
CREATE INDEX IF NOT EXISTS idx_qlt_inspections_ferme   ON qualite.inspections(ferme);
CREATE INDEX IF NOT EXISTS idx_qlt_expeditions_ferme   ON qualite.expeditions(ferme);
CREATE INDEX IF NOT EXISTS idx_qlt_ecarts_ferme        ON qualite.ecarts(ferme);
CREATE INDEX IF NOT EXISTS idx_qlt_brix_ferme          ON qualite.brix_readings(ferme);
CREATE INDEX IF NOT EXISTS idx_qlt_bons_apport_ferme   ON qualite.bons_apport(ferme);
CREATE INDEX IF NOT EXISTS idx_qlt_pfq_records_ferme   ON qualite.pfq_records(ferme);

-- Triggers
CREATE OR REPLACE TRIGGER trg_qlt_inspections_upd   BEFORE UPDATE ON qualite.inspections   FOR EACH ROW EXECUTE FUNCTION qualite.update_updated_at();
CREATE OR REPLACE TRIGGER trg_qlt_expeditions_upd   BEFORE UPDATE ON qualite.expeditions   FOR EACH ROW EXECUTE FUNCTION qualite.update_updated_at();
CREATE OR REPLACE TRIGGER trg_qlt_ecarts_upd        BEFORE UPDATE ON qualite.ecarts        FOR EACH ROW EXECUTE FUNCTION qualite.update_updated_at();
CREATE OR REPLACE TRIGGER trg_qlt_brix_upd          BEFORE UPDATE ON qualite.brix_readings FOR EACH ROW EXECUTE FUNCTION qualite.update_updated_at();
CREATE OR REPLACE TRIGGER trg_qlt_bons_apport_upd   BEFORE UPDATE ON qualite.bons_apport   FOR EACH ROW EXECUTE FUNCTION qualite.update_updated_at();
CREATE OR REPLACE TRIGGER trg_qlt_pfq_records_upd   BEFORE UPDATE ON qualite.pfq_records   FOR EACH ROW EXECUTE FUNCTION qualite.update_updated_at();
