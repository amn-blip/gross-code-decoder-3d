/*
 * Timing view: where the FPGA decoder sits in the wider QEC control loop,
 * and the sliding-window mechanic that feeds it.
 *
 * Top: a four-lane 3D timing diagram spanning ~4 us of simulated time.
 *   Lane 0 (back)  QPU syndrome extraction — pulses on a 1 us cadence
 *                  (paper Section 1).
 *   Lane 1         Detector window processing — small blocks after each
 *                  syndrome batch (the ~60 ns latency drawn here is
 *                  illustrative; the paper doesn't isolate it).
 *   Lane 2         Relay-BP iterations — bursts of 20 iterations x 24 ns
 *                  = 480 ns per 12-cycle window (Sections 5, 7; ~20
 *                  iterations average to converge at p = 1e-3 per Figure 8b;
 *                  ~40 ns average per syndrome cycle). Each 24 ns iteration
 *                  splits into two 12 ns decoder half-cycles (Figure 5):
 *                  CNU->VNU (green) then VNU->CNU (coral), the decoder.js
 *                  colors.
 *   Lane 3 (front) Logical Pauli frame update — brief pulse at window end.
 *   A vertical "now" line sweeps during Play; the callout brackets the
 *   ~520 ns idle gap between decode end and the next batch's decode start —
 *   480 ns decode << 1 us cadence is the headline claim (Sections 1, 7).
 *
 * Bottom: three overlapping sliding windows, W = 12 syndrome cycles each,
 *   stepping right by C = 6 committed cycles (C is illustrative; any
 *   1 <= C < W is valid and the paper doesn't fix it — Section 4.1,
 *   Appendix D, Algorithm 2). Left C cells = commit region, right W-C =
 *   carry region, which the next window overlaps.
 *
 * The Speed slider is a slow-motion factor: real timescales are us, so 1x
 * (0.43 s per sweep) is too fast to read and 100x is the default.
 */

