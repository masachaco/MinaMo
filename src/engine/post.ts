// WebGL2 post-processing: bloom, chromatic aberration, glitch, zoom blur, grading, grain.

import type { PostParams } from './api';

const VS = `#version 300 es
out vec2 vUv;
void main(){
  vec2 p = vec2(float((gl_VertexID<<1)&2), float(gl_VertexID&2));
  vUv = p;
  gl_Position = vec4(p*2.0-1.0, 0.0, 1.0);
}`;

const BRIGHT_FS = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uTex; uniform vec2 uTexel; uniform float uThr;
void main(){
  vec3 c = texture(uTex, vUv + uTexel*vec2(-1.0,-1.0)).rgb;
  c += texture(uTex, vUv + uTexel*vec2( 1.0,-1.0)).rgb;
  c += texture(uTex, vUv + uTexel*vec2(-1.0, 1.0)).rgb;
  c += texture(uTex, vUv + uTexel*vec2( 1.0, 1.0)).rgb;
  c *= 0.25;
  float l = max(c.r, max(c.g, c.b));
  float k = smoothstep(uThr, uThr + 0.25, l);
  o = vec4(c * k, 1.0);
}`;

const BLUR_FS = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uTex; uniform vec2 uDir;
void main(){
  vec4 c = texture(uTex, vUv) * 0.2270270270;
  c += texture(uTex, vUv + uDir*1.3846153846) * 0.3162162162;
  c += texture(uTex, vUv - uDir*1.3846153846) * 0.3162162162;
  c += texture(uTex, vUv + uDir*3.2307692308) * 0.0702702703;
  c += texture(uTex, vUv - uDir*3.2307692308) * 0.0702702703;
  o = c;
}`;

const FINAL_FS = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uScene; uniform sampler2D uB1; uniform sampler2D uB2;
uniform vec2 uRes; uniform float uTime;
uniform float uBloom, uChroma, uGrain, uScan, uVig, uGlitch, uContrast, uSat, uBright, uInvert, uFlash, uRadial, uMirror, uPixel, uHue;
float h21(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
vec3 hueShift(vec3 c, float a){ const vec3 k = vec3(0.57735); float ca = cos(a); return c*ca + cross(k,c)*sin(a) + k*dot(k,c)*(1.0-ca); }
void main(){
  vec2 uv = vUv;
  if (uMirror > 0.5) uv.x = uv.x < 0.5 ? uv.x : 1.0 - uv.x;
  if (uPixel > 0.001) { float px = mix(2.0, 48.0, uPixel); vec2 cells = uRes / px; uv = (floor(uv*cells)+0.5)/cells; }
  if (uGlitch > 0.001) {
    float tt = floor(uTime*20.0);
    float row = floor(uv.y * 36.0);
    float r = h21(vec2(row, tt));
    float br = floor(uv.y * 7.0);
    float r2 = h21(vec2(br, tt + 7.0));
    if (r < uGlitch*0.5) uv.x += (h21(vec2(row, tt+1.0)) - 0.5) * 0.10 * uGlitch;
    if (r2 < uGlitch*0.22) uv.x += (r2 - 0.11) * 0.5 * uGlitch;
  }
  vec2 dir = uv - 0.5;
  float ca = uChroma / uRes.x;
  vec3 col;
  if (uRadial > 0.001) {
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 14; i++) {
      float f = float(i) / 13.0;
      float s = 1.0 - uRadial * 0.14 * f;
      vec2 suv = 0.5 + dir * s;
      acc.r += texture(uScene, suv + dir*ca*2.0).r;
      acc.g += texture(uScene, suv).g;
      acc.b += texture(uScene, suv - dir*ca*2.0).b;
    }
    col = acc / 14.0;
  } else {
    vec2 off = dir * ca * 2.0 + vec2(ca * 0.5, 0.0);
    col.r = texture(uScene, uv + off).r;
    col.g = texture(uScene, uv).g;
    col.b = texture(uScene, uv - off).b;
  }
  vec3 bl = texture(uB1, uv).rgb * 0.55 + texture(uB2, uv).rgb * 0.65;
  col += bl * uBloom;
  col += uBright;
  col = (col - 0.5) * uContrast + 0.5;
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(l), col, uSat);
  if (abs(uHue) > 0.001) col = hueShift(col, uHue);
  col = mix(col, 1.0 - col, clamp(uInvert, 0.0, 1.0));
  col = mix(col, vec3(1.0), clamp(uFlash, 0.0, 1.0));
  float len = length(dir * vec2(uRes.x / uRes.y, 1.0));
  col *= 1.0 - uVig * smoothstep(0.3, 1.15, len);
  col *= 1.0 - uScan * (0.5 + 0.5 * sin(vUv.y * uRes.y * 3.14159));
  float n = h21(vUv * uRes + fract(uTime * 13.1) * 1000.0) - 0.5;
  col += n * uGrain;
  o = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

