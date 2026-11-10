#!/usr/bin/env python3
"""build.py -- inline src/three.min.js and src/game.js into src/shell.html and write index.html (no network fetches)."""
import io, os, re
here = os.path.dirname(os.path.abspath(__file__))
rd = lambda p: io.open(os.path.join(here, p), encoding='utf-8').read()
three = rd('src/three.min.js')
# drop the r158 "build/three.min.js is deprecated" console.warn so the page starts with a clean console
three = re.sub(r"console\.warn\('Scripts \"build/three\.js\".*?'\),", '0,', three, count=1, flags=re.S)
assert '</script' not in three
shell = rd('src/shell.html')
a = shell.index('/*THREE*/'); shell = shell[:a] + three + shell[a + 9:]
g = shell.index('/*GAME*/'); shell = shell[:g] + rd('src/game.js') + shell[g + 8:]
io.open(os.path.join(here, 'index.html'), 'w', encoding='utf-8', newline='\n').write(shell)
print('index.html', len(shell), 'bytes')
