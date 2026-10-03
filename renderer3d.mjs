import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const UNIT = 40;
const FILES = [
  ['ground', 'ground.glb'], ['chick', 'chick.glb'], ['mama', 'mama-hen.glb'], ['fox', 'fox.glb'],
  ['wolf', 'wolf.glb'], ['eagle', 'eagle.glb'], ['snake', 'snake.glb'], ['boss', 'chupacabras.glb'],
  ['egg', 'egg.glb'], ['grass', 'grass.glb'], ['house', 'hen-house.glb'],
  ['turret', 'chicken-turret.glb'], ['tornado', 'tornado.glb'], ['wizard', 'wizard.glb'], ['alien', 'alien.glb'], ['mushroom', 'mushroom-king.glb'],
  ['treeA', 'nature/Tree_1_A_Color1.gltf'], ['treeB', 'nature/Tree_3_B_Color1.gltf'], ['rock', 'nature/Rock_1_A_Color1.gltf']
];
// Yaw corrections so every model faces +Z (the renderer's "forward").
const MODEL_YAW = { eagle: Math.PI, wizard: -Math.PI / 2, mama: Math.PI / 2 };
const ELITE_STYLE = {
  BOSS: { color: '#ff4d5e', glow: '#ff2a3d', symbol: 'skull' },
  MUSHROOM: { color: '#ffa53a', glow: '#ff7b00', symbol: 'crown' },
  ALIENBOSS: { color: '#c46bff', glow: '#9b30ff', symbol: 'star' }
};
const DROP_STYLE = {
  SHIELD: { color: '#4fc3ff', label: 'SHIELD' }, MEDKIT: { color: '#ff5468', label: 'MEDKIT' },
  DOUBLE: { color: '#ffcc33', label: 'DOUBLE SHOT' }, RAPID: { color: '#52ffd8', label: 'RAPID FIRE' },
  TURRET: { color: '#ffd34d', label: 'CHICKEN TURRET' }, LASER: { color: '#ff3df2', label: 'CHICKEN LASER' },
  SEEKER: { color: '#ff8a3d', label: 'CHICKEN SEEKER' }, HULK: { color: '#4cff4c', label: 'CHICKEN HULK' }
};

// Small deterministic random generator so the painted map is identical on every load.
function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = Math.imul(s ^ (s >>> 15), 1 | s), s = (s + Math.imul(s ^ (s >>> 7), 61 | s)) ^ s, ((s ^ (s >>> 14)) >>> 0) / 4294967296)); }

