# -*- coding: utf-8 -*-
"""
Section 11.8 exit check for one PHASE-2 file. Residue, not reconciliation.

  1. every protected site byte-identical to its pre-phase blob
  1b. every DERIVED literal byte-identical as a block, unless acknowledged
  2. no palette class outside the declared groups survives
  3. line-for-line with the pre-phase blob

  python scripts/migrate/verify-phase2.py <path|all> [<base-ref>]

This duplicates `verify.py`'s checks rather than reusing them, and that is a
debt, not a design: `verify.py` binds to `sites.py` at import and runs its work
at module level, so it cannot be imported against a different registry. Folding
the two into one verifier that takes a registry is a follow-up, not a colour
change, and doing it mid-sweep would put phase 1's exit check at risk to save a
duplicate file.

LINE ENDINGS. Both sides are normalised before any comparison and that is
load-bearing, not precautionary. `core.autocrlf=true` and every blob is LF, so
`git checkout` rewrites to CRLF on disk any file the checkout touched. Of the 41
phase-2 files, 24 are CRLF on disk and 17 are LF -- the merge of phase 1 did not
change that split, because a checkout only rewrites files that differ between
the two commits and phase 1 touched none of these 41. A byte comparison against
a blob therefore differs on 24 of 41 for a reason that has nothing to do with
the mapping. Nothing is to be fixed in the tree: normalising line endings is
exactly the structure-moved change 11.8 forbids.

The guard has a control, per section 15: `--no-normalise` disables it. On a CRLF
file the check then FAILS and on an LF file it still passes, which is what makes
it a control rather than something that passes either way.
"""
import io, os, sys, subprocess, importlib.util

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import tokens as T
import literals as L

_spec = importlib.util.spec_from_file_location(
    'sites_phase2', os.path.join(HERE, 'sites-phase2.py'))
S2 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(S2)

NORMALISE = '--no-normalise' not in sys.argv
ARGS = [a for a in sys.argv[1:] if not a.startswith('--')]


def _lines(text):
    if NORMALISE:
        text = text.replace('\r\n', '\n').replace('\r', '\n')
    return text.split('\n')


def check(path, base):
    cfg = S2.SITES[path]
    old = _lines(subprocess.check_output(
        ['git', 'show', base + ':' + path]).decode('utf-8'))
    new = _lines(io.open(path, encoding='utf-8', newline='').read())
    fails = []

    # 3. line-for-line
    if len(old) != len(new):
        fails.append('line count moved: %d -> %d' % (len(old), len(new)))

    # 1. protected sites byte-identical
    for n in sorted(set(cfg['protect_lines']) - set(cfg['manual'])):
        if n <= len(old) and n <= len(new) and old[n - 1] != new[n - 1]:
            fails.append('line-level protected line %d changed' % n)
    for n, b in sorted(set(cfg['protect'])):
        if n in set(cfg['protect_lines']):
            continue
        if n <= len(new) and b not in new[n - 1]:
            fails.append('protected site %d %s is gone' % (n, b))

    # 1b. derived literals byte-identical as blocks. Coverage derived, only
    # disposition declared -- section 15's corollary.
    prot = (set(n for n, _ in cfg['protect']) | set(cfg['protect_lines'])) - set(cfg['manual'])
    derived = sorted(set(L.enclosing_literals(path, sorted(prot)).values())) if prot else []
    ack = {tuple(x) for x in cfg.get('mixed_ok', ())}
    for lo, hi in derived:
        diff = [n for n in range(lo, hi + 1)
                if n <= len(old) and n <= len(new) and old[n - 1] != new[n - 1]]
        if not diff:
            continue
        if (lo, hi) in ack:
            print('   mixed literal %d-%d, %d line(s) converted -- acknowledged'
                  % (lo, hi, len(diff)))
            continue
        fails.append('literal %d-%d is MIXED and not acknowledged: converted at %s'
                     % (lo, hi, ','.join(str(n) for n in diff)))

    # 2. remainder empty
    declared = set((n, b) for n, b in cfg['protect'])
    for n in cfg['protect_lines']:
        if n <= len(old):
            for m in T.TOKEN.finditer(old[n - 1]):
                declared.add((n, m.group('base')))
    manual = set(cfg['manual'])
    survivors = []
    for i, line in enumerate(new):
        if i + 1 in manual:
            left = [m.group('base') for m in T.TOKEN.finditer(line)]
            if left:
                fails.append('manual line %d still holds %s' % (i + 1, ','.join(left)))
            continue
        for m in T.TOKEN.finditer(line):
            if (i + 1, m.group('base')) not in declared:
                survivors.append((i + 1, m.group('base')))

    po = sum(len(T.TOKEN.findall(l)) for l in old)
    pn = sum(len(T.TOKEN.findall(l)) for l in new)
    return fails, survivors, len(old), len(new), po, pn, len(declared), len(derived)


if __name__ == '__main__':
    base = ARGS[1] if len(ARGS) > 1 else 'HEAD'
    targets = sorted(S2.SITES) if (not ARGS or ARGS[0] == 'all') else [ARGS[0]]
    bad = 0
    for path in targets:
        fails, surv, lo_, ln_, po, pn, nd, ndl = check(path, base)
        ok = not fails and not surv
        if not ok:
            bad += 1
        print('%-4s %-52s lines %d->%d  palette %d->%d  declared %d  literals %d'
              % ('PASS' if ok else 'FAIL', path[-50:], lo_, ln_, po, pn, nd, ndl))
        for f in fails:
            print('       ! ' + f)
        for n, b in surv[:12]:
            print('       ? undeclared residue :%d %s' % (n, b))
        if len(surv) > 12:
            print('       ? ... and %d more' % (len(surv) - 12))
    print()
    print('normalisation: %s' % ('ON' if NORMALISE else 'OFF (control run)'))
    print('%d of %d file(s) failed' % (bad, len(targets)))
    sys.exit(1 if bad else 0)
