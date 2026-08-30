-- PART 1: FINANCE TABLES
CREATE OR REPLACE FUNCTION update_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TABLE IF NOT EXISTS invoices (
    id SERIAL PRIMARY KEY,
    firestore_id TEXT UNIQUE,
    numero_facture TEXT,
    fournisseur TEXT,
    montant NUMERIC,
    tva NUMERIC,
    montant_ttc NUMERIC,
    payment_status TEXT,
    ferme TEXT,
    date_facture TIMESTAMPTZ,
    date_validation_achats TIMESTAMPTZ,
    date_validation_finance TIMESTAMPTZ,
    date_validation_dg TIMESTAMPTZ,
    validated_by_achats TEXT,
    validated_by_finance TEXT,
    validated_by_dg TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_by TEXT
);

CREATE TABLE IF NOT EXISTS caisse_transactions (
    id SERIAL PRIMARY KEY,
    firestore_id TEXT UNIQUE,
    type TEXT,
    montant NUMERIC,
    description TEXT,
    date TIMESTAMPTZ,
    ferme TEXT,
    categorie TEXT,
    justificatif_url TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_by TEXT
);

CREATE TABLE IF NOT EXISTS virements (
    id SERIAL PRIMARY KEY,
    firestore_id TEXT UNIQUE,
    bdc_id TEXT,
    montant NUMERIC,
    banque TEXT,
    reference TEXT,
    status TEXT,
    date_virement TIMESTAMPTZ,
    ferme TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_by TEXT
);

CREATE TABLE IF NOT EXISTS ojra_payroll (
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
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_by TEXT
);

CREATE TABLE IF NOT EXISTS liquidations (
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
    date_liquidation TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_by TEXT
);

CREATE TABLE IF NOT EXISTS encaissements (
    id SERIAL PRIMARY KEY,
    firestore_id TEXT UNIQUE,
    compte_client_id TEXT,
    montant NUMERIC,
    mode_paiement TEXT,
    date_encaissement TIMESTAMPTZ,
    reference TEXT,
    ferme TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_by TEXT
);

CREATE TABLE IF NOT EXISTS comptes_clients (
    id SERIAL PRIMARY KEY,
    firestore_id TEXT UNIQUE,
    nom TEXT,
    telephone TEXT,
    adresse TEXT,
    solde_initial NUMERIC,
    type TEXT,
    actif BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_by TEXT
);

CREATE TABLE IF NOT EXISTS codes_analytiques (
    id SERIAL PRIMARY KEY,
    code TEXT UNIQUE,
    libelle TEXT,
    domaine TEXT,
    ferme TEXT,
    actif BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_by TEXT
);

CREATE TABLE IF NOT EXISTS budget_campagne (
    id SERIAL PRIMARY KEY,
    firestore_id TEXT UNIQUE,
    campagne TEXT,
    ferme TEXT,
    categorie TEXT,
    sous_categorie TEXT,
    montant_budget NUMERIC,
    montant_reel NUMERIC,
    quinzaine TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_by TEXT
);

CREATE TABLE IF NOT EXISTS fuel_transactions (
    id SERIAL PRIMARY KEY,
    firestore_id TEXT UNIQUE,
    date_transaction TIMESTAMPTZ,
    vehicule TEXT,
    conducteur TEXT,
    litres NUMERIC,
    prix_litre NUMERIC,
    montant NUMERIC,
    ferme TEXT,
    odometer NUMERIC,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_by TEXT
);

CREATE TABLE IF NOT EXISTS telecom_bills (
    id SERIAL PRIMARY KEY,
    firestore_id TEXT UNIQUE,
    operateur TEXT,
    mois TEXT,
    numero TEXT,
    montant_ht NUMERIC,
    montant_ttc NUMERIC,
    type TEXT,
    statut_paiement TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_by TEXT
);
