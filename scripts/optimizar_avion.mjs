// Aligera el Boeing 787 de insumos/modelos 3d/boeing_787.glb para el mapa 3D (node scripts/optimizar_avion.mjs).
// El original trae ~1900 mallas en pulgadas; se deja una malla por material, en metros, con la nariz hacia +X, el
// eje vertical en +Y, el centro del fuselaje en el origen y las ruedas apoyadas en y = 0. Se quitan las luces del
// modelo (el mapa dibuja las suyas, intermitentes) y las piezas más pequeñas que PIEZA_MIN metros.
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const THREE = await import(pathToFileURL(path.join(raiz, 'node_modules/three/build/three.module.js')).href);
const { GLTFLoader } = await import(pathToFileURL(path.join(raiz, 'node_modules/three/examples/jsm/loaders/GLTFLoader.js')).href);
const { GLTFExporter } = await import(pathToFileURL(path.join(raiz, 'node_modules/three/examples/jsm/exporters/GLTFExporter.js')).href);
const { mergeGeometries, mergeVertices } = await import(pathToFileURL(path.join(raiz, 'node_modules/three/examples/jsm/utils/BufferGeometryUtils.js')).href);
const { MeshoptSimplifier } = await import(pathToFileURL(path.join(raiz, 'node_modules/meshoptimizer/meshopt_simplifier.js')).href);
await MeshoptSimplifier.ready;

globalThis.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(r => { this.result = r; this.onloadend?.(); }); }
};

const ORIGEN = path.join(raiz, 'insumos/modelos 3d/boeing_787.glb');
const DESTINO = process.env.SALIDA ?? path.join(raiz, 'public/data/mapa3d/boeing-787.glb');
const PULGADA = 0.0254;
const PIEZA_MIN = Number(process.env.PIEZA_MIN ?? 3.0);
const RATIO = Number(process.env.RATIO ?? 0.3);          // fracción de triángulos que se conserva tras soldar vértices
const ERROR = Number(process.env.ERROR ?? 0.01);         // error máximo de la simplificación, relativo al tamaño de la malla
const SIN_LUCES = new Set(['beacon', 'StrobeR', 'Strobe_L', 'Landing_light_gear']);

const buf = fs.readFileSync(ORIGEN);
const gltf = await new Promise((ok, mal) => new GLTFLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', ok, mal));
gltf.scene.updateMatrixWorld(true);

const caja = new THREE.Box3().setFromObject(gltf.scene);
const centro = caja.getCenter(new THREE.Vector3());
const alinear = new THREE.Matrix4()
  .makeScale(PULGADA, PULGADA, PULGADA)
  .multiply(new THREE.Matrix4().makeTranslation(-centro.x, -caja.min.y, -centro.z));

const porMaterial = new Map();
let descartadas = 0;
gltf.scene.traverse(o => {
  if (!o.isMesh || SIN_LUCES.has(o.material.name)) return;
  const g = o.geometry.clone();
  g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(alinear, o.matrixWorld));
  g.computeBoundingBox();
  if (g.boundingBox.getSize(new THREE.Vector3()).length() < PIEZA_MIN) { descartadas++; return; }
  for (const nombre of Object.keys(g.attributes)) if (nombre !== 'position' && nombre !== 'normal') g.deleteAttribute(nombre);
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
  if (o.matrixWorld.determinant() < 0) {          // espejo: se invierte el sentido de las caras
    const i = g.index.array;
    for (let k = 0; k < i.length; k += 3) { const t = i[k]; i[k] = i[k + 1]; i[k + 1] = t; }
  }
  if (!porMaterial.has(o.material)) porMaterial.set(o.material, []);
  porMaterial.get(o.material).push(g);
});

/** Suelda los vértices repetidos y quita triángulos que casi no se ven; las normales se conservan por vértice. */
function simplificar(geo) {
  const g = mergeVertices(geo, 1e-3);
  const indices = Uint32Array.from(g.index.array);
  const pos = g.attributes.position.array, nor = g.attributes.normal.array;
  const objetivo = Math.floor(indices.length * RATIO / 3) * 3;
  const [nuevo] = MeshoptSimplifier.simplify(indices, pos, 3, objetivo, ERROR, ['Prune']);
  const [mapa, total] = MeshoptSimplifier.compactMesh(nuevo);
  const p = new Float32Array(total * 3), n = new Float32Array(total * 3);
  for (let i = 0; i < mapa.length; i++) {
    if (mapa[i] === 0xffffffff) continue;
    p.set(pos.subarray(i * 3, i * 3 + 3), mapa[i] * 3);
    n.set(nor.subarray(i * 3, i * 3 + 3), mapa[i] * 3);
  }
  const salida = new THREE.BufferGeometry();
  salida.setAttribute('position', new THREE.BufferAttribute(p, 3));
  salida.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  salida.setIndex(new THREE.BufferAttribute(nuevo.map(i => mapa[i]), 1));
  console.log('  vértices', geo.attributes.position.count, '→', total, '· triángulos', (geo.index?.count ?? geo.attributes.position.count) / 3, '→', nuevo.length / 3);
  return salida;
}

const salida = new THREE.Group();
for (const [original, geos] of porMaterial) {
  const material = new THREE.MeshStandardMaterial({
    name: original.name, color: original.color, metalness: 0, roughness: 0.6,
    transparent: original.transparent, opacity: original.opacity, side: original.side,
  });
  const malla = new THREE.Mesh(simplificar(mergeGeometries(geos, false)), material);
  malla.name = original.name;
  salida.add(malla);
}

const b = new THREE.Box3().setFromObject(salida);
console.log('tamaño (m):', b.getSize(new THREE.Vector3()).toArray().map(v => +v.toFixed(2)), 'mallas:', salida.children.length, 'piezas descartadas:', descartadas);

const glb = await new Promise((ok, mal) => new GLTFExporter().parse(salida, ok, mal, { binary: true }));
fs.writeFileSync(DESTINO, Buffer.from(glb));
console.log('escrito', DESTINO, (fs.statSync(DESTINO).size / 1e6).toFixed(2), 'MB');
