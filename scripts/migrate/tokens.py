# -*- coding: utf-8 -*-
"""
Phase-1 colour migration: raw Tailwind palette classes -> kit tokens.

Applies plan-2026-09-16-1522.md section 11 EXACTLY. It decides nothing.
Every rule below is a row in section 11; every protected site is an entry in
section 11.6 A-G. A class with no row and no protection entry is an ERROR that
stops the run -- it is never guessed.
"""
import io
import re

FAM = ('slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|'
       'teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose')
PFX = ('bg|text|border|ring|divide|placeholder|accent|shadow|from|to|via|fill|'
       'stroke|outline|decoration|caret')

# a class token: optional variant prefixes (hover:, focus:, md:), the base
# class, and an optional opacity suffix (/40)
# NOTE the shade alternation is longest-first. Regex alternation is
# leftmost-first, so "50|...|500" makes text-gray-500 match as text-gray-50.
SHADE = r'100|200|300|400|500|600|700|800|900|950|50'

TOKEN = re.compile(
    r'(?<![\w-])'
    r'(?P<variants>(?:[a-z-]+:)*)'
    r'(?P<base>(?:' + PFX + r')-(?:(?:' + FAM +
    r')-(?:' + SHADE + r')|white|black))'
    r'(?P<alpha>/\d+)?'
    r'(?![\w-])')

BASE_SPLIT = re.compile(r'^(' + PFX + r')-(' + FAM + r')-(\d+)$')

DANGER = ('red',)
SUCCESS = ('green', 'emerald')
WARNING = ('amber', 'yellow', 'orange')


def role_of(fam):
    if fam in DANGER:
        return 'danger'
    if fam in SUCCESS:
        return 'success'
    if fam in WARNING:
        return 'warning'
    return None


# ---- section 11.1, neutrals ------------------------------------------------
NEUTRAL = {
    'text-gray-900': 'text-text-primary',
    'text-gray-800': 'text-text-primary',
    'text-gray-700': 'text-text-secondary',
    'text-gray-600': 'text-text-secondary',
    'text-gray-500': 'text-text-muted',
    'text-gray-400': 'text-text-muted',
    'text-gray-300': 'text-text-muted',
    'border-gray-300': 'border-border',
    'border-gray-200': 'border-border-light',
    'border-gray-100': 'border-border-light',
    'border-gray-50': 'border-border-light',
    'divide-gray-50': 'divide-border-light',
    'divide-gray-100': 'divide-border-light',
    'border-gray-900': 'border-primary',
    'bg-white': 'bg-surface',
    'bg-gray-50': 'bg-surface-sunken',
    'bg-gray-100': 'bg-surface-control',
    'bg-gray-200': 'bg-surface-control',
    'bg-gray-300': 'bg-surface-control',
    'placeholder-gray-300': 'placeholder-text-muted',
}

# ---- section 11.3, brand ---------------------------------------------------
BRAND = {
    'bg-blue-600': 'bg-primary',
    'bg-blue-500': 'bg-primary',
    'bg-blue-400': 'bg-primary',
    'bg-blue-700': 'bg-primary-pressed',
    'bg-blue-800': 'bg-primary-pressed',
    'bg-blue-900': 'bg-primary-pressed',
    'bg-blue-950': 'bg-primary-pressed',
    'bg-blue-50': 'bg-primary-subtle',
    'bg-blue-100': 'bg-primary-subtle',
    'bg-blue-200': 'bg-primary-subtle',
    'ring-blue-500': 'ring-primary-ring',
    'ring-blue-200': 'ring-primary-ring',
    'ring-gray-900': 'ring-primary-ring',
    'text-blue-400': 'text-primary',
    'text-blue-500': 'text-primary',
    'text-blue-600': 'text-primary',
    'text-blue-700': 'text-primary',
    'text-blue-800': 'text-primary',
    'text-blue-100': 'text-primary-foreground',
    'accent-blue-600': 'accent-primary',
}
for _shade in ('100', '200', '300', '400', '500', '600', '700'):
    BRAND['border-blue-' + _shade] = 'border-primary-border'

# section 11.3: delete the class, no coloured shadow
DELETE = frozenset(['shadow-blue-200'])

