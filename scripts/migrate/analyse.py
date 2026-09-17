# -*- coding: utf-8 -*-
"""
Pre-conversion analysis for one file. Finds the two shapes that read clean
against a plain row lookup and are not:

  1. Section 11.9 hover collisions, with section 11.2's exceptions applied
     FIRST. :1536 in daily-activity read clean without that: 11.1 maps
     text-gray-500 -> muted and text-gray-700 -> secondary, which differ, but
     :1536 is in 11.2's status list so the resting half becomes secondary and
     lands on the hover's token. The exception creates the collision.

     A saturated status BUTTON fill is only a collision when its role has no
     hover token. danger does (globals.css declares danger-hover), so
     bg-red-600 hover:bg-red-700 resolves under 11.4's closing rule. success
     and warning do not, so those stay.

  2. Ternary lines where one branch holds a protected occurrence. The branches
     are one element's states, so the whole line goes line-level -- converting
     one branch is the half-migration the rule exists to stop.

  python scripts/migrate/analyse.py <key>
"""
import io, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tokens as T
import sites as S

HAS_HOVER_TOKEN = {'danger'}          # globals.css: danger-hover only

SEG = re.compile(r"'([^']*)'|\"([^\"]*)\"")
TERNARY = re.compile(r'\?[^?]*:')


def resolve(base, line, exceptions):
    """The token a base class lands on, section 11.2 applied."""
    if base in T.NEUTRAL:
        tk = T.NEUTRAL[base]
        if tk == 'text-text-muted' and line in exceptions:
            return 'text-text-secondary'
        return tk
    if base in T.BRAND:
        return T.BRAND[base]
    m = T.BASE_SPLIT.match(base)
    if m:
        role = T.role_of(m.group(2))
        if role:
            return {'text': 'text-%s' % role, 'bg': 'bg-%s-bg' % role,
                    'border': 'border-%s-border' % role,
                    'ring': 'ring-%s' % role}.get(m.group(1))
    return None


def hover_lines(path, exceptions=()):
    exceptions = set(exceptions)
    out = []
    for i, line in enumerate(io.open(path, encoding='utf-8').read().split('\n')):
        n = i + 1
        hit = None
        for g in SEG.findall(line):
            seg = g[0] or g[1]
            rest, hov = {}, {}
            for m in T.TOKEN.finditer(seg):
                v, b = m.group('variants'), m.group('base')
                tk = resolve(b, n, exceptions)
                if not tk:
                    continue
                if v == '':
                    rest.setdefault(tk, set()).add(b)
                elif v.startswith('hover:'):
                    key = 'bg-primary-hover' if b in T.PRESSED_BLUE else tk
                    hov.setdefault(key, set()).add(b)
            # a saturated status fill whose role HAS a hover token resolves
            for tk in set(rest) & set(hov):
                if rest[tk] == hov[tk]:
                    continue                      # pre-existing no-op
                mm = [T.BASE_SPLIT.match(b) for b in rest[tk] | hov[tk]]
                roles = set(T.role_of(x.group(2)) for x in mm if x)
                fams = set(x.group(1) for x in mm if x)
                if fams == {'bg'} and roles and roles <= HAS_HOVER_TOKEN:
                    continue                      # 11.4's closing rule resolves it
                hit = (n, sorted(rest[tk]), sorted(hov[tk]), tk)
        if hit:
            out.append(hit)
    return out


def ternary_risk(path, protect):
    """Lines with a protected occurrence inside a ternary -> line-level."""
    prot = {}
    for n, b in protect:
        prot.setdefault(n, set()).add(b)
    out = []
    for i, line in enumerate(io.open(path, encoding='utf-8').read().split('\n')):
        n = i + 1
        if n not in prot or not TERNARY.search(line):
            continue
        others = [m.group('base') for m in T.TOKEN.finditer(line)
                  if m.group('base') not in prot[n]]
        if others:
            out.append((n, sorted(prot[n]), sorted(set(others))))
    return out


if __name__ == '__main__':
    path = getattr(S, sys.argv[1])
    cfg = S.SITES.get(path, {})
    print('--- 11.9 candidates (11.2 applied, danger fills excluded) ---')
    for n, a, b, tk in hover_lines(path, cfg.get('exceptions', ())):
        print('  :%-6d %s + hover:%s -> %s' % (n, ','.join(a), ','.join(b), tk))
    print('--- ternary lines holding a protected occurrence ---')
    for n, p, o in ternary_risk(path, cfg.get('protect', ())):
        print('  :%-6d protected %s | also on line: %s' % (n, ','.join(p), ','.join(o)))
