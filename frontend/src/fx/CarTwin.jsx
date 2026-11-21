import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { useEffect, useRef } from "react";

/**
 * The owner's car as a 3D "digital twin": a model on a turntable that the owner
 * can drag round, with a marker at each part the agent watches. The part the
 * agent has flagged glows in its severity colour and carries a callout with the
 * part's name and how long it has; the rest sit quietly green. A scan sweeps
 * the car while everything is well — the product's promise, "agent watching",
 * made visible. Tapping a marker reports it, so the screen can open the
 * evidence for that part.
 *
 * It is a model of *a* car, not of this exact one — there is no CAD for the
 * Bolero here — so it is drawn plainly (a boxy utility body) and the markers
 * sit where those parts live on a front-engined vehicle.
 *
 * Same engineering as Road3D: colours read from the CSS tokens, drawing stops
 * when hidden or off-screen, one still frame under reduced motion, full
 * disposal on unmount. `onUnsupported` lets the caller fall back without WebGL.
 */

/** Where each watched part lives, in car space (nose toward -z). */
export const PARTS = {
  water_pump: { label: "Water pump", signal: "coolant temperature", pos: [0.45, 1.02, -1.45] },
  battery: { label: "Battery", signal: "battery voltage", pos: [-0.62, 1.02, -1.75] },
  fuel_injector: { label: "Fuel injector", signal: "fuel pressure", pos: [0.0, 1.02, -1.05] },
  oil_pump: { label: "Oil pump", signal: "oil pressure", pos: [-0.2, 0.46, -1.4] },
  brake_pads: { label: "Brake pads", signal: "brake fluid level", pos: [1.0, 0.42, -1.4] },
};

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const token = (name, fallback) => new THREE.Color(css(name) || fallback);

function dotTexture(color, ring = false) {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const g = c.getContext("2d");
  const solid = color.getStyle();
  const clear = solid.replace("rgb(", "rgba(").replace(")", ",0)");
  if (ring) {
    g.strokeStyle = solid;
    g.lineWidth = 6;
    g.beginPath();
    g.arc(64, 64, 52, 0, Math.PI * 2);
    g.stroke();
  } else {
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, solid);
    grad.addColorStop(0.35, solid);
    grad.addColorStop(1, clear);
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  }
  return new THREE.CanvasTexture(c);
}

