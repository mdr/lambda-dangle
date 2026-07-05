# lambda-dangle — Plan

An interactive 3D visualisation of the untyped λ-calculus and its reduction
processes. Agreed 2026-07-03 after design interview.

## Purpose

A **teaching tool that is also a spectacle**. The job is producing "aha"
moments — what substitution actually does, why reduction order matters, why Ω
diverges — while making reduction genuinely beautiful to watch. Every design
decision is tested against: *does this help someone get β-reduction?*

## Core design decisions

### Representation: AST as a 3D tree

Terms render as node-and-edge trees: application nodes, λ nodes, variable
leaves. β-reduction animates literally — the argument subtree flies to each
bound-variable site, the λ collapses. The β-step animation *is* the
explanation.

### A visual, nameless calculus

- Variables have **no textual names** by default. A variable's identity is its
  **tether**: a visible arc linking it to its binder. Hue is redundant
  encoding (each binder gets a colour; its variables share it). Hues may
  repeat between distant scopes — the tether is ground truth.
- Consequence: variable capture is *impossible to depict*, which is honest —
  names and α-conversion are artifacts of textual notation. The visual
  calculus teaches this for free.
- **Engine: de Bruijn indices.** Capture-avoidance correct by construction, no
  fresh-name generation, highly testable. The display layer identifies
  variables structurally.
- A **"show labels" toggle** (off by default) overlays textbook-style names
  for cross-referencing; display-level priming handles collisions.

### Calculus scope

- Pure untyped λ-calculus, **β-reduction only**. η-reduction is a deferred
  toggle. No δ-rules / built-in numbers — watching `PLUS 2 3` compute through
  Church encodings is the point.
- Divergence: no step limit on manual clicking (clicking Ω forever is the
  lesson). "Run to normal form" caps at 1000 steps with a clear "gave up —
  likely divergent" message.

### Interaction: click-a-redex, full control

- Every redex in the current term glows; clicking one fires that β-step.
- Convenience transport on top: step (normal order), step (applicative
  order), run to normal form, back, reset. Full history — each step's term is
  immutable, so back/forward is free.
- Reduction order stops being abstract when you can choose wrongly and watch
  Ω spin while normal order would have finished.

### Layout: hybrid 2D tidy tree + semantic depth

- Tidy-tree (Reingold–Tilford style) layout in a plane for legibility;
  deterministic, so step-to-step animation is clean tweens and unrelated
  nodes barely move.
- The z-axis carries *meaning*, not structure: redexes lift toward the
  camera, the active substitution pops forward, binder tethers arc through
  depth so they never cross tree edges. Depth as emphasis.
- Layout is a swappable module if this disappoints.

### β-step choreography (the centerpiece)

Five phases for reducing `(λ. body) arg`:

1. **Focus** — chosen redex lifts toward camera; everything else dims.
2. **Identify** — the binder's tethers pulse: "these are the holes."
3. **Copy & fly** — the argument subtree clones (one copy per occurrence;
   zero occurrences → the argument visibly evaporates) and copies fly along
   the tether arcs. **Duplication is loud**: copies fan out from the
   original — that moment is where the cost of computation lives.
4. **Merge** — copies land, replacing variable nodes; λ and @ dissolve.
5. **Settle** — the tree tweens to its new tidy layout.

- Global speed slider (0.25×–3×) plus instant mode; animations are
  interruptible (clicking the next redex skips to end state).
- Camera: gentle auto-framing of the action, overridden while the user drags,
  with an off toggle.

### Visual language

- Deep near-black background with subtle depth cues; dark-only. The term is
  the only bright thing. Planetarium, not clip-art.
- Shape = role, readable in silhouette:
  - **λ**: torus/ring (a hole-maker), tinted with its binder hue.
  - **@**: small octahedron — pointy, "something happens here."
  - **Variable**: small sphere in its binder's hue.
- Tree edges: thin neutral tubes. Tethers: glowing bézier arcs in binder hue.
- Palette: **jewel tones** — full hue wheel, desaturated-luminous on dark.
  Informative without looking like a toy.
