import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { color, night } from "@autosaarthi/tokens";
import { useEffect, useRef } from "react";
import { PARTS } from "../fx/CarTwin.jsx";

/**
 * The public site's world: one continuous 3D scene you fly through by scrolling.
 *
 * A single WebGL renderer holds eight camera stops — the road at the start, six
 * stations beside it (each one a part of the AutoSaarthi story, and each one
 * something to touch), and a portal at the end. Scrolling moves a camera along a
 * smooth spline from stop to stop; the pointer leans the camera and, at a
 * station, drives that station's own interaction. The story and the hint text
 * live in the page's HTML on top (site/Landing.jsx) and are told where the
 * camera is through `progressRef` (0 … STOPS-1).
 *
 * Why one scene instead of a canvas per section: continuity. The camera never
 * cuts; the road you left is still behind you, and the whole thing costs one
 * draw loop. It stops drawing when the tab is hidden or the page is not in view.
 *
 * Colours come from the shared tokens' night palette, not from the CSS, because
 * the site is always dark and must not depend on the app theme's timing.
 */

export const STOPS = 8;

const C = (hex) => new THREE.Color(hex);
const pal = {
  page: C(night.page), panel: C(night.panel), card: C(night.card), inset: C(night.insetStrong),
  edge: C(night.borderStrong), line: C(night.border), fg: C(night.fg), muted: C(night.fgMuted),
  accent: C(color.accent), p1: C(color.p1), p2: C(color.p2), p3: C(color.p3), ok: C(color.ok), amber: C(color.amber),
};

// Where each stop's object stands, beside the road. x alternates so the story zig-zags.
const SPOT = [
  { x: 0, z: 0 }, { x: 16, z: -45 }, { x: -16, z: -95 }, { x: 16, z: -145 },
  { x: -16, z: -195 }, { x: 16, z: -245 }, { x: -16, z: -295 }, { x: 0, z: -345 },
];

function cameraStops(portrait) {
  const pos = [];
  const look = [];
  SPOT.forEach((p, i) => {
    if (i === 0) { pos.push(new THREE.Vector3(0, 2.6, 9)); look.push(new THREE.Vector3(0, 1.3, -30)); return; }
    if (i === SPOT.length - 1) { pos.push(new THREE.Vector3(0, 3.2, p.z + 17)); look.push(new THREE.Vector3(0, 2.6, p.z)); return; }
    const side = Math.sign(p.x);
    if (portrait) {
      // On a phone the words sit under the scene, so the object is centred and
      // looked at from slightly below its middle, which lifts it into the top half.
      pos.push(new THREE.Vector3(p.x - side * 3, 3.4, p.z + 19));
      look.push(new THREE.Vector3(p.x - side * 0.5, 0, p.z));
      return;
    }
    // Camera stands toward the road and looks a little past the object, so the
    // object lands on the far side of the screen from the story text.
    pos.push(new THREE.Vector3(p.x - side * 10, 3.6, p.z + 14));
    look.push(new THREE.Vector3(p.x - side * 5, 2.4, p.z));
  });
  return { pos: new THREE.CatmullRomCurve3(pos, false, "centripetal"), look: new THREE.CatmullRomCurve3(look, false, "centripetal") };
}

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function glowTexture(col) {
  const c = document.createElement("canvas");
  c.width = 64; c.height = 64;
  const g = c.getContext("2d");
  const solid = col.getStyle();
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, solid);
  grad.addColorStop(1, solid.replace("rgb(", "rgba(").replace(")", ",0)"));
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function platform(r = 5.5) {
  const g = new THREE.Group();
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(r, r + 0.2, 0.16, 64), new THREE.MeshStandardMaterial({ color: pal.card, roughness: 0.85 }));
  disc.position.y = -0.1;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(r - 0.05, 0.03, 8, 96).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: pal.accent }));
  g.add(disc, rim);
  return g;
}

function makeCar() {
  const car = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: pal.edge, roughness: 0.35, metalness: 0.5 });
  const body = new THREE.Mesh(new RoundedBoxGeometry(1.95, 0.72, 4.3, 4, 0.2), bodyMat);
  body.position.y = 0.7;
  const cabin = new THREE.Mesh(
    new RoundedBoxGeometry(1.72, 0.74, 2.35, 4, 0.2),
    new THREE.MeshStandardMaterial({ color: pal.muted, roughness: 0.15, metalness: 0.6, transparent: true, opacity: 0.88 }),
  );
  cabin.position.set(0, 1.3, 0.35);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.98, 0.05, 4.1), new THREE.MeshBasicMaterial({ color: pal.accent }));
  stripe.position.y = 0.78;
  const wheelGeo = new THREE.CylinderGeometry(0.44, 0.44, 0.34, 26).rotateZ(Math.PI / 2);
  const wheelMat = new THREE.MeshStandardMaterial({ color: pal.line, roughness: 0.9 });
  for (const sx of [-1, 1]) for (const sz of [-1.45, 1.45]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.position.set(sx, 0.44, sz);
    car.add(w);
  }
  for (const sx of [-0.68, 0.68]) {
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.06), new THREE.MeshBasicMaterial({ color: pal.fg }));
    head.position.set(sx, 0.86, -2.17);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.06), new THREE.MeshBasicMaterial({ color: pal.accent }));
    tail.position.set(sx, 0.86, 2.17);
    car.add(head, tail);
  }
  car.add(body, cabin, stripe);
  return car;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