export function createGameRenderer({ canvas, world, trees, decor = [], grassTufts, status, startButton }) {
  const scene = new THREE.Scene();
  const FOG = new THREE.Color('#9cc786');
  scene.background = FOG.clone();
  scene.fog = new THREE.Fog(FOG, 38, 78);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 180);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.62, 0.42, 0.86);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  scene.add(new THREE.HemisphereLight('#fff4dc', '#4f7a45', 1.3));
  const sun = new THREE.DirectionalLight('#fff0cd', 2.5);
  sun.position.set(-15, 26, 17);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -33, right: 33, top: 26, bottom: -26, near: 1, far: 80 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);
  const fill = new THREE.DirectionalLight('#d8e7ff', 0.5);
  fill.position.set(18, 11, -18);
  scene.add(fill);

  const time = { value: 0 };
  const loader = new GLTFLoader();
  const models = {}, modelAnimations = {};
  const playerNodes = new Map(), enemyNodes = new Map(), projectileNodes = new Map(), fireballNodes = new Map(), dropNodes = new Map(), beamNodes = new Map(), bloodNodes = new Map();
  const seenFx = new Set(), activeFx = [];
  let farmBar = null, countdownSprite = null, ready = false, lastFarmValue = -1, lastCountdown = -1;
  let battleFogMesh = null, mama = null, henBubble = null, stage = null, turretNode = null, houseTop = 3.2, lastHenHit = 0;
  const target = new THREE.Vector3(0, 1, 0);
  let shake = 0, cameraDistance = 20.5, lobbyBlend = 1, snapCam = 0, focusCam = null;

  const actorPosition = (x, y, height = 0) => new THREE.Vector3((x - world.home.x) / UNIT, height, (y - world.home.y) / UNIT);

  function statusUpdate(done, failed) {
    if (failed) status.textContent = `Modelos 3D precargados (${done}/${FILES.length}); algunos usarán respaldo.`;
    else if (done >= FILES.length) status.textContent = 'Modelos 3D listos. Ya puedes abrir la partida.';
    else status.textContent = `Precargando modelos 3D en el lobby… ${done}/${FILES.length}`;
  }

  async function loadModels() {
    if (document.fonts?.load) await Promise.race([Promise.all([document.fonts.load('12px Bungee'), document.fonts.load('12px Rye')]), new Promise(resolve => setTimeout(resolve, 1400))]);
    let done = 0, failed = 0;
    statusUpdate(done, false);
    startButton.disabled = true;
    await Promise.all(FILES.map(async ([key, file]) => {
      try {
        const data = await loader.loadAsync(`./assets/models/${file}`);
        models[key] = data.scene;
        modelAnimations[key] = data.animations || [];
      } catch (error) {
        failed++;
        console.warn(`No se pudo cargar el modelo ${file}; se usará un modelo de respaldo.`, error);
      } finally { done++; statusUpdate(done, failed > 0); }
    }));
    try {
      const materials = await new MTLLoader().loadAsync('./assets/models/weapon/materials.mtl');
      materials.preload();
      models.rifle = await new OBJLoader().setMaterials(materials).loadAsync('./assets/models/weapon/model.obj');
    } catch (error) { failed++; console.warn('Capacitor Rifle no cargó; se usará un arma geométrica de respaldo.', error); }
    buildMap();
    ready = true;
    statusUpdate(done, failed > 0);
    startButton.disabled = false;
  }

  // ------------------------------------------------------------------ helpers
  function setupMaterial(root, tint = null) {
    root.traverse(node => {
      if (!node.isMesh) return;
      node.castShadow = true;
      node.receiveShadow = true;
      node.frustumCulled = !node.isSkinnedMesh;
      const apply = material => {
        const copy = material.clone();
        copy.side = THREE.DoubleSide;
        if (tint && copy.color) copy.color.lerp(new THREE.Color(tint), 0.28);
        if (copy.transparent) copy.depthWrite = false;
        return copy;
      };
      node.material = Array.isArray(node.material) ? node.material.map(apply) : apply(node.material);
    });
  }

  function makeModel(template, targetSize, { tint = null, key = null } = {}) {
    if (!template) return null;
    const modelKey = key || Object.keys(models).find(k => models[k] === template);
    const outer = new THREE.Group();
    const yawFix = new THREE.Group();
    yawFix.rotation.y = MODEL_YAW[modelKey] || 0;
    const model = cloneSkeleton(template);
    yawFix.add(model);
    outer.add(yawFix);
    outer.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
    model.scale.multiplyScalar(targetSize / Math.max(size.x, size.y, size.z, 0.00001));
    outer.updateMatrixWorld(true);
    const fitted = new THREE.Box3().setFromObject(yawFix);
    yawFix.position.x -= fitted.getCenter(new THREE.Vector3()).x;
    yawFix.position.y -= fitted.min.y;
    yawFix.position.z -= fitted.getCenter(new THREE.Vector3()).z;
    setupMaterial(outer, tint);
    const clips = modelAnimations[modelKey] || [];
    if (clips.length) {
      const mixer = new THREE.AnimationMixer(model);
      const find = re => clips.find(c => re.test(c.name) && !/\|/.test(c.name) === false) || clips.find(c => re.test(c.name));
      const actions = {};
      for (const [state, re] of [['walk', modelKey === 'wolf' ? /Gallop$/ : /Walk/], ['run', /Run|Gallop$/], ['idle', /Idle$/], ['attack', /Punch|Attack|Bite_Front|Weapon/], ['hit', /HitRe/], ['dance', /Dance|Wave|Yes/]]) {
        const clip = find(re);
        if (clip) actions[state] = mixer.clipAction(clip);
      }
      if (actions.attack) { actions.attack.setLoop(THREE.LoopOnce, 1); actions.attack.clampWhenFinished = false; }
      const first = actions.walk || actions.idle || mixer.clipAction(clips[0]);
      first.play();
      outer.userData.mixer = mixer;
      outer.userData.actions = actions;
      outer.userData.current = first;
    }
    outer.userData.inner = yawFix;
    outer.userData.size = new THREE.Box3().setFromObject(outer).getSize(new THREE.Vector3());
    return outer;
  }

  function playAction(node, state, fade = 0.2) {
    const actions = node.userData.actions;
    if (!actions) return;
    const next = actions[state] || (state === 'run' ? actions.walk : null) || actions.idle;
    if (!next || next === node.userData.current) return;
    next.reset().fadeIn(fade).play();
    node.userData.current?.fadeOut(fade);
    node.userData.current = next;
  }

  // Vertex wind in world space: works for single meshes and instanced meshes.
  function addWind(material, strength, key) {
    material.onBeforeCompile = shader => {
      shader.uniforms.uTime = time;
      shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace('#include <project_vertex>', `
        vec4 wPos = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wPos = instanceMatrix * wPos;
        #endif
        wPos = modelMatrix * wPos;
        float hW = max(0.0, wPos.y);
        float ph = wPos.x * 0.35 + wPos.z * 0.27;
        wPos.x += sin(uTime * 1.7 + ph) * ${strength.toFixed(4)} * hW * hW;
        wPos.z += cos(uTime * 1.3 + ph * 1.3) * ${(strength * 0.6).toFixed(4)} * hW * hW;
        vec4 mvPosition = viewMatrix * wPos;
        gl_Position = projectionMatrix * mvPosition;`);
    };
    material.customProgramCacheKey = () => 'wind' + key;
  }

  function canvasTexture(w, h, draw, repeat = false) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
    return t;
  }
  const glowTexture = canvasTexture(128, 128, (g, w) => {
    const grad = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.35, 'rgba(255,255,255,.55)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, w, w);
  });
  glowTexture.colorSpace = THREE.NoColorSpace;
  const pillarTexture = canvasTexture(8, 256, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(255,255,255,0)'); grad.addColorStop(0.55, 'rgba(255,255,255,.35)'); grad.addColorStop(1, 'rgba(255,255,255,.9)');
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
  });
  pillarTexture.colorSpace = THREE.NoColorSpace;

  const glowMat = color => new THREE.MeshBasicMaterial({ color, map: glowTexture, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const emissiveMat = (color, intensity = 1.6, opts = {}) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: 0.35, metalness: 0.1, ...opts });

  // ---------------------------------------------------------------- particles
  // One GPU particle pool per blending mode keeps every spark, feather and dust puff in a single draw call.
  class Particles {
    constructor(max, additive) {
      this.max = max; this.cursor = 0;
      this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 3); this.alpha = new Float32Array(max); this.size = new Float32Array(max);
      this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.maxLife = new Float32Array(max); this.grav = new Float32Array(max); this.drag = new Float32Array(max); this.baseSize = new Float32Array(max);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
      this.uniforms = { uScale: { value: 600 }, uMap: { value: glowTexture } };
      const mat = new THREE.ShaderMaterial({
        uniforms: this.uniforms, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        vertexShader: 'attribute vec3 aColor; attribute float aAlpha; attribute float aSize; uniform float uScale; varying vec3 vColor; varying float vAlpha; void main(){ vColor=aColor; vAlpha=aAlpha; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=aSize*uScale/max(0.1,-mv.z); gl_Position=projectionMatrix*mv; }',
        fragmentShader: additive
          ? 'uniform sampler2D uMap; varying vec3 vColor; varying float vAlpha; void main(){ float a=texture2D(uMap,gl_PointCoord).r*vAlpha; if(a<0.01) discard; gl_FragColor=vec4(vColor*a*1.6,a); }'
          : 'varying vec3 vColor; varying float vAlpha; void main(){ vec2 p=gl_PointCoord-0.5; float d=length(p); if(d>0.5) discard; gl_FragColor=vec4(vColor,vAlpha*smoothstep(0.5,0.32,d)); }'
      });
      this.points = new THREE.Points(geo, mat);
      this.points.frustumCulled = false;
      this.points.renderOrder = 6;
      scene.add(this.points);
    }
    emit({ pos, count = 10, color = '#fff', colors = null, speed = 2, up = 1.5, spread = 1, life = 0.7, size = 0.18, gravity = -4, drag = 1.5, radius = 0 }) {
      const c = new THREE.Color();
      for (let n = 0; n < count; n++) {
        const i = this.cursor; this.cursor = (this.cursor + 1) % this.max;
        const a = Math.random() * Math.PI * 2, r = radius * Math.sqrt(Math.random());
        this.pos[i * 3] = pos.x + Math.cos(a) * r; this.pos[i * 3 + 1] = pos.y; this.pos[i * 3 + 2] = pos.z + Math.sin(a) * r;
        const s = speed * (0.4 + Math.random() * 0.8);
        this.vel[i * 3] = Math.cos(a) * s * spread; this.vel[i * 3 + 1] = up * (0.5 + Math.random()); this.vel[i * 3 + 2] = Math.sin(a) * s * spread;
        c.set(colors ? colors[Math.floor(Math.random() * colors.length)] : color);
        this.col[i * 3] = c.r; this.col[i * 3 + 1] = c.g; this.col[i * 3 + 2] = c.b;
        this.maxLife[i] = this.life[i] = life * (0.6 + Math.random() * 0.7);
        this.baseSize[i] = size * (0.6 + Math.random() * 0.8); this.grav[i] = gravity; this.drag[i] = drag;
      }
    }
    update(dt) {
      for (let i = 0; i < this.max; i++) {
        if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
        this.life[i] -= dt;
        const k = Math.max(0, 1 - this.drag[i] * dt);
        this.vel[i * 3] *= k; this.vel[i * 3 + 2] *= k; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k + this.grav[i] * dt;
        this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] = Math.max(0.03, this.pos[i * 3 + 1] + this.vel[i * 3 + 1] * dt); this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
        const t = this.life[i] / this.maxLife[i];
        this.alpha[i] = Math.min(1, t * 2.2); this.size[i] = this.baseSize[i] * (0.5 + t * 0.5);
      }
      const g = this.points.geometry.attributes;
      g.position.needsUpdate = g.aColor.needsUpdate = g.aAlpha.needsUpdate = g.aSize.needsUpdate = true;
    }
  }
  const sparks = new Particles(2600, true);
  const dust = new Particles(2200, false);

  // -------------------------------------------------------------------- map
  function paintGround(width, depth, grassImage) {
    const PX = 44, W = Math.round(width * PX), D = Math.round(depth * PX);
    const toPx = (x, y) => [((x - world.home.x) / UNIT + width / 2) * PX, ((y - world.home.y) / UNIT + depth / 2) * PX];
    const R = rng(1337);
    return canvasTexture(W, D, g => {
      // Base: the supplied grass tile, tinted, then large patches of lighter and darker meadow.
      g.fillStyle = '#7fb85a'; g.fillRect(0, 0, W, D);
      try {
        if (grassImage) {
          // Pre-scale the tile into a small canvas, then repeat it (works for HTMLImageElement and ImageBitmap).
          const tile = document.createElement('canvas'), ts = Math.round(PX * 1.25); tile.width = tile.height = ts;
          tile.getContext('2d').drawImage(grassImage, 0, 0, ts, ts);
          const pat = g.createPattern(tile, 'repeat');
          if (pat) { g.fillStyle = pat; g.fillRect(0, 0, W, D); }
        }
      } catch (e) { console.warn('Grass tile could not be painted', e); }
      g.globalCompositeOperation = 'multiply'; g.fillStyle = '#eefad0'; g.fillRect(0, 0, W, D); g.globalCompositeOperation = 'source-over';
      for (let i = 0; i < 90; i++) {
        const x = R() * W, y = R() * D, r = (2 + R() * 6) * PX, grad = g.createRadialGradient(x, y, 0, x, y, r), light = R() < 0.5;
        grad.addColorStop(0, light ? 'rgba(200,232,120,.22)' : 'rgba(40,90,40,.2)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grad; g.fillRect(x - r, y - r, r * 2, r * 2);
      }
      // Mowed stripes around the farmyard.
      g.save(); const [hx, hy] = toPx(world.home.x, world.home.y); g.beginPath(); g.ellipse(hx, hy, 13 * PX, 11 * PX, 0, 0, Math.PI * 2); g.clip();
      for (let i = -30; i < 30; i++) { g.fillStyle = i % 2 ? 'rgba(255,255,220,.06)' : 'rgba(0,40,0,.05)'; g.fillRect(hx + i * 0.9 * PX, hy - 14 * PX, 0.9 * PX, 28 * PX); }
      g.restore();
      // Outside the playable area the pasture gets wilder and darker.
      const [ax, ay] = toPx(0, 0), [bx, by] = toPx(world.w, world.h);
      g.fillStyle = 'rgba(30,70,35,.28)'; g.fillRect(0, 0, W, ay); g.fillRect(0, by, W, D - by); g.fillRect(0, ay, ax, by - ay); g.fillRect(bx, ay, W - bx, by - ay);
      // Shadows/flattened grass under obstacles.
      for (const t of trees) {
        const [x, y] = toPx(t.x, t.y), r = (t.kind === 'tree' ? 1.5 * (t.s || 1) : t.kind === 'rock' ? 0.9 * t.radius / 20 : 0.6) * PX, grad = g.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, t.kind === 'rock' ? 'rgba(120,96,64,.45)' : 'rgba(30,60,25,.38)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grad; g.fillRect(x - r, y - r, r * 2, r * 2);
      }
      // Curvy dirt paths from the four edges into the farmyard, through the fence gaps.
      const paths = [
        [[world.home.x, -60], [world.home.x - 120, 300], [world.home.x + 80, 480], [world.home.x, world.home.y]],
        [[world.home.x, world.h + 60], [world.home.x + 110, 1050], [world.home.x - 70, 880], [world.home.x, world.home.y]],
        [[-60, world.home.y - 20], [300, world.home.y + 110], [520, world.home.y - 90], [world.home.x, world.home.y]],
        [[world.w + 60, world.home.y + 10], [1500, world.home.y - 120], [1280, world.home.y + 80], [world.home.x, world.home.y]]
      ];
      const stroke = (pts, width, color) => { g.strokeStyle = color; g.lineWidth = width; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath(); const p = pts.map(q => toPx(q[0], q[1])); g.moveTo(...p[0]); g.bezierCurveTo(...p[1], ...p[2], ...p[3]); g.stroke(); };
      for (const p of paths) stroke(p, 2.1 * PX, 'rgba(92,70,40,.55)');
      for (const p of paths) stroke(p, 1.75 * PX, '#b8935f');
      for (const p of paths) stroke(p, 1.2 * PX, 'rgba(214,180,124,.55)');
      for (const off of [-0.32, 0.32]) for (const p of paths) stroke(p.map(([x, y]) => [x + off * UNIT * 0.7, y + off * UNIT * 0.4]), 0.12 * PX, 'rgba(120,88,52,.45)');
      // Farmyard: packed dirt with straw scattered.
      const yard = g.createRadialGradient(hx, hy + 0.8 * PX, 0.5 * PX, hx, hy + 0.8 * PX, 4.6 * PX);
      yard.addColorStop(0, '#c9a46a'); yard.addColorStop(0.72, '#b8935f'); yard.addColorStop(1, 'rgba(184,147,95,0)');
      g.fillStyle = yard; g.beginPath(); g.ellipse(hx, hy + 0.8 * PX, 4.8 * PX, 4.2 * PX, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(240,206,110,.8)'; g.lineWidth = 2;
      for (let i = 0; i < 260; i++) { const a = R() * Math.PI * 2, r = R() * 3.8 * PX, x = hx + Math.cos(a) * r, y = hy + 0.8 * PX + Math.sin(a) * r * 0.85, l = 4 + R() * 9, b = R() * Math.PI; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(b) * l, y + Math.sin(b) * l); g.stroke(); }
      // Pebbles, clover and wildflowers.
      for (let i = 0; i < 2600; i++) {
        const x = R() * W, y = R() * D, k = R();
        g.fillStyle = k < 0.25 ? 'rgba(255,255,255,.85)' : k < 0.4 ? 'rgba(255,224,90,.9)' : k < 0.5 ? 'rgba(240,140,190,.85)' : k < 0.58 ? 'rgba(160,130,255,.75)' : 'rgba(40,85,30,.35)';
        g.beginPath(); g.arc(x, y, k < 0.58 ? 1.6 + R() * 1.6 : 2 + R() * 4, 0, Math.PI * 2); g.fill();
      }
    });
  }

  function makeGround() {
    const arenaWidth = world.w / UNIT, arenaDepth = world.h / UNIT;
    const width = arenaWidth + 26, depth = arenaDepth + 22;
    let grassImage = null;
    models.ground?.traverse(node => { if (node.isMesh && !grassImage && node.material?.map?.image) grassImage = node.material.map.image; });
    const map = paintGround(width, depth, grassImage);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), new THREE.MeshStandardMaterial({ map, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.04;
    ground.receiveShadow = true;
    scene.add(ground);
    // Soft fog at the playable border.
    const battleFog = new THREE.Mesh(new THREE.PlaneGeometry(arenaWidth + 2, arenaDepth + 2), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, uniforms: { fogColor: { value: FOG.clone() } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 fogColor; varying vec2 vUv; void main(){ float edge=min(min(vUv.x,1.0-vUv.x),min(vUv.y,1.0-vUv.y)); float alpha=(1.0-smoothstep(0.0,0.07,edge))*0.85; gl_FragColor=vec4(fogColor,alpha); }'
    }));
    battleFog.rotation.x = -Math.PI / 2;
    battleFog.position.y = 0.02;
    battleFog.renderOrder = 2;
    scene.add(battleFog);
    battleFogMesh = battleFog;
  }

  const woodMat = new THREE.MeshStandardMaterial({ color: '#8d5c34', roughness: 0.9 });
  const woodDark = new THREE.MeshStandardMaterial({ color: '#6b4325', roughness: 0.95 });
  const hayTex = canvasTexture(256, 128, (g, w, h) => { g.fillStyle = '#e0b54c'; g.fillRect(0, 0, w, h); for (let i = 0; i < 500; i++) { g.strokeStyle = Math.random() < 0.5 ? 'rgba(160,110,30,.35)' : 'rgba(255,236,150,.5)'; g.lineWidth = 1 + Math.random() * 2; const y = Math.random() * h; g.beginPath(); g.moveTo(Math.random() * w, y); g.lineTo(Math.random() * w, y + (Math.random() - 0.5) * 6); g.stroke(); } g.fillStyle = 'rgba(150,40,30,.85)'; g.fillRect(0, h * 0.28, w, 5); g.fillRect(0, h * 0.68, w, 5); }, true);
  const hayEnd = canvasTexture(128, 128, (g, w) => { g.fillStyle = '#d6a843'; g.fillRect(0, 0, w, w); g.strokeStyle = 'rgba(140,96,24,.6)'; g.lineWidth = 2; g.beginPath(); for (let a = 0; a < 40; a += 0.15) { const r = a * 1.55; g.lineTo(w / 2 + Math.cos(a) * r, w / 2 + Math.sin(a) * r); } g.stroke(); });
  const logEnd = canvasTexture(128, 128, (g, w) => { g.fillStyle = '#d7b07a'; g.fillRect(0, 0, w, w); for (let r = 6; r < 64; r += 7) { g.strokeStyle = 'rgba(130,85,45,.55)'; g.lineWidth = 2; g.beginPath(); g.arc(w / 2, w / 2, r, 0, Math.PI * 2); g.stroke(); } g.strokeStyle = '#6b4325'; g.lineWidth = 8; g.beginPath(); g.arc(w / 2, w / 2, 60, 0, Math.PI * 2); g.stroke(); });
  const barkTex = canvasTexture(128, 128, (g, w) => { g.fillStyle = '#7a4c2a'; g.fillRect(0, 0, w, w); for (let i = 0; i < 40; i++) { g.strokeStyle = 'rgba(40,22,10,.45)'; g.lineWidth = 2 + Math.random() * 3; const x = Math.random() * w; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + (Math.random() - 0.5) * 12, w); g.stroke(); } }, true);

  function buildObstacles() {
    const fences = new Map();
    for (const t of trees) {
      const pos = actorPosition(t.x, t.y);
      if (t.kind === 'fence') { if (!fences.has(t.fenceId)) fences.set(t.fenceId, []); fences.get(t.fenceId).push(t); continue; }
      if (t.kind === 'logpart') continue;
      let obj = null;
      if (t.kind === 'tree') {
        const src = t.variant === 1 ? models.treeB : models.treeA;
        obj = makeModel(src || models.treeA, 2.7 * (t.s || 1));
        obj?.traverse(n => { if (n.isMesh) { addWind(n.material, 0.006, 'tree'); } });
      } else if (t.kind === 'rock') {
        obj = makeModel(models.rock, (t.radius / UNIT) * 2.6);
        if (obj) obj.scale.y = 0.75 + (t.seed % 5) * 0.08;
      } else if (t.kind === 'hay') {
        obj = new THREE.Group();
        const bale = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.9, 20), [new THREE.MeshStandardMaterial({ map: hayTex, roughness: 1 }), new THREE.MeshStandardMaterial({ map: hayEnd, roughness: 1 }), new THREE.MeshStandardMaterial({ map: hayEnd, roughness: 1 })]);
        bale.rotation.z = Math.PI / 2; bale.position.y = 0.5; obj.add(bale);
        obj.rotation.y = -(t.angle || 0);
      } else if (t.kind === 'log') {
        obj = new THREE.Group();
        const log = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.38, 2.3, 14), [new THREE.MeshStandardMaterial({ map: barkTex, roughness: 1 }), new THREE.MeshStandardMaterial({ map: logEnd, roughness: 1 }), new THREE.MeshStandardMaterial({ map: logEnd, roughness: 1 })]);
        log.rotation.z = Math.PI / 2; log.position.y = 0.34; obj.add(log);
        const moss = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), new THREE.MeshStandardMaterial({ color: '#5f9a3a', roughness: 1 })); moss.scale.set(1.6, 0.4, 1); moss.position.set(0.3, 0.66, 0); obj.add(moss);
        obj.rotation.y = -(t.angle || 0);
      }
      if (!obj) continue;
      obj.position.copy(pos);
      if (t.kind !== 'hay' && t.kind !== 'log') obj.rotation.y = (t.seed || 0) * 0.7;
      obj.traverse(n => { if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; } });
      scene.add(obj);
    }
    // Fences: posts + two rails, instanced.
    const postGeo = new THREE.BoxGeometry(0.16, 0.85, 0.16), railGeo = new THREE.BoxGeometry(1, 0.1, 0.07);
    const posts = [], rails = [];
    for (const list of fences.values()) {
      list.sort((a, b) => a.idx - b.idx);
      list.forEach((p, i) => {
        posts.push(actorPosition(p.x, p.y, 0.42));
        const next = list[i + 1];
        if (next) { const a = actorPosition(p.x, p.y), b = actorPosition(next.x, next.y), mid = a.clone().add(b).multiplyScalar(0.5), len = a.distanceTo(b), yaw = -Math.atan2(b.z - a.z, b.x - a.x); for (const h of [0.32, 0.62]) rails.push({ pos: mid.clone().setY(h), len, yaw }); }
      });
    }
    const postMesh = new THREE.InstancedMesh(postGeo, woodDark, Math.max(1, posts.length)), railMesh = new THREE.InstancedMesh(railGeo, woodMat, Math.max(1, rails.length));
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
    posts.forEach((p, i) => { q.setFromAxisAngle(up, i * 0.37); postMesh.setMatrixAt(i, m.compose(p, q, s)); });
    rails.forEach((r, i) => { q.setFromAxisAngle(up, r.yaw); railMesh.setMatrixAt(i, m.compose(r.pos, q, new THREE.Vector3(r.len + 0.08, 1, 1))); });
    for (const mesh of [postMesh, railMesh]) { mesh.castShadow = mesh.receiveShadow = true; mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere(); scene.add(mesh); }
  }

  function buildDecor() {
    const pumpkinMat = new THREE.MeshStandardMaterial({ color: '#f08a24', roughness: 0.7 }), stemMat = new THREE.MeshStandardMaterial({ color: '#4c7a2a' });
    const capMat = new THREE.MeshStandardMaterial({ color: '#e0453a', roughness: 0.6 }), stalkMat = new THREE.MeshStandardMaterial({ color: '#f4ead2' });
    const flowerCols = ['#ffffff', '#ffe066', '#ff8fc8', '#b49cff', '#ff7b5c'];
    for (const d of decor) {
      const g = new THREE.Group(), r = rng(d.seed * 97 + 3);
      if (d.kind === 'pumpkin') {
        const body = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 10), pumpkinMat); body.scale.set(1.15, 0.8, 1.15); body.position.y = 0.24; g.add(body);
        for (let i = 0; i < 6; i++) { const rib = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), pumpkinMat); const a = i / 6 * Math.PI * 2; rib.position.set(Math.cos(a) * 0.22, 0.24, Math.sin(a) * 0.22); rib.scale.set(0.8, 1.35, 0.8); g.add(rib); }
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 0.16, 6), stemMat); stem.position.y = 0.5; stem.rotation.z = 0.3; g.add(stem);
      } else if (d.kind === 'mushroom') {
        for (let i = 0; i < 3; i++) { const sc = 0.6 + r() * 0.6; const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.22, 7), stalkMat); const cap = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), capMat); const x = (r() - 0.5) * 0.5, z = (r() - 0.5) * 0.5; stalk.position.set(x, 0.11 * sc, z); stalk.scale.setScalar(sc); cap.position.set(x, 0.2 * sc, z); cap.scale.setScalar(sc); g.add(stalk, cap); }
      } else {
        for (let i = 0; i < 7; i++) { const f = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 4), new THREE.MeshStandardMaterial({ color: flowerCols[Math.floor(r() * flowerCols.length)], emissive: '#222', roughness: 0.6 })); const st = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.2, 3), stemMat); const x = (r() - 0.5) * 0.7, z = (r() - 0.5) * 0.7; st.position.set(x, 0.1, z); f.position.set(x, 0.21, z); g.add(st, f); }
      }
      g.position.copy(actorPosition(d.x, d.y)); g.rotation.y = r() * 6.28;
      g.traverse(n => { if (n.isMesh) { n.castShadow = d.kind !== 'flowers'; n.receiveShadow = true; } });
      scene.add(g);
    }
  }

  function createGrass(tufts) {
    if (!models.grass || !tufts.length) return;
    const template = makeModel(models.grass, 0.6);
    if (!template) return;
    template.updateMatrixWorld(true);
    const parts = [];
    template.traverse(node => { if (node.isMesh && node.geometry && node.material) parts.push(node); });
    const position = new THREE.Vector3(), scale = new THREE.Vector3(), matrix = new THREE.Matrix4(), yaw = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    for (const part of parts) {
      const material = part.material.clone();
      addWind(material, 0.22, 'grass');
      const instances = new THREE.InstancedMesh(part.geometry, material, tufts.length);
      instances.castShadow = false; instances.receiveShadow = true;
      tufts.forEach((tuft, i) => {
        position.copy(actorPosition(tuft.x, tuft.y, 0.008));
        const s = Math.max(0.68, Math.min(2.1, tuft.s / 15));
        yaw.setFromAxisAngle(up, tuft.r); scale.set(s, s, s);
        matrix.compose(position, yaw, scale).multiply(part.matrixWorld);
        instances.setMatrixAt(i, matrix);
      });
      instances.instanceMatrix.needsUpdate = true;
      instances.computeBoundingSphere();
      scene.add(instances);
    }
  }

  function buildHouseAndHen() {
    const home = actorPosition(world.home.x, world.home.y);
    let house;
    if (models.house) { house = makeModel(models.house, 3.4); house.position.copy(home); house.rotation.y = Math.PI; scene.add(house); }
    else {
      house = new THREE.Group();
      const box = new THREE.Mesh(new THREE.BoxGeometry(3.3, 2.7, 2.7), new THREE.MeshStandardMaterial({ color: '#86593a' })); box.position.y = 1.35; house.add(box);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(2.6, 1.5, 4), new THREE.MeshStandardMaterial({ color: '#b64e3d' })); roof.position.y = 3.25; roof.rotation.y = Math.PI / 4; house.add(roof);
      house.position.copy(home); scene.add(house);
    }
    house.updateMatrixWorld(true);
    const hb = new THREE.Box3().setFromObject(house);
    houseTop = hb.max.y;
    // Straw nest and eggs in front of the house, Mama Hen on top of it.
    const nestPos = actorPosition(world.home.x, world.home.y + 116);
    const nest = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.32, 10, 28), new THREE.MeshStandardMaterial({ map: hayTex, roughness: 1 }));
    nest.rotation.x = -Math.PI / 2; nest.position.copy(nestPos).setY(0.16); nest.scale.z = 0.6; nest.receiveShadow = nest.castShadow = true; scene.add(nest);
    if (models.egg) for (const [dx, dy, size] of [[-58, 120, .36], [-40, 142, .4], [52, 136, .36]]) { const egg = makeModel(models.egg, size); egg.position.copy(actorPosition(world.home.x + dx, world.home.y + dy)); egg.rotation.z = (dx % 3) * 0.1; scene.add(egg); }
    if (models.mama) {
      mama = new THREE.Group();
      const model = makeModel(models.mama, 2.9);
      mama.add(model);
      mama.userData.model = model;
      mama.position.copy(nestPos).setY(0.12);
      scene.add(mama);
    }
    farmBar = makeBillboard(4.4, 1.1); farmBar.sprite.position.set(0, houseTop + 1.25, 0); scene.add(farmBar.sprite);
    henBubble = makeBillboard(2.7, 1.35, 512, 256); henBubble.sprite.visible = false; henBubble.sprite.center.set(0.15, 0); scene.add(henBubble.sprite);
    drawBubble();
    // Turret mount on the roof (hidden until the Chicken Turret power-up is picked up).
    turretNode = new THREE.Group();
    turretNode.position.set(0, houseTop - 0.05, 0);
    const deck = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.7, 0.22, 16), woodMat); deck.position.y = 0.11; turretNode.add(deck);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.66, 0.05, 8, 32), emissiveMat('#ffd34d', 1.2)); ring.rotation.x = Math.PI / 2; ring.position.y = 0.23; turretNode.add(ring);
    const head = new THREE.Group(); head.position.y = 0.22; turretNode.add(head);
    const chicken = makeModel(models.turret, 1.15) || makeFallbackActor('PLAYER');
    head.add(chicken);
    const barrelMat = new THREE.MeshStandardMaterial({ color: '#3b4650', metalness: 0.75, roughness: 0.3 });
    for (const x of [-0.17, 0.17]) { const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.75, 10), barrelMat); barrel.rotation.x = Math.PI / 2; barrel.position.set(x, 0.42, 0.62); head.add(barrel); const tip = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.025, 6, 12), emissiveMat('#ffb340', 0.6)); tip.position.set(x, 0.42, 1.0); head.add(tip); }
    const flash = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.7), glowMat('#ffd27a')); flash.position.set(0, 0.42, 1.12); flash.visible = false; head.add(flash);
    turretNode.userData = { head, chicken, flash, ring, shown: false };
    turretNode.visible = false;
    turretNode.traverse(n => { if (n.isMesh) n.castShadow = true; });
    scene.add(turretNode);
  }

  function buildStage() {
    // Lobby stage where every joined chick is shown in 3D before the match.
    stage = new THREE.Group();
    stage.position.copy(actorPosition(world.home.x, world.h + 250));
    const plankTex = canvasTexture(512, 512, (g, w) => { g.fillStyle = '#9b6a3e'; g.fillRect(0, 0, w, w); for (let i = 0; i < 16; i++) { g.fillStyle = i % 2 ? '#a7744a' : '#8f6038'; g.fillRect(0, i * 32, w, 30); g.fillStyle = 'rgba(60,35,15,.5)'; g.fillRect(0, i * 32 + 30, w, 2); for (let k = 0; k < 3; k++) { g.beginPath(); g.arc(Math.random() * w, i * 32 + 15, 2, 0, 7); g.fill(); } } });
    const deck = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 5.4, 0.32, 48), [new THREE.MeshStandardMaterial({ color: '#7a4f2c' }), new THREE.MeshStandardMaterial({ map: plankTex, roughness: 0.9 }), woodDark]);
    deck.position.y = 0.16; deck.receiveShadow = true; stage.add(deck);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(5.25, 0.07, 8, 64), emissiveMat('#ffd45d', 1.3)); rim.rotation.x = Math.PI / 2; rim.position.y = 0.33; stage.add(rim);
    // Bunting line behind the stage.
    const flagCols = ['#ff5e5e', '#ffd45d', '#5ec8ff', '#7be37b', '#c08bff'];
    for (let i = 0; i < 22; i++) { const a = Math.PI + 0.25 + i / 21 * (Math.PI - 0.5); const f = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.42, 3), new THREE.MeshStandardMaterial({ color: flagCols[i % flagCols.length], side: THREE.DoubleSide })); f.position.set(Math.cos(a) * 5.4, 2.4 + Math.sin(i / 21 * Math.PI) * -0.5, Math.sin(a) * 5.4 * 0.6); f.rotation.x = Math.PI; stage.add(f); }
    for (const x of [-5.6, 5.6]) { const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 2.8, 8), woodDark); pole.position.set(x, 1.4, 0); stage.add(pole); }
    // Spotlight cones.
    const coneMat = new THREE.MeshBasicMaterial({ color: '#fff2b0', map: pillarTexture, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    for (const x of [-3, 0, 3]) { const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 1.7, 6, 24, 1, true), coneMat); cone.position.set(x, 3.1, -0.2); stage.add(cone); }
    stage.traverse(n => { if (n.isMesh) n.castShadow = false; });
    scene.add(stage);
  }

  function buildMap() {
    makeGround();
    buildObstacles();
    buildDecor();
    createGrass(grassTufts);
    buildHouseAndHen();
    buildStage();
    countdownSprite = makeBillboard(4.2, 1.05); countdownSprite.sprite.visible = false;
  }

  // ------------------------------------------------------------------ sprites
  function makeBillboard(width, height, cw = 1024, ch = 256) {
    const c = document.createElement('canvas'); c.width = cw; c.height = ch;
    const context = c.getContext('2d'); context.scale(cw / 512, ch / 128);
    const texture = new THREE.CanvasTexture(c); texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
    sprite.scale.set(width, height, 1); sprite.renderOrder = 10;
    return { canvas: c, context, texture, sprite };
  }
  function rounded(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + width, y, x + width, y + height, r); ctx.arcTo(x + width, y + height, x, y + height, r); ctx.arcTo(x, y + height, x, y, r); ctx.arcTo(x, y, x + width, y, r); ctx.closePath();
  }
  function drawSymbol(g, kind, x, y, r, color) {
    g.save(); g.translate(x, y); g.fillStyle = color; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#1a0f12'; g.strokeStyle = '#1a0f12'; g.lineWidth = 3;
    if (kind === 'crown') { g.beginPath(); g.moveTo(-r * .6, r * .35); g.lineTo(-r * .6, -r * .3); g.lineTo(-r * .3, 0); g.lineTo(0, -r * .5); g.lineTo(r * .3, 0); g.lineTo(r * .6, -r * .3); g.lineTo(r * .6, r * .35); g.closePath(); g.fill(); }
    else if (kind === 'skull') { g.beginPath(); g.arc(0, -r * .1, r * .5, 0, Math.PI * 2); g.fill(); g.fillRect(-r * .3, r * .2, r * .6, r * .35); g.fillStyle = color; g.beginPath(); g.arc(-r * .2, -r * .12, r * .14, 0, 7); g.arc(r * .2, -r * .12, r * .14, 0, 7); g.fill(); }
    else { g.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * .28 : r * .65; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } g.closePath(); g.fill(); }
    g.restore();
  }
  // Player nameplate (also used for elites so both have exactly the same size).
  function drawPlate(node, { text, health, color, elite = null }) {
    const key = text + '|' + Math.round(health) + '|' + color;
    if (node.lastKey === key) return;
    node.lastKey = key;
    const { canvas: c, context: g, texture } = node;
    g.clearRect(0, 0, 512, 128);
    g.fillStyle = elite ? '#2a0e14f2' : '#10251fee';
    g.strokeStyle = color; g.lineWidth = 8;
    rounded(g, 7, 7, 498, 114, 24); g.fill(); g.stroke();
    if (elite) { drawSymbol(g, elite.symbol, 42, 46, 27, color); g.fillStyle = color; g.font = '900 15px Bungee, "Arial Black", sans-serif'; g.textAlign = 'left'; g.fillText('★ ELITE', 76, 26); }
    else { g.fillStyle = color; g.beginPath(); g.arc(38, 44, 16, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = '#fff8de'; g.textAlign = 'left'; g.textBaseline = 'middle';
    let fontSize = elite ? 38 : 48; const maxW = elite ? 410 : 414, x0 = elite ? 76 : 66, y0 = elite ? 52 : 45;
    g.font = `900 ${fontSize}px Bungee, "Arial Black", sans-serif`;
    while (fontSize > 26 && g.measureText(text.slice(0, 24)).width > maxW) { fontSize -= 2; g.font = `900 ${fontSize}px Bungee, "Arial Black", sans-serif`; }
    g.fillText(text.slice(0, 24), x0, y0);
    g.fillStyle = '#536252'; rounded(g, 25, 80, 462, 22, 9); g.fill();
    g.fillStyle = elite ? color : health > 55 ? '#72d77f' : health > 25 ? '#f2c64c' : '#fa6262'; rounded(g, 25, 80, 462 * Math.max(0, Math.min(100, health)) / 100, 22, 9); g.fill();
    texture.needsUpdate = true;
  }
  function drawBubble() {
    const { context: g, texture } = henBubble;
    g.clearRect(0, 0, 512, 128);
    g.fillStyle = '#fffdf2'; g.strokeStyle = '#d6283b'; g.lineWidth = 6;
    rounded(g, 40, 6, 450, 92, 40); g.fill(); g.stroke();
    g.beginPath(); g.moveTo(80, 92); g.lineTo(56, 124); g.lineTo(122, 94); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#fffdf2'; g.fillRect(84, 88, 34, 9);
    g.fillStyle = '#d6283b'; g.font = '900 54px Bungee, "Arial Black", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('CLUCK!!', 265, 46);
    g.fillStyle = '#5a3b2a'; g.font = '700 17px Bungee, sans-serif'; g.fillText('HELP ME, CHICKS!', 265, 82);
    texture.needsUpdate = true;
  }

  // ------------------------------------------------------------------ actors
  function makeFallbackActor(type) {
    const group = new THREE.Group();
    const material = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...opts });
    if (type === 'MOLE') {
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12), material('#6e4a33')); body.scale.set(1, 0.9, 1.1); body.position.y = 0.38; group.add(body);
      const belly = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 10), material('#c9a07a')); belly.position.set(0, 0.33, 0.2); belly.scale.set(1, 0.9, 0.7); group.add(belly);
      const nose = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), material('#ff8fa6')); nose.position.set(0, 0.5, 0.46); group.add(nose);
      for (const x of [-0.14, 0.14]) { const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), material('#111')); eye.position.set(x, 0.6, 0.36); group.add(eye); const claw = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 0.16), material('#f2dcc4')); claw.position.set(x * 2.6, 0.18, 0.32); group.add(claw); }
      const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), material('#f2c230', { metalness: 0.2 })); helmet.position.y = 0.68; group.add(helmet);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), emissiveMat('#fff6a0', 2)); lamp.position.set(0, 0.86, 0.22); group.add(lamp);
    } else if (type === 'GHOST') {
      const pts = []; for (let i = 0; i <= 12; i++) { const t = i / 12; pts.push(new THREE.Vector2(Math.sin(t * Math.PI * 0.55) * 0.45 + (t > 0.85 ? 0.04 : 0), 1.0 - t * 0.95)); }
      const sheet = new THREE.Mesh(new THREE.LatheGeometry(pts, 24), material('#e8f0ff', { transparent: true, opacity: 0.78, emissive: '#7f9cff', emissiveIntensity: 0.35 })); sheet.position.y = 0.2; group.add(sheet);
      for (const x of [-0.14, 0.14]) { const eye = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), material('#151a33')); eye.position.set(x, 0.95, 0.37); eye.scale.y = 1.4; group.add(eye); }
      const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), material('#151a33')); mouth.position.set(0, 0.76, 0.41); mouth.scale.set(1.2, 0.7, 0.5); group.add(mouth);
      group.userData.ghost = true;
    } else if (type === 'PLANT') {
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.14, 0.9, 8), material('#3d8535')); stem.position.y = 0.45; group.add(stem);
      for (let i = 0; i < 4; i++) { const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), material('#4fa33a')); const a = i * Math.PI / 2 + 0.4; leaf.scale.set(1.3, 0.2, 0.55); leaf.position.set(Math.cos(a) * 0.3, 0.12, Math.sin(a) * 0.3); leaf.rotation.y = -a; group.add(leaf); }
      const head = new THREE.Group(); head.position.y = 1.0; group.add(head);
      const top = new THREE.Mesh(new THREE.SphereGeometry(0.36, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), material('#d33a4a')); top.position.y = 0.02; head.add(top);
      const bottom = new THREE.Mesh(new THREE.SphereGeometry(0.36, 14, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), material('#d33a4a')); head.add(bottom);
      const inside = new THREE.Mesh(new THREE.CircleGeometry(0.33, 16), material('#5a0f1a')); inside.rotation.x = -Math.PI / 2; inside.position.y = 0.01; head.add(inside);
      for (let i = 0; i < 9; i++) { const dot = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 4), material('#fff2d0')); const a = i / 9 * Math.PI * 2; dot.position.set(Math.cos(a) * 0.3, 0.16, Math.sin(a) * 0.3); top.add(dot); }
      group.userData.jaws = { top, bottom, head };
    } else {
      const bodyColors = { PLAYER: '#f4c542', FOX: '#d57936', WOLF: '#68665e', EAGLE: '#a76c41', SNAKE: '#58a84d', BOSS: '#6f303e', TORNADO: '#b3d4db', ALIEN: '#77bb68', ALIENBOSS: '#8a5bd6', MAGE: '#7552b2', MUSHROOM: '#b06c3a' };
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.45, 14, 10), material(bodyColors[type] || '#cc8050')); body.position.y = 0.43; group.add(body);
      for (const x of [-0.14, 0.14]) { const eye = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), material('#14231c')); eye.position.set(x, 0.52, 0.38); group.add(eye); }
    }
    group.traverse(n => { if (n.isMesh) n.castShadow = true; });
    return group;
  }

  const swirlTex = canvasTexture(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) { const x = Math.random() * w, y = Math.random() * h, l = 40 + Math.random() * 120; g.strokeStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '190,205,215'},${0.25 + Math.random() * 0.5})`; g.lineWidth = 3 + Math.random() * 9; g.lineCap = 'round'; g.beginPath(); g.moveTo(x, y); g.lineTo(x + l, y - l * 0.35); g.stroke(); g.beginPath(); g.moveTo(x - w, y); g.lineTo(x - w + l, y - l * 0.35); g.stroke(); }
  }, true);
  function makeTornado() {
    // New tornado: supplied GLB funnel as the core + two animated swirl shells, orbiting debris and a dust skirt.
    const group = new THREE.Group();
    const core = models.tornado ? makeModel(models.tornado, 2.2) : null;
    if (core) { core.traverse(n => { if (n.isMesh) { const m = n.material; m.transparent = true; m.opacity = 0.92; m.color = new THREE.Color('#e6eef2'); m.emissive = new THREE.Color('#58707c'); m.emissiveIntensity = 0.3; } }); core.scale.set(0.75, 1.05, 0.75); group.add(core); }
    const profile = []; for (let i = 0; i <= 16; i++) { const t = i / 16; profile.push(new THREE.Vector2(0.14 + 0.85 * Math.pow(t, 1.5), t * 2.6)); }
    const shells = [];
    for (let i = 0; i < 2; i++) {
      const tex = swirlTex.clone(); tex.needsUpdate = true; tex.repeat.set(i ? 3 : 2, 1);
      const shell = new THREE.Mesh(new THREE.LatheGeometry(profile, 32), new THREE.MeshStandardMaterial({ map: tex, alphaMap: null, color: i ? '#dfe9ee' : '#ffffff', transparent: true, opacity: i ? 0.55 : 0.8, depthWrite: false, side: THREE.DoubleSide, roughness: 1, emissive: '#6d8792', emissiveIntensity: 0.35 }));
      shell.scale.setScalar(i ? 1.22 : 1.0); shell.renderOrder = 4 + i; group.add(shell); shells.push(shell);
    }
    const cap = new THREE.Mesh(new THREE.CircleGeometry(1.05, 32), new THREE.MeshBasicMaterial({ color: '#dfe9ee', map: glowTexture, transparent: true, opacity: 0.9, depthWrite: false })); cap.rotation.x = -Math.PI / 2; cap.position.y = 2.6; group.add(cap);
    const debris = new THREE.Group();
    const debrisMat = [new THREE.MeshStandardMaterial({ color: '#7a5634' }), new THREE.MeshStandardMaterial({ color: '#5f9a3a', side: THREE.DoubleSide }), new THREE.MeshStandardMaterial({ color: '#d9b45a' })];
    for (let i = 0; i < 16; i++) { const d = new THREE.Mesh(i % 3 === 1 ? new THREE.PlaneGeometry(0.18, 0.12) : new THREE.BoxGeometry(0.12, 0.09, 0.14), debrisMat[i % 3]); d.userData = { a: i / 16 * Math.PI * 2, r: 0.5 + (i % 4) * 0.16, h: 0.2 + (i * 0.37 % 2.2), s: 3 + (i % 5) }; debris.add(d); }
    group.add(debris);
    const dustRing = new THREE.Mesh(new THREE.RingGeometry(0.3, 1.25, 32), new THREE.MeshBasicMaterial({ color: '#d8c39a', map: glowTexture, transparent: true, opacity: 0.6, depthWrite: false })); dustRing.rotation.x = -Math.PI / 2; dustRing.position.y = 0.04; group.add(dustRing);
    group.userData.tornado = { layers: core ? [core] : [], shells, debris, dustRing };
    return group;
  }

  function actorFor(type, size) {
    if (type === 'TORNADO') return makeTornado();
    const key = ({ FOX: 'fox', WOLF: 'wolf', EAGLE: 'eagle', SNAKE: 'snake', BOSS: 'boss', MAGE: 'wizard', ALIEN: 'alien', ALIENBOSS: 'alien', MUSHROOM: 'mushroom' })[type];
    return makeModel(key ? models[key] : null, size, { tint: type === 'ALIENBOSS' ? '#b06bff' : null }) || makeFallbackActor(type);
  }

  // Wing-flap vertex animation for the (static) eagle mesh: vertices far from the body along X move up/down.
  function addFlap(root) {
    root.traverse(n => {
      if (!n.isMesh) return;
      const mat = n.material; const phase = { value: Math.random() * 6.28 };
      mat.onBeforeCompile = shader => {
        shader.uniforms.uTime = time; shader.uniforms.uPhase = phase;
        shader.vertexShader = 'uniform float uTime; uniform float uPhase;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n float wingK = pow(clamp(abs(transformed.x) / 130.0, 0.0, 1.0), 1.4);\n transformed.y += sin(uTime * 11.0 + uPhase) * wingK * 42.0;');
      };
      mat.customProgramCacheKey = () => 'flap';
    });
  }

  // Chick body recolouring: only the white body texels of the palette texture are tinted.
  function addChickTint(root, color) {
    const uniforms = { uTint: { value: new THREE.Color(color) }, uFlash: { value: 0 } };
    root.traverse(n => {
      if (!n.isMesh) return;
      const mat = n.material;
      mat.onBeforeCompile = shader => {
        Object.assign(shader.uniforms, uniforms);
        shader.fragmentShader = 'uniform vec3 uTint; uniform float uFlash;\n' + shader.fragmentShader.replace('#include <map_fragment>', `
          #ifdef USE_MAP
            vec4 sampledDiffuseColor = texture2D(map, vMapUv);
            float mxC = max(sampledDiffuseColor.r, max(sampledDiffuseColor.g, sampledDiffuseColor.b));
            float mnC = min(sampledDiffuseColor.r, min(sampledDiffuseColor.g, sampledDiffuseColor.b));
            float bodyMask = smoothstep(0.72, 0.9, mnC) * (1.0 - smoothstep(0.06, 0.16, mxC - mnC));
            vec3 tinted = mix(sampledDiffuseColor.rgb, uTint * (0.72 + 0.28 * mnC), bodyMask);
            tinted = mix(tinted, vec3(1.0, 0.12, 0.15), uFlash);
            diffuseColor *= vec4(tinted, sampledDiffuseColor.a);
          #endif`);
      };
      mat.customProgramCacheKey = () => 'chickTint';
    });
    return uniforms;
  }

  function makeWeapon() {
    const holder = new THREE.Group();
    if (!models.rifle) {
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.7), new THREE.MeshStandardMaterial({ color: '#448bad', metalness: 0.5, roughness: 0.4 }));
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.42, 8), new THREE.MeshStandardMaterial({ color: '#35414a', metalness: 0.7, roughness: 0.35 }));
      barrel.rotation.x = Math.PI / 2; barrel.position.z = 0.46; body.add(barrel); holder.add(body); holder.userData.length = 0.9; return holder;
    }
    const weapon = models.rifle.clone(true);
    const bounds = new THREE.Box3().setFromObject(weapon), size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
    const scale = 0.82 / Math.max(size.x, size.y, size.z, 0.001);
    weapon.scale.setScalar(scale);
    weapon.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
    // Rotate so the longest axis runs along +Z (forward).
    const spin = new THREE.Group(); spin.add(weapon);
    if (size.x >= size.y && size.x >= size.z) spin.rotation.y = -Math.PI / 2; else if (size.y > size.z) spin.rotation.x = Math.PI / 2;
    setupMaterial(spin);
    holder.add(spin); holder.userData.length = 0.82;
    return holder;
  }
  function makeLaserGun() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 0.62, 12), new THREE.MeshStandardMaterial({ color: '#2a2440', metalness: 0.8, roughness: 0.25 })); body.rotation.x = Math.PI / 2; g.add(body);
    for (const z of [-0.12, 0.06, 0.24]) { const coil = new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.03, 8, 20), emissiveMat('#ff3df2', 2.2)); coil.position.z = z; g.add(coil); }
    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.12), emissiveMat('#7ff6ff', 2.5)); crystal.position.z = 0.4; crystal.scale.z = 1.6; g.add(crystal);
    g.userData.crystal = crystal;
    return g;
  }

  function makeMissile(scale = 1) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.42, 10), new THREE.MeshStandardMaterial({ color: '#e9e4d8', metalness: 0.4, roughness: 0.4 })); g.add(body);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.16, 10), new THREE.MeshStandardMaterial({ color: '#e0453a', roughness: 0.4 })); nose.position.y = 0.29; g.add(nose);
    for (let i = 0; i < 4; i++) { const fin = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.14, 0.12), new THREE.MeshStandardMaterial({ color: '#e0453a' })); fin.position.y = -0.16; fin.rotation.y = i * Math.PI / 2; fin.translateZ(0.07); g.add(fin); }
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.3, 8), new THREE.MeshBasicMaterial({ color: '#ffb340', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })); flame.position.y = -0.36; flame.rotation.x = Math.PI; g.add(flame);
    g.userData.flame = flame; g.scale.setScalar(scale);
    return g;
  }
  function makeLauncher() {
    const g = new THREE.Group();
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.8, 14, 1, true), new THREE.MeshStandardMaterial({ color: '#4b5a3a', metalness: 0.5, roughness: 0.5, side: THREE.DoubleSide })); tube.rotation.x = Math.PI / 2; g.add(tube);
    for (const z of [-0.36, 0.36]) { const rim = new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.03, 8, 18), new THREE.MeshStandardMaterial({ color: '#2b2b2b', metalness: 0.7 })); rim.position.z = z; g.add(rim); }
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.18), emissiveMat('#ff8a3d', 1.6)); sight.position.set(0, 0.17, 0.05); g.add(sight);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.2, 0.09), new THREE.MeshStandardMaterial({ color: '#2b2b2b' })); grip.position.set(0, -0.17, -0.05); g.add(grip);
    const tip = makeMissile(0.8); tip.rotation.x = Math.PI / 2; tip.position.z = 0.38; g.add(tip);
    return g;
  }
  function makeFist(color = '#3f8f2a') {
    const g = new THREE.Group(), mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.3, 0.32), mat); g.add(palm);
    for (let i = 0; i < 3; i++) { const k = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), mat); k.position.set(-0.11 + i * 0.11, 0.08, 0.19); g.add(k); }
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.34), new THREE.MeshStandardMaterial({ color: '#2f6b1f' })); arm.position.z = -0.3; g.add(arm);
    return g;
  }

  function makePlayer(player) {
    const color = player.color || '#f4c542';
    const root = new THREE.Group();
    const body = new THREE.Group(); root.add(body);
    const model = makeModel(models.chick, 1.3) || makeFallbackActor('PLAYER');
    model.traverse(part => { if (part.isMesh) { part.castShadow = true; part.receiveShadow = false; } });
    const tint = models.chick ? addChickTint(model, color) : null;
    body.add(model);
    // Ground indicator.
    const aura = new THREE.Mesh(new THREE.CircleGeometry(0.66, 32), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, depthWrite: false })); aura.rotation.x = -Math.PI / 2; aura.position.y = 0.03; root.add(aura);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.04, 8, 40), new THREE.MeshBasicMaterial({ color, toneMapped: false })); ring.rotation.x = Math.PI / 2; ring.position.y = 0.045; root.add(ring);
    const pointer = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.3, 3), new THREE.MeshBasicMaterial({ color, toneMapped: false })); pointer.rotation.x = Math.PI / 2; pointer.position.set(0, 0.05, 0.82); body.add(pointer);
    // Weapon held at the side of the chick (outside the body so it no longer clips through it).
    const weaponPivot = new THREE.Group(); weaponPivot.position.set(0.56, 0.5, 0.22);
    const rifle = makeWeapon(); rifle.position.z = 0.2; weaponPivot.add(rifle);
    const laserGun = makeLaserGun(); laserGun.position.z = 0.16; laserGun.visible = false; weaponPivot.add(laserGun);
    const launcher = makeLauncher(); launcher.position.set(0, 0.06, 0.12); launcher.visible = false; weaponPivot.add(launcher);
    const fists = new THREE.Group(); fists.visible = false; for (const side of [-1, 1]) { const f = makeFist(); f.position.set(side * 0.62, 0.55, 0.32); f.userData.side = side; fists.add(f); }
    const wing = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.3, 0.34), new THREE.MeshStandardMaterial({ color })); wing.position.set(-0.1, -0.04, -0.05); wing.rotation.z = -0.35; weaponPivot.add(wing);
    const muzzle = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.55), glowMat('#ffe9a0')); muzzle.position.set(0, 0, 0.72); muzzle.visible = false; weaponPivot.add(muzzle);
    body.add(weaponPivot);
    body.add(fists);
    const hulkGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: '#5dff3d', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, toneMapped: false })); hulkGlow.renderOrder = 5; hulkGlow.scale.set(3.4, 3.4, 1); hulkGlow.position.y = 0.7; hulkGlow.visible = false; root.add(hulkGlow);
    const shell = models.chick ? makeModel(models.chick, 1.3) : null;
    if (shell) { shell.traverse(n => { if (n.isMesh) { n.material = new THREE.MeshBasicMaterial({ color: '#7dff4d', side: THREE.BackSide, transparent: true, opacity: 0.75, toneMapped: false }); n.castShadow = false; } }); shell.scale.setScalar(1.09); shell.position.y = -0.05; shell.visible = false; model.add(shell); }
    const label = makeBillboard(3.05, 0.78); label.sprite.position.set(0, 1.85, 0); root.add(label.sprite);
    const shield = new THREE.Mesh(new THREE.IcosahedronGeometry(0.92, 2), new THREE.MeshStandardMaterial({ color: '#76e8ff', emissive: '#3ad2ff', emissiveIntensity: 0.9, wireframe: true, transparent: true, opacity: 0.5 })); shield.position.y = 0.67; shield.visible = false; root.add(shield);
    const angel = new THREE.Group(); angel.visible = false;
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.04, 8, 28), emissiveMat('#ffe88a', 2)); halo.position.set(0, 1.62, 0.04); halo.rotation.x = Math.PI / 2; angel.add(halo);
    for (const side of [-1, 1]) { const w = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 8), new THREE.MeshStandardMaterial({ color: '#fff9e9', emissive: '#e9dfc5', emissiveIntensity: 0.3, roughness: 0.65 })); w.scale.set(1.25, 0.17, 0.72); w.position.set(side * 0.55, 0.98, -0.12); w.rotation.z = side * -0.3; angel.add(w); }
    body.add(angel);
    // Laser beams (two for double shot).
    const beams = [0, 1].map(() => { const g = new THREE.Group(); const core = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 8, 1, true), new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false })); const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 1, 10, 1, true), new THREE.MeshBasicMaterial({ color: '#ff3df2', transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })); core.rotation.x = glow.rotation.x = Math.PI / 2; g.add(core, glow); g.visible = false; scene.add(g); return g; });
    // Revive ring on the ground: separate object so it stays on the ground while the angel floats up.
    const revive = makeReviveRing(color);
    scene.add(root);
    Object.assign(root.userData, { hulkGlow, shell, launcher, fists, baseTint: new THREE.Color(color), body, model, tint, aura, ring, pointer, weapon: weaponPivot, rifle, laserGun, muzzle, label, shield, angel, beams, revive, walk: 0, prev: null, lastShotSeen: 0 });
    return root;
  }
  function makeReviveRing(color) {
    const c = makeBillboard(1, 1, 256, 256);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.9, 2.9), new THREE.MeshBasicMaterial({ map: c.texture, transparent: true, depthWrite: false, toneMapped: false }));
    mesh.rotation.x = -Math.PI / 2; mesh.position.y = 0.06; mesh.visible = false; mesh.renderOrder = 3; scene.add(mesh);
    return { mesh, canvas: c, color, last: -1 };
  }
  function drawRevive(r, progress, helpers, now) {
    const key = Math.round(progress * 40) + ':' + helpers + ':' + Math.floor(now / 250) % 2;
    if (r.last === key) return; r.last = key;
    const g = r.canvas.context; g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, 256, 256);
    g.lineWidth = 14; g.strokeStyle = 'rgba(255,240,170,.35)'; g.setLineDash(helpers ? [] : [14, 10]); g.beginPath(); g.arc(128, 128, 104, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
    if (progress > 0) { g.strokeStyle = '#ffe36b'; g.lineWidth = 20; g.lineCap = 'round'; g.beginPath(); g.arc(128, 128, 104, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, progress / 5)); g.stroke(); }
    g.fillStyle = 'rgba(255,240,170,.18)'; g.beginPath(); g.arc(128, 128, 90, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff6cf'; g.font = '900 30px Bungee, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(progress > 0 ? Math.max(0, 5 - progress).toFixed(1) + 's' : (Math.floor(now / 500) % 2 ? 'REVIVE' : 'STAND HERE'), 128, 128);
    r.canvas.texture.needsUpdate = true;
  }

  const ENEMY_SIZE = { BOSS: 2.25, MUSHROOM: 2.6, ALIENBOSS: 2.7, EAGLE: 1.7, SNAKE: 0.66, WOLF: 2.2, FOX: 1.35, MOLE: 0.95, TORNADO: 1.6, ALIEN: 1.65, MAGE: 1.25, GHOST: 1.05, PLANT: 1.25 };
  function makeEnemy(enemy) {
    const size = ENEMY_SIZE[enemy.type] || 0.95;
    const root = new THREE.Group();
    const body = actorFor(enemy.type, size);
    root.add(body);
    if (enemy.type === 'EAGLE' && models.eagle) addFlap(body);
    body.traverse(part => { if (part.isMesh) { part.castShadow = enemy.type !== 'GHOST'; part.receiveShadow = false; } });
    const height = body.userData.size?.y || size;
    let health;
    if (enemy.elite) {
      const style = ELITE_STYLE[enemy.type] || ELITE_STYLE.BOSS;
      health = makeBillboard(3.05, 0.78); health.sprite.position.y = height + 0.75;
      const aura = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.3, 48), new THREE.MeshBasicMaterial({ color: style.color, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
      const spikes = new THREE.Group(); for (let i = 0; i < 8; i++) { const sp = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.32, 4), new THREE.MeshBasicMaterial({ color: style.color, toneMapped: false })); const a = i / 8 * Math.PI * 2; sp.position.set(Math.cos(a) * 1.42, 0.06, Math.sin(a) * 1.42); sp.rotation.set(Math.PI / 2, 0, -a + Math.PI / 2); spikes.add(sp); } root.add(spikes); root.userData.spikes = spikes;
      aura.rotation.x = -Math.PI / 2; aura.position.y = 0.05; root.add(aura);
      const glow = new THREE.Mesh(new THREE.CircleGeometry(1.5, 32), new THREE.MeshBasicMaterial({ color: style.glow, map: glowTexture, transparent: true, opacity: 0.45, depthWrite: false })); glow.rotation.x = -Math.PI / 2; glow.position.y = 0.04; root.add(glow);
      root.userData.eliteAura = aura; root.userData.style = style;
      if (enemy.type === 'ALIENBOSS') { const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 1.4, 1.6, 24, 1, true), new THREE.MeshBasicMaterial({ color: '#c46bff', map: pillarTexture, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false })); cone.position.y = 0.8; root.add(cone); root.userData.tractor = cone; }
    } else {
      health = makeBillboard(1.25, 0.3); health.sprite.position.y = height + 0.35; health.sprite.material.depthTest = true;
    }
    root.add(health.sprite);
    if (enemy.type === 'MAGE') { const orb = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), emissiveMat('#b37bff', 3)); orb.position.set(0.42, 0.95, 0.25); body.add(orb); const halo = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.7), glowMat('#a86bff')); orb.add(halo); root.userData.orb = orb; }
    if (enemy.type === 'MOLE') {
      const hole = new THREE.Group();
      const pit = new THREE.Mesh(new THREE.CircleGeometry(0.62, 24), new THREE.MeshBasicMaterial({ color: '#2b1a0e', transparent: true, depthWrite: false })); pit.rotation.x = -Math.PI / 2; pit.position.y = 0.05; hole.add(pit);
      const dirtMat = new THREE.MeshStandardMaterial({ color: '#7a5634', roughness: 1 });
      for (let i = 0; i < 10; i++) { const clod = new THREE.Mesh(new THREE.DodecahedronGeometry(0.13 + (i % 3) * 0.04), dirtMat); const a = i / 10 * Math.PI * 2; clod.position.set(Math.cos(a) * 0.7, 0.06, Math.sin(a) * 0.7); clod.userData.a = a; hole.add(clod); }
      root.add(hole); root.userData.hole = hole;
      const mound = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), dirtMat); mound.scale.y = 0.45; mound.visible = false; root.add(mound); root.userData.mound = mound;
    }
    Object.assign(root.userData, { body, health, height, baseSize: size, lastHit: 0 });
    scene.add(root);
    return root;
  }

  function drawHealth(node, enemy) {
    const ratio = Math.max(0, enemy.hp / Math.max(1, enemy.maxHp));
    if (enemy.elite) { const style = ELITE_STYLE[enemy.type] || ELITE_STYLE.BOSS; drawPlate(node, { text: enemy.name || enemy.type, health: ratio * 100, color: style.color, elite: style }); return; }
    const key = Math.ceil(ratio * 100);
    if (node.lastKey === key) return;
    node.lastKey = key;
    const { context: g, texture } = node;
    g.clearRect(0, 0, 512, 128);
    g.fillStyle = '#263d30'; rounded(g, 24, 46, 464, 28, 10); g.fill();
    g.fillStyle = '#ee6260'; rounded(g, 24, 46, 464 * ratio, 28, 10); g.fill();
    texture.needsUpdate = true;
  }

  function updateFarmBar(hp, henFlash, now) {
    const flashKey = henFlash ? Math.floor(now / 70) % 2 : -1;
    if (!farmBar || (lastFarmValue === Math.ceil(hp) && farmBar.flashKey === flashKey)) return;
    lastFarmValue = Math.ceil(hp); farmBar.flashKey = flashKey;
    const { context: g, texture } = farmBar;
    g.clearRect(0, 0, 512, 128);
    g.fillStyle = '#10251fee'; g.strokeStyle = henFlash ? '#ff3546' : '#ffe17a'; g.lineWidth = 6; rounded(g, 5, 8, 502, 110, 20); g.fill(); g.stroke();
    g.fillStyle = '#fff7dc'; g.font = '850 29px Rye, Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.fillText(`MAMA HEN · ${Math.ceil(hp)}%`, 256, 46);
    g.fillStyle = '#263d30'; rounded(g, 28, 65, 456, 34, 10); g.fill();
    g.fillStyle = flashKey === 0 ? '#ff3546' : hp > 50 ? '#53d57a' : hp > 25 ? '#f2c64c' : '#ff6464'; rounded(g, 31, 68, 450 * Math.max(0, hp) / 100, 28, 8); g.fill();
    texture.needsUpdate = true;
  }

  // ------------------------------------------------------------------ sync
  function lobbySlot(index, count) {
    const perRow = Math.min(count, 6), row = Math.floor(index / 6), col = index % 6, inRow = Math.min(6, count - row * 6);
    const spacing = 1.65, x = (col - (inRow - 1) / 2) * spacing, z = 1.0 - row * 1.7;
    return stage.position.clone().add(new THREE.Vector3(x, 0.32, z + Math.abs(x) * -0.12)).setY(0.32 + (perRow ? 0 : 0));
  }

  function syncPlayers(players, now, dt, state) {
    const seen = new Set(), lobby = state.lobby;
    const list = [...players.values()];
    list.forEach((player, index) => {
      seen.add(player.id);
      let node = playerNodes.get(player.id);
      const fresh = !node;
      if (!node) { node = makePlayer(player); playerNodes.set(player.id, node); }
      const u = node.userData;
      const dead = player.hp <= 0;
      let goal, facing;
      if (lobby) { goal = lobbySlot(index, list.length); facing = Math.PI / 2; }
      else { goal = actorPosition(player.x, player.y); facing = player.aim; }
      if (fresh) node.position.copy(goal);
      const prev = node.position.clone();
      const k = Math.min(1, dt * 13);
      node.position.x += (goal.x - node.position.x) * k;
      node.position.z += (goal.z - node.position.z) * k;
      const speed = prev.distanceTo(node.position) / Math.max(dt, 0.001);
      const body = u.body;
      body.rotation.y = Math.PI / 2 - facing;
      const hulk = !!player.effects?.HULK && !dead && !lobby, scale = lobby ? 1.55 : hulk ? 1.5 : 1;
      node.scale.setScalar(node.scale.x + (scale - node.scale.x) * Math.min(1, dt * 6));
      // Procedural chick animation: waddle while moving, breathe while idle, dance in the lobby, recoil when firing.
      const moving = speed > 0.6 && !dead;
      u.walk += dt * (moving ? 9 + speed * 1.2 : 2.2);
      let bob = 0, roll = 0, pitch = 0, squash = 1;
      if (dead) { /* handled below */ }
      else if (lobby) { const t = now / 1000 + index * 0.7; bob = Math.abs(Math.sin(t * 4.2)) * 0.22; roll = Math.sin(t * 4.2) * 0.12; squash = 1 + Math.sin(t * 8.4) * 0.05; if (Math.floor(t / 4) % 3 === index % 3) body.rotation.y += (t % 4) / 4 * Math.PI * 2; }
      else if (moving) { bob = Math.abs(Math.sin(u.walk)) * 0.13; roll = Math.sin(u.walk) * 0.16; pitch = 0.12; squash = 1 - Math.abs(Math.cos(u.walk)) * 0.06; }
      else { squash = 1 + Math.sin(now / 420 + index) * 0.025; roll = Math.sin(now / 900 + index) * 0.03; }
      const firing = player.lastShot && now - player.lastShot < 70 && !lobby && !dead;
      u.model.position.y = bob;
      u.model.rotation.set(pitch, 0, roll);
      u.model.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
      u.weapon.position.z = 0.22 - (firing ? 0.07 : 0);
      u.weapon.position.y = 0.5 + bob;
      u.weapon.rotation.x = firing ? -0.08 : 0;
      const laser = !!player.effects?.LASER, seekerOn = !!player.effects?.SEEKER;
      u.rifle.visible = !laser && !seekerOn; u.laserGun.visible = laser && !seekerOn; u.launcher.visible = seekerOn;
      if (u.tint) u.tint.uTint.value.copy(hulk ? HULK_GREEN : u.baseTint);
      u.fists.visible = hulk; u.hulkGlow.visible = hulk; if (u.shell) u.shell.visible = hulk;
      if (hulk) { const pulse = 0.75 + Math.sin(now / 140) * 0.25; u.hulkGlow.material.opacity = pulse * 0.6; u.hulkGlow.scale.setScalar(3.1 + pulse * 0.6); if (u.shell) u.shell.traverse(n => { if (n.isMesh) n.material.opacity = 0.45 + pulse * 0.4; }); if (Math.random() < 0.5) sparks.emit({ pos: node.position.clone().setY(0.4 + Math.random() * 1.2), count: 1, colors: ['#5dff3d', '#b6ff8a'], speed: 0.6, up: 1.4, gravity: 0.4, radius: 0.7, life: 0.7, size: 0.22 }); if (player.dashAt && now - player.dashAt < 260) dust.emit({ pos: node.position.clone().setY(0.2), count: 3, colors: ['#5dff3d', '#8b7355'], speed: 1, up: 0.8, gravity: -2, life: 0.5, size: 0.3 }); }
      if (hulk) {
        const punch = player.punchAt && now - player.punchAt < 220 ? Math.sin((now - player.punchAt) / 220 * Math.PI) : 0;
        u.fists.children.forEach((f, i) => { const alt = (Math.floor((player.punchAt || 0) / 300) % 2) === i; f.position.z = 0.32 + (alt ? punch * 0.55 : 0); f.position.y = 0.55 + Math.sin(now / 160 + i * 3) * 0.04; f.rotation.x = alt ? -punch * 0.3 : 0; });
        if (Math.random() < 0.25) dust.emit({ pos: node.position.clone().setY(0.1), count: 1, colors: ['#3f8f2a', '#7ac14a'], speed: 0.8, up: 0.6, gravity: -1, radius: 0.6, life: 0.6, size: 0.18 });
      }
      if (laser) { u.laserGun.userData.crystal.rotation.z += dt * 6; }
      u.muzzle.visible = firing && !laser && Math.random() < 0.8;
      if (u.muzzle.visible) { u.muzzle.rotation.z = Math.random() * 6; u.muzzle.lookAt(camera.position); }
      const hit = player.lastHit > 0 && now - player.lastHit < 460;
      if (u.tint) u.tint.uFlash.value = hit && Math.floor(now / 65) % 2 === 0 ? 0.7 : 0;
      u.aura.material.color.set(hit ? '#ff273b' : player.color);
      u.ring.material.color.set(hit ? '#ff273b' : player.color);
      u.pointer.visible = !lobby && !dead;
      drawPlate(u.label, { text: lobby ? player.name : hulk ? `💪 ${player.name} · HULK` : `${player.name} · ${player.score}`, health: player.hp, color: hulk ? '#4cff4c' : player.color });
      const ls = lobby ? 0.62 : 1; u.label.sprite.scale.set(3.05 * ls, 0.78 * ls, 1); u.label.sprite.position.y = lobby ? 1.75 : 1.85;
      u.angel.visible = dead && !lobby;
      u.shield.visible = !dead && now < (player.effects?.SHIELD || 0);
      if (u.shield.visible) { u.shield.rotation.y += dt * 0.8; u.shield.material.opacity = 0.35 + Math.sin(now / 120) * 0.12; }
      u.weapon.visible = !dead && !hulk;
      node.visible = player.connected !== false || dead;
      if (dead && !lobby) {
        const t = Math.max(0, (now - (player.deathAt || now)) / 1000);
        node.position.y = 0.12 + Math.min(1.7, t * 0.42) + Math.sin(now / 130) * 0.06;
        body.rotation.z = Math.sin(now / 210) * 0.04;
        u.angel.rotation.z = Math.sin(now / 95) * 0.2;
        u.aura.material.color.set('#fff0a6'); u.ring.material.color.set('#fff0a6');
        u.revive.mesh.visible = state.players && !state.gameOver;
        u.revive.mesh.position.set(node.position.x, 0.06, node.position.z);
        drawRevive(u.revive, player.revive || 0, player.revivers || 0, now);
        u.revive.mesh.material.opacity = 0.75 + Math.sin(now / 160) * 0.2;
        if ((player.revive || 0) > 0 && Math.random() < 0.5) sparks.emit({ pos: new THREE.Vector3(node.position.x, 0.2, node.position.z), count: 1, color: '#ffe36b', speed: 0.3, up: 2.5, gravity: 0.5, radius: 1.3, life: 0.9, size: 0.18 });
      } else {
        node.position.y = (lobby ? 0.32 : 0.035);
        body.rotation.z = 0;
        u.revive.mesh.visible = false;
      }
      // Laser beams.
      const beams = player.beams || [];
      u.beams.forEach((b, i) => {
        const data = beams[beams.length - 1 - i];
        b.visible = !!data && !dead && !lobby;
        if (!b.visible) return;
        const start = actorPosition(player.x + Math.cos(data.a) * 30, player.y + Math.sin(data.a) * 30, 0.55), len = data.len / UNIT;
        b.position.copy(start).add(new THREE.Vector3(Math.cos(data.a) * len / 2, 0, Math.sin(data.a) * len / 2));
        b.rotation.y = Math.PI / 2 - data.a; b.scale.set(1 + Math.random() * 0.3, 1 + Math.random() * 0.3, len);
        if (data.hit && Math.random() < 0.6) sparks.emit({ pos: start.clone().add(new THREE.Vector3(Math.cos(data.a) * len, 0, Math.sin(data.a) * len)), count: 3, colors: ['#ff3df2', '#ffffff', '#7ff6ff'], speed: 3, up: 1.5, life: 0.3, size: 0.16 });
      });
    });
    for (const [id, node] of playerNodes) if (!seen.has(id)) { scene.remove(node); node.userData.beams.forEach(b => scene.remove(b)); scene.remove(node.userData.revive.mesh); playerNodes.delete(id); }
  }

  function syncEnemies(enemies, now, dt) {
    const seen = new Set();
    for (const enemy of enemies) {
      seen.add(enemy);
      let node = enemyNodes.get(enemy);
      if (!node) { node = makeEnemy(enemy); enemyNodes.set(enemy, node); }
      const u = node.userData, body = u.body;
      const position = actorPosition(enemy.x, enemy.y);
      body.userData.mixer?.update(dt);
      node.position.set(position.x, 0, position.z);
      const yaw = enemy.type === 'TORNADO' ? Math.PI / 2 - enemy.travelAngle : Math.PI / 2 - (enemy.facing ?? Math.PI / 2);
      body.rotation.y += Math.atan2(Math.sin(yaw - body.rotation.y), Math.cos(yaw - body.rotation.y)) * Math.min(1, dt * 10);
      body.position.set(0, 0, 0); body.scale.setScalar(1); body.rotation.x = 0; body.rotation.z = 0;
      const t = now / 1000 + (enemy.phase || 0);
      // Skeletal animation state.
      if (body.userData.actions) {
        if (enemy.attackAt && now - enemy.attackAt < 500 && body.userData.actions.attack) playAction(body, 'attack', 0.1);
        else if (!enemy.attackAt || now - enemy.attackAt >= 500) playAction(body, enemy.moving === false ? 'idle' : (enemy.type === 'WOLF' && now < (enemy.dashUntil || 0) ? 'run' : 'walk'));
      }
      switch (enemy.type) {
        case 'FOX': { const jump = now < enemy.jumpUntil ? Math.sin((enemy.jumpUntil - now) / 360 * Math.PI) * 0.75 : 0; body.position.y = jump + Math.abs(Math.sin(t * 11)) * 0.08; body.rotation.x = Math.sin(t * 11) * 0.08 - jump * 0.3; break; }
        case 'EAGLE': { const dive = now < (enemy.dashUntil || 0); body.position.y = (dive ? 0.7 : 1.7) + Math.sin(t * 2.4) * 0.15; body.rotation.x = dive ? 0.35 : 0; body.rotation.z = Math.sin(t * 1.3) * 0.25; break; }
        case 'GHOST': { body.position.y = 0.25 + Math.sin(t * 2.6) * 0.15; body.rotation.z = Math.sin(t * 1.8) * 0.1; body.traverse(n => { if (n.isMesh && n.material.transparent) n.material.opacity = 0.78 + Math.sin(t * 3.1) * 0.14; }); break; }
        case 'PLANT': {
          const em = enemy.emergeAt || 0;
          if (!u.seed) {
            u.seed = new THREE.Group();
            const seed = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshStandardMaterial({ color: '#8a5a2b', roughness: 0.6 })); seed.scale.set(0.8, 1.15, 0.8); u.seed.add(seed); u.seedBall = seed;
            const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), glowMat('#b8ed53')); seed.add(glow); u.seedGlow = glow;
            const mound = new THREE.Mesh(new THREE.SphereGeometry(0.5, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#6b4a2b', roughness: 1 })); mound.scale.y = 0.35; u.seed.add(mound); u.seedMound = mound;
            const ring = new THREE.Mesh(new THREE.RingGeometry(0.75, 0.9, 32), new THREE.MeshBasicMaterial({ color: '#b8ed53', transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide, toneMapped: false })); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04; u.seed.add(ring); u.seedRing = ring;
            node.add(u.seed);
          }
          if (now < em) {
            // Telegraph: a glowing seed falls, digs into a dirt mound, then the plant sprouts.
            const total = Math.max(1, em - (enemy.bornAt || em - 2000)), p = 1 - (em - now) / total;
            u.seed.visible = true;
            const fall = Math.min(1, p / 0.3);
            u.seedBall.visible = p < 0.75; u.seedBall.position.y = 6 * (1 - fall) * (1 - fall) + 0.12 + (fall >= 1 ? Math.abs(Math.sin(p * 30)) * 0.05 : 0); u.seedGlow.lookAt(camera.position);
            u.seedMound.scale.set(0.3 + p * 0.8, 0.12 + p * 0.3, 0.3 + p * 0.8);
            u.seedRing.material.opacity = 0.35 + Math.sin(now / 90) * 0.3; u.seedRing.scale.setScalar(0.8 + p * 0.4);
            if (fall >= 1 && Math.random() < 0.4) dust.emit({ pos: new THREE.Vector3(position.x, 0.1, position.z), count: 1, colors: ['#6b4a2b', '#b8ed53'], speed: 0.8, up: 1.6, gravity: -5, radius: 0.3, life: 0.5, size: 0.14 });
            const grow = Math.max(0, (p - 0.75) / 0.25);
            body.visible = grow > 0; body.scale.set(0.15 + grow * 0.85, 0.05 + grow * 0.95, 0.15 + grow * 0.85);
            if (!u.landed && fall >= 1) { u.landed = true; dust.emit({ pos: new THREE.Vector3(position.x, 0.2, position.z), count: 14, colors: ['#6b4a2b', '#8a5a2b'], speed: 2, up: 2.5, gravity: -8, life: 0.5, size: 0.18 }); }
            break;
          }
          body.visible = true; u.seed.visible = now - em < 900; if (u.seed.visible) { const k = 1 - (now - em) / 900; u.seedMound.scale.set(1.1 * k + 0.01, 0.42 * k + 0.01, 1.1 * k + 0.01); u.seedBall.visible = false; u.seedRing.material.opacity = 0.6 * k; }
          const j = body.userData.jaws; body.rotation.z = Math.sin(t * 1.6) * 0.06; if (j) { const bite = enemy.attackAt && now - enemy.attackAt < 350 ? Math.sin((now - enemy.attackAt) / 350 * Math.PI) : 0; j.top.rotation.x = -0.35 - bite * 0.6 - Math.sin(t * 3) * 0.05; j.head.rotation.x = -0.3 + bite * 0.4; } break; }
        case 'ALIEN': { body.position.y = 0.15 + Math.sin(t * 3) * 0.08; body.rotation.z = Math.sin(t * 2.2) * 0.12; break; }
        case 'ALIENBOSS': { body.position.y = 0.6 + Math.sin(t * 2) * 0.15; body.rotation.z = Math.sin(t * 1.4) * 0.08; if (u.tractor) { u.tractor.material.opacity = 0.3 + Math.sin(t * 6) * 0.15; u.tractor.rotation.y += dt; } if (Math.random() < 0.3) sparks.emit({ pos: new THREE.Vector3(position.x, 0.1, position.z), count: 1, color: '#c46bff', speed: 0.2, up: 1.6, gravity: 0.6, radius: 0.9, life: 0.8, size: 0.2 }); break; }
        case 'MAGE': { body.position.y = Math.abs(Math.sin(t * 6)) * 0.08; if (u.orb) { u.orb.position.y = 0.95 + Math.sin(t * 4) * 0.08; u.orb.children[0].lookAt(camera.position); } if (Math.random() < 0.15) sparks.emit({ pos: node.localToWorld(new THREE.Vector3(0.4, 1, 0.2)), count: 1, color: '#b37bff', speed: 0.2, up: 0.6, gravity: 0.4, life: 0.6, size: 0.12 }); break; }
        case 'MUSHROOM': { if (Math.random() < 0.25) dust.emit({ pos: new THREE.Vector3(position.x, 1.2, position.z), count: 1, colors: ['#ffd27a', '#c5ff7a'], speed: 0.5, up: 0.4, gravity: -0.1, radius: 1.0, life: 1.4, size: 0.14 }); break; }
        case 'TORNADO': {
          const tw = body.userData.tornado, s = 0.45 + (enemy.visualScale || 0.35) * 0.65;
          body.scale.setScalar(s);
          tw.layers.forEach(l => { l.rotation.y += dt * 9; l.position.x = Math.sin(t * 7) * 0.06; }); tw.shells.forEach((sh, i) => { sh.material.map.offset.x -= dt * (i ? 0.9 : 1.6); sh.rotation.y += dt * (i ? -3 : 5); sh.position.x = Math.sin(t * 5 + i) * 0.07; });
          tw.debris.children.forEach(d => { const a = d.userData.a + t * d.userData.s; d.position.set(Math.cos(a) * d.userData.r * (0.6 + d.userData.h * 0.35), d.userData.h, Math.sin(a) * d.userData.r * (0.6 + d.userData.h * 0.35)); d.rotation.set(t * 5, t * 7, 0); });
          tw.dustRing.rotation.z += dt * 4; tw.dustRing.scale.setScalar(1 + Math.sin(t * 8) * 0.1);
          if (enemy.launchAt > now) body.position.y = 0.3 + s * 0.3;
          if (Math.random() < 0.6) dust.emit({ pos: new THREE.Vector3(position.x, 0.1, position.z), count: 2, colors: ['#cdb48a', '#a8916b', '#e0d2b4'], speed: 2.2 * s, up: 0.8, gravity: -0.5, radius: 0.5, life: 0.7, size: 0.35 });
          break;
        }
        case 'MOLE': {
          const emerge = enemy.emergeAt || 0, hole = u.hole, mound = u.mound;
          if (now < emerge) {
            // Telegraph: the hole opens and dirt shakes before the mole pops out.
            const left = emerge - now, p = 1 - Math.min(1, left / 1700);
            hole.visible = true; hole.scale.setScalar(0.3 + p * 0.9);
            hole.children.forEach((c, i) => { if (i) c.position.y = 0.06 + Math.abs(Math.sin(now / 60 + i)) * 0.08 * p; });
            body.position.y = left < 300 ? -0.9 + (1 - left / 300) * 0.9 : -1.2;
            body.visible = left < 300;
            if (Math.random() < 0.5) dust.emit({ pos: new THREE.Vector3(position.x, 0.1, position.z), count: 2, colors: ['#7a5634', '#5a3d22', '#a07a50'], speed: 1.2, up: 2.4, gravity: -7, radius: 0.4 * p, life: 0.6, size: 0.16 });
            if (!u.warned) { u.warned = true; }
            if (left < 80 && !u.popped) { u.popped = true; dust.emit({ pos: new THREE.Vector3(position.x, 0.2, position.z), count: 26, colors: ['#7a5634', '#5a3d22', '#a07a50'], speed: 3, up: 4, gravity: -9, life: 0.8, size: 0.2 }); }
          } else {
            body.visible = true;
            hole.visible = now - emerge < 2500; hole.scale.setScalar(Math.max(0.01, 1.2 - (now - emerge) / 2500 * 1.2));
            const burrowed = now < (enemy.burrowUntil || 0);
            mound.visible = burrowed; body.position.y = burrowed ? -0.8 : Math.abs(Math.sin(t * 9)) * 0.05;
            if (burrowed && Math.random() < 0.6) dust.emit({ pos: new THREE.Vector3(position.x, 0.1, position.z), count: 2, colors: ['#7a5634', '#a07a50'], speed: 1, up: 1.5, gravity: -6, life: 0.5, size: 0.15 });
          }
          hole.position.set(0, 0, 0);
          break;
        }
        default: break;
      }
      // Teleport (mage + alien overlord): stretch in from a thin beam of light.
      if (enemy.teleportAt && now - enemy.teleportAt < 450) { const p = (now - enemy.teleportAt) / 450; body.scale.set(0.2 + p * 0.8, 1.8 - p * 0.8, 0.2 + p * 0.8); }
      if (enemy.elite && u.eliteAura) { u.spikes.rotation.y -= dt * 0.8; u.eliteAura.rotation.z += dt * 1.5; const pulse = 1 + Math.sin(now / 180) * 0.08; u.eliteAura.scale.setScalar(pulse * (enemy.type === 'BOSS' ? 1.1 : 1.2)); }
      if (enemy.elite && enemy.attackAt && now - enemy.attackAt < 300 && enemy.type === 'MUSHROOM') body.scale.multiplyScalar(1 + Math.sin((now - enemy.attackAt) / 300 * Math.PI) * 0.12);
      // Hit flash + spark burst.
      const hitFlash = now < (enemy.hitUntil || 0) && Math.floor(now / 45) % 2 === 0;
      if (u.materialColors === undefined) { u.materialColors = []; body.traverse(part => { if (part.isMesh) for (const mat of (Array.isArray(part.material) ? part.material : [part.material])) if (mat?.color) u.materialColors.push({ mat, color: mat.color.clone() }); }); }
      for (const entry of u.materialColors) entry.mat.color.copy(hitFlash ? FLASH : entry.color);
      if (enemy.hitUntil && enemy.hitUntil !== u.lastHit) { u.lastHit = enemy.hitUntil; sparks.emit({ pos: new THREE.Vector3(position.x, 0.6, position.z), count: 5, colors: ['#fff3a0', '#ffb347'], speed: 3, up: 2, life: 0.25, size: 0.14 }); }
      u.health.sprite.visible = enemy.elite || enemy.hp < enemy.maxHp;
      if ((enemy.type === 'MOLE' || enemy.type === 'PLANT') && now < (enemy.emergeAt || 0)) u.health.sprite.visible = false;
      drawHealth(u.health, enemy);
      u.health.sprite.position.y = u.height + (enemy.elite ? 0.75 : 0.35) + (enemy.type === 'EAGLE' ? 1.6 : enemy.type === 'ALIENBOSS' ? 0.6 : 0);
    }
    for (const [enemy, node] of enemyNodes) if (!seen.has(enemy)) {
      const p = node.position;
      if (enemy.hp <= 0) { dust.emit({ pos: new THREE.Vector3(p.x, 0.4, p.z), count: enemy.elite ? 40 : 12, colors: enemy.type === 'TORNADO' ? ['#e0d2b4', '#cdb48a'] : ['#a91f25', '#df3832', '#6b1015'], speed: enemy.elite ? 4 : 2.5, up: 3, gravity: -9, life: 0.7, size: 0.18 }); if (enemy.elite) sparks.emit({ pos: new THREE.Vector3(p.x, 1, p.z), count: 50, colors: [ELITE_STYLE[enemy.type]?.color || '#ff4d5e', '#fff3a0'], speed: 6, up: 4, gravity: -5, life: 1, size: 0.3 }); }
      scene.remove(node); enemyNodes.delete(enemy);
    }
  }
  const FLASH = new THREE.Color('#ff5b5b'), HULK_GREEN = new THREE.Color('#2f7d1f');

  // ------------------------------------------------------------------ projectiles & drops
  const shotGeo = new THREE.CapsuleGeometry(0.075, 0.34, 4, 8);
  const shotMats = new Map();
  const shotMat = color => { if (!shotMats.has(color)) shotMats.set(color, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).lerp(new THREE.Color('#ffffff'), 0.45).multiplyScalar(2.2), toneMapped: false })); return shotMats.get(color); };
  function makeIcon(type, color) {
    const g = new THREE.Group();
    if (type === 'SHIELD') {
      const s = new THREE.Shape(); s.moveTo(0, 0.42); s.bezierCurveTo(0.2, 0.36, 0.33, 0.34, 0.36, 0.3); s.bezierCurveTo(0.36, -0.05, 0.25, -0.28, 0, -0.42); s.bezierCurveTo(-0.25, -0.28, -0.36, -0.05, -0.36, 0.3); s.bezierCurveTo(-0.33, 0.34, -0.2, 0.36, 0, 0.42);
      const shield = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 3 }), emissiveMat(color, 0.8, { metalness: 0.6, roughness: 0.25 })); shield.position.z = -0.06; g.add(shield);
      const inner = new THREE.Shape(); for (let i = 0; i < 10; i++) { const a = Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 0.08 : 0.19; i ? inner.lineTo(Math.cos(a) * r, Math.sin(a) * r + 0.02) : inner.moveTo(Math.cos(a) * r, Math.sin(a) * r + 0.02); }
      for (const z of [0.12, -0.11]) { const star = new THREE.Mesh(new THREE.ExtrudeGeometry(inner, { depth: 0.03, bevelEnabled: false }), emissiveMat('#ffffff', 1.5)); star.position.z = z; g.add(star); }
    } else if (type === 'MEDKIT') {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.5, 0.32), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.4 })); g.add(box);
      const handle = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.03, 6, 14, Math.PI), new THREE.MeshStandardMaterial({ color: '#d0d0d0' })); handle.position.y = 0.25; g.add(handle);
      for (const z of [0.17, -0.17]) { const v = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.34, 0.04), emissiveMat(color, 1.4)); v.position.z = z; const h = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.04), emissiveMat(color, 1.4)); h.position.z = z; g.add(v, h); }
    } else if (type === 'DOUBLE') {
      for (const x of [-0.15, 0.15]) { const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.42, 14), new THREE.MeshStandardMaterial({ color: '#c98a24', metalness: 0.9, roughness: 0.25 })); shell.position.set(x, -0.08, 0); const tip = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.24, 14), emissiveMat(color, 1.6, { metalness: 0.6 })); tip.position.set(x, 0.25, 0); const rim = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.02, 6, 14), new THREE.MeshStandardMaterial({ color: '#8a5a12', metalness: 0.9 })); rim.rotation.x = Math.PI / 2; rim.position.set(x, -0.28, 0); g.add(shell, tip, rim); }
    } else if (type === 'RAPID') {
      const s = new THREE.Shape(); s.moveTo(0.08, 0.46); s.lineTo(-0.22, 0.02); s.lineTo(-0.02, 0.02); s.lineTo(-0.1, -0.46); s.lineTo(0.24, 0.06); s.lineTo(0.04, 0.06); s.closePath();
      const bolt = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: 0.1, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2 }), emissiveMat(color, 1.8)); bolt.position.z = -0.05; g.add(bolt);
    } else if (type === 'TURRET') {
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.42, 0.14, 16), emissiveMat(color, 0.9, { metalness: 0.7 })); base.position.y = -0.3; g.add(base);
      const chick = makeModel(models.turret, 0.72) || makeFallbackActor('PLAYER'); chick.position.y = -0.24; g.add(chick);
      for (const x of [-0.1, 0.1]) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.4, 8), new THREE.MeshStandardMaterial({ color: '#3b4650', metalness: 0.8 })); b.rotation.x = Math.PI / 2; b.position.set(x, 0.02, 0.42); g.add(b); }
    } else if (type === 'SEEKER') {
      const l = makeLauncher(); l.scale.setScalar(1.15); l.rotation.y = Math.PI / 4; g.add(l);
      for (const x of [-0.25, 0.25]) { const m = makeMissile(0.9); m.position.set(x, 0.25, 0); g.add(m); }
    } else if (type === 'HULK') {
      const f = makeFist('#4caf2a'); f.scale.setScalar(1.6); f.rotation.x = -Math.PI / 2; f.position.y = 0.05; g.add(f);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.04, 8, 28), emissiveMat('#4cff4c', 2)); ring.rotation.x = Math.PI / 2; g.add(ring);
    } else if (type === 'LASER') {
      const gun = makeLaserGun(); gun.scale.setScalar(1.25); gun.rotation.y = Math.PI / 4; g.add(gun);
      const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.16), emissiveMat('#7ff6ff', 2.4)); crystal.position.y = 0.36; crystal.scale.y = 1.5; g.add(crystal); g.userData.crystal = crystal;
    }
    g.traverse(n => { if (n.isMesh) n.castShadow = true; });
    return g;
  }
  function makeDrop(item) {
    const style = DROP_STYLE[item.type] || DROP_STYLE.SHIELD;
    const big = ['TURRET', 'LASER', 'SEEKER', 'HULK'].includes(item.type);
    const node = new THREE.Group();
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.62, big ? 7 : 4.2, 20, 1, true), new THREE.MeshBasicMaterial({ color: style.color, map: pillarTexture, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    pillar.position.y = (big ? 7 : 4.2) / 2; node.add(pillar);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1.25, 32), glowMat(style.color)); disc.rotation.x = -Math.PI / 2; disc.position.y = 0.05; node.add(disc);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.05, 8, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(style.color).multiplyScalar(2), toneMapped: false })); ring.rotation.x = Math.PI / 2; ring.position.y = 0.08; node.add(ring);
    const ring2 = ring.clone(); ring2.scale.setScalar(0.6); node.add(ring2);
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.52, 0.16, 6), new THREE.MeshStandardMaterial({ color: '#2b3a3d', metalness: 0.6, roughness: 0.35 })); pedestal.position.y = 0.08; node.add(pedestal);
    const icon = makeIcon(item.type, style.color); icon.position.y = 1.0; if (big) icon.scale.setScalar(1.35); node.add(icon);
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), glowMat(style.color)); halo.material.opacity = 0.55; icon.add(halo);
    const label = makeBillboard(big ? 2.8 : 2.2, big ? 0.7 : 0.55);
    const g = label.context; g.clearRect(0, 0, 512, 128); g.fillStyle = '#0d1d1aee'; g.strokeStyle = style.color; g.lineWidth = 7; rounded(g, 10, 22, 492, 84, 40); g.fill(); g.stroke(); g.fillStyle = style.color; g.font = '900 40px Bungee, "Arial Black", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(style.label, 256, 66); label.texture.needsUpdate = true;
    label.sprite.position.y = big ? 2.3 : 1.95; node.add(label.sprite);
    node.userData = { icon, ring, ring2, pillar, disc, halo, label, style, big };
    scene.add(node);
    return node;
  }
  function syncDrops(items, now, dt) {
    const seen = new Set();
    for (const item of items) {
      seen.add(item);
      let node = dropNodes.get(item);
      if (!node) { node = makeDrop(item); dropNodes.set(item, node); const p = actorPosition(item.x, item.y); sparks.emit({ pos: new THREE.Vector3(p.x, 0.5, p.z), count: 30, color: node.userData.style.color, speed: 4, up: 3, life: 0.6, size: 0.22 }); }
      const u = node.userData, age = (now - (item.bornAt || now)) / 1000, pop = Math.min(1, age * 3);
      node.position.copy(actorPosition(item.x, item.y));
      node.scale.setScalar(0.3 + pop * 0.7 + (pop < 1 ? Math.sin(pop * Math.PI) * 0.3 : 0));
      u.icon.position.y = 1.0 + Math.sin(now / 300) * 0.14;
      u.icon.rotation.y += dt * 1.8;
      u.halo.lookAt(camera.position);
      u.ring.scale.setScalar(1 + ((now / 900) % 1) * 0.55); u.ring.material.opacity = 1 - ((now / 900) % 1);
      u.ring.material.transparent = true;
      u.ring2.rotation.z += dt * 2;
      u.pillar.material.opacity = 0.45 + Math.sin(now / 200) * 0.15;
      if (u.icon.userData.crystal) u.icon.userData.crystal.rotation.y += dt * 4;
      // Blink during the last 5 seconds.
      node.visible = !(item.life < 5 && Math.floor(now / 140) % 2 === 0);
      if (Math.random() < (u.big ? 0.6 : 0.3)) sparks.emit({ pos: node.position.clone().setY(0.2), count: 1, color: u.style.color, speed: 0.2, up: 2.4, gravity: 0.6, radius: 0.7, life: 1.1, size: 0.16 });
    }
    for (const [item, node] of dropNodes) if (!seen.has(item)) { scene.remove(node); dropNodes.delete(item); }
  }

  function syncProjectiles(kind, items, pool, now) {
    const seen = new Set();
    for (const item of items) {
      seen.add(item);
      let node = pool.get(item);
      if (!node) {
        if (kind === 'shot') node = item.missile ? makeMissile(1.3) : new THREE.Mesh(shotGeo, shotMat(item.color || '#fff1a2'));
        else if (kind === 'fireball') {
          const color = item.kind === 'seed' ? '#b8ed53' : item.kind === 'spore' ? '#d78bff' : '#ff6a2d';
          node = new THREE.Group();
          const core = new THREE.Mesh(new THREE.SphereGeometry(item.kind === 'seed' ? 0.15 : 0.22, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.2), toneMapped: false })); node.add(core);
          const halo = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), glowMat(color)); node.add(halo); node.userData = { halo, color };
        } else node = new THREE.Group();
        pool.set(item, node); scene.add(node);
      }
      if (kind === 'beam') {
        if (!node.userData.built) {
          node.userData.built = true;
          const a = actorPosition(item.x1, item.y1, 0.7), b = actorPosition(item.x2, item.y2, 0.7), len = a.distanceTo(b), w = item.width || 1;
          const core = new THREE.Mesh(new THREE.CylinderGeometry(0.035 * w, 0.035 * w, len, 6, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(item.color || '#7cfff0').lerp(new THREE.Color('#ffffff'), 0.5), transparent: true, toneMapped: false }));
          const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.1 * w, 0.1 * w, len, 8, 1, true), new THREE.MeshBasicMaterial({ color: item.color || '#7cfff0', transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
          node.add(core, glow); node.position.copy(a).add(b).multiplyScalar(0.5); node.lookAt(b); node.rotateX(Math.PI / 2);
          sparks.emit({ pos: b, count: 8, color: item.color || '#7cfff0', speed: 3, up: 2, life: 0.35, size: 0.2 });
          node.userData.maxT = item.t;
        }
        const f = Math.max(0, item.t / (node.userData.maxT || 0.24));
        node.children.forEach(c => { c.material.opacity = (c.material.blending === THREE.AdditiveBlending ? 0.6 : 1) * f; });
        node.scale.x = node.scale.z = 0.6 + f * 0.6;
      } else if (kind === 'shot') {
        let h = 0.55;
        if (item.turret) { const d = Math.hypot(item.x - item.startX, item.y - item.startY) / UNIT; h = Math.max(0.5, houseTop + 0.6 - d * 0.42); }
        node.position.copy(actorPosition(item.x, item.y, h));
        node.rotation.set(Math.PI / 2, 0, 0); node.rotation.z = 0;
        node.quaternion.setFromUnitVectors(UPV, new THREE.Vector3(item.dx, 0, item.dy).normalize());
        if (item.missile) { node.position.y = 0.75; node.userData.flame.scale.y = 0.7 + Math.random() * 0.7; dust.emit({ pos: node.position.clone(), count: 1, colors: ['#d8d8d8', '#bdbdbd'], speed: 0.2, up: 0.3, gravity: 0.2, drag: 0.8, life: 0.7, size: 0.22 }); if (Math.random() < 0.6) sparks.emit({ pos: node.position.clone(), count: 1, colors: ['#ffb340', '#ff7b2a'], speed: 0.4, up: 0, gravity: 0, life: 0.25, size: 0.2 }); }
      } else {
        node.position.copy(actorPosition(item.x, item.y, 0.5 + Math.sin(now / 120) * 0.05));
        node.userData.halo?.lookAt(camera.position);
        if (Math.random() < 0.5) (item.kind === 'fire' ? sparks : dust).emit({ pos: node.position.clone(), count: 1, color: node.userData.color, speed: 0.3, up: 0.3, gravity: 0, life: 0.4, size: item.kind === 'fire' ? 0.3 : 0.16 });
      }
    }
    for (const [item, node] of pool) if (!seen.has(item)) { scene.remove(node); node.traverse(o => { if (o.geometry && o.geometry !== shotGeo) o.geometry.dispose(); }); pool.delete(item); }
  }
  const UPV = new THREE.Vector3(0, 1, 0);

  function syncBlood(items) {
    const seen = new Set();
    for (const item of items) {
      seen.add(item);
      let group = bloodNodes.get(item);
      if (!group) {
        group = new THREE.Group();
        const red = new THREE.MeshBasicMaterial({ color: '#a91f25', transparent: true, opacity: 0.78, depthWrite: false });
        const bright = new THREE.MeshBasicMaterial({ color: '#df3832', transparent: true, opacity: 0.82, depthWrite: false });
        const scale = item.elite ? 2 : 1;
        const center = new THREE.Mesh(new THREE.CircleGeometry(0.28 * scale, 12), red); center.rotation.x = -Math.PI / 2; center.position.y = 0.035; group.add(center);
        for (let i = 0; i < 7; i++) { const drop = new THREE.Mesh(new THREE.CircleGeometry((i % 3 === 0 ? 0.085 : 0.055) * scale, 8), i % 2 ? bright : red); const a = item.seed * 0.001 + i * 2.399, r = (0.28 + ((i * 37) % 100) / 100 * 0.48) * scale; drop.rotation.x = -Math.PI / 2; drop.position.set(Math.cos(a) * r, 0.038, Math.sin(a) * r); group.add(drop); }
        bloodNodes.set(item, group); scene.add(group);
      }
      group.position.copy(actorPosition(item.x, item.y));
      const fade = Math.min(1, item.life / 2.4); group.children.forEach(mesh => { mesh.material.opacity = 0.82 * fade; });
    }
    for (const [item, group] of bloodNodes) if (!seen.has(item)) { scene.remove(group); group.traverse(obj => obj.geometry?.dispose()); bloodNodes.delete(item); }
  }

  // ------------------------------------------------------------------ one-shot FX
  function ringFx(pos, color, { from = 0.2, to = 2.5, life = 0.6, y = 0.08, width = 0.12 } = {}) {
    const mesh = new THREE.Mesh(new THREE.RingGeometry(1 - width, 1, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.6), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    mesh.rotation.x = -Math.PI / 2; mesh.position.copy(pos).setY(y); scene.add(mesh);
    activeFx.push({ life, age: 0, update(p) { mesh.scale.setScalar(from + (to - from) * p); mesh.material.opacity = 1 - p; }, dispose() { scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); } });
  }
  function pillarFx(pos, color, { height = 6, life = 0.7, radius = 0.45 } = {}) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 20, 1, true), new THREE.MeshBasicMaterial({ color, map: pillarTexture, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    mesh.position.copy(pos).setY(height / 2); scene.add(mesh);
    activeFx.push({ life, age: 0, update(p) { mesh.scale.set(1 - p * 0.85, 1, 1 - p * 0.85); mesh.material.opacity = 1 - p * p; }, dispose() { scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); } });
  }
  function handleFx(list, now, players) {
    for (const f of list) {
      if (seenFx.has(f.id)) continue;
      seenFx.add(f.id);
      if (now - f.at > 1200) continue;
      const pos = actorPosition(f.x, f.y);
      switch (f.kind) {
        case 'teleport': {
          const to = actorPosition(f.to.x, f.to.y), c = f.color || '#9d6bff';
          pillarFx(pos, c, { height: 3.5, life: 0.5, radius: 0.55 }); ringFx(pos, c, { from: 1.8, to: 0.1, life: 0.45 });
          sparks.emit({ pos: pos.clone().setY(0.8), count: 28, colors: [c, '#ffffff'], speed: 0.6, up: 4, gravity: 2, radius: 0.5, life: 0.6, size: 0.2 });
          pillarFx(to, c, { height: 3.5, life: 0.6, radius: 0.55 }); ringFx(to, c, { from: 0.1, to: 2.4, life: 0.6 }); ringFx(to, '#ffffff', { from: 0.1, to: 1.4, life: 0.4, width: 0.25 });
          sparks.emit({ pos: to.clone().setY(0.6), count: 36, colors: [c, '#ffffff', '#ff9bff'], speed: 4, up: 2, life: 0.6, size: 0.2 });
          break;
        }
        case 'pickup': { const c = DROP_STYLE[f.type]?.color || '#ffffff'; ringFx(pos, c, { to: 3, life: 0.6 }); pillarFx(pos, c, { height: 5, life: 0.5 }); sparks.emit({ pos: pos.clone().setY(0.8), count: 40, colors: [c, '#ffffff'], speed: 4, up: 4, life: 0.7, size: 0.22 }); break; }
        case 'revive': { pillarFx(pos, '#ffe36b', { height: 8, life: 1, radius: 0.8 }); ringFx(pos, '#ffe36b', { to: 3.5, life: 0.8 }); sparks.emit({ pos: pos.clone().setY(0.5), count: 60, colors: ['#ffe36b', '#ffffff'], speed: 3, up: 5, gravity: -3, life: 1, size: 0.24 }); break; }
        case 'down': { dust.emit({ pos: pos.clone().setY(0.8), count: 22, colors: ['#ffffff', '#fff3d2', players.get(f.playerId)?.color || '#ffd45d'], speed: 2.5, up: 2.5, gravity: -1.2, drag: 2.5, life: 1.6, size: 0.22 }); break; }
        case 'eliteSpawn': { const c = ELITE_STYLE[f.type]?.glow || '#ff2a3d'; ringFx(pos, c, { to: 5, life: 0.9, width: 0.2 }); ringFx(pos, c, { to: 3, life: 0.7 }); dust.emit({ pos: pos.clone().setY(0.2), count: 40, colors: ['#8b7355', '#6b5a43'], speed: 5, up: 1.5, gravity: -3, life: 0.9, size: 0.4 }); break; }
        case 'eliteDeath': { const c = ELITE_STYLE[f.type]?.color || '#ff4d5e'; ringFx(pos, c, { to: 6, life: 1, width: 0.25 }); pillarFx(pos, c, { height: 9, life: 0.9, radius: 1 }); break; }
        case 'sporeBurst': { ringFx(pos, '#d78bff', { to: 4, life: 0.6 }); dust.emit({ pos: pos.clone().setY(0.6), count: 30, colors: ['#d78bff', '#c5ff7a', '#ffd27a'], speed: 3, up: 1, gravity: 0.2, life: 1.2, size: 0.25 }); break; }
        case 'turretDeploy': { const top = new THREE.Vector3(0, houseTop, 0); ringFx(top, '#ffd34d', { to: 3, life: 0.8, y: houseTop + 0.2 }); pillarFx(new THREE.Vector3(0, 0, 0), '#ffd34d', { height: houseTop + 5, life: 0.9, radius: 0.9 }); sparks.emit({ pos: top.clone().setY(houseTop + 0.6), count: 60, colors: ['#ffd34d', '#ffffff'], speed: 4, up: 4, life: 1, size: 0.25 }); turretNode.userData.popAt = now; break; }
        case 'henHeal': { const hp = mama ? mama.position.clone() : pos; pillarFx(hp, '#ff5468', { height: 6, life: 1, radius: 1 }); ringFx(hp, '#ff8fa0', { to: 3.5, life: 0.8 }); sparks.emit({ pos: hp.clone().setY(1.5), count: 50, colors: ['#ff5468', '#ffffff', '#ffb3c0'], speed: 2.5, up: 3, gravity: -1, life: 1.2, size: 0.28 }); break; }
        case 'superLaunch': {
          // Giant egg rocket: rises from the nest, arcs over the farm and slams into the map centre.
          const from = mama ? mama.position.clone() : pos, to = actorPosition(f.to.x, f.to.y), life = (f.flight || 1800) / 1000;
          const egg = models.egg ? makeModel(models.egg, 1.6) : new THREE.Mesh(new THREE.SphereGeometry(0.6, 16, 12), new THREE.MeshStandardMaterial({ color: '#fff4dc' }));
          const holder = new THREE.Group(); holder.add(egg); egg.position.y = -0.8;
          const flame = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.4, 12), new THREE.MeshBasicMaterial({ color: '#ffb340', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })); flame.position.y = -1.4; flame.rotation.x = Math.PI; holder.add(flame);
          const glow = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), glowMat('#ffcf6b')); glow.position.y = -1.3; holder.add(glow);
          scene.add(holder);
          const prev = new THREE.Vector3();
          ringFx(from, '#ffffff', { to: 3, life: 0.5 }); dust.emit({ pos: from.clone().setY(0.3), count: 40, colors: ['#e8dcc0', '#c9b48a', '#ffffff'], speed: 4, up: 2, gravity: -2, life: 1, size: 0.4 });
          activeFx.push({ life, age: 0, update(p) {
            prev.copy(holder.position);
            holder.position.lerpVectors(from, to, p).setY(1.2 + Math.sin(p * Math.PI) * 13);
            const dir = holder.position.clone().sub(prev); if (dir.lengthSq() > 1e-6) holder.quaternion.setFromUnitVectors(UPV, dir.normalize());
            holder.rotateY(p * 12); flame.scale.y = 0.8 + Math.random() * 0.6; glow.lookAt(camera.position);
            sparks.emit({ pos: holder.position.clone(), count: 4, colors: ['#ffcf6b', '#ff7b2a', '#ffffff'], speed: 1, up: -1, gravity: -2, life: 0.5, size: 0.35 });
            dust.emit({ pos: holder.position.clone(), count: 2, colors: ['#d8d8d8', '#bdbdbd'], speed: 0.6, up: 0.2, gravity: 0.3, drag: 0.6, life: 1.6, size: 0.6 });
          }, dispose() { scene.remove(holder); } });
          break;
        }
        case 'superBoom': {
          for (const [to, life, w, c] of [[14, 1.2, 0.15, '#ffffff'], [10, 0.9, 0.25, '#ffd34d'], [6, 0.7, 0.3, '#ff7b2a']]) ringFx(pos, c, { from: 0.5, to, life, width: w });
          pillarFx(pos, '#fff3c4', { height: 16, life: 1.2, radius: 2.4 });
          sparks.emit({ pos: pos.clone().setY(1), count: 220, colors: ['#ffffff', '#ffd34d', '#ff7b2a'], speed: 12, up: 7, gravity: -6, drag: 1, life: 1.4, size: 0.45 });
          dust.emit({ pos: pos.clone().setY(0.5), count: 160, colors: ['#fff4dc', '#e8dcc0', '#f2c230'], speed: 9, up: 3, gravity: -2, drag: 1.4, life: 2, size: 0.55 });
          shake = 1;
          break;
        }
        case 'missileHit': { ringFx(pos, '#ff8a3d', { to: 1.6, life: 0.35, y: 0.3 }); sparks.emit({ pos: pos.clone().setY(0.7), count: 16, colors: ['#ffb340', '#ff7b2a', '#ffffff'], speed: 4, up: 2.5, life: 0.4, size: 0.25 }); dust.emit({ pos: pos.clone().setY(0.4), count: 6, colors: ['#9a9a9a', '#6b6b6b'], speed: 1.5, up: 1.5, gravity: -1, life: 0.8, size: 0.35 }); break; }
        case 'punch': { ringFx(pos, '#4cff4c', { from: 0.2, to: f.hits ? 1.8 : 1, life: 0.3, y: 0.2, width: 0.25 }); dust.emit({ pos: pos.clone().setY(0.3), count: f.hits ? 14 : 5, colors: ['#8b7355', '#a8916b', '#4cff4c'], speed: 3, up: 2, gravity: -6, life: 0.5, size: 0.22 }); if (f.hits) shake = Math.max(shake, 0.35); break; }
        case 'hulk': { pillarFx(pos, '#4cff4c', { height: 7, life: 0.9, radius: 0.9 }); ringFx(pos, '#4cff4c', { to: 4, life: 0.7, width: 0.25 }); sparks.emit({ pos: pos.clone().setY(0.8), count: 60, colors: ['#4cff4c', '#2f7d1f', '#ffffff'], speed: 5, up: 4, gravity: -4, life: 0.9, size: 0.28 }); shake = Math.max(shake, 0.6); break; }
        case 'hulkDash': { ringFx(pos, '#5dff3d', { from: 0.3, to: 1.6, life: 0.3, y: 0.15, width: 0.3 }); dust.emit({ pos: pos.clone().setY(0.2), count: 14, colors: ['#8b7355', '#a8916b', '#5dff3d'], speed: 2.5, up: 1.2, gravity: -5, life: 0.5, size: 0.26 }); break; }
        case 'hulkEnd': { ringFx(pos, '#9cff9c', { to: 2, life: 0.5 }); dust.emit({ pos: pos.clone().setY(0.8), count: 20, colors: ['#4cff4c', '#ffffff'], speed: 2, up: 2, gravity: -2, life: 0.8, size: 0.2 }); break; }
        case 'join': { const node = playerNodes.get(f.playerId); const p = node ? node.position.clone() : pos; dust.emit({ pos: p.clone().setY(1.6), count: 60, colors: ['#ff5e5e', '#ffd45d', '#5ec8ff', '#7be37b', '#c08bff', '#ffffff'], speed: 3, up: 4, gravity: -4, drag: 1.2, life: 1.8, size: 0.16 }); ringFx(p, players.get(f.playerId)?.color || '#ffd45d', { to: 2, life: 0.7, y: 0.35 }); break; }
        default: break;
      }
    }
    if (seenFx.size > 600) { const keep = new Set(list.map(f => f.id)); for (const id of seenFx) if (!keep.has(id)) seenFx.delete(id); }
  }
  function updateFx(dt) {
    for (let i = activeFx.length - 1; i >= 0; i--) { const f = activeFx[i]; f.age += dt; const p = Math.min(1, f.age / f.life); f.update(p); if (p >= 1) { f.dispose(); activeFx.splice(i, 1); } }
  }

  // ------------------------------------------------------------------ hen, turret, stage
  function updateHen(state, now, dt) {
    if (!mama) return;
    const model = mama.userData.model;
    const since = now - (state.henLastHit || 0), alarmed = state.henLastHit > 0 && since < 1500;
    if (state.henLastHit !== lastHenHit) {
      lastHenHit = state.henLastHit;
      if (state.henLastHit) dust.emit({ pos: mama.position.clone().setY(1.4), count: 9, colors: ['#ffffff', '#fff3d2', '#f6e7c8'], speed: 2.2, up: 2.4, gravity: -1, drag: 2.2, life: 1.5, size: 0.2 });
    }
    if (alarmed) {
      // Cluck animation: frantic hops, head-bob pitch and side wobble.
      const t = now / 1000;
      model.position.y = Math.abs(Math.sin(t * 15)) * 0.32;
      model.rotation.x = Math.sin(t * 22) * 0.18;
      model.rotation.z = Math.sin(t * 11) * 0.12;
      model.rotation.y = Math.sin(t * 5) * 0.4;
      const sq = 1 + Math.sin(t * 30) * 0.06; model.scale.set(1 / sq, sq, 1 / sq);
    } else {
      model.position.y += (0 - model.position.y) * Math.min(1, dt * 8);
      model.rotation.x = Math.sin(now / 700) * 0.04; model.rotation.z = 0; model.rotation.y = Math.sin(now / 2300) * 0.25;
      const sq = 1 + Math.sin(now / 500) * 0.015; model.scale.set(1 / sq, sq, 1 / sq);
    }
    henBubble.sprite.visible = alarmed && !state.lobby;
    if (henBubble.sprite.visible) {
      const pop = Math.min(1, since / 120), shake = Math.sin(now / 30) * 0.05;
      henBubble.sprite.position.copy(mama.position).add(new THREE.Vector3(0.6 + shake, 2.45, 0.3));
      henBubble.sprite.scale.set(2.7 * (0.6 + pop * 0.4), 1.35 * (0.6 + pop * 0.4), 1);
    }
  }
  function updateTurret(turret, now, dt) {
    if (!turretNode) return;
    const u = turretNode.userData;
    turretNode.visible = !!turret?.active;
    if (!turretNode.visible) return;
    const pop = u.popAt ? Math.min(1, (now - u.popAt) / 500) : 1;
    turretNode.scale.setScalar(0.2 + pop * 0.8 + Math.sin(pop * Math.PI) * 0.35);
    const yaw = Math.PI / 2 - turret.angle;
    u.head.rotation.y = yaw;
    u.chicken.userData.mixer?.update(dt);
    const shooting = now - (turret.shotAt || 0) < 90;
    playAction(u.chicken, shooting ? 'attack' : 'idle', 0.08);
    u.flash.visible = shooting && Math.random() < 0.85;
    if (u.flash.visible) u.flash.lookAt(camera.position);
    u.head.position.z = shooting ? -0.05 : 0;
    u.ring.material.emissiveIntensity = 1 + Math.sin(now / 200) * 0.5;
  }

  // ------------------------------------------------------------------ HUD sprites & camera
  function updateCountdown(countdown, wave) {
    if (!countdownSprite) return;
    const value = countdown > 0 ? `${wave}:${Math.ceil(countdown)}` : '';
    if (value === lastCountdown) return;
    lastCountdown = value;
    const { context: g, texture } = countdownSprite;
    g.clearRect(0, 0, 512, 128);
    if (value) {
      g.fillStyle = '#10251feb'; rounded(g, 7, 7, 498, 114, 24); g.fill(); g.strokeStyle = '#f4d579'; g.lineWidth = 5; g.stroke();
      g.fillStyle = '#f4d579'; g.font = '800 24px Bungee, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.fillText(`WAVE ${wave} · GET READY`, 256, 39);
      g.fillStyle = '#fff'; g.font = '900 63px Bungee, sans-serif'; g.fillText(String(Math.ceil(countdown)), 256, 103);
    }
    texture.needsUpdate = true;
    countdownSprite.sprite.visible = false;
  }

  function updateCamera(players, dt, lobby) {
    if (snapCam > 0) { snapCam--; dt = 1; }
    lobbyBlend += ((lobby ? 1 : 0) - lobbyBlend) * Math.min(1, dt * 2.2);
    const living = [...players.values()].filter(player => player.hp > 0);
    let cx = world.home.x, cy = world.home.y;
    if (living.length) {
      const mx = living.reduce((sum, player) => sum + player.x, 0) / living.length;
      const my = living.reduce((sum, player) => sum + player.y, 0) / living.length;
      cx = mx * 0.67 + world.home.x * 0.33; cy = my * 0.67 + world.home.y * 0.33;
    }
    let spread = Math.hypot(cx - world.home.x, cy - world.home.y) / UNIT;
    for (const player of living) spread = Math.max(spread, Math.hypot(cx - player.x, cy - player.y) / UNIT);
    const gameDistance = THREE.MathUtils.clamp((27 + spread * 1.35) * 0.76, 20.5, 42.5);
    const aspect = camera.aspect, wide = aspect > 1.2 && window.innerWidth > 950;
    const count = Math.max(1, players.size), lobbyDistance = 21 + Math.min(8, Math.max(0, count - 4) * 0.9) + (aspect < 1 ? 8 : 0);
    const targetDistance = THREE.MathUtils.lerp(gameDistance, lobbyDistance, lobbyBlend);
    cameraDistance += (targetDistance - cameraDistance) * Math.min(1, dt * 1.6);
    const gameTarget = actorPosition(cx, cy, 0.8);
    const lobbyTarget = stage ? stage.position.clone().add(new THREE.Vector3(wide ? -cameraDistance * 0.3 : 0, 1.0, -0.6)) : gameTarget;
    const desired = gameTarget.lerp(lobbyTarget, lobbyBlend);
    if (focusCam) { desired.copy(actorPosition(focusCam.x, focusCam.y, 0.8)); cameraDistance = focusCam.d; }
    target.lerp(desired, Math.min(1, dt * 2.5));
    const up = THREE.MathUtils.lerp(0.78, 0.5, lobbyBlend), back = THREE.MathUtils.lerp(0.62, 0.86, lobbyBlend);
    camera.position.set(target.x, target.y + cameraDistance * up, target.z + cameraDistance * back);
    camera.lookAt(target);
    if (shake > 0) { shake = Math.max(0, shake - dt * 1.4); camera.position.x += (Math.random() - 0.5) * shake * 0.9; camera.position.y += (Math.random() - 0.5) * shake * 0.9; }
  }

  function resize() {
    const width = canvas.clientWidth || window.innerWidth, height = canvas.clientHeight || window.innerHeight;
    renderer.setSize(width, height, false);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(width, height);
    camera.aspect = width / Math.max(1, height);
    camera.updateProjectionMatrix();
    const scale = height * renderer.getPixelRatio() / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    sparks.uniforms.uScale.value = dust.uniforms.uScale.value = scale;
  }
  window.addEventListener('resize', resize);
  resize();
  window.__r3d = { renderer, composer, scene, camera, bloom, snap: () => { snapCam = 3; }, focus: (x, y, d) => { focusCam = x == null ? null : { x, y, d }; snapCam = 3; } };
  const readyPromise = loadModels();
  let slowFrames = 0, postFx = new URLSearchParams(location.search).get('fx') === '1';

  return {
    ready: readyPromise,
    resize,
    render(state, dt, now) {
      time.value = now / 1000;
      if (ready) {
        syncPlayers(state.players, now, dt, state);
        syncEnemies(state.enemies, now, dt);
        syncProjectiles('shot', state.shots, projectileNodes, now);
        syncProjectiles('fireball', state.fireballs, fireballNodes, now);
        syncDrops(state.drops, now, dt);
        syncProjectiles('beam', state.enemyBeams, beamNodes, now);
        syncBlood(state.bloodSplats || []);
        handleFx(state.fx || [], now, state.players);
        updateFx(dt);
        sparks.update(dt); dust.update(dt);
        const henFlash = state.henLastHit > 0 && now - state.henLastHit < 500;
        updateFarmBar(state.farmHp, henFlash, now);
        updateHen(state, now, dt);
        updateTurret(state.turret, now, dt);
        if (stage) { stage.visible = lobbyBlend > 0.05; stage.children.forEach(c => { if (c.geometry?.type === 'CylinderGeometry' && c.material?.blending === THREE.AdditiveBlending) c.material.opacity = 0.25 + Math.sin(now / 400 + c.position.x) * 0.1; }); }
        farmBar.sprite.visible = !state.lobby;
        { const on = !!state.turret?.active, wy = on ? houseTop + 0.55 : houseTop + 1.25, wx = on ? 4.3 : 0, k = Math.min(1, dt * 4); farmBar.sprite.position.y += (wy - farmBar.sprite.position.y) * k; farmBar.sprite.position.x += (wx - farmBar.sprite.position.x) * k; }
        if (battleFogMesh) battleFogMesh.visible = lobbyBlend < 0.5;
        updateCountdown(state.countdown, state.wave);
        updateCamera(state.players, dt, !!state.lobby);
      }
      // Bloom is dropped automatically on slow machines.
      if (dt > 0.045) slowFrames++; else slowFrames = Math.max(0, slowFrames - 1);
      if (slowFrames > 90 && postFx) { postFx = false; console.info('Bloom disabled for performance'); }
      if (postFx) composer.render();
      if (!postFx) renderer.render(scene, camera);
    }
  };
}
