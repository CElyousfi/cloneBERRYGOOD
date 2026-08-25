-- ============================================================
-- Smart BERRY — Finance Schema
-- Idempotent: safe to run multiple times.
-- Apply via: Supabase SQL Editor → paste full file → Run ▶
-- ============================================================

-- 1. Create schema
CREATE SCHEMA IF NOT EXISTS finance;

-- 2. Helper functions (fully qualified — no SET search_path)
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

-- 3. Tables

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
COMMENT ON TABLE finance.invoices IS 'Factures fournisseurs — migrated from Firestore';

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
COMMENT ON TABLE finance.caisse_transactions IS 'Transactions caisse — migrated from Firestore';

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
COMMENT ON TABLE finance.virements IS 'Virements bancaires — migrated from Firestore';

CREATE TABLE IF NOT EXISTS finance.ojra_payroll (
    id              SERIAL PRIMARY KEY,
    firestore_id    TEXT UNIQUE,
    quinzaine       TEXT,
    ferme           TEXT,
    matricule       TEXT,
    nom             TEXT,
    poste           TEXT,
    jours_travailles NUMERIC,
    salaire_base    NUMERIC,
    primes          NUMERIC,
    retenues        NUMERIC,
    net_a_payer     NUMERIC,
    statut          TEXT,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now(),
    created_by      TEXT
);
COMMENT ON TABLE finance.ojra_payroll IS 'OJRA paie — migrated from Firestore';

CREATE TABLE IF NOT EXISTS finance.liquidations (
    id              SERIAL PRIMARY KEY,
    firestore_id    TEXT UNIQUE,
    quinzaine       TEXT,
    ferme           TEXT,
    variete         TEXT,
    kg_total        NUMERIC,
    prix_unitaire   NUMERIC,
    montant_total   NUMERIC,
    type_expedition TEXT,
    statut          TEXT,
    date_liquidation TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now(),
    created_by      TEXT
);
COMMENT ON TABLE finance.liquidations IS 'Liquidations finance — migrated from Firestore';

CREATE TABLE IF NOT EXISTS finance.encaissements (
    id                  SERIAL PRIMARY KEY,
    firestore_id        TEXT UNIQUE,
    compte_client_id    TEXT,
    montant             NUMERIC,
    mode_paiement       TEXT,
    date_encaissement   TIMESTAMPTZ,
    reference           TEXT,
    ferme               TEXT,
    created_at          TIMESTAMPTZ DEFAULT now(),
    updated_at          TIMESTAMPTZ DEFAULT now(),
    created_by          TEXT
);
COMMENT ON TABLE finance.encaissements IS 'Encaissements — migrated from Firestore';

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
COMMENT ON TABLE finance.comptes_clients IS 'Comptes clients marche local — migrated from Firestore';

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
COMMENT ON TABLE finance.codes_analytiques IS 'Codes analytiques — migrated from Firestore';

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
COMMENT ON TABLE finance.budget_campagne IS 'Budget campagne — migrated from Firestore';

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
COMMENT ON TABLE finance.fuel_transactions IS 'Carburant — migrated from Firestore';

CREATE TABLE IF NOT EXISTS finance.telecom_bills (
    id                SERIAL PRIMARY KEY,
    firestore_id      TEXT UNIQUE,
    operateur         TEXT,
    mois              TEXT,
    numero            TEXT,
    montant_ht        NUMERIC,
    montant_ttc       NUMERIC,
    type              TEXT,
    statut_paiement   TEXT,
    created_at        TIMESTAMPTZ DEFAULT now(),
    updated_at        TIMESTAMPTZ DEFAULT now(),
    created_by        TEXT
);
COMMENT ON TABLE finance.telecom_bills IS 'Factures telecom — migrated from Firestore';

