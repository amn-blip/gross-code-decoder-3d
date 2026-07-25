# Gross code decoder — 3D structural view

Interactive 3D visualization of the Relay-BP FPGA decoder for the [[144,12,12]]
bivariate bicycle (gross) code, based on **arXiv:2510.21600**
(Maurer et al., "Real-time decoding of the gross code memory with FPGAs").

Four views, linked by a shared side menu on every page (it docks to the left
edge on wide screens and collapses to a bar above the header on narrow
ones). The menu is ordered top-down, from the widest system context to the
silicon:

1. `timing.html` — the QEC control loop and latency budget
2. `index.html` — the Relay-BP decoding graph (algorithm level)
3. `floorplan.html` — placement across the VU19P die
4. `fabric.html` — one region at CLB granularity

## What it shows

The bipartite decoding graph at the *code level*:

- **72 CNUs** (green spheres) — one per row of `H_X`, each weight 6
- **72 left VNUs** (coral cubes) — qubits from the `A(x,y)` block
- **72 right VNUs** (purple cubes) — qubits from the `B(x,y)` block
- **Edges** — the 6 neighbors of each check, derived from the BB polynomials

Animation plays the two-cycle BP iteration in a flooding schedule:

- **Phase 0** — CNU → VNU (`µ` messages, equation 1 in the paper)
- **Phase 1** — VNU → CNU (`ν` messages, equation 2)

Two clock cycles = one complete BP iteration on the FPGA (paper Section 4.1).
The α indicator ticks `1 − 2⁻ᵗ` per iteration, matching the min-sum scaling
factor applied inside the CNU.

## Floorplan view (`floorplan.html`)

A second, independent visualization: the FPGA floorplan of the *full* decoder
as IBM placed it on an AMD VU19P, based on **paper Figure 5**. Where
`index.html` shows the logical decoding graph, `floorplan.html` shows where
that logic physically lands on silicon:

- **Thin 3D slab** — the VU19P die (4:3 aspect), split into **4 SLR bands**
  by raised ridges. SLRs are separate stacked silicon dice on an interposer,
  so the boundaries are real physical limits on wire routing.
- **12 organic colored regions** tiling the die surface — one per syndrome
  cycle of the W=12 windowed decoding matrix, generated procedurally as a
  noise-warped Voronoi tessellation (deterministic seed, same layout every
  load). The shapes are illustrative of Figure 5's blobs, not exact.
- **Unit markers** floating above each region — 6 green spheres (CNUs) and
  12 coral/purple cubes (VNUs) per region: 72 CNUs + 144 VNUs total,
  matching the palette of the graph view.
- **Routing arcs** — sparse curves between adjacent regions that sit in
  different SLRs, standing in for the SLR-crossing congestion the paper
  discusses.
- **Cycle sweep animation** — while playing, one region at a time is
  highlighted (its surface brightens, its marker cluster glows, and the
  routing arcs touching it light up), stepping through cycles t = 0…11 like
  the sliding window consuming syndrome rounds. Pause/Play halts and resumes
  the sweep; Reset returns to cycle 0 and the home camera. Clicking a region
  (or its marker cluster) jumps straight to that cycle — pause first if you
  want to stay there.

The stats readout uses only paper Table 1 / Figure 5 values: 2,106,738 LUTs
(51.56%; VNUs 67.2% and CNUs 22.6% of those), 540,767 FFs (6.62%), 14,052
LUTRAM (1.47%), 29.5 BRAM (1.37%), 58.025 W, 45 user pins, 4 ns FPGA clock,
12 ns decoder cycle (24 ns per two-cycle BP iteration).

Note the scope difference: this is IBM's VU19P floorplan for the full
[[144,12,12]]-X decoder. Aman's project targets a VU9P and scopes to
CNU + VNU only, so his eventual floorplan will look very different.

## Fabric view (`fabric.html`)

The third zoom level: one syndrome-cycle region from the floorplan, taken
down to CLB granularity. It bridges "green sphere labeled CNU" (graph view)
and "colored blob on a die" (floorplan view) to actual LUT6 gates on silicon,
for readers who know Xilinx primitives but not this paper's floorplan.

