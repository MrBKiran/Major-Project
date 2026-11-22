import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { useEffect, useRef } from "react";

/**
 * The hero's car: an Indian SUV on a studio floor, lit like a product shot.
 *
 * The body is the side profile of a boxy utility vehicle extruded and bevelled,
 * with real wheel arches, a glass greenhouse that tucks in above the beltline,
 * blacked-out pillars, roof rails and a spare wheel on the tailgate. Paint is a
 * clear-coated metallic under a studio environment map, so it reflects like a
 * car rather than a toy. The part the agent has flagged glows through the body
 * in the scenario's colour, with a label that follows it on screen; under attack
 * there is no part, and a shield closes over the car instead.
 *
 * Colours come from CSS custom properties on the host (site.css), never from
 * literals: `paint` and `tone` name the properties, and changing either eases
 * the car to its new colours without rebuilding the scene. Drawing stops when the
 * car is off-screen or the tab is hidden, reduced motion gets a still car, and
 * everything is disposed on unmount. `onUnsupported` lets the caller fall back.
 */

/** Where each part the agents watch lives, in car space (+x is the nose). */
const PART_POS = {
  water_pump: new THREE.Vector3(1.72, 0.98, 0.28),
  brake_pads: new THREE.Vector3(1.38, 0.4, 1.0),
};

function glowTexture(ring = false) {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const g = c.getContext("2d");
  if (ring) {
    g.strokeStyle = "rgba(255,255,255,1)";
    g.lineWidth = 5;
    g.beginPath();
    g.arc(64, 64, 54, 0, Math.PI * 2);
    g.stroke();
  } else {
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.28, "rgba(255,255,255,0.95)");
    grad.addColorStop(0.55, "rgba(255,255,255,0.35)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function contactShadowTexture() {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(128, 64, 8, 128, 64, 124);
  grad.addColorStop(0, "rgba(0,0,0,0.55)");
  grad.addColorStop(0.5, "rgba(0,0,0,0.22)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 128);
  return new THREE.CanvasTexture(c);
}

/** The side profile below the beltline, wheel arches cut in. */
function lowerProfile() {
  const s = new THREE.Shape();
  s.moveTo(-2.2, 0.36);
  s.lineTo(-1.88, 0.36);
  s.absarc(-1.38, 0.4, 0.5, Math.PI, 0, true);
  s.lineTo(0.88, 0.36);
  s.absarc(1.38, 0.4, 0.5, Math.PI, 0, true);
  s.lineTo(2.16, 0.36);
  s.quadraticCurveTo(2.3, 0.38, 2.3, 0.6);
  s.lineTo(2.28, 0.9);
  s.quadraticCurveTo(2.26, 1.05, 2.06, 1.07);
  s.lineTo(0.95, 1.13);
  s.lineTo(-2.1, 1.12);
  s.quadraticCurveTo(-2.24, 1.11, -2.24, 0.98);
  s.lineTo(-2.24, 0.52);
  s.quadraticCurveTo(-2.24, 0.36, -2.2, 0.36);
  return s;
}

/** The glasshouse above the beltline. */
function upperProfile() {
  const s = new THREE.Shape();
  s.moveTo(0.92, 1.1);
  s.lineTo(0.34, 1.62);
  s.quadraticCurveTo(0.24, 1.69, 0.06, 1.69);
  s.lineTo(-1.76, 1.71);
  s.quadraticCurveTo(-1.92, 1.71, -1.98, 1.6);
  s.lineTo(-2.1, 1.2);
  s.lineTo(-2.1, 1.1);
  s.lineTo(0.92, 1.1);
  return s;
}

function extrude(shape, width, bevel, bevelSize) {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width, bevelEnabled: true, bevelThickness: bevel, bevelSize,
    bevelSegments: 6, curveSegments: 28,
  });
  geo.translate(0, 0, -width / 2);
  geo.computeVertexNormals();
  return geo;
}

function wheel(mats) {
  const w = new THREE.Group();
  const tyre = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.28, 48).rotateX(Math.PI / 2), mats.rubber);
  const wall = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.05, 12, 48), mats.rubber);
  wall.position.z = 0.14;
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.29, 36).rotateX(Math.PI / 2), mats.chrome);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.31, 20).rotateX(Math.PI / 2), mats.trim);
  w.add(tyre, wall, rim, hub);
  for (let i = 0; i < 6; i += 1) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.2, 0.03), mats.trim);
    spoke.position.set(0, 0, 0.15);
    spoke.rotation.z = (i / 6) * Math.PI * 2;
    spoke.translateY(0.12);
    w.add(spoke);
  }
  w.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return w;
}