# the saturated blues the bg-primary-pressed row would otherwise swallow
PRESSED_BLUE = frozenset(['bg-blue-700', 'bg-blue-800', 'bg-blue-900', 'bg-blue-950'])

# section 11.4, by role, for the four prefixes that have a row
STATUS_PREFIX = {
    'text': 'text-%s',
    'bg': 'bg-%s-bg',
    'border': 'border-%s-border',
    'ring': 'ring-%s',
}


class Unmapped(Exception):
    """A class with no section 11 row. The run stops rather than guessing."""


def migrate(path, protect=(), exceptions=(), white=(), fill=(), hover_fill=(),
            dry_run=False):
    """
    protect     {(line, base)}  left exactly as-is -- section 11.6 A-G
    exceptions  {line}          text-gray-{500,400,300} -> text-secondary (11.2)
    white       {line}          text-white -> text-primary-foreground (11.1 addendum)
    fill        {(line, base)}  saturated status BUTTON fill -> bg-<role> (11.4)
    hover_fill  {(line, base)}  its hover half -> bg-<role>-hover / primary-hover
    """
    protect, exceptions = set(protect), set(exceptions)
    white, fill, hover_fill = set(white), set(fill), set(hover_fill)

    lines = io.open(path, encoding='utf-8').read().split('\n')
    stats = {'mapped': 0, 'deleted': 0, 'left': 0}
    left_sites, problems = [], []

    for idx, line in enumerate(lines):
        n = idx + 1
        edits = []
        for m in TOKEN.finditer(line):
            base = m.group('base')
            variants = m.group('variants')
            alpha = m.group('alpha') or ''

            if (n, base) in protect:
                stats['left'] += 1
                left_sites.append((n, base))
                continue

            parts = BASE_SPLIT.match(base)
            fam = parts.group(2) if parts else None
            prefix = base.split('-')[0]
            new = None

            if base in DELETE:
                new = ''
            elif base == 'text-white':
                if n not in white:
                    problems.append((n, base, 'ground not classified as brand or status'))
                    continue
                new = 'text-primary-foreground'
            elif base == 'bg-black':
                new = 'bg-(--backdrop)'
                alpha = ''            # the token carries its own 40%
            elif variants.startswith('hover:') and base in PRESSED_BLUE:
                # section 11.3: a hover is not a pressed state. This codebase
                # writes hovers as hover:bg-blue-700, which the bg-primary-pressed
                # row would otherwise swallow. The subtle shades (50/100/200) are
                # NOT this case and take their own row.
                new = 'bg-primary-hover'
            elif (n, base) in hover_fill:
                new = 'bg-%s-hover' % role_of(fam)
            elif (n, base) in fill:
                new = 'bg-%s' % role_of(fam)
            elif base in NEUTRAL:
                new = NEUTRAL[base]
                if new == 'text-text-muted' and n in exceptions:
                    new = 'text-text-secondary'
            elif base in BRAND:
                new = BRAND[base]
            elif fam and role_of(fam):
                tmpl = STATUS_PREFIX.get(prefix)
                if tmpl is None:
                    problems.append((n, base,
                                     'section 11.4 has no row for the "%s-" prefix' % prefix))
                    continue
                new = tmpl % role_of(fam)
            else:
                problems.append((n, base, 'no section 11 row'))
                continue

            start, end = m.start(), m.end()
            if new == '':
                # A deleted class must take exactly one adjacent space with it,
                # or it leaves a double space in the class list. Prefer the
                # space after; fall back to the one before when it is last.
                if line[end:end + 1] == ' ':
                    end += 1
                elif line[start - 1:start] == ' ':
                    start -= 1
            edits.append((start, end, '' if new == '' else variants + new + alpha))

        if edits:
            buf, last = [], 0
            for start, end, rep in edits:
                buf.append(line[last:start])
                buf.append(rep)
                last = end
                stats['deleted' if rep == '' else 'mapped'] += 1
            buf.append(line[last:])
            lines[idx] = ''.join(buf)

    if problems:
        raise Unmapped(problems)
    if not dry_run:
        io.open(path, 'w', encoding='utf-8', newline='').write('\n'.join(lines))
    return stats, left_sites