const SLOTS = [
  ["Mon", "23 Nov", "9:00 am", "Kothrud"], ["Mon", "23 Nov", "2:30 pm", "Hinjewadi"],
  ["Tue", "24 Nov", "10:30 am", "Kothrud"], ["Wed", "25 Nov", "11:00 am", "Baner"],
  ["Thu", "26 Nov", "9:30 am", "Kothrud"], ["Fri", "27 Nov", "3:00 pm", "Wakad"],
  ["Sat", "28 Nov", "10:00 am", "Kothrud"],
];

function slotTexture(slot, state) {
  const c = document.createElement("canvas");
  c.width = 512; c.height = 320;
  const g = c.getContext("2d");
  const booked = state === "booked";
  const hot = state === "hover";
  g.fillStyle = booked ? night.okBg : night.card;
  roundRect(g, 4, 4, 504, 312, 28);
  g.fill();
  g.lineWidth = hot || booked ? 6 : 2;
  g.strokeStyle = booked ? color.ok : hot ? color.accent : night.borderStrong;
  g.stroke();
  g.fillStyle = night.fgMuted;
  g.font = '500 30px "JetBrains Mono", monospace';
  g.fillText(slot[1], 36, 70);
  g.fillStyle = night.fgStrong;
  g.font = '700 96px "Space Grotesk", sans-serif';
  g.fillText(slot[0], 34, 170);
  g.fillStyle = booked ? color.ok : night.fg;
  g.font = '600 44px "Space Grotesk", sans-serif';
  g.fillText(slot[2], 36, 232);
  g.fillStyle = night.fgMuted;
  g.font = '400 28px "Space Grotesk", sans-serif';
  g.fillText(booked ? "Booked ✓  Service centre, " + slot[3] : "Service centre, " + slot[3], 36, 286);
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  return tex;
}

const ORB_VERT = /* glsl */ `
  uniform float uTime; uniform float uAmp;
  varying vec3 vN; varying vec3 vV;
  void main() {
    vec3 p = position;
    float d = sin(p.x * 2.6 + uTime * 1.7) * sin(p.y * 2.9 + uTime * 1.3) * sin(p.z * 2.4 + uTime * 1.9);
    p += normal * d * (0.22 + uAmp * 0.9);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;
const ORB_FRAG = /* glsl */ `
  uniform vec3 uColor; uniform vec3 uCore; uniform float uAmp;
  varying vec3 vN; varying vec3 vV;
  void main() {
    float f = pow(1.0 - max(dot(normalize(vN), normalize(vV)), 0.0), 2.2);
    vec3 col = mix(uCore, uColor, f) + uColor * f * (0.6 + uAmp * 2.0);
    gl_FragColor = vec4(col, 0.88);
  }
