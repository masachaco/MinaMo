// MMD characters: PMX / PMD models rendered with three.js into a canvas that the 2D stage draws like a
// 立ち絵 sprite (framing, effects, readability correction and export stay the same).
// Poses (VPD) and motions (VMD) are sampled at the frame time, so a frame is a pure function of t
// (physics is not simulated).

import {
  AmbientLight, AnimationMixer, DirectionalLight, Group, LoadingManager, LoopOnce, PerspectiveCamera, Quaternion, Scene, Vector3,
  WebGLRenderer, type AnimationAction, type AnimationClip,
} from 'three';
import { applyVPD, buildAnimation, buildCameraAnimation, MMDLoader, VMDLoader, VPDLoader, type MMD, type VmdObject, type VpdObject } from '@moeru/three-mmd';
import { MMDSpringBonePlugin } from '@moeru/three-mmd-physics-springbone';
import type { MmdPoseRef } from '../core/types';
import { makeCanvas } from './lib';
import { normPath } from './mmd-files';

const SCHEME = 'mmd://m/';
/** Output image aspect (width / height); the figure is framed full body with headroom for motions. */
const ASPECT = 0.62;
const FOV = 24;
/** Frame height relative to the model height, and the share of it below the feet. */
const FRAME_H = 1.14;
const FOOT_MARGIN = 0.03;
/** Physics (hair / skirt spring bones): fixed step, and the pre-roll simulated before a seek target. */
const PHYS_STEP = 1 / 60;
const PHYS_WARM = 0.5;
/** Bones the spring-bone backend drives (same name rules as the plugin). */
const SPRING_BONE = /髪|Hair|Twin|裙|スカート|Skirt/;
/** Gravity for the spring bones (the plugin default is 98, which drags the modelled hair shape straight down). */
export const MMD_PHYS = { gravity: 98 };
/** Axis signs applied to the VMD camera (eye, look-at point, up) to bring it into the model's space. */
export const CAM_FIX = { x: -1, z: 1 };

/** Scene lights (MMD's default light is a white-ish key light from the front-left). */
export const MMD_LIGHT = { ambient: 2.2, sun: 2.8 };

export interface MmdClip {
  ref: MmdPoseRef;
  vpd?: VpdObject;
  vmd?: VmdObject;
}

