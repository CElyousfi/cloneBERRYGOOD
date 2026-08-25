-- 001_schema.sql
CREATE SCHEMA IF NOT EXISTS finance;

SET search_path = finance, public;

CREATE OR REPLACE FUNCTION finance.update_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION finance.current_user_profile() RETURNS TEXT AS $$
  SELECT current_setting('app.user_profile', true);
$$ LANGUAGE sql STABLE;

-- Tables

CREATE TABLE IF NOT EXISTS finance.invoices (
    id SERIAL PRIMARY KEY,
    firestore_id TEXT UNIQUE,
    numero_facture TEXT,
    fournisseur TEXT,
    montant NUMERIC,
    tva NUMERIC,
    montant_ttc NUMERIC,
    payment_status TEXT,
    ferme TEXT,
    date_facture TIMESTAMP WITH TIME ZONE,
    date_validation_achats TIMESTAMP WITH TIME ZONE,
    date_validation_finance TIMESTAMP WITH TIME ZONE,
    date_validation_dg TIMESTAMP WITH TIME ZONE,
    validated_by_achats TEXT,
    validated_by_finance TEXT,
    validated_by_dg TEXT,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    created_by TEXT
);
COMMENT ON TABLE finance.invoices IS 'Factures fournisseurs — migrated from Firestore invoices collection';

CREATE TABLE IF NOT EXISTS finance.caisse_transactions (
    id SERIAL PRIMARY KEY,
    firestore_id TEXT UNIQUE,
    type TEXT,
    montant NUMERIC,
    description TEXT,
    date TIMESTAMP WITH TIME ZONE,
    ferme TEXT,
    categorie TEXT,
    justificatif_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    created_by TEXT
);
COMMENT ON TABLE finance.caisse_transactions IS 'Caisse transactions — migrated from Firestore caisse collection';

CREATE TABLE IF NOT EXISTS finance.virements (
    id SERIAL PRIMARY KEY,
    firestore_id TEXT UNIQUE,
    bdc_id TEXT,
    montant NUMERIC,
    banque TEXT,
    reference TEXT,
    status TEXT,
    date_virement TIMESTAMP WITH TIME ZONE,
    ferme TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    created_by TEXT
);
COMMENT ON TABLE finance.virements IS 'Virements — migrated from Firestore demandes_virement collection';

CREATE TABLE IF NOT EXISTS finance.ojra_payroll (
    id SERIAL PRIMARY KEY,
    firestore_id TEXT UNIQUE,
    quinzaine TEXT,
    ferme TEXT,
    matricule TEXT,
    nom TEXT,
    poste TEXT,
    jours_travailles NUMERIC,
    salaire_base NUMERIC,
    primes NUMERIC,
    retenues NUMERIC,
    net_a_payer NUMERIC,
    statut TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    created_by TEXT
);
COMMENT ON TABLE finance.ojra_payroll IS 'Ojra Payroll data';

CREATE TABLE IF NOT EXISTS finance.liquidations (
    id SERIAL PRIMARY KEY,
    firestore_id TEXT UNIQUE,
    quinzaine TEXT,
    ferme TEXT,
    variete TEXT,
    kg_total NUMERIC,
    prix_unitaire NUMERIC,
    montant_total NUMERIC,
    type_expedition TEXT,
    statut TEXT,
    date_liquidation TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    created_by TEXT
);
COMMENT ON TABLE finance.liquidations IS 'Liquidations data';

CREATE TABLE IF NOT EXISTS finance.encaissements (
    id SERIAL PRIMARY KEY,
    firestore_id TEXT UNIQUE,
    compte_client_id TEXT,
    montant NUMERIC,
    mode_paiement TEXT,
    date_encaissement TIMESTAMP WITH TIME ZONE,
    reference TEXT,
    ferme TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    created_by TEXT
);
COMMENT ON TABLE finance.encaissements IS 'Encaissements local market';

