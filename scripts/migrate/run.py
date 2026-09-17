# -*- coding: utf-8 -*-
"""Run the phase-1 migration for one file.  python scripts/migrate/run.py <key> [--dry]"""
import sys, io, re, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tokens as T
import sites as S

key = sys.argv[1]
dry = '--dry' in sys.argv
path = getattr(S, key)
cfg = S.SITES[path]

before = len(T.TOKEN.findall(io.open(path, encoding='utf-8').read()))
try:
    stats, left = T.migrate(path, dry_run=dry, **cfg)
except T.Unmapped as e:
    print('STOPPED -- %d occurrence(s) with no section 11 row:' % len(e.args[0]))
    for n, base, why in e.args[0]:
        print('  %s:%d  %-22s  %s' % (path, n, base, why))
    sys.exit(1)

after = len(T.TOKEN.findall(io.open(path, encoding='utf-8').read()))
print('file   : %s' % path)
print('before : %d' % before)
print('mapped : %d   deleted: %d   left: %d' % (stats['mapped'], stats['deleted'], stats['left']))
print('after  : %d%s' % (after, '  (dry run -- file untouched)' if dry else ''))
print('left behind:')
for n, base in left:
    print('  :%-6d %s' % (n, base))