export default function CarTwin({ part = null, severity = null, caption = "", className = "", onSelect, onUnsupported }) {
  const host = useRef(null);
  const callout = useRef(null);
  const tip = useRef(null);
  // Read inside the render loop, so changing them never rebuilds the scene.
  const live = useRef({ part, severity, caption, onSelect });
  live.current = { part, severity, caption, onSelect };

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
    renderer.domElement.style.cssText = "display:block;width:100%;height:100%;touch-action:pan-y;cursor:grab";
    el.appendChild(renderer.domElement);

    const accent = token("--color-accent", "orange");
    const okCol = token("--color-ok", "green");
    const p1 = token("--color-p1", "red");
    const p2 = token("--color-p2", "orange");
    const panel = token("--color-surface-panel", "white");
    const card = token("--color-surface-card", "white");
    const chrome = token("--color-chrome", "gray");
    const edge = token("--color-border-strong", "gray");
    const carCol = token("--color-device-ring", "black");
    const glassCol = token("--color-fg-subtle", "gray");

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    scene.add(new THREE.HemisphereLight(card, chrome, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.9);
    sun.position.set(-6, 10, 6);
    scene.add(sun);

    // ── the turntable
    const stage = new THREE.Group();
    scene.add(stage);
    const platform = new THREE.Mesh(
      new THREE.CylinderGeometry(3.5, 3.7, 0.14, 72),
      new THREE.MeshStandardMaterial({ color: panel, roughness: 0.9 }),
    );
    platform.position.y = -0.1;
    stage.add(platform);
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(3.45, 0.025, 8, 120).rotateX(Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: accent }),
    );
    rim.position.y = 0;
    stage.add(rim);
    const ticks = new THREE.Group();
    const tickMat = new THREE.MeshBasicMaterial({ color: edge });
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      const tk = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.02, i % 4 === 0 ? 0.3 : 0.14), tickMat);
      tk.position.set(Math.sin(a) * 3.1, 0, Math.cos(a) * 3.1);
      tk.rotation.y = a;
      ticks.add(tk);
    }
    stage.add(ticks);

    // ── the car, nose to -z
    const car = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: carCol, roughness: 0.35, metalness: 0.5 });
    const body = new THREE.Mesh(new RoundedBoxGeometry(1.95, 0.72, 4.3, 4, 0.2), bodyMat);
    body.position.y = 0.7;
    const cabin = new THREE.Mesh(
      new RoundedBoxGeometry(1.72, 0.74, 2.35, 4, 0.2),
      new THREE.MeshStandardMaterial({ color: glassCol, roughness: 0.15, metalness: 0.6, transparent: true, opacity: 0.88 }),
    );
    cabin.position.set(0, 1.3, 0.35);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.98, 0.05, 4.1), new THREE.MeshBasicMaterial({ color: accent }));
    stripe.position.y = 0.78;
    const wheelGeo = new THREE.CylinderGeometry(0.44, 0.44, 0.34, 26).rotateZ(Math.PI / 2);
    const wheelMat = new THREE.MeshStandardMaterial({ color: carCol, roughness: 0.9 });
    const wheels = [];
    for (const sx of [-1.0, 1.0]) {
      for (const sz of [-1.45, 1.45]) {
        const w = new THREE.Mesh(wheelGeo, wheelMat);
        w.position.set(sx, 0.44, sz);
        wheels.push(w);
        car.add(w);
      }
    }
    const lampMat = new THREE.MeshBasicMaterial({ color: card });
    const tailMat = new THREE.MeshBasicMaterial({ color: accent });
    for (const sx of [-0.68, 0.68]) {
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.06), lampMat);
      head.position.set(sx, 0.86, -2.17);
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.06), tailMat);
      tail.position.set(sx, 0.86, 2.17);
      car.add(head, tail);
    }
    car.add(body, cabin, stripe);
    stage.add(car);

    // ── the scan: a translucent sheet that sweeps the car while all is well
    const scan = new THREE.Mesh(
      new THREE.PlaneGeometry(3.2, 2.2).rotateY(Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }),
    );
    scan.position.y = 1.1;
    stage.add(scan);

    // ── one marker per watched part
    const glow = dotTexture(okCol);
    const ringTex = dotTexture(accent, true);
    const spots = {};
    const hitMeshes = [];
    for (const [key, info] of Object.entries(PARTS)) {
      const g = new THREE.Group();
      g.position.set(...info.pos);
      const dotMat = new THREE.SpriteMaterial({ map: glow, color: okCol, transparent: true, depthWrite: false, depthTest: false });
      const dot = new THREE.Sprite(dotMat);
      dot.scale.set(0.34, 0.34, 1);
      const ringMat = new THREE.SpriteMaterial({ map: ringTex, color: okCol, transparent: true, opacity: 0, depthWrite: false, depthTest: false });
      const ring = new THREE.Sprite(ringMat);
      const hit = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 12), new THREE.MeshBasicMaterial({ visible: false }));
      hit.userData.part = key;
      g.add(dot, ring, hit);
      car.add(g);
      spots[key] = { g, dot, dotMat, ring, ringMat };
      hitMeshes.push(hit);
    }

    // ── pointer: drag to turn, hover to name a part, tap a marker to open it
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const state = { yaw: -0.6, target: -0.6, dragging: false, moved: 0, lastX: 0, rest: 0, hover: null, px: 0, py: 0 };
    const pick = (e) => {
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObjects(hitMeshes, false)[0];
      state.px = e.clientX - r.left;
      state.py = e.clientY - r.top;
      return hit ? hit.object.userData.part : null;
    };
    const onDown = (e) => {
      state.dragging = true;
      state.moved = 0;
      state.lastX = e.clientX;
      renderer.domElement.setPointerCapture?.(e.pointerId);
      renderer.domElement.style.cursor = "grabbing";
    };
    const onMove = (e) => {
      if (state.dragging) {
        const dx = e.clientX - state.lastX;
        state.lastX = e.clientX;
        state.moved += Math.abs(dx);
        state.target += dx * 0.012;
        state.rest = 2.5;
      } else {
        state.hover = pick(e);
        renderer.domElement.style.cursor = state.hover ? "pointer" : "grab";
      }
    };
    const onUp = (e) => {
      const wasTap = state.dragging && state.moved < 5;
      state.dragging = false;
      renderer.domElement.style.cursor = "grab";
      if (wasTap) {
        const part = pick(e);
        if (part) live.current.onSelect?.(part);
      }
    };
    const onLeave = () => { state.hover = null; };
    const dom = renderer.domElement;
    dom.addEventListener("pointerdown", onDown);
    dom.addEventListener("pointermove", onMove);
    dom.addEventListener("pointerup", onUp);
    dom.addEventListener("pointerleave", onLeave);

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

    const v = new THREE.Vector3();
    const project = (obj, node, dx = 0, dy = 0) => {
      obj.getWorldPosition(v);
      v.project(camera);
      const w = el.clientWidth;
      const h = el.clientHeight;
      node.style.transform = `translate(${(v.x * 0.5 + 0.5) * w + dx}px, ${(-v.y * 0.5 + 0.5) * h + dy}px)`;
      node.style.opacity = v.z < 1 ? "1" : "0";
    };

    let t = 0;
    function draw(dt) {
      const { part: active, severity: sev, caption: cap } = live.current;
      const flagged = active && spots[active] ? active : null;
      const warn = sev === "P1" ? p1 : p2;

      // Settle into view, then idle-turn gently; a drag pauses the idle turn.
      if (!state.dragging && !reduce) {
        state.rest = Math.max(0, state.rest - dt);
        if (state.rest === 0) state.target += dt * 0.16;
      }
      state.yaw += (state.target - state.yaw) * Math.min(1, dt * 6 + (reduce ? 1 : 0));
      stage.rotation.y = state.yaw;
      ticks.rotation.y = -t * 0.12;

      const sweep = (t * 0.55) % 1;
      scan.position.z = -2.6 + sweep * 5.2;
      scan.material.opacity = flagged ? 0 : 0.18 * Math.sin(sweep * Math.PI);

      for (const [key, s] of Object.entries(spots)) {
        const isFlagged = key === flagged;
        const col = isFlagged ? warn : okCol;
        s.dotMat.color.copy(col);
        s.ringMat.color.copy(col);
        const pulse = 1 + Math.sin(t * 3.2) * 0.18;
        s.dot.scale.setScalar(isFlagged ? 0.5 * pulse : state.hover === key ? 0.42 : 0.26);
        const ph = (t * 0.9) % 1;
        s.ringMat.opacity = isFlagged ? (1 - ph) * 0.9 : 0;
        s.ring.scale.setScalar(isFlagged ? 0.5 + ph * 1.1 : 0.01);
      }

      camera.position.set(5.9, 3.5, 6.9);
      camera.lookAt(0, 0.85, 0);
      renderer.render(scene, camera);

      if (callout.current) {
        if (flagged) {
          project(spots[flagged].g, callout.current, 14, -14);
          callout.current.textContent = cap || PARTS[flagged].label;
        } else {
          callout.current.style.opacity = "0";
        }
      }
      if (tip.current) {
        if (state.hover && state.hover !== flagged) {
          tip.current.style.opacity = "1";
          tip.current.style.transform = `translate(${state.px + 14}px, ${state.py - 34}px)`;
          tip.current.textContent = `${PARTS[state.hover].label} · watching ${PARTS[state.hover].signal}`;
        } else {
          tip.current.style.opacity = "0";
        }
      }
      for (const w of wheels) w.rotation.x -= dt * (state.dragging ? 0 : 0.5);
    }

    let raf = 0;
    let visible = true;
    let last = performance.now();
    function frame(now) {
      raf = requestAnimationFrame(frame);
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      if (document.hidden || !visible) return;
      t += dt;
      draw(dt);
    }
    resize();
    if (reduce) draw(0);
    else raf = requestAnimationFrame(frame);
    // Under reduced motion nothing animates, so redraw when the data changes.
    let redraw = 0;
    if (reduce) redraw = window.setInterval(() => draw(0), 500);

    const io = typeof IntersectionObserver !== "undefined"
      ? new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; })
      : null;
    io?.observe(el);

    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(redraw);
      dom.removeEventListener("pointerdown", onDown);
      dom.removeEventListener("pointermove", onMove);
      dom.removeEventListener("pointerup", onUp);
      dom.removeEventListener("pointerleave", onLeave);
      ro?.disconnect();
      io?.disconnect();
      scene.traverse((o) => {
        o.geometry?.dispose?.();
        const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        for (const m of mats) { m.map?.dispose?.(); m.dispose(); }
      });
      renderer.dispose();
      renderer.forceContextLoss();
      dom.remove();
    };
    // The scene is built once; props are read live through `live`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={host} className={`relative overflow-hidden ${className}`}>
      <div
        ref={callout}
        aria-hidden="true"
        className="glass pointer-events-none absolute left-0 top-0 z-[1] whitespace-nowrap rounded-lg px-2.5 py-1 text-label font-semibold text-fg-strong"
        style={{ opacity: 0 }}
      />
      <div
        ref={tip}
        aria-hidden="true"
        className="glass pointer-events-none absolute left-0 top-0 z-[1] whitespace-nowrap rounded-lg px-2.5 py-1 text-caption text-fg-secondary"
        style={{ opacity: 0 }}
      />
    </div>
  );
}
