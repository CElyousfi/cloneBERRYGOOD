#!/usr/bin/env python3
"""parity_check.py — verifier de non-regression structurelle.

Indexe toutes les definitions de premier niveau d'un monolithe, puis verifie
que chacune est definie quelque part dans l'arbre modulaire cible.

Sortie non-zero s'il manque quoi que ce soit : utilisable comme garde CI.

    python3 parity_check.py --monolith ../upstream-readonly/public/app.jsx \
                            --tree src/modules src/lib \
                            --out sync-report/parity-frontend.md
"""
import argparse
import json
import os
import re
import sys
from collections import defaultdict

# Extensions inspectees dans l'arbre cible.
CODE_EXT = {'.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'}
SKIP_DIRS = {'node_modules', '.git', 'dist', 'dist-migrated', 'dist-vercel',
             '.vercel', 'coverage', '__snapshots__'}

# Definitions de premier niveau, ancrees sur l'indentation du monolithe.
def def_patterns(indent):
    p = ' ' * indent
    return [
        ('function', re.compile(rf'^{p}(?:async\s+)?function\s+([A-Za-z_$][\w$]*)')),
        ('class',    re.compile(rf'^{p}class\s+([A-Za-z_$][\w$]*)')),
        ('const',    re.compile(rf'^{p}(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=')),
    ]

# Toute forme de definition, a n'importe quelle indentation : sert a scanner
# l'arbre cible, ou le code extrait a garde son indentation d'origine et ou
# s'ajoutent les formes ES modules.
TREE_DEF_RE = [
    re.compile(r'^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)'),
    re.compile(r'^\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)'),
    re.compile(r'^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*='),
    re.compile(r'^\s*window\.([A-Za-z_$][\w$]*)\s*='),
    re.compile(r'^\s*exports\.([A-Za-z_$][\w$]*)\s*='),
]
# Re-exports nommes : export { A, B as C } — A et C comptent comme presents.
EXPORT_BLOCK_RE = re.compile(r'export\s*\{([^}]*)\}')


def detect_indent(lines):
    """Devine l'indentation du premier niveau : celle qui porte le plus de
    declarations `function`. Un monolithe enveloppe dans une IIFE indente a 8 ;
    un fichier Node classique indente a 0."""
    tally = defaultdict(int)
    for ln in lines:
        m = re.match(r'^( *)(?:async )?function\s+[A-Za-z_$]', ln)
        if m:
            tally[len(m.group(1))] += 1
    if not tally:
        return 0
    return max(tally.items(), key=lambda kv: kv[1])[0]


def index_monolith(path):
    with open(path, encoding='utf-8', errors='replace') as fh:
        lines = fh.readlines()
    indent = detect_indent(lines)
    pats = def_patterns(indent)
    defs = []
    for i, ln in enumerate(lines, 1):
        for kind, rx in pats:
            m = rx.match(ln)
            if m:
                defs.append({'name': m.group(1), 'kind': kind, 'line': i})
                break
    return defs, indent, len(lines)


def scan_tree(roots):
    """name -> [fichiers qui le definissent]"""
    found = defaultdict(list)
    for root in roots:
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
            for fn in filenames:
                if os.path.splitext(fn)[1] not in CODE_EXT:
                    continue
                full = os.path.join(dirpath, fn)
                try:
                    with open(full, encoding='utf-8', errors='replace') as fh:
                        text = fh.read()
                except OSError:
                    continue
                for ln in text.splitlines():
                    for rx in TREE_DEF_RE:
                        m = rx.match(ln)
                        if m:
                            found[m.group(1)].append(full)
                            break
                for blk in EXPORT_BLOCK_RE.findall(text):
                    for piece in blk.split(','):
                        piece = piece.strip()
                        if not piece:
                            continue
                        parts = piece.split(' as ')
                        nm = parts[-1].strip() if len(parts) > 1 else parts[0].strip()
                        if re.fullmatch(r'[A-Za-z_$][\w$]*', nm):
                            found[nm].append(full)
    return found


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--monolith', required=True)
    ap.add_argument('--tree', nargs='+', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--ignore', nargs='*', default=[],
                    help='noms deliberement non portes (a justifier dans SYNC_NOTES.md)')
    ap.add_argument('--ignore-file', default=None,
                    help='fichier JSON {nom: raison} — la raison est reprise dans le rapport')
    args = ap.parse_args()

    ignore = {n: '' for n in args.ignore}
    if args.ignore_file and os.path.exists(args.ignore_file):
        with open(args.ignore_file, encoding='utf-8') as fh:
            ignore.update(json.load(fh))

    defs, indent, nlines = index_monolith(args.monolith)
    by_name = {}
    for d in defs:
        by_name.setdefault(d['name'], d)

    found = scan_tree(args.tree)

    missing, present = [], []
    for name, d in sorted(by_name.items()):
        if name in ignore:
            continue
        (present if name in found else missing).append(d)

    dupes = {n: sorted(set(f)) for n, f in found.items()
             if n in by_name and len(set(f)) > 1}

    os.makedirs(os.path.dirname(args.out) or '.', exist_ok=True)
    with open(args.out, 'w', encoding='utf-8') as fh:
        w = fh.write
        w(f'# Parity check — `{args.monolith}`\n\n')
        w(f'- Arbre(s) cible(s) : {", ".join(args.tree)}\n')
        w(f'- Monolithe : {nlines} lignes, indentation de premier niveau = {indent}\n')
        w(f'- Definitions indexees : **{len(by_name)}**\n')
        w(f'- Presentes dans l\'arbre : **{len(present)}**\n')
        w(f'- Manquantes : **{len(missing)}**\n')
        w(f'- Ignorees explicitement : **{len(ignore)}**\n')
        w(f'- Definies en double : **{len(dupes)}**\n\n')
        if missing:
            w('## Manquantes — a porter\n\n')
            for d in missing:
                w(f"- `{d['name']}` ({d['kind']}, ligne {d['line']})\n")
            w('\n')
        if ignore:
            w('## Ignorees\n\n')
            for n, reason in sorted(ignore.items()):
                w(f'- `{n}` — {reason or "SANS JUSTIFICATION — a documenter dans SYNC_NOTES.md"}\n')
            w('\n')
        if dupes:
            w('## Definies en double — copies potentiellement divergentes\n\n')
            for n, files in sorted(dupes.items()):
                w(f'- `{n}`\n')
                for f in files:
                    w(f'  - {f}\n')
            w('\n')

    print(f'{args.monolith}: {len(by_name)} definitions, '
          f'{len(present)} presentes, {len(missing)} manquantes, '
          f'{len(dupes)} dupliquees -> {args.out}')
    return 1 if missing else 0


if __name__ == '__main__':
    sys.exit(main())
