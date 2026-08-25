-- ============================================================
-- Smart BERRY — Master Supabase Postgres Schema (Public Compatible)
-- Idempotent: safe to run multiple times in Supabase SQL Editor.
-- Target Project: eqopexrgcottuzfkywgi.supabase.co
-- ============================================================

-- 1. Helper Functions

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION current_user_profile()
RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT current_setting('app.user_profile', true);
$$;

CREATE OR REPLACE FUNCTION current_user_role()
RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT current_setting('app.user_role', true);
$$;


-- ============================================================
-- 2. FINANCE DOMAIN TABLES (Public Schema)
-- ============================================================

CREATE TABLE IF NOT EXISTS invoices (
    id                        SERIAL PRIMARY KEY,
    firestore_id              TEXT UNIQUE,
    numero_facture            TEXT,
    fournisseur               TEXT,
    montant                   NUMERIC,
    tva                       NUMERIC,
    montant_ttc               NUMERIC,
    payment_status            TEXT,
    ferme                     TEXT,
    date_facture              TIMESTAMPTZ,
    date_validation_achats    TIMESTAMPTZ,
    date_validation_finance   TIMESTAMPTZ,
    date_validation_dg        TIMESTAMPTZ,
    validated_by_achats       TEXT,
    validated_by_finance      TEXT,
    validated_by_dg           TEXT,
    notes                     TEXT,
    created_at                TIMESTAMPTZ DEFAULT now(),
    updated_at                TIMESTAMPTZ DEFAULT now(),
    created_by                TEXT
);
COMMENT ON TABLE invoices IS 'Factures fournisseurs — Smart BERRY Finance';

CREATE TABLE IF NOT EXISTS caisse_transactions (
    id               SERIAL PRIMARY KEY,
    firestore_id     TEXT UNIQUE,
    type             TEXT,
    montant          NUMERIC,
    description      TEXT,
    date             TIMESTAMPTZ,
    ferme            TEXT,
    categorie        TEXT,
    justificatif_url TEXT,
    created_at       TIMESTAMPTZ DEFAULT now(),
    updated_at       TIMESTAMPTZ DEFAULT now(),
    created_by       TEXT
);
COMMENT ON TABLE caisse_transactions IS 'Transactions caisse — Smart BERRY Finance';

CREATE TABLE IF NOT EXISTS virements (
    id             SERIAL PRIMARY KEY,
    firestore_id   TEXT UNIQUE,
    bdc_id         TEXT,
    montant        NUMERIC,
    banque         TEXT,
    reference      TEXT,
    status         TEXT,
    date_virement  TIMESTAMPTZ,
    ferme          TEXT,
    created_at     TIMESTAMPTZ DEFAULT now(),
    updated_at     TIMESTAMPTZ DEFAULT now(),
    created_by     TEXT
);
COMMENT ON TABLE virements IS 'Virements bancaires — Smart BERRY Finance';

CREATE TABLE IF NOT EXISTS ojra_payroll (
    id               SERIAL PRIMARY KEY,
    firestore_id     TEXT UNIQUE,
    quinzaine        TEXT,
    ferme            TEXT,
    matricule        TEXT,
    nom              TEXT,
    poste            TEXT,
    jours_travailles NUMERIC,
    salaire_base     NUMERIC,
    primes           NUMERIC,
    retenues         NUMERIC,
    net_a_payer      NUMERIC,
    statut           TEXT,
    created_at       TIMESTAMPTZ DEFAULT now(),
    updated_at       TIMESTAMPTZ DEFAULT now(),
    created_by       TEXT
);
COMMENT ON TABLE ojra_payroll IS 'OJRA Paie — Smart BERRY Finance';

CREATE TABLE IF NOT EXISTS liquidations (
    id               SERIAL PRIMARY KEY,
    firestore_id     TEXT UNIQUE,
    quinzaine        TEXT,
    ferme            TEXT,
    variete          TEXT,
    kg_total         NUMERIC,
    prix_unitaire    NUMERIC,
    montant_total    NUMERIC,
    type_expedition  TEXT,
    statut           TEXT,
    date_liquidation TIMESTAMPTZ,
    created_at       TIMESTAMPTZ DEFAULT now(),
    updated_at       TIMESTAMPTZ DEFAULT now(),
    created_by       TEXT
);
COMMENT ON TABLE liquidations IS 'Liquidations finance — Smart BERRY Finance';

