// Rendering + interaction only. All geometry/contact logic lives in src/core.mjs.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as core from './src/core.mjs';

const scenesDoc = await (await fetch('./data/scenes.json')).json();
const reference = await (await fetch('./data/reference.json')).json();
const terrain = core.buildTerrain(scenesDoc.terrain);

const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
app.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d1117);
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 10, 200000);
camera.position.set(14000, 11000, 14000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(6000, 0, 6000);
controls.update();
scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x202830, 2.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(1, 2, 1); scene.add(sun);

// terrain geometry (non-indexed, flat shaded)
const pos = [], col = [];
const lo = Math.min(...terrain.heights), hi = Math.max(...terrain.heights);
for (const t of terrain.tris) {
  for (const v of [t.a, t.b, t.c]) {
    pos.push(v[0] - 6000, v[1], v[2] - 6000);
    const k = (v[1] - lo) / Math.max(1, hi - lo);
    col.push(0.16 + 0.35 * k, 0.35 + 0.3 * k, 0.5 + 0.35 * k);
  }
}
const tg = new THREE.BufferGeometry();
tg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
tg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
tg.computeVertexNormals();
scene.add(new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 })));

// unit box scaled to the sample half-extent, geometry centred at origin
const boxGeo = new THREE.BoxGeometry(2, 2, 2);
const box = new THREE.Mesh(boxGeo, new THREE.MeshStandardMaterial({ color: 0xffb454, metalness: 0.1, roughness: 0.45 }));
scene.add(box);
scene.add(new THREE.BoxHelper(box, 0xffffff));

const dotGeo = new THREE.SphereGeometry(110, 12, 10);
const dotMat = new THREE.MeshBasicMaterial({ color: 0xff3b30 });
const dots = new THREE.Group(); scene.add(dots);

const sceneEl = document.getElementById('scene');
const frameEl = document.getElementById('frame');
const $ = id => document.getElementById(id);

function update() {
  const si = +sceneEl.value, fi = +frameEl.value;
  const fr = scenesDoc.scenes[si].frames[fi];
  const half = fr.half;
  box.scale.set(half[0], half[1], half[2]);
  box.position.set(fr.center[0] - 6000, fr.center[1], fr.center[2] - 6000);

  const res = core.contactsFor(terrain, fr.center, half);
  const man = core.buildManifold(res.contacts, [fr.center[0], fr.center[2]]);
  dots.clear();
  for (const p of res.contacts) {
    const d = new THREE.Mesh(dotGeo, dotMat);
    // contact point sits on the surface below the box vertex
    const y = +p.depthNum + fr.center[1] - half[1];
    d.position.set(p.x - 6000, y, p.z - 6000);
    dots.add(d);
  }
  const ids = man.points.map(p => p.featureId).sort().join('|');
  const hash = core.hashString(ids);
  const baked = reference.perFrame[si][fi];
  const match = baked.count === res.contacts.length && baked.hash === hash && baked.valid === man.valid;

  $('sceneLbl').textContent = `${si} / 59`;
  $('frameLbl').textContent = `${fi} / 23`;
  $('contacts').textContent = String(res.contacts.length);
  $('manifold').textContent = `${man.points.length} pts ${man.valid ? 'valid' : 'rejected: ' + man.reason}`;
  $('manifold').className = man.valid ? 'pass' : 'fail';
  $('depth').textContent = man.points.length ? Math.max(...man.points.map(p => p.depthNum)).toFixed(1) : '–';
  $('hash').textContent = hash;
  $('bake').textContent = baked.hash;
  $('agree').textContent = match ? 'node == browser' : 'MISMATCH';
  $('agree').className = match ? 'pass' : 'fail';
}

sceneEl.addEventListener('input', update);
frameEl.addEventListener('input', update);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
update();
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
