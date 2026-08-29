/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: agronomie | Déclaration(s): AgroCompositionTab */
import { useState } from '../shared/reactHooks.jsx';

function AgroCompositionTab({ data }) {
            const [filter, setFilter] = useState('all');
            const [search, setSearch] = useState('');

            // ===== CATALOGUE COMPLET TIMAC AGRO (source: Catalogue officiel) =====
            // Colonnes: N, P2O5, K2O, SO3, CaO, MgO, B, Cu, Fe, Mn, Mo, Zn, CO, MO%
            const catalogue = [
                // ─── 1. ENGRAIS SOLIDES — SUPER SPE ───
                { name:"BIOACTYL SUPERBE",  gamme:"Super SPE",   forme:"Granulé", spec:"Bioactyl",  N:8,  P:22, K:10, SO3:3,  CaO:0,  MgO:0.2, B:0,   Cu:0,    Fe:0,   Mn:0,   Mo:0,    Zn:0,   CO:0,  MO:0,  notes:"" },
                { name:"EUROFERTIL PK",     gamme:"Super SPE",   forme:"Granulé", spec:"—",         N:0,  P:12, K:24, SO3:14, CaO:20, MgO:0,   B:0,   Cu:0,    Fe:0,   Mn:0,   Mo:0,    Zn:0,   CO:0,  MO:0,  notes:"" },
                { name:"HUMIFERTIL",        gamme:"Super SPE",   forme:"Poudre",  spec:"Humi",      N:7,  P:14, K:20, SO3:15, CaO:0,  MgO:0,   B:0,   Cu:0,    Fe:0,   Mn:0,   Mo:0,    Zn:0,   CO:0,  MO:0,  notes:"B, Zn: Traces" },
                // ─── 1. ENGRAIS SOLIDES — D-CODER ───
                { name:"D-CODER 32",        gamme:"D-Coder",     forme:"Granulé", spec:"MPPA Duo",  N:8,  P:32, K:12, SO3:0,  CaO:0,  MgO:0,   B:0,   Cu:0,    Fe:0,   Mn:0,   Mo:0,    Zn:0,   CO:0,  MO:0,  notes:"SO3: Traces" },
                { name:"D-CODER K20",       gamme:"D-Coder",     forme:"Granulé", spec:"MPPA Duo",  N:6,  P:30, K:20, SO3:0,  CaO:0,  MgO:0,   B:0,   Cu:0,    Fe:0,   Mn:0,   Mo:0,    Zn:0,   CO:0,  MO:0,  notes:"B, Zn: Traces" },
                { name:"D-CODER EXTRA",     gamme:"D-Coder",     forme:"Granulé", spec:"MPPA Duo",  N:14, P:35, K:10, SO3:0,  CaO:0,  MgO:0,   B:0,   Cu:0,    Fe:0,   Mn:0,   Mo:0,    Zn:0,   CO:0,  MO:0,  notes:"SO3: Traces" },
                { name:"D-CODER K-UP",      gamme:"D-Coder",     forme:"Granulé", spec:"MPPA Duo",  N:9,  P:23, K:30, SO3:0,  CaO:0,  MgO:0,   B:0,   Cu:0,    Fe:0,   Mn:0,   Mo:0,    Zn:0,   CO:0,  MO:0,  notes:"SO3, B: Traces" },
                { name:"D-CODER MASTER",    gamme:"D-Coder",     forme:"Granulé", spec:"MPPA Duo",  N:10, P:20, K:25, SO3:0,  CaO:0,  MgO:0,   B:0,   Cu:0,    Fe:0,   Mn:0,   Mo:0,    Zn:0,   CO:0,  MO:0,  notes:"SO3, Mn, Zn: Traces" },
                { name:"D-CODER MAGNUM",    gamme:"D-Coder",     forme:"Granulé", spec:"MPPA Duo",  N:3,  P:33, K:5,  SO3:0,  CaO:0,  MgO:0,   B:0,   Cu:0,    Fe:0,   Mn:0,   Mo:0,    Zn:0,   CO:0,  MO:0,  notes:"SO3: Traces" },
                // ─── 1. ENGRAIS SOLIDES — AZO-PRO ───
                { name:"AZO-PRO 31",        gamme:"Azo-Pro",     forme:"Poudre",  spec:"N-Pro",     N:31, P:4,  K:0,  SO3:29, CaO:0,  MgO:0,   B:0,   Cu:0,    Fe:0,   Mn:0,   Mo:0,    Zn:0,   CO:0,  MO:0,  notes:"" },
                { name:"AZO-PRO NP",        gamme:"Azo-Pro",     forme:"Poudre",  spec:"N-Pro",     N:20, P:10, K:0,  SO3:30, CaO:0,  MgO:0,   B:0,   Cu:0,    Fe:0,   Mn:0,   Mo:0,    Zn:0,   CO:0,  MO:0,  notes:"" },
                { name:"AZO-PRO NK",        gamme:"Azo-Pro",     forme:"Poudre",  spec:"N-Pro",     N:12, P:0,  K:22, SO3:30, CaO:0,  MgO:0,   B:0,   Cu:0,    Fe:0,   Mn:0,   Mo:0,    Zn:0,   CO:0,  MO:0,  notes:"" },
                // ─── 2. ORGANO-MINÉRAUX ───
                { name:"CO-ACTYL-H",        gamme:"Organo-Min.", forme:"Poudre",  spec:"COA",       N:0,  P:0,  K:0,  SO3:0,  CaO:0,  MgO:0,   B:0,   Cu:0,    Fe:0,   Mn:0,   Mo:0,    Zn:0,   CO:35, MO:0,  notes:"Norg=2, P2O5=3, AH=9, AF=51" },
                { name:"CO-ACTYL-NP",       gamme:"Organo-Min.", forme:"Poudre",  spec:"COA",       N:5,  P:7,  K:0,  SO3:0,  CaO:0,  MgO:0,   B:0,   Cu:0,    Fe:0,   Mn:0,   Mo:0,    Zn:0,   CO:14.5,MO:25, notes:"AH=2.5%" },
                { name:"ORGAPHOS",          gamme:"Organo-Min.", forme:"Poudre",  spec:"ATB",       N:6,  P:20, K:0,  SO3:14, CaO:0,  MgO:0,   B:0,   Cu:0,    Fe:0,   Mn:0,   Mo:0,    Zn:0,   CO:0,  MO:15, notes:"B, Cu: Traces" },
                // ─── 3. AMENDEMENTS ORGANIQUES ───
                { name:"HUMOCAL",           gamme:"Amendements",  forme:"Poudre", spec:"ATB",       N:0,  P:0,  K:0,  SO3:0,  CaO:0,  MgO:0,   B:0,   Cu:0,    Fe:0,   Mn:0,   Mo:0,    Zn:0,   CO:0,  MO:40, notes:"100% végétal" },
                { name:"HUMISOL",           gamme:"Amendements",  forme:"Poudre", spec:"ATB",       N:0,  P:0,  K:0,  SO3:0,  CaO:0,  MgO:0,   B:0,   Cu:0,    Fe:0,   Mn:0,   Mo:0,    Zn:0,   CO:0,  MO:45, notes:"100% végétal" },
                // ─── 4. FERTIGATION — KSC (Phytactyl) ───
                { name:"KSC I",             gamme:"KSC",         forme:"Poudre cristalline", spec:"Phytactyl", N:14, P:40, K:5,  SO3:13, CaO:0,  MgO:0,   B:0.1, Cu:0.1,  Fe:0.1, Mn:0.05,Mo:0.01, Zn:0.1, CO:0, MO:0, notes:"Enracinement et pré-floraison" },
                { name:"KSC II",            gamme:"KSC",         forme:"Poudre cristalline", spec:"Phytactyl", N:23, P:5,  K:5,  SO3:29, CaO:0,  MgO:0,   B:0,   Cu:0,    Fe:0.1, Mn:0,   Mo:0.05, Zn:0.1, CO:0, MO:0, notes:"Croissance végétative" },
                { name:"KSC III",           gamme:"KSC",         forme:"Poudre cristalline", spec:"Phytactyl", N:15, P:5,  K:35, SO3:0,  CaO:0,  MgO:0,   B:0.1, Cu:0.1,  Fe:0,   Mn:0,   Mo:0.01, Zn:0,   CO:0, MO:0, notes:"Développement + fructification" },
                { name:"KSC IV",            gamme:"KSC",         forme:"Poudre cristalline", spec:"Phytactyl", N:0,  P:32, K:40, SO3:0,  CaO:0,  MgO:0,   B:0,   Cu:0,    Fe:0,   Mn:0,   Mo:0,    Zn:0,   CO:0, MO:0, notes:"Nouaison et développement fruits" },
                { name:"KSC V",             gamme:"KSC",         forme:"Poudre cristalline", spec:"Phytactyl", N:8,  P:16, K:42, SO3:0,  CaO:0,  MgO:0,   B:0.1, Cu:0.1,  Fe:0,   Mn:0.05,Mo:0,    Zn:0.1, CO:0, MO:0, notes:"Grossissement et maturation" },
                { name:"KSC VI",            gamme:"KSC",         forme:"Poudre cristalline", spec:"Phytactyl", N:14, P:12, K:14, SO3:14, CaO:0,  MgO:0,   B:0.1, Cu:0.1,  Fe:0.1, Mn:0.1, Mo:0,    Zn:0.1, CO:0, MO:0, notes:"Développement équilibré" },
                { name:"KSC VII PERLA",     gamme:"KSC",         forme:"Poudre cristalline", spec:"Phytactyl", N:15, P:0,  K:9,  SO3:0,  CaO:20, MgO:0,   B:0,   Cu:0,    Fe:0,   Mn:0,   Mo:0,    Zn:0,   CO:0, MO:0, notes:"Grossissement et qualité fruits" },
                // ─── 4. FERTIGATION — TIMASOL (Soluactiv) ───
                { name:"TIMASOL I",         gamme:"Timasol",     forme:"Poudre cristalline", spec:"Soluactiv", N:12, P:35, K:5,  SO3:0,  CaO:0,  MgO:0,   B:0,   Cu:0,    Fe:0,   Mn:0,   Mo:0,    Zn:0,   CO:0, MO:0, notes:"OE: Traces" },
                { name:"TIMASOL II",        gamme:"Timasol",     forme:"Poudre cristalline", spec:"Soluactiv", N:20, P:20, K:20, SO3:0,  CaO:0,  MgO:0,   B:0,   Cu:0,    Fe:0,   Mn:0,   Mo:0,    Zn:0,   CO:0, MO:0, notes:"OE: Traces" },
                { name:"TIMASOL III",       gamme:"Timasol",     forme:"Poudre cristalline", spec:"Soluactiv", N:15, P:15, K:30, SO3:0,  CaO:0,  MgO:0,   B:0,   Cu:0,    Fe:0,   Mn:0,   Mo:0,    Zn:0,   CO:0, MO:0, notes:"OE: Traces" },
                { name:"TIMASOL IV",        gamme:"Timasol",     forme:"Poudre cristalline", spec:"Soluactiv", N:10, P:5,  K:40, SO3:0,  CaO:0,  MgO:0,   B:0,   Cu:0,    Fe:0,   Mn:0,   Mo:0,    Zn:0,   CO:0, MO:0, notes:"OE: Traces" },
                { name:"TIMASOL PHOSCAL",   gamme:"Timasol",     forme:"Poudre cristalline", spec:"Soluactiv", N:10, P:0,  K:0,  SO3:0,  CaO:10, MgO:0,   B:0,   Cu:0,    Fe:0,   Mn:0,   Mo:0,    Zn:0,   CO:0, MO:0, notes:"OE" },
                // ─── 4. FERTIGATION — CORRECTEURS DE CARENCE ───
                { name:"TIMASOL MIX",       gamme:"Correcteurs", forme:"Poudre",  spec:"Soluactiv", N:0,  P:0,  K:0,  SO3:0,  CaO:0,  MgO:0,   B:0,   Cu:0.8,  Fe:3,   Mn:9,   Mo:0.3,  Zn:5,   CO:0, MO:0, notes:"Correcteur micro-éléments" },
                { name:"KSC MIX",           gamme:"Correcteurs", forme:"Poudre",  spec:"Phytactyl", N:0,  P:0,  K:0,  SO3:28, CaO:0,  MgO:15,  B:0.5, Cu:0.5,  Fe:2.5, Mn:1.5, Mo:0.2,  Zn:2,   CO:0, MO:0, notes:"Correcteur micro-éléments" },
                // ─── 4. FERTIGATION — CORRECTEUR pH / NPK LIQUIDES ───
                { name:"SULFACID LCN",      gamme:"NPK Liquides",forme:"Liquide", spec:"LCN",       N:15, P:0,  K:0,  SO3:41, CaO:0,  MgO:0,   B:0,   Cu:0,    Fe:0,   Mn:0,   Mo:0,    Zn:0,   CO:0, MO:0, notes:"pH<2, DCD=4.5%" },
                { name:"EXCELIS I",         gamme:"NPK Liquides",forme:"Liquide", spec:"Rhizovit",  N:3,  P:10, K:5,  SO3:0,  CaO:0,  MgO:0,   B:0,   Cu:0,    Fe:0,   Mn:0,   Mo:0,    Zn:0,   CO:0, MO:0, notes:"" },
                { name:"EXCELIS II",        gamme:"NPK Liquides",forme:"Liquide", spec:"Rhizovit",  N:8,  P:8,  K:8,  SO3:0,  CaO:0,  MgO:0,   B:0,   Cu:0,    Fe:0,   Mn:0,   Mo:0,    Zn:0,   CO:0, MO:0, notes:"" },
                { name:"EXCELIS III",       gamme:"NPK Liquides",forme:"Liquide", spec:"Rhizovit",  N:3,  P:2,  K:10, SO3:0,  CaO:0,  MgO:0,   B:0,   Cu:0,    Fe:0,   Mn:0,   Mo:0,    Zn:0,   CO:0, MO:0, notes:"" },
                { name:"EXCELIS N",         gamme:"NPK Liquides",forme:"Liquide", spec:"Rhizovit",  N:30, P:0,  K:0,  SO3:0,  CaO:0,  MgO:0,   B:0,   Cu:0,    Fe:0,   Mn:0,   Mo:0,    Zn:0,   CO:0, MO:0, notes:"" },
                // ─── 5. BIOSTIMULANTS FOLIAIRES — SEACTIV ───
                { name:"SEACTIV GOLD BMo",  gamme:"Biostim. Fol.",forme:"Liquide",spec:"Seactiv",   N:0,  P:0,  K:0,  SO3:0,  CaO:0,  MgO:0,   B:5.7, Cu:0,    Fe:0,   Mn:0,   Mo:0.35, Zn:0,   CO:7, MO:0, notes:"" },
                { name:"SEACTIV OPAL MnZn", gamme:"Biostim. Fol.",forme:"Liquide",spec:"Seactiv",   N:0,  P:0,  K:0,  SO3:0,  CaO:0,  MgO:0,   B:0,   Cu:0,    Fe:0,   Mn:4.8, Mo:0,    Zn:3.5, CO:1, MO:0, notes:"" },
                { name:"SEACTIV VITAL",     gamme:"Biostim. Fol.",forme:"Liquide",spec:"Seactiv",   N:9,  P:5,  K:4,  SO3:0,  CaO:0,  MgO:0,   B:0.05,Cu:0.02, Fe:0.02,Mn:0.1, Mo:0.01, Zn:0.05,CO:4, MO:0, notes:"" },
                { name:"SEACTIV KALEO",     gamme:"Biostim. Fol.",forme:"Liquide",spec:"Seactiv",   N:4,  P:6,  K:9,  SO3:0,  CaO:0,  MgO:0,   B:0.05,Cu:0.02, Fe:0.02,Mn:0.1, Mo:0.01, Zn:0.05,CO:7, MO:0, notes:"" },
                { name:"SEACTIV ALPHA",     gamme:"Biostim. Fol.",forme:"Liquide",spec:"Seactiv",   N:5,  P:13, K:0,  SO3:0,  CaO:0,  MgO:0,   B:2,   Cu:0,    Fe:0,   Mn:0,   Mo:0,    Zn:0,   CO:2, MO:0, notes:"" },
                { name:"SEACTIV ORIS PZn",  gamme:"Biostim. Fol.",forme:"Liquide",spec:"Seactiv",   N:3,  P:15, K:0,  SO3:0,  CaO:0,  MgO:0,   B:0,   Cu:0,    Fe:0,   Mn:0,   Mo:0,    Zn:4.8, CO:2, MO:0, notes:"" },
                { name:"SEACTIV MAGICAL",   gamme:"Biostim. Fol.",forme:"Liquide",spec:"Seactiv",   N:0,  P:0,  K:0,  SO3:0,  CaO:12, MgO:4,   B:0,   Cu:0,    Fe:0,   Mn:0,   Mo:0,    Zn:0,   CO:1, MO:0, notes:"" },
                { name:"SEACTIV ELITE",     gamme:"Biostim. Fol.",forme:"Liquide",spec:"Seactiv",   N:9,  P:6,  K:12, SO3:0,  CaO:0,  MgO:0,   B:0,   Cu:0.1,  Fe:0,   Mn:0,   Mo:0,    Zn:0,   CO:1, MO:0, notes:"" },
                { name:"SEACTIV AZUR Ca",   gamme:"Biostim. Fol.",forme:"Liquide",spec:"Seactiv",   N:0,  P:0,  K:0,  SO3:0,  CaO:15, MgO:0,   B:0,   Cu:0,    Fe:0,   Mn:0,   Mo:0,    Zn:0,   CO:2, MO:0, notes:"" },
                { name:"SEACTIV VERTIS",    gamme:"Biostim. Fol.",forme:"Liquide",spec:"Seactiv",   N:0,  P:0,  K:0,  SO3:0,  CaO:0,  MgO:8.9, B:0,   Cu:0,    Fe:0,   Mn:3.2, Mo:0,    Zn:2.4, CO:9, MO:0, notes:"" },
                { name:"SEACTIV SILVER BORE",gamme:"Biostim. Fol.",forme:"Liquide",spec:"Seactiv",  N:0,  P:0,  K:0,  SO3:0,  CaO:0,  MgO:0,   B:6.5, Cu:0,    Fe:0,   Mn:0,   Mo:0,    Zn:0,   CO:8, MO:0, notes:"" },
                { name:"MAXI FRUIT",        gamme:"Biostim. Fol.",forme:"Liquide",spec:"NMX",       N:3,  P:7,  K:7,  SO3:0,  CaO:0,  MgO:0,   B:0,   Cu:0,    Fe:0,   Mn:0.05,Mo:0,    Zn:0.1, CO:8, MO:0, notes:"" },
                // ─── 5. BIOSTIMULANTS RACINAIRES ───
                { name:"ECOVIGOR AA",       gamme:"Biostim. Rac.",forme:"Liquide",spec:"—",         N:0,  P:0,  K:0,  SO3:0,  CaO:0,  MgO:0,   B:0,   Cu:0,    Fe:0,   Mn:0,   Mo:0,    Zn:0,   CO:0, MO:15, notes:"Norg=3%, K2O=7%" },
                { name:"FERTIACTYL GZ",     gamme:"Biostim. Rac.",forme:"Liquide",spec:"Fertiactyl",N:13, P:0,  K:5,  SO3:0,  CaO:0,  MgO:0,   B:0,   Cu:0,    Fe:0,   Mn:0,   Mo:0,    Zn:0,   CO:0, MO:0, notes:"EHT=15" },
                { name:"FERTIACTYL STARTER",gamme:"Biostim. Rac.",forme:"Liquide",spec:"Fertiactyl",N:13, P:5,  K:8,  SO3:0,  CaO:0,  MgO:0,   B:0,   Cu:0,    Fe:0,   Mn:0,   Mo:0,    Zn:0,   CO:0, MO:0, notes:"EHT=5" },
                { name:"FERTIACTYL GREEN EXTREME",gamme:"Biostim. Rac.",forme:"Poudre",spec:"Fertiactyl",N:0,P:0,K:0,SO3:0,CaO:0,MgO:0, B:0,Cu:0,Fe:6,Mn:0,Mo:0,Zn:0, CO:6,MO:0, notes:"Fe chélaté EDDHA" },
                { name:"RECORD",            gamme:"Biostim. Rac.",forme:"Liquide",spec:"Fertiactyl",N:0,  P:0,  K:30, SO3:30, CaO:0,  MgO:0,   B:0,   Cu:0,    Fe:0,   Mn:0,   Mo:0,    Zn:0,   CO:0, MO:0, notes:"" },
                // ─── 6. RHIZO AMINES ───
                { name:"RHIZO-AMINE",       gamme:"Rhizo",       forme:"Liquide", spec:"—",         N:0,  P:0,  K:0,  SO3:0,  CaO:0,  MgO:0,   B:0,   Cu:0,    Fe:0,   Mn:0,   Mo:0,    Zn:0,   CO:11,MO:0, notes:"Norg=7%" },
                { name:"RHIZO-CAL",         gamme:"Rhizo",       forme:"Liquide", spec:"—",         N:8.5,P:0,  K:0,  SO3:0,  CaO:9.8,MgO:0,   B:0,   Cu:0,    Fe:0,   Mn:0,   Mo:0,    Zn:0,   CO:4.2,MO:0,notes:"" },
                { name:"RHIZO-HUMUS",       gamme:"Rhizo",       forme:"Liquide", spec:"—",         N:0,  P:0,  K:0,  SO3:0,  CaO:0,  MgO:0,   B:0,   Cu:0,    Fe:0,   Mn:0,   Mo:0,    Zn:0,   CO:0, MO:0, notes:"AH=11%, K2O=3%" },
                { name:"HUMI-PHOS",         gamme:"Rhizo",       forme:"Liquide", spec:"—",         N:0,  P:0,  K:0,  SO3:0,  CaO:0,  MgO:0,   B:0,   Cu:0,    Fe:0,   Mn:0,   Mo:0,    Zn:0,   CO:6, MO:0, notes:"AH=9%, P2O5=15%" },
                { name:"RHIZO-CU",          gamme:"Rhizo+",      forme:"Poudre",  spec:"—",         N:0,  P:0,  K:5,  SO3:0,  CaO:0,  MgO:0,   B:0,   Cu:14,   Fe:0,   Mn:0,   Mo:0,    Zn:0,   CO:0, MO:0, notes:"" },
                { name:"RHIZO MN-ZN",       gamme:"Rhizo+",      forme:"Poudre",  spec:"—",         N:10, P:0,  K:0,  SO3:0,  CaO:0,  MgO:0,   B:2,   Cu:0,    Fe:0,   Mn:4,   Mo:0,    Zn:4,   CO:4, MO:0, notes:"" },
                { name:"RHIZO BORE",        gamme:"Rhizo+",      forme:"Poudre",  spec:"—",         N:5,  P:0,  K:19, SO3:0,  CaO:3,  MgO:0,   B:8,   Cu:0,    Fe:0,   Mn:0,   Mo:0,    Zn:0,   CO:0, MO:0, notes:"AH=3%" },
                // ─── 7. TIMACTIV FOLIAIRES ───
                { name:"FLORIS",            gamme:"Timactiv",    forme:"Liquide", spec:"—",         N:2,  P:0,  K:0,  SO3:0,  CaO:0,  MgO:0,   B:7,   Cu:0,    Fe:0,   Mn:0,   Mo:0,    Zn:7,   CO:3, MO:0, notes:"" },
                { name:"TIMFOLIUP",         gamme:"Timactiv",    forme:"Liquide", spec:"—",         N:0,  P:0,  K:0,  SO3:0,  CaO:0,  MgO:35,  B:0,   Cu:0,    Fe:0,   Mn:0,   Mo:0,    Zn:0,   CO:0, MO:0, notes:"52% mat. sèche" },
                { name:"KOLATIM",           gamme:"Timactiv",    forme:"Liquide", spec:"—",         N:0,  P:0,  K:0,  SO3:7,  CaO:0,  MgO:7,   B:0,   Cu:0,    Fe:0,   Mn:0,   Mo:0,    Zn:0,   CO:0, MO:0, notes:"pH=6.3" },
                { name:"KALIS",             gamme:"Timactiv",    forme:"Liquide", spec:"—",         N:5,  P:0,  K:27, SO3:0,  CaO:0,  MgO:3,   B:0,   Cu:0,    Fe:0,   Mn:0,   Mo:0,    Zn:0,   CO:6, MO:0, notes:"" },
                // ─── Matières actives Berry Good (hors TIMAC) ───
                { name:"Ammonitrate",       gamme:"Berry Good",  forme:"Granulé", spec:"—",         N:33.5,P:0, K:0,  SO3:0,  CaO:0,  MgO:0,   B:0,   Cu:0,    Fe:0,   Mn:0,   Mo:0,    Zn:0,   CO:0, MO:0, notes:"" },
                { name:"Nitrate de Calcium",gamme:"Berry Good",  forme:"Soluble", spec:"—",         N:15.5,P:0, K:0,  SO3:0,  CaO:26, MgO:0,   B:0,   Cu:0,    Fe:0,   Mn:0,   Mo:0,    Zn:0,   CO:0, MO:0, notes:"" },
                { name:"Nitrate de Potasse",gamme:"Berry Good",  forme:"Soluble", spec:"—",         N:13, P:0,  K:46, SO3:0,  CaO:0,  MgO:0,   B:0,   Cu:0,    Fe:0,   Mn:0,   Mo:0,    Zn:0,   CO:0, MO:0, notes:"" },
                { name:"Nitrate de Magnesie",gamme:"Berry Good", forme:"Soluble", spec:"—",         N:11, P:0,  K:0,  SO3:0,  CaO:0,  MgO:16,  B:0,   Cu:0,    Fe:0,   Mn:0,   Mo:0,    Zn:0,   CO:0, MO:0, notes:"" },
                { name:"Acide Phosphorique",gamme:"Berry Good",  forme:"Liquide", spec:"—",         N:0,  P:54, K:0,  SO3:0,  CaO:0,  MgO:0,   B:0,   Cu:0,    Fe:0,   Mn:0,   Mo:0,    Zn:0,   CO:0, MO:0, notes:"" },
                { name:"Acide Nitrique",    gamme:"Berry Good",  forme:"Liquide", spec:"—",         N:13, P:0,  K:0,  SO3:0,  CaO:0,  MgO:0,   B:0,   Cu:0,    Fe:0,   Mn:0,   Mo:0,    Zn:0,   CO:0, MO:0, notes:"" },
                { name:"Sulfate de Magnesie",gamme:"Berry Good", forme:"Soluble", spec:"—",         N:0,  P:0,  K:0,  SO3:13, CaO:0,  MgO:16,  B:0,   Cu:0,    Fe:0,   Mn:0,   Mo:0,    Zn:0,   CO:0, MO:0, notes:"" },
                { name:"MAP",               gamme:"Berry Good",  forme:"Soluble", spec:"—",         N:12, P:61, K:0,  SO3:0,  CaO:0,  MgO:0,   B:0,   Cu:0,    Fe:0,   Mn:0,   Mo:0,    Zn:0,   CO:0, MO:0, notes:"" },
                { name:"Solupotasse",       gamme:"Berry Good",  forme:"Soluble", spec:"—",         N:0,  P:0,  K:50, SO3:0,  CaO:0,  MgO:0,   B:0,   Cu:0,    Fe:0,   Mn:0,   Mo:0,    Zn:0,   CO:0, MO:0, notes:"" },
                { name:"BIO ACTYL",         gamme:"Berry Good",  forme:"Liquide", spec:"—",         N:3,  P:0,  K:5,  SO3:0,  CaO:0,  MgO:0,   B:0,   Cu:0,    Fe:0,   Mn:0,   Mo:0,    Zn:0,   CO:0, MO:0, notes:"Biostimulant" },
            ];

            const gammes = [...new Set(catalogue.map(c => c.gamme))];
            const macros = ['N','P','K','SO3','CaO','MgO'];
            const micros = ['B','Cu','Fe','Mn','Mo','Zn'];
            const extras = ['CO','MO'];
            const macroColors = { N:'#2E86C1', P:'#E74C3C', K:'#F39C12', SO3:'#E67E22', CaO:'#8E44AD', MgO:'#1ABC9C' };
            const microColors = { B:'#795548', Cu:'#D81B60', Fe:'#5D4037', Mn:'#6A1B9A', Mo:'#00695C', Zn:'#37474F' };
            const gammeColors = { 'KSC':'#F57F17', 'Timasol':'#1565C0', 'D-Coder':'#4CAF50', 'Azo-Pro':'#FF5722', 'Super SPE':'#795548', 'NPK Liquides':'#00ACC1', 'Correcteurs':'#E91E63', 'Berry Good':'#2D8B4E', 'Biostim. Fol.':'#9C27B0', 'Biostim. Rac.':'#7B1FA2', 'Rhizo':'#3E2723', 'Rhizo+':'#4E342E', 'Timactiv':'#FF6F00', 'Organo-Min.':'#827717', 'Amendements':'#6D4C41' };

            const filtered = catalogue.filter(c => {
                if (filter !== 'all' && c.gamme !== filter) return false;
                if (search && !c.name.toLowerCase().includes(search.toLowerCase())) return false;
                return true;
            });

            const cellSt = (val, color) => ({
                padding:'4px 5px', fontSize:11, textAlign:'center', borderBottom:'1px solid #eee',
                fontWeight: val > 0 ? 700 : 400, color: val > 0 ? color : '#ddd',
            });

            return (
                <div className="fade-in">
                    {/* Header */}
                    <div style={{display:'flex',gap:12,marginBottom:16,flexWrap:'wrap',alignItems:'center'}}>
                        <h3 style={{margin:0,fontSize:16}}><i className="fa-solid fa-flask-vial" style={{color:'var(--green)',marginRight:8}}></i>Catalogue TIMAC AGRO — Compositions</h3>
                        <span style={{background:'#E8F5E9',color:'#2D8B4E',padding:'3px 10px',borderRadius:12,fontSize:11,fontWeight:700}}>{catalogue.length} produits</span>
                    </div>

                    {/* Filtres */}
                    <div className="chip-group" style={{marginBottom:12}}>
                        <span className="chip-group-label">Gamme:</span>
                        <button className={`chip c-green ${filter==='all' ? 'active' : ''}`} onClick={() => setFilter('all')}>Tous <span className="chip-count">{catalogue.length}</span></button>
                        {gammes.map(g => {
                            const cnt = catalogue.filter(c => c.gamme === g).length;
                            return <button key={g} className={`chip c-green ${filter===g ? 'active' : ''}`} onClick={() => setFilter(g)}>{g} <span className="chip-count">{cnt}</span></button>;
                        })}
                    </div>
                    <div style={{marginBottom:16}}>
                        <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher un produit..." style={{padding:'8px 14px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:12,width:'100%',maxWidth:300}} />
                    </div>

                    {/* KPI */}
                    <div style={{display:'flex',gap:12,marginBottom:16,flexWrap:'wrap'}}>
                        <div className="kpi-card" style={{borderLeftColor:'#F57F17'}}><div className="kpi-value">{catalogue.filter(c=>c.gamme==='KSC').length}</div><div className="kpi-label">Gamme KSC</div><div className="kpi-sub">Fertigation Phytactyl</div></div>
                        <div className="kpi-card" style={{borderLeftColor:'#1565C0'}}><div className="kpi-value">{catalogue.filter(c=>c.gamme==='Timasol').length}</div><div className="kpi-label">Gamme Timasol</div><div className="kpi-sub">Fertigation Soluactiv</div></div>
                        <div className="kpi-card" style={{borderLeftColor:'#9C27B0'}}><div className="kpi-value">{catalogue.filter(c=>c.gamme.startsWith('Biostim')).length}</div><div className="kpi-label">Biostimulants</div><div className="kpi-sub">Foliaires + Racinaires</div></div>
                        <div className="kpi-card" style={{borderLeftColor:'#2D8B4E'}}><div className="kpi-value">{catalogue.filter(c=>c.gamme==='Berry Good').length}</div><div className="kpi-label">Berry Good</div><div className="kpi-sub">Matières actives</div></div>
                    </div>

                    {/* Tableau principal */}
                    <div className="panel">
                        <h3><i className="fa-solid fa-table" style={{color:'#1565C0'}}></i> Composition détaillée — {filtered.length} produits</h3>
                        <div className="table-responsive"><table style={{fontSize:11,borderCollapse:'collapse'}}>
                            <thead>
                                <tr>
                                    <th style={{minWidth:160,background:'#1a237e',color:'#fff',padding:'6px 8px',position:'sticky',left:0,zIndex:2}}>Produit</th>
                                    <th style={{background:'#1a237e',color:'#fff',padding:'6px',fontSize:10}}>Gamme</th>
                                    <th style={{background:'#1a237e',color:'#fff',padding:'6px',fontSize:10}}>Forme</th>
                                    {macros.map(m => <th key={m} style={{background:macroColors[m],color:'#fff',padding:'5px 4px',textAlign:'center',fontSize:10,fontWeight:800,minWidth:38}}>{m==='P'?'P₂O₅':m==='K'?'K₂O':m==='SO3'?'SO₃':m}</th>)}
                                    {micros.map(m => <th key={m} style={{background:microColors[m],color:'#fff',padding:'5px 4px',textAlign:'center',fontSize:10,fontWeight:700,minWidth:32}}>{m}</th>)}
                                    <th style={{background:'#33691E',color:'#fff',padding:'5px 4px',textAlign:'center',fontSize:10,minWidth:32}}>C.O</th>
                                    <th style={{background:'#4E342E',color:'#fff',padding:'5px 4px',textAlign:'center',fontSize:10,minWidth:32}}>M.O%</th>
                                    <th style={{background:'#1a237e',color:'#fff',padding:'6px',fontSize:10,minWidth:120}}>Notes</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map((c,i) => {
                                    const col = gammeColors[c.gamme] || '#666';
                                    return (
                                        <tr key={i} style={{background: i%2===0?'#fff':'#fafafa'}}>
                                            <td style={{padding:'5px 8px',fontWeight:700,borderBottom:'1px solid #eee',position:'sticky',left:0,background: i%2===0?'#fff':'#fafafa',zIndex:1}}>
                                                {c.name}
                                            </td>
                                            <td style={{padding:'4px 6px',borderBottom:'1px solid #eee'}}>
                                                <span style={{padding:'1px 6px',borderRadius:4,fontSize:9,fontWeight:700,background:col+'20',color:col}}>{c.gamme}</span>
                                            </td>
                                            <td style={{padding:'4px 6px',fontSize:10,color:'#888',borderBottom:'1px solid #eee'}}>{c.forme}</td>
                                            {macros.map(m => <td key={m} style={cellSt(c[m], macroColors[m])}>{c[m] > 0 ? c[m] : '—'}</td>)}
                                            {micros.map(m => <td key={m} style={cellSt(c[m], microColors[m])}>{c[m] > 0 ? c[m] : '—'}</td>)}
                                            <td style={cellSt(c.CO, '#33691E')}>{c.CO > 0 ? c.CO : '—'}</td>
                                            <td style={cellSt(c.MO, '#4E342E')}>{c.MO > 0 ? c.MO : '—'}</td>
                                            <td style={{padding:'4px 6px',fontSize:10,color:'#888',borderBottom:'1px solid #eee',fontStyle:'italic',maxWidth:180}}>{c.notes || '—'}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table></div>
                    </div>

                    {/* Cartes KSC */}
                    <div className="panel" style={{background:'linear-gradient(135deg,#FFF8E1,#FFFDE7)',border:'1px solid #FFD54F'}}>
                        <h3 style={{color:'#F57F17'}}><i className="fa-solid fa-star"></i> Gamme KSC Phytactyl — Stades de développement</h3>
                        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(260px,1fr))',gap:12,marginTop:12}}>
                            {catalogue.filter(c => c.gamme==='KSC').map((c,i) => {
                                const kscColors = {'KSC I':'#2196F3','KSC II':'#03A9F4','KSC III':'#4CAF50','KSC IV':'#FF9800','KSC V':'#8BC34A','KSC VI':'#F44336','KSC VII PERLA':'#9C27B0'};
                                const col = kscColors[c.name] || '#666';
                                return (
                                    <div key={i} style={{background:'#fff',borderRadius:12,border:`2px solid ${col}`,overflow:'hidden'}}>
                                        <div style={{padding:'8px 14px',background:col,color:'#fff',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                                            <strong style={{fontSize:13}}>{c.name}</strong>
                                            <span style={{fontSize:9,opacity:0.9}}>{c.spec}</span>
                                        </div>
                                        <div style={{padding:'8px 14px'}}>
                                            <div style={{fontSize:10,color:'#555',marginBottom:6,fontStyle:'italic'}}>{c.notes}</div>
                                            <div style={{display:'flex',gap:4,flexWrap:'wrap',marginBottom:4}}>
                                                {c.N > 0 && <span style={{padding:'2px 7px',borderRadius:5,fontSize:10,fontWeight:700,background:'#2E86C120',color:'#2E86C1'}}>N:{c.N}</span>}
                                                {c.P > 0 && <span style={{padding:'2px 7px',borderRadius:5,fontSize:10,fontWeight:700,background:'#E74C3C20',color:'#E74C3C'}}>P₂O₅:{c.P}</span>}
                                                {c.K > 0 && <span style={{padding:'2px 7px',borderRadius:5,fontSize:10,fontWeight:700,background:'#F39C1220',color:'#F39C12'}}>K₂O:{c.K}</span>}
                                                {c.SO3 > 0 && <span style={{padding:'2px 7px',borderRadius:5,fontSize:10,fontWeight:700,background:'#E67E2220',color:'#E67E22'}}>SO₃:{c.SO3}</span>}
                                                {c.CaO > 0 && <span style={{padding:'2px 7px',borderRadius:5,fontSize:10,fontWeight:700,background:'#8E44AD20',color:'#8E44AD'}}>CaO:{c.CaO}</span>}
                                            </div>
                                            <div style={{display:'flex',gap:3,flexWrap:'wrap'}}>
                                                {micros.map(m => c[m] > 0 && <span key={m} style={{padding:'1px 5px',borderRadius:3,fontSize:9,color:'#888',background:'#f5f5f5'}}>{m}:{c[m]}</span>)}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Note */}
                    <div className="panel" style={{background:'linear-gradient(135deg,#E3F2FD,#E8F5E9)',border:'1px solid #90CAF9'}}>
                        <h3 style={{color:'#1565C0'}}><i className="fa-solid fa-info-circle"></i> Utilisation dans le calcul NPK</h3>
                        <p style={{fontSize:13,color:'#333',marginBottom:8}}>
                            Les macro-éléments (<strong>N, P₂O₅, K₂O, CaO, MgO</strong>) de ce catalogue alimentent le calcul NPK par parcelle via l'API <strong>/api/agro-summary</strong> et la table SQL <strong>BR_Consommation</strong>.
                        </p>
                        <p style={{fontSize:12,color:'#666'}}>
                            Source : Catalogue officiel TIMAC AGRO Maroc. Les colonnes P et K correspondent à P₂O₅ et K₂O (convention engrais).
                        </p>
                    </div>
                </div>
            );
        }

export { AgroCompositionTab };
