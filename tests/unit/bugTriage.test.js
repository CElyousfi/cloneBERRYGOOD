'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  MODULES,
  buildUserContent,
  buildSystemPrompt,
  buildTextBlock,
  parseTriage,
  isValidTriage,
} = require('../../functions/lib/triage/bugTriage');

// --- buildUserContent -------------------------------------------------------

test('buildUserContent : texte seul quand aucun screenshot', () => {
  const content = buildUserContent({
    description: 'Bouton ne marche pas',
    screen: 'pointage',
    reporter: { profileId: 'chef_f1' },
    device: { userAgent: 'Safari/iPhone' },
  });
  assert.strictEqual(content.length, 1);
  assert.strictEqual(content[0].type, 'text');
  assert.match(content[0].text, /Bouton ne marche pas/);
  assert.match(content[0].text, /pointage/);
  assert.match(content[0].text, /chef_f1/);
  assert.match(content[0].text, /Safari\/iPhone/);
});

test('buildUserContent : bloc image URL quand photo_url présente', () => {
  const content = buildUserContent({
    description: 'X',
    photo_url: 'https://storage.googleapis.com/bucket/bug_reports/abc/photo.png',
  });
  assert.strictEqual(content.length, 2);
  assert.strictEqual(content[0].type, 'image');
  assert.strictEqual(content[0].source.type, 'url');
  assert.match(content[0].source.url, /photo\.png$/);
  assert.strictEqual(content[1].type, 'text');
});

test('buildUserContent : bloc image base64 quand photoBase64 présent', () => {
  const content = buildUserContent({
    description: 'X',
    photoBase64: 'data:image/png;base64,AAAA',
  });
  assert.strictEqual(content[0].type, 'image');
  assert.strictEqual(content[0].source.type, 'base64');
  assert.strictEqual(content[0].source.data, 'AAAA'); // préfixe data: retiré
  assert.strictEqual(content[0].source.media_type, 'image/png');
});

test('buildTextBlock : tolère un doc vide', () => {
  const txt = buildTextBlock({});
  assert.match(txt, /\(vide\)/);
  assert.match(txt, /\(inconnu\)/);
});

// --- buildSystemPrompt ------------------------------------------------------

test('buildSystemPrompt : inclut tous les modules + le bloc bugs récents', () => {
  const prompt = buildSystemPrompt([
    { id: 'abcd1234efgh', module: 'paie', summary: 'SMAG faux' },
  ]);
  MODULES.forEach((m) => {
    assert.match(prompt, new RegExp(m), 'module manquant : ' + m);
  });
  assert.match(prompt, /BUGS RÉCENTS/);
  assert.match(prompt, /#abcd1234 \[paie\] SMAG faux/);
});

test('buildSystemPrompt : bloc bugs récents vide → (aucun)', () => {
  const prompt = buildSystemPrompt([]);
  assert.match(prompt, /BUGS RÉCENTS/);
  assert.match(prompt, /- \(aucun\)/);
});

test('buildSystemPrompt : limite à 20 bugs récents', () => {
  const many = [];
  for (let i = 0; i < 30; i++) {
    many.push({ id: 'id' + i, module: 'stock', summary: 's' + i });
  }
  const prompt = buildSystemPrompt(many);
  assert.match(prompt, /s0/);
  assert.match(prompt, /s19/);
  assert.doesNotMatch(prompt, /\bs25\b/);
});

// --- parseTriage ------------------------------------------------------------

function makeResp(input) {
  return { content: [{ type: 'tool_use', name: 'triage_bug', input: input }] };
}

test('parseTriage : tool input valide → objet normalisé', () => {
  const triage = parseTriage(makeResp({
    severity: 'high',
    module: 'paie',
    summary: 'Total faux',
    suggestedAction: 'Vérifier le calcul SMAG',
    isDuplicate: false,
    duplicateOf: null,
  }));
  assert.ok(triage);
  assert.strictEqual(triage.severity, 'high');
  assert.strictEqual(triage.module, 'paie');
  assert.strictEqual(triage.duplicateOf, null);
});

test('parseTriage : isDuplicate=false force duplicateOf=null', () => {
  const triage = parseTriage(makeResp({
    severity: 'low',
    module: 'dashboard',
    summary: 'Couleur',
    suggestedAction: 'CSS',
    isDuplicate: false,
    duplicateOf: 'abc123', // incohérent → doit être effacé
  }));
  assert.strictEqual(triage.duplicateOf, null);
});

test('parseTriage : pas de bloc tool_use → null', () => {
  const resp = { content: [{ type: 'text', text: 'blabla' }] };
  assert.strictEqual(parseTriage(resp), null);
});

test('parseTriage : réponse absente/malformée → null', () => {
  assert.strictEqual(parseTriage(null), null);
  assert.strictEqual(parseTriage({}), null);
  assert.strictEqual(parseTriage({ content: 'x' }), null);
});

test('parseTriage : severity hors enum → null', () => {
  assert.strictEqual(parseTriage(makeResp({
    severity: 'urgent',
    module: 'paie',
    summary: 's',
    suggestedAction: 'a',
    isDuplicate: false,
    duplicateOf: null,
  })), null);
});

test('parseTriage : champ requis manquant → null', () => {
  assert.strictEqual(parseTriage(makeResp({
    severity: 'high',
    module: 'paie',
    // summary manquant
    suggestedAction: 'a',
    isDuplicate: false,
    duplicateOf: null,
  })), null);
});

test('parseTriage : isDuplicate non booléen → null', () => {
  assert.strictEqual(parseTriage(makeResp({
    severity: 'high',
    module: 'paie',
    summary: 's',
    suggestedAction: 'a',
    isDuplicate: 'oui',
    duplicateOf: null,
  })), null);
});

// --- isValidTriage ----------------------------------------------------------

test('isValidTriage : duplicateOf string accepté quand isDuplicate=true', () => {
  assert.strictEqual(isValidTriage({
    severity: 'medium',
    module: 'stock',
    summary: 's',
    suggestedAction: 'a',
    isDuplicate: true,
    duplicateOf: 'ref123',
  }), true);
});
