-- 001_schema.sql
CREATE SCHEMA IF NOT EXISTS qualite;

SET search_path = qualite, public;

CREATE OR REPLACE FUNCTION qualite.update_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION qualite.current_user_profile() RETURNS TEXT AS $$
  SELECT current_setting('app.user_profile', true);
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION qualite.current_user_role() RETURNS TEXT AS $$
  SELECT current_setting('app.user_role', true);
$$ LANGUAGE sql STABLE;

-- Tables

CREATE TABLE IF NOT EXISTS qualite.inspections (
    id SERIAL PRIMARY KEY,
    firestore_id TEXT UNIQUE,
    ferme TEXT,
    variete TEXT,
    date_inspection TIMESTAMP WITH TIME ZONE,
    inspecteur TEXT,
    defaut_type TEXT,
    defaut_pct NUMERIC,
    classification TEXT,
    lot_id TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    created_by TEXT
);
COMMENT ON TABLE qualite.inspections IS 'Inspections Qualité — migrated from Firestore';

CREATE TABLE IF NOT EXISTS qualite.expeditions (
    id SERIAL PRIMARY KEY,
    firestore_id TEXT UNIQUE,
    ferme TEXT,
    variete TEXT,
    date_expedition TIMESTAMP WITH TIME ZONE,
    type_expedition TEXT,
    poids_brut NUMERIC,
    poids_tare NUMERIC,
    poids_net NUMERIC,
    nb_colis INTEGER,
    statut TEXT,
    client TEXT,
    destination TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    created_by TEXT
);
COMMENT ON TABLE qualite.expeditions IS 'Expéditions — migrated from Firestore';

CREATE TABLE IF NOT EXISTS qualite.ecarts (
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
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    created_by TEXT
);
COMMENT ON TABLE qualite.ecarts IS 'Ecarts de volume et qualité — migrated from Firestore';

CREATE TABLE IF NOT EXISTS qualite.brix_readings (
    id SERIAL PRIMARY KEY,
    firestore_id TEXT UNIQUE,
    ferme TEXT,
    variete TEXT,
    date_lecture TIMESTAMP WITH TIME ZONE,
    brix_value NUMERIC,
    lot_id TEXT,
    conforme BOOLEAN,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    created_by TEXT
);
COMMENT ON TABLE qualite.brix_readings IS 'Lectures Brix — migrated from Firestore';

CREATE TABLE IF NOT EXISTS qualite.bons_apport (
    id SERIAL PRIMARY KEY,
    firestore_id TEXT UNIQUE,
    date_bon TIMESTAMP WITH TIME ZONE,
    ferme TEXT,
    fournisseur TEXT,
    variete TEXT,
    kg_apporte NUMERIC,
    prix_unitaire NUMERIC,
    montant NUMERIC,
    statut TEXT,
    validated_by TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    created_by TEXT
);
COMMENT ON TABLE qualite.bons_apport IS 'Bons Apport — migrated from Firestore';

CREATE TABLE IF NOT EXISTS qualite.pfq_records (
    id SERIAL PRIMARY KEY,
    firestore_id TEXT UNIQUE,
    ferme TEXT,
    semaine TEXT,
    categorie TEXT,
    valeur NUMERIC,
    seuil NUMERIC,
    conforme BOOLEAN,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    created_by TEXT
);
COMMENT ON TABLE qualite.pfq_records IS 'Records PFQ — migrated from Firestore';

CREATE TABLE IF NOT EXISTS qualite.liquidations (
    id SERIAL PRIMARY KEY,
    firestore_id TEXT UNIQUE,
    quinzaine TEXT,
    ferme TEXT,
    variete TEXT,
    kg_total NUMERIC,
    prix_kg NUMERIC,
    montant_total NUMERIC,
    type_liquidation TEXT,
    statut TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    created_by TEXT
);
COMMENT ON TABLE qualite.liquidations IS 'Liquidations — migrated from Firestore';


-- Triggers

CREATE TRIGGER set_timestamp_inspections BEFORE UPDATE ON qualite.inspections FOR EACH ROW EXECUTE FUNCTION qualite.update_updated_at();
CREATE TRIGGER set_timestamp_expeditions BEFORE UPDATE ON qualite.expeditions FOR EACH ROW EXECUTE FUNCTION qualite.update_updated_at();
CREATE TRIGGER set_timestamp_ecarts BEFORE UPDATE ON qualite.ecarts FOR EACH ROW EXECUTE FUNCTION qualite.update_updated_at();
CREATE TRIGGER set_timestamp_brix_readings BEFORE UPDATE ON qualite.brix_readings FOR EACH ROW EXECUTE FUNCTION qualite.update_updated_at();
CREATE TRIGGER set_timestamp_bons_apport BEFORE UPDATE ON qualite.bons_apport FOR EACH ROW EXECUTE FUNCTION qualite.update_updated_at();
CREATE TRIGGER set_timestamp_pfq_records BEFORE UPDATE ON qualite.pfq_records FOR EACH ROW EXECUTE FUNCTION qualite.update_updated_at();
CREATE TRIGGER set_timestamp_liquidations BEFORE UPDATE ON qualite.liquidations FOR EACH ROW EXECUTE FUNCTION qualite.update_updated_at();


