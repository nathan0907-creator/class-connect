// Animated 3D space background: starfield, spiral galaxy, nebulae, ringed gas giant,
// asteroid belt, moon, space dust with hyperspace "warp" and shooting stars.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { QUALITY, chosenQuality, applyQualityClass } from './quality.js';

const NOISE = /* glsl */`
  vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
  vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
  vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
  vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
  float snoise(vec3 v){
    const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
    vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
    vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
    vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
    i=mod289(i);
    vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
    float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
    vec4 j=p-49.0*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
    vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
    vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
    vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
    vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
    vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
    vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
    p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
    vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
    return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
  }
  float fbm(vec3 p){ float f=0.0; float a=0.5; for(int i=0;i<5;i++){ f+=a*snoise(p); p*=2.03; a*=0.5; } return f; }
`;

const MODES = {
  auth: { cam: new THREE.Vector3(0, 0, 120), look: new THREE.Vector3(0, 0, 0), planet: new THREE.Vector3(80, -30, -40), planetScale: 0.85 },
  app:  { cam: new THREE.Vector3(0, 6, 150), look: new THREE.Vector3(0, 0, 0), planet: new THREE.Vector3(150, -78, -110), planetScale: 1.25 },
  gate: { cam: new THREE.Vector3(0, 0, 125), look: new THREE.Vector3(0, 0, 0), planet: new THREE.Vector3(0, -95, -60), planetScale: 1.1 },
};

const rand = (a, b) => a + Math.random() * (b - a);

const ease = (t) => t * t * (3 - 2 * t);