CREATE TABLE IF NOT EXISTS encaissements (
    id                SERIAL PRIMARY KEY,
    firestore_id      TEXT UNIQUE,
    compte_client_id  TEXT,
    montant           NUMERIC,
    mode_paiement     TEXT,
    date_encaissement TIMESTAMPTZ,
    reference         TEXT,
    ferme             TEXT,
    created_at        TIMESTAMPTZ DEFAULT now(),
    updated_at        TIMESTAMPTZ DEFAULT now(),
    created_by        TEXT
);
COMMENT ON TABLE encaissements IS 'Encaissements — Smart BERRY Finance';

CREATE TABLE IF NOT EXISTS comptes_clients (
    id             SERIAL PRIMARY KEY,
    firestore_id   TEXT UNIQUE,
    nom            TEXT,
    telephone      TEXT,
    adresse        TEXT,
    solde_initial  NUMERIC,
    type           TEXT,
    actif          BOOLEAN DEFAULT true,
    created_at     TIMESTAMPTZ DEFAULT now(),
    updated_at     TIMESTAMPTZ DEFAULT now(),
    created_by     TEXT
);
COMMENT ON TABLE comptes_clients IS 'Comptes clients — Smart BERRY Finance';

CREATE TABLE IF NOT EXISTS codes_analytiques (
    id         SERIAL PRIMARY KEY,
    code       TEXT UNIQUE,
    libelle    TEXT,
    domaine    TEXT,
    ferme      TEXT,
    actif      BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_by TEXT
);
COMMENT ON TABLE codes_analytiques IS 'Codes analytiques — Smart BERRY Finance';

CREATE TABLE IF NOT EXISTS budget_campagne (
    id              SERIAL PRIMARY KEY,
    firestore_id    TEXT UNIQUE,
    campagne        TEXT,
    ferme           TEXT,
    categorie       TEXT,
    sous_categorie  TEXT,
    montant_budget  NUMERIC,
    montant_reel    NUMERIC,
    quinzaine       TEXT,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now(),
    created_by      TEXT
);
COMMENT ON TABLE budget_campagne IS 'Budget campagne — Smart BERRY Finance';

CREATE TABLE IF NOT EXISTS fuel_transactions (
    id               SERIAL PRIMARY KEY,
    firestore_id     TEXT UNIQUE,
    date_transaction TIMESTAMPTZ,
    vehicule         TEXT,
    conducteur       TEXT,
    litres           NUMERIC,
    prix_litre       NUMERIC,
    montant          NUMERIC,
    ferme            TEXT,
    odometer         NUMERIC,
    created_at       TIMESTAMPTZ DEFAULT now(),
    updated_at       TIMESTAMPTZ DEFAULT now(),
    created_by       TEXT
);
COMMENT ON TABLE fuel_transactions IS 'Carburant — Smart BERRY Finance';

CREATE TABLE IF NOT EXISTS telecom_bills (
    id              SERIAL PRIMARY KEY,
    firestore_id    TEXT UNIQUE,
    operateur       TEXT,
    mois            TEXT,
    numero          TEXT,
    montant_ht      NUMERIC,
    montant_ttc     NUMERIC,
    type            TEXT,
    statut_paiement TEXT,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now(),
    created_by      TEXT
);
COMMENT ON TABLE telecom_bills IS 'Factures telecom — Smart BERRY Finance';


-- ============================================================
-- 3. QUALITÉ DOMAIN TABLES (Public Schema)
-- ============================================================