CREATE TABLE IF NOT EXISTS finance.comptes_clients (
    id SERIAL PRIMARY KEY,
    firestore_id TEXT UNIQUE,
    nom TEXT,
    telephone TEXT,
    adresse TEXT,
    solde_initial NUMERIC,
    type TEXT,
    actif BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    created_by TEXT
);
COMMENT ON TABLE finance.comptes_clients IS 'Comptes Clients';

CREATE TABLE IF NOT EXISTS finance.codes_analytiques (
    id SERIAL PRIMARY KEY,
    code TEXT UNIQUE,
    libelle TEXT,
    domaine TEXT,
    ferme TEXT,
    actif BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    created_by TEXT
);
COMMENT ON TABLE finance.codes_analytiques IS 'Codes Analytiques';

CREATE TABLE IF NOT EXISTS finance.budget_campagne (
    id SERIAL PRIMARY KEY,
    firestore_id TEXT UNIQUE,
    campagne TEXT,
    ferme TEXT,
    categorie TEXT,
    sous_categorie TEXT,
    montant_budget NUMERIC,
    montant_reel NUMERIC,
    quinzaine TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    created_by TEXT
);
COMMENT ON TABLE finance.budget_campagne IS 'Budget Campagne';

CREATE TABLE IF NOT EXISTS finance.fuel_transactions (
    id SERIAL PRIMARY KEY,
    firestore_id TEXT UNIQUE,
    date_transaction TIMESTAMP WITH TIME ZONE,
    vehicule TEXT,
    conducteur TEXT,
    litres NUMERIC,
    prix_litre NUMERIC,
    montant NUMERIC,
    ferme TEXT,
    odometer NUMERIC,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    created_by TEXT
);
COMMENT ON TABLE finance.fuel_transactions IS 'Fuel Transactions';

CREATE TABLE IF NOT EXISTS finance.telecom_bills (
    id SERIAL PRIMARY KEY,
    firestore_id TEXT UNIQUE,
    operateur TEXT,
    mois TEXT,
    numero TEXT,
    montant_ht NUMERIC,
    montant_ttc NUMERIC,
    type TEXT,
    statut_paiement TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    created_by TEXT
);
COMMENT ON TABLE finance.telecom_bills IS 'Telecom Bills';

-- Triggers for updated_at

DO $$ 
DECLARE 
    t TEXT;
