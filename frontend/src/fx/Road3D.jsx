import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { useEffect, useRef } from "react";
import { gsap } from "./gsap.js";

/**
 * The sign-in hero as a real 3D world: a car on the brand's road, buildings and
 * streetlamps streaming past, and diamond markers drifting in where a part is
 * predicted to fail. The camera sits behind the car and leans with the pointer.
 *
 * Three tricks keep it cheap enough to leave running:
 *  - Everything that repeats (lane dashes, buildings, lamps) is built once for
 *    one period and copied; the whole group slides by `distance % period`, so
 *    the loop is seamless and nothing is created or moved per object per frame.
 *  - Distant geometry fades into the page colour with fog, so the far edge of
 *    the world is never visible and the horizon blends into the hero's ground.
 *  - It stops drawing when the tab is hidden or the hero scrolls out of view,
 *    and under reduced motion it draws a single still frame.
 *
 * Every colour is read from the live CSS tokens at mount — nothing hard-coded —
 * so the scene matches the day/night page. If WebGL is missing, `onUnsupported`
 * lets the caller fall back to the SVG road.
 *
 * It is a place with colour in it, not one orange line: the lamps, the lit bands, the
 * failure markers and the drifting light take turns through a six-hue palette (the brand
 * orange plus the teal, violet, blue, gold and green the public site tells its story in),
 * windows glow and twinkle in the buildings, the sky behind the horizon slowly changes hue,
 * headlights throw a beam down the road, and the car's paint changes every few seconds.
 */

const SPEED = 14; // metres per second
const PERIOD = 48; // buildings and lamps repeat every 48 m
const COPIES = 5;
const DASH_GAP = 7;
const PAINT_SECONDS = 9; // how long the car keeps one paint before easing to the next
const SKY_SECONDS = 16; // how long the sky takes to move on to the next hue

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const token = (name, fallback) => new THREE.Color(css(name) || fallback);

// A tiny seeded generator, so the skyline is the same on every visit.
function rng(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function glowTexture(color) {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const g = c.getContext("2d");
  const solid = color.getStyle();
  const clear = solid.replace("rgb(", "rgba(").replace(")", ",0)");
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, solid);
  grad.addColorStop(1, clear);
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function dotTexture() {
  const c = document.createElement("canvas");
  c.width = 32;
  c.height = 32;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.4, "rgba(255,255,255,0.45)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

/** White at the bottom, clear at the top: tinted by the material, it is a glow rising off the horizon. */
function skyTexture() {
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 128;
  const g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 128, 0, 0);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.4)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 128);
  return new THREE.CanvasTexture(c);
}

/** A beam that is brightest at the car and fades down the road. */
function beamTexture() {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 128;
  const g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 128, 0, 0);
  grad.addColorStop(0, "rgba(255,240,205,0.9)");
  grad.addColorStop(0.5, "rgba(255,240,205,0.25)");
  grad.addColorStop(1, "rgba(255,240,205,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 128);
  return new THREE.CanvasTexture(c);
}

