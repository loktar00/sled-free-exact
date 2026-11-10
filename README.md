# SLED FREE

A single-page three.js pixel-look sledding game.

**Play:** https://loktar00.github.io/sled-free-exact/

## Controls

| Input | Action |
| --- | --- |
| Left / Right or A / D | Steer |
| Up or W | Brake |
| Down or S | Tuck |
| Space | Jump |
| Enter | Start or restart from the title / game-over screen |
| R | Restart the run |
| M | Sound on / off |

Touch buttons appear on touch screens, and a gamepad works too.

## Build

The game is one self-contained `index.html`. `build.py` inlines `src/three.min.js` and the game sources in `src/` into `src/shell.html`.

```sh
python build.py
```

## Credits

- 3D engine: [three.js](https://threejs.org/) (MIT).
- Sound: all effects are synthesized in the browser with the Web Audio API. There are no sampled sounds or music files.
