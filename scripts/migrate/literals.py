# -*- coding: utf-8 -*-
"""
Derive the enclosing object/array literal of a protected line, from the source.

Nothing here is declared by hand. sites.py once said "3 categories fixed in
code" where the code declared five, and a hand-written line range is the same
kind of number from the same kind of reading -- AGENTS.md section 6.4: "The fix
is not 'name more slots'. That is the same design and stays wrong the next time
somebody adds a component", and "a verification surface configured per item will
be incomplete, and its incompleteness looks identical to success."

So the walker finds the set; it is never told where the set is.

A literal here is a multi-line `{...}` or `[...]` in EXPRESSION position -- the
brace is preceded by = : ( , [ or return. A `{` after `)` or `;` or another `{`
opens a block, not a literal, and walking out into one would swallow whole
component bodies. A `{` after `>` is a JSX expression container and is likewise
not a literal; including it walked out over whole JSX map bodies on the first
attempt.

The first run of this walker earned its keep immediately: it derived the
companies legend as 281-287, where the range declared by hand read 281-288 --
one line too long, swallowing a JSX line that is not part of the literal.
"""
import re

# What may sit immediately before a brace that opens a LITERAL rather than a
# block. Deliberately NOT '>': a `{` after '>' is a JSX expression container, and
# including it walked out over whole JSX map bodies. Deliberately not '=>'
# either -- `=> {` opens a block; a literal arrow body is written `=> ({`, which
# is caught by the '(' case.
_EXPR_BEFORE = set('=:(,[')


def _scan(src):
    """Yield (open_index, close_index, char) for every bracket pair, skipping
    strings, template literals and comments."""
    stack, pairs = [], []
    i, n = 0, len(src)
    while i < n:
        c = src[i]
        # comments
        if c == '/' and i + 1 < n:
            if src[i + 1] == '/':
                i = src.find('\n', i)
                if i < 0:
                    break
                continue
            if src[i + 1] == '*':
                j = src.find('*/', i + 2)
                i = n if j < 0 else j + 2
                continue
        # strings
        if c in '"\'':
            q, i = c, i + 1
            while i < n and src[i] != q:
                i += 2 if src[i] == '\\' else 1
            i += 1
            continue
        # template literal -- ${ } may nest real code, so track depth
        if c == '`':
            i += 1
            while i < n and src[i] != '`':
                if src[i] == '\\':
                    i += 2
                    continue
                if src[i] == '$' and i + 1 < n and src[i + 1] == '{':
                    depth, i = 1, i + 2
                    start = i
                    while i < n and depth:
                        if src[i] in '"\'`':
                            q2, i = src[i], i + 1
                            while i < n and src[i] != q2:
                                i += 2 if src[i] == '\\' else 1
                        elif src[i] == '{':
                            depth += 1
                        elif src[i] == '}':
                            depth -= 1
                        i += 1
                    continue
                i += 1
            i += 1
            continue
        if c in '{[':
            stack.append((i, c))
        elif c in '}]':
            if stack:
                oi, oc = stack.pop()
                if (oc, c) in (('{', '}'), ('[', ']')):
                    pairs.append((oi, i, oc))
        i += 1
    return pairs


def _is_literal(src, open_idx):
    """True when the bracket at open_idx opens an object/array LITERAL."""
    if src[open_idx] == '[':
        return True
    j = open_idx - 1
    while j >= 0 and src[j] in ' \t\r\n':
        j -= 1
    if j < 0:
        return False
    if src[j] in _EXPR_BEFORE:
        return True
    return re.search(r'\breturn\s*$', src[max(0, j - 8):j + 1]) is not None


def enclosing_literals(path, lines_of_interest):
    """
    {line -> (first_line, last_line)} for each line of interest that sits inside
    a multi-line literal. Innermost wins. Lines not inside one are absent.
    """
    src = open(path, encoding='utf-8').read()
    starts = [0]
    for ch in src:
        starts.append(starts[-1] + 1)
    # index -> line number
    nl = [0]
    for i, ch in enumerate(src):
        if ch == '\n':
            nl.append(i)

    def line_of(idx):
        lo, hi = 0, len(nl) - 1
        while lo < hi:
            mid = (lo + hi + 1) // 2
            if nl[mid] <= idx:
                lo = mid
            else:
                hi = mid - 1
        return lo + 1

    spans = []
    for oi, ci, oc in _scan(src):
        a, b = line_of(oi), line_of(ci)
        if b > a and _is_literal(src, oi):
            spans.append((a, b))

    out = {}
    for ln in lines_of_interest:
        best = None
        for a, b in spans:
            if a <= ln <= b and (best is None or (b - a) < (best[1] - best[0])):
                best = (a, b)
        if best:
            out[ln] = best
    return out