CREATE TABLE IF NOT EXISTS inspections (
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
COMMENT ON TABLE inspections IS 'Inspections qualité — Smart BERRY Qualité';

CREATE TABLE IF NOT EXISTS expeditions (
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
COMMENT ON TABLE expeditions IS 'Expéditions — Smart BERRY Qualité';

CREATE TABLE IF NOT EXISTS ecarts (
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
COMMENT ON TABLE ecarts IS 'Écarts qualité — Smart BERRY Qualité';

CREATE TABLE IF NOT EXISTS brix_readings (
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
COMMENT ON TABLE brix_readings IS 'Lectures Brix — Smart BERRY Qualité';

CREATE TABLE IF NOT EXISTS bons_apport (
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
COMMENT ON TABLE bons_apport IS 'Bons d''apport — Smart BERRY Qualité';

CREATE TABLE IF NOT EXISTS pfq_records (
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
COMMENT ON TABLE pfq_records IS 'Indicateurs PFQ — Smart BERRY Qualité';


-- ============================================================
-- 4. INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_invoices_ferme          ON invoices(ferme);
CREATE INDEX IF NOT EXISTS idx_invoices_date           ON invoices(date_facture);
CREATE INDEX IF NOT EXISTS idx_invoices_status         ON invoices(payment_status);
CREATE INDEX IF NOT EXISTS idx_caisse_ferme            ON caisse_transactions(ferme);
CREATE INDEX IF NOT EXISTS idx_caisse_date             ON caisse_transactions(date);
CREATE INDEX IF NOT EXISTS idx_virements_ferme         ON virements(ferme);
CREATE INDEX IF NOT EXISTS idx_ojra_payroll_ferme      ON ojra_payroll(ferme);
CREATE INDEX IF NOT EXISTS idx_liquidations_ferme      ON liquidations(ferme);
CREATE INDEX IF NOT EXISTS idx_encaissements_ferme     ON encaissements(ferme);

CREATE INDEX IF NOT EXISTS idx_inspections_ferme       ON inspections(ferme);
CREATE INDEX IF NOT EXISTS idx_expeditions_ferme       ON expeditions(ferme);
CREATE INDEX IF NOT EXISTS idx_ecarts_ferme            ON ecarts(ferme);
CREATE INDEX IF NOT EXISTS idx_brix_ferme              ON brix_readings(ferme);
CREATE INDEX IF NOT EXISTS idx_bons_apport_ferme       ON bons_apport(ferme);
CREATE INDEX IF NOT EXISTS idx_pfq_records_ferme       ON pfq_records(ferme);


-- ============================================================
-- 5. UPDATED_AT TRIGGERS
-- ============================================================

DROP TRIGGER IF EXISTS trg_invoices_upd         ON invoices;
DROP TRIGGER IF EXISTS trg_caisse_upd           ON caisse_transactions;
DROP TRIGGER IF EXISTS trg_virements_upd        ON virements;
DROP TRIGGER IF EXISTS trg_ojra_upd             ON ojra_payroll;
DROP TRIGGER IF EXISTS trg_liquidations_upd     ON liquidations;
DROP TRIGGER IF EXISTS trg_encaissements_upd    ON encaissements;
DROP TRIGGER IF EXISTS trg_comptes_clients_upd  ON comptes_clients;
DROP TRIGGER IF EXISTS trg_codes_ana_upd        ON codes_analytiques;
DROP TRIGGER IF EXISTS trg_budget_upd           ON budget_campagne;
DROP TRIGGER IF EXISTS trg_fuel_upd             ON fuel_transactions;
DROP TRIGGER IF EXISTS trg_telecom_upd          ON telecom_bills;
DROP TRIGGER IF EXISTS trg_inspections_upd      ON inspections;
DROP TRIGGER IF EXISTS trg_expeditions_upd      ON expeditions;
DROP TRIGGER IF EXISTS trg_ecarts_upd           ON ecarts;
DROP TRIGGER IF EXISTS trg_brix_upd             ON brix_readings;
DROP TRIGGER IF EXISTS trg_bons_apport_upd      ON bons_apport;
DROP TRIGGER IF EXISTS trg_pfq_upd              ON pfq_records;

CREATE TRIGGER trg_invoices_upd         BEFORE UPDATE ON invoices         FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_caisse_upd           BEFORE UPDATE ON caisse_transactions FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_virements_upd        BEFORE UPDATE ON virements        FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_ojra_upd             BEFORE UPDATE ON ojra_payroll     FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_liquidations_upd     BEFORE UPDATE ON liquidations     FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_encaissements_upd    BEFORE UPDATE ON encaissements    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_comptes_clients_upd  BEFORE UPDATE ON comptes_clients  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_codes_ana_upd        BEFORE UPDATE ON codes_analytiques FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_budget_upd           BEFORE UPDATE ON budget_campagne  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_fuel_upd             BEFORE UPDATE ON fuel_transactions FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_telecom_upd          BEFORE UPDATE ON telecom_bills     FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_inspections_upd      BEFORE UPDATE ON inspections      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_expeditions_upd      BEFORE UPDATE ON expeditions      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_ecarts_upd           BEFORE UPDATE ON ecarts           FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_brix_upd             BEFORE UPDATE ON brix_readings     FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_bons_apport_upd      BEFORE UPDATE ON bons_apport      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_pfq_upd              BEFORE UPDATE ON pfq_records      FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- Done. All 17 tables created in Public schema for instant Supabase REST API access.
-- ============================================================