(function () {
  const container = document.getElementById("scene");
  const W = container.clientWidth;
  const H = container.clientHeight;

  // ---------- scene setup ----------
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 1000);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(W, H);
  renderer.setPixelRatio(window.devicePixelRatio);
  container.appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 0.7);
  key.position.set(5, 12, 8);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xaabbff, 0.3);
  rim.position.set(-8, -4, -5);
  scene.add(rim);

  // ---------- timeline constants (ns; sources in header comment) ----------
  const CADENCE = 1000; // syndrome cadence, Section 1
  const ITER_NS = 24; // per BP iteration, Sections 5 & 7
  const HALF_NS = 12; // decoder cycle, Figure 5
  const ITERS = 20; // avg iterations to converge at p=1e-3, Figure 8b
  const DECODE_NS = ITERS * ITER_NS; // 480 ns per window, Section 7
  const SYN_NS = 200; // visual pulse width for the extraction lane
  const DET_NS = 60; // illustrative detector-processing latency
  const PAULI_NS = 40; // visual pulse width for the frame update
  const DET_END = SYN_NS + DET_NS; // decode starts here after each batch
  const BURSTS = 4;
  const SIM_END = 4300; // wrap point, ~4 us + margin

  const X0 = -8;
  const SCALE = 16 / 4000; // world units per ns: 4 us -> 16 units
  const xOf = (t) => X0 + t * SCALE;

  // ---------- sprite label helper ----------
  function makeLabel(text, cssColor, sx, sy) {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    ctx.font = "34px -apple-system, 'Segoe UI', sans-serif";
    ctx.fillStyle = cssColor;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 512, 32);
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }),
    );
    sprite.scale.set(sx, sy, 1);
    return sprite;
  }

  // ---------- top view: four-lane timing diagram ----------
  const LANE_Z = [-1.8, -0.6, 0.6, 1.8]; // back -> front
  const laneY = (lane) => 1.3 + (3 - lane) * 0.15;
  const BLOCK_H = 0.28;
  const BLOCK_D = 0.5;

  const pulseBlocks = []; // { mesh, t0, t1 } for the coarse lanes

  function addBlock(t0, dur, lane, colorHex, track) {
    const w = Math.max(0.02, dur * SCALE - 0.006);
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, BLOCK_H, BLOCK_D),
      new THREE.MeshStandardMaterial({
        color: colorHex,
        emissive: colorHex,
        emissiveIntensity: 0.12,
        roughness: 0.55,
      }),
    );
    mesh.position.set(xOf(t0 + dur / 2), laneY(lane), LANE_Z[lane]);
    scene.add(mesh);
    if (track) pulseBlocks.push({ mesh, t0, t1: t0 + dur });
    return mesh;
  }

  // Lane baselines + microsecond ticks.
  for (let lane = 0; lane < 4; lane++) {
    const y = laneY(lane) - BLOCK_H / 2 - 0.04;
    scene.add(
      new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(X0, y, LANE_Z[lane]),
          new THREE.Vector3(X0 + 16 * 1.05, y, LANE_Z[lane]),
        ]),
        new THREE.LineBasicMaterial({ color: 0x2a3140 }),
      ),
    );
  }
  const tickPts = [];
  for (let us = 0; us <= 4; us++) {
    const x = xOf(us * 1000);
    tickPts.push(new THREE.Vector3(x, 0.85, LANE_Z[3] + 0.5), new THREE.Vector3(x, 1.0, LANE_Z[3] + 0.5));
    const lbl = makeLabel(us + " µs", "#6b7383", 1.4, 0.22);
    lbl.position.set(x, 0.72, LANE_Z[3] + 0.5);
    scene.add(lbl);
  }
  scene.add(
    new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(tickPts),
      new THREE.LineBasicMaterial({ color: 0x4a5568 }),
    ),
  );

  // Lane labels at the left edge.
  const laneNames = [
    ["QPU syndrome extraction", "#5DCAA5"],
    ["detector processing", "#9AA4B3"],
    ["Relay-BP iterations", "#1D9E75"],
    ["Pauli frame update", "#7F77DD"],
  ];
  laneNames.forEach(([text, css], lane) => {
    const lbl = makeLabel(text, css, 3.4, 0.24);
    lbl.position.set(X0 - 2.1, laneY(lane), LANE_Z[lane]);
    scene.add(lbl);
  });

  // Per-burst blocks. Batch k arrives at k us; extraction pulse leads up to
  // delivery, then detector processing, then the 480 ns decode burst.
  const bursts = []; // { halves: mesh[] }
  for (let k = 0; k < BURSTS; k++) {
    const t0 = k * CADENCE;
    addBlock(t0, SYN_NS, 0, 0x5dcaa5, true);
    addBlock(t0 + SYN_NS, DET_NS, 1, 0x9aa4b3, true);
    const halves = [];
    for (let i = 0; i < ITERS; i++) {
      const it0 = t0 + DET_END + i * ITER_NS;
      halves.push(addBlock(it0, HALF_NS, 2, 0x1d9e75, false));
      halves.push(addBlock(it0 + HALF_NS, HALF_NS, 2, 0xd85a30, false));
    }
    bursts.push({ halves });
    addBlock(t0 + DET_END + DECODE_NS, PAULI_NS, 3, 0x7f77dd, true);
  }

  // Callout bracket over the first idle gap: decode-end -> next decode-start.
  const gapT0 = DET_END + DECODE_NS; // 740
  const gapT1 = CADENCE + DET_END; // 1260 -> ~520 ns gap
  const by = laneY(2) + 0.55;
  scene.add(
    new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(xOf(gapT0), by - 0.12, LANE_Z[2]),
        new THREE.Vector3(xOf(gapT0), by, LANE_Z[2]),
        new THREE.Vector3(xOf(gapT1), by, LANE_Z[2]),
        new THREE.Vector3(xOf(gapT1), by - 0.12, LANE_Z[2]),
      ]),
      new THREE.LineBasicMaterial({ color: 0x5dcaa5 }),
    ),
  );
  const callout = makeLabel(
    "480 ns decode ≪ 1 µs cadence — ~520 ns idle",
    "#5DCAA5",
    5.6,
    0.34,
  );
  callout.position.set(xOf((gapT0 + gapT1) / 2), by + 0.3, LANE_Z[2]);
  scene.add(callout);

  // "Now" line sweeping across all four lanes.
  const nowLine = new THREE.Mesh(
    new THREE.BoxGeometry(0.03, 1.5, 4.6),
    new THREE.MeshBasicMaterial({ color: 0x5dcaa5, transparent: true, opacity: 0.5 }),
  );
  nowLine.position.set(X0, 1.55, 0);
  scene.add(nowLine);

  // ---------- bottom view: sliding windows (W=12, C=6 illustrative) ----------
  const WIN_W = 12;
  const C = 6; // any 1 <= C < W is valid; the paper doesn't fix C (Sec 4.1)
  const CELL = 0.5;
  const XB0 = -6;
  const BOT_Y = -2.3;
  const cellGeom = new THREE.BoxGeometry(CELL - 0.06, 0.22, 0.5);

  const winMats = []; // [commitMat, carryMat] per window
  for (let w = 0; w < 3; w++) {
    const commitMat = new THREE.MeshStandardMaterial({
      color: 0x1d9e75, emissive: 0x1d9e75, emissiveIntensity: 0.12, roughness: 0.55,
    });
    const carryMat = new THREE.MeshStandardMaterial({
      color: 0x7f77dd, emissive: 0x7f77dd, emissiveIntensity: 0.12, roughness: 0.55,
    });
    winMats.push([commitMat, carryMat]);
    const z = (w - 1) * 0.95; // rows front-to-back
    for (let i = 0; i < WIN_W; i++) {
      const cell = new THREE.Mesh(cellGeom, i < C ? commitMat : carryMat);
      cell.position.set(XB0 + (w * C + i + 0.5) * CELL, BOT_Y, z);
      scene.add(cell);
    }
    const lbl = makeLabel("window " + (w + 1), "#9aa4b3", 1.9, 0.24);
    lbl.position.set(XB0 + w * C * CELL - 1.15, BOT_Y + 0.05, z);
    scene.add(lbl);
  }

  const commitLbl = makeLabel("commit region (C = 6)", "#5DCAA5", 3.2, 0.26);
  commitLbl.position.set(XB0 + (C / 2) * CELL, BOT_Y + 0.55, -0.95);
  scene.add(commitLbl);
  const carryLbl = makeLabel("carry region (W − C = 6)", "#AFA9EC", 3.2, 0.26);
  carryLbl.position.set(XB0 + (C + C / 2) * CELL, BOT_Y + 0.95, -0.95);
  scene.add(carryLbl);
  const winCaption = makeLabel(
    "W = 12 sliding window, step C (Appendix D, Algorithm 2)",
    "#6b7383",
    5.4,
    0.26,
  );
  winCaption.position.set(XB0 + 6, BOT_Y - 0.55, 1.9);
  scene.add(winCaption);

  // ---------- orbit controls (r128 has no bundled OrbitControls) ----------
  // Left-drag rotates, right-drag (or shift+drag) pans the orbit target,
  // and the wheel zooms toward the cursor.
  const HOME = { yaw: 0.0, pitch: 0.35, dist: 17 };
  const MIN_DIST = 6, MAX_DIST = 35, PAN_LIMIT = 12;
  let dragging = false;
  let dragMode = "rotate";
  let prevX = 0, prevY = 0;
  let yaw = HOME.yaw;
  let pitch = HOME.pitch;
  let dist = HOME.dist;
  const target = new THREE.Vector3();

  function updateCam() {
    camera.position.set(
      target.x + dist * Math.cos(pitch) * Math.sin(yaw),
      target.y + dist * Math.sin(pitch),
      target.z + dist * Math.cos(pitch) * Math.cos(yaw),
    );
    camera.lookAt(target);
  }
  updateCam();

  const panVec = new THREE.Vector3();
  function pan(dxPix, dyPix) {
    const s = dist * 0.0016;
    panVec.setFromMatrixColumn(camera.matrixWorld, 0);
    target.addScaledVector(panVec, -dxPix * s);
    panVec.setFromMatrixColumn(camera.matrixWorld, 1);
    target.addScaledVector(panVec, dyPix * s);
    target.clampScalar(-PAN_LIMIT, PAN_LIMIT);
  }

  renderer.domElement.addEventListener("contextmenu", (e) => e.preventDefault());
  renderer.domElement.addEventListener("mousedown", (e) => {
    dragging = true;
    dragMode = e.button === 2 || e.shiftKey ? "pan" : "rotate";
    prevX = e.clientX;
    prevY = e.clientY;
  });
  window.addEventListener("mouseup", () => (dragging = false));
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - prevX;
    const dy = e.clientY - prevY;
    prevX = e.clientX;
    prevY = e.clientY;
    if (dragMode === "pan") {
      pan(dx, dy);
    } else {
      yaw -= dx * 0.005;
      pitch = Math.max(-1.3, Math.min(1.3, pitch + dy * 0.005));
    }
    updateCam();
  });
  const zoomRay = new THREE.Raycaster();
  renderer.domElement.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const oldDist = dist;
      dist = Math.max(MIN_DIST, Math.min(MAX_DIST, dist + e.deltaY * 0.02));
      // Pull the orbit target toward the point under the cursor in
      // proportion to the distance change, so zoom homes in on the cursor.
      const k = 1 - dist / oldDist;
      if (k !== 0) {
        const rect = renderer.domElement.getBoundingClientRect();
        zoomRay.setFromCamera(
          {
            x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
            y: -((e.clientY - rect.top) / rect.height) * 2 + 1,
          },
          camera,
        );
        target.lerp(
          zoomRay.ray.origin.clone().addScaledVector(zoomRay.ray.direction, oldDist),
          k,
        );
        target.clampScalar(-PAN_LIMIT, PAN_LIMIT);
      }
      updateCam();
    },
    { passive: false },
  );

  // ---------- controls ----------
  const SPEEDS = [1, 10, 100, 1000]; // slow-motion factor
  let speedIdx = 2;
  let playing = true;
  let simT = 0; // ns
  let lastT = null;

  const playBtn = document.getElementById("play");
  const resetBtn = document.getElementById("reset");
  const speedSlider = document.getElementById("speed");
  const speedLabel = document.getElementById("speedLabel");
  const simTimeEl = document.getElementById("simTime");
  const winIdxEl = document.getElementById("winIdx");
  const iterIdxEl = document.getElementById("iterIdx");

  playBtn.addEventListener("click", () => {
    playing = !playing;
    playBtn.textContent = playing ? "Pause" : "Play";
  });
  resetBtn.addEventListener("click", () => {
    simT = 0;
    yaw = HOME.yaw;
    pitch = HOME.pitch;
    dist = HOME.dist;
    target.set(0, 0, 0);
    updateCam();
  });
  speedSlider.addEventListener("input", (e) => {
    speedIdx = parseInt(e.target.value, 10);
    speedLabel.textContent = SPEEDS[speedIdx] + "×";
  });

  // ---------- animation ----------
  let prevActive = null; // currently brightened iteration half-cycle

  function animate(t) {
    requestAnimationFrame(animate);
    if (lastT === null) lastT = t;
    const dtMs = t - lastT;
    lastT = t;

    if (playing) {
      // Slow-motion factor f: 10000/f ns of sim time per real second.
      simT += ((10000 / SPEEDS[speedIdx]) * dtMs) / 1000;
      if (simT >= SIM_END) simT -= SIM_END;
    }

    nowLine.position.x = xOf(simT);

    // Coarse lanes pulse while the now line is inside them.
    for (const b of pulseBlocks) {
      b.mesh.material.emissiveIntensity = simT >= b.t0 && simT < b.t1 ? 0.85 : 0.12;
    }

    // Active iteration half-cycle: brighten and stretch it.
    const k = Math.min(BURSTS - 1, Math.floor(simT / CADENCE));
    const tIn = simT - (k * CADENCE + DET_END);
    const decoding = tIn >= 0 && tIn < DECODE_NS;
    let active = null;
    if (decoding) {
      const half = Math.floor(tIn / HALF_NS); // 0..39
      active = bursts[k].halves[half];
    }
    if (prevActive !== active) {
      if (prevActive) {
        prevActive.material.emissiveIntensity = 0.12;
        prevActive.scale.y = 1;
      }
      if (active) {
        active.material.emissiveIntensity = 1.0;
        active.scale.y = 1.7;
      }
      prevActive = active;
    }

    // Bottom view: light up the window currently being decoded.
    const activeWin = decoding ? Math.min(k, 2) : -1;
    for (let w = 0; w < 3; w++) {
      const on = w === activeWin;
      winMats[w][0].emissiveIntensity = on ? 0.6 : 0.12;
      winMats[w][1].emissiveIntensity = on ? 0.6 : 0.12;
    }

    // Readout.
    simTimeEl.textContent = (simT / 1000).toFixed(3) + " µs";
    winIdxEl.textContent = k + 1 + " / " + BURSTS;
    iterIdxEl.textContent = decoding
      ? Math.floor(tIn / ITER_NS) + 1 + " / " + ITERS
      : "idle";

    renderer.render(scene, camera);
  }
  requestAnimationFrame(animate);

  window.addEventListener("resize", () => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  });
})();
