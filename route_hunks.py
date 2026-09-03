#!/usr/bin/env python3
"""route_hunks.py — aiguille les hunks d'un diff vers la definition qui les porte.

Indexe toutes les definitions de premier niveau d'un monolithe, en deduit la
plage de lignes de chacune, puis rattache chaque hunk du diff a la definition
qui possede ses lignes cote ANCIEN fichier.

    python3 route_hunks.py --base /tmp/BASE_app.jsx --diff /tmp/frontend.diff \
                           --map module_map.json --outdir sync-report/frontend
"""
import argparse
import json
import os
import re
from collections import defaultdict

# Formes de definition. Ancrees sur l'indentation de premier niveau, detectee
# automatiquement : un monolithe enveloppe dans une IIFE indente a 8, un module
# Node classique a 0.
DEF_PATTERNS = [
    ('function', r'^{p}(?:async\s+)?function\s+([A-Za-z_$][\w$]*)'),
    ('class',    r'^{p}class\s+([A-Za-z_$][\w$]*)'),
    ('const',    r'^{p}(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*='),
    ('export',   r'^{p}exports\.([A-Za-z_$][\w$]*)\s*='),
]

HUNK_RE = re.compile(r'^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@')


def detect_indent(lines):
    tally = defaultdict(int)
    for ln in lines:
        m = re.match(r'^( *)(?:async )?function\s+[A-Za-z_$]', ln)
        if m:
            tally[len(m.group(1))] += 1
    return max(tally.items(), key=lambda kv: kv[1])[0] if tally else 0


def index_defs(path):
    """-> liste [{name, kind, start, end}] triee par ligne de debut.

    La plage d'une definition court jusqu'a la definition suivante : approximation
    volontaire, suffisante pour rattacher un hunk a son proprietaire."""
    with open(path, encoding='utf-8', errors='replace') as fh:
        lines = fh.readlines()
    indent = detect_indent(lines)
    pats = [(k, re.compile(p.format(p=' ' * indent))) for k, p in DEF_PATTERNS]
    defs = []
    for i, ln in enumerate(lines, 1):
        for kind, rx in pats:
            m = rx.match(ln)
            if m:
                defs.append({'name': m.group(1), 'kind': kind, 'start': i})
                break
    for a, b in zip(defs, defs[1:]):
        a['end'] = b['start'] - 1
    if defs:
        defs[-1]['end'] = len(lines)
    return defs, indent, len(lines)


def split_hunks(diff_path):
    """-> liste [{old_start, old_len, header, text}] pour le diff d'un fichier."""
    with open(diff_path, encoding='utf-8', errors='replace') as fh:
        lines = fh.readlines()
    hunks, cur = [], None
    for ln in lines:
        m = HUNK_RE.match(ln)
        if m:
            if cur:
                hunks.append(cur)
            cur = {'old_start': int(m.group(1)),
                   'old_len': int(m.group(2) or 1),
                   'header': ln.rstrip('\n'),
                   'text': [ln]}
        elif cur is not None:
            if ln.startswith('diff --git'):
                hunks.append(cur)
                cur = None
            else:
                cur['text'].append(ln)
    if cur:
        hunks.append(cur)
    return hunks


def owner_of(defs, start, end):
    """Definitions chevauchant [start, end]. Un hunk peut en toucher plusieurs."""
    return [d for d in defs if d['start'] <= end and d['end'] >= start]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--base', required=True)
    ap.add_argument('--diff', required=True)
    ap.add_argument('--map', default=None)
    ap.add_argument('--outdir', required=True)
    args = ap.parse_args()

    defs, indent, nlines = index_defs(args.base)
    hunks = split_hunks(args.diff)
    mod_map = {}
    if args.map and os.path.exists(args.map):
        with open(args.map, encoding='utf-8') as fh:
            mod_map = json.load(fh)

    bycomp = os.path.join(args.outdir, 'by-component')
    os.makedirs(bycomp, exist_ok=True)

    routed = defaultdict(list)
    unmapped, orphan = [], []
    for h in hunks:
        s = h['old_start']
        e = s + max(h['old_len'] - 1, 0)
        owners = owner_of(defs, s, e)
        if not owners:
            orphan.append(h)
            continue
        for o in owners:
            routed[o['name']].append(h)
            if o['name'] not in mod_map:
                unmapped.append(o['name'])

    for name, hs in routed.items():
        safe = re.sub(r'[^A-Za-z0-9_.-]', '_', name)
        with open(os.path.join(bycomp, f'{safe}.diff'), 'w', encoding='utf-8') as fh:
            for h in hs:
                fh.writelines(h['text'])

    with open(os.path.join(args.outdir, 'unmapped.txt'), 'w', encoding='utf-8') as fh:
        for n in sorted(set(unmapped)):
            fh.write(n + '\n')

    by_module = defaultdict(list)
    for name in routed:
        by_module[mod_map.get(name, 'NON MAPPÉ')].append(name)

    with open(os.path.join(args.outdir, 'REPORT.md'), 'w', encoding='utf-8') as fh:
        w = fh.write
        w(f'# Routage des hunks — `{args.diff}`\n\n')
        w(f'- Base : `{args.base}` ({nlines} lignes, indentation premier niveau = {indent})\n')
        w(f'- Definitions indexees : **{len(defs)}**')
        w('  ⚠️ **bien en dessous de 180 — regexes a revoir**\n' if len(defs) < 180 else '\n')
        w(f'- Hunks dans le diff : **{len(hunks)}**\n')
        w(f'- Definitions touchees : **{len(routed)}**\n')
        w(f'- Hunks hors de toute definition : **{len(orphan)}**\n')
        w(f'- Definitions touchees sans module attribue : **{len(set(unmapped))}**\n\n')
        w('## Par module\n\n')
        for mod in sorted(by_module):
            w(f'### {mod}\n\n')
            for name in sorted(by_module[mod]):
                d = next(x for x in defs if x['name'] == name)
                w(f"- `{name}` ({d['kind']}, lignes {d['start']}–{d['end']}) — "
                  f"{len(routed[name])} hunk(s) → `by-component/{re.sub(r'[^A-Za-z0-9_.-]', '_', name)}.diff`\n")
            w('\n')
        if orphan:
            w('## Hunks hors definition (preambule, imports, fin de fichier)\n\n')
            for h in orphan:
                w(f"- `{h['header']}`\n")
            w('\n')

    print(f'{len(defs)} definitions indexees (indent={indent}), {len(hunks)} hunks, '
          f'{len(routed)} definitions touchees, {len(orphan)} orphelins '
          f'-> {args.outdir}/REPORT.md')
    if len(defs) < 180:
        print('ATTENTION : moins de 180 definitions indexees — verifier DEF_PATTERNS.')


if __name__ == '__main__':
    main()