-- 4. Indexes
CREATE INDEX IF NOT EXISTS idx_finance_invoices_ferme          ON finance.invoices(ferme);
CREATE INDEX IF NOT EXISTS idx_finance_invoices_date           ON finance.invoices(date_facture);
CREATE INDEX IF NOT EXISTS idx_finance_invoices_status         ON finance.invoices(payment_status);
CREATE INDEX IF NOT EXISTS idx_finance_caisse_ferme            ON finance.caisse_transactions(ferme);
CREATE INDEX IF NOT EXISTS idx_finance_caisse_date             ON finance.caisse_transactions(date);
CREATE INDEX IF NOT EXISTS idx_finance_virements_ferme         ON finance.virements(ferme);
CREATE INDEX IF NOT EXISTS idx_finance_virements_date          ON finance.virements(date_virement);
CREATE INDEX IF NOT EXISTS idx_finance_ojra_ferme              ON finance.ojra_payroll(ferme);
CREATE INDEX IF NOT EXISTS idx_finance_ojra_quinzaine          ON finance.ojra_payroll(quinzaine);
CREATE INDEX IF NOT EXISTS idx_finance_liquidations_ferme      ON finance.liquidations(ferme);
CREATE INDEX IF NOT EXISTS idx_finance_liquidations_quinzaine  ON finance.liquidations(quinzaine);
CREATE INDEX IF NOT EXISTS idx_finance_encaissements_ferme     ON finance.encaissements(ferme);
CREATE INDEX IF NOT EXISTS idx_finance_encaissements_date      ON finance.encaissements(date_encaissement);
CREATE INDEX IF NOT EXISTS idx_finance_budget_ferme            ON finance.budget_campagne(ferme);
CREATE INDEX IF NOT EXISTS idx_finance_budget_campagne         ON finance.budget_campagne(campagne);
CREATE INDEX IF NOT EXISTS idx_finance_fuel_ferme              ON finance.fuel_transactions(ferme);
CREATE INDEX IF NOT EXISTS idx_finance_fuel_date               ON finance.fuel_transactions(date_transaction);

-- 5. Triggers (DROP IF EXISTS individually — no DO $$ wrapper)
DROP TRIGGER IF EXISTS trg_finance_invoices_upd         ON finance.invoices;
DROP TRIGGER IF EXISTS trg_finance_caisse_upd           ON finance.caisse_transactions;
DROP TRIGGER IF EXISTS trg_finance_virements_upd        ON finance.virements;
DROP TRIGGER IF EXISTS trg_finance_ojra_upd             ON finance.ojra_payroll;
DROP TRIGGER IF EXISTS trg_finance_liquidations_upd     ON finance.liquidations;
DROP TRIGGER IF EXISTS trg_finance_encaissements_upd    ON finance.encaissements;
DROP TRIGGER IF EXISTS trg_finance_comptes_clients_upd  ON finance.comptes_clients;
DROP TRIGGER IF EXISTS trg_finance_codes_ana_upd        ON finance.codes_analytiques;
DROP TRIGGER IF EXISTS trg_finance_budget_upd           ON finance.budget_campagne;
DROP TRIGGER IF EXISTS trg_finance_fuel_upd             ON finance.fuel_transactions;
DROP TRIGGER IF EXISTS trg_finance_telecom_upd          ON finance.telecom_bills;

CREATE TRIGGER trg_finance_invoices_upd
  BEFORE UPDATE ON finance.invoices
  FOR EACH ROW EXECUTE FUNCTION finance.update_updated_at();

CREATE TRIGGER trg_finance_caisse_upd
  BEFORE UPDATE ON finance.caisse_transactions
  FOR EACH ROW EXECUTE FUNCTION finance.update_updated_at();

CREATE TRIGGER trg_finance_virements_upd
  BEFORE UPDATE ON finance.virements
  FOR EACH ROW EXECUTE FUNCTION finance.update_updated_at();

CREATE TRIGGER trg_finance_ojra_upd
  BEFORE UPDATE ON finance.ojra_payroll
  FOR EACH ROW EXECUTE FUNCTION finance.update_updated_at();

