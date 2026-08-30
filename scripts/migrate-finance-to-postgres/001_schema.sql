-- ============================================================
-- Smart BERRY — Finance Schema
-- Idempotent: safe to run multiple times.
-- Apply via: Supabase SQL Editor → paste full file → Run ▶
-- ============================================================

CREATE SCHEMA IF NOT EXISTS finance;

CREATE OR REPLACE FUNCTION finance.update_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION finance.current_user_profile()
RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT current_setting('app.user_profile', true);
$$;

CREATE TABLE IF NOT EXISTS finance.invoices (
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

CREATE TABLE IF NOT EXISTS finance.caisse_transactions (
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

CREATE TABLE IF NOT EXISTS finance.virements (
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

CREATE TABLE IF NOT EXISTS finance.ojra_payroll (
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

CREATE TABLE IF NOT EXISTS finance.liquidations (
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

CREATE TABLE IF NOT EXISTS finance.encaissements (
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

CREATE TABLE IF NOT EXISTS finance.comptes_clients (
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

CREATE TABLE IF NOT EXISTS finance.codes_analytiques (
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

CREATE TABLE IF NOT EXISTS finance.budget_campagne (
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

CREATE TABLE IF NOT EXISTS finance.fuel_transactions (
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

CREATE TABLE IF NOT EXISTS finance.telecom_bills (
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

-- Indexes
CREATE INDEX IF NOT EXISTS idx_fin_invoices_ferme          ON finance.invoices(ferme);
CREATE INDEX IF NOT EXISTS idx_fin_caisse_ferme            ON finance.caisse_transactions(ferme);
CREATE INDEX IF NOT EXISTS idx_fin_virements_ferme         ON finance.virements(ferme);
CREATE INDEX IF NOT EXISTS idx_fin_ojra_payroll_ferme      ON finance.ojra_payroll(ferme);
CREATE INDEX IF NOT EXISTS idx_fin_liquidations_ferme      ON finance.liquidations(ferme);

-- Triggers
CREATE OR REPLACE TRIGGER trg_fin_invoices_upd         BEFORE UPDATE ON finance.invoices         FOR EACH ROW EXECUTE FUNCTION finance.update_updated_at();
CREATE OR REPLACE TRIGGER trg_fin_caisse_upd           BEFORE UPDATE ON finance.caisse_transactions FOR EACH ROW EXECUTE FUNCTION finance.update_updated_at();
CREATE OR REPLACE TRIGGER trg_fin_virements_upd        BEFORE UPDATE ON finance.virements        FOR EACH ROW EXECUTE FUNCTION finance.update_updated_at();
CREATE OR REPLACE TRIGGER trg_fin_ojra_upd             BEFORE UPDATE ON finance.ojra_payroll     FOR EACH ROW EXECUTE FUNCTION finance.update_updated_at();
CREATE OR REPLACE TRIGGER trg_fin_liquidations_upd     BEFORE UPDATE ON finance.liquidations     FOR EACH ROW EXECUTE FUNCTION finance.update_updated_at();
CREATE OR REPLACE TRIGGER trg_fin_encaissements_upd    BEFORE UPDATE ON finance.encaissements    FOR EACH ROW EXECUTE FUNCTION finance.update_updated_at();
CREATE OR REPLACE TRIGGER trg_fin_comptes_clients_upd  BEFORE UPDATE ON finance.comptes_clients  FOR EACH ROW EXECUTE FUNCTION finance.update_updated_at();
CREATE OR REPLACE TRIGGER trg_fin_codes_ana_upd        BEFORE UPDATE ON finance.codes_analytiques FOR EACH ROW EXECUTE FUNCTION finance.update_updated_at();
CREATE OR REPLACE TRIGGER trg_fin_budget_upd           BEFORE UPDATE ON finance.budget_campagne  FOR EACH ROW EXECUTE FUNCTION finance.update_updated_at();
CREATE OR REPLACE TRIGGER trg_fin_fuel_upd             BEFORE UPDATE ON finance.fuel_transactions FOR EACH ROW EXECUTE FUNCTION finance.update_updated_at();
CREATE OR REPLACE TRIGGER trg_fin_telecom_upd          BEFORE UPDATE ON finance.telecom_bills     FOR EACH ROW EXECUTE FUNCTION finance.update_updated_at();
