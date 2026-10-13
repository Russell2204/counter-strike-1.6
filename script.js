'use strict';

/* ==========================================================
   Counter-Strike 1.6 — Web Edition (Animated + Jump + Enemy Guns)
   script.js
   ========================================================== */

/* ---------------- Константы ---------------- */
const ARENA_HALF    = 22;
const HIGHSCORE_KEY = 'cs16_web_highscore_v1';
const MAX_ALIVE     = 5;
const PLAYER_HEIGHT = 1.7;
const PLAYER_RADIUS = 0.4;
const MOUSE_SENS    = 0.0022;
const MAX_DECALS    = 40;

const ENEMY_AIM_BASE      = -0.32;   // базовый наклон правой руки (вперёд)
const ENEMY_GUN_KICK_TIME = 0.14;    // длительность отдачи оружия врага
const ENEMY_MUZZLE_TIME   = 0.055;   // длительность вспышки

/* ---------------- Состояние ---------------- */
let scene, camera, renderer, clock, raycaster, canvas;

let yaw = 0;
let pitch = 0;
let pointerLocked = false;
let gameState = 'menu'; // menu | playing | paused | gameover

const keys = {};
const colliders = [];
const obstacles = [];
const enemies = [];
const enemyMeshes = [];
const tracers = [];
const decals = [];
const impacts = [];

/* --- Оружие игрока --- */
let gunModel = null;
let gunMagazine = null;
let gunMuzzleFlash = null;
let gunMuzzleLight = null;
let muzzleTimer = 0;
let gunBaseZ = -0.55;
let gunKick = 0;
let bobTime = 0;
let firing = false;
let shootCooldown = 0;
let bannerTimer = 0;
let hitmarkerTimeout = null;
let camShake = 0;
let drawAnim = 0;
let crosshairSpread = 0;
let landBob = 0;

/* --- Раунды --- */
let round = 1;
let enemiesToSpawn = 0;
let spawnTimer = 0;
let roundEndTimer = null;

/* --- Аудио --- */
let audioCtx = null;

/* --- Общая текстура вспышки для врагов --- */
let enemyFlashTexture = null;

const MAG_BASE = { x: 0, y: -0.19, z: -0.02, rotX: 0.18 };
const ENEMY_GUN_BASE = { x: 0.1, y: -0.55, z: 0.05, rotX: -0.05, rotY: Math.PI };

/* ---------------- Игрок ---------------- */
const player = {
  pos: null,
  velY: 0,
  isGrounded: true,
  jumpSpeed: 7.2,
  gravity: 22,
  health: 100,
  ammo: 30,
  magSize: 30,
  reserve: 90,
  score: 0,
  kills: 0,
  headshots: 0,
  reloading: false,
  reloadTimer: 0,
  reloadDuration: 1.8,
  speed: 6.2
};

/* ---------------- UI ---------------- */
const UI = {};

function cacheUI() {
  UI.hud          = document.getElementById('hud');
  UI.health       = document.getElementById('health-value');
  UI.healthBar    = document.getElementById('health-bar-fill');
  UI.healthIcon   = document.querySelector('.health-icon');
  UI.ammo         = document.getElementById('ammo-value');
  UI.ammoBox      = document.getElementById('hud-bottom-right');
  UI.reserve      = document.getElementById('reserve-value');
  UI.score        = document.getElementById('score-value');
  UI.round        = document.getElementById('round-value');
  UI.enemies      = document.getElementById('enemies-value');
  UI.highscore    = document.getElementById('highscore-value');
  UI.hitmarker    = document.getElementById('hitmarker');
  UI.damageFlash  = document.getElementById('damage-flash');
  UI.banner       = document.getElementById('banner');
  UI.reloadHint   = document.getElementById('reload-hint');
  UI.menu         = document.getElementById('menu');
  UI.pause        = document.getElementById('pause');
  UI.gameover     = document.getElementById('gameover');
  UI.menuHighscore = document.getElementById('menu-highscore');
  UI.crosshair    = document.getElementById('crosshair');
  UI.scoreBox     = UI.score.parentElement;
  UI.roundBox     = UI.round.parentElement;
  UI.enemiesBox   = UI.enemies.parentElement;
}

/* ==========================================================
   АУДИО
   ========================================================== */
function initAudio() {
  if (audioCtx) return;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  } catch (e) { audioCtx = null; }
}

function playTone(freq, dur, type, vol, slideTo) {
  if (!audioCtx) return;
  try {
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type || 'square';
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    gain.gain.setValueAtTime(vol || 0.05, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + dur);
  } catch (e) {}
}

const SFX = {
  shoot:      () => playTone(240, 0.08, 'square',   0.05, 70),
  enemyShoot: () => playTone(150, 0.09, 'sawtooth', 0.025, 60),
  hit:        () => playTone(950, 0.05, 'sine',     0.05),
  headshot:   () => playTone(1400, 0.09, 'sine',    0.06, 700),
  kill:       () => playTone(620, 0.16, 'sine',     0.06, 1200),
  reload:     () => playTone(320, 0.09, 'triangle', 0.04),
  hurt:       () => playTone(130, 0.22, 'sawtooth', 0.06, 60),
  empty:      () => playTone(90,  0.05, 'square',   0.03),
  jump:       () => playTone(220, 0.09, 'sine',     0.035, 420),
  land:       () => playTone(95,  0.09, 'triangle', 0.05, 45)
};

/* ==========================================================
   РЕКОРДЫ
   ========================================================== */
function getHighScore() {
  const v = parseInt(localStorage.getItem(HIGHSCORE_KEY) || '0', 10);
  return isNaN(v) ? 0 : v;
}
function setHighScore(v) {
  try { localStorage.setItem(HIGHSCORE_KEY, String(v)); } catch (e) {}
}
function checkHighScore() {
  const cur = getHighScore();
  if (player.score > cur) { setHighScore(player.score); return true; }
  return false;
}

/* ==========================================================
   ПРОЦЕДУРНЫЕ ТЕКСТУРЫ
   ========================================================== */
function createCanvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