// Layer composite with readability correction (binary): each text pixel keeps its design color, or — when it
// is too close to what is behind it — flips to a clearly lighter / darker version of its own hue.
// The decision uses a slightly blurred background so the split follows the background's shape crisply.
const COMP_FS = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uScene, uWide, uPlateA, uTextA, uOver, uPlateB, uTextB;
uniform float uThr, uDark, uLight, uAdapt; uniform vec3 uUse;
float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 over(vec3 bg, vec4 fg){ return mix(bg, fg.rgb, fg.a); }
// background the text is judged against: the scene blurred over a wide area (busy detail is ignored),
// with plates (sticker bodies, boxes) taken exactly
vec3 judgeBg(vec2 uv, bool withB){
  vec3 c = over(texture(uWide, uv).rgb, texture(uPlateA, uv));
  if (withB) c = over(c, texture(uPlateB, uv));
  return c;
}
// the same hue at luminance L (lift toward white / scale toward black)
vec3 atLum(vec3 col, float L){
  float Lt = luma(col);
  return L > Lt ? col + (1.0 - col) * clamp((L - Lt) / max(1e-3, 1.0 - Lt), 0.0, 1.0)
                : col * clamp(L / max(1e-3, Lt), 0.0, 1.0);
}
vec3 adapt(vec3 col, vec3 bg){
  if (uAdapt <= 0.0) return col;
  float Lt = luma(col), Lb = luma(bg);
  // contrast = luminance difference, or color difference (vivid hues stay readable on dark backgrounds)
  float d = max(abs(Lt - Lb), 0.8 * length(col - bg) / 1.7320508);
  // hard 0 / 1 switches; the edge is anti-aliased over ~1 screen pixel (fwidth), never a gradient
  float fd = max(fwidth(d), 1e-4);
  float flip = 1.0 - smoothstep(uThr - fd, uThr + fd, d);
  // alternate fill: dark version of the hue on bright backgrounds, light version on dark ones
  float fl = max(fwidth(Lb), 1e-4);
  float wDark = smoothstep(0.5 - fl, 0.5 + fl, Lb);
  vec3 alt = mix(atLum(col, uLight), atLum(col, uDark), wDark);
  return mix(col, alt, flip);
}
void main(){
  vec2 uv = vUv;
  vec3 c = texture(uScene, uv).rgb;
  if (uUse.x > 0.5) {
    c = over(c, texture(uPlateA, uv));
    vec4 t = texture(uTextA, uv);
    if (t.a > 0.003) c = over(c, vec4(adapt(t.rgb, judgeBg(uv, false)), t.a));
  }
  if (uUse.y > 0.5) c = over(c, texture(uOver, uv));
  if (uUse.z > 0.5) {
    c = over(c, texture(uPlateB, uv));
    vec4 t = texture(uTextB, uv);
    if (t.a > 0.003) c = over(c, vec4(adapt(t.rgb, judgeBg(uv, true)), t.a));
  }
  o = vec4(c, 1.0);
}`;

/** Separate layers composited on the GPU with the readability correction. null = layer unused this frame. */
export interface PostLayers {
  plateA: HTMLCanvasElement | null;
  textA: HTMLCanvasElement | null;
  over: HTMLCanvasElement | null;
  plateB: HTMLCanvasElement | null;
  textB: HTMLCanvasElement | null;
  /** Contrast below which a text pixel flips (0..1). */
  threshold: number;
  /** Luminance of the alternate fill on bright / dark backgrounds. */
  dark: number;
  light: number;
}

const LAYER_KEYS = ['plateA', 'textA', 'over', 'plateB', 'textB'] as const;
const LAYER_UNIFORMS: Record<(typeof LAYER_KEYS)[number], string> = { plateA: 'uPlateA', textA: 'uTextA', over: 'uOver', plateB: 'uPlateB', textB: 'uTextB' };

interface Target {
  tex: WebGLTexture;
  fb: WebGLFramebuffer;
  w: number;
  h: number;
}

const FINAL_UNIFORMS = ['uBloom', 'uChroma', 'uGrain', 'uScan', 'uVig', 'uGlitch', 'uContrast', 'uSat', 'uBright', 'uInvert', 'uFlash', 'uRadial', 'uMirror', 'uPixel', 'uHue'] as const;

export class PostFX {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private progBright: WebGLProgram;
  private progBlur: WebGLProgram;
  private progFinal: WebGLProgram;
  private progComp: WebGLProgram;

  private sceneTex: WebGLTexture;
  private layerTex = new Map<string, WebGLTexture>();
  private texSize = new Map<WebGLTexture, string>();
  private emptyTex: WebGLTexture;
  private comp: Target | null = null;
  private wide: Target | null = null;
  private wideTmp: Target | null = null;
  private sceneSize = [0, 0];
  private a!: Target;
  private b!: Target;
  private c!: Target;
  private d!: Target;
  private loc = new Map<string, WebGLUniformLocation | null>();
  private W = 0;
  private H = 0;

  constructor(canvas?: HTMLCanvasElement) {
    this.canvas = canvas ?? document.createElement('canvas');
    const gl = this.canvas.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false, alpha: false, premultipliedAlpha: false });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    this.progBright = this.program(BRIGHT_FS);
    this.progBlur = this.program(BLUR_FS);
    this.progFinal = this.program(FINAL_FS);
    this.progComp = this.program(COMP_FS);

    this.sceneTex = this.texture();
    for (const k of LAYER_KEYS) this.layerTex.set(k, this.texture());
    this.emptyTex = this.texture();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    gl.bindVertexArray(gl.createVertexArray());
  }

  private program(fs: string): WebGLProgram {
    const gl = this.gl;
    const mk = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader error');
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, mk(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link error');
    return p;
  }

  private u(p: WebGLProgram, name: string) {
    const key = (p === this.progFinal ? 'f' : p === this.progBlur ? 'b' : p === this.progComp ? 'c' : 'r') + name;
    if (!this.loc.has(key)) this.loc.set(key, this.gl.getUniformLocation(p, name));
    return this.loc.get(key)!;
  }

  private texture(): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  private target(w: number, h: number): Target {
    const gl = this.gl;
    const tex = this.texture();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fb, w, h };
  }

  private freeTarget(t?: Target) {
    if (!t) return;
    this.gl.deleteTexture(t.tex);
    this.gl.deleteFramebuffer(t.fb);
  }

  resize(W: number, H: number) {
    if (W === this.W && H === this.H) return;
    this.W = W;
    this.H = H;
    this.canvas.width = W;
    this.canvas.height = H;
    for (const t of [this.a, this.b, this.c, this.d]) this.freeTarget(t);
    for (const t of [this.comp, this.wide, this.wideTmp]) if (t) this.freeTarget(t);
    this.comp = this.wide = this.wideTmp = null;
    const qw = Math.max(1, Math.round(W / 4)), qh = Math.max(1, Math.round(H / 4));
    const ew = Math.max(1, Math.round(W / 10)), eh = Math.max(1, Math.round(H / 10));
    this.a = this.target(qw, qh);
    this.b = this.target(qw, qh);
    this.c = this.target(ew, eh);
    this.d = this.target(ew, eh);
  }

  private pass(prog: WebGLProgram, target: Target | null, tex: WebGLTexture, setup: () => void) {
    const gl = this.gl;
    gl.useProgram(prog);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
    gl.viewport(0, 0, target ? target.w : this.W, target ? target.h : this.H);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(this.u(prog, 'uTex'), 0);
    setup();
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private blur(src: Target, tmp: Target, radius: number) {
    const gl = this.gl;
    this.pass(this.progBlur, tmp, src.tex, () => gl.uniform2f(this.u(this.progBlur, 'uDir'), radius / src.w, 0));
    this.pass(this.progBlur, src, tmp.tex, () => gl.uniform2f(this.u(this.progBlur, 'uDir'), 0, radius / src.h));
  }

  /** Upload a canvas into a texture (allocates on size change). */
  private upload(tex: WebGLTexture, c: HTMLCanvasElement) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    const size = `${c.width}x${c.height}`;
    if (this.texSize.get(tex) !== size) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
      this.texSize.set(tex, size);
    } else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, c);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  }

  /** Composite layers with the readability correction into the full-res comp target. */
  private composite(layers: PostLayers, u: number): WebGLTexture {
    const gl = this.gl;
    this.comp ??= this.target(this.W, this.H);
    const ww = Math.max(1, Math.round(this.W / 8)), wh = Math.max(1, Math.round(this.H / 8));
    this.wide ??= this.target(ww, wh);
    this.wideTmp ??= this.target(ww, wh);
    for (const k of LAYER_KEYS) {
      const c = layers[k];
      if (c) this.upload(this.layerTex.get(k)!, c);
    }
    // wide-area background: 1/8 res copy of the scene, blurred (~ 3% of the frame height)
    this.pass(this.progBright, this.wide, this.sceneTex, () => {
      gl.uniform2f(this.u(this.progBright, 'uTexel'), 2 / this.W, 2 / this.H);
      gl.uniform1f(this.u(this.progBright, 'uThr'), -1);
    });
    this.blur(this.wide, this.wideTmp, 1.5);
    this.blur(this.wide, this.wideTmp, 2.5);
    const f = this.progComp;
    gl.useProgram(f);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.comp.fb);
    gl.viewport(0, 0, this.W, this.H);
    const bind = (unit: number, tex: WebGLTexture, name: string) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(this.u(f, name), unit);
    };
    bind(0, this.sceneTex, 'uScene');
    LAYER_KEYS.forEach((k, i) => bind(i + 1, layers[k] ? this.layerTex.get(k)! : this.emptyTex, LAYER_UNIFORMS[k]));
    bind(6, this.wide.tex, 'uWide');
    gl.uniform1f(this.u(f, 'uThr'), layers.threshold);
    gl.uniform1f(this.u(f, 'uDark'), layers.dark);
    gl.uniform1f(this.u(f, 'uLight'), layers.light);
    gl.uniform1f(this.u(f, 'uAdapt'), layers.threshold > 0 ? 1 : 0);
    gl.uniform3f(this.u(f, 'uUse'), layers.plateA || layers.textA ? 1 : 0, layers.over ? 1 : 0, layers.plateB || layers.textB ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE0);
    return this.comp.tex;
  }

  render(scene: HTMLCanvasElement, p: PostParams, time: number, u: number, layers?: PostLayers) {
    const gl = this.gl;
    const W = this.W, H = this.H;
    // upload scene
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    if (this.sceneSize[0] !== scene.width || this.sceneSize[1] !== scene.height) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, scene);
      this.sceneSize = [scene.width, scene.height];
    } else {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, scene);
    }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

    const src = layers ? this.composite(layers, u) : this.sceneTex;
    const bloomOn = p.bloom > 0.001;
    if (bloomOn) {
      this.pass(this.progBright, this.a, src, () => {
        gl.uniform2f(this.u(this.progBright, 'uTexel'), 1 / W, 1 / H);
        gl.uniform1f(this.u(this.progBright, 'uThr'), p.bloomThreshold);
      });
      this.blur(this.a, this.b, 1);
      this.blur(this.a, this.b, 2);
      this.pass(this.progBlur, this.c, this.a.tex, () => gl.uniform2f(this.u(this.progBlur, 'uDir'), 0, 0));
      this.blur(this.c, this.d, 1.5);
      this.blur(this.c, this.d, 3);
    }

    const f = this.progFinal;
    gl.useProgram(f);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src);
    gl.uniform1i(this.u(f, 'uScene'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.a.tex);
    gl.uniform1i(this.u(f, 'uB1'), 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.c.tex);
    gl.uniform1i(this.u(f, 'uB2'), 2);
    gl.uniform2f(this.u(f, 'uRes'), W, H);
    gl.uniform1f(this.u(f, 'uTime'), time);
    const vals: Record<(typeof FINAL_UNIFORMS)[number], number> = {
      uBloom: bloomOn ? p.bloom : 0,
      uChroma: p.chroma * u,
      uGrain: p.grain,
      uScan: p.scanline,
      uVig: p.vignette,
      uGlitch: p.glitch,
      uContrast: p.contrast,
      uSat: p.saturation,
      uBright: p.brightness,
      uInvert: p.invert,
      uFlash: p.flash,
      uRadial: p.radialBlur,
      uMirror: p.mirror,
      uPixel: p.pixelate,
      uHue: p.hue,
    };
    for (const k of FINAL_UNIFORMS) gl.uniform1f(this.u(f, k), vals[k]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE0);
  }
}
