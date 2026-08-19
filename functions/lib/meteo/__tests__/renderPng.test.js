/**
 * renderPng — le seul module natif du domaine météo, et le seul endroit du lot
 * où une panne est SILENCIEUSE : sans police fournie explicitement, resvg rend
 * un PNG valide et totalement muet. Le runtime Cloud Functions n'embarquant
 * aucune police, ce test n'est pas optionnel : il compare le poids d'un rendu
 * AVEC texte et SANS texte, et démontre en plus le piège (rendu sans police du
 * tout ≈ rendu sans texte).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const {
  PNG_MIME,
  FONT_PATH,
  DEFAULT_FONT_FAMILY,
  DEFAULT_WIDTH,
  buildResvgOptions,
  renderSvgToPng,
} = require('../renderPng');
const { buildSprayChartSvg, WIDTH, HEIGHT } = require('../sprayChart');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Dimensions lues dans le chunk IHDR (octets 16→24) — pas de dépendance. */
function pngSize(buf) {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** Deux SVG identiques au texte près : la seule variable est le <text>. */
const TEXTE = 'Météo & Traitements — max 29°C → min 17°C — Score 62% (Partiel)';
function svgAvecTexte(contenu) {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200" viewBox="0 0 600 200">' +
    '<rect x="0" y="0" width="600" height="200" fill="#0F0F0F"/>' +
    (contenu
      ? '<text x="20" y="60" font-size="18" fill="#ECECEC">' + contenu + '</text>' +
        '<text x="20" y="110" font-size="18" fill="#ECECEC">' + contenu + '</text>' +
        '<text x="20" y="160" font-size="18" fill="#ECECEC">' + contenu + '</text>'
      : '') +
    '</svg>';
}
const AVEC_TEXTE = svgAvecTexte(TEXTE.replace(/&/g, '&amp;'));
const SANS_TEXTE = svgAvecTexte('');

test('la police embarquée est bien présente dans le dépôt', () => {
  assert.ok(fs.existsSync(FONT_PATH), 'functions/assets/DejaVuSans.ttf doit être committé');
  const ttf = fs.readFileSync(FONT_PATH);
  assert.ok(ttf.length > 100000, 'fichier de police plausible');
  assert.ok(ttf.toString('latin1').includes(DEFAULT_FONT_FAMILY), 'le .ttf déclare bien « ' + DEFAULT_FONT_FAMILY + ' »');
});

test('buildResvgOptions : police chargée explicitement, polices système désactivées', () => {
  const opts = buildResvgOptions();
  assert.deepEqual(opts.font.fontFiles, [FONT_PATH]);
  assert.equal(opts.font.defaultFontFamily, DEFAULT_FONT_FAMILY);
  assert.equal(opts.font.loadSystemFonts, false,
    'jamais de police système : le test doit échouer là où la prod échoue');
  assert.deepEqual(opts.fitTo, { mode: 'width', value: DEFAULT_WIDTH });
});

test('buildResvgOptions : police introuvable → throw explicite (jamais un PNG muet)', () => {
  assert.throws(
    () => buildResvgOptions({ fontPath: '/chemin/inexistant/NoFont.ttf' }),
    /police introuvable/
  );
});

test('renderSvgToPng : signature PNG, dimensions attendues, buffer non vide', () => {
  const png = renderSvgToPng(AVEC_TEXTE);
  assert.ok(png.length > 0);
  assert.ok(png.subarray(0, 8).equals(PNG_SIGNATURE), 'signature \\x89PNG');
  const size = pngSize(png);
  assert.equal(size.width, DEFAULT_WIDTH);
  assert.equal(size.height, Math.round(DEFAULT_WIDTH * 200 / 600), 'hauteur proportionnelle au viewBox');
  assert.equal(PNG_MIME, 'image/png');
});

test('renderSvgToPng : largeur personnalisée respectée', () => {
  const png = renderSvgToPng(AVEC_TEXTE, { width: 600 });
  assert.deepEqual(pngSize(png), { width: 600, height: 200 });
});

test('NON-RÉGRESSION POLICE : le texte est réellement rendu (poids >> rendu sans texte)', () => {
  const avec = renderSvgToPng(AVEC_TEXTE);
  const sans = renderSvgToPng(SANS_TEXTE);
  assert.ok(
    avec.length > sans.length * 1.5,
    'PNG avec texte (' + avec.length + ' o) doit peser bien plus que sans texte (' + sans.length +
      ' o) — sinon aucun glyphe n\'a été dessiné'
  );
});

test('le piège existe vraiment : sans fichier de police, resvg rend un PNG MUET sans erreur', () => {
  // Reproduction de la configuration du runtime Cloud Functions : aucune police
  // système, aucun fontFiles. C'est ce que renderPng.js empêche.
  const { Resvg } = require('@resvg/resvg-js');
  const nu = (svg) => Buffer.from(
    new Resvg(svg, { fitTo: { mode: 'width', value: 1200 }, font: { loadSystemFonts: false, fontFiles: [] } })
      .render().asPng()
  );
  const avecTexteSansPolice = nu(AVEC_TEXTE);
  const sansTexteSansPolice = nu(SANS_TEXTE);
  assert.equal(
    avecTexteSansPolice.length, sansTexteSansPolice.length,
    'sans police, le SVG avec texte rend exactement la même image que celui sans texte'
  );
  // …et le module, lui, produit bien quelque chose de différent.
  assert.ok(renderSvgToPng(AVEC_TEXTE).length > avecTexteSansPolice.length);
});

test('renderSvgToPng : SVG vide refusé', () => {
  assert.throws(() => renderSvgToPng(''), /SVG vide/);
  assert.throws(() => renderSvgToPng('   '), /SVG vide/);
  assert.throws(() => renderSvgToPng(/** @type {*} */ (null)), /SVG vide/);
});

test('renderSvgToPng : Resvg injectable (aucun binaire natif requis)', () => {
  let vuSvg = null;
  let vuOpts = null;
  function FauxResvg(svg, opts) {
    vuSvg = svg;
    vuOpts = opts;
    this.render = () => ({ asPng: () => Buffer.from('FAUX-PNG') });
  }
  const out = renderSvgToPng('<svg/>', { Resvg: FauxResvg });
  assert.equal(out.toString(), 'FAUX-PNG');
  assert.equal(vuSvg, '<svg/>');
  assert.deepEqual(vuOpts.font.fontFiles, [FONT_PATH]);
});

test('renderSvgToPng : un rendu vide remonte en erreur, jamais en succès', () => {
  function ResvgVide() {
    this.render = () => ({ asPng: () => Buffer.alloc(0) });
  }
  assert.throws(() => renderSvgToPng('<svg/>', { Resvg: ResvgVide }), /PNG vide/);
});

test('bout en bout : le graphique du digest rend un PNG lisible (texte inclus)', () => {
  const jour = '2026-08-19';
  const heures = [];
  const temperature = [];
  const time = [];
  const spraywindow = [];
  for (let h = 0; h < 24; h++) {
    heures.push(h);
    time.push(jour + ' ' + String(h).padStart(2, '0') + ':00');
    temperature.push(15 + 9 * Math.sin(((h - 5) / 24) * Math.PI));
    spraywindow.push(h < 9 ? 1 : (h < 16 ? 0 : 2));
  }
  const svg = buildSprayChartSvg({
    dateISO: jour,
    weatherData: { data_1h: { time, temperature } },
    sprayData: { data_1h: { time, spraywindow } },
    dateLabel: 'Mer 19/08',
    scoreText: '45% (Partiel)',
  });
  const png = renderSvgToPng(svg);
  assert.ok(png.subarray(0, 8).equals(PNG_SIGNATURE));
  assert.deepEqual(pngSize(png), {
    width: DEFAULT_WIDTH,
    height: Math.round(DEFAULT_WIDTH * HEIGHT / WIDTH),
  });
  assert.ok(png.length > 8000, 'un graphique complet pèse largement plus qu\'un aplat (' + png.length + ' o)');

  // Même graphique privé de tout son texte : la différence de poids prouve que
  // les libellés (heures, °C, légende, titre) sont bien dessinés.
  const svgMuet = svg.replace(/<text[^>]*>[^<]*<\/text>/g, '');
  assert.ok(svgMuet.length < svg.length);
  const pngMuet = renderSvgToPng(svgMuet);
  assert.ok(png.length > pngMuet.length * 1.15,
    'graphique avec libellés ' + png.length + ' o vs sans libellés ' + pngMuet.length + ' o');
});