CREATE TRIGGER trg_finance_liquidations_upd
  BEFORE UPDATE ON finance.liquidations
  FOR EACH ROW EXECUTE FUNCTION finance.update_updated_at();

CREATE TRIGGER trg_finance_encaissements_upd
  BEFORE UPDATE ON finance.encaissements
  FOR EACH ROW EXECUTE FUNCTION finance.update_updated_at();

CREATE TRIGGER trg_finance_comptes_clients_upd
  BEFORE UPDATE ON finance.comptes_clients
  FOR EACH ROW EXECUTE FUNCTION finance.update_updated_at();

CREATE TRIGGER trg_finance_codes_ana_upd
  BEFORE UPDATE ON finance.codes_analytiques
  FOR EACH ROW EXECUTE FUNCTION finance.update_updated_at();

CREATE TRIGGER trg_finance_budget_upd
  BEFORE UPDATE ON finance.budget_campagne
  FOR EACH ROW EXECUTE FUNCTION finance.update_updated_at();

CREATE TRIGGER trg_finance_fuel_upd
  BEFORE UPDATE ON finance.fuel_transactions
  FOR EACH ROW EXECUTE FUNCTION finance.update_updated_at();

CREATE TRIGGER trg_finance_telecom_upd
  BEFORE UPDATE ON finance.telecom_bills
  FOR EACH ROW EXECUTE FUNCTION finance.update_updated_at();

-- 6. Row-Level Security
ALTER TABLE finance.invoices          ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.caisse_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.virements         ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.ojra_payroll      ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.liquidations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.encaissements     ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.comptes_clients   ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.codes_analytiques ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.budget_campagne   ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.fuel_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.telecom_bills     ENABLE ROW LEVEL SECURITY;

-- 7. RLS Policies (DROP IF EXISTS individually — no DO $$ wrapper)
DROP POLICY IF EXISTS finance_full_access      ON finance.invoices;
DROP POLICY IF EXISTS finance_achats_read      ON finance.invoices;
DROP POLICY IF EXISTS finance_achats_insert    ON finance.invoices;
DROP POLICY IF EXISTS finance_achats_update    ON finance.invoices;
DROP POLICY IF EXISTS finance_chef_invoices    ON finance.invoices;
DROP POLICY IF EXISTS finance_full_access      ON finance.caisse_transactions;
DROP POLICY IF EXISTS finance_chef_caisse      ON finance.caisse_transactions;
DROP POLICY IF EXISTS finance_full_access      ON finance.virements;
DROP POLICY IF EXISTS finance_chef_virements   ON finance.virements;
DROP POLICY IF EXISTS finance_full_access      ON finance.ojra_payroll;
DROP POLICY IF EXISTS finance_chef_ojra        ON finance.ojra_payroll;
DROP POLICY IF EXISTS finance_full_access      ON finance.liquidations;
DROP POLICY IF EXISTS finance_chef_liquidations ON finance.liquidations;
DROP POLICY IF EXISTS finance_full_access      ON finance.encaissements;
DROP POLICY IF EXISTS finance_full_access      ON finance.comptes_clients;
DROP POLICY IF EXISTS finance_full_access      ON finance.codes_analytiques;
DROP POLICY IF EXISTS finance_full_access      ON finance.budget_campagne;
DROP POLICY IF EXISTS finance_chef_budget      ON finance.budget_campagne;
DROP POLICY IF EXISTS finance_full_access      ON finance.fuel_transactions;
DROP POLICY IF EXISTS finance_chef_fuel        ON finance.fuel_transactions;
DROP POLICY IF EXISTS finance_full_access      ON finance.telecom_bills;

-- Finance / DG / Admin: full access to all tables
CREATE POLICY finance_full_access ON finance.invoices FOR ALL TO authenticated
  USING (finance.current_user_profile() IN ('finance', 'dg', 'admin'));

CREATE POLICY finance_full_access ON finance.caisse_transactions FOR ALL TO authenticated
  USING (finance.current_user_profile() IN ('finance', 'dg', 'admin'));