`;

const AGENTS = [
  ["Master Agent", "plans and coordinates — and cannot book, read PII or write records", pal.accent],
  ["Data Analysis Agent", "reads the telemetry and watches for drift", pal.p3],
  ["Diagnosis Agent", "scores which part is failing, and how soon", pal.amber],
  ["Customer Engagement Agent", "calls the owner, cost before mechanism", pal.ok],
  ["Scheduling Agent", "finds and books a slot that exists", pal.p2],
  ["Feedback Agent", "follows up and writes the result back", pal.muted],
  ["Manufacturing Quality Module", "turns repeat failures into a root-cause report", pal.fg],
];

const ATTACKS = ["Scope violation blocked", "Data exfiltration blocked", "Prompt injection blocked", "Off-hours bulk write flagged", "Plan deviation blocked"];

export default function World({ progressRef, onHud, reduce = false, className = "", onUnsupported }) {
  const host = useRef(null);
  const hudRef = useRef(onHud);
  hudRef.current = onHud;

  useEffect(() => {
    const el = host.current;
    if (!el) return undefined;

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    } catch {
      onUnsupported?.();
      return undefined;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.setClearColor(pal.page);
    renderer.domElement.style.cssText = "display:block;width:100%;height:100%;touch-action:pan-y";
    el.appendChild(renderer.domElement);
    const dom = renderer.domElement;

    const scene = new THREE.Scene();
    scene.background = pal.page.clone();
    scene.fog = new THREE.Fog(pal.page, 34, 150);
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
    scene.add(new THREE.HemisphereLight(pal.fg, pal.panel, 1.25));
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(-10, 18, 12);
    scene.add(sun);

    const hud = (kind, text) => hudRef.current?.({ kind, text, at: performance.now() });
    const glow = glowTexture(pal.accent);
    const glowMat = new THREE.SpriteMaterial({ map: glow, transparent: true, opacity: 0.5, depthWrite: false });
    const stations = [];

    // ── stars: depth you can feel as you fly
    {
      const n = 1800;
      const arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        arr[i * 3] = (Math.random() - 0.5) * 260;
        arr[i * 3 + 1] = Math.random() * 90 - 6;
        arr[i * 3 + 2] = 50 - Math.random() * 450;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(arr, 3));
      const stars = new THREE.Points(geo, new THREE.PointsMaterial({ color: pal.muted, size: 0.35, transparent: true, opacity: 0.7, depthWrite: false }));
      scene.add(stars);
    }

    // ── 0 · the road: ground, lane, lamps, and the car at the start
    const road = new THREE.Group();
    scene.add(road);
    const lane = new THREE.Group();
    {
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(700, 800).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: pal.panel, roughness: 1 }));
      ground.position.set(0, -0.02, -170);
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(10, 800).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: pal.page, roughness: 0.9 }));
      strip.position.set(0, 0, -170);
      road.add(ground, strip);
      const edgeMat = new THREE.MeshStandardMaterial({ color: pal.edge, roughness: 0.8 });
      for (const x of [-4.8, 4.8]) {
        const e = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 800), edgeMat);
        e.position.set(x, 0.015, -170);
        road.add(e);
      }
      const dashGeo = new THREE.BoxGeometry(0.2, 0.03, 2.4);
      const centre = new THREE.MeshBasicMaterial({ color: pal.accent });
      const divider = new THREE.MeshStandardMaterial({ color: pal.edge });
      for (let z = 16; z > -400; z -= 7) {
        const c = new THREE.Mesh(dashGeo, centre);
        c.position.set(0, 0.02, z);
        lane.add(c);
        for (const x of [-2.9, 2.9]) {
          const d = new THREE.Mesh(dashGeo, divider);
          d.position.set(x, 0.02, z);
          lane.add(d);
        }
      }
      road.add(lane);
      const poleMat = new THREE.MeshStandardMaterial({ color: pal.line });
      const headMat = new THREE.MeshBasicMaterial({ color: pal.accent });
      for (let z = -4; z > -380; z -= 26) {
        for (const side of [-1, 1]) {
          const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 5.6, 8), poleMat);
          pole.position.set(side * 5.6, 2.8, z);
          const head = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.12, 0.3), headMat);
          head.position.set(side * 4.4, 5.48, z);
          const halo = new THREE.Sprite(glowMat);
          halo.scale.set(2.4, 2.4, 1);
          halo.position.set(side * 4.4, 5.3, z);
          road.add(pole, head, halo);
        }
      }
    }
    const heroCar = makeCar();
    heroCar.position.set(0, 0, 0);
    const tailGlows = [];
    for (const sx of [-0.62, 0.62]) {
      const h = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, transparent: true, opacity: 0.8, depthWrite: false }));
      h.scale.set(1.6, 0.9, 1);
      h.position.set(sx, 0.86, 2.3);
      heroCar.add(h);
      tailGlows.push(h);
    }
    scene.add(heroCar);
    {
      // A few towers by the start line, so the road reads as a city's.
      const bm = new THREE.MeshStandardMaterial({ color: pal.card, roughness: 0.85 });
      const band = new THREE.MeshBasicMaterial({ color: pal.accent });
      [[-14, -8, 4, 9, 5], [-19, -26, 5, 12, 6], [15, -14, 5, 8, 6], [21, -30, 4, 13, 5], [-16, -44, 4, 7, 5], [14, 4, 4, 6, 5]].forEach(([x, z, w, h, d]) => {
        const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), bm);
        b.position.set(x, h / 2, z);
        scene.add(b);
        const strip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.26, d * 0.8), band);
        strip.position.set(x - Math.sign(x) * (w / 2 + 0.03), h * 0.6, z);
        scene.add(strip);
      });
    }
    stations.push({
      group: road,
      update: (dt, t, k) => {
        if (!reduce) lane.position.z = (k.dist % 7);
        const p = k.pointerX;
        heroCar.position.x += (p * 1.9 - heroCar.position.x) * Math.min(1, dt * 4);
        heroCar.rotation.y = -(heroCar.position.x - p * 1.9) * 0.4;
        for (const h of tailGlows) h.material.opacity = 0.7 + Math.sin(t * 2.6) * 0.15;
      },
    });

    // ── 1 · listen: the car, with the parts the agent watches
    {
      const g = new THREE.Group();
      g.position.set(SPOT[1].x, 0, SPOT[1].z);
      g.add(platform(6));
      const turn = new THREE.Group();
      const car = makeCar();
      car.scale.setScalar(1.15);
      turn.add(car);
      g.add(turn);
      const pickables = [];
      const marks = {};
      const dotTex = glowTexture(pal.ok);
      for (const [key, info] of Object.entries(PARTS)) {
        const m = new THREE.Group();
        m.position.set(info.pos[0] * 1.15, info.pos[1] * 1.15, info.pos[2] * 1.15);
        const dot = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTex, color: pal.ok, transparent: true, depthWrite: false, depthTest: false }));
        dot.scale.set(0.5, 0.5, 1);
        const hit = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 10), new THREE.MeshBasicMaterial({ visible: false }));
        hit.userData.part = key;
        m.add(dot, hit);
        turn.add(m);
        pickables.push(hit);
        marks[key] = { dot, base: 0.5, boost: 0 };
      }
      const st = { yaw: -0.6, hover: null, picked: null };
      scene.add(g);
      stations.push({
        group: g, pickables,
        update: (dt, t, k) => {
          if (!k.dragging && !reduce) st.yaw += dt * 0.3;
          turn.rotation.y += (st.yaw - turn.rotation.y) * Math.min(1, dt * 6);
          for (const [key, mk] of Object.entries(marks)) {
            mk.boost *= 0.92;
            const hot = st.hover === key || st.picked === key;
            const s = (hot ? 0.8 : 0.5) + mk.boost + Math.sin(t * 3 + mk.base * 9) * 0.04;
            mk.dot.scale.set(s, s, 1);
            mk.dot.material.color.copy(hot ? pal.accent : pal.ok);
          }
        },
        hover: (obj) => { st.hover = obj?.userData.part ?? null; },
        click: (obj) => {
          const key = obj?.userData.part;
          if (!key) return;
          st.picked = key;
          marks[key].boost = 0.9;
          hud("part", `${PARTS[key].label} — watching ${PARTS[key].signal}`);
        },
        drag: (dx) => { st.yaw += dx * 0.012; },
      });
    }

    // ── 2 · call: a voice that is alive
    {
      const g = new THREE.Group();
      g.position.set(SPOT[2].x, 0, SPOT[2].z);
      g.add(platform(4.2));
      const uniforms = { uTime: { value: 0 }, uAmp: { value: 0.2 }, uColor: { value: pal.accent.clone() }, uCore: { value: pal.page.clone() } };
      const orb = new THREE.Mesh(
        new THREE.SphereGeometry(2.3, 96, 96),
        new THREE.ShaderMaterial({ uniforms, vertexShader: ORB_VERT, fragmentShader: ORB_FRAG, transparent: true }),
      );
      orb.position.y = 4.6;
      const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(3.2, 2), new THREE.MeshBasicMaterial({ color: pal.accent, wireframe: true, transparent: true, opacity: 0.18 }));
      shell.position.y = 4.6;
      const rings = [0, 1, 2].map(() => {
        const r = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.02, 8, 96).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: pal.accent, transparent: true, opacity: 0 }));
        r.position.y = 4.6;
        return r;
      });
      g.add(orb, shell, ...rings);
      scene.add(g);
      const script = [
        "“Hello Ramesh ji, this is AutoSaarthi.”",
        "“Your water pump is wearing out — about ten days of driving left.”",
        "“Repairing now is ₹2,400. If it fails on the road, ₹18,500.”",
        "“Shall I book Monday at nine? Nothing is booked without your yes.”",
      ];
      const st = { amp: 0.2, burst: 0, line: 0 };
      stations.push({
        group: g, pickables: [orb],
        update: (dt, t, k) => {
          uniforms.uTime.value = t;
          const near = Math.max(0, 1 - Math.hypot(k.pointerX + 0.55 * Math.sign(-SPOT[2].x), k.pointerY) * 0.9);
          st.burst *= 0.96;
          st.amp += ((0.25 + Math.sin(t * 3.1) * Math.sin(t * 1.7) * 0.18 + near * 0.35 + st.burst) - st.amp) * Math.min(1, dt * 5);
          uniforms.uAmp.value = st.amp;
          orb.rotation.y += dt * 0.25;
          shell.rotation.y -= dt * 0.1;
          shell.rotation.x += dt * 0.05;
          rings.forEach((r, i) => {
            const ph = ((t * 0.5 + i / 3) % 1);
            r.scale.setScalar(0.9 + ph * 1.5);
            r.material.opacity = (1 - ph) * (0.25 + st.burst * 0.6);
          });
        },
        hover: () => {},
        click: () => {
          st.burst = 1.1;
          hud("call", script[st.line % script.length]);
          st.line += 1;
        },
      });
    }

    // ── 3 · book: slots that exist
    {
      const g = new THREE.Group();
      g.position.set(SPOT[3].x, 0, SPOT[3].z);
      g.add(platform(7));
      const cards = SLOTS.map((slot, i) => {
        const a = (i / SLOTS.length) * Math.PI * 1.5 - Math.PI * 0.75;
        const mat = new THREE.MeshBasicMaterial({ map: slotTexture(slot, "idle"), transparent: true, side: THREE.DoubleSide });
        const m = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.625), mat);
        const home = new THREE.Vector3(Math.sin(a) * 6.2, 2.4 + Math.cos(i * 1.7) * 0.25, -Math.cos(a) * 6.2 + 4.5);
        m.position.copy(home);
        m.lookAt(0, 2.4, 4.5 + 12);
        m.userData = { i, slot, home, state: "idle", lift: 0 };
        g.add(m);
        return m;
      });
      scene.add(g);
      let booked = -1;
      const draw = (m) => {
        const old = m.material.map;
        m.material.map = slotTexture(m.userData.slot, m.userData.state);
        m.material.needsUpdate = true;
        old.dispose();
      };
      stations.push({
        group: g, pickables: cards,
        update: (dt, t) => {
          cards.forEach((m, i) => {
            const want = m.userData.state === "hover" || m.userData.state === "booked" ? 1 : 0;
            m.userData.lift += (want - m.userData.lift) * Math.min(1, dt * 8);
            m.position.y = m.userData.home.y + Math.sin(t * 1.1 + i) * 0.1 + m.userData.lift * 0.5;
            m.scale.setScalar(1 + m.userData.lift * 0.1);
            m.material.opacity = booked >= 0 && booked !== i ? 0.45 : 1;
          });
        },
        hover: (obj) => {
          cards.forEach((m) => {
            const next = m.userData.i === booked ? "booked" : obj === m ? "hover" : "idle";
            if (m.userData.state !== next) { m.userData.state = next; draw(m); }
          });
        },
        click: (obj) => {
          if (!obj) return;
          const i = obj.userData.i;
          booked = booked === i ? -1 : i;
          cards.forEach((m) => {
            const next = m.userData.i === booked ? "booked" : m.userData.i === i ? "hover" : "idle";
            if (m.userData.state !== next) { m.userData.state = next; draw(m); }
          });
          hud(booked >= 0 ? "book" : "cancel", booked >= 0
            ? `Booked ${obj.userData.slot[0]} ${obj.userData.slot[1]}, ${obj.userData.slot[2]} — Service centre, ${obj.userData.slot[3]}`
            : "Booking cancelled — the bay goes back to other owners");
        },
      });
      // The cards are drawn with web fonts; redraw them once those have loaded.
      document.fonts?.ready.then(() => cards.forEach(draw));
    }

    // ── 4 · coordinate: seven agents, one orchestra
    {
      const g = new THREE.Group();
      g.position.set(SPOT[4].x, 0, SPOT[4].z);
      g.add(platform(5));
      const cluster = new THREE.Group();
      cluster.position.y = 4.4;
      g.add(cluster);
      const nodes = AGENTS.map(([name, role, col], i) => {
        const r = i === 0 ? 0.95 : 0.52;
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 32), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.55, roughness: 0.3 }));
        if (i === 0) mesh.position.set(0, 0, 0);
        else {
          const a = ((i - 1) / 6) * Math.PI * 2;
          mesh.position.set(Math.cos(a) * 3.6, Math.sin(i * 1.3) * 1.5, Math.sin(a) * 3.6);
        }
        mesh.userData = { name, role, col, flash: 0, i };
        cluster.add(mesh);
        return mesh;
      });
      const lines = nodes.slice(1).map((n) => {
        const geo = new THREE.BufferGeometry().setFromPoints([nodes[0].position, n.position]);
        const l = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: pal.edge, transparent: true, opacity: 0.6 }));
        cluster.add(l);
        return l;
      });
      const pulses = nodes.slice(1).map((n) => {
        const p = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 12), new THREE.MeshBasicMaterial({ color: pal.accent }));
        p.userData = { n, ph: Math.random(), speed: 0.35 + Math.random() * 0.2, burst: 0 };
        cluster.add(p);
        return p;
      });
      scene.add(g);
      const st = { yaw: 0, hover: null };
      stations.push({
        group: g, pickables: nodes,
        update: (dt, t, k) => {
          if (!k.dragging && !reduce) st.yaw += dt * 0.22;
          cluster.rotation.y += (st.yaw - cluster.rotation.y) * Math.min(1, dt * 6);
          nodes.forEach((n) => {
            n.userData.flash *= 0.93;
            const hot = st.hover === n;
            const s = (hot ? 1.25 : 1) + n.userData.flash * 0.6;
            n.scale.setScalar(n.scale.x + (s - n.scale.x) * Math.min(1, dt * 10));
            n.material.emissiveIntensity = 0.5 + n.userData.flash * 1.4 + (hot ? 0.5 : 0);
          });
          pulses.forEach((p) => {
            p.userData.ph = (p.userData.ph + dt * p.userData.speed * (1 + p.userData.burst * 3)) % 1;
            p.userData.burst *= 0.97;
            p.position.lerpVectors(nodes[0].position, p.userData.n.position, p.userData.ph);
          });
          lines.forEach((l) => { l.material.opacity = 0.35 + Math.sin(t * 2) * 0.1; });
        },
        hover: (obj) => {
          if (obj && obj !== st.hover) hud("agent", `${obj.userData.name} — ${obj.userData.role}`);
          st.hover = obj;
        },
        click: () => {
          nodes[0].userData.flash = 1;
          pulses.forEach((p, i) => {
            p.userData.burst = 1;
            p.userData.ph = 0;
            setTimeout(() => { p.userData.n.userData.flash = 1; }, 250 + i * 90);
          });
          hud("signal", "Signal sent: the Master Agent plans, and every worker acts only through guarded tools");
        },
        drag: (dx) => { st.yaw += dx * 0.012; },
      });
    }

    // ── 5 · learn: forty-six vehicles, seven failures, one batch
    {
      const N = 46;
      const FAIL = 7;
      const g = new THREE.Group();
      g.position.set(SPOT[5].x, 0, SPOT[5].z);
      g.add(platform(5));
      const cloud = new THREE.Group();
      cloud.position.y = 4;
      g.add(cloud);
      const mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.3, 20, 20), new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.2 }), N);
      const base = [];
      for (let i = 0; i < N; i++) {
        const y = 1 - (i / (N - 1)) * 2;
        const r = Math.sqrt(1 - y * y);
        const th = i * 2.399963;
        base.push(new THREE.Vector3(Math.cos(th) * r, y, Math.sin(th) * r).multiplyScalar(3.4));
      }
      const order = [...base.keys()].sort((a, b) => base[b].x + base[b].y * 0.5 - (base[a].x + base[a].y * 0.5));
      const clustered = new Set(order.slice(0, FAIL));
      const scattered = new Set([3, 11, 17, 24, 31, 38, 44]);
      const cur = Array.from({ length: N }, () => pal.edge.clone());
      const dummy = new THREE.Object3D();
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      cloud.add(mesh);
      scene.add(g);
      const st = { mode: "cluster", yaw: 0 };
      const target = (i) => ((st.mode === "cluster" ? clustered : scattered).has(i) ? pal.p1 : pal.edge);
      stations.push({
        group: g, pickables: [mesh],
        update: (dt, t, k) => {
          if (!k.dragging && !reduce) st.yaw += dt * 0.25;
          cloud.rotation.y += (st.yaw - cloud.rotation.y) * Math.min(1, dt * 6);
          for (let i = 0; i < N; i++) {
            cur[i].lerp(target(i), Math.min(1, dt * 5));
            const bad = (st.mode === "cluster" ? clustered : scattered).has(i);
            const s = bad ? 1.35 + Math.sin(t * 4 + i) * 0.12 : 0.9;
            dummy.position.copy(base[i]);
            dummy.scale.setScalar(s);
            dummy.updateMatrix();
            mesh.setMatrixAt(i, dummy.matrix);
            mesh.setColorAt(i, cur[i]);
          }
          mesh.instanceMatrix.needsUpdate = true;
          if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        },
        hover: () => {},
        click: () => {
          st.mode = st.mode === "cluster" ? "scatter" : "cluster";
          hud("batch", st.mode === "cluster"
            ? "Seven of forty-six, all from one batch — that is a cluster the plant can act on"
            : "If failures were random they would scatter like this. They do not.");
        },
        drag: (dx) => { st.yaw += dx * 0.012; },
      });
    }

    // ── 6 · protect: the shield
    {
      const g = new THREE.Group();
      g.position.set(SPOT[6].x, 0, SPOT[6].z);
      g.add(platform(4.6));
      const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1, 1), new THREE.MeshStandardMaterial({ color: pal.ok, emissive: pal.ok, emissiveIntensity: 0.8, flatShading: true }));
      core.position.y = 4;
      const shield = new THREE.Mesh(new THREE.IcosahedronGeometry(3, 2), new THREE.MeshBasicMaterial({ color: pal.p3, wireframe: true, transparent: true, opacity: 0.35 }));
      shield.position.y = 4;
      const film = new THREE.Mesh(new THREE.SphereGeometry(3, 48, 48), new THREE.MeshBasicMaterial({ color: pal.p3, transparent: true, opacity: 0.06, side: THREE.BackSide }));
      film.position.y = 4;
      g.add(core, shield, film);
      const attackers = [];
      const ripples = [];
      const origin = new THREE.Vector3(0, 4, 0);
      let blocked = 0;
      let name = 0;
      const launch = () => {
        if (attackers.length > 7) return;
        const dir = new THREE.Vector3(Math.random() - 0.5, (Math.random() - 0.3) * 0.8, Math.random() - 0.5).normalize();
        const a = new THREE.Mesh(new THREE.OctahedronGeometry(0.24), new THREE.MeshBasicMaterial({ color: pal.p1 }));
        a.position.copy(origin).addScaledVector(dir, 15);
        a.userData.dir = dir;
        g.add(a);
        attackers.push(a);
      };
      scene.add(g);
      let idle = 0;
      stations.push({
        group: g, pickables: [shield, film, core],
        update: (dt, t, k) => {
          core.rotation.y += dt * 0.6;
          core.rotation.x += dt * 0.3;
          shield.rotation.y -= dt * 0.12;
          shield.material.opacity += (0.35 - shield.material.opacity) * Math.min(1, dt * 4);
          idle += dt;
          if (k.near && idle > 2.6) { idle = 0; launch(); }
          for (let i = attackers.length - 1; i >= 0; i--) {
            const a = attackers[i];
            a.position.addScaledVector(a.userData.dir, -dt * 7);
            a.rotation.x += dt * 3;
            if (a.position.distanceTo(origin) <= 3.15) {
              const r = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.18, 32), new THREE.MeshBasicMaterial({ color: pal.accent, transparent: true, opacity: 1, side: THREE.DoubleSide }));
              r.position.copy(a.position);
              r.lookAt(origin);
              r.userData.age = 0;
              g.add(r);
              ripples.push(r);
              shield.material.opacity = 0.9;
              g.remove(a);
              a.geometry.dispose();
              a.material.dispose();
              attackers.splice(i, 1);
              blocked += 1;
              hud("block", `${ATTACKS[name % ATTACKS.length]} · ${blocked} stopped so far`);
              name += 1;
            }
          }
          for (let i = ripples.length - 1; i >= 0; i--) {
            const r = ripples[i];
            r.userData.age += dt;
            r.scale.setScalar(1 + r.userData.age * 14);
            r.material.opacity = Math.max(0, 1 - r.userData.age * 1.6);
            if (r.userData.age > 0.65) {
              g.remove(r);
              r.geometry.dispose();
              r.material.dispose();
              ripples.splice(i, 1);
            }
          }
        },
        hover: () => {},
        click: () => { launch(); launch(); },
      });
    }

    // ── 7 · the portal
    {
      const g = new THREE.Group();
      g.position.set(SPOT[7].x, 0, SPOT[7].z);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(5.2, 0.2, 24, 160), new THREE.MeshBasicMaterial({ color: pal.accent }));
      ring.position.y = 4;
      const ring2 = new THREE.Mesh(new THREE.TorusGeometry(6.8, 0.05, 8, 160), new THREE.MeshBasicMaterial({ color: pal.p3, transparent: true, opacity: 0.6 }));
      ring2.position.y = 4;
      const disc = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, transparent: true, opacity: 0.35, depthWrite: false }));
      disc.scale.set(18, 18, 1);
      disc.position.y = 4;
      g.add(ring, ring2, disc);
      const orbit = new THREE.Group();
      orbit.position.y = 4;
      for (let i = 0; i < 28; i++) {
        const a = (i / 28) * Math.PI * 2;
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.1), new THREE.MeshBasicMaterial({ color: i % 2 ? pal.accent : pal.fg }));
        b.position.set(Math.cos(a) * 6, Math.sin(a) * 6, 0);
        b.rotation.z = a;
        orbit.add(b);
      }
      g.add(orbit);
      scene.add(g);
      stations.push({
        group: g,
        update: (dt, t) => {
          orbit.rotation.z += dt * (reduce ? 0 : 0.35);
          ring2.rotation.z -= dt * (reduce ? 0 : 0.1);
          disc.material.opacity = 0.3 + Math.sin(t * 1.6) * 0.06;
        },
      });
    }

    // ── camera, input, loop
    let { pos: posCurve, look: lookCurve } = cameraStops(false);
    let portraitNow = false;
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const k = { dist: 0, pointerX: 0, pointerY: 0, dragging: false, near: false };
    const ptr = { x: 0, y: 0, sx: 0, sy: 0 };
    const drag = { on: false, x: 0, moved: 0 };
    let s = 0;
    let activeIdx = 0;
    const lookV = new THREE.Vector3();
    const camV = new THREE.Vector3();
    const right = new THREE.Vector3();

    const pick = (e) => {
      const st = stations[activeIdx];
      if (!st?.pickables) return null;
      const r = dom.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      return ray.intersectObjects(st.pickables, false)[0]?.object ?? null;
    };
    const onMove = (e) => {
      const r = dom.getBoundingClientRect();
      ptr.x = ((e.clientX - r.left) / r.width - 0.5) * 2;
      ptr.y = ((e.clientY - r.top) / r.height - 0.5) * 2;
      const st = stations[activeIdx];
      if (drag.on) {
        const dx = e.clientX - drag.x;
        drag.x = e.clientX;
        drag.moved += Math.abs(dx);
        st?.drag?.(dx);
        return;
      }
      const hit = pick(e);
      st?.hover?.(hit);
      dom.style.cursor = hit ? "pointer" : st?.drag ? "grab" : "default";
    };
    const onDown = (e) => {
      drag.on = true;
      drag.x = e.clientX;
      drag.moved = 0;
      k.dragging = true;
      dom.setPointerCapture?.(e.pointerId);
    };
    const onUp = (e) => {
      const wasTap = drag.on && drag.moved < 5;
      drag.on = false;
      k.dragging = false;
      if (wasTap) stations[activeIdx]?.click?.(pick(e));
    };
    dom.addEventListener("pointermove", onMove);
    dom.addEventListener("pointerdown", onDown);
    dom.addEventListener("pointerup", onUp);

    const resize = () => {
      const w = el.clientWidth || 1;
      const h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      const portrait = w / h < 0.8;
      camera.fov = portrait ? 62 : 50;
      if (portrait !== portraitNow) {
        portraitNow = portrait;
        ({ pos: posCurve, look: lookCurve } = cameraStops(portrait));
      }
      camera.updateProjectionMatrix();
    };
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    ro?.observe(el);
    resize();

    let raf = 0;
    let visible = true;
    let last = performance.now();
    let t = 0;
    function frame(now) {
      raf = requestAnimationFrame(frame);
      const real = (now - last) / 1000;
      const dt = Math.min(real, 0.05);
      last = now;
      if (document.hidden || !visible) return;
      t += dt;
      k.dist += dt * 14;
      ptr.sx += (ptr.x - ptr.sx) * Math.min(1, dt * 4);
      ptr.sy += (ptr.y - ptr.sy) * Math.min(1, dt * 4);
      k.pointerX = ptr.sx;
      k.pointerY = ptr.sy;

      const goal = Math.min(STOPS - 1, Math.max(0, progressRef.current ?? 0));
      // The flight follows the clock rather than the frame count, so a slow machine
      // arrives at the same stop as a fast one, only less smoothly.
      s += (goal - s) * Math.min(1, Math.min(real, 0.25) * 3.2);
      const i = Math.min(STOPS - 2, Math.floor(s));
      const f = s - i;
      const u = (i + smooth(0.22, 0.78, f)) / (STOPS - 1);
      posCurve.getPoint(u, camV);
      lookCurve.getPoint(u, lookV);
      camera.position.copy(camV);
      camera.lookAt(lookV);
      // Pointer leans the camera: a little parallax makes the world feel solid.
      right.setFromMatrixColumn(camera.matrixWorld, 0);
      camera.position.addScaledVector(right, ptr.sx * 0.9);
      camera.position.y -= ptr.sy * 0.45;
      camera.lookAt(lookV);

      activeIdx = Math.round(Math.min(STOPS - 1, Math.max(0, s)));
      stations.forEach((st, idx) => {
        k.near = idx === activeIdx;
        if (idx === 0 || Math.abs(s - idx) < 1.7) st.update?.(dt, t, k);
      });
      renderer.render(scene, camera);
    }
    raf = requestAnimationFrame(frame);
    const io = typeof IntersectionObserver !== "undefined"
      ? new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; })
      : null;
    io?.observe(el);

    return () => {
      cancelAnimationFrame(raf);
      dom.removeEventListener("pointermove", onMove);
      dom.removeEventListener("pointerdown", onDown);
      dom.removeEventListener("pointerup", onUp);
      ro?.disconnect();
      io?.disconnect();
      scene.traverse((o) => {
        o.geometry?.dispose?.();
        const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        for (const m of mats) { m.map?.dispose?.(); m.dispose?.(); }
      });
      renderer.dispose();
      renderer.forceContextLoss();
      dom.remove();
    };
    // Built once; the story drives it through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={host} className={className} />;
}