export default function HeroCar({ paint = "--s-paint-blue", tone = "teal", part = null, label = "", className = "", onUnsupported }) {
  const host = useRef(null);
  const callout = useRef(null);
  const live = useRef({ paint, tone, part, label });
  live.current = { paint, tone, part, label };

  useEffect(() => {
    const el = host.current;
    if (!el) return undefined;

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    } catch {
      onUnsupported?.();
      return undefined;
    }
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.cssText = "display:block;width:100%;height:100%;touch-action:pan-y;cursor:grab";
    el.prepend(renderer.domElement);

    const cssVar = (name, fallback) => getComputedStyle(el).getPropertyValue(name).trim() || fallback;
    const color = (name, fallback) => new THREE.Color(cssVar(name, fallback));

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    scene.environment = pmrem.fromScene(room, 0.04).texture;

    const camera = new THREE.PerspectiveCamera(27, 1, 0.1, 100);

    scene.add(new THREE.HemisphereLight(0xffffff, color("--s-floor", "white"), 0.55));
    const sun = new THREE.DirectionalLight(0xffffff, 2.4);
    sun.position.set(3.5, 8, 4.5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 1, far: 20 });
    sun.shadow.bias = -0.0004;
    sun.shadow.radius = 6;
    scene.add(sun);

    // ── materials
    const mats = {
      paint: new THREE.MeshPhysicalMaterial({
        color: color(live.current.paint, "steelblue"), metalness: 0.55, roughness: 0.3,
        clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.1,
      }),
      glass: new THREE.MeshPhysicalMaterial({
        color: color("--s-glass", "black"), metalness: 0.2, roughness: 0.04, clearcoat: 1, envMapIntensity: 1.6,
      }),
      trim: new THREE.MeshStandardMaterial({ color: color("--s-trim", "black"), roughness: 0.55, metalness: 0.2 }),
      rubber: new THREE.MeshStandardMaterial({ color: color("--s-rubber", "black"), roughness: 0.92 }),
      chrome: new THREE.MeshStandardMaterial({ color: color("--s-chrome", "silver"), metalness: 1, roughness: 0.22 }),
      lamp: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: color("--s-headlamp", "white"), emissiveIntensity: 1.4 }),
      tail: new THREE.MeshStandardMaterial({ color: color("--s-taillamp", "red"), emissive: color("--s-taillamp", "red"), emissiveIntensity: 0.9 }),
    };

    // ── the car
    const turntable = new THREE.Group();
    scene.add(turntable);
    const car = new THREE.Group();
    turntable.add(car);

    const body = new THREE.Mesh(extrude(lowerProfile(), 1.66, 0.13, 0.07), mats.paint);
    const glasshouse = new THREE.Mesh(extrude(upperProfile(), 1.5, 0.08, 0.04), mats.glass);
    const roof = new THREE.Mesh(new RoundedBoxGeometry(1.92, 0.07, 1.6, 4, 0.03), mats.paint);
    roof.position.set(-0.84, 1.75, 0);
    car.add(body, glasshouse, roof);

    // Blacked-out pillars, the way most current SUVs wear them.
    const aLen = Math.hypot(0.6, 0.54);
    for (const z of [-0.79, 0.79]) {
      const a = new THREE.Mesh(new THREE.BoxGeometry(aLen, 0.07, 0.05), mats.trim);
      a.position.set(0.63, 1.38, z);
      a.rotation.z = Math.atan2(0.54, -0.6);
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.6, 0.05), mats.trim);
      b.position.set(-0.6, 1.4, z);
      const d = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.58, 0.05), mats.trim);
      d.position.set(-2.0, 1.4, z);
      car.add(a, b, d);
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.7, 10).rotateZ(Math.PI / 2), mats.chrome);
      rail.position.set(-0.84, 1.83, z * 0.86);
      car.add(rail);
      const mirror = new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.12, 0.2, 3, 0.03), mats.paint);
      mirror.position.set(0.78, 1.2, z * 1.25);
      car.add(mirror);
      const lamp = new THREE.Mesh(new RoundedBoxGeometry(0.06, 0.13, 0.36, 3, 0.03), mats.lamp);
      lamp.position.set(2.33, 0.9, z * 0.7);
      const tail = new THREE.Mesh(new RoundedBoxGeometry(0.06, 0.3, 0.12, 3, 0.02), mats.tail);
      tail.position.set(-2.32, 0.92, z * 0.92);
      car.add(lamp, tail);
    }

    // Grille with vertical slats, bumpers and a skid plate.
    const grille = new THREE.Mesh(new RoundedBoxGeometry(0.05, 0.3, 0.86, 2, 0.02), mats.trim);
    grille.position.set(2.32, 0.8, 0);
    car.add(grille);
    for (let i = -3; i <= 3; i += 1) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.26, 0.025), mats.chrome);
      slat.position.set(2.35, 0.8, i * 0.11);
      car.add(slat);
    }
    const bumperF = new THREE.Mesh(new RoundedBoxGeometry(0.18, 0.2, 1.86, 3, 0.05), mats.trim);
    bumperF.position.set(2.3, 0.47, 0);
    const bumperR = new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.2, 1.84, 3, 0.05), mats.trim);
    bumperR.position.set(-2.28, 0.47, 0);
    const skid = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.07, 0.9), mats.chrome);
    skid.position.set(2.4, 0.4, 0);
    car.add(bumperF, bumperR, skid);

    const wheels = [];
    for (const [x, z] of [[1.38, 0.82], [1.38, -0.82], [-1.38, 0.82], [-1.38, -0.82]]) {
      const w = wheel(mats);
      w.position.set(x, 0.38, z);
      if (z < 0) w.rotation.y = Math.PI;
      wheels.push(w);
      car.add(w);
    }
    const spare = wheel(mats);
    spare.rotation.y = -Math.PI / 2;
    spare.scale.setScalar(0.92);
    spare.position.set(-2.44, 1.0, 0);
    car.add(spare);

    car.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

    // ── the floor: a soft shadow, a contact shadow, and a ring in the run's colour
    const floor = new THREE.Mesh(new THREE.CircleGeometry(7, 64).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ opacity: 0.2 }));
    floor.receiveShadow = true;
    scene.add(floor);
    const contact = new THREE.Mesh(
      new THREE.PlaneGeometry(5.6, 2.8).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: contactShadowTexture(), transparent: true, depthWrite: false }),
    );
    contact.position.y = 0.004;
    turntable.add(contact);
    const toneMat = new THREE.MeshBasicMaterial({ color: color(`--s-${live.current.tone}`, "teal"), transparent: true, opacity: 0.9 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.05, 0.018, 8, 160).rotateX(Math.PI / 2), toneMat);
    ring.position.y = 0.01;
    scene.add(ring);
    const dashMat = new THREE.MeshBasicMaterial({ color: color(`--s-${live.current.tone}`, "teal"), transparent: true, opacity: 0.55 });
    const dashes = new THREE.Group();
    for (let i = 0; i < 72; i += 1) {
      const t = (i / 72) * Math.PI * 2;
      const dash = new THREE.Mesh(new THREE.PlaneGeometry(i % 6 === 0 ? 0.22 : 0.1, 0.02).rotateX(-Math.PI / 2), dashMat);
      dash.position.set(Math.cos(t) * 3.3, 0.012, Math.sin(t) * 3.3);
      dash.rotation.y = -t;
      dashes.add(dash);
    }
    scene.add(dashes);

    // ── the flagged part: a glow and a ripple, drawn through the body
    const glowMat = new THREE.SpriteMaterial({ map: glowTexture(), color: toneMat.color.clone(), depthTest: false, transparent: true });
    const rippleMat = new THREE.SpriteMaterial({ map: glowTexture(true), color: toneMat.color.clone(), depthTest: false, transparent: true });
    const glow = new THREE.Sprite(glowMat);
    const ripple = new THREE.Sprite(rippleMat);
    glow.renderOrder = 10;
    ripple.renderOrder = 11;
    glow.scale.setScalar(0.6);
    car.add(glow, ripple);

    // ── under attack: a shield closes over the car
    const shieldMat = new THREE.MeshBasicMaterial({ color: toneMat.color.clone(), transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
    const shield = new THREE.Mesh(new THREE.SphereGeometry(3.05, 64, 24, 0, Math.PI * 2, 0, Math.PI / 2), shieldMat);
    shield.scale.y = 0.78;
    scene.add(shield);
    const latMat = new THREE.LineBasicMaterial({ color: toneMat.color.clone(), transparent: true, opacity: 0 });
    const lats = new THREE.Group();
    for (const lat of [0.25, 0.5, 0.75]) {
      const r = Math.cos(lat * Math.PI / 2) * 3.05;
      const pts = Array.from({ length: 97 }, (_, i) => {
        const t = (i / 96) * Math.PI * 2;
        return new THREE.Vector3(Math.cos(t) * r, Math.sin(lat * Math.PI / 2) * 3.05 * 0.78, Math.sin(t) * r);
      });
      lats.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), latMat));
    }
    scene.add(lats);

    // ── interaction: drag to turn, with a little inertia
    let yaw = -0.55;
    let vel = 0;
    let dragging = false;
    let lastX = 0;
    let pointerX = 0;
    let pointerY = 0;
    const onDown = (e) => { dragging = true; lastX = e.clientX; renderer.domElement.style.cursor = "grabbing"; renderer.domElement.setPointerCapture?.(e.pointerId); };
    const onMove = (e) => {
      const r = el.getBoundingClientRect();
      pointerX = ((e.clientX - r.left) / r.width) * 2 - 1;
      pointerY = ((e.clientY - r.top) / r.height) * 2 - 1;
      if (!dragging) return;
      const dx = e.clientX - lastX;
      lastX = e.clientX;
      vel = dx * 0.006;
      yaw += vel;
    };
    const onUp = () => { dragging = false; renderer.domElement.style.cursor = "grab"; };
    renderer.domElement.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);

    // ── sizing
    let aspect = 1;
    const resize = () => {
      const { width, height } = el.getBoundingClientRect();
      if (!width || !height) return;
      aspect = width / height;
      renderer.setSize(width, height, false);
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    // ── colour changes ease in rather than snap
    const targetPaint = mats.paint.color.clone();
    const targetTone = toneMat.color.clone();
    let seen = { paint: live.current.paint, tone: live.current.tone };

    let visible = true;
    const io = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }, { threshold: 0 });
    io.observe(el);

    const clock = new THREE.Clock();
    const worldPos = new THREE.Vector3();
    let shieldAmt = live.current.part ? 0 : 1;
    let raf = 0;

    const frame = () => {
      raf = requestAnimationFrame(frame);
      if (!visible || document.hidden) { clock.getDelta(); return; }
      const dt = Math.min(clock.getDelta(), 0.05);
      const t = clock.elapsedTime;
      const { paint: p, tone: tn, part: pt, label: lb } = live.current;

      if (p !== seen.paint || tn !== seen.tone) {
        targetPaint.set(cssVar(p, "steelblue"));
        targetTone.set(cssVar(`--s-${tn}`, "teal"));
        if (!reduce) vel += 0.06; // a small spin, so the change is felt
        seen = { paint: p, tone: tn };
      }
      mats.paint.color.lerp(targetPaint, reduce ? 1 : Math.min(1, dt * 4));
      toneMat.color.lerp(targetTone, reduce ? 1 : Math.min(1, dt * 4));
      dashMat.color.copy(toneMat.color);
      glowMat.color.copy(toneMat.color);
      rippleMat.color.copy(toneMat.color);
      shieldMat.color.copy(toneMat.color);
      latMat.color.copy(toneMat.color);

      if (!dragging) {
        vel *= 0.94;
        yaw += vel + (reduce ? 0 : dt * 0.16);
      }
      turntable.rotation.y = yaw;
      dashes.rotation.y = reduce ? 0 : -t * 0.05;

      // camera: pulled back on narrow screens, a touch of parallax from the pointer
      const dist = 9.4 * Math.max(1, (aspect < 1 ? 1.75 : 1.3) / aspect);
      const px = reduce ? 0 : pointerX * 0.35;
      const py = reduce ? 0 : pointerY * 0.18;
      camera.position.set(dist * 0.62 + px, 2.5 - py, dist * 0.78);
      camera.lookAt(0, 0.82, 0);

      // the flagged part, or the shield
      const pos = pt ? PART_POS[pt] : null;
      shieldAmt += ((pos ? 0 : 1) - shieldAmt) * Math.min(1, dt * 3);
      shieldMat.opacity = shieldAmt * (0.07 + (reduce ? 0 : Math.sin(t * 2.2) * 0.02));
      latMat.opacity = shieldAmt * 0.5;
      shield.visible = lats.visible = shieldAmt > 0.01;

      glow.visible = ripple.visible = Boolean(pos);
      if (pos) {
        glow.position.copy(pos);
        ripple.position.copy(pos);
        const k = reduce ? 0.5 : (t * 0.9) % 1;
        ripple.scale.setScalar(0.4 + k * 1.1);
        rippleMat.opacity = 1 - k;
        glow.scale.setScalar(0.55 + (reduce ? 0 : Math.sin(t * 3) * 0.06));
      }

      renderer.render(scene, camera);

      const tip = callout.current;
      if (tip) {
        if (pos && lb) {
          glow.getWorldPosition(worldPos).project(camera);
          const r = el.getBoundingClientRect();
          const x = (worldPos.x * 0.5 + 0.5) * r.width;
          const y = (-worldPos.y * 0.5 + 0.5) * r.height;
          tip.style.opacity = "1";
          tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
          // Past the middle, the label hangs to the left so it never runs off the stage.
          tip.dataset.side = x > r.width * 0.55 ? "left" : "right";
        } else {
          tip.style.opacity = "0";
        }
      }
    };
    frame();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      scene.traverse((o) => {
        o.geometry?.dispose?.();
        const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        for (const m of ms) { m.map?.dispose?.(); m.dispose?.(); }
      });
      scene.environment?.dispose?.();
      room.dispose?.();
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
    // The scene is built once; props flow in through `live`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={host} className={`s-car ${className}`}>
      <div ref={callout} className="s-car-callout" data-tone={tone} aria-hidden="true">
        <span className="s-car-callout-dot" />
        <span className="s-car-callout-text">{label}</span>
      </div>
    </div>
  );
}
