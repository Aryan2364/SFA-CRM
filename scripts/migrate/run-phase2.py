# -*- coding: utf-8 -*-
"""
Run the phase-2 migration for one file.

  python scripts/migrate/run-phase2.py <path> [--dry]

A file whose every occurrence is protected is NOT run through the engine at all.
`tokens.migrate` writes unconditionally, so a fully-protected file would still
be rewritten -- LF where the disk copy was CRLF -- for a zero-content change,
and "these four files get no commit" would be true in the log and false in the
bytes. There are four such files in phase 2: contexts/ToastContext.tsx,
components/ui/Sidebar.tsx, components/ui/StatusBadge.tsx and
lib/usage-intelligence.ts. This script refuses them by deriving the condition
rather than by listing them.
"""
import io, os, sys, collections, importlib.util

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import tokens as T

_spec = importlib.util.spec_from_file_location(
    'sites_phase2', os.path.join(HERE, 'sites-phase2.py'))
S2 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(S2)

path = [a for a in sys.argv[1:] if not a.startswith('--')][0]
dry = '--dry' in sys.argv
cfg = dict(S2.SITES[path])

src = io.open(path, encoding='utf-8').read().split('\n')
prot_lines = set(cfg['protect_lines']) | set(cfg['manual'])
prot_occ = collections.defaultdict(set)
for (n, b) in cfg['protect']:
    prot_occ[n].add(b)

convertible = 0
for i, line in enumerate(src, 1):
    for m in T.TOKEN.finditer(line):
        if i in prot_lines or m.group('base') in prot_occ.get(i, ()):
            continue
        convertible += 1

before = len(T.TOKEN.findall('\n'.join(src)))
print('file        : %s' % path)
print('palette     : %d' % before)
print('convertible : %d' % convertible)

if convertible == 0:
    print('SKIPPED -- every occurrence is protected. The engine is not run, so the')
    print('file stays byte-identical to its blob and gets no commit.')
    sys.exit(0)

try:
    stats, left = T.migrate(path, dry_run=dry, **cfg)
except T.Unmapped as e:
    print('STOPPED -- %d occurrence(s) with no section 11 row:' % len(e.args[0]))
    for n, base, why in e.args[0]:
        print('  %s:%d  %-22s  %s' % (path, n, base, why))
    sys.exit(1)

after = len(T.TOKEN.findall(io.open(path, encoding='utf-8').read()))
print('mapped      : %d   deleted: %d   left: %d'
      % (stats['mapped'], stats['deleted'], stats['left']))
print('after       : %d%s' % (after, '  (dry run -- file untouched)' if dry else ''))
if cfg['manual']:
    print('MANUAL still to apply by hand on lines: %s'
          % ','.join(str(n) for n in cfg['manual']))
print('left behind :')
for n, base in left:
    print('  :%-6d %s' % (n, base))
