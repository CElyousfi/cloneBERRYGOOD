'use strict';

const test = require('node:test');
const assert = require('node:assert');

const ImageDownscale = require('../../public/lib/imageDownscale.js');

test('computeTargetSize — image déjà plus petite : inchangée', () => {
  const r = ImageDownscale.computeTargetSize(800, 600, 2000);
  assert.deepStrictEqual(r, { width: 800, height: 600, scaled: false });
});

test('computeTargetSize — pile à la limite : inchangée', () => {
  const r = ImageDownscale.computeTargetSize(2000, 1000, 2000);
  assert.strictEqual(r.scaled, false);
});

test('computeTargetSize — paysage : le plus grand côté vaut maxSide, ratio gardé', () => {
  const r = ImageDownscale.computeTargetSize(4000, 3000, 2000);
  assert.deepStrictEqual(r, { width: 2000, height: 1500, scaled: true });
});

test('computeTargetSize — portrait : le plus grand côté vaut maxSide', () => {
  const r = ImageDownscale.computeTargetSize(3000, 4000, 2000);
  assert.deepStrictEqual(r, { width: 1500, height: 2000, scaled: true });
});

test('computeTargetSize — ratio extrême : jamais de dimension nulle', () => {
  const r = ImageDownscale.computeTargetSize(10000, 3, 2000);
  assert.strictEqual(r.width, 2000);
  assert.ok(r.height >= 1);
});

test('computeTargetSize — dimensions invalides : pas de scale', () => {
  assert.deepStrictEqual(ImageDownscale.computeTargetSize(0, 0, 2000), { width: 0, height: 0, scaled: false });
});

test('downscaleToDataUrl — sans fichier : rejette', async () => {
  await assert.rejects(() => ImageDownscale.downscaleToDataUrl(null), /Aucun fichier/);
});