-- Indexes

CREATE INDEX idx_inspections_ferme ON qualite.inspections(ferme);
CREATE INDEX idx_inspections_date ON qualite.inspections(date_inspection);
CREATE INDEX idx_expeditions_ferme ON qualite.expeditions(ferme);
CREATE INDEX idx_expeditions_date ON qualite.expeditions(date_expedition);
CREATE INDEX idx_ecarts_ferme ON qualite.ecarts(ferme);
CREATE INDEX idx_ecarts_quinzaine ON qualite.ecarts(quinzaine);
CREATE INDEX idx_brix_ferme ON qualite.brix_readings(ferme);
CREATE INDEX idx_brix_date ON qualite.brix_readings(date_lecture);
CREATE INDEX idx_bons_apport_ferme ON qualite.bons_apport(ferme);
CREATE INDEX idx_bons_apport_date ON qualite.bons_apport(date_bon);
CREATE INDEX idx_pfq_records_ferme ON qualite.pfq_records(ferme);
CREATE INDEX idx_pfq_records_semaine ON qualite.pfq_records(semaine);
CREATE INDEX idx_liquidations_ferme ON qualite.liquidations(ferme);
CREATE INDEX idx_liquidations_quinzaine ON qualite.liquidations(quinzaine);


-- Row Level Security (RLS)

ALTER TABLE qualite.inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE qualite.expeditions ENABLE ROW LEVEL SECURITY;
ALTER TABLE qualite.ecarts ENABLE ROW LEVEL SECURITY;
ALTER TABLE qualite.brix_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE qualite.bons_apport ENABLE ROW LEVEL SECURITY;
ALTER TABLE qualite.pfq_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE qualite.liquidations ENABLE ROW LEVEL SECURITY;

-- Shared Admin Policy
CREATE POLICY admin_all_inspections ON qualite.inspections FOR ALL USING (qualite.current_user_role() IN ('qualite', 'dg', 'admin'));
CREATE POLICY admin_all_expeditions ON qualite.expeditions FOR ALL USING (qualite.current_user_role() IN ('qualite', 'dg', 'admin'));
CREATE POLICY admin_all_ecarts ON qualite.ecarts FOR ALL USING (qualite.current_user_role() IN ('qualite', 'dg', 'admin'));
CREATE POLICY admin_all_brix ON qualite.brix_readings FOR ALL USING (qualite.current_user_role() IN ('qualite', 'dg', 'admin'));
CREATE POLICY admin_all_bons ON qualite.bons_apport FOR ALL USING (qualite.current_user_role() IN ('qualite', 'dg', 'admin'));
CREATE POLICY admin_all_pfq ON qualite.pfq_records FOR ALL USING (qualite.current_user_role() IN ('qualite', 'dg', 'admin'));
CREATE POLICY admin_all_liquidations ON qualite.liquidations FOR ALL USING (qualite.current_user_role() IN ('qualite', 'dg', 'admin'));

-- Chef read own ferme
CREATE POLICY chef_read_inspections ON qualite.inspections FOR SELECT USING (qualite.current_user_role() = 'chef' AND ferme = (SELECT qualite.current_user_profile()));
CREATE POLICY chef_read_expeditions ON qualite.expeditions FOR SELECT USING (qualite.current_user_role() = 'chef' AND ferme = (SELECT qualite.current_user_profile()));
CREATE POLICY chef_read_ecarts ON qualite.ecarts FOR SELECT USING (qualite.current_user_role() = 'chef' AND ferme = (SELECT qualite.current_user_profile()));
CREATE POLICY chef_read_brix ON qualite.brix_readings FOR SELECT USING (qualite.current_user_role() = 'chef' AND ferme = (SELECT qualite.current_user_profile()));
CREATE POLICY chef_read_bons ON qualite.bons_apport FOR SELECT USING (qualite.current_user_role() = 'chef' AND ferme = (SELECT qualite.current_user_profile()));
CREATE POLICY chef_read_pfq ON qualite.pfq_records FOR SELECT USING (qualite.current_user_role() = 'chef' AND ferme = (SELECT qualite.current_user_profile()));
CREATE POLICY chef_read_liquidations ON qualite.liquidations FOR SELECT USING (qualite.current_user_role() = 'chef' AND ferme = (SELECT qualite.current_user_profile()));

-- Achats read bons_apport
CREATE POLICY achats_read_bons ON qualite.bons_apport FOR SELECT USING (qualite.current_user_role() = 'achats');