export class Space {
  constructor(canvas) {
    this.canvas = canvas;
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.quality = chosenQuality();
    this.low = this.quality === 'eco' || (navigator.hardwareConcurrency || 4) <= 4 || matchMedia('(pointer: coarse)').matches;
    this.lastFrame = 0;
    this.slowFrames = 0;
    this.mouse = new THREE.Vector2();
    this.mouseSmooth = new THREE.Vector2();
    this.mode = MODES.auth;
    this.camBase = this.mode.cam.clone();
    this.lookBase = this.mode.look.clone();
    this.warp = 0;
    this.warpStart = -1;
    this.pulseLevel = 0;
    this.clock = new THREE.Clock();
    this.nextShooting = 3;

    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !this.low, powerPreference: this.low ? 'low-power' : 'high-performance' }));
    r.setPixelRatio(Math.min(devicePixelRatio, QUALITY[this.quality].ratio));
    r.setSize(innerWidth, innerHeight);
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#03020a');
    this.camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 5000);
    this.camera.position.copy(this.camBase);

    const sun = new THREE.DirectionalLight('#fff1e0', 2.6);
    sun.position.set(-1, 0.6, 0.8);
    this.sunDir = sun.position.clone().normalize();
    this.scene.add(sun, new THREE.AmbientLight('#2a2266', 0.6));

    this.buildStars();
    this.buildNebulae();
    this.buildGalaxy();
    this.buildPlanet();
    this.buildDust();
    this.shooting = [];

    this.composer = new EffectComposer(r);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.8, 0.55, 0.32);
    if (this.low) this.bloom.resolution.set(innerWidth / 2, innerHeight / 2);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    addEventListener('resize', () => this.resize());
    addEventListener('pointermove', (e) => {
      this.mouse.set((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1);
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.clock.getDelta(); });
    this.loop = this.loop.bind(this);
    r.setAnimationLoop(this.loop);
  }

  // ------------------------------------------------------------ builders
  buildStars() {
    const n = this.quality === 'eco' ? 1800 : this.low ? 3500 : 7000;
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n), phase = new Float32Array(n);
    const palette = ['#9fb8ff', '#ffffff', '#fff4e0', '#ffd6a5', '#c7b8ff', '#a0f0ff'].map((c) => new THREE.Color(c));
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(rand(700, 2200));
      pos.set([v.x, v.y, v.z], i * 3);
      const c = palette[(Math.random() * palette.length) | 0];
      col.set([c.r, c.g, c.b], i * 3);
      size[i] = Math.random() < 0.02 ? rand(4, 7) : rand(1, 3);
      phase[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('size', new THREE.BufferAttribute(size, 1));
    g.setAttribute('phase', new THREE.BufferAttribute(phase, 1));
    this.starMat = new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 }, pr: { value: this.renderer.getPixelRatio() } },
      vertexShader: /* glsl */`
        attribute float size; attribute float phase; attribute vec3 color;
        uniform float time; uniform float pr;
        varying vec3 vColor; varying float vTw;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          float tw = 0.55 + 0.45 * sin(time * (0.6 + phase * 2.5) + phase * 60.0);
          vTw = tw; vColor = color;
          gl_PointSize = size * pr * (0.7 + 0.5 * tw);
        }`,
      fragmentShader: /* glsl */`
        varying vec3 vColor; varying float vTw;
        void main(){
          float d = length(gl_PointCoord - 0.5);
          float core = smoothstep(0.5, 0.0, d);
          gl_FragColor = vec4(vColor * (pow(core, 2.5) * 1.8), core * (0.4 + 0.6 * vTw));
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.stars = new THREE.Points(g, this.starMat);
    this.scene.add(this.stars);
  }

  nebulaTexture(colors, count = 30, alpha = '10') {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const ctx = c.getContext('2d');
    for (let i = 0; i < count; i++) {
      const x = 128 + rand(-60, 60), y = 128 + rand(-60, 60), rad = rand(30, 110);
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      const col = colors[i % colors.length];
      g.addColorStop(0, col + alpha);
      g.addColorStop(1, col + '00');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 256, 256);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  buildNebulae() {
    this.nebulae = [];
    const sets = [
      { colors: ['#7c5cff', '#ff4fd8', '#3a1c8f'], pos: [-520, 260, -1300], scale: 1300 },
      { colors: ['#00d4ff', '#2b59ff', '#7c5cff'], pos: [650, -300, -1500], scale: 1500 },
      { colors: ['#ff4fd8', '#ffb547', '#7c5cff'], pos: [200, 520, -1700], scale: 1100 },
    ];
    for (const s of sets) {
      const mat = new THREE.SpriteMaterial({ map: this.nebulaTexture(s.colors), transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, opacity: 0.55 });
      const sp = new THREE.Sprite(mat);
      sp.position.set(...s.pos);
      sp.scale.setScalar(s.scale);
      sp.userData.spin = rand(-0.01, 0.01);
      this.scene.add(sp);
      this.nebulae.push(sp);
    }
  }

  buildGalaxy() {
    const n = this.quality === 'eco' ? 4500 : this.low ? 9000 : 22000, radius = 300, branches = 3, spin = 1.15;
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n);
    const inside = new THREE.Color('#ffd29a'), mid = new THREE.Color('#ff4fd8'), outside = new THREE.Color('#4a6bff');
    for (let i = 0; i < n; i++) {
      const r = Math.pow(Math.random(), 1.6) * radius;
      const branch = ((i % branches) / branches) * Math.PI * 2;
      const angle = branch + r * spin * 0.02;
      const spread = (k) => Math.pow(Math.random(), 3) * (Math.random() < 0.5 ? 1 : -1) * k * (0.25 + r / radius);
      pos.set([Math.cos(angle) * r + spread(38), spread(12), Math.sin(angle) * r + spread(38)], i * 3);
      const t = r / radius;
      const c = t < 0.35 ? inside.clone().lerp(mid, t / 0.35) : mid.clone().lerp(outside, (t - 0.35) / 0.65);
      col.set([c.r, c.g, c.b], i * 3);
      size[i] = rand(0.6, 2.2) * (1.4 - t * 0.6);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('size', new THREE.BufferAttribute(size, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { pr: { value: this.renderer.getPixelRatio() } },
      vertexShader: /* glsl */`
        attribute float size; attribute vec3 color; uniform float pr; varying vec3 vColor;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = size * pr * (900.0 / -mv.z);
          vColor = color;
        }`,
      fragmentShader: /* glsl */`
        varying vec3 vColor;
        void main(){
          float d = length(gl_PointCoord - 0.5);
          float a = pow(smoothstep(0.5, 0.0, d), 2.0);
          gl_FragColor = vec4(vColor * a * 0.45, a);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.galaxy = new THREE.Points(g, mat);
    const holder = new THREE.Group();
    holder.position.set(-330, 150, -900);
    holder.rotation.set(1.05, 0.2, -0.45);
    holder.add(this.galaxy);

    // Bright core glow
    const core = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.nebulaTexture(['#fff0d0', '#ffb547', '#ff4fd8'], 16, '18'), blending: THREE.AdditiveBlending, depthWrite: false,
      transparent: true, opacity: 0.6,
    }));
    core.scale.setScalar(200);
    holder.add(core);
    this.scene.add(holder);
  }

  buildPlanet() {
    const R = 36;
    this.planetGroup = new THREE.Group();
    this.planetGroup.position.copy(this.mode.planet);
    this.planetGroup.rotation.z = 0.32;
    this.scene.add(this.planetGroup);

    this.planetMat = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 }, sun: { value: this.sunDir },
        cA: { value: new THREE.Color('#1b0f4d') }, cB: { value: new THREE.Color('#6c4cff') },
        cC: { value: new THREE.Color('#29d3ff') }, cD: { value: new THREE.Color('#ff5fd8') },
      },
      vertexShader: /* glsl */`
        varying vec3 vPos; varying vec3 vN; varying vec3 vView;
        void main(){
          vPos = position;
          vN = normalize(mat3(modelMatrix) * normal);
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vView = normalize(cameraPosition - wp.xyz);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: NOISE + /* glsl */`
        uniform float time; uniform vec3 sun; uniform vec3 cA, cB, cC, cD;
        varying vec3 vPos; varying vec3 vN; varying vec3 vView;
        void main(){
          vec3 p = normalize(vPos);
          float warp = fbm(p * 2.2 + vec3(time * 0.015, 0.0, time * 0.01));
          float lat = p.y + warp * 0.18;
          float bands = sin(lat * 22.0) * 0.5 + 0.5;
          float fine = fbm(vec3(p.x * 1.5, lat * 14.0, p.z * 1.5) + time * 0.02) * 0.5 + 0.5;
          vec3 col = mix(cA, cB, bands);
          col = mix(col, cC, smoothstep(0.55, 0.9, fine) * 0.55);
          col = mix(col, cD, smoothstep(0.62, 0.95, sin(lat * 7.0 + 1.3) * 0.5 + 0.5) * 0.35);
          // Great storm
          float storm = smoothstep(0.23, 0.0, length(vec2(atan(p.z, p.x) - 1.2, (p.y + 0.25) * 2.2)));
          col = mix(col, vec3(1.0, 0.55, 0.85), storm * 0.7);
          float diff = max(dot(vN, sun), 0.0);
          float fres = pow(1.0 - max(dot(vN, vView), 0.0), 3.0);
          vec3 lit = col * (0.04 + 1.25 * pow(diff, 0.8)) + cC * fres * 0.9 * (0.25 + diff);
          gl_FragColor = vec4(lit, 1.0);
        }`,
    });
    this.planet = new THREE.Mesh(new THREE.SphereGeometry(R, this.low ? 64 : 128, this.low ? 48 : 96), this.planetMat);
    this.planetGroup.add(this.planet);

    const atmo = new THREE.Mesh(new THREE.SphereGeometry(R * 1.16, 64, 48), new THREE.ShaderMaterial({
      uniforms: { sun: { value: this.sunDir }, c: { value: new THREE.Color('#5fd4ff') } },
      vertexShader: /* glsl */`
        varying vec3 vN; varying vec3 vView;
        void main(){
          vN = normalize(mat3(modelMatrix) * normal);
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vView = normalize(cameraPosition - wp.xyz);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 sun; uniform vec3 c; varying vec3 vN; varying vec3 vView;
        void main(){
          float rim = pow(max(0.0, 0.72 - dot(vN, vView)), 2.4);
          float lit = 0.35 + 0.65 * max(dot(-vN, -sun), 0.0);
          gl_FragColor = vec4(c * rim * 2.6 * lit, rim);
        }`,
      side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.planetGroup.add(atmo);
    this.atmoMat = atmo.material;

    // Rings
    const inner = R * 1.4, outer = R * 2.45;
    const ringGeo = new THREE.RingGeometry(inner, outer, 180, 1);
    this.ringMat = new THREE.ShaderMaterial({
      uniforms: { inner: { value: inner }, outer: { value: outer }, time: { value: 0 },
        cA: { value: new THREE.Color('#c8b8ff') }, cB: { value: new THREE.Color('#ff9ee8') }, cC: { value: new THREE.Color('#7ae6ff') } },
      vertexShader: /* glsl */`
        varying vec3 vP;
        void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: NOISE + /* glsl */`
        uniform float inner, outer, time; uniform vec3 cA, cB, cC; varying vec3 vP;
        void main(){
          float r = length(vP.xy);
          float t = (r - inner) / (outer - inner);
          float n = snoise(vec3(t * 40.0, 0.0, 0.0)) * 0.5 + 0.5;
          float n2 = snoise(vec3(t * 140.0, 3.0, 0.0)) * 0.5 + 0.5;
          float gap = smoothstep(0.02, 0.05, abs(t - 0.62)) * smoothstep(0.01, 0.025, abs(t - 0.3));
          float a = (0.25 + 0.55 * n * n2) * gap * smoothstep(0.0, 0.06, t) * smoothstep(1.0, 0.85, t);
          vec3 col = mix(cA, cB, smoothstep(0.2, 0.8, t));
          col = mix(col, cC, n2 * 0.35);
          // planet shadow on the far side of the ring
          float ang = atan(vP.y, vP.x);
          float shadow = 1.0 - 0.75 * smoothstep(0.35, 0.0, abs(ang + 2.2)) ;
          gl_FragColor = vec4(col * a * 1.3 * shadow, a * 0.9);
        }`,
      side: THREE.DoubleSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const ring = new THREE.Mesh(ringGeo, this.ringMat);
    ring.rotation.x = -Math.PI / 2 + 0.28;
    this.planetGroup.add(ring);
    this.ring = ring;

    // Asteroid belt (instanced rocks orbiting in the ring plane)
    const count = this.quality === 'eco' ? 50 : this.low ? 120 : 320;
    const rock = new THREE.IcosahedronGeometry(1, 0);
    const rockMat = new THREE.MeshStandardMaterial({ color: '#8b80b8', roughness: 0.9, metalness: 0.1, flatShading: true });
    this.belt = new THREE.InstancedMesh(rock, rockMat, count);
    this.beltData = Array.from({ length: count }, () => ({
      r: rand(outer * 1.04, outer * 1.28), a: rand(0, Math.PI * 2), y: rand(-1.6, 1.6),
      s: rand(0.25, 1.1), speed: rand(0.02, 0.06), rot: new THREE.Euler(rand(0, 6), rand(0, 6), rand(0, 6)),
    }));
    this.beltHolder = new THREE.Group();
    this.beltHolder.rotation.x = 0.28;
    this.beltHolder.add(this.belt);
    this.planetGroup.add(this.beltHolder);
    this.dummy = new THREE.Object3D();

    // Moon
    this.moon = new THREE.Mesh(new THREE.SphereGeometry(4.2, 48, 32), new THREE.MeshStandardMaterial({ color: '#d9d2ff', roughness: 1 }));
    this.planetGroup.add(this.moon);
  }

  buildDust() {
    const n = this.quality === 'eco' ? 220 : this.low ? 500 : 1100;
    this.dustN = n;
    this.dustData = new Float32Array(n * 3);
    const pos = new Float32Array(n * 6), col = new Float32Array(n * 6);
    for (let i = 0; i < n; i++) {
      this.resetDust(i, true);
      const c = new THREE.Color().setHSL(rand(0.55, 0.8), 0.8, rand(0.6, 0.9));
      col.set([c.r, c.g, c.b, 0, 0, 0], i * 6);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.dustMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false });
    this.dust = new THREE.LineSegments(g, this.dustMat);
    this.dust.frustumCulled = false;
    this.scene.add(this.dust);
  }

  resetDust(i, initial) {
    let x, y;
    do { x = rand(-420, 420); y = rand(-260, 260); } while (Math.abs(x) < 25 && Math.abs(y) < 18);
    this.dustData[i * 3] = x;
    this.dustData[i * 3 + 1] = y;
    this.dustData[i * 3 + 2] = initial ? rand(-1600, 110) : rand(-1600, -1200);
  }

  spawnShootingStar() {
    const start = new THREE.Vector3(rand(-500, 500), rand(80, 320), rand(-700, -500));
    const dir = new THREE.Vector3(rand(-1, 1), rand(-0.6, -0.2), 0).normalize();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array([1, 1, 1, 0.1, 0.2, 0.6]), 3));
    const line = new THREE.Line(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    line.frustumCulled = false;
    this.scene.add(line);
    this.shooting.push({ line, start, dir, t: 0, life: rand(0.9, 1.5), speed: rand(500, 800) });
  }

  // ------------------------------------------------------------ public API
  /** Colour theme (see js/theme.js): planet, atmosphere, rings and nebulae. */
  setTheme(t) {
    if (!t?.planet) return;
    const set = (u, c) => u.value.set(c);
    ['cA', 'cB', 'cC', 'cD'].forEach((k, i) => set(this.planetMat.uniforms[k], t.planet[i]));
    set(this.atmoMat.uniforms.c, t.atmo);
    ['cA', 'cB', 'cC'].forEach((k, i) => set(this.ringMat.uniforms[k], t.rings[i]));
    this.nebulae.forEach((sp, i) => {
      const old = sp.material.map;
      sp.material.map = this.nebulaTexture(t.nebulae[i % t.nebulae.length]);
      sp.material.needsUpdate = true;
      old?.dispose();
    });
  }

  setMode(name) {
    this.mode = MODES[name] || MODES.auth;
  }

  /** Changes resolution, glow and frame rate on the fly (particle counts apply at the next start). */
  setQuality(q) {
    if (!QUALITY[q]) return;
    this.quality = q;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, QUALITY[q].ratio));
    this.resize();
    applyQualityClass(q);
  }

  /** Hyperspace jump. Resolves at peak speed so the UI can swap views behind the blur. */
  warpJump() {
    if (this.reduced) return Promise.resolve();
    this.warpStart = this.clock.elapsedTime;
    return new Promise((res) => setTimeout(res, 650));
  }

  pulse() { this.pulseLevel = 1; }

  resize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
    this.composer.setSize(innerWidth, innerHeight);
  }

  // ------------------------------------------------------------ frame
  loop(now) {
    if (document.hidden) return;
    // Frame cap: the backdrop doesn't need 60 images per second, especially behind the chat.
    const q = QUALITY[this.quality];
    const busy = this.warpStart >= 0 || this.pulseLevel > 0.05;
    const fps = busy ? q.fps.auth : this.mode === MODES.app ? q.fps.app : q.fps.auth;
    const gap = now - this.lastFrame;
    if (gap < 1000 / fps - 2) return;
    // Automatic fallback: if the device can't keep up, switch to the economy mode.
    if (this.lastFrame && this.quality !== 'eco' && !busy) {
      this.slowFrames = gap > 1000 / fps * 2.2 ? this.slowFrames + 1 : Math.max(0, this.slowFrames - 1);
      if (this.slowFrames > 40) { this.slowFrames = 0; this.setQuality('eco'); document.dispatchEvent(new CustomEvent('cc-quality-auto', { detail: 'eco' })); }
    }
    this.lastFrame = now;
    const dt = Math.min(this.clock.getDelta(), 0.12);
    const t = this.clock.elapsedTime;
    const motion = this.reduced ? 0.15 : 1;

    // warp envelope
    if (this.warpStart >= 0) {
      const w = t - this.warpStart;
      this.warp = w < 0.65 ? ease(w / 0.65) : Math.max(0, 1 - ease((w - 0.65) / 1.3));
      if (w > 2) this.warpStart = -1;
    }

    this.starMat.uniforms.time.value = t;
    this.planetMat.uniforms.time.value = t;
    this.planet.rotation.y += dt * 0.05 * motion;
    this.galaxy.rotation.y += dt * 0.012 * motion;
    for (const n of this.nebulae) n.material.rotation += n.userData.spin * dt * motion;
    this.stars.rotation.y += dt * 0.004 * motion;

    // belt & moon
    for (let i = 0; i < this.beltData.length; i++) {
      const b = this.beltData[i];
      b.a += b.speed * dt * motion;
      b.rot.x += dt * 0.3 * motion;
      this.dummy.position.set(Math.cos(b.a) * b.r, b.y, Math.sin(b.a) * b.r);
      this.dummy.rotation.copy(b.rot);
      this.dummy.scale.setScalar(b.s);
      this.dummy.updateMatrix();
      this.belt.setMatrixAt(i, this.dummy.matrix);
    }
    this.belt.instanceMatrix.needsUpdate = true;
    const ma = t * 0.18 * motion;
    this.moon.position.set(Math.cos(ma) * 120, Math.sin(ma * 0.7) * 16, Math.sin(ma) * 120);

    // planet placement per mode
    this.planetGroup.position.lerp(this.mode.planet, 1 - Math.pow(0.02, dt));
    const s = THREE.MathUtils.lerp(this.planetGroup.scale.x, this.mode.planetScale, 1 - Math.pow(0.02, dt));
    this.planetGroup.scale.setScalar(s);

    // dust / hyperspace streaks
    const speed = (18 + this.warp * 2600) * motion;
    const len = 0.6 + this.warp * 160;
    const p = this.dust.geometry.attributes.position.array;
    for (let i = 0; i < this.dustN; i++) {
      let z = (this.dustData[i * 3 + 2] += speed * dt);
      if (z > this.camera.position.z + 5) { this.resetDust(i, false); z = this.dustData[i * 3 + 2]; }
      const x = this.dustData[i * 3], y = this.dustData[i * 3 + 1];
      p[i * 6] = x; p[i * 6 + 1] = y; p[i * 6 + 2] = z;
      p[i * 6 + 3] = x; p[i * 6 + 4] = y; p[i * 6 + 5] = z - len;
    }
    this.dust.geometry.attributes.position.needsUpdate = true;
    this.dustMat.opacity = 0.35 + this.warp * 0.65;

    // shooting stars
    if (!this.reduced && t > this.nextShooting) {
      this.spawnShootingStar();
      this.nextShooting = t + rand(3.5, 9);
    }
    this.shooting = this.shooting.filter((sh) => {
      sh.t += dt;
      const head = sh.start.clone().addScaledVector(sh.dir, sh.t * sh.speed);
      const tail = head.clone().addScaledVector(sh.dir, -Math.min(sh.t * sh.speed, 90));
      const a = sh.line.geometry.attributes.position.array;
      a.set([head.x, head.y, head.z, tail.x, tail.y, tail.z]);
      sh.line.geometry.attributes.position.needsUpdate = true;
      sh.line.material.opacity = Math.sin(Math.min(sh.t / sh.life, 1) * Math.PI);
      if (sh.t > sh.life) { this.scene.remove(sh.line); sh.line.geometry.dispose(); sh.line.material.dispose(); return false; }
      return true;
    });

    // camera: mode + mouse parallax + warp FOV
    this.mouseSmooth.lerp(this.mouse, 1 - Math.pow(0.05, dt));
    this.camBase.lerp(this.mode.cam, 1 - Math.pow(0.08, dt));
    this.lookBase.lerp(this.mode.look, 1 - Math.pow(0.08, dt));
    this.camera.position.set(
      this.camBase.x + this.mouseSmooth.x * 9 * motion,
      this.camBase.y - this.mouseSmooth.y * 6 * motion,
      this.camBase.z,
    );
    this.camera.lookAt(this.lookBase);
    this.camera.rotation.z += Math.sin(t * 0.1) * 0.01 * motion;
    const fov = 60 + this.warp * 38;
    if (Math.abs(this.camera.fov - fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }

    this.pulseLevel = Math.max(0, this.pulseLevel - dt * 1.6);
    this.bloom.strength = 0.8 + this.warp * 1.2 + this.pulseLevel * 0.6;

    if (q.bloom) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}

export function createSpace(canvas) {
  try {
    return new Space(canvas);
  } catch (err) {
    console.warn('WebGL indisponible', err);
    document.body.classList.add('no-webgl');
    return { setMode() {}, setTheme() {}, setQuality() {}, warpJump: () => Promise.resolve(), pulse() {} };
  }
}