/** A façade of windows: a few lit in warm white or one of the palette's hues, the rest dark. */
function windowTexture(random, hues, warm, cols, rows) {
  const cell = 16;
  const c = document.createElement("canvas");
  c.width = cols * cell;
  c.height = rows * cell;
  const g = c.getContext("2d");
  g.fillStyle = "black";
  g.fillRect(0, 0, c.width, c.height);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (random() > 0.34) continue;
      g.fillStyle = random() > 0.55 ? hues[Math.floor(random() * hues.length)] : warm;
      g.fillRect(x * cell + 4, y * cell + 4, cell - 8, cell - 7);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export default function Road3D({ className = "", onUnsupported }) {
  const host = useRef(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return undefined;

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      onUnsupported?.();
      return undefined;
    }
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.style.cssText = "display:block;width:100%;height:100%";
    el.appendChild(renderer.domElement);

    // ── palette, from the tokens
    const accent = token("--color-accent", "orange");
    const ground = token("--color-surface-panel", "white");
    const roadCol = token("--color-chrome", "gray");
    const edgeCol = token("--color-border-strong", "gray");
    const buildingCol = token("--color-border", "silver");
    // Same bezel-dark car by day; at night a mid grey so it does not vanish into the ground.
    const nightPage = document.documentElement.dataset.theme === "night";
    const carCol = token(nightPage ? "--color-border-strong" : "--color-device-ring", "black");
    const glassCol = token("--color-fg-subtle", "gray");
    const plateCol = token("--color-surface-card", "white");
    const poleCol = token("--color-fg-decorative", "gray");
    // Six hues to take turns: the brand orange, then the public site's teal, violet, blue, gold, green.
    const palette = [
      accent,
      token("--scene-teal", "teal"),
      token("--scene-violet", "violet"),
      token("--scene-blue", "royalblue"),
      token("--scene-gold", "gold"),
      token("--scene-green", "seagreen"),
    ];
    // Paints for the car to ease through, each light enough to read against the road at night.
    const paints = [
      carCol,
      token("--scene-paint-blue", "steelblue"),
      token("--scene-paint-red", "firebrick"),
      token("--scene-paint-green", "darkgreen"),
      token("--scene-paint-silver", "gray"),
    ];
    const warmLight = css("--scene-warm") || "wheat";

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(ground, 26, 125);
    const camera = new THREE.PerspectiveCamera(56, 1, 0.1, 260);

    scene.add(new THREE.HemisphereLight(plateCol, roadCol, 1.5));
    const sun = new THREE.DirectionalLight(0xffffff, 1.7);
    sun.position.set(-8, 14, 10);
    scene.add(sun);

    // ── the sky: a glow rising off the horizon, its hue drifting slowly through the palette
    const skyMat = new THREE.MeshBasicMaterial({
      map: skyTexture(), color: palette[0], transparent: true, opacity: nightPage ? 0.55 : 0.4, depthWrite: false, fog: false,
    });
    const sky = new THREE.Mesh(new THREE.PlaneGeometry(560, 170), skyMat);
    sky.position.set(0, 52, -205);
    scene.add(sky);

    // ── ground and road
    const groundMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(500, 500).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: ground, roughness: 1 }),
    );
    groundMesh.position.y = -0.02;
    scene.add(groundMesh);

    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 500).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: roadCol, roughness: 0.9 }),
    );
    scene.add(road);

    const edgeMat = new THREE.MeshStandardMaterial({ color: edgeCol, roughness: 0.8 });
    for (const x of [-4.8, 4.8]) {
      const edge = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 500), edgeMat);
      edge.position.set(x, 0.015, -200);
      scene.add(edge);
    }

    // ── lane dashes: one period, scrolled by the modulo trick
    const lane = new THREE.Group();
    const centreMat = new THREE.MeshBasicMaterial({ color: accent });
    const dividerMat = new THREE.MeshStandardMaterial({ color: edgeCol, roughness: 0.8 });
    const dashGeo = new THREE.BoxGeometry(0.18, 0.03, 2.2);
    for (let z = 16; z > -230; z -= DASH_GAP) {
      const c = new THREE.Mesh(dashGeo, centreMat);
      c.position.set(0, 0.02, z);
      lane.add(c);
      for (const x of [-2.9, 2.9]) {
        const d = new THREE.Mesh(dashGeo, dividerMat);
        d.position.set(x, 0.02, z);
        lane.add(d);
      }
    }
    scene.add(lane);

    // ── the roadside: buildings and lamps, one period copied end to end
    const world = new THREE.Group();
    const glow = glowTexture(accent);
    const glowMat = new THREE.SpriteMaterial({ map: glow, transparent: true, opacity: 0.42, depthWrite: false });
    const bandMat = new THREE.MeshBasicMaterial({ color: accent });
    // One glow and one lit band per hue; the lamps and the building bands take theirs in turn.
    const hueGlows = palette.map((c) => new THREE.SpriteMaterial({ map: glowTexture(c), transparent: true, opacity: 0.5, depthWrite: false }));
    const hueBands = palette.map((c) => new THREE.MeshBasicMaterial({ color: c }));
    const windowHues = palette.map((c) => c.getStyle());
    const windowMats = [];
    const poleMat = new THREE.MeshStandardMaterial({ color: poleCol, roughness: 0.7 });
    const random = rng(7);

    const period = new THREE.Group();
    for (const side of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        const w = 3 + random() * 4;
        const h = 3.5 + random() * 7;
        const d = 4 + random() * 5;
        const x = side * (12 + random() * 9);
        const z = -(i * (PERIOD / 4)) - random() * 4;
        // Each building has its own façade: a grid of windows sized to it, some lit.
        const facade = new THREE.MeshStandardMaterial({
          color: buildingCol, roughness: 0.85, emissive: new THREE.Color(0xffffff), emissiveIntensity: nightPage ? 0.95 : 0.3,
          emissiveMap: windowTexture(random, windowHues, warmLight, Math.max(3, Math.round(d)), Math.max(4, Math.round(h * 1.4))),
        });
        windowMats.push({ mat: facade, phase: random() * 6.28 });
        const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), facade);
        b.position.set(x, h / 2, z);
        period.add(b);
        if (random() > 0.45) {
          // A lit band on the face that looks at the road, in whichever hue is next.
          const band = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.28, d * 0.8), hueBands[Math.floor(random() * hueBands.length)]);
          band.position.set(x - side * (w / 2 + 0.03), 1.2 + random() * (h - 2.4), z);
          period.add(band);
        }
      }
      for (let i = 0; i < 2; i++) {
        const z = -(i * (PERIOD / 2)) - 3;
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 5.6, 8), poleMat);
        pole.position.set(side * 5.6, 2.8, z);
        const arm = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.08, 0.08), poleMat);
        arm.position.set(side * 5.0, 5.55, z);
        const hue = (i * 2 + (side > 0 ? 1 : 0) + Math.floor(random() * 3)) % palette.length;
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.12, 0.3), hueBands[hue]);
        head.position.set(side * 4.4, 5.48, z);
        const halo = new THREE.Sprite(hueGlows[hue]);
        halo.scale.set(2.2, 2.2, 1);
        halo.position.set(side * 4.4, 5.3, z);
        period.add(pole, arm, head, halo);
      }
    }
    for (let k = 0; k < COPIES; k++) {
      const copy = period.clone();
      copy.position.z = -k * PERIOD;
      world.add(copy);
    }
    scene.add(world);

    // ── failure markers: translucent diamonds that drift toward the camera
    const markerGeo = new THREE.OctahedronGeometry(0.7);
    const markers = [-34, -78, -122].map((z, i) => {
      const m = new THREE.Mesh(
        markerGeo,
        new THREE.MeshBasicMaterial({ color: palette[i], wireframe: true, transparent: true, opacity: 0.9 }),
      );
      m.userData.hue = i;
      m.position.set(i % 2 ? 6.2 : -6.2, 3.1, z);
      const halo = new THREE.Sprite(glowMat);
      halo.scale.set(3.4, 3.4, 1);
      m.add(halo);
      scene.add(m);
      return m;
    });

    // ── the car, nose to -z so the camera sees its rear
    const car = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: carCol, roughness: 0.32, metalness: 0.45 });
    const body = new THREE.Mesh(new RoundedBoxGeometry(1.9, 0.62, 4.3, 4, 0.2), bodyMat);
    body.position.y = 0.66;
    const cabin = new THREE.Mesh(
      new RoundedBoxGeometry(1.6, 0.56, 2.2, 4, 0.22),
      new THREE.MeshStandardMaterial({ color: glassCol, roughness: 0.15, metalness: 0.6 }),
    );
    cabin.position.set(0, 1.2, 0.3);
    const wheelGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.3, 22).rotateZ(Math.PI / 2);
    const wheelMat = new THREE.MeshStandardMaterial({ color: carCol, roughness: 0.9 });
    const wheels = [];
    for (const sx of [-0.98, 0.98]) {
      for (const sz of [-1.4, 1.4]) {
        const w = new THREE.Mesh(wheelGeo, wheelMat);
        w.position.set(sx, 0.4, sz);
        wheels.push(w);
        car.add(w);
      }
    }
    const tailGeo = new THREE.BoxGeometry(0.62, 0.15, 0.06);
    const taillights = [];
    for (const sx of [-0.62, 0.62]) {
      const t = new THREE.Mesh(tailGeo, bandMat);
      t.position.set(sx, 0.82, 2.17);
      const halo = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: glow, transparent: true, opacity: 0.8, depthWrite: false }),
      );
      halo.scale.set(1.5, 0.8, 1);
      halo.position.set(sx, 0.82, 2.3);
      taillights.push(halo);
      car.add(t, halo);
    }
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.2, 0.05), new THREE.MeshStandardMaterial({ color: plateCol }));
    plate.position.set(0, 0.62, 2.18);
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(1, 28).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }),
    );
    shadow.scale.set(1.4, 1, 2.8);
    shadow.position.y = 0.025;
    car.add(body, cabin, plate, shadow);
    scene.add(car);

    // ── headlights throw a beam down the road ahead of the car
    const beamMat = new THREE.MeshBasicMaterial({
      map: beamTexture(), transparent: true, opacity: nightPage ? 0.55 : 0.28, depthWrite: false,
      blending: nightPage ? THREE.AdditiveBlending : THREE.NormalBlending, fog: false,
    });
    const beamShape = new THREE.Shape();
    beamShape.moveTo(-0.7, 0);
    beamShape.lineTo(0.7, 0);
    beamShape.lineTo(3.4, 32);
    beamShape.lineTo(-3.4, 32);
    const beamGeo = new THREE.ShapeGeometry(beamShape);
    // Shape y runs 0 → -32; map it onto the texture's 0 → 1 so the fade follows the road.
    const beamUv = beamGeo.attributes.uv;
    for (let i = 0; i < beamUv.count; i++) beamUv.setXY(i, beamUv.getX(i), 1 - Math.abs(beamGeo.attributes.position.getY(i)) / 32);
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.rotation.x = -Math.PI / 2;
    beam.position.set(0, 0.05, -2.2);
    car.add(beam);

    // ── light drifting by: small points in the palette's hues, streaming toward the camera
    const COUNT = 150;
    const dust = new Float32Array(COUNT * 3);
    const dustCol = new Float32Array(COUNT * 3);
    const dustRand = rng(23);
    for (let i = 0; i < COUNT; i++) {
      dust[i * 3] = (dustRand() - 0.5) * 60;
      dust[i * 3 + 1] = 0.4 + dustRand() * 9;
      dust[i * 3 + 2] = -dustRand() * 130 + 8;
      const c = palette[Math.floor(dustRand() * palette.length)];
      dustCol.set([c.r, c.g, c.b], i * 3);
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute("position", new THREE.BufferAttribute(dust, 3));
    dustGeo.setAttribute("color", new THREE.BufferAttribute(dustCol, 3));
    const dustPoints = new THREE.Points(dustGeo, new THREE.PointsMaterial({
      size: 0.34, map: dotTexture(), vertexColors: true, transparent: true, opacity: nightPage ? 0.9 : 0.7,
      depthWrite: false, blending: nightPage ? THREE.AdditiveBlending : THREE.NormalBlending,
    }));
    dustPoints.frustumCulled = false;
    scene.add(dustPoints);

    // ── pointer, size and the loop
    const pointer = { x: 0, y: 0, sx: 0, sy: 0 };
    const onMove = (e) => {
      const r = el.getBoundingClientRect();
      pointer.x = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width - 0.5) * 2));
      pointer.y = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height - 0.5) * 2));
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    const resize = () => {
      const w = el.clientWidth || 1;
      const h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      if (reduce) draw(0);
    };
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    ro?.observe(el);
    window.addEventListener("resize", resize);

    // The opening shot, on one GSAP timeline: the camera starts high and far back
    // and swoops in to its place behind the car, while the car pulls away from a
    // standstill up to cruising speed. Under reduced motion it is already there.
    const intro = reduce ? { dolly: 0, rise: 0, speed: 1 } : { dolly: 16, rise: 3, speed: 0 };
    const introTimeline = reduce
      ? null
      : gsap.timeline()
        .to(intro, { dolly: 0, rise: 0, duration: 3, ease: "expo.out" }, 0)
        .to(intro, { speed: 1, duration: 3.4, ease: "power2.inOut" }, 0.35);

    let distance = 0;
    let t = 0;
    function draw(dt) {
      const k = Math.min(1, dt * 4);
      pointer.sx += (pointer.x - pointer.sx) * k;
      pointer.sy += (pointer.y - pointer.sy) * k;
      const v = SPEED * intro.speed;

      lane.position.z = distance % DASH_GAP;
      world.position.z = distance % PERIOD;
      for (const m of markers) {
        m.position.z += v * dt;
        if (m.position.z > 10) m.position.z -= 130;
        m.rotation.y = t * 1.4;
        m.position.y = 3.1 + Math.sin(t * 2 + m.position.x) * 0.25;
      }

      // Hues: each marker blends toward another colour in the palette, and the sky moves on, slowly.
      for (const m of markers) {
        const f = (Math.sin(t * 0.5 + m.userData.hue * 2.1) + 1) / 2;
        m.material.color.copy(palette[m.userData.hue]).lerp(palette[(m.userData.hue + 3) % palette.length], f);
      }
      const skyPos = (t / SKY_SECONDS) % palette.length;
      const skyFrom = Math.floor(skyPos);
      skyMat.color.copy(palette[skyFrom]).lerp(palette[(skyFrom + 1) % palette.length], skyPos - skyFrom);

      // Windows breathe a little, each building on its own beat.
      const base = nightPage ? 0.95 : 0.3;
      for (const w of windowMats) w.mat.emissiveIntensity = base * (0.82 + Math.sin(t * 0.9 + w.phase) * 0.18);

      // Drifting light streams toward the camera and wraps round, bobbing as it comes.
      const pos = dustGeo.attributes.position;
      for (let i = 0; i < COUNT; i++) {
        let z = pos.getZ(i) + v * dt * 0.55;
        if (z > 10) z -= 140;
        pos.setZ(i, z);
        pos.setY(i, pos.getY(i) + Math.sin(t * 1.3 + i) * dt * 0.12);
      }
      pos.needsUpdate = true;

      // The car's paint eases to the next one every PAINT_SECONDS.
      const paintPos = (t / PAINT_SECONDS) % paints.length;
      const paintFrom = Math.floor(paintPos);
      const ease = Math.min(1, Math.max(0, (paintPos - paintFrom - 0.7) / 0.3)); // hold, then change in the last 30%
      bodyMat.color.copy(paints[paintFrom]).lerp(paints[(paintFrom + 1) % paints.length], ease);

      const lean = pointer.sx;
      car.position.x += (lean * 1.9 - car.position.x) * k;
      car.position.y = Math.sin(t * 5) * 0.012;
      car.rotation.y = -(car.position.x - lean * 1.9) * 0.4;
      car.rotation.z = -car.position.x * 0.012;
      for (const w of wheels) w.rotation.x -= v * dt * 2.4;
      const pulse = 0.75 + Math.sin(t * 2.6) * 0.15;
      for (const h of taillights) h.material.opacity = pulse;

      camera.position.set(pointer.sx * 1.3, 2.5 - pointer.sy * 0.35 + intro.rise, 8.6 + intro.dolly);
      camera.lookAt(pointer.sx * 0.6, 1.1, -30);
      renderer.render(scene, camera);
    }

    let raf = 0;
    let visible = true;
    const clock = new THREE.Clock();
    function frame() {
      raf = requestAnimationFrame(frame);
      if (document.hidden || !visible) { clock.getDelta(); return; }
      const dt = Math.min(clock.getDelta(), 0.05);
      t += dt;
      distance += SPEED * intro.speed * dt;
      draw(dt);
    }
    resize();
    if (reduce) draw(0);
    else raf = requestAnimationFrame(frame);

    const io = typeof IntersectionObserver !== "undefined"
      ? new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; })
      : null;
    io?.observe(el);

    return () => {
      introTimeline?.kill();
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("resize", resize);
      ro?.disconnect();
      io?.disconnect();
      scene.traverse((o) => {
        o.geometry?.dispose?.();
        const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        for (const m of mats) {
          for (const v of Object.values(m)) if (v && v.isTexture) v.dispose();
          m.dispose();
        }
      });
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
    // The scene is built once; `onUnsupported` is only called during that build.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={host} aria-hidden="true" className={className} />;
}
