/*
 * Gross code [[144,12,12]] Relay-BP decoder — 3D structural visualization.
 *
 * Nodes:
 *   72 CNUs (check node units)     — one per row of H_X, each of weight 6
 *   72 VNU-L (left variable nodes) — 72 qubits contributed by A(x,y)
 *   72 VNU-R (right variable nodes)— 72 qubits contributed by B(x,y)
 *
 * Connectivity comes from the BB polynomial structure:
 *   A(x,y) = x^3 + y + y^2
 *   B(x,y) = y^3 + x + x^2
 * on the group Z_L x Z_M with (L, M) = (12, 6).
 *
 * Check (i, j) connects to:
 *   Left  (A^T): ((i+3) mod L, j), (i, (j+1) mod M), (i, (j+2) mod M)
 *   Right (B^T): (i, (j+3) mod M), ((i+1) mod L, j), ((i+2) mod L, j)
 *
 * Animation shows the two-cycle BP iteration in flooding schedule:
 *   Phase 0: CNU -> VNU  (mu_{i->j} messages, equation 1 in the paper)
 *   Phase 1: VNU -> CNU  (nu_{j->i} messages, equation 2)
 * Alpha (min-sum scaling) ticks 1 - 2^-t each iteration.
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

  // ---------- BB parameters ----------
  const L = 12;
  const M = 6;

  // Torus embedding for a node indexed by (i, j).
  function torus(i, j, R, r, yOff) {
    const u = (2 * Math.PI * i) / L;
    const v = (2 * Math.PI * j) / M;
    return new THREE.Vector3(
      (R + r * Math.cos(v)) * Math.cos(u),
      r * Math.sin(v) + yOff,
      (R + r * Math.cos(v)) * Math.sin(u),
    );
  }

  // ---------- node meshes ----------
  const cnuPos = [], vnuLPos = [], vnuRPos = [];
  const cnuMesh = [], vnuLMesh = [], vnuRMesh = [];

  const cnuGeom = new THREE.SphereGeometry(0.18, 14, 10);
  const vnuGeom = new THREE.BoxGeometry(0.28, 0.28, 0.28);

  const cnuBase = new THREE.Color(0x1d9e75);
  const cnuHot = new THREE.Color(0x5dcaa5);
  const vnuLBase = new THREE.Color(0xd85a30);
  const vnuLHot = new THREE.Color(0xf0997b);
  const vnuRBase = new THREE.Color(0x7f77dd);
  const vnuRHot = new THREE.Color(0xafa9ec);

  for (let i = 0; i < L; i++) {
    for (let j = 0; j < M; j++) {
      const pc = torus(i, j, 6, 1.6, 3.2);
      const mc = new THREE.Mesh(
        cnuGeom,
        new THREE.MeshStandardMaterial({
          color: cnuBase.clone(),
          emissive: 0x0a3d2c,
          emissiveIntensity: 0.3,
          roughness: 0.5,
        }),
      );
      mc.position.copy(pc);
      scene.add(mc);
      cnuPos.push(pc);
      cnuMesh.push(mc);

      const pl = torus(i, j, 5, 1.3, -2.6);
      const ml = new THREE.Mesh(
        vnuGeom,
        new THREE.MeshStandardMaterial({
          color: vnuLBase.clone(),
          emissive: 0x3d1408,
          emissiveIntensity: 0.3,
          roughness: 0.5,
        }),
      );
      ml.position.copy(pl);
      scene.add(ml);
      vnuLPos.push(pl);
      vnuLMesh.push(ml);

      const pr = torus(i, j, 8.5, 1.3, -2.6);
      const mr = new THREE.Mesh(
        vnuGeom,
        new THREE.MeshStandardMaterial({
          color: vnuRBase.clone(),
          emissive: 0x1a1440,
          emissiveIntensity: 0.3,
          roughness: 0.5,
        }),
      );
      mr.position.copy(pr);
      scene.add(mr);
      vnuRPos.push(pr);
      vnuRMesh.push(mr);
    }
  }

  // ---------- edges from BB polynomial structure ----------
  const edgeLines = [];
  const edgeGroup = new THREE.Group();
  scene.add(edgeGroup);

  const lineMatProto = new THREE.LineBasicMaterial({
    color: 0x4a5568,
    transparent: true,
    opacity: 0.18,
  });

  for (let i = 0; i < L; i++) {
    for (let j = 0; j < M; j++) {
      const c = i * M + j;
      const neighbors = [
        // Left (A^T)
        [((i + 3) % L) * M + j, "L"],
        [i * M + ((j + 1) % M), "L"],
        [i * M + ((j + 2) % M), "L"],
        // Right (B^T)
        [i * M + ((j + 3) % M), "R"],
        [((i + 1) % L) * M + j, "R"],
        [((i + 2) % L) * M + j, "R"],
      ];
      for (const [v, side] of neighbors) {
        const pc = cnuPos[c];
        const pv = side === "L" ? vnuLPos[v] : vnuRPos[v];
        const g = new THREE.BufferGeometry().setFromPoints([pc, pv]);
        const line = new THREE.Line(g, lineMatProto.clone());
        edgeGroup.add(line);
        edgeLines.push(line);
      }
    }
  }

  // Phase indicator ring at the origin.
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1.2, 0.08, 12, 60),
    new THREE.MeshBasicMaterial({ color: 0x1d9e75, transparent: true, opacity: 0.4 }),
  );
  ring.rotation.x = Math.PI / 2;
  scene.add(ring);

  // ---------- orbit controls (r128 has no bundled OrbitControls) ----------
  // Left-drag rotates, right-drag (or shift+drag) pans the orbit target,
  // and the wheel zooms toward the cursor.
  const HOME = { yaw: 0.0, pitch: 0.25, dist: 22 };
  const MIN_DIST = 10, MAX_DIST = 45, PAN_LIMIT = 14;
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

  // ---------- animation state ----------
  let iter = 0;
  let phaseStart = performance.now();
  let phase = 0;
  let playing = true;
  let autoRotate = true;
  const PHASE_MS = 900;

  const iterEl = document.getElementById("iter");
  const phaseEl = document.getElementById("phase");
  const alphaEl = document.getElementById("alpha");
  const playBtn = document.getElementById("play");
  const resetBtn = document.getElementById("reset");
  const edgesToggle = document.getElementById("showEdges");
  const rotateToggle = document.getElementById("autoRotate");

  playBtn.addEventListener("click", () => {
    playing = !playing;
    playBtn.textContent = playing ? "Pause" : "Play";
    if (playing) phaseStart = performance.now();
  });
  resetBtn.addEventListener("click", () => {
    iter = 0;
    phase = 0;
    phaseStart = performance.now();
    iterEl.textContent = "0";
    phaseEl.textContent = "CNU\u2192VNU";
    alphaEl.textContent = "0.500";
    yaw = HOME.yaw;
    pitch = HOME.pitch;
    dist = HOME.dist;
    target.set(0, 0, 0);
    updateCam();
  });
  edgesToggle.addEventListener("change", (e) => {
    edgeGroup.visible = e.target.checked;
  });
  rotateToggle.addEventListener("change", (e) => {
    autoRotate = e.target.checked;
  });

  function animate(t) {
    requestAnimationFrame(animate);

    if (playing) {
      const elapsed = t - phaseStart;
      if (elapsed >= PHASE_MS) {
        phaseStart = t;
        phase = 1 - phase;
        if (phase === 0) {
          iter++;
          iterEl.textContent = iter.toString();
          const a = 1 - Math.pow(2, -Math.max(1, iter));
          alphaEl.textContent = a.toFixed(3);
        }
        phaseEl.textContent = phase === 0 ? "CNU\u2192VNU" : "VNU\u2192CNU";
      }

      const p = (t - phaseStart) / PHASE_MS;
      const pulse = 0.5 + 0.5 * Math.sin(p * Math.PI);

      if (phase === 0) {
        // CNUs are the senders during phase 0.
        for (const m of cnuMesh) {
          m.material.color.copy(cnuBase).lerp(cnuHot, pulse);
          m.material.emissiveIntensity = 0.3 + pulse * 0.7;
        }
        for (const m of vnuLMesh) {
          m.material.color.copy(vnuLBase);
          m.material.emissiveIntensity = 0.2;
        }
        for (const m of vnuRMesh) {
          m.material.color.copy(vnuRBase);
          m.material.emissiveIntensity = 0.2;
        }
        ring.material.color.setHex(0x1d9e75);
      } else {
        // VNUs are the senders during phase 1.
        for (const m of vnuLMesh) {
          m.material.color.copy(vnuLBase).lerp(vnuLHot, pulse);
          m.material.emissiveIntensity = 0.3 + pulse * 0.7;
        }
        for (const m of vnuRMesh) {
          m.material.color.copy(vnuRBase).lerp(vnuRHot, pulse);
          m.material.emissiveIntensity = 0.3 + pulse * 0.7;
        }
        for (const m of cnuMesh) {
          m.material.color.copy(cnuBase);
          m.material.emissiveIntensity = 0.2;
        }
        ring.material.color.setHex(0xd85a30);
      }

      const eOpacity = 0.18 + 0.35 * pulse;
      for (const l of edgeLines) l.material.opacity = eOpacity;

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