CREATE POLICY finance_full_access ON finance.virements FOR ALL TO authenticated
  USING (finance.current_user_profile() IN ('finance', 'dg', 'admin'));

CREATE POLICY finance_full_access ON finance.ojra_payroll FOR ALL TO authenticated
  USING (finance.current_user_profile() IN ('finance', 'dg', 'admin'));

CREATE POLICY finance_full_access ON finance.liquidations FOR ALL TO authenticated
  USING (finance.current_user_profile() IN ('finance', 'dg', 'admin'));

CREATE POLICY finance_full_access ON finance.encaissements FOR ALL TO authenticated
  USING (finance.current_user_profile() IN ('finance', 'dg', 'admin'));

CREATE POLICY finance_full_access ON finance.comptes_clients FOR ALL TO authenticated
  USING (finance.current_user_profile() IN ('finance', 'dg', 'admin'));

CREATE POLICY finance_full_access ON finance.codes_analytiques FOR ALL TO authenticated
  USING (finance.current_user_profile() IN ('finance', 'dg', 'admin'));

CREATE POLICY finance_full_access ON finance.budget_campagne FOR ALL TO authenticated
  USING (finance.current_user_profile() IN ('finance', 'dg', 'admin'));

CREATE POLICY finance_full_access ON finance.fuel_transactions FOR ALL TO authenticated
  USING (finance.current_user_profile() IN ('finance', 'dg', 'admin'));

CREATE POLICY finance_full_access ON finance.telecom_bills FOR ALL TO authenticated
  USING (finance.current_user_profile() IN ('finance', 'dg', 'admin'));

-- Achats: read + submit + update invoices
CREATE POLICY finance_achats_read ON finance.invoices FOR SELECT TO authenticated
  USING (finance.current_user_profile() IN ('achats', 'finance', 'dg', 'admin'));

CREATE POLICY finance_achats_insert ON finance.invoices FOR INSERT TO authenticated
  WITH CHECK (finance.current_user_profile() IN ('achats', 'finance', 'dg', 'admin'));

CREATE POLICY finance_achats_update ON finance.invoices FOR UPDATE TO authenticated
  USING (finance.current_user_profile() IN ('achats', 'finance', 'dg', 'admin'));

-- Chef: read own ferme
CREATE POLICY finance_chef_invoices ON finance.invoices FOR SELECT TO authenticated
  USING (finance.current_user_profile() = 'chef' AND ferme = current_setting('app.user_ferme', true));

CREATE POLICY finance_chef_caisse ON finance.caisse_transactions FOR SELECT TO authenticated
  USING (finance.current_user_profile() = 'chef' AND ferme = current_setting('app.user_ferme', true));

CREATE POLICY finance_chef_virements ON finance.virements FOR SELECT TO authenticated
  USING (finance.current_user_profile() = 'chef' AND ferme = current_setting('app.user_ferme', true));

CREATE POLICY finance_chef_ojra ON finance.ojra_payroll FOR SELECT TO authenticated
  USING (finance.current_user_profile() = 'chef' AND ferme = current_setting('app.user_ferme', true));

CREATE POLICY finance_chef_liquidations ON finance.liquidations FOR SELECT TO authenticated
  USING (finance.current_user_profile() = 'chef' AND ferme = current_setting('app.user_ferme', true));

CREATE POLICY finance_chef_budget ON finance.budget_campagne FOR SELECT TO authenticated
  USING (finance.current_user_profile() = 'chef' AND ferme = current_setting('app.user_ferme', true));

CREATE POLICY finance_chef_fuel ON finance.fuel_transactions FOR SELECT TO authenticated
  USING (finance.current_user_profile() = 'chef' AND ferme = current_setting('app.user_ferme', true));

-- ============================================================
-- Done. 11 tables, 17 indexes, 11 triggers, RLS on all.
-- ============================================================
