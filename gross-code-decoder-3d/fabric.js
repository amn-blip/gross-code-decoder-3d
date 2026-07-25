/*
 * Fabric view: one syndrome-cycle region from floorplan.html, zoomed down to
 * CLB granularity — the bridge from "green sphere labeled CNU" to actual
 * LUT6 gates on silicon.
 *
 * Scene:
 *   - One organic region-shaped tile (~10x8 units, styled like a cycle-5
 *     blob from the floorplan view) with a faint grid hinting at the FPGA
 *     switch matrix underneath.
 *   - A 60x40 grid of CLB boxes clipped to the blob (~1,900 kept), rendered
 *     as a single THREE.InstancedMesh. Colors follow paper Table 1's LUT
 *     shares: 67.2% VNU (coral/purple, 50/50), 22.6% CNU (teal), 10.2%
 *     other BP / FSM / routing (gray). A smooth value-noise field drives the
 *     assignment so same-colored CLBs form blobby clusters, not
 *     salt-and-pepper. Fixed RNG seed -> identical layout every load.
 *   - Showcase: one CNU cluster (near the top-left) plus its 6 VNU
 *     neighbors, sized proportionally (total_CLBs * share / units_per_region,
 *     never hardcoded), connected by curved traces with pulse dots that
 *     follow the decoder.js phase timing (900 ms per phase): CNU->VNU during
 *     the mu phase, VNU->CNU during the nu phase.
 *   - Optional internals: the CNU cluster splits into the three Figure 3a
 *     blocks — XOR tree (sign parity), dual min-finder tree, alpha scaler.
 *
 * Per-unit CLB counts are proportional estimates, flagged as illustrative in
 * the UI; nothing here claims measured placement data.
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

  // ---------- deterministic RNG ----------
  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rand = mulberry32(0xfab41c);

  // ---------- region-shaped tile (organic Voronoi look, ~10x8) ----------
  const RX = 5; // x semi-axis
  const RZ = 4; // z semi-axis
  const TILE_T = 0.25;
  const TOP_Y = TILE_T;

  // Radius multiplier vs angle: same sine-perturbed style as floorplan.js.
  function blobW(th) {
    return (
      1 +
      0.14 * Math.sin(3 * th + 1.2) +
      0.1 * Math.sin(5 * th + 4.0) +
      0.05 * Math.sin(7 * th + 2.6)
    );
  }
  // ExtrudeGeometry.rotateX(-PI/2) maps shape (sx, sy) -> world (sx, -sy),
  // so the inside test uses v = -z to stay consistent with the outline.
  function inside(x, z, margin) {
    const u = x / RX;
    const v = -z / RZ;
    const th = Math.atan2(v, u);
    return Math.hypot(u, v) <= blobW(th) * (margin || 1);
  }

  const shape = new THREE.Shape();
  const OUTLINE = 96;
  for (let k = 0; k <= OUTLINE; k++) {
    const th = (k / OUTLINE) * Math.PI * 2;
    const w = blobW(th);
    const px = RX * Math.cos(th) * w;
    const py = RZ * Math.sin(th) * w;
    if (k === 0) shape.moveTo(px, py);
    else shape.lineTo(px, py);
  }
  const tileGeom = new THREE.ExtrudeGeometry(shape, { depth: TILE_T, bevelEnabled: false });
  tileGeom.rotateX(-Math.PI / 2);
  const tile = new THREE.Mesh(
    tileGeom,
    new THREE.MeshStandardMaterial({ color: 0x161c26, roughness: 0.8 }),
  );
  scene.add(tile);

  // Faint routing-channel grid on the tile top (switch-matrix hint).
  const gridPts = [];
  const CHANNEL = 0.5;
  const STEP = 0.25;
  for (let x = -RX * 1.2; x <= RX * 1.2; x += CHANNEL) {
    for (let z = -RZ * 1.2; z <= RZ * 1.2 - STEP; z += STEP) {
      if (inside(x, z, 0.98) && inside(x, z + STEP, 0.98)) {
        gridPts.push(new THREE.Vector3(x, TOP_Y + 0.002, z), new THREE.Vector3(x, TOP_Y + 0.002, z + STEP));
      }
    }
  }
  for (let z = -RZ * 1.2; z <= RZ * 1.2; z += CHANNEL) {
    for (let x = -RX * 1.2; x <= RX * 1.2 - STEP; x += STEP) {
      if (inside(x, z, 0.98) && inside(x + STEP, z, 0.98)) {
        gridPts.push(new THREE.Vector3(x, TOP_Y + 0.002, z), new THREE.Vector3(x + STEP, TOP_Y + 0.002, z));
      }
    }
  }
  scene.add(
    new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(gridPts),
      new THREE.LineBasicMaterial({ color: 0x2a3140, transparent: true, opacity: 0.5 }),
    ),
  );

  // ---------- CLB grid (instanced) ----------
  const GRID_X = 60;
  const GRID_Z = 40;
  const dx = (2 * RX) / GRID_X;
  const dz = (2 * RZ) / GRID_Z;

  const cells = []; // { x, z, ix, iz }
  const cellAt = new Map(); // ix*1000+iz -> cell index
  for (let ix = 0; ix < GRID_X; ix++) {
    for (let iz = 0; iz < GRID_Z; iz++) {
      const x = -RX + (ix + 0.5) * dx;
      const z = -RZ + (iz + 0.5) * dz;
      if (!inside(x, z, 0.96)) continue;
      cellAt.set(ix * 1000 + iz, cells.length);
      cells.push({ x, z, ix, iz });
    }
  }
  const N = cells.length;

  // Smooth value-noise field -> rank-based category assignment gives exact
  // Table 1 proportions while clustering same-colored CLBs into blobs.
  const p1 = rand() * 6, p2 = rand() * 6, p3 = rand() * 6, p4 = rand() * 6;
  function catNoise(x, z) {
    return (
      Math.sin(0.9 * x + 1.6 * z + p1) +
      0.7 * Math.sin(1.8 * x - 1.1 * z + p2) +
      0.5 * Math.sin(0.5 * x + 2.4 * z + p3) +
      0.3 * Math.sin(2.8 * x + 0.4 * z + p4)
    );
  }
  const q1 = rand() * 6, q2 = rand() * 6, q3 = rand() * 6;
  function splitNoise(x, z) {
    return (
      Math.sin(1.3 * x - 1.8 * z + q1) +
      0.7 * Math.sin(2.2 * x + 0.9 * z + q2) +
      0.4 * Math.sin(0.7 * x + 3.1 * z + q3)
    );
  }

  const CAT_CNU = 0, CAT_VNU_L = 1, CAT_VNU_R = 2, CAT_OTHER = 3;
  const catValues = cells.map((c) => catNoise(c.x, c.z) + 0.35 * rand());
  const order = cells.map((_, i) => i).sort((a, b) => catValues[a] - catValues[b]);
  const nCnu = Math.round(N * 0.226);
  const nVnu = Math.round(N * 0.672);
  const category = new Uint8Array(N);
  order.forEach((idx, rank) => {
    category[idx] = rank < nCnu ? CAT_CNU : rank < nCnu + nVnu ? CAT_VNU_L : CAT_OTHER;
  });
  // Split VNU cells 50/50 coral vs purple around the median of a second field.
  const vnuIdx = [];
  for (let i = 0; i < N; i++) if (category[i] === CAT_VNU_L) vnuIdx.push(i);
  vnuIdx
    .slice()
    .sort((a, b) => splitNoise(cells[a].x, cells[a].z) - splitNoise(cells[b].x, cells[b].z))
    .forEach((idx, rank) => {
      if (rank >= vnuIdx.length / 2) category[idx] = CAT_VNU_R;
    });

  const catColor = [
    new THREE.Color(0x1d9e75), // CNU teal
    new THREE.Color(0xd85a30), // VNU coral
    new THREE.Color(0x7f77dd), // VNU purple
    new THREE.Color(0x4a5568), // other / FSM / routing
  ];
  const baseColors = [];
  for (let i = 0; i < N; i++) {
    baseColors.push(catColor[category[i]].clone().multiplyScalar(0.82 + 0.25 * rand()));
  }

  const clbGeom = new THREE.BoxGeometry(0.13, 0.08, 0.15);
  const clbMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
  const clbs = new THREE.InstancedMesh(clbGeom, clbMat, N);
  const CLB_Y = TOP_Y + 0.04 + 0.002;
  const tmpMat = new THREE.Matrix4();
  const tmpPos = new THREE.Vector3();
  const tmpQuat = new THREE.Quaternion();
  const tmpScale = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    tmpMat.setPosition(cells[i].x, CLB_Y, cells[i].z);
    clbs.setMatrixAt(i, tmpMat);
    clbs.setColorAt(i, baseColors[i]);
  }
  scene.add(clbs);

  // ---------- showcase: one CNU + its 6 VNU neighbors ----------
  // Cluster sizes are computed from Table 1 shares, never hardcoded:
  // each region holds 72 CNUs and 144 VNUs.
  const perCnu = Math.max(1, Math.round((N * 0.226) / 72));
  const perVnu = Math.max(1, Math.round((N * 0.672) / 144));

  document.getElementById("clbCount").textContent =
    "≈ " + N.toLocaleString("en-US") + " (illustrative)";
  document.getElementById("cnuClb").textContent =
    "≈ " + perCnu + " CLBs per CNU (illustrative)";

  // BFS over grid neighbors from a seed, claiming `size` unclaimed cells.
  const claimed = new Uint8Array(N);
  function growCluster(seedIdx, size) {
    const out = [];
    const queue = [seedIdx];
    const seen = new Set([seedIdx]);
    while (queue.length && out.length < size) {
      const i = queue.shift();
      if (!claimed[i]) {
        claimed[i] = 1;
        out.push(i);
      }
      const { ix, iz } = cells[i];
      for (const [nx, nz] of [[ix + 1, iz], [ix - 1, iz], [ix, iz + 1], [ix, iz - 1]]) {
        const j = cellAt.get(nx * 1000 + nz);
        if (j !== undefined && !seen.has(j)) {
          seen.add(j);
          queue.push(j);
        }
      }
    }
    return out;
  }

  // CNU seed: a teal cell toward the top-left, kept a bit inside the blob.
  let cnuSeed = -1;
  let bestScore = Infinity;
  for (let i = 0; i < N; i++) {
    if (category[i] !== CAT_CNU) continue;
    if (!inside(cells[i].x, cells[i].z, 0.75)) continue;
    const score = cells[i].x + cells[i].z;
    if (score < bestScore) {
      bestScore = score;
      cnuSeed = i;
    }
  }
  if (cnuSeed < 0) cnuSeed = order[0]; // cannot happen with 22.6% teal, but be safe
  const cnuCluster = growCluster(cnuSeed, perCnu);
  const cnuSet = new Set(cnuCluster);

  function clusterCentroid(list, y) {
    const c = new THREE.Vector3();
    for (const i of list) c.add(new THREE.Vector3(cells[i].x, 0, cells[i].z));
    c.divideScalar(list.length);
    c.y = y;
    return c;
  }
  const cnuCenter = clusterCentroid(cnuCluster, TOP_Y + 0.14);

  // 6 VNU clusters around the CNU: nearest VNU-colored cell to each of six
  // target points ~2.2 units out.
  const vnuClusters = [];
  const vnuOf = new Map(); // cell index -> vnu cluster number
  for (let k = 0; k < 6; k++) {
    const ang = (k / 6) * Math.PI * 2 + 0.35;
    const tx = cnuCenter.x + 2.2 * Math.cos(ang);
    const tz = cnuCenter.z + 2.2 * Math.sin(ang);
    let seed = -1;
    let bestD = Infinity;
    for (let i = 0; i < N; i++) {
      if (claimed[i]) continue;
      if (category[i] !== CAT_VNU_L && category[i] !== CAT_VNU_R) continue;
      const d = (cells[i].x - tx) ** 2 + (cells[i].z - tz) ** 2;
      if (d < bestD) {
        bestD = d;
        seed = i;
      }
    }
    const cluster = growCluster(seed, perVnu);
    for (const i of cluster) vnuOf.set(i, k);
    vnuClusters.push(cluster);
  }

  const HI_CNU = new THREE.Color(0x5dcaa5);
  const HI_VNU = [new THREE.Color(0xf0997b), new THREE.Color(0xafa9ec)]; // coral / purple, alternating

  // ---------- CNU internals (paper Figure 3a sub-blocks) ----------
  // Partition the CNU cluster in BFS-discovery order: small A, larger B, tiny C.
  const nA = Math.max(1, Math.round(cnuCluster.length * 0.3));
  const nC = Math.max(1, Math.round(cnuCluster.length * 0.15));
  const subColor = new Map(); // cell index -> color
  const subA = [], subB = [], subC = [];
  cnuCluster.forEach((idx, k) => {
    if (k < nA) {
      subA.push(idx);
      subColor.set(idx, new THREE.Color(0x2e8fa3));
    } else if (k >= cnuCluster.length - nC) {
      subC.push(idx);
      subColor.set(idx, new THREE.Color(0xd2f0e4));
    } else {
      subB.push(idx);
      subColor.set(idx, new THREE.Color(0x5dcaa5));
    }
  });

  function makeLabel(text, cssColor) {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 48;
    const ctx = canvas.getContext("2d");
    ctx.font = "26px -apple-system, 'Segoe UI', sans-serif";
    ctx.fillStyle = cssColor;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 256, 24);
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }),
    );
    sprite.scale.set(3.4, 0.32, 1);
    return sprite;
  }

  const labelGroup = new THREE.Group();
  const labelDefs = [
    [subA, "XOR tree — sign parity", "#2E8FA3", 0.75],
    [subB, "dual min-finder tree", "#5DCAA5", 1.05],
    [subC, "α scaler (shift-subtract)", "#D2F0E4", 1.35],
  ];
  for (const [list, text, css, h] of labelDefs) {
    const label = makeLabel(text, css);
    const c = clusterCentroid(list, TOP_Y + h);
    label.position.copy(c);
    labelGroup.add(label);
  }
  labelGroup.visible = false;
  scene.add(labelGroup);

  // ---------- traces + pulse dots ----------
  const traceGroup = new THREE.Group();
  scene.add(traceGroup);
  const traces = [];
  for (let k = 0; k < 6; k++) {
    const end = clusterCentroid(vnuClusters[k], TOP_Y + 0.14);
    const mid = cnuCenter.clone().lerp(end, 0.5);
    mid.y = TOP_Y + 1.1;
    const curve = new THREE.QuadraticBezierCurve3(cnuCenter, mid, end);
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(curve.getPoints(32)),
      new THREE.LineBasicMaterial({ color: 0x9aa4b3, transparent: true, opacity: 0.3 }),
    );
    traceGroup.add(line);
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0x5dcaa5 }),
    );
    traceGroup.add(dot);
    traces.push({ curve, line, dot, vnuColor: HI_VNU[k % 2] });
  }

  // ---------- state + recoloring ----------
  let highlightOn = true;
  let internalsOn = false;
  let tracesOn = true;

  function applyState() {
    for (let i = 0; i < N; i++) {
      let color = baseColors[i];
      let tall = false;
      if (highlightOn && cnuSet.has(i)) {
        color = internalsOn ? subColor.get(i) : HI_CNU;
        tall = true;
      } else if (highlightOn && vnuOf.has(i)) {
        color = HI_VNU[vnuOf.get(i) % 2];
        tall = true;
      }
      clbs.setColorAt(i, color);
      tmpPos.set(cells[i].x, CLB_Y, cells[i].z);
      tmpScale.set(1, tall ? 2 : 1, 1);
      tmpMat.compose(tmpPos, tmpQuat, tmpScale);
      clbs.setMatrixAt(i, tmpMat);
    }
    clbs.instanceColor.needsUpdate = true;
    clbs.instanceMatrix.needsUpdate = true;
    traceGroup.visible = highlightOn && tracesOn;
    labelGroup.visible = highlightOn && internalsOn;
  }
  applyState();

  // ---------- orbit controls (r128 has no bundled OrbitControls) ----------
  // Left-drag rotates, right-drag (or shift+drag) pans the orbit target,
  // and the wheel zooms toward the cursor.
  const HOME = { yaw: 0.18, pitch: 0.72, dist: 11.5 };
  const MIN_DIST = 5, MAX_DIST = 26, PAN_LIMIT = 8;
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
  let playing = true;
  let autoRotate = false;
  let phase = 0; // 0 = mu (CNU->VNU), 1 = nu (VNU->CNU)
  let phaseStart = performance.now();
  const PHASE_MS = 900; // same timing as decoder.js

  const playBtn = document.getElementById("play");
  const resetBtn = document.getElementById("reset");
  const highlightToggle = document.getElementById("highlightCNU");
  const internalsToggle = document.getElementById("showInternals");
  const tracesToggle = document.getElementById("showTraces");
  const rotateToggle = document.getElementById("autoRotate");

  playBtn.addEventListener("click", () => {
    playing = !playing;
    playBtn.textContent = playing ? "Pause" : "Play";
    if (playing) phaseStart = performance.now();
  });
  resetBtn.addEventListener("click", () => {
    phase = 0;
    phaseStart = performance.now();
    yaw = HOME.yaw;
    pitch = HOME.pitch;
    dist = HOME.dist;
    target.set(0, 0, 0);
    updateCam();
  });
  highlightToggle.addEventListener("change", (e) => {
    highlightOn = e.target.checked;
    applyState();
  });
  internalsToggle.addEventListener("change", (e) => {
    internalsOn = e.target.checked;
    applyState();
  });
  tracesToggle.addEventListener("change", (e) => {
    tracesOn = e.target.checked;
    applyState();
  });
  rotateToggle.addEventListener("change", (e) => {
    autoRotate = e.target.checked;
  });

  // Click the highlighted CNU cluster to toggle the internals breakdown.
  const raycaster = new THREE.Raycaster();
  const mouseNDC = new THREE.Vector2();
  let downX = 0, downY = 0;
  renderer.domElement.addEventListener("mousedown", (e) => {
    downX = e.clientX;
    downY = e.clientY;
  });
  renderer.domElement.addEventListener("click", (e) => {
    if (Math.abs(e.clientX - downX) > 5 || Math.abs(e.clientY - downY) > 5) return;
    if (!highlightOn) return;
    const rect = renderer.domElement.getBoundingClientRect();
    mouseNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouseNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouseNDC, camera);
    const hit = raycaster.intersectObject(clbs)[0];
    if (hit && hit.instanceId !== undefined && cnuSet.has(hit.instanceId)) {
      internalsOn = !internalsOn;
      internalsToggle.checked = internalsOn;
      applyState();
    }
  });

  // ---------- animation ----------
  function animate(t) {
    requestAnimationFrame(animate);

    if (playing) {
      if (t - phaseStart >= PHASE_MS) {
        phaseStart = t;
        phase = 1 - phase;
      }
      const p = Math.min(1, (t - phaseStart) / PHASE_MS);
      for (const tr of traces) {
        // mu phase: dot runs CNU -> VNU (teal); nu phase: back, VNU-colored.
        if (phase === 0) {
          tr.dot.position.copy(tr.curve.getPoint(p));
          tr.dot.material.color.copy(HI_CNU);
        } else {
          tr.dot.position.copy(tr.curve.getPoint(1 - p));
          tr.dot.material.color.copy(tr.vnuColor);
        }
        tr.line.material.opacity = 0.22 + 0.25 * Math.sin(p * Math.PI);
      }

      if (autoRotate) {
        yaw += 0.0015;
        updateCam();
      }
    }

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