function makeAsphaltTexture() {
  const S = 512;
  const c = createCanvas(S);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#4a4742';
  ctx.fillRect(0, 0, S, S);

  for (let i = 0; i < 260; i++) {
    const r = 6 + Math.random() * 40;
    const g = 40 + Math.random() * 40;
    ctx.beginPath();
    ctx.fillStyle = `rgba(${g + 8},${g + 4},${g},${0.10 + Math.random() * 0.12})`;
    ctx.arc(Math.random() * S, Math.random() * S, r, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 26000; i++) {
    const v = 40 + Math.random() * 90;
    ctx.fillStyle = `rgba(${v},${v - 4},${v - 10},${Math.random() * 0.45})`;
    ctx.fillRect(Math.random() * S, Math.random() * S, 1 + Math.random() * 1.6, 1 + Math.random() * 1.6);
  }
  ctx.strokeStyle = 'rgba(20,18,15,0.55)';
  for (let i = 0; i < 10; i++) {
    ctx.beginPath();
    let x = Math.random() * S, y = Math.random() * S;
    ctx.moveTo(x, y);
    for (let j = 0; j < 14; j++) {
      x += (Math.random() - 0.5) * 55;
      y += (Math.random() - 0.5) * 55;
      ctx.lineTo(x, y);
    }
    ctx.lineWidth = 0.4 + Math.random() * 1.1;
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function makeConcreteTexture() {
  const S = 512;
  const c = createCanvas(S);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#9a938a';
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 140; i++) {
    const r = 10 + Math.random() * 55;
    const t = 130 + Math.random() * 50;
    ctx.beginPath();
    ctx.fillStyle = `rgba(${t},${t - 6},${t - 14},0.14)`;
    ctx.arc(Math.random() * S, Math.random() * S, r, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 22000; i++) {
    const v = 130 + Math.random() * 60;
    ctx.fillStyle = `rgba(${v},${v - 6},${v - 14},${Math.random() * 0.35})`;
    ctx.fillRect(Math.random() * S, Math.random() * S, 1, 1);
  }
  for (let i = 0; i < 22; i++) {
    const x = Math.random() * S;
    const h = 80 + Math.random() * 240;
    const grad = ctx.createLinearGradient(x, 0, x, h);
    grad.addColorStop(0, 'rgba(60,55,48,0.0)');
    grad.addColorStop(1, `rgba(60,55,48,${0.10 + Math.random() * 0.18})`);
    ctx.fillStyle = grad;
    ctx.fillRect(x, 0, 2 + Math.random() * 4, h);
  }
  ctx.strokeStyle = 'rgba(50,45,40,0.35)';
  ctx.lineWidth = 2;
  for (let y = 0; y < S; y += 128) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(S, y); ctx.stroke(); }
  for (let x = 0; x < S; x += 256) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, S); ctx.stroke(); }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function makeWoodTexture(baseHue) {
  const S = 512;
  const c = createCanvas(S);
  const ctx = c.getContext('2d');
  ctx.fillStyle = baseHue;
  ctx.fillRect(0, 0, S, S);
  const plankW = 64;
  for (let x = 0; x < S; x += plankW) {
    const shade = (Math.random() - 0.5) * 26;
    ctx.fillStyle = `rgba(${shade > 0 ? 255 : 0},${shade > 0 ? 230 : 0},${shade > 0 ? 180 : 0},${Math.abs(shade) / 255})`;
    ctx.fillRect(x, 0, plankW, S);
    ctx.fillStyle = 'rgba(30,18,10,0.55)';
    ctx.fillRect(x, 0, 2, S);
    for (let i = 0; i < 60; i++) {
      const y = Math.random() * S;
      const w = 8 + Math.random() * (plankW - 10);
      ctx.strokeStyle = `rgba(50,30,15,${0.05 + Math.random() * 0.18})`;
      ctx.lineWidth = 0.6 + Math.random() * 1.2;
      ctx.beginPath();
      ctx.moveTo(x + 4, y);
      ctx.bezierCurveTo(
        x + 4 + w * 0.3, y + (Math.random() - 0.5) * 8,
        x + 4 + w * 0.7, y + (Math.random() - 0.5) * 8,
        x + 4 + w, y + (Math.random() - 0.5) * 5
      );
      ctx.stroke();
    }
  }
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(20,10,5,${0.04 + Math.random() * 0.14})`;
    ctx.beginPath();
    ctx.arc(Math.random() * S, Math.random() * S, 4 + Math.random() * 20, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function makeNoiseBump(intensity) {
  const S = 256;
  const c = createCanvas(S);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = 128 + (Math.random() - 0.5) * intensity;
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/* --- Общая текстура вспышки для врагов --- */
function getEnemyFlashTexture() {
  if (enemyFlashTexture) return enemyFlashTexture;
  const c = createCanvas(64);
  const ctx = c.getContext('2d');
  const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,255,220,1)');
  grad.addColorStop(0.4, 'rgba(255,200,80,0.9)');
  grad.addColorStop(1, 'rgba(255,140,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  enemyFlashTexture = new THREE.CanvasTexture(c);
  return enemyFlashTexture;
}

/* ==========================================================
   ИНИЦИАЛИЗАЦИЯ
   ========================================================== */
function init() {
  cacheUI();
  canvas = document.getElementById('game-canvas');

  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x9aacb8, 0.014);

  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 500);
  camera.rotation.order = 'YXZ';
  scene.add(camera);

  player.pos = new THREE.Vector3(0, PLAYER_HEIGHT, 14);
  camera.position.copy(player.pos);

  renderer = new THREE.WebGLRenderer({
    canvas: canvas,
    antialias: true,
    powerPreference: 'high-performance'
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.outputEncoding = THREE.sRGBEncoding;

  clock = new THREE.Clock();
  raycaster = new THREE.Raycaster();

  addSky();
  addLights();
  buildMap();
  createViewModel();

  bindEvents();
  updateHUD();

  UI.menuHighscore.textContent = getHighScore();
  animate();
}

function addSky() {
  const skyGeo = new THREE.SphereGeometry(240, 32, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: {
      topColor:    { value: new THREE.Color(0x2b5b9c) },
      midColor:    { value: new THREE.Color(0x89a9c7) },
      bottomColor: { value: new THREE.Color(0xd9d2be) },
      offset:      { value: 40.0 },
      exponent:    { value: 0.65 }
    },
    vertexShader: `
      varying vec3 vWorldPosition;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPosition = wp.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topColor; uniform vec3 midColor; uniform vec3 bottomColor;
      uniform float offset; uniform float exponent;
      varying vec3 vWorldPosition;
      void main() {
        float h = normalize(vWorldPosition + vec3(0.0, offset, 0.0)).y;
        float t = pow(max(h, 0.0), exponent);
        vec3 lowMid = mix(bottomColor, midColor, smoothstep(0.0, 0.25, t));
        vec3 col = mix(lowMid, topColor, smoothstep(0.25, 1.0, t));
        gl_FragColor = vec4(col, 1.0);
      }
    `
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));
}

function addLights() {
  scene.add(new THREE.HemisphereLight(0xdfe9f5, 0x5c5040, 0.75));
  const sun = new THREE.DirectionalLight(0xfff2d4, 1.35);
  sun.position.set(34, 46, 22);
  sun.castShadow = true;
  sun.shadow.mapSize.width = 2048;
  sun.shadow.mapSize.height = 2048;
  sun.shadow.camera.left = -40; sun.shadow.camera.right = 40;
  sun.shadow.camera.top = 40;  sun.shadow.camera.bottom = -40;
  sun.shadow.camera.near = 1;  sun.shadow.camera.far = 140;
  sun.shadow.bias = -0.0005;   sun.shadow.normalBias = 0.02;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xa8c4e8, 0.35);
  fill.position.set(-26, 20, -26);
  scene.add(fill);
}

function addBox(x, y, z, w, h, d, opts) {
  opts = opts || {};
  const texture = opts.texture || null;
  const color = opts.color !== undefined ? opts.color : 0xffffff;
  const collide = opts.collide !== false;

  let mat;
  if (texture) {
    mat = new THREE.MeshStandardMaterial({
      map: texture,
      color: color,
      roughness: opts.roughness !== undefined ? opts.roughness : 0.92,
      metalness: opts.metalness !== undefined ? opts.metalness : 0.02,
      bumpMap: opts.bump || null,
      bumpScale: opts.bumpScale !== undefined ? opts.bumpScale : 0.02
    });
  } else {
    mat = new THREE.MeshStandardMaterial({
      color: color,
      roughness: opts.roughness !== undefined ? opts.roughness : 0.85,
      metalness: opts.metalness !== undefined ? opts.metalness : 0.05
    });
  }

  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  obstacles.push(mesh);

  if (collide) {
    colliders.push({
      minX: x - w / 2, maxX: x + w / 2,
      minZ: z - d / 2, maxZ: z + d / 2
    });
  }
  return mesh;
}

function buildMap() {
  const asphaltTex = makeAsphaltTexture();
  const concreteTex = makeConcreteTexture();
  const woodTex1 = makeWoodTexture('#8a5f36');
  const woodTex2 = makeWoodTexture('#7a5230');
  const woodTex3 = makeWoodTexture('#9a6b3c');
  const bump = makeNoiseBump(140);

  const groundTex = asphaltTex.clone(); groundTex.needsUpdate = true;
  groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping;
  groundTex.repeat.set(10, 10);

  const groundBump = bump.clone(); groundBump.needsUpdate = true;
  groundBump.wrapS = groundBump.wrapT = THREE.RepeatWrapping;
  groundBump.repeat.set(10, 10);

  const groundMat = new THREE.MeshStandardMaterial({
    map: groundTex, bumpMap: groundBump, bumpScale: 0.03,
    roughness: 0.96, metalness: 0.05
  });
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(ARENA_HALF * 2 + 14, ARENA_HALF * 2 + 14),
    groundMat
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new THREE.GridHelper(ARENA_HALF * 2, 22, 0x2a2622, 0x2a2622);
  grid.position.y = 0.015;
  grid.material.opacity = 0.18;
  grid.material.transparent = true;
  scene.add(grid);

  const wallH = 5.5, wallT = 1;
  addBox(0, wallH / 2, -ARENA_HALF, ARENA_HALF * 2 + wallT, wallH, wallT, {
    texture: concreteTex, color: 0xbcb5a8, roughness: 0.95, metalness: 0.02
  });
  addBox(0, wallH / 2,  ARENA_HALF, ARENA_HALF * 2 + wallT, wallH, wallT, {
    texture: concreteTex, color: 0xbcb5a8, roughness: 0.95, metalness: 0.02
  });
  addBox(-ARENA_HALF, wallH / 2, 0, wallT, wallH, ARENA_HALF * 2 + wallT, {
    texture: concreteTex, color: 0xbcb5a8, roughness: 0.95, metalness: 0.02
  });
  addBox( ARENA_HALF, wallH / 2, 0, wallT, wallH, ARENA_HALF * 2 + wallT, {
    texture: concreteTex, color: 0xbcb5a8, roughness: 0.95, metalness: 0.02
  });

  const crates = [
    [-9,   -7,   2.6, 2.6, 2.2, woodTex1],
    [ 8,   -9,   3.2, 3.2, 2.6, woodTex2],
    [-13,   7,   2.2, 2.2, 2.0, woodTex3],
    [ 11,   9,   2.8, 2.8, 2.4, woodTex1],
    [  0,  -15,   7.0, 2.0, 2.2, woodTex2],
    [ -6,  15,   2.0, 4.0, 2.2, woodTex1],
    [ 15,  -3,   2.0, 5.0, 2.6, woodTex3],
    [-17, -13,   3.0, 3.0, 3.0, woodTex2],
    [ 17,  16,   3.4, 3.4, 2.8, woodTex1],
    [-18,  17,   2.4, 2.4, 2.2, woodTex3],
    [  6,   2,   2.0, 2.0, 1.4, woodTex2],
    [ -4,  -2,   2.0, 2.0, 1.4, woodTex1],
    [ 16,   3,   2.0, 2.0, 1.6, woodTex3],
    [-16,  -3,   2.0, 2.0, 1.6, woodTex2]
  ];
  for (let i = 0; i < crates.length; i++) {
    const c = crates[i];
    addBox(c[0], c[4] / 2, c[1], c[2], c[4], c[3], {
      texture: c[5], color: 0xffffff, roughness: 0.88, metalness: 0.02,
      bump: bump, bumpScale: 0.015
    });
  }

  const barrelPositions = [[-11, 12], [12, -14], [-19, -6], [19, 6], [3, -18]];
  const barrelMat = new THREE.MeshStandardMaterial({ color: 0x4a6b3a, roughness: 0.55, metalness: 0.65 });
  for (let i = 0; i < barrelPositions.length; i++) {
    const bp = barrelPositions[i];
    const bMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.15, 20), barrelMat);
    bMesh.position.set(bp[0], 0.575, bp[1]);
    bMesh.castShadow = true; bMesh.receiveShadow = true;
    scene.add(bMesh);
    colliders.push({ minX: bp[0] - 0.5, maxX: bp[0] + 0.5, minZ: bp[1] - 0.5, maxZ: bp[1] + 0.5 });
    obstacles.push(bMesh);
  }
}

/* ---------------- Модель оружия игрока ---------------- */
function createViewModel() {
  const gun = new THREE.Group();

  const darkMat  = new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.5, metalness: 0.85 });
  const metalMat = new THREE.MeshStandardMaterial({ color: 0x3a3e45, roughness: 0.35, metalness: 0.95 });
  const woodMat  = new THREE.MeshStandardMaterial({ color: 0x5a3a1e, roughness: 0.7, metalness: 0.05 });
  const blackMat = new THREE.MeshStandardMaterial({ color: 0x101216, roughness: 0.75, metalness: 0.3 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.16, 0.66), darkMat);
  body.position.set(0, 0, -0.08); gun.add(body);

  const upper = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.06, 0.55), metalMat);
  upper.position.set(0, 0.10, -0.20); gun.add(upper);

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.5, 14), metalMat);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.03, -0.58); gun.add(barrel);

  const flashHider = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.032, 0.09, 14), blackMat);
  flashHider.rotation.x = Math.PI / 2;
  flashHider.position.set(0, 0.03, -0.83); gun.add(flashHider);

  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.26, 0.14), metalMat);
  mag.position.set(MAG_BASE.x, MAG_BASE.y, MAG_BASE.z);
  mag.rotation.x = MAG_BASE.rotX;
  gun.add(mag);
  gunMagazine = mag;

  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.22, 0.12), blackMat);
  grip.position.set(0, -0.17, 0.19); grip.rotation.x = -0.34; gun.add(grip);

  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 0.32), woodMat);
  stock.position.set(0, -0.02, 0.38); gun.add(stock);

  const handguard = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.09, 0.32), woodMat);
  handguard.position.set(0, -0.02, -0.42); gun.add(handguard);

  const rail = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.014, 0.5), blackMat);
  rail.position.set(0, 0.135, -0.20); gun.add(rail);

  const frontSight = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.05, 0.022), metalMat);
  frontSight.position.set(0, 0.16, -0.72); gun.add(frontSight);

  const rearSight = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.02), metalMat);
  rearSight.position.set(0, 0.155, 0.02); gun.add(rearSight);

  const triggerGuard = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.02, 0.1), blackMat);
  triggerGuard.position.set(0, -0.09, 0.05); gun.add(triggerGuard);

  const flashCanvas = createCanvas(64);
  const fctx = flashCanvas.getContext('2d');
  const grad = fctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,255,220,1)');
  grad.addColorStop(0.4, 'rgba(255,200,80,0.9)');
  grad.addColorStop(1, 'rgba(255,140,0,0)');
  fctx.fillStyle = grad;
  fctx.fillRect(0, 0, 64, 64);
  const flashTex = new THREE.CanvasTexture(flashCanvas);
  const flashMat = new THREE.MeshBasicMaterial({
    map: flashTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0
  });
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 0.35), flashMat);
  flash.position.set(0, 0.03, -0.9);
  gun.add(flash);
  gunMuzzleFlash = flash;

  const muzzleLight = new THREE.PointLight(0xffcc66, 0, 6, 2);
  muzzleLight.position.set(0, 0.03, -0.85);
  gun.add(muzzleLight);
  gunMuzzleLight = muzzleLight;

  gun.position.set(0.26, -0.25, gunBaseZ);
  gun.rotation.y = 0.03;
  camera.add(gun);
  gunModel = gun;
}

/* ==========================================================
   УПРАВЛЕНИЕ
   ========================================================== */
function bindEvents() {
  window.addEventListener('resize', onResize);

  window.addEventListener('keydown', function (e) {
    keys[e.code] = true;
    if (e.code === 'KeyR') startReload();
    if (e.code === 'Space') {
      e.preventDefault();
      if (!e.repeat) tryJump();
    }
  });

  window.addEventListener('keyup', function (e) { keys[e.code] = false; });

  document.addEventListener('mousemove', function (e) {
    if (!pointerLocked || gameState !== 'playing') return;
    yaw   -= e.movementX * MOUSE_SENS;
    pitch -= e.movementY * MOUSE_SENS;
    const limit = Math.PI / 2 - 0.02;
    if (pitch >  limit) pitch =  limit;
    if (pitch < -limit) pitch = -limit;
  });

  document.addEventListener('mousedown', function (e) {
    if (e.button !== 0) return;
    if (gameState !== 'playing' || !pointerLocked) return;
    firing = true;
    if (shootCooldown <= 0 && !player.reloading) shoot();
  });
  document.addEventListener('mouseup', function (e) {
    if (e.button !== 0) return;
    firing = false;
  });

  canvas.addEventListener('click', function () {
    if (gameState === 'playing' && !pointerLocked) requestLock();
  });

  document.addEventListener('pointerlockchange', function () {
    pointerLocked = (document.pointerLockElement === canvas);
    if (!pointerLocked && gameState === 'playing') {
      gameState = 'paused';
      firing = false;
      UI.pause.classList.remove('hidden');
    }
  });

  document.getElementById('start-btn').addEventListener('click', function () {
    initAudio(); startGame();
  });
  document.getElementById('restart-btn').addEventListener('click', function () {
    initAudio(); startGame();
  });
  document.getElementById('resume-btn').addEventListener('click', function () {
    if (gameState !== 'paused') return;
    UI.pause.classList.add('hidden');
    gameState = 'playing';
    requestLock();
  });
  document.getElementById('menu-btn').addEventListener('click', toMenu);
  document.getElementById('to-menu-btn').addEventListener('click', toMenu);
}

function tryJump() {
  if (gameState !== 'playing') return;
  if (!player.isGrounded) return;
  player.velY = player.jumpSpeed;
  player.isGrounded = false;
  SFX.jump();
  camShake = Math.min(0.35, camShake + 0.1);
}

function requestLock() {
  try {
    const p = canvas.requestPointerLock();
    if (p && typeof p.catch === 'function') p.catch(function () {});
  } catch (e) {}
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

/* ==========================================================
   ИГРОВОЙ ЦИКЛ
   ========================================================== */
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  if (gameState === 'playing') {
    updatePlayer(dt);
    updateEnemies(dt);
    updateRoundLogic(dt);
    updateBanner(dt);
    updateDamageFlash(dt);
  }

  updateTracers(dt);
  updateImpacts(dt);
  updateViewModel(dt);
  updateMuzzleFlash(dt);
  updateCrosshair(dt);

  renderer.render(scene, camera);
}

/* ---------------- Игрок ---------------- */
function updatePlayer(dt) {
  if (shootCooldown > 0) shootCooldown -= dt;

  if (player.reloading) {
    player.reloadTimer -= dt;
    if (player.reloadTimer <= 0) finishReload();
  }

  let mx = 0, mz = 0;
  if (keys['KeyW'] || keys['ArrowUp'])    mz += 1;
  if (keys['KeyS'] || keys['ArrowDown'])  mz -= 1;
  if (keys['KeyA'] || keys['ArrowLeft'])  mx -= 1;
  if (keys['KeyD'] || keys['ArrowRight']) mx += 1;

  const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const right   = new THREE.Vector3( Math.cos(yaw), 0, -Math.sin(yaw));

  const move = new THREE.Vector3();
  move.addScaledVector(forward, mz);
  move.addScaledVector(right, mx);

  const moving = move.lengthSq() > 0.0001;
  if (moving) move.normalize();

  const moveMult = player.isGrounded ? 1.0 : 0.82;
  const step = player.speed * moveMult * dt;

  const nx = player.pos.x + move.x * step;
  const nz = player.pos.z + move.z * step;

  if (!collides(nx, player.pos.z, PLAYER_RADIUS)) player.pos.x = nx;
  if (!collides(player.pos.x, nz, PLAYER_RADIUS)) player.pos.z = nz;

  // Физика прыжка
  if (!player.isGrounded) {
    player.velY -= player.gravity * dt;
    player.pos.y += player.velY * dt;

    if (player.pos.y <= PLAYER_HEIGHT) {
      const impact = Math.abs(player.velY);
      player.pos.y = PLAYER_HEIGHT;
      player.velY = 0;
      player.isGrounded = true;

      if (impact > 2.0) {
        camShake = Math.min(0.55, camShake + impact * 0.055);
        landBob = Math.min(0.13, impact * 0.02);
        SFX.land();
      }
    }
  }

  if (landBob > 0) {
    landBob = Math.max(0, landBob - dt * 0.55);
  }

  // Анимация камеры
  const canBob = player.isGrounded;
  if (moving && canBob) bobTime += dt * 9.5;
  else if (canBob)      bobTime += dt * 2.0;

  const bobY    = (moving && canBob) ? Math.sin(bobTime) * 0.045 : 0;
  const bobX    = (moving && canBob) ? Math.cos(bobTime * 0.5) * 0.025 : 0;
  const bobRoll = (moving && canBob) ? Math.sin(bobTime * 0.5) * 0.008 : 0;

  const bobRight = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const camOffX = bobRight.x * bobX;
  const camOffZ = bobRight.z * bobX;

  let shakeX = 0, shakeY = 0, shakeZ = 0, shakeRoll = 0;
  if (camShake > 0) {
    camShake -= dt * 1.5;
    const inten = Math.max(0, camShake) * 0.15;
    shakeX = (Math.random() - 0.5) * inten;
    shakeY = (Math.random() - 0.5) * inten;
    shakeZ = (Math.random() - 0.5) * inten;
    shakeRoll = (Math.random() - 0.5) * inten * 0.4;
  }

  camera.position.set(
    player.pos.x + camOffX + shakeX,
    player.pos.y + bobY + shakeY - landBob,
    player.pos.z + camOffZ + shakeZ
  );
  camera.rotation.set(pitch, yaw, bobRoll + shakeRoll);

  if (firing && shootCooldown <= 0 && !player.reloading) shoot();

  if (player.ammo === 0 && !player.reloading && player.reserve > 0) {
    UI.reloadHint.classList.remove('hidden');
  } else {
    UI.reloadHint.classList.add('hidden');
  }
}

function collides(x, z, r) {
  if (Math.abs(x) > ARENA_HALF - r || Math.abs(z) > ARENA_HALF - r) return true;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    if (x + r > c.minX && x - r < c.maxX && z + r > c.minZ && z - r < c.maxZ) return true;
  }
  return false;
}

/* ---------------- Стрельба игрока ---------------- */
function shoot() {
  if (gameState !== 'playing') return;
  if (player.reloading) return;
  if (shootCooldown > 0) return;

  if (player.ammo <= 0) {
    SFX.empty();
    shootCooldown = 0.25;
    startReload();
    return;
  }

  shootCooldown = 0.1;
  player.ammo--;
  SFX.shoot();

  gunKick = 0.085;
  muzzleTimer = 0.05;
  if (gunMuzzleLight) gunMuzzleLight.intensity = 3.5;
  if (gunMuzzleFlash) gunMuzzleFlash.material.opacity = 1.0;

  crosshairSpread = 1.0;
  UI.ammoBox.classList.add('shoot');
  setTimeout(function () { UI.ammoBox.classList.remove('shoot'); }, 100);

  const origin = new THREE.Vector3();
  camera.getWorldPosition(origin);
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);

  const baseSpread = player.isGrounded ? 0.017 : 0.055;
  dir.x += (Math.random() - 0.5) * baseSpread;
  dir.y += (Math.random() - 0.5) * baseSpread;
  dir.z += (Math.random() - 0.5) * baseSpread;
  dir.normalize();

  raycaster.set(origin, dir);
  raycaster.far = 220;

  const enemyHits = raycaster.intersectObjects(enemyMeshes, false);
  const wallHits  = raycaster.intersectObjects(obstacles, false);
  const wallDist = wallHits.length > 0 ? wallHits[0].distance : Infinity;

  let hitPoint = origin.clone().addScaledVector(dir, Math.min(wallDist, 120));

  if (enemyHits.length > 0 && enemyHits[0].distance < wallDist) {
    const hit = enemyHits[0];
    hitPoint = hit.point.clone();
    const enemy = hit.object.userData.enemyRef;
    const isHead = hit.object.userData.part === 'head';
    spawnBloodSpray(hitPoint, dir);
    if (enemy && !enemy.dead) damageEnemy(enemy, isHead);
  } else if (wallHits.length > 0) {
    const wallHit = wallHits[0];
    hitPoint = wallHit.point.clone();
    spawnSparks(hitPoint, wallHit.face ? wallHit.face.normal : null, wallHit.object);
    createDecal(hitPoint, wallHit);
  }

  const muzzle = origin.clone().addScaledVector(dir, 0.75);
  muzzle.y -= 0.12;
  addTracer(muzzle, hitPoint, 0xfff0a0);

  spawnPlayerShell(origin, dir);

  updateHUD();
}

function spawnPlayerShell(origin, dir) {
  const shell = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.014, 0.045, 8),
    new THREE.MeshStandardMaterial({ color: 0xd4a640, metalness: 0.9, roughness: 0.3 })
  );
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  shell.position.copy(origin).addScaledVector(right, 0.35);
  shell.position.y -= 0.15;
  shell.rotation.z = Math.PI / 2;
  scene.add(shell);

  const vel = right.clone().multiplyScalar(1.8 + Math.random() * 1.2);
  vel.y = 2.4 + Math.random() * 1.2;
  vel.addScaledVector(dir, 0.4);

  impacts.push({
    mesh: shell,
    vel: vel,
    life: 1.6, maxLife: 1.6,
    gravity: true,
    type: 'shell',
    angular: new THREE.Vector3((Math.random() - 0.5) * 22, (Math.random() - 0.5) * 22, (Math.random() - 0.5) * 22)
  });
}

function spawnEnemyShell(enemy) {
  if (!enemy || !enemy.limbs.gunMuzzleFlash) return;

  const shellPos = new THREE.Vector3();
  enemy.limbs.gunMuzzleFlash.getWorldPosition(shellPos);

  const yawE = enemy.group.rotation.y;
  const rightWorld   = new THREE.Vector3(Math.cos(yawE), 0, -Math.sin(yawE));
  const forwardWorld = new THREE.Vector3(Math.sin(yawE), 0,  Math.cos(yawE));

  // Слегка назад к телу
  shellPos.addScaledVector(forwardWorld, -0.12);
  shellPos.y += 0.06;

  const shell = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.014, 0.045, 8),
    new THREE.MeshStandardMaterial({ color: 0xd4a640, metalness: 0.9, roughness: 0.3 })
  );
  shell.position.copy(shellPos);
  shell.rotation.z = Math.PI / 2;
  scene.add(shell);

  const vel = rightWorld.clone().multiplyScalar(1.6 + Math.random() * 1.2);
  vel.y = 2.2 + Math.random() * 1.2;
  vel.addScaledVector(forwardWorld, -0.5);

  impacts.push({
    mesh: shell,
    vel: vel,
    life: 1.5, maxLife: 1.5,
    gravity: true,
    type: 'shell',
    angular: new THREE.Vector3(
      (Math.random() - 0.5) * 20,
      (Math.random() - 0.5) * 20,
      (Math.random() - 0.5) * 20
    )
  });
}

function damageEnemy(enemy, isHead) {
  const dmg = isHead ? 120 : 28;
  enemy.health -= dmg;
  enemy.hitFlash = 0.12;
  enemy.flinch = 0.2;

  showHitmarker();
  if (isHead) SFX.headshot(); else SFX.hit();
  if (enemy.health <= 0) killEnemy(enemy, isHead);
}

function killEnemy(enemy, isHead) {
  if (enemy.dead) return;
  enemy.dead = true;
  enemy.deathTimer = 0.9;
  enemy.deathRotAmount = 0;
  enemy.deathRotDir = Math.random() < 0.55 ? 1 : -1;

  player.kills++;
  let points = 100;
  if (isHead) { player.headshots++; points += 50; }
  player.score += points;

  SFX.kill();
  checkHighScore();
  updateHUD();

  UI.scoreBox.classList.add('pulse');
  setTimeout(function () { UI.scoreBox.classList.remove('pulse'); }, 180);
}

/* ---------------- Перезарядка ---------------- */
function startReload() {
  if (gameState !== 'playing') return;
  if (player.reloading) return;
  if (player.ammo >= player.magSize) return;
  if (player.reserve <= 0) return;

  player.reloading = true;
  player.reloadTimer = player.reloadDuration;
  SFX.reload();
  UI.ammoBox.classList.add('reloading');
  updateHUD();
}

function finishReload() {
  const need = player.magSize - player.ammo;
  const take = Math.min(need, player.reserve);
  player.ammo += take;
  player.reserve -= take;
  player.reloading = false;
  player.reloadTimer = 0;
  UI.ammoBox.classList.remove('reloading');
  updateHUD();
}

/* ==========================================================
   ВРАГИ
   ========================================================== */
function findSpawnPoint() {
  for (let i = 0; i < 60; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 13 + Math.random() * 8;
    const x = player.pos.x + Math.cos(angle) * dist;
    const z = player.pos.z + Math.sin(angle) * dist;
    if (Math.abs(x) > ARENA_HALF - 2.5 || Math.abs(z) > ARENA_HALF - 2.5) continue;
    if (collides(x, z, 0.9)) continue;
    return new THREE.Vector3(x, 0, z);
  }
  return new THREE.Vector3(0, 0, -16);
}

function spawnEnemy() {
  const group = new THREE.Group();

  const skinMat   = new THREE.MeshStandardMaterial({ color: 0xd9a377, roughness: 0.75, metalness: 0.02 });
  const jacketMat = new THREE.MeshStandardMaterial({ color: 0x4a3a28, roughness: 0.85, metalness: 0.05 });
  const vestMat   = new THREE.MeshStandardMaterial({ color: 0x28331f, roughness: 0.6,  metalness: 0.2 });
  const pantsMat  = new THREE.MeshStandardMaterial({ color: 0x2c2f34, roughness: 0.9,  metalness: 0.03 });
  const helmetMat = new THREE.MeshStandardMaterial({ color: 0x1c2117, roughness: 0.5,  metalness: 0.5 });
  const bootsMat  = new THREE.MeshStandardMaterial({ color: 0x16181b, roughness: 0.95, metalness: 0.1 });
  const gunMat    = new THREE.MeshStandardMaterial({ color: 0x181a1d, roughness: 0.45, metalness: 0.85 });
  const gunWood   = new THREE.MeshStandardMaterial({ color: 0x4a2f18, roughness: 0.75, metalness: 0.05 });
  const gunMetal  = new THREE.MeshStandardMaterial({ color: 0x3a3e45, roughness: 0.35, metalness: 0.95 });

  // Торс
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.85, 0.4), jacketMat);
  body.position.y = 1.05; body.castShadow = true; body.receiveShadow = true;
  group.add(body);

  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.7, 0.44), vestMat);
  vest.position.y = 1.1; vest.castShadow = true;
  group.add(vest);

  // Голова
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.36, 0.34), skinMat);
  head.position.y = 1.72; head.castShadow = true;
  group.add(head);

  const helmet = new THREE.Mesh(
    new THREE.SphereGeometry(0.24, 12, 10, 0, Math.PI * 2, 0, Math.PI / 1.7),
    helmetMat
  );
  helmet.position.y = 1.82; helmet.castShadow = true;
  group.add(helmet);

  // Руки (пивоты)
  const armGeo = new THREE.BoxGeometry(0.16, 0.7, 0.18);
  const armPivotL = new THREE.Group();
  armPivotL.position.set(-0.47, 1.42, 0);
  const armL = new THREE.Mesh(armGeo, jacketMat);
  armL.position.y = -0.35; armL.castShadow = true;
  armPivotL.add(armL);
  group.add(armPivotL);

  const armPivotR = new THREE.Group();
  armPivotR.position.set(0.47, 1.42, 0);
  armPivotR.rotation.x = ENEMY_AIM_BASE;   // прицельная поза
  const armR = new THREE.Mesh(armGeo, jacketMat);
  armR.position.y = -0.35; armR.castShadow = true;
  armPivotR.add(armR);
  group.add(armPivotR);

  // Ноги
  const legGeo = new THREE.BoxGeometry(0.24, 0.8, 0.28);
  const legPivotL = new THREE.Group();
  legPivotL.position.set(-0.17, 0.82, 0);
  const legL = new THREE.Mesh(legGeo, pantsMat);
  legL.position.y = -0.4; legL.castShadow = true;
  legPivotL.add(legL);
  const bootL = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.14, 0.36), bootsMat);
  bootL.position.set(0, -0.75, 0.04); bootL.castShadow = true;
  legPivotL.add(bootL);
  group.add(legPivotL);

  const legPivotR = new THREE.Group();
  legPivotR.position.set(0.17, 0.82, 0);
  const legR = new THREE.Mesh(legGeo, pantsMat);
  legR.position.y = -0.4; legR.castShadow = true;
  legPivotR.add(legR);
  const bootR = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.14, 0.36), bootsMat);
  bootR.position.set(0, -0.75, 0.04); bootR.castShadow = true;
  legPivotR.add(bootR);
  group.add(legPivotR);

  // ============ Оружие врага (полная модель) ============
  const gunGroup = new THREE.Group();
  gunGroup.position.set(ENEMY_GUN_BASE.x, ENEMY_GUN_BASE.y, ENEMY_GUN_BASE.z);
  gunGroup.rotation.x = ENEMY_GUN_BASE.rotX;
  gunGroup.rotation.y = ENEMY_GUN_BASE.rotY; // разворот стволом вперёд к игроку

  // Ресивер
  const gBody = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.42), gunMat);
  gBody.position.z = -0.1;
  gBody.castShadow = true;
  gunGroup.add(gBody);

  // Ствол
  const gBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.32, 8), gunMetal);
  gBarrel.rotation.x = Math.PI / 2;
  gBarrel.position.set(0, 0.015, -0.38);
  gBarrel.castShadow = true;
  gunGroup.add(gBarrel);

  // Цевьё (дерево)
  const gHandguard = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.055, 0.22), gunWood);
  gHandguard.position.set(0, -0.005, -0.3);
  gHandguard.castShadow = true;
  gunGroup.add(gHandguard);

  // Магазин
  const gMag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.08), gunMetal);
  gMag.position.set(0, -0.1, 0.0);
  gMag.rotation.x = 0.15;
  gunGroup.add(gMag);

  // Рукоять
  const gGrip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.13, 0.07), gunWood);
  gGrip.position.set(0, -0.09, 0.14);
  gGrip.rotation.x = -0.3;
  gGrip.castShadow = true;
  gunGroup.add(gGrip);

  // Приклад
  const gStock = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.08, 0.22), gunWood);
  gStock.position.set(0, -0.015, 0.32);
  gStock.castShadow = true;
  gunGroup.add(gStock);

  // Мушка
  const gSight = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.025, 0.012), gunMetal);
  gSight.position.set(0, 0.06, -0.5);
  gunGroup.add(gSight);

  // Дульная вспышка (аддитивная плоскость)
  const flashMat = new THREE.MeshBasicMaterial({
    map: getEnemyFlashTexture(),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    opacity: 0
  });
  const gunFlash = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.32), flashMat);
  gunFlash.position.set(0, 0.015, -0.56);
  gunGroup.add(gunFlash);

  // Динамический свет вспышки
  const gunLight = new THREE.PointLight(0xffcc66, 0, 5, 2);
  gunLight.position.set(0, 0.015, -0.5);
  gunGroup.add(gunLight);

  armPivotR.add(gunGroup);

  const spawn = findSpawnPoint();
  group.position.copy(spawn);
  scene.add(group);

  const enemy = {
    group: group,
    meshes: [body, head],
    limbs: {
      body, head, vest,
      armPivotL, armPivotR,
      legPivotL, legPivotR,
      gunGroup, gunMuzzleFlash: gunFlash, gunMuzzleLight: gunLight
    },
    gunBasePos: { x: ENEMY_GUN_BASE.x, y: ENEMY_GUN_BASE.y, z: ENEMY_GUN_BASE.z },
    gunBaseRotX: ENEMY_GUN_BASE.rotX,
    gunKick: 0,
    muzzleTimer: 0,
    health: 100,
    speed: 2.0 + Math.min(round * 0.12, 1.6),
    preferredRange: 6 + Math.random() * 5,
    fireRate: Math.max(0.7, 1.7 - round * 0.06),
    shootTimer: 1.2 + Math.random() * 1.5,
    damageMin: 5,
    damageMax: 11,
    dead: false,
    deathTimer: 0,
    deathRotAmount: 0,
    deathRotDir: 1,
    hitFlash: 0,
    flinch: 0,
    shootAnim: 0,
    walkPhase: Math.random() * Math.PI * 2
  };

  body.userData.enemyRef = enemy;
  body.userData.part = 'body';
  head.userData.enemyRef = enemy;
  head.userData.part = 'head';

  enemyMeshes.push(body, head);
  enemies.push(enemy);
  updateHUD();
}

function updateEnemies(dt) {
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];

    // ============ Смерть ============
    if (e.dead) {
      e.deathTimer -= dt;
      const rotSpeed = 6;
      e.deathRotAmount = Math.min(Math.PI / 2, e.deathRotAmount + dt * rotSpeed);
      e.group.rotation.x = e.deathRotAmount * e.deathRotDir;

      if (e.hitFlash > 0) {
        e.hitFlash -= dt;
        e.meshes[0].material.emissiveIntensity = Math.max(0, e.hitFlash * 6);
        e.meshes[1].material.emissiveIntensity = Math.max(0, e.hitFlash * 6);
      } else {
        e.meshes[0].material.emissiveIntensity = 0;
        e.meshes[1].material.emissiveIntensity = 0;
      }

      // Вспышка/свет угасают при смерти
      if (e.muzzleTimer > 0) e.muzzleTimer -= dt;
      if (e.limbs.gunMuzzleLight) e.limbs.gunMuzzleLight.intensity = Math.max(0, e.limbs.gunMuzzleLight.intensity - dt * 60);
      if (e.limbs.gunMuzzleFlash) {
        e.limbs.gunMuzzleFlash.material.opacity = Math.max(0, e.limbs.gunMuzzleFlash.material.opacity - dt * 20);
      }

      if (e.deathTimer <= 0) removeEnemy(i);
      continue;
    }

    // ============ Вспышка урона ============
    if (e.hitFlash > 0) {
      e.hitFlash -= dt;
      e.meshes[0].material.emissive = new THREE.Color(0xffffff);
      e.meshes[1].material.emissive = new THREE.Color(0xffffff);
      e.meshes[0].material.emissiveIntensity = e.hitFlash * 6;
      e.meshes[1].material.emissiveIntensity = e.hitFlash * 6;
    } else if (e.meshes[0].material.emissiveIntensity !== 0) {
      e.meshes[0].material.emissiveIntensity = 0;
      e.meshes[1].material.emissiveIntensity = 0;
    }

    // ============ Направление на игрока ============
    const dx = player.pos.x - e.group.position.x;
    const dz = player.pos.z - e.group.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist > 0.001) {
      e.group.rotation.y = Math.atan2(dx, dz);
    }

    // ============ Движение ============
    let isWalking = false;
    if (dist > e.preferredRange) {
      const step = e.speed * dt;
      const nx = e.group.position.x + (dx / dist) * step;
      const nz = e.group.position.z + (dz / dist) * step;
      const startX = e.group.position.x;
      const startZ = e.group.position.z;
      if (!collides(nx, e.group.position.z, 0.45)) e.group.position.x = nx;
      if (!collides(e.group.position.x, nz, 0.45)) e.group.position.z = nz;
      isWalking = (Math.abs(e.group.position.x - startX) > 0.001) ||
                  (Math.abs(e.group.position.z - startZ) > 0.001);
    }

    // ============ Ходьба (ноги + левая рука) ============
    e.walkPhase += dt * (isWalking ? 8.5 : 2.0);
    const walkAmp = isWalking ? 1.0 : 0.12;

    const legSwing = Math.sin(e.walkPhase) * 0.55 * walkAmp;
    e.limbs.legPivotL.rotation.x = legSwing;
    e.limbs.legPivotR.rotation.x = -legSwing;

    // Левая рука качается свободно
    const armSwingL = Math.sin(e.walkPhase) * 0.4 * walkAmp;
    e.limbs.armPivotL.rotation.x = -armSwingL;

    // Правая рука: прицел + лёгкое покачивание
    const armSwingR = Math.sin(e.walkPhase) * 0.10 * walkAmp;
    e.limbs.armPivotR.rotation.x = ENEMY_AIM_BASE + armSwingR;

    // Покачивание корпуса
    e.limbs.body.rotation.z = Math.sin(e.walkPhase) * 0.05 * walkAmp;
    e.limbs.vest.rotation.z = e.limbs.body.rotation.z;
    e.limbs.body.position.y = 1.05 + Math.abs(Math.sin(e.walkPhase * 2)) * 0.02 * walkAmp;

    // ============ Флинч от попадания ============
    if (e.flinch > 0) {
      e.flinch -= dt;
      const p = Math.max(0, e.flinch / 0.2);
      e.limbs.body.rotation.x = -p * 0.15;
      e.limbs.vest.rotation.x = e.limbs.body.rotation.x;
      e.limbs.head.rotation.x = -p * 0.12;
    } else {
      if (e.limbs.body.rotation.x !== 0) {
        e.limbs.body.rotation.x = 0;
        e.limbs.vest.rotation.x = 0;
        e.limbs.head.rotation.x = 0;
      }
    }

    // ============ Рекойл руки при выстреле (лёгкий) ============
    if (e.shootAnim > 0) {
      e.shootAnim -= dt;
      const p = Math.max(0, e.shootAnim / 0.15);
      e.limbs.armPivotR.rotation.x -= p * 0.12;
    }

    // ============ ВСПЫШКА ДУЛА врага ============
    if (e.muzzleTimer > 0) {
      e.muzzleTimer -= dt;
      if (e.limbs.gunMuzzleLight) {
        e.limbs.gunMuzzleLight.intensity = Math.max(0, e.limbs.gunMuzzleLight.intensity - dt * 70);
      }
      if (e.limbs.gunMuzzleFlash) {
        e.limbs.gunMuzzleFlash.material.opacity = Math.max(0, e.limbs.gunMuzzleFlash.material.opacity - dt * 22);
        const s = 0.7 + Math.random() * 0.6;
        e.limbs.gunMuzzleFlash.scale.set(s, s, 1);
        e.limbs.gunMuzzleFlash.rotation.z = Math.random() * Math.PI * 2;
      }
    } else {
      if (e.limbs.gunMuzzleLight) e.limbs.gunMuzzleLight.intensity = 0;
      if (e.limbs.gunMuzzleFlash) e.limbs.gunMuzzleFlash.material.opacity = 0;
    }

    // ============ ОТДАЧА ОРУЖИЯ ВРАГА ============
    if (e.gunKick > 0) {
      e.gunKick = Math.max(0, e.gunKick - dt / ENEMY_GUN_KICK_TIME);
      const kick = e.gunKick;
      // Ствол уходит назад (к телу врага, в локальной -z противника)
      e.limbs.gunGroup.position.z = e.gunBasePos.z - kick * 0.07;
      e.limbs.gunGroup.position.y = e.gunBasePos.y + kick * 0.02;
      // Ствол задирается вверх
      e.limbs.gunGroup.rotation.x = e.gunBaseRotX + kick * 0.28;
      // Небольшое рыскание
      e.limbs.gunGroup.rotation.z = (Math.random() - 0.5) * kick * 0.06;
    } else {
      // Возврат в исходное
      if (e.limbs.gunGroup.position.z !== e.gunBasePos.z) {
        e.limbs.gunGroup.position.set(e.gunBasePos.x, e.gunBasePos.y, e.gunBasePos.z);
        e.limbs.gunGroup.rotation.x = e.gunBaseRotX;
        e.limbs.gunGroup.rotation.z = 0;
      }
    }

    // ============ Стрельба ============
    e.shootTimer -= dt;
    if (e.shootTimer <= 0 && dist < 32 && hasLineOfSight(e, dist)) {
      e.shootTimer = e.fireRate + Math.random() * 0.6;
      enemyShoot(e, dist);
      e.shootAnim = 0.15;
    }
  }
}

function hasLineOfSight(enemy, dist) {
  const from = new THREE.Vector3(enemy.group.position.x, 1.6, enemy.group.position.z);
  const to   = new THREE.Vector3(player.pos.x, player.pos.y - 0.2, player.pos.z);
  const dir = new THREE.Vector3().subVectors(to, from);
  const len = dir.length();
  if (len < 0.001) return true;
  dir.normalize();
  raycaster.set(from, dir);
  raycaster.far = len;
  const hits = raycaster.intersectObjects(obstacles, false);
  raycaster.far = Infinity;
  if (hits.length === 0) return true;
  return hits[0].distance >= len - 0.3;
}

function enemyShoot(enemy, dist) {
  SFX.enemyShoot();

  // === ВСПЫШКА ДУЛА ===
  enemy.muzzleTimer = ENEMY_MUZZLE_TIME;
  if (enemy.limbs.gunMuzzleLight) enemy.limbs.gunMuzzleLight.intensity = 2.8;
  if (enemy.limbs.gunMuzzleFlash) enemy.limbs.gunMuzzleFlash.material.opacity = 1.0;

  // === ОТДАЧА ОРУЖИЯ ===
  enemy.gunKick = 1.0;

  // === ТРАССЕР ===
  const from = new THREE.Vector3(enemy.group.position.x, 1.5, enemy.group.position.z);
  const to   = new THREE.Vector3(player.pos.x, player.pos.y - 0.25, player.pos.z);
  addTracer(from, to, 0xffaa33);

  // === ГИЛЬЗА ===
  spawnEnemyShell(enemy);

  // === УРОН ===
  let chance = 0.48 - dist * 0.012;
  if (chance < 0.08) chance = 0.08;
  if (chance > 0.55) chance = 0.55;

  if (!player.isGrounded) chance *= 0.7;

  if (Math.random() < chance) {
    const dmg = enemy.damageMin + Math.random() * (enemy.damageMax - enemy.damageMin);
    damagePlayer(dmg);
  }
}

function removeEnemy(index) {
  const e = enemies[index];
  if (!e) return;
  scene.remove(e.group);
  e.group.traverse(function (obj) {
    if (obj.isMesh) {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    }
  });
  for (let i = 0; i < e.meshes.length; i++) {
    const idx = enemyMeshes.indexOf(e.meshes[i]);
    if (idx >= 0) enemyMeshes.splice(idx, 1);
  }
  enemies.splice(index, 1);
  updateHUD();
}

function clearEnemies() {
  for (let i = enemies.length - 1; i >= 0; i--) removeEnemy(i);
  enemies.length = 0;
  enemyMeshes.length = 0;
}

/* ==========================================================
   ЭФФЕКТЫ
   ========================================================== */
function addTracer(from, to, color) {
  const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
  const mat = new THREE.LineBasicMaterial({ color: color, transparent: true, opacity: 0.9 });
  const line = new THREE.Line(geo, mat);
  scene.add(line);
  tracers.push({ line: line, life: 0.07, maxLife: 0.07 });
}

function updateTracers(dt) {
  for (let i = tracers.length - 1; i >= 0; i--) {
    const t = tracers[i];
    t.life -= dt;
    t.line.material.opacity = Math.max(0, t.life / t.maxLife);
    if (t.life <= 0) {
      scene.remove(t.line);
      t.line.geometry.dispose();
      t.line.material.dispose();
      tracers.splice(i, 1);
    }
  }
}

function spawnSparks(point, faceNormal, obj) {
  let normal = new THREE.Vector3(0, 1, 0);
  if (faceNormal) {
    const nMat = new THREE.Matrix3().getNormalMatrix(obj.matrixWorld);
    normal = faceNormal.clone().applyMatrix3(nMat).normalize();
  }
  const count = 6 + Math.floor(Math.random() * 5);
  for (let i = 0; i < count; i++) {
    const vel = normal.clone().multiplyScalar(1.5 + Math.random() * 3);
    vel.x += (Math.random() - 0.5) * 4;
    vel.y += (Math.random() - 0.2) * 4;
    vel.z += (Math.random() - 0.5) * 4;
    const geo = new THREE.SphereGeometry(0.025, 5, 4);
    const mat = new THREE.MeshBasicMaterial({
      color: Math.random() < 0.5 ? 0xffdd55 : 0xffaa22,
      transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false
    });
    const spark = new THREE.Mesh(geo, mat);
    spark.position.copy(point);
    scene.add(spark);
    impacts.push({
      mesh: spark, vel: vel, life: 0.35 + Math.random() * 0.25,
      maxLife: 0.6, gravity: true, type: 'spark'
    });
  }
}

function spawnBloodSpray(point, dir) {
  const count = 8 + Math.floor(Math.random() * 6);
  for (let i = 0; i < count; i++) {
    const vel = dir.clone().multiplyScalar(1 + Math.random() * 2);
    vel.x += (Math.random() - 0.5) * 3;
    vel.y += (Math.random() - 0.2) * 3;
    vel.z += (Math.random() - 0.5) * 3;
    const geo = new THREE.SphereGeometry(0.04 + Math.random() * 0.03, 5, 4);
    const mat = new THREE.MeshBasicMaterial({
      color: Math.random() < 0.5 ? 0xa00000 : 0x700000,
      transparent: true, opacity: 0.95, depthWrite: false
    });
    const drop = new THREE.Mesh(geo, mat);
    drop.position.copy(point);
    scene.add(drop);
    impacts.push({
      mesh: drop, vel: vel, life: 0.4 + Math.random() * 0.35,
      maxLife: 0.75, gravity: true, type: 'blood'
    });
  }
}

function updateImpacts(dt) {
  for (let i = impacts.length - 1; i >= 0; i--) {
    const p = impacts[i];
    p.life -= dt;

    if (p.gravity) p.vel.y -= 9.8 * dt;
    p.mesh.position.x += p.vel.x * dt;
    p.mesh.position.y += p.vel.y * dt;
    p.mesh.position.z += p.vel.z * dt;

    if (p.angular) {
      p.mesh.rotation.x += p.angular.x * dt;
      p.mesh.rotation.y += p.angular.y * dt;
      p.mesh.rotation.z += p.angular.z * dt;
    }

    if (p.mesh.position.y < 0.02) {
      p.mesh.position.y = 0.02;
      p.vel.y *= p.type === 'shell' ? -0.25 : -0.35;
      p.vel.x *= 0.6;
      p.vel.z *= 0.6;
      if (p.angular) {
        p.angular.multiplyScalar(0.7);
      }
    }

    const t = Math.max(0, p.life / p.maxLife);
    p.mesh.material.opacity = t;
    if (p.type !== 'shell') {
      const s = 0.4 + t * 0.6;
      p.mesh.scale.set(s, s, s);
    }

    if (p.life <= 0) {
      scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
      impacts.splice(i, 1);
    }
  }
}

let decalTexture = null;
function getDecalTexture() {
  if (decalTexture) return decalTexture;
  const S = 128;
  const c = createCanvas(S);
  const ctx = c.getContext('2d');
  const grad = ctx.createRadialGradient(S / 2, S / 2, 2, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(10,8,6,0.95)');
  grad.addColorStop(0.55, 'rgba(20,15,10,0.7)');
  grad.addColorStop(1, 'rgba(20,15,10,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, S, S);
  ctx.strokeStyle = 'rgba(0,0,0,0.9)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 7; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 8 + Math.random() * 22;
    ctx.beginPath();
    ctx.moveTo(S / 2, S / 2);
    ctx.lineTo(S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r);
    ctx.stroke();
  }
  decalTexture = new THREE.CanvasTexture(c);
  return decalTexture;
}

function createDecal(point, hit) {
  const tex = getDecalTexture();
  const size = 0.32 + Math.random() * 0.14;
  const mat = new THREE.MeshBasicMaterial({
    map: tex, transparent: true, depthWrite: false, opacity: 0.95,
    polygonOffset: true, polygonOffsetFactor: -4
  });
  const decal = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);

  let normal = new THREE.Vector3(0, 0, 1);
  if (hit.face) {
    const nMat = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
    normal = hit.face.normal.clone().applyMatrix3(nMat).normalize();
  }
  const pos = point.clone().addScaledVector(normal, 0.012);
  decal.position.copy(pos);
  decal.lookAt(pos.clone().add(normal));
  decal.rotateZ(Math.random() * Math.PI * 2);
  scene.add(decal);
  decals.push({ mesh: decal, life: 12 + Math.random() * 6, maxLife: 18 });

  if (decals.length > MAX_DECALS) {
    const old = decals.shift();
    scene.remove(old.mesh);
    old.mesh.geometry.dispose();
    old.mesh.material.dispose();
  }
}

/* ==========================================================
   УРОН ИГРОКУ
   ========================================================== */
function damagePlayer(amount) {
  if (gameState !== 'playing') return;
  player.health -= amount;
  SFX.hurt();
  UI.damageFlash.style.opacity = '0.75';

  camShake = Math.min(0.6, camShake + amount * 0.02);

  UI.health.classList.add('hurt');
  UI.healthIcon.classList.add('hurt');
  setTimeout(function () {
    UI.health.classList.remove('hurt');
    UI.healthIcon.classList.remove('hurt');
  }, 180);

  crosshairSpread = Math.max(crosshairSpread, 0.7);

  if (player.health <= 0) {
    player.health = 0;
    updateHUD();
    gameOver();
    return;
  }
  updateHUD();
}

function updateDamageFlash(dt) {
  const cur = parseFloat(UI.damageFlash.style.opacity || '0');
  if (cur > 0) {
    UI.damageFlash.style.opacity = String(Math.max(0, cur - dt * 1.6));
  }
}

/* ==========================================================
   АНИМАЦИЯ ОРУЖИЯ ИГРОКА
   ========================================================== */
function updateViewModel(dt) {
  if (!gunModel) return;

  let baseX = 0.26;
  let baseY = -0.25;
  let baseZ = gunBaseZ;
  let baseRotX = 0;
  let baseRotY = 0.03;
  let baseRotZ = 0;

  const breathe = Math.sin(bobTime * 1.2) * 0.008;
  baseY += breathe;
  baseRotZ += Math.sin(bobTime * 0.8) * 0.012;

  const isMoving = (keys['KeyW'] || keys['KeyS'] || keys['KeyA'] || keys['KeyD']) &&
                    gameState === 'playing' && player.isGrounded;
  if (isMoving) {
    const wobbleX = Math.cos(bobTime) * 0.028;
    const wobbleY = Math.abs(Math.sin(bobTime)) * 0.022;
    const wobbleRoll = Math.sin(bobTime * 0.5) * 0.035;
    baseX += wobbleX;
    baseY -= wobbleY;
    baseRotZ += wobbleRoll;
    baseRotY += Math.cos(bobTime * 0.5) * 0.02;
  }

  if (!player.isGrounded) {
    const airFactor = Math.min(1, Math.abs(player.velY) * 0.12 + 0.25);
    baseY -= airFactor * 0.09;
    baseRotX -= airFactor * 0.16;
    baseRotZ += Math.sin(bobTime * 3.0) * 0.02;
  }

  if (gunKick > 0) {
    gunKick = Math.max(0, gunKick - dt * 0.6);
    const kick = gunKick / 0.085;
    baseZ += kick * 0.11;
    baseY += kick * 0.035;
    baseRotX -= kick * 0.22;
    baseRotZ += (Math.random() - 0.5) * kick * 0.03;
  }

  if (player.reloading) {
    const p = 1 - (player.reloadTimer / player.reloadDuration);

    let dip;
    if (p < 0.22) dip = p / 0.22;
    else if (p < 0.78) dip = 1;
    else dip = 1 - (p - 0.78) / 0.22;
    dip = dip * dip * (3 - 2 * dip);

    baseY -= dip * 0.22;
    baseZ -= dip * 0.07;
    baseRotX -= dip * 0.55;
    baseRotY += dip * 0.4;
    baseRotZ += dip * 0.28;

    if (gunMagazine) {
      if (p < 0.18) {
        gunMagazine.position.set(MAG_BASE.x, MAG_BASE.y, MAG_BASE.z);
        gunMagazine.rotation.set(MAG_BASE.rotX, 0, 0);
        gunMagazine.visible = true;
      } else if (p < 0.42) {
        const t = (p - 0.18) / 0.24;
        gunMagazine.visible = true;
        gunMagazine.position.set(
          MAG_BASE.x,
          MAG_BASE.y - t * 0.35,
          MAG_BASE.z + t * 0.08
        );
        gunMagazine.rotation.set(MAG_BASE.rotX + t * 0.5, 0, t * 0.15);
      } else if (p < 0.78) {
        gunMagazine.visible = false;
      } else {
        const t = (p - 0.78) / 0.22;
        gunMagazine.visible = true;
        gunMagazine.position.set(
          MAG_BASE.x,
          MAG_BASE.y - (1 - t) * 0.35,
          MAG_BASE.z + (1 - t) * 0.08
        );
        gunMagazine.rotation.set(MAG_BASE.rotX + (1 - t) * 0.5, 0, (1 - t) * 0.15);
      }
    }
  } else if (gunMagazine) {
    gunMagazine.visible = true;
    gunMagazine.position.set(MAG_BASE.x, MAG_BASE.y, MAG_BASE.z);
    gunMagazine.rotation.set(MAG_BASE.rotX, 0, 0);
  }

  if (drawAnim > 0) {
    drawAnim -= dt;
    const p = Math.max(0, drawAnim / 0.6);
    const ease = p * p;
    baseY -= ease * 0.55;
    baseRotX -= ease * 0.85;
    baseRotZ += ease * 0.35;
  }

  gunModel.position.x = baseX;
  gunModel.position.y = baseY;
  gunModel.position.z = baseZ;
  gunModel.rotation.x = baseRotX;
  gunModel.rotation.y = baseRotY;
  gunModel.rotation.z = baseRotZ;
}

function updateMuzzleFlash(dt) {
  if (muzzleTimer > 0) {
    muzzleTimer -= dt;
    if (gunMuzzleLight) {
      gunMuzzleLight.intensity = Math.max(0, gunMuzzleLight.intensity - dt * 80);
    }
    if (gunMuzzleFlash) {
      gunMuzzleFlash.material.opacity = Math.max(0, gunMuzzleFlash.material.opacity - dt * 22);
      const s = 0.7 + Math.random() * 0.6;
      gunMuzzleFlash.scale.set(s, s, 1);
      gunMuzzleFlash.rotation.z = Math.random() * Math.PI * 2;
    }
  } else {
    if (gunMuzzleLight) gunMuzzleLight.intensity = 0;
    if (gunMuzzleFlash) gunMuzzleFlash.material.opacity = 0;
  }
}

function updateCrosshair(dt) {
  if (!player.isGrounded) {
    crosshairSpread = Math.max(crosshairSpread, 0.85);
  }

  if (crosshairSpread > 0) {
    crosshairSpread = Math.max(0, crosshairSpread - dt * 4);
    if (crosshairSpread > 0.05) {
      UI.crosshair.classList.add('spread');
    } else {
      UI.crosshair.classList.remove('spread');
    }
  } else {
    UI.crosshair.classList.remove('spread');
  }
}

/* ==========================================================
   РАУНДЫ
   ========================================================== */
function startRound(n) {
  round = n;
  enemiesToSpawn = 2 + n;
  spawnTimer = 0.6;
  roundEndTimer = null;
  showBanner('РАУНД ' + n, 2.0);
  UI.roundBox.classList.add('pulse');
  setTimeout(function () { UI.roundBox.classList.remove('pulse'); }, 300);
  updateHUD();
}

function updateRoundLogic(dt) {
  if (gameState !== 'playing') return;
  if (enemiesToSpawn > 0) {
    spawnTimer -= dt;
    if (spawnTimer <= 0 && enemies.length < MAX_ALIVE) {
      spawnEnemy();
      enemiesToSpawn--;
      spawnTimer = Math.max(0.45, 1.4 - round * 0.1);
    }
  } else if (enemies.length === 0) {
    if (roundEndTimer === null) {
      roundEndTimer = 2.6;
      showBanner('РАУНД ' + round + ' ПРОЙДЕН!', 2.6);
    }
  }
  if (roundEndTimer !== null) {
    roundEndTimer -= dt;
    if (roundEndTimer <= 0) {
      roundEndTimer = null;
      nextRound();
    }
  }
}

function nextRound() {
  round++;
  player.health = Math.min(100, player.health + 35);
  player.reserve += 60;
  player.ammo = player.magSize;
  player.reloading = false;
  player.reloadTimer = 0;
  UI.ammoBox.classList.remove('reloading');
  startRound(round);
  updateHUD();
}

/* ==========================================================
   БАННЕР
   ========================================================== */
function showBanner(text, duration) {
  UI.banner.textContent = text;
  UI.banner.classList.remove('hidden');
  UI.banner.classList.remove('pop');
  void UI.banner.offsetWidth;
  UI.banner.classList.add('pop');
  UI.banner.style.opacity = '1';
  bannerTimer = duration || 2;
}

function updateBanner(dt) {
  if (bannerTimer > 0) {
    bannerTimer -= dt;
    UI.banner.style.opacity = String(Math.max(0, Math.min(1, bannerTimer)));
    if (bannerTimer <= 0) {
      UI.banner.classList.add('hidden');
      UI.banner.classList.remove('pop');
      UI.banner.style.opacity = '0';
    }
  }
}

function showHitmarker() {
  UI.hitmarker.classList.add('show');
  if (hitmarkerTimeout) clearTimeout(hitmarkerTimeout);
  hitmarkerTimeout = setTimeout(function () {
    UI.hitmarker.classList.remove('show');
  }, 110);
}

/* ==========================================================
   HUD
   ========================================================== */
function updateHUD() {
  if (!UI.health) return;
  const hp = Math.max(0, Math.round(player.health));
  UI.health.textContent = hp;
  UI.healthBar.style.width = hp + '%';

  if (hp > 60) {
    UI.healthBar.style.background = 'linear-gradient(90deg, #35d435, #7bff7b)';
  } else if (hp > 25) {
    UI.healthBar.style.background = 'linear-gradient(90deg, #d4a035, #ffd166)';
  } else {
    UI.healthBar.style.background = 'linear-gradient(90deg, #c62828, #ff5252)';
  }

  UI.ammo.textContent = player.ammo;
  UI.ammo.classList.toggle('low', player.ammo <= 5);
  UI.reserve.textContent = player.reserve;
  UI.score.textContent = player.score;
  UI.round.textContent = round;
  UI.enemies.textContent = enemies.length + enemiesToSpawn;
  UI.highscore.textContent = getHighScore();
}

/* ==========================================================
   СОСТОЯНИЯ ИГРЫ
   ========================================================== */
function hideAllOverlays() {
  UI.menu.classList.add('hidden');
  UI.pause.classList.add('hidden');
  UI.gameover.classList.add('hidden');
}

function startGame() {
  clearEnemies();
  tracers.length = 0;
  impacts.length = 0;

  for (let i = decals.length - 1; i >= 0; i--) {
    scene.remove(decals[i].mesh);
    decals[i].mesh.geometry.dispose();
    decals[i].mesh.material.dispose();
  }
  decals.length = 0;

  round = 1;
  enemiesToSpawn = 0;
  spawnTimer = 0;
  roundEndTimer = null;

  player.pos.set(0, PLAYER_HEIGHT, 14);
  player.velY = 0;
  player.isGrounded = true;
  player.health = 100;
  player.ammo = player.magSize;
  player.reserve = 90;
  player.score = 0;
  player.kills = 0;
  player.headshots = 0;
  player.reloading = false;
  player.reloadTimer = 0;

  yaw = 0; pitch = 0;
  firing = false;
  shootCooldown = 0;
  bannerTimer = 0;
  gunKick = 0;
  muzzleTimer = 0;
  camShake = 0;
  crosshairSpread = 0;
  landBob = 0;

  drawAnim = 0.6;

  camera.position.copy(player.pos);
  camera.rotation.set(0, 0, 0);

  UI.damageFlash.style.opacity = '0';
  UI.banner.classList.add('hidden');
  UI.reloadHint.classList.add('hidden');
  UI.ammoBox.classList.remove('reloading');
  UI.crosshair.classList.remove('spread');

  hideAllOverlays();
  UI.hud.classList.remove('hidden');

  gameState = 'playing';

  startRound(1);
  updateHUD();
  requestLock();
}

function gameOver() {
  gameState = 'gameover';
  firing = false;
  if (document.pointerLockElement) document.exitPointerLock();

  const isRecord = checkHighScore();

  document.getElementById('final-score').textContent = player.score;
  document.getElementById('final-kills').textContent = player.kills;
  document.getElementById('final-headshots').textContent = player.headshots;
  document.getElementById('final-round').textContent = round;
  document.getElementById('final-highscore').textContent = getHighScore();

  const title = UI.gameover.querySelector('h2');
  if (isRecord) {
    title.textContent = 'НОВЫЙ РЕКОРД!';
    title.classList.remove('dead');
    title.style.color = '#ffd24d';
  } else {
    title.textContent = 'ВЫ ПОГИБЛИ';
    title.classList.add('dead');
    title.style.color = '';
  }

  UI.hud.classList.add('hidden');
  hideAllOverlays();
  UI.gameover.classList.remove('hidden');
  updateHUD();
}

function toMenu() {
  gameState = 'menu';
  firing = false;
  clearEnemies();
  if (document.pointerLockElement) document.exitPointerLock();

  UI.hud.classList.add('hidden');
  hideAllOverlays();
  UI.menu.classList.remove('hidden');
  UI.menuHighscore.textContent = getHighScore();
}

/* ==========================================================
   СТАРТ
   ========================================================== */
window.addEventListener('load', init);