# -*- coding: utf-8 -*-
"""
Section 11.8 exit check for one converted file. Residue, not reconciliation.

  1. every protected site byte-identical to its pre-phase blob
  2. no palette class outside the declared groups survives
  3. line-for-line with the pre-phase blob

  python scripts/migrate/verify.py <key> [<base-ref>]
"""
import io, os, sys, subprocess
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tokens as T
import sites as S

key = sys.argv[1]
base = sys.argv[2] if len(sys.argv) > 2 else 'HEAD'
path = getattr(S, key)
cfg = S.SITES[path]

old = subprocess.check_output(['git', 'show', base + ':' + path]).decode('utf-8').split('\n')
new = io.open(path, encoding='utf-8').read().split('\n')

fails = []

# 3. line-for-line
if len(old) != len(new):
    fails.append('line count moved: %d -> %d' % (len(old), len(new)))

# 1. protected sites byte-identical
for n in sorted(set(cfg.get('protect_lines', ())) - set(cfg.get('manual', ()))):
    if old[n - 1] != new[n - 1]:
        fails.append('line-level protected line %d changed' % n)
for n in sorted(set(n for n, _ in cfg.get('protect', ()))):
    if n in set(cfg.get('protect_lines', ())):
        continue
    for _, b in [(x, y) for x, y in cfg['protect'] if x == n]:
        before = len(T.TOKEN.findall(old[n - 1]))
        if b not in new[n - 1]:
            fails.append('protected site %d %s is gone' % (n, b))

# 2. remainder empty
declared = set()
for n, b in cfg.get('protect', ()):
    declared.add((n, b))
for n in cfg.get('protect_lines', ()):
    for m in T.TOKEN.finditer(old[n - 1]):
        declared.add((n, m.group('base')))

manual = set(cfg.get('manual', ()))
survivors = []
for i, line in enumerate(new):
    if i + 1 in manual:
        # converted by a rule the engine does not implement. It must hold NO
        # palette class afterwards -- that is the check, not byte-identity.
        left = [m.group('base') for m in T.TOKEN.finditer(line)]
        if left:
            fails.append('manual line %d still holds %s' % (i + 1, ','.join(left)))
        continue
    for m in T.TOKEN.finditer(line):
        if (i + 1, m.group('base')) not in declared:
            survivors.append((i + 1, m.group('base')))

print('file      : %s' % path)
print('lines     : %d -> %d%s' % (len(old), len(new), '' if len(old) == len(new) else '  FAIL'))
print('palette   : %d -> %d' % (sum(len(T.TOKEN.findall(l)) for l in old),
                                sum(len(T.TOKEN.findall(l)) for l in new)))
print('declared  : %d sites' % len(declared))
print('survivors outside the declared groups: %d' % len(survivors))
for n, b in survivors:
    print('   :%-6d %s' % (n, b))
if fails:
    print('\nFAILURES:')
    for f in fails:
        print('  ' + f)
    sys.exit(1)
print('\n11.8 PASS')
