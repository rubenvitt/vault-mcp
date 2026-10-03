import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildIndex, openIndex } from '../src/vault/index.js';
import { compilePolicy } from '../src/vault/policy.js';

const policy = compilePolicy({
  exclude: ['^privat/nachlass/', '^wiki/log\\.md$'],
  sensitive: { '20-lebensbereiche/Gesundheit': 'gesundheit' },
  readwise: '30-ressourcen/readwise',
});


let root, idx;

before(() => {
  root = mkdtempSync(join(tmpdir(), 'vault-'));
  const w = (p, c) => {
    mkdirSync(join(root, p, '..'), { recursive: true });
    writeFileSync(join(root, p), c);
  };
  w('10-projekte/Alpha.md', '---\ntype: projekt\ntags: [ai, arbeit]\nstatus: active\n---\n# Alpha\n\nEin Projekt über Vektordatenbanken. Siehe [[Beta]].');
  w('10-projekte/Beta.md', '---\ntype: projekt\ntags: [arbeit]\n---\n# Beta\n\nBeta hängt an Vektordatenbanken.');
  w('30-ressourcen/readwise/Fremdtext.md', '# Fremdtext\n\nVektordatenbanken Vektordatenbanken Vektordatenbanken überall.');
  w('privat/nachlass/Zugaenge.md', '# Privat\n\nSehr privater Inhalt über Vektordatenbanken.');
  w('wiki/log.md', '# Log\n\nVektordatenbanken protokolliert.');
  w('20-lebensbereiche/Gesundheit/Werte.md', '# Werte\n\nBlutwerte und Vektordatenbanken.');
  w('30-ressourcen/notiz.txt', 'kein markdown');

  buildIndex({ vaultPath: root, dbPath: ':memory:', policy, persist: (db, vp) => (idx = openIndex(db, { vaultPath: vp })) });
});

after(() => rmSync(root, { recursive: true, force: true }));

test('indexiert nur Markdown-Dateien', () => {
  assert.equal(idx.getNote('30-ressourcen/notiz.txt'), null);
  assert.ok(idx.getNote('10-projekte/Alpha.md'));
});

test('schließt hart ausgeschlossene Pfade komplett aus', () => {
  assert.equal(idx.getNote('privat/nachlass/Zugaenge.md'), null);
  assert.equal(idx.getNote('wiki/log.md'), null, 'ein Append-Log verzerrt jede Suche');
});

test('Suche findet die Kernnotizen und nicht die Readwise-Importe', () => {
  const hits = idx.search('Vektordatenbanken');
  const paths = hits.results.map((r) => r.path);
  assert.ok(paths.includes('10-projekte/Alpha.md'));
  assert.ok(
    !paths.some((p) => p.startsWith('30-ressourcen/readwise/')),
    'Readwise ist standardmäßig ausgeblendet, sonst dominieren Fremdtexte',
  );
});

test('Readwise ist auf Wunsch durchsuchbar', () => {
  const hits = idx.search('Vektordatenbanken', { include: ['core', 'readwise'] });
  assert.ok(hits.results.some((r) => r.path.startsWith('30-ressourcen/readwise/')));
});

test('sensible Ordner sind markiert und standardmäßig ausgeblendet', () => {
  assert.ok(!idx.search('Blutwerte').results.length, 'Gesundheit ist nicht im Standardumfang');
  const withSensitive = idx.search('Blutwerte', { includeSensitive: true });
  assert.equal(withSensitive.results[0].path, '20-lebensbereiche/Gesundheit/Werte.md');
  assert.equal(withSensitive.results[0].sensitivity, 'gesundheit');
});

test('Suche lässt sich nach Tag filtern', () => {
  const hits = idx.search('Vektordatenbanken', { tag: 'ai' });
  assert.deepEqual(hits.results.map((r) => r.path), ['10-projekte/Alpha.md']);
});

test('Suche lässt sich nach Ordner filtern', () => {
  const hits = idx.search('Vektordatenbanken', { folder: '10-projekte' });
  assert.equal(hits.results.length, 2);
});

test('Suche liefert einen Textausschnitt mit Treffermarkierung', () => {
  const hit = idx.search('Vektordatenbanken', { tag: 'ai' }).results[0];
  assert.match(hit.snippet, /Vektordatenbanken/);
});

test('Suche paginiert und meldet die Gesamtzahl', () => {
  const page = idx.search('Vektordatenbanken', { limit: 1 });
  assert.equal(page.results.length, 1);
  assert.equal(page.total, 2);
  assert.equal(page.hasMore, true);
});

test('getNote liefert Inhalt und Metadaten', () => {
  const n = idx.getNote('10-projekte/Alpha.md');
  assert.equal(n.title, 'Alpha');
  assert.deepEqual(n.tags, ['ai', 'arbeit']);
  assert.equal(n.frontmatter.status, 'active');
  assert.match(n.content, /Vektordatenbanken/);
});

test('Backlinks werden über den Wikilink-Graphen aufgelöst', () => {
  assert.deepEqual(idx.backlinks('10-projekte/Beta.md').map((b) => b.path), ['10-projekte/Alpha.md']);
});

test('ausgehende Links werden auf Pfade aufgelöst', () => {
  assert.deepEqual(idx.outgoingLinks('10-projekte/Alpha.md').map((l) => l.path), ['10-projekte/Beta.md']);
});

test('Statistik zählt indexierte Notizen je Klasse', () => {
  const s = idx.stats();
  assert.equal(s.byClass.core, 3, 'Alpha, Beta, Gesundheit — ohne Readwise und Ausschlüsse');
  assert.equal(s.byClass.readwise, 1);
});