- Bloom post-processing (UnrealBloomPass); redexes pulse softly, hover
  brightens the @/λ pair, click fires.

### Input & presets

- Parser: `λ` or `\`, application by juxtaposition (left-assoc), parens,
  multi-binder sugar `λx y.`, bodies extend max-right. Names resolve to de
  Bruijn at parse time; unbound names are a friendly parse error. Numeral
  literals expand to Church numerals at parse time (input sugar, not δ).
- Built-in dictionary usable in input, expanded at parse time:
  `I K S TRUE FALSE AND OR NOT PAIR FST SND SUCC PLUS MULT POW ISZERO Y Ω`.
  User `let`-definitions deferred.
- Preset gallery, each with a one-line "what to watch for" caption:
  1. `I x` — the simplest possible step
  2. `K x y` — an argument gets discarded (evaporation)
  3. `(λx. x x) y` — duplication, the fan-out moment
  4. `AND TRUE FALSE` — booleans compute
  5. `PLUS 2 3` — arithmetic blooms through Church encodings
  6. `POW 2 3` — duplication compounds; the tree gets big (spectacle)
  7. `(λx. y) Ω` — strategy matters: normal order survives, applicative diverges
  8. `Ω` — the term that never finishes
  9. `Y f` — recursion unfolding, one turn of the crank at a time

### UI chrome (the scene is the app; no menus)

- **Bottom bar**: transport — reset · back · step · run · strategy choice ·
  speed slider · step counter ("step 4 · 3 redexes").
- **Left panel** (collapsible): preset gallery + term input.
- **Top-right**: toggles — labels, auto-camera.
- **Text panel** (collapsible, above transport): current term
  pretty-printed, **read-only**, with two-way hover sync (hover a 3D node ↔
  highlight the span). The bridge to textbook notation.

## Stack

- **Vite + TypeScript + vanilla Three.js.** No React — the custom animation
  timeline is imperative by nature. Plain DOM for controls.
- Deliverable: locally-run static site (`vite dev` / `vite build`).
- Structure: `src/lambda/` (pure core: parser, de Bruijn ops, evaluator,
  pretty-printer), `src/scene/` (Three.js), `src/ui/` (DOM chrome),
  layout math in the pure core.

## Engineering guardrails

- **Vitest on the pure core, written as we build**: parse↔pretty-print
  round-trips, capture-tricky substitution cases, known reduction traces
  (`PLUS 2 3` → Church 5 in expected step count; `K x Ω` normal-order
  terminates in one step), redex-enumeration correctness. Wrong-but-plausible
  animation is the worst failure mode a teaching tool can have.
- Scene layer: no automated tests; verified by eye via dev server.
- Performance: `InstancedMesh` for nodes/edges from day one; node-count badge
  in the UI; soft warning past ~2–3k nodes. Degrade honestly, no hard cap.

## Build order (each milestone independently verifiable)

1. **Core calculus** — types, parser, pretty-printer, de Bruijn machinery,
   redex enumeration, single-step β, strategies, test suite.
   *Verify: tests green; CLI-level trace of `PLUS 2 3`.*
2. **Static scene** — parse → hybrid layout → render with the visual
   language; orbit camera. No reduction.
   *Verify: load presets, eyeball.*
3. **Interaction** — redex highlighting, hover, click-to-reduce with
   instant updates; transport, history. Functionally complete here.
   *Verify: click through every preset.*
4. **Choreography** — five-phase animation, duplication fan-out, camera
   auto-framing, bloom, speed control. (After interaction on purpose:
   animation is highest-risk and needs a correct clickable app underneath.)
5. **Chrome & polish** — preset gallery captions, text panel with hover
   sync, labels toggle, node-count badge, warnings.

## Deferred (post-v1)

- η-reduction toggle
- User `let`-definitions
- Tromp-diagram alternate view
- Click-to-edit in the text panel
- Shareable term URLs
