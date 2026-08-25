-- ============================================================
-- Smart BERRY — Master Supabase Postgres Schema (Public Schema)
-- Idempotent: safe to run multiple times in Supabase SQL Editor.
-- Target Project: eqopexrgcottuzfkywgi.supabase.co
-- ============================================================

-- 1. Helper Function for Auto-Updating updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


-- ============================================================
-- 2. FINANCE & QUALITÉ DOMAIN TABLES & TRIGGERS (Self-Contained)
-- ============================================================

-- 1. Invoices
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
CREATE OR REPLACE TRIGGER trg_invoices_upd BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- 2. Caisse Transactions
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
CREATE OR REPLACE TRIGGER trg_caisse_upd BEFORE UPDATE ON caisse_transactions FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- 3. Virements
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
CREATE OR REPLACE TRIGGER trg_virements_upd BEFORE UPDATE ON virements FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- 4. Ojra Payroll
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
CREATE OR REPLACE TRIGGER trg_ojra_upd BEFORE UPDATE ON ojra_payroll FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- 5. Liquidations
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
CREATE OR REPLACE TRIGGER trg_liquidations_upd BEFORE UPDATE ON liquidations FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- 6. Encaissements
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
CREATE OR REPLACE TRIGGER trg_encaissements_upd BEFORE UPDATE ON encaissements FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- 7. Comptes Clients
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
CREATE OR REPLACE TRIGGER trg_comptes_clients_upd BEFORE UPDATE ON comptes_clients FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- 8. Codes Analytiques
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
CREATE OR REPLACE TRIGGER trg_codes_ana_upd BEFORE UPDATE ON codes_analytiques FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- 9. Budget Campagne
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
CREATE OR REPLACE TRIGGER trg_budget_upd BEFORE UPDATE ON budget_campagne FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- 10. Fuel Transactions
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
CREATE OR REPLACE TRIGGER trg_fuel_upd BEFORE UPDATE ON fuel_transactions FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- 11. Telecom Bills
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
CREATE OR REPLACE TRIGGER trg_telecom_upd BEFORE UPDATE ON telecom_bills FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- 12. Inspections
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
CREATE OR REPLACE TRIGGER trg_inspections_upd BEFORE UPDATE ON inspections FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- 13. Expeditions
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
CREATE OR REPLACE TRIGGER trg_expeditions_upd BEFORE UPDATE ON expeditions FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- 14. Ecarts
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
CREATE OR REPLACE TRIGGER trg_ecarts_upd BEFORE UPDATE ON ecarts FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- 15. Brix Readings
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
CREATE OR REPLACE TRIGGER trg_brix_upd BEFORE UPDATE ON brix_readings FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- 16. Bons d'Apport
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
CREATE OR REPLACE TRIGGER trg_bons_apport_upd BEFORE UPDATE ON bons_apport FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- 17. PFQ Records
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
CREATE OR REPLACE TRIGGER trg_pfq_upd BEFORE UPDATE ON pfq_records FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ============================================================
-- 3. INDEXES
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
-- Done. Each table and its trigger are defined together in self-contained blocks.
-- ============================================================