BEGIN
    FOR t IN 
        SELECT table_name FROM information_schema.tables 
        WHERE table_schema = 'finance' AND table_type = 'BASE TABLE'
    LOOP
        EXECUTE format('
            DROP TRIGGER IF EXISTS trg_update_updated_at ON finance.%I;
            CREATE TRIGGER trg_update_updated_at
            BEFORE UPDATE ON finance.%I
            FOR EACH ROW
            EXECUTE FUNCTION finance.update_updated_at();
        ', t, t);
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Indexes

CREATE INDEX IF NOT EXISTS idx_invoices_ferme ON finance.invoices(ferme);
CREATE INDEX IF NOT EXISTS idx_invoices_date_facture ON finance.invoices(date_facture);
CREATE INDEX IF NOT EXISTS idx_invoices_payment_status ON finance.invoices(payment_status);

CREATE INDEX IF NOT EXISTS idx_caisse_transactions_ferme ON finance.caisse_transactions(ferme);
CREATE INDEX IF NOT EXISTS idx_caisse_transactions_date ON finance.caisse_transactions(date);

CREATE INDEX IF NOT EXISTS idx_virements_ferme ON finance.virements(ferme);
CREATE INDEX IF NOT EXISTS idx_virements_date_virement ON finance.virements(date_virement);
CREATE INDEX IF NOT EXISTS idx_virements_status ON finance.virements(status);

CREATE INDEX IF NOT EXISTS idx_ojra_payroll_ferme ON finance.ojra_payroll(ferme);
CREATE INDEX IF NOT EXISTS idx_ojra_payroll_quinzaine ON finance.ojra_payroll(quinzaine);

CREATE INDEX IF NOT EXISTS idx_liquidations_ferme ON finance.liquidations(ferme);
CREATE INDEX IF NOT EXISTS idx_liquidations_quinzaine ON finance.liquidations(quinzaine);
CREATE INDEX IF NOT EXISTS idx_liquidations_statut ON finance.liquidations(statut);

CREATE INDEX IF NOT EXISTS idx_encaissements_ferme ON finance.encaissements(ferme);
CREATE INDEX IF NOT EXISTS idx_encaissements_date_encaissement ON finance.encaissements(date_encaissement);

CREATE INDEX IF NOT EXISTS idx_budget_campagne_ferme ON finance.budget_campagne(ferme);
CREATE INDEX IF NOT EXISTS idx_budget_campagne_campagne ON finance.budget_campagne(campagne);

CREATE INDEX IF NOT EXISTS idx_fuel_transactions_ferme ON finance.fuel_transactions(ferme);
CREATE INDEX IF NOT EXISTS idx_fuel_transactions_date_transaction ON finance.fuel_transactions(date_transaction);


-- RLS Policies

DO $$ 
DECLARE 
    t TEXT;
BEGIN
    FOR t IN 
        SELECT table_name FROM information_schema.tables 
        WHERE table_schema = 'finance' AND table_type = 'BASE TABLE'
    LOOP
        EXECUTE format('ALTER TABLE finance.%I ENABLE ROW LEVEL SECURITY;', t);
        
        EXECUTE format('DROP POLICY IF EXISTS finance_full_access ON finance.%I;', t);
        EXECUTE format('
            CREATE POLICY finance_full_access ON finance.%I
            FOR ALL TO authenticated
            USING (finance.current_user_profile() IN (''finance'', ''dg'', ''admin''));
        ', t);
        
        IF t = 'invoices' THEN
            EXECUTE format('DROP POLICY IF EXISTS achats_read_invoices ON finance.%I;', t);
            EXECUTE format('
                CREATE POLICY achats_read_invoices ON finance.%I
                FOR SELECT TO authenticated
                USING (finance.current_user_profile() IN (''achats'', ''finance'', ''dg'', ''admin''));
            ', t);
            
            EXECUTE format('DROP POLICY IF EXISTS achats_submit_invoice ON finance.%I;', t);
            EXECUTE format('
                CREATE POLICY achats_submit_invoice ON finance.%I
                FOR INSERT TO authenticated
                WITH CHECK (finance.current_user_profile() IN (''achats'', ''finance'', ''dg'', ''admin''));
            ', t);
            
            EXECUTE format('DROP POLICY IF EXISTS achats_update_invoice ON finance.%I;', t);
            EXECUTE format('
                CREATE POLICY achats_update_invoice ON finance.%I
                FOR UPDATE TO authenticated
                USING (finance.current_user_profile() IN (''achats'', ''finance'', ''dg'', ''admin''));
            ', t);
        END IF;

        IF t = 'caisse_transactions' THEN
            EXECUTE format('DROP POLICY IF EXISTS rh_read_caisse ON finance.%I;', t);
            EXECUTE format('
                CREATE POLICY rh_read_caisse ON finance.%I
                FOR SELECT TO authenticated
                USING (finance.current_user_profile() IN (''rh'', ''finance'', ''dg'', ''admin''));
            ', t);
        END IF;
        
        -- Chef can read own ferme (generic check for tables having ferme)
        IF t IN ('invoices', 'caisse_transactions', 'virements', 'ojra_payroll', 'liquidations', 'encaissements', 'budget_campagne', 'fuel_transactions') THEN
            EXECUTE format('DROP POLICY IF EXISTS chef_read_own_ferme ON finance.%I;', t);
            EXECUTE format('
                CREATE POLICY chef_read_own_ferme ON finance.%I
                FOR SELECT TO authenticated
                USING (finance.current_user_profile() = ''chef'' AND ferme = current_setting(''app.user_ferme'', true));
            ', t);
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