- **Region-shaped tile** (~10×8 units) with the same organic, sine-perturbed
  boundary style as the floorplan regions, so the views feel continuous. A
  faint routing-channel grid on the surface hints at the FPGA switch matrix.
- **~1,900 CLB boxes** (a 60×40 grid clipped to the blob), one
  `THREE.InstancedMesh`, colored by what each CLB implements in the Table 1
  LUT-share proportions: 67.2% VNU (coral/purple, split 50/50), 22.6% CNU
  (teal), 10.2% other BP / FSM / routing (gray). A smooth noise field drives
  the assignment so same-colored CLBs form blobby clusters rather than
  salt-and-pepper. Fixed RNG seed — identical layout every reload.
- **Showcase cluster** — one CNU (near the top-left) plus its 6 VNU
  neighbors, connected by curved traces: the weight-6 BB-polynomial
  connectivity that `index.html` shows at the graph level. Pulse dots run
  CNU→VNU during the µ phase and VNU→CNU during the ν phase on the same
  900 ms timing as `decoder.js`. Cluster sizes are *computed* from Table 1
  shares (total CLBs × share ÷ units per region), never hardcoded.
- **CNU internals** — clicking the bright CNU cluster (or the checkbox)
  splits it into the three Figure 3a blocks: *XOR tree — sign parity*,
  *dual min-finder tree*, and *α scaler (shift-subtract)*, with floating
  labels.

