# λ-dangle

An interactive 3D visualisation of the untyped λ-calculus. Terms hang in
space as jewel-toned trees — rings for binders, octahedra for applications,
spheres for variables, each tethered to its binder by a glowing arc. Click a
pulsing redex and watch β-reduction happen: the argument clones, flies to
every variable site, and the tree settles into its new shape.

Design decisions and rationale live in [PLAN.md](PLAN.md).

## Running

```sh
nix develop        # or: direnv allow
npm install
npm run dev        # → http://localhost:5173
```

## Commands

| command         | what                                   |
| --------------- | -------------------------------------- |
| `npm run dev`   | dev server                             |
| `npm test`      | core calculus test suite (vitest)      |
| `npm run build` | typecheck + production build to `dist/`|

## Using it

- **Presets** (left panel) are ordered as a tiny curriculum, from `I x` to
  the Y combinator. Or type any term: `λ`/`\` binders, application by
  juxtaposition, numerals expand to Church numerals, and the standard
  combinators (`I K S TRUE FALSE AND OR NOT PAIR FST SND SUCC PLUS MULT POW
  ISZERO Y Ω`) are available by name.
- **Click a glowing octahedron** to fire that redex, or drive with the
  transport bar (step / run, normal or applicative order, history back/reset).
- Variables have no names — a variable *is* its tether to its binder (hue is
  redundant encoding). Flip on **labels** for textbook-style names.
- `Ω` can be clicked forever; **run** gives up after 1000 steps and says so.

## VR (Meta Quest)

The scene is WebXR-enabled. To use it from a headset on the same network:

```sh
VR=1 npm run dev -- --host     # serves over self-signed HTTPS (WebXR needs TLS)
```

Open `https://<your-mac-ip>:5173` in the Quest browser, accept the
certificate warning, load a term, then hit **ENTER VR** (bottom-right).
The term floats at tabletop scale in front of you.

| control                | action                                  |
| ---------------------- | --------------------------------------- |
| point + trigger        | fire the redex you're pointing at       |
| right A / B            | step / back                             |
| left X / Y             | reset / run to normal form              |
| right stick ←→ / ↑↓    | rotate / scale the term                 |

Bloom is disabled inside VR (post-processing doesn't support per-eye
rendering); everything else — choreography, presets, strategies — works
identically. Alternative to LAN HTTPS: `adb reverse tcp:5173 tcp:5173`
makes plain `http://localhost:5173` work on the headset.

## Structure

```
src/lambda/   pure core: terms (de Bruijn), parser, strategies, printer — tested
src/scene/    three.js: layout, term view, β choreography, camera, bloom
src/ui/       presets
src/main.ts   app state, history, transport, text-panel sync
```
