/*
 * VU19P floorplan view of the gross code Relay-BP decoder (paper Figure 5).
 *
 * Scene:
 *   - Thin slab = the AMD VU19P die (4:3 aspect, extruded 0.5 in Y).
 *   - 3 raised ridges split the die into 4 horizontal bands = the 4 SLRs
 *     (silicon-interposer stacking; real physical limits on wire routing).
 *   - 12 organic colored regions tile the top surface, one per syndrome
 *     cycle of the W=12 windowed decoding matrix. Generated as a Voronoi
 *     tessellation of 12 seeds with a sine-noise domain warp, rasterized
 *     onto a fine quad grid with per-quad vertex colors (no gaps possible).
 *   - Above each region, a small floating cluster of 6 CNU spheres (green)
 *     and 12 VNU cubes (coral/purple): 72 CNUs + 144 VNUs total.
 *   - Sparse arcs between adjacent regions that sit in different SLRs,
 *     representing SLR-crossing wire congestion.
 *
 * Utilization numbers shown in the page come from paper Table 1 / Figure 5;
 * nothing here is invented.
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

  // ---------- die slab ----------
  const DIE_W = 12; // x
  const DIE_D = 9; // z  (4:3 with DIE_W)
  const DIE_T = 0.5; // y
  const TOP_Y = DIE_T / 2;

  const die = new THREE.Mesh(
    new THREE.BoxGeometry(DIE_W, DIE_T, DIE_D),
    new THREE.MeshStandardMaterial({ color: 0x1c2330, roughness: 0.7 }),
  );
  scene.add(die);

  // 4 SLRs = 4 bands along z, separated by 3 raised ridges.
  const SLR_COUNT = 4;
  const ridgeGeom = new THREE.BoxGeometry(DIE_W + 0.04, 0.12, 0.08);
  const ridgeMat = new THREE.MeshStandardMaterial({ color: 0x0b0e14, roughness: 0.5 });
  for (let k = 1; k < SLR_COUNT; k++) {
    const ridge = new THREE.Mesh(ridgeGeom, ridgeMat);
    ridge.position.set(0, TOP_Y + 0.03, -DIE_D / 2 + (k * DIE_D) / SLR_COUNT);
    scene.add(ridge);
  }
  function slrOf(z) {
    return Math.max(0, Math.min(SLR_COUNT - 1, Math.floor(((z + DIE_D / 2) / DIE_D) * SLR_COUNT)));
  }

  // ---------- deterministic RNG (fixed layout every load) ----------
  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rand = mulberry32(0x5eed);

  // ---------- 12 syndrome-cycle regions (warped Voronoi) ----------
  // Seeds on a 4x3 grid with jitter; colors interleave the three palette
  // families so spatial neighbors land in different families.
  const REGIONS = 12;
  const palette = [
    [0x157a5a, 0x1d9e75, 0x5dcaa5, 0x2e8fa3], // teal ramp
    [0xa8431f, 0xd85a30, 0xe87f56, 0xf0997b], // coral ramp
    [0x5c54b8, 0x7f77dd, 0x9790e5, 0xafa9ec], // purple ramp
  ];
  const seeds = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      const k = r * 4 + c;
      seeds.push({
        x: -DIE_W / 2 + (c + 0.5) * (DIE_W / 4) + (rand() - 0.5) * 1.4,
        z: -DIE_D / 2 + (r + 0.5) * (DIE_D / 3) + (rand() - 0.5) * 1.1,
        color: new THREE.Color(palette[k % 3][Math.floor(k / 3)]),
      });
    }
  }

  // Sine-noise domain warp makes the Voronoi boundaries organic.
  function warpX(x, z) {
    return (
      Math.sin(x * 1.9 + z * 1.3 + 1.7) * 0.45 +
      Math.sin(x * 0.7 - z * 2.1 + 4.2) * 0.3 +
      Math.sin(z * 3.3 + 0.5) * 0.15
    );
  }
  function warpZ(x, z) {
    return (
      Math.sin(z * 1.7 - x * 1.1 + 0.9) * 0.45 +
      Math.sin(x * 2.4 + z * 0.8 + 2.6) * 0.3 +
      Math.sin(x * 3.1 + 5.1) * 0.15
    );
  }
  function regionOf(x, z) {
    const px = x + 0.65 * warpX(x, z);
    const pz = z + 0.65 * warpZ(x, z);
    let best = 0;
    let bestD = Infinity;
    for (let s = 0; s < REGIONS; s++) {
      const dx = px - seeds[s].x;
      const dz = pz - seeds[s].z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  // Rasterize the tessellation onto a quad grid with vertex colors.
  const NX = 132;
  const NZ = 99;
  const cellX = DIE_W / NX;
  const cellZ = DIE_D / NZ;
  const OVERLAY_Y = TOP_Y + 0.004;

  const positions = new Float32Array(NX * NZ * 6 * 3);
  const colors = new Float32Array(NX * NZ * 6 * 3);
  const centroid = [];
  for (let s = 0; s < REGIONS; s++) centroid.push({ x: 0, z: 0, n: 0 });
  const adjacency = new Set();
  const quadRegion = new Uint8Array(NX * NZ);
  const qc = new THREE.Color();

  let ptr = 0;
  for (let ix = 0; ix < NX; ix++) {
    for (let iz = 0; iz < NZ; iz++) {
      const x0 = -DIE_W / 2 + ix * cellX;
      const z0 = -DIE_D / 2 + iz * cellZ;
      const cx = x0 + cellX / 2;
      const cz = z0 + cellZ / 2;
      const reg = regionOf(cx, cz);
      quadRegion[ix * NZ + iz] = reg;
      centroid[reg].x += cx;
      centroid[reg].z += cz;
      centroid[reg].n++;

      // Neighbor samples: darken boundary quads, record region adjacency.
      const rRight = regionOf(cx + cellX, cz);
      const rDown = regionOf(cx, cz + cellZ);
      if (rRight !== reg) adjacency.add(Math.min(reg, rRight) * REGIONS + Math.max(reg, rRight));
      if (rDown !== reg) adjacency.add(Math.min(reg, rDown) * REGIONS + Math.max(reg, rDown));
      const boundary = rRight !== reg || rDown !== reg ||
        regionOf(cx - cellX, cz) !== reg || regionOf(cx, cz - cellZ) !== reg;

      const jitter = 0.93 + 0.1 * ((Math.sin(ix * 12.9898 + iz * 78.233) * 43758.5453) % 1 * 0.5 + 0.5);
      qc.copy(seeds[reg].color).multiplyScalar(boundary ? 0.5 : jitter);

      // Two triangles per quad.
      const verts = [
        [x0, z0], [x0, z0 + cellZ], [x0 + cellX, z0],
        [x0 + cellX, z0], [x0, z0 + cellZ], [x0 + cellX, z0 + cellZ],
      ];
      for (const [vx, vz] of verts) {
        positions[ptr] = vx;
        positions[ptr + 1] = OVERLAY_Y;
        positions[ptr + 2] = vz;
        colors[ptr] = qc.r;
        colors[ptr + 1] = qc.g;
        colors[ptr + 2] = qc.b;
        ptr += 3;
      }
    }
  }
  for (const c of centroid) {
    c.x /= c.n;
    c.z /= c.n;
  }
  const baseColors = colors.slice();

  const overlayGeom = new THREE.BufferGeometry();
  overlayGeom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  overlayGeom.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < normals.length; i += 3) normals[i + 1] = 1;
  overlayGeom.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  const overlay = new THREE.Mesh(
    overlayGeom,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 }),
  );
  scene.add(overlay);

  // Brighten the active syndrome cycle's region, dim the rest.
  const colorAttr = overlayGeom.getAttribute("color");
  function applyCycle(active) {
    for (let q = 0; q < NX * NZ; q++) {
      const f = quadRegion[q] === active ? 1.45 : 0.5;
      const base = q * 18;
      for (let i = 0; i < 18; i++) colors[base + i] = baseColors[base + i] * f;
    }
    colorAttr.needsUpdate = true;
  }

  // ---------- CNU / VNU unit markers (72 + 144, scaled way down) ----------
  const markerGroup = new THREE.Group();
  scene.add(markerGroup);

  const cnuGeom = new THREE.SphereGeometry(0.055, 10, 8);
  const vnuGeom = new THREE.BoxGeometry(0.09, 0.09, 0.09);
  const cnuProto = new THREE.MeshStandardMaterial({
    color: 0x1d9e75, emissive: 0x0a3d2c, emissiveIntensity: 0.3, roughness: 0.5,
  });
  const vnuLProto = new THREE.MeshStandardMaterial({
    color: 0xd85a30, emissive: 0x3d1408, emissiveIntensity: 0.3, roughness: 0.5,
  });
  const vnuRProto = new THREE.MeshStandardMaterial({
    color: 0x7f77dd, emissive: 0x1a1440, emissiveIntensity: 0.3, roughness: 0.5,
  });

  // Per-region material clones so the active cycle's cluster can glow alone.
  const regionMats = [];
  const stemPts = [];
  for (let s = 0; s < REGIONS; s++) {
    const c = centroid[s];
    const spin = rand() * Math.PI * 2;
    const cnuMat = cnuProto.clone();
    const vnuLMat = vnuLProto.clone();
    const vnuRMat = vnuRProto.clone();
    regionMats.push([cnuMat, vnuLMat, vnuRMat]);
    // 6 CNUs on an inner ring, higher up.
    for (let i = 0; i < 6; i++) {
      const a = spin + (i / 6) * Math.PI * 2;
      const x = c.x + 0.24 * Math.cos(a);
      const z = c.z + 0.24 * Math.sin(a);
      const y = 0.72 + 0.05 * Math.sin(a * 3);
      const m = new THREE.Mesh(cnuGeom, cnuMat);
      m.userData.region = s;
      m.position.set(x, y, z);
      markerGroup.add(m);
      stemPts.push(new THREE.Vector3(x, OVERLAY_Y, z), new THREE.Vector3(x, y, z));
    }
    // 12 VNUs on an outer ring, lower, alternating coral / purple.
    for (let i = 0; i < 12; i++) {
      const a = spin + 0.26 + (i / 12) * Math.PI * 2;
      const x = c.x + 0.5 * Math.cos(a);
      const z = c.z + 0.5 * Math.sin(a);
      const y = 0.52 + 0.04 * Math.sin(a * 4);
      const m = new THREE.Mesh(vnuGeom, i % 2 === 0 ? vnuLMat : vnuRMat);
      m.userData.region = s;
      m.position.set(x, y, z);
      markerGroup.add(m);
      stemPts.push(new THREE.Vector3(x, OVERLAY_Y, z), new THREE.Vector3(x, y, z));
    }
  }
  const stems = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(stemPts),
    new THREE.LineBasicMaterial({ color: 0x4a5568, transparent: true, opacity: 0.15 }),
  );
  markerGroup.add(stems);

  // ---------- routing arcs (sparse: only adjacent regions in different SLRs) ----------
  const routingGroup = new THREE.Group();
  scene.add(routingGroup);
  const routingLines = [];
  const routingMat = new THREE.LineBasicMaterial({
    color: 0x5dcaa5, transparent: true, opacity: 0.35,
  });

  for (const key of adjacency) {
    const a = Math.floor(key / REGIONS);
    const b = key % REGIONS;
    const ca = centroid[a];
    const cb = centroid[b];
    if (slrOf(ca.z) === slrOf(cb.z)) continue; // only SLR-crossing nets
    const p0 = new THREE.Vector3(ca.x, TOP_Y + 0.05, ca.z);
    const p1 = new THREE.Vector3(cb.x, TOP_Y + 0.05, cb.z);
    const mid = p0.clone().lerp(p1, 0.5);
    mid.y = 1.15 + 0.12 * p0.distanceTo(p1);
    const curve = new THREE.QuadraticBezierCurve3(p0, mid, p1);
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(curve.getPoints(28)),
      routingMat.clone(),
    );
    line.userData = { a, b };
    routingGroup.add(line);
    routingLines.push(line);
  }

  // ---------- orbit controls (r128 has no bundled OrbitControls) ----------
  // Left-drag rotates, right-drag (or shift+drag) pans the orbit target,
  // and the wheel zooms toward the cursor.
  const HOME = { yaw: 0.55, pitch: 0.62, dist: 15 };
  const MIN_DIST = 7, MAX_DIST = 35, PAN_LIMIT = 10;
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
  let cycle = 0;
  let cycleStart = performance.now();
  const CYCLE_MS = 900;

  const playBtn = document.getElementById("play");
  const resetBtn = document.getElementById("reset");
  const cycleEl = document.getElementById("cycle");
  const routingToggle = document.getElementById("showRouting");
  const markersToggle = document.getElementById("showMarkers");
  const rotateToggle = document.getElementById("autoRotate");

  function setCycle(c) {
    cycle = c;
    cycleEl.textContent = c + " / 11";
    applyCycle(c);
  }
  setCycle(0);

  // Click a region (or its marker cluster) to jump to that syndrome cycle.
  // A real click is distinguished from an orbit drag by mouse travel < 5px.
  const raycaster = new THREE.Raycaster();
  const mouseNDC = new THREE.Vector2();
  let downX = 0, downY = 0;
  renderer.domElement.addEventListener("mousedown", (e) => {
    downX = e.clientX;
    downY = e.clientY;
  });
  renderer.domElement.addEventListener("click", (e) => {
    if (Math.abs(e.clientX - downX) > 5 || Math.abs(e.clientY - downY) > 5) return;
    const rect = renderer.domElement.getBoundingClientRect();
    mouseNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouseNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouseNDC, camera);
    const targets = markerGroup.visible ? [overlay, ...markerGroup.children] : [overlay];
    for (const hit of raycaster.intersectObjects(targets, false)) {
      if (hit.object === overlay) {
        // Non-indexed grid geometry: 2 triangles per quad, in write order.
        setCycle(quadRegion[Math.floor(hit.faceIndex / 2)]);
        cycleStart = performance.now();
        return;
      }
      if (hit.object.userData.region !== undefined) {
        setCycle(hit.object.userData.region);
        cycleStart = performance.now();
        return;
      }
    }
  });

  playBtn.addEventListener("click", () => {
    playing = !playing;
    playBtn.textContent = playing ? "Pause" : "Play";
    if (playing) cycleStart = performance.now();
  });
  resetBtn.addEventListener("click", () => {
    setCycle(0);
    cycleStart = performance.now();
    yaw = HOME.yaw;
    pitch = HOME.pitch;
    dist = HOME.dist;
    target.set(0, 0, 0);
    updateCam();
  });
  routingToggle.addEventListener("change", (e) => {
    routingGroup.visible = e.target.checked;
  });
  markersToggle.addEventListener("change", (e) => {
    markerGroup.visible = e.target.checked;
  });
  rotateToggle.addEventListener("change", (e) => {
    autoRotate = e.target.checked;
  });

  // ---------- animation ----------
  let pulse = 0.5; // frozen at its last value while paused

  function animate(t) {
    requestAnimationFrame(animate);

    if (playing) {
      // Sweep through the 12 syndrome cycles of the window.
      if (t - cycleStart >= CYCLE_MS) {
        cycleStart = t;
        setCycle((cycle + 1) % REGIONS);
      }
      pulse = 0.5 + 0.5 * Math.sin(((t - cycleStart) / CYCLE_MS) * Math.PI);

      if (autoRotate) {
        yaw += 0.0015;
        updateCam();
      }
    }

    // Highlight styling always tracks the current cycle, so click-to-jump
    // works while paused too.
    for (let s = 0; s < REGIONS; s++) {
      const [cnuMat, vnuLMat, vnuRMat] = regionMats[s];
      if (s === cycle) {
        cnuMat.emissiveIntensity = 0.6 + 0.8 * pulse;
        vnuLMat.emissiveIntensity = 0.6 + 0.6 * (1 - pulse);
        vnuRMat.emissiveIntensity = 0.6 + 0.6 * (1 - pulse);
      } else {
        cnuMat.emissiveIntensity = 0.12;
        vnuLMat.emissiveIntensity = 0.12;
        vnuRMat.emissiveIntensity = 0.12;
      }
    }
    for (const l of routingLines) {
      const touches = l.userData.a === cycle || l.userData.b === cycle;
      l.material.opacity = touches ? 0.45 + 0.3 * pulse : 0.1;
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