**Numbers caveat:** the real values are 2,106,738 total LUTs (so ≈175.6K per
region ÷12), the 67.2% / 22.6% VNU/CNU LUT shares, weight-6 checks, and the
4 ns clock. Per-region CLB counts and per-CNU / per-VNU cluster sizes are
**proportional estimates from the Table 1 percentages, not measured values**,
and are flagged "illustrative" in the UI. No authoritative LUTs-per-CLB
figure is claimed (8 LUT6s per CLB is typical for UltraScale+, but the paper
doesn't publish per-unit placement data).

## Timing view (`timing.html`)

The fourth view answers "why does 24 ns per BP iteration matter?" — it shows
where the decoder sits in the wider QEC control loop, rather than the
hardware itself (floorplan/fabric) or the graph structure (index). Two
stacked pieces in one 3D scene:

**Top — four-lane timing diagram** spanning ~4 µs, with a "now" line that
sweeps during Play and a Speed slider (a slow-motion factor: real
timescales are microseconds, so 1× is too fast to watch and 100× is the
default). How to read the four lanes, back to front:

1. **QPU syndrome extraction** (teal) — a pulse per 1 µs syndrome cadence
   (Section 1). This cadence is the deadline the decoder must beat.
2. **Detector window processing** (gray) — each syndrome batch is turned
   into detectors and queued; the short latency drawn is illustrative.
3. **Relay-BP iterations** (green/coral) — the decode burst: ~20 iterations
   (the average to converge at p = 10⁻³, Figure 8b) × 24 ns = 480 ns per
   12-cycle window (Section 7), i.e. ~40 ns per syndrome cycle. Each 24 ns
   iteration is two 12 ns decoder half-cycles, green CNU→VNU then coral
   VNU→CNU — the same colors and meaning as the graph view.
4. **Logical Pauli frame update** (purple) — the brief commit at the end of
   each window's decode.

The callout brackets the paper's headline claim: 480 ns decode ≪ 1 µs
cadence, leaving a ~520 ns idle gap before the next batch — the decoder
keeps up with the QPU in real time with margin.

**Bottom — sliding window mechanic** (Section 4.1, Appendix D, Algorithm 2):
three W = 12 windows staggered by C cycles. The left C cells of each window
are the **commit region** (corrections finalized), the right W − C cells the
**carry region** (tentative, re-decoded by the next window, which overlaps
it). C = 6 here is illustrative — any 1 ≤ C < W is valid; the paper doesn't
fix C. The window currently being decoded lights up in sync with the top
lanes.

Real numbers: 1 µs cadence, 24 ns/iteration, ~20 iterations at p = 10⁻³,
480 ns/window, 4 ns clock, 12 ns decoder cycle, W = 12. Illustrative:
detector-processing latency, C = 6.

## Structural accuracy

The connectivity comes from the BB code definition on `Z₁₂ × Z₆` with

```
A(x,y) = x³ + y + y²
B(x,y) = y³ + x + x²
```

Each check `(i, j)` connects to six variables:

```
Left  (A^T):  ((i+3) mod 12, j), (i, (j+1) mod 6), (i, (j+2) mod 6)
Right (B^T):  (i, (j+3) mod 6),  ((i+1) mod 12, j), ((i+2) mod 12, j)
```

This gives the correct weight-6 checks and degree-3 variables.

## What is NOT shown

- **Windowed decoding graph.** The actual FPGA decoder in the paper handles a
  W=12 sliding window over syndrome cycles, so the real instantiation is
  roughly 12× larger and includes detector nodes for measurement errors.
  This visualization shows only the underlying code graph.
- **CNU/VNU internals.** No XOR tree, dual min-finder, adder tree, RNG, or
  saturation logic. Refer to paper Figure 3 for those.
- **Message contents.** Edges are undirected lines here; on the FPGA each edge
  carries a 10-bit `cnu_msg_t` packed struct one direction and a signed
  int4+1 magnitude the other.
- **Windowing / commit region / detector processing.** Everything upstream and
  downstream of the core Relay-BP loop (Figure 2) is omitted.

## Running

Open `index.html` directly in a browser. Three.js r128 loads from a CDN
(`cdnjs.cloudflare.com`), so an internet connection is required for the first
load.

If you want it fully offline, download `three.min.js` from
<https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js>, drop it
next to `index.html`, and change the `<script src="...">` tag in `index.html`
to point at the local file.

## Controls

All four views share the same camera controls:

- Drag to rotate
- Right-drag (or Shift+drag) to pan
- Scroll to zoom — the zoom homes in on whatever is under the cursor
- **Reset** returns the camera home on every page

Graph-view (`index.html`) specifics:
- **Pause / Play** — halt the animation
- **Reset** — return iteration counter to 0
- **Show edges** — toggle the 432 edges
- **Auto-rotate** — toggle slow camera drift

## Files

```
gross-code-decoder-3d/
├── index.html      graph view: shell, controls, legend, footer
├── decoder.js      graph view: Three.js scene, node placement, edges, animation
├── floorplan.html  floorplan view: shell, controls, legend, stats readout
├── floorplan.js    floorplan view: die slab, SLR ridges, Voronoi regions, markers
├── fabric.html     fabric view: shell, controls, legend, readout
├── fabric.js       fabric view: region tile, instanced CLB grid, showcase CNU
├── timing.html     timing view: shell, controls, speed slider, legend
├── timing.js       timing view: four-lane timeline, now line, sliding windows
├── styles.css      shared dark theme with the same palette as the widget
└── README.md       this file
```

## Extending

Places where this can grow:

1. **Show CNU/VNU internals on click.** Each mesh currently has no click
   handler. Raycasting from `mousedown` into the mesh arrays would let a
   click on a CNU open a Figure 3a-style breakout showing XOR tree,
   dual min-finder, α multiplier, and the packed output struct.
2. **Windowed graph mode.** Add a toggle to instantiate W copies of the
   graph stacked along +Y, with syndrome-cycle edges between them. This
   would show what the FPGA actually holds.
3. **Message payload rendering.** Small floating labels near active edges
   showing sign, magnitude, and `c` selector during the CNU→VNU phase.
4. **Real convergence data.** Feed in a saved trajectory from the Rust
   reference (marginals per iteration) and drive node emissive intensity
   from actual marginal magnitudes rather than a synthetic sine pulse.

## References

- arXiv:2510.21600 — Real-time decoding of the gross code memory with FPGAs
- arXiv:2308.07915 — Bravyi et al., BB code definition
- <https://github.com/trmue/relay> — Rust reference implementation
