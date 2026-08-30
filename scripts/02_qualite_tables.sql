-- PART 2: QUALITÉ TABLES
CREATE TABLE IF NOT EXISTS inspections (
    id SERIAL PRIMARY KEY,
    firestore_id TEXT UNIQUE,
    ferme TEXT,
    variete TEXT,
    date_inspection TIMESTAMPTZ,
    inspecteur TEXT,
    defaut_type TEXT,
    defaut_pct NUMERIC,
    classification TEXT,
    lot_id TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_by TEXT
);

CREATE TABLE IF NOT EXISTS expeditions (
    id SERIAL PRIMARY KEY,
    firestore_id TEXT UNIQUE,
    ferme TEXT,
    variete TEXT,
    date_expedition TIMESTAMPTZ,
    type_expedition TEXT,
    poids_brut NUMERIC,
    poids_tare NUMERIC,
    poids_net NUMERIC,
    nb_colis INTEGER,
    statut TEXT,
    client TEXT,
    destination TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_by TEXT
);

CREATE TABLE IF NOT EXISTS ecarts (
    id SERIAL PRIMARY KEY,
    firestore_id TEXT UNIQUE,
    quinzaine TEXT,
    ferme TEXT,
    variete TEXT,
    kg_attendu NUMERIC,
    kg_reel NUMERIC,
    ecart_volume NUMERIC,
    ecart_pct NUMERIC,
    classification TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_by TEXT
);

CREATE TABLE IF NOT EXISTS brix_readings (
    id SERIAL PRIMARY KEY,
    firestore_id TEXT UNIQUE,
    ferme TEXT,
    variete TEXT,
    date_lecture TIMESTAMPTZ,
    brix_value NUMERIC,
    lot_id TEXT,
    conforme BOOLEAN,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_by TEXT
);

CREATE TABLE IF NOT EXISTS bons_apport (
    id SERIAL PRIMARY KEY,
    firestore_id TEXT UNIQUE,
    date_bon TIMESTAMPTZ,
    ferme TEXT,
    fournisseur TEXT,
    variete TEXT,
    kg_apporte NUMERIC,
    prix_unitaire NUMERIC,
    montant NUMERIC,
    statut TEXT,
    validated_by TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_by TEXT
);

CREATE TABLE IF NOT EXISTS pfq_records (
    id SERIAL PRIMARY KEY,
    firestore_id TEXT UNIQUE,
    ferme TEXT,
    semaine TEXT,
    categorie TEXT,
    valeur NUMERIC,
    seuil NUMERIC,
    conforme BOOLEAN,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_by TEXT
);