export async function loadMmdClip(ref: MmdPoseRef, blob: Blob): Promise<MmdClip> {
  const url = URL.createObjectURL(blob);
  try {
    if (ref.kind === 'vpd') return { ref, vpd: await new VPDLoader().loadAsync(url) };
    const vmd = await new VMDLoader().loadAsync(url);
    if (!vmd.boneKeyFrames.length && !vmd.morphKeyFrames.length) throw new Error('ボーン/表情のないVMD（カメラ用？）');
    return { ref, vmd };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Canvas for an MMD character entry (sized on the first render). */
export const mmdCanvas = () => makeCanvas(Math.round(512 * ASPECT), 512);

/** What a VMD file carries (a camera VMD has camera frames and no bones / morphs). */
export async function inspectVmd(blob: Blob): Promise<{ bones: number; morphs: number; camera: number }> {
  const url = URL.createObjectURL(blob);
  try {
    const vmd = await new VMDLoader().loadAsync(url);
    return { bones: vmd.boneKeyFrames.length, morphs: vmd.morphKeyFrames.length, camera: vmd.cameraKeyFrames.length };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Camera animation from a camera VMD. */
export async function loadMmdCamera(blob: Blob): Promise<AnimationClip> {
  const url = URL.createObjectURL(blob);
  try {
    const vmd = await new VMDLoader().loadAsync(url);
    if (!vmd.cameraKeyFrames.length) throw new Error('カメラのキーフレームがない VMD です');
    return buildCameraAnimation(vmd);
  } finally {
    URL.revokeObjectURL(url);
  }
}

let shared: WebGLRenderer | null = null;
function glRenderer(): WebGLRenderer {
  if (!shared) {
    shared = new WebGLRenderer({ canvas: makeCanvas(4, 4), alpha: true, antialias: true, preserveDrawingBuffer: true });
    shared.setClearColor(0x000000, 0);
  }
  return shared;
}

interface BoneSnap {
  pos: Vector3[];
  rot: Quaternion[];
  morph: number[];
}

/** A loaded MMD model with its own scene and fixed full-body camera (renders into any canvas). */
export class MmdModel {
  /** Face (head bone) position as a fraction of the output image height, at rest. */
  readonly faceY: number;
  private readonly scene = new Scene();
  /** Rotation pivot at the model's centre (the mesh hangs under it). */
  private readonly pivot = new Group();
  /** VMD camera (MMD units, inside a group scaled like the model); its 'target' child holds the look-at point. */
  private readonly vmdCam = new PerspectiveCamera(30, 16 / 9, 1, 5000);
  private readonly vmdCamGroup = new Group();
  private readonly vmdTarget = new Group();
  private readonly camMixer: AnimationMixer;
  private camAction: AnimationAction | null = null;
  private readonly camera = new PerspectiveCamera(FOV, ASPECT, 0.5, 1000);
  private readonly mixer: AnimationMixer;
  private readonly clips = new Map<VmdObject, AnimationClip>();
  private active: AnimationAction | null = null;
  private snap: BoneSnap | null = null;
  /** Simulate hair / skirt (spring bones). Frames stay a function of time: continuous frames step by the elapsed
   *  time, anything else (seek, first frame) resets and pre-rolls PHYS_WARM seconds. */
  physicsOn = true;
  private physT: number | null = null;
  private physAcc = 0;
  /** What the spring state was simulated for (motion, its start, rotation): kept only while this matches. */
  private physCtx = '';
  private readonly springBones: number[];
  private springPose: Quaternion[] | null = null;

  constructor(readonly mmd: MMD, private readonly revoke: () => void) {
    const mesh = mmd.mesh;
    this.springBones = mesh.skeleton.bones.flatMap((b, i) => (SPRING_BONE.test(b.name) ? [i] : []));
    mmd.physics?.setGravity?.(new Vector3(0, -MMD_PHYS.gravity, 0));
    this.mixer = new AnimationMixer(mesh);
    this.scene.add(this.pivot);
    this.pivot.add(mesh);
    this.vmdTarget.name = 'target';
    this.vmdCam.add(this.vmdTarget);
    this.vmdCamGroup.add(this.vmdCam);
    this.scene.add(this.vmdCamGroup);
    this.camMixer = new AnimationMixer(this.vmdCam);
    this.scene.add(new AmbientLight(0xffffff, MMD_LIGHT.ambient));
    const sun = new DirectionalLight(0xffffff, MMD_LIGHT.sun);
    sun.position.set(-1, 1.2, 1.4);
    this.scene.add(sun);
    // spring-bone physics is tuned for metre-scale humans: normalise the model to 1.6 units tall
    mesh.geometry.computeBoundingBox();
    const box0 = mesh.geometry.boundingBox!;
    const scale = 1.6 / Math.max(1e-3, box0.max.y - box0.min.y);
    mmd.setScalar(scale);
    this.vmdCamGroup.scale.setScalar(scale);
    // frame the rest pose: feet near the bottom, headroom above
    const box = box0.clone();
    box.min.multiplyScalar(scale);
    box.max.multiplyScalar(scale);
    const h = Math.max(1e-3, box.max.y - box.min.y);
    const frameH = h * FRAME_H;
    const cy = box.min.y - frameH * FOOT_MARGIN + frameH / 2;
    const cx = (box.min.x + box.max.x) / 2;
    // rotate about the body centre, not the feet
    const pc = new Vector3(cx, (box.min.y + box.max.y) / 2, (box.min.z + box.max.z) / 2);
    this.pivot.position.copy(pc);
    mesh.position.copy(pc).negate();
    this.pivot.updateMatrixWorld(true);
    const dist = frameH / 2 / Math.tan(((FOV / 2) * Math.PI) / 180);
    this.camera.position.set(cx, cy, dist);
    this.camera.lookAt(cx, cy, 0);
    this.camera.near = dist * 0.1;
    this.camera.far = dist * 4;
    this.camera.updateProjectionMatrix();
    mesh.updateMatrixWorld(true);
    const head = mesh.skeleton.bones.find((b) => b.name === '頭');
    const hp = head ? head.getWorldPosition(new Vector3()) : new Vector3(cx, box.max.y - h * 0.08, 0);
    this.faceY = Math.min(0.6, Math.max(0.02, (1 - hp.project(this.camera).y) / 2));
  }

  /**
   * Pose the model: the clip at its local time, crossfading from the previous clip while k < 1; `mouth` opens 「あ」 (0..1).
   * With `songT` (and physics on) the spring bones are simulated; `rate` maps song time to the clip's local time.
   */
  pose(cur: MmdClip | null, localT: number, prev?: { clip: MmdClip | null; localT: number; k: number }, mouth = 0, songT?: number, rate = 1) {
    const phys = this.physicsOn && !!this.mmd.physics && this.springBones.length > 0 && songT !== undefined;
    let steps = 0;
    if (phys) {
      const dt = this.physT === null ? NaN : songT! - this.physT;
      const r = this.pivot.rotation;
      const ctx = `${cur?.ref.id ?? 'rest'}|${(songT! - localT / (rate || 1)).toFixed(3)}|${r.x.toFixed(4)},${r.y.toFixed(4)},${r.z.toFixed(4)}`;
      // same time but drawn for something else (another entry / edited): the kept state does not apply
      const stale = dt === 0 && ctx !== this.physCtx;
      this.physCtx = ctx;
      if (dt >= 0 && dt <= 0.1 && !stale) {
        this.physAcc += dt;
        steps = Math.floor(this.physAcc / PHYS_STEP + 1e-6);
        this.physAcc -= steps * PHYS_STEP;
      } else {
        // discontinuity: reset and pre-roll so the hair has settled at the target time. The spring state is
        // rebuilt from the current bones, so pose the pre-roll start first (no dependence on the last frame).
        const n = Math.round(PHYS_WARM / PHYS_STEP);
        this.sample(cur, localT - n * PHYS_STEP * rate);
        this.mmd.physics!.reset?.();
        this.physAcc = 0;
        for (let i = n; i >= 1; i--) {
          this.sample(cur, localT - i * PHYS_STEP * rate);
          this.stepPhysics(1);
        }
        steps = 1;
      }
      this.physT = songT!;
    }
    if (prev && prev.k < 1) {
      this.sample(prev.clip, prev.localT);
      this.snap = this.capture(this.snap);
      this.sample(cur, localT);
      this.blendFrom(this.snap, prev.k);
    } else this.sample(cur, localT);
    if (phys) {
      if (steps > 0) this.stepPhysics(steps);
      else this.restoreSprings(); // no step this frame: keep the last simulated hair
    }
    if (mouth > 0) this.openMouth(mouth);
  }

  private stepPhysics(steps: number) {
    for (let i = 0; i < steps; i++) this.mmd.physics!.update(PHYS_STEP);
    this.mmd.mesh.updateMatrixWorld(true);
    const bones = this.mmd.mesh.skeleton.bones;
    this.springPose ??= this.springBones.map(() => new Quaternion());
    this.springBones.forEach((bi, k) => this.springPose![k].copy(bones[bi].quaternion));
  }

  private restoreSprings() {
    if (!this.springPose) return;
    const bones = this.mmd.mesh.skeleton.bones;
    this.springBones.forEach((bi, k) => bones[bi].quaternion.copy(this.springPose![k]));
    this.mmd.mesh.updateMatrixWorld(true);
  }

  /** Loop length of a motion in seconds (0 for poses). */
  duration(clip: MmdClip | null): number {
    return clip?.vmd ? this.animFor(clip.vmd).duration : 0;
  }

  /** Whether the model has the 「あ」 mouth morph (lip sync). */
  get hasMouth(): boolean {
    return this.mmd.mesh.morphTargetDictionary?.['あ'] !== undefined;
  }

  private openMouth(v: number) {
    const mesh = this.mmd.mesh;
    const i = mesh.morphTargetDictionary?.['あ'];
    const inf = mesh.morphTargetInfluences;
    if (i === undefined || !inf) return;
    inf[i] = Math.max(inf[i], Math.min(1, v));
  }

  private animFor(vmd: VmdObject): AnimationClip {
    let anim = this.clips.get(vmd);
    if (!anim) {
      // the builder bakes the bones' current positions in as the base, so build from the rest pose
      this.stopActive();
      this.mmd.mesh.pose();
      anim = buildAnimation(vmd, this.mmd.mesh);
      this.clips.set(vmd, anim);
    }
    return anim;
  }

  /** Place the VMD camera at the clip's local time (loops with the clip's own length). */
  poseCamera(clip: AnimationClip, localT: number) {
    // re-activate per sample (the mixer skips unchanged values; see sample())
    this.camAction?.stop();
    const action = this.camMixer.clipAction(clip);
    action.setLoop(LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    this.camAction = action;
    const d = clip.duration;
    this.camMixer.setTime(d > 0 ? ((localT % d) + d) % d : 0);
    const cam = this.vmdCam;
    const q = cam.quaternion.clone();
    const target = this.vmdTarget.position.clone();
    // the builder's position is Q·(centre + (0,0,-d)); recover d and put the eye at centre + Q·(0,0,-d)
    const dist = cam.position.clone().applyQuaternion(q.clone().invert()).sub(target).z;
    const eye = new Vector3(0, 0, dist).applyQuaternion(q).add(target);
    const up = new Vector3(0, 1, 0).applyQuaternion(q);
    // the raw VMD camera is in MMD's left-handed space: bring eye / look-at point / up into the model's space
    // (checked against the rendered shot bundled with a camera motion)
    for (const v of [eye, target, up]) {
      v.x *= CAM_FIX.x;
      v.z *= CAM_FIX.z;
    }
    cam.position.copy(eye);
    cam.up.copy(up);
    this.vmdCamGroup.updateMatrixWorld(true);
    // the look-at point is in MMD units; the camera lives in the model-scaled group
    cam.lookAt(target.multiplyScalar(this.vmdCamGroup.scale.x));
    cam.updateProjectionMatrix();
  }

  /** Render full-frame through the VMD camera (call poseCamera() first). */
  renderCamera(target: HTMLCanvasElement, width: number, height: number) {
    const w = Math.round(Math.min(3840, Math.max(64, width)));
    const hh = Math.round(Math.min(2160, Math.max(36, height)));
    if (target.width !== w || target.height !== hh) {
      target.width = w;
      target.height = hh;
    }
    this.vmdCam.aspect = w / hh;
    this.vmdCam.updateProjectionMatrix();
    const r = glRenderer();
    r.setPixelRatio(1);
    r.setSize(w, hh, false);
    r.render(this.scene, this.vmdCam);
    const x = target.getContext('2d')!;
    x.clearRect(0, 0, w, hh);
    x.drawImage(r.domElement, 0, 0);
  }

  /** Model rotation in degrees (x = lean, y = turn, z = tilt) around its centre; set before pose(). */
  setRotation(x: number, y: number, z: number) {
    const r = Math.PI / 180;
    this.pivot.rotation.set(x * r, y * r, z * r, 'YXZ');
    this.pivot.updateMatrixWorld(true);
  }

  /** Render the current pose into `target` (resized to the given height, px). */
  render(target: HTMLCanvasElement, height: number) {
    const hImg = Math.round(Math.min(2048, Math.max(256, height)));
    const wImg = Math.round(hImg * ASPECT);
    if (target.height !== hImg || target.width !== wImg) {
      target.width = wImg;
      target.height = hImg;
    }
    const r = glRenderer();
    r.setPixelRatio(1);
    r.setSize(wImg, hImg, false);
    r.render(this.scene, this.camera);
    const x = target.getContext('2d')!;
    x.clearRect(0, 0, wImg, hImg);
    x.drawImage(r.domElement, 0, 0);
  }

  dispose() {
    this.mixer.stopAllAction();
    this.mmd.dispose();
    this.mmd.mesh.geometry.dispose();
    const mats = this.mmd.mesh.material;
    (Array.isArray(mats) ? mats : [mats]).forEach((m) => m.dispose());
    this.revoke();
  }

  private sample(clip: MmdClip | null, localT: number) {
    const { mmd } = this;
    const mesh = mmd.mesh;
    mesh.pose();
    mesh.morphTargetInfluences?.fill(0);
    mmd.grantSolver.reset();
    mmd.ikSolver.reset();
    if (clip?.vpd) {
      this.stopActive();
      applyVPD(mmd, clip.vpd, { resetPose: false, resetPhysics: false });
      return;
    }
    if (clip?.vmd) {
      const anim = this.animFor(clip.vmd);
      const action = this.mixer.clipAction(anim);
      // Re-activate on every sample: three's PropertyMixer only writes values that changed since its last apply,
      // so after mesh.pose() reset the bones, unchanged tracks would stay at rest (random access / seek breaks).
      this.stopActive();
      action.setLoop(LoopOnce, 1);
      action.clampWhenFinished = true;
      action.play();
      this.active = action;
      const d = anim.duration;
      this.mixer.setTime(d > 0 ? ((localT % d) + d) % d : 0);
      mmd.updateAnimation(this.mixer);
    } else {
      this.stopActive();
      mmd.updateAnimation(undefined);
    }
    mmd.update(0, { physics: false });
  }

  private stopActive() {
    if (!this.active) return;
    this.active.stop();
    this.active = null;
  }

  private capture(into: BoneSnap | null): BoneSnap {
    const bones = this.mmd.mesh.skeleton.bones;
    const s = into ?? { pos: bones.map(() => new Vector3()), rot: bones.map(() => new Quaternion()), morph: [] };
    bones.forEach((b, i) => {
      s.pos[i].copy(b.position);
      s.rot[i].copy(b.quaternion);
    });
    s.morph = [...(this.mmd.mesh.morphTargetInfluences ?? [])];
    return s;
  }

  private blendFrom(s: BoneSnap, k: number) {
    const mesh = this.mmd.mesh;
    mesh.skeleton.bones.forEach((b, i) => {
      b.position.lerpVectors(s.pos[i], b.position, k);
      b.quaternion.slerpQuaternions(s.rot[i], b.quaternion.clone(), k);
    });
    const inf = mesh.morphTargetInfluences;
    if (inf) for (let i = 0; i < inf.length; i++) inf[i] = (s.morph[i] ?? 0) * (1 - k) + inf[i] * k;
    mesh.updateMatrixWorld(true);
  }
}

/** Load a model from its folder files (normalized relative path → blob). */
export async function loadMmdModel(files: Map<string, Blob>, modelPath: string): Promise<MmdModel> {
  const urls = new Map<string, string>();
  const byName = new Map<string, string | null>();
  for (const k of files.keys()) {
    const base = k.slice(k.lastIndexOf('/') + 1);
    byName.set(base, byName.has(base) ? null : k); // null = ambiguous basename
  }
  const urlFor = (key: string) => {
    let u = urls.get(key);
    if (!u) {
      u = URL.createObjectURL(files.get(key)!);
      urls.set(key, u);
    }
    return u;
  };
  const manager = new LoadingManager();
  const pending = trackPending(manager);
  const missing = new Set<string>();
  manager.setURLModifier((url) => {
    if (!url.startsWith(SCHEME)) return url;
    let key = normPath(decodeURIComponent(url.slice(SCHEME.length)));
    if (!files.has(key)) key = byName.get(key.slice(key.lastIndexOf('/') + 1)) ?? key;
    if (files.has(key)) return urlFor(key);
    missing.add(key);
    return url;
  });
  const revoke = () => urls.forEach((u) => URL.revokeObjectURL(u));
  try {
    const mmd = await new MMDLoader(manager).register(MMDSpringBonePlugin).loadAsync(SCHEME + encodeURI(normPath(modelPath)));
    await pending.idle(8000);
    if (missing.size) console.warn('MMD: missing files', [...missing].join(', '));
    return new MmdModel(mmd, revoke);
  } catch (e) {
    revoke();
    throw e;
  }
}

/** Count the manager's in-flight loads (textures keep loading after the mesh is returned). */
function trackPending(m: LoadingManager) {
  let n = 0;
  let wake: (() => void) | null = null;
  const start = m.itemStart.bind(m);
  const end = m.itemEnd.bind(m);
  m.itemStart = (url: string) => {
    n++;
    start(url);
  };
  m.itemEnd = (url: string) => {
    n--;
    end(url);
    if (n <= 0) wake?.();
  };
  return {
    idle: (timeoutMs: number) =>
      new Promise<void>((res) => {
        if (n <= 0) return res();
        const timer = setTimeout(res, timeoutMs);
        wake = () => {
          clearTimeout(timer);
          res();
        };
      }),
  };
}
