import * as THREE from 'three';
import WebGL from 'three/addons/capabilities/WebGL.js';
// import { FlyControls } from 'three/addons/controls/FlyControls.js';

// console.log(THREE.REVISION);  --> 155

const HFOV = 100;  // horizontal field of view
let VFOV, WIDTH, HEIGHT, ASPECT;  // TAN_VFOV = 2*tan(VFOV/2)
let SPRITE_SCALE;  // sprite x, y scales are this times canvas width, height
function setFOVParams(width, height) {
  [WIDTH, HEIGHT, ASPECT] = [width, height, width/height];
  let halfWidth = Math.tan(HFOV * Math.PI/360.);
  let tanHalfV = halfWidth / ASPECT;
  VFOV = Math.atan(tanHalfV) * 360./Math.PI;
  // Want 1 pixel on sprite canvas to be 1 pixel on renderer canvas.
  SPRITE_SCALE = 2*halfWidth / WIDTH;
}
setFOVParams(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(VFOV, ASPECT, 0.1, 1000);
const renderer = new THREE.WebGLRenderer(
  {canvas: document.getElementById("container"), antialias: true});
renderer.setSize(window.innerWidth, window.innerHeight);
// document.body.appendChild(renderer.domElement);

/*
 *  mercury      venus      earth       mars     jupiter    saturn
 * 0.2408467  0.61519726  1.0000174  1.8808476  11.862615  29.447498  yr
 * relative to Sun, t in Julian centuries (36525 days):
 * 102.93768193 + 0.32327364*t  lon of Earth's perihelion
 * 100.46457166 + 35999.37244981*t  lon of Earth
 * -23.94362959 + 0.44441088*t  lon of Mars's perihelion
 *  -4.55343205 + 19140.30268499*t  lon of Mars
 *
 *       venus      earth       mars
 * a  0.72333566  1.00000261  1.52371034
 * e  0.00677672  0.01671123  0.09339410
 *
 * Max elongation when inner planet at aphelion, outer planet at perihelion:
 *   sin(elong) = apin / perout = (1+ei)/(1-eo) * ai/ao
 *      max elong = 47.784 for venus from earth
 *                = 47.392 for earth from mars
 */
const [sun0, sunt, mars0, marst] = [
  280.46457166 * Math.PI/180., 35999.37244981/36525. * Math.PI/180.,
  -4.55343205 * Math.PI/180., 19140.30268499/36525. * Math.PI/180.];
const jd2ra = { sun: (jd) => sun0+sunt*jd, mars: (jd) => mars0+marst*jd };
// J2000 obliquity of ecliptic 23.43928 degrees

let jdInitial = dayOfDate(new Date());
let jdNow = jdInitial;
let trackingMode = "sky";

const planets = {};
const labels = {};

let paused = false;
let animationFrameId = undefined;

const labelsForModes = {
  sky: ["sun", "mercury", "venus", "mars", "jupiter", "saturn", "antisun"],
  sun: ["sun"],
  venus: ["sun", "venus"],
  mars: ["sun", "mars",  "antisun", "sunmars"]
};

function cameraTracking(tracking) {
  for (let name in labels) labels[name].visible = false;
  labelsForModes[tracking].forEach((name) => {labels[name].visible = true;});
  trackingMode = tracking;
  jdNow = jdInitial;
  const skyMode = trackingMode == "sky";
  scene.backgroundIntensity = skyMode? 1.0 : 0.5;
  controls.enabled = skyMode;
}

function animate() {
  animationFrameId = undefined;
  jdNow += 0.6;  // about 10 sec/yr
  setPlanetPositions();
  let rsun = planets.sun.position;
  let z = rsun.z, x = rsun.x;  // rsun=(z,x) and rperp=(-x,z)
  if (trackingMode == "mars") {
    let rmars = planets.mars.position;
    [x, z] = [rmars.x-rsun.x, rmars.z-rsun.z];
  }
  if (trackingMode != "sky") {
    camera.lookAt(x, 0, z);
  }
  renderer.render(scene, camera);
  overlayDate();
  if (!paused) animationFrameId = requestAnimationFrame(animate);
}

const DATE_ELEM = document.getElementById("date");

function overlayDate() {
  let dateNow = dateOfDay(jdNow);
  DATE_ELEM.innerHTML =(dateNow.getFullYear() + " / " +
                        ('0' + (1+dateNow.getMonth())).slice(-2) + " / " +
                        ('0' + dateNow.getDate()).slice(-2));
}

function togglePause() {
  paused = !paused;
  if (paused) {
    controls.enabled = true;
    let id = animationFrameId;
    animationFrameId = undefined;
    if (id !== undefined) cancelAnimationFrame(id);
  } else {
    controls.enabled = trackingMode == "sky";
    camera.up.set(0, 1, 0);
    animate();
  }
}

DATE_ELEM.addEventListener("click", togglePause);

function setPlanetPositions() {
  for (let p of ["sun", "venus", "mars", "jupiter", "saturn", "mercury"]) {
    let [x, y, z] = ssModel1.xyzRel(p, jdNow);
    // xecl -> zgl, yecl -> xgl, zecl -> ygl
    planets[p].position.set(y, z, x);
    labels[p].position.set(y, z, x);
  }
  const sun = planets.sun.position;
  const mars = planets.mars.position;
  labels.antisun.position.set(-sun.x, -sun.y, -sun.z);
  labels.sunmars.position.set(mars.x-sun.x, mars.y-sun.y, mars.z-sun.z);
}

function getFloat32Geom(nVerts, itemSize, pointGen) {
  const a = new Float32Array(nVerts * itemSize);
  if (pointGen !== undefined) {
    let offset = 0;
    for (const vert of pointGen(nVerts)) {
      a.set(vert, offset);
      offset += itemSize;
    }
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(a, itemSize));
  return geom;
}

function setupSky() {
  // See https://svs.gsfc.nasa.gov/4851
  // Converted with exrtopng from http://scanline.ca/exrtools/ then
  // equirectangular to cubemap using images/starmapper.py script in this repo.
  // The starmapper script will also produce equitorial and galactic
  // coordinate oriented cubes.
  const textureMaps = [  // URLs of the six faces of the cube map
    "starmap_2020_4k_rt.png",
    "starmap_2020_4k_lf.png",
    "starmap_2020_4k_tp.png",
    "starmap_2020_4k_bt.png",
    "starmap_2020_4k_fr.png",
    "starmap_2020_4k_bk.png"
  ];

  scene.add(camera);

  THREE.DefaultLoadingManager.onLoad = () => {
    camera.position.set(0, 0, 0);
    camera.up.set(0, 1, 0);
    camera.scale.set(1, 1, 1);
    animate();
  }

  scene.background = new THREE.CubeTextureLoader()
    .setPath("images/")
    .load(textureMaps);
  scene.backgroundIntensity = 0.5;  // 0.3-0.4 fades to less distracting level
  // scene.backgroundBlurriness = 0.04

  // It would be more efficient to draw ecliptic, equator, and pole marks
  // directly onto the sky map.
  let geom = getFloat32Geom(
    200, 3, function*(nVerts) {
      let dtheta = 2*Math.PI / nVerts;
      for (let i=0 ; i<nVerts ; i++) {
        let theta = i*dtheta;
        // theta is RA, celestial +x -> +z, celestial +y -> +x
        yield [100*Math.sin(theta), 0., 100*Math.cos(theta)];
      }
    });
  const solidLine = new THREE.LineBasicMaterial({color: 0x446644});
  const ecliptic = new THREE.LineLoop(geom, solidLine);
  scene.add(ecliptic);
  geom = getFloat32Geom(
    200, 3, function*(nVerts) {
      let dtheta = 2*Math.PI / nVerts;
      let eps = 23.43928 * Math.PI/180.;
      let [ce, se] = [Math.cos(eps), Math.sin(eps)];
      for (let i=0 ; i<nVerts ; i++) {
        let theta = i*dtheta;
        // theta is RA, celestial +x -> +z, celestial +y -> +x
        let [x, y] = [100*Math.cos(theta), 100*Math.sin(theta)];
        yield [y*ce, -y*se, x];
      }
    });
  const equator = new THREE.LineLoop(geom, solidLine);
  // equator.computeLineDistances();  Cannot make dashed lines work??!!
  scene.add(equator);
  const poleMarks = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(
      [new THREE.Vector3(-3, 100, 0), new THREE.Vector3(3, 100, 0),
       new THREE.Vector3(0, 100, -3), new THREE.Vector3(0, 100, 3),
       new THREE.Vector3(-3, -100, 0), new THREE.Vector3(3, -100, 0),
       new THREE.Vector3(0, -100, -3), new THREE.Vector3(0, -100, 3)]),
    solidLine);
  scene.add(poleMarks);

  planets.sun = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: new THREE.TextureLoader().load("images/sun-alpha.png"),
      color: 0xffffff, sizeAttenuation: false}));
  planets.sun.scale.set(0.15, 0.15, 1);  // correct scale is about 0.08

  const planetTexture = new THREE.TextureLoader().load(
    "images/planet-alpha.png");
  planets.venus = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: planetTexture,
      color: 0xffffff, sizeAttenuation: false}));
  planets.venus.scale.set(0.04, 0.04, 1);
  planets.mars = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: planetTexture,
      color: 0xffcccc, sizeAttenuation: false}));
  planets.mars.scale.set(0.04, 0.04, 1);

  planets.jupiter = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: planetTexture,
      color: 0xffffff, sizeAttenuation: false}));
  planets.jupiter.scale.set(0.04, 0.04, 1);
  planets.saturn = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: planetTexture,
      color: 0xffffcc, sizeAttenuation: false}));
  planets.saturn.scale.set(0.04, 0.04, 1);
  planets.mercury = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: planetTexture,
      color: 0xffffff, sizeAttenuation: false}));
  planets.mercury.scale.set(0.025, 0.025, 1);

  labels.sun = makeLabel("sun", {}, 2, 1.8);
  labels.venus = makeLabel("venus", {}, 2, 1.25);
  labels.mars = makeLabel("mars", {}, 2, 1.25);
  labels.antisun = makeLabel("anti-sun", {}, 2);
  labels.sunmars = makeLabel("sun-mars", {}, 2);
  labels.mercury = makeLabel("mercury", {}, 2, 1.25);
  labels.jupiter = makeLabel("jupiter", {}, 2, 1.25);
  labels.saturn = makeLabel("saturn", {}, 2, 1.25);

  camera.lookAt(1, 0, 0);
  cameraTracking("sky");
  setPlanetPositions();
  scene.add(planets.sun);
  scene.add(planets.venus);
  scene.add(planets.mars);
  scene.add(planets.jupiter);
  scene.add(planets.saturn);
  scene.add(planets.mercury);

  scene.add(labels.sun);
  scene.add(labels.venus);
  scene.add(labels.mars);
  scene.add(labels.antisun);
  scene.add(labels.sunmars);
  scene.add(labels.mercury);
  scene.add(labels.jupiter);
  scene.add(labels.saturn);
}

function getProp(params, name, value) {
  return params.hasOwnProperty(name)? params[name] : value;
}

function makeLabel(text, params, tick=0, gap=-0.5) {
  if (params === undefined) params = {};
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  // style variant weight size[/lineheight] family[,fam2,fam3,...]
  // style = normal | italic | oblique
  // variant = small-caps
  // weight = normal | bold | bolder | lighter | 100-900 (400 normal, 700 bold)
  // size = in px or em, optional /lineheight in px or em
  // family = optional
  let font = getProp(params, "font", "16px Arial, sans-serif");
  ctx.font = font;
  let fontSize = parseFloat(ctx.font.match(/(?<value>\d+\.?\d*)/).groups.value);
  let {actualBoundingBoxLeft, actualBoundingBoxRight, actualBoundingBoxAscent,
       actualBoundingBoxDescent} = ctx.measureText(text);
  let [textWidth, textHeight] = [
    actualBoundingBoxLeft + actualBoundingBoxRight + 2,
    actualBoundingBoxAscent + actualBoundingBoxDescent + 2];
  if (!text) [textWidth, textHeight] = [0, 0];
  // Make tick and gap sizes scale with fontSize
  tick = tick * fontSize;
  gap = gap * fontSize;
  const thinText = textWidth < 1 - ((gap<0)? -2*gap : 0);
  canvas.width = thinText? ((gap<0)? 1-2*gap : 2) : textWidth;
  canvas.height = 2*tick + ((gap<0)? 0 : gap) + textHeight;
  ctx.font = font;
  // rgba(r, g, b, a)  either 0-255 or 0.0 to 1.0, a=0 transparent
  // or just a color
  ctx.fillStyle = getProp(params, "color", "#ffffff9f");
  ctx.fillText(text, actualBoundingBoxLeft+1,
               canvas.height-textHeight+actualBoundingBoxAscent+1);
  if (tick) {
    ctx.lineWidth = 2;
    ctx.strokeStyle = ctx.fillStyle;
    ctx.beginPath();
    ctx.moveTo(0.5*textWidth, 0.);
    ctx.lineTo(0.5*textWidth, tick);
    if (gap < 0) {
      ctx.moveTo(0.5*textWidth+gap, tick);
      ctx.lineTo(0.5*textWidth-gap, tick);
      ctx.moveTo(0.5*textWidth, tick);
      gap = 0;  // for bottom tick and sprite.center below
    } else {
      ctx.moveTo(0.5*textWidth, tick + gap);
    }
    ctx.lineTo(0.5*textWidth, 2*tick + gap);
    ctx.stroke();
  }

  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial(
      { map: new THREE.CanvasTexture(canvas), sizeAttenuation: false }));
  if (tick) {
    sprite.center.set(0.5, 1. - (tick+0.5*gap)/canvas.height);
  }
  // Sprite canvas initially maps onto a square that is 1x1 world units,
  // and presumably at a 1 unit distance when sizeAttenuation false.
  // Now the size of the planet sprites, along with the skybox background
  // scale, depends on the window width according to setFOVParams.  However,
  // these sprite labels need to stay a constant size for legibility, which
  // means we would like to set up the sprite scaling so the size in pixels
  // of the sprite always matches the size it is displayed at.
  // SPRITE_SCALE is exactly this scale factor.  Note that this assumes
  // sizeAttenutation is false; otherwise there is an additional factor of
  // the relative z to the camera.
  sprite.userData.width = canvas.width;
  sprite.userData.height = canvas.height;
  sprite.scale.set(canvas.width*SPRITE_SCALE, canvas.height*SPRITE_SCALE, 1);
  return sprite;
}

window.addEventListener("resize", () => {
  const elem = renderer.domElement;
  const [width, height] = [window.innerWidth, window.innerHeight];
  setFOVParams(width, height);
  for (let name in labels) {
    const label = labels[name];
    const width=label.userData.width, height=label.userData.height;
    label.scale.set(width*SPRITE_SCALE, height*SPRITE_SCALE, 1);
  }
  elem.width = width;
  elem.height = height;
  camera.aspect = width / height;
  camera.fov = VFOV;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
  renderer.render(scene, camera);
}, false);

/* ------------------------------------------------------------------------ */
// SkyControls allows you to drag the sky more intuitively than any of
// the built-in ontrols (OrbitControls, FlyControls, etc.)

const _changeEvent = { type: 'change' };
const _startEvent = { type: 'start' };
const _endEvent = { type: 'end' };

class SkyControls extends THREE.EventDispatcher {
  constructor(camera, domElement) {
    super();

    this.camera = camera;
    this.domElement = domElement;
    this.domElement.style.touchAction = "none";  // disable touch scroll

    this.enabled = true;
    this.speed = 1.0;

    const self = this;  // copy binding for subsequent functions
    let dragStrategy = true;
    const pointers = [];
    // Allocate working objects just once here.
    const u = new THREE.Vector3();
    const p = new THREE.Vector3();
    const q = new THREE.Vector3();
    const u0 = new THREE.Vector3();
    const q0 = new THREE.Vector3();
    const pxq = new THREE.Vector3();
    const pp = new THREE.Vector3();
    const tmp = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const qtmp = new THREE.Quaternion();

    this.dispose = function() {
      const domElement = self.domElement;
      domElement.removeEventListener("pointerdown", onPointerDown);
      domElement.removeEventListener("pointercancel", onPointerUp);
      domElement.removeEventListener("pointermove", onPointerMove);
      domElement.removeEventListener("pointerup", onPointerUp);
    }

    this.update = function() {
      return function() {
        const camera = self.camera;
      }
    }();

    function getXY(event) {
      let x, y;
      if (event.pointerType === "touch") {
        [x, y] = [event.pageX, event.pageY];
        if (pointers.length > 1) {
          let i = (event.pointerId == pointers[0].pointerId)? 1 : 0;
          x = 0.5*(x + pointers[i].pageX);
          y = 0.5*(y + pointers[i].pageY);
        }
      } else {
        [x, y] = [event.clientX, event.clientY];
      }
      return [x, y];
    }

    function getXYZ(event) {
      let [x, y] = getXY(event);
      // (x, y) are tan(angle) / scale
      const height = self.domElement.clientHeight;
      const width = self.domElement.clientWidth;
      const fov = self.camera.fov;  // vertical field of view (VFOV)
      const camera = self.camera;
      const scale = 2*Math.tan(fov * Math.PI/360) / height;
      // screen x --> camera x, screen y -> camera -y
      x = (x - 0.5*width)*scale;
      y = (0.5*height - y)*scale;
      let z = 1 / Math.sqrt(x**2 + y**2 + 1);
      x *= z;
      y *= z;
      // Camera looks toward its -z axis (not +z)!
      return [x, y, -z];  // camera coordinate unit vector of selected point
    }

    /*
     * Solve x*c + y*s = w for unit vector (c, s), assuming w**2 <= x**2+y**2.
     * Consider the rotated coordinate system in which (x,y) is (r,0):
     *   x = (x/r)*xp - (y/r)*yp
     *   y = (y/r)*xp + (x/r)*yp
     * The dot product is rotation invariant, so x*c + y*s = xp*cp + yp*sp = w,
     * or  r*cp = w, and the solution is cp = w/r.  Since (cp, sp) is a unit
     * vector, sp = +-sqrt(1-cp**2).  Transforming back to original coordinates,
     *   c = (x/r)*cp - (y/r)*sp
     *   s = (y/r)*cp + (x/r)*sp
     * In the applications here, we always want the smallest positive s root,
     * and the sign of w is indeterminate. (sometimes??)
     */
    function dotSolve(x, y, w, eitherSign=false) {
      const rr = 1 / Math.sqrt(x**2 + y**2);
      const cp = w * rr;
      const sp = Math.sqrt(Math.max(1 - cp**2, 0));  // roundoff protection
      let [cx, cy] = [x*cp*rr, -y*sp*rr];
      let [sx, sy] = [y*cp*rr, x*sp*rr];
      // Solution is either (cx+cy, sx+sy) or (cx-cy, sx-sy).
      // This is way too ugly - surely there is a better way...
      if (eitherSign) {
        [cx, cy] = [Math.abs(cx), Math.abs(cy)];
        [sx, sy] = [Math.abs(sx), Math.abs(sy)];
        return [cx+cy, Math.abs(sx-sy)];

      // Other cases do not work properly??  Sometimes give s<0.
      } else if (sx < 0) {
        return (sy > 0)? [cx+cy, sx+sy] : [cx-cy, sx-sy];
      } else if (sy < 0) {
        return (sx+sy<=0)? [cx-cy, sx-sy] : [cx+cy, sx+sy];
      } else {
        return (sx-sy>0)? [cx-cy, sx-sy] : [cx+cy, sx+sy];
      }
    }

    function onPointerDown(event) {
      if (!self.enabled) return;
      const domElement = self.domElement;
      if (pointers.length === 0) {
        domElement.setPointerCapture(event.pointerId)
        domElement.addEventListener("pointermove", onPointerMove);
        domElement.addEventListener("pointerup", onPointerUp);
      }
      pointers.push(event);
      let [x, y, z] = getXYZ(event);
      p.set(x, y, z);
      self.dispatchEvent(_startEvent);

      u.set(0, 1, 0);  // north eclipptic pole
      self.camera.worldToLocal(u);
      dragStrategy = u.y > ((u.z < 0)? p.y : -p.y);
    }

    function onPointerMove(event) {
      if (!self.enabled) return;
      let [x, y, z] = getXYZ(event);
      q.set(x, y, z);
      if (q.equals(p)) return;
      q0.copy(q);
      // Note that a camera looks along its -z-axis (not +z!)!
      const camera = self.camera;
      u.set(0, 1, 0);  // north pole
      camera.worldToLocal(u);
      u.x = 0;
      u.normalize();
      u0.copy(u);
      if (dragStrategy) {  // Star under pointer on down stays under pointer.
        let udotp = u.dot(p);
        /* Since u.x=0, u.dot(q) just involves (q.y, q.z), so the problem
         * is to find (u.y, u.z) on the unit circle such that this new u
         * has u.dot(q) equal to udotp.  If we work in the coordinate
         * system with its axis along (q.y, q.z), where q = (qr, 0) and
         * u = (ua, ub), u.dot.q = qr*ua = udotp, so ua = udotp/qr.  We can
         * work out ub from the condition that u is a unit vector, and
         * always choose ub>0 in this rotated system.
         * u = (ua*q.y-ub*q.z, ua*q.z+ub*q.y) in the (y, z) coordinates
         * There are two things that can go wrong:
         * 1. abs(ua) > 1
         * 2. u.y = ua*q.y-ub*q.z < 0, note that q.z<0 and ub>0 always
         * In either case, we need to fall back and move q back toward p.
         */
        let qr = Math.sqrt(q.y**2 + q.z**2);  // p.z and q.z > 0 always
        let ua = udotp / qr;
        let ub = 1 - ua**2;
        if (ub < 0) {
          qr = Math.abs(udotp);
          ua = (udotp < 0)? -1 : 1;
          ub = 0.;
          /* Move q to make qr = abs(udotp).  Let pp = perpendicular to p, so
           * new q = p*c + pp*s, and qx = px*c + ppx*s = +-sqrt(1-udot**2),
           * where (c,s) is a unit vector and s should be small and positive.
           */
          pxq.crossVectors(p, q).normalize();
          pp.crossVectors(pxq, p).normalize();  // normalize any roundoff errors
          let [c, s] = dotSolve(p.x, pp.x, Math.sqrt(1 - udotp**2), true);
          q.copy(p).multiplyScalar(c).add(tmp.copy(pp).multiplyScalar(s));
        }
        ub = Math.sqrt(ub);
        [u.y, u.z] = [(ua*q.y - ub*q.z)/qr, (ua*q.z + ub*q.y)/qr];
        const eps = 0.00001;
        const epsc = Math.sqrt(1 - eps**2);
        dragStrategy = u.y > 0;
        if (!dragStrategy) {
          /* This means up - the north pole - wants to move into the lower
           * hemisphere of the camera.  We do not allow this, so we change
           * to a "pivot strategy" in which we put move u exactly to
           * (0, +-1) (with the sign  of the u.z corresponding to the u.y<0,
           * and rotate about u by the angle from the rotated p to the final q
           * instead of trying to actually move p to q.
           */
          [u.y, u.z] = [0, (u.z < 0)? -1 : 1];
        }
        /* Set quaternion to the first rotation (about x axis). */
        quat.setFromUnitVectors(u0, u);  // so u = u0.applyQuaternion(quat))
        p.applyQuaternion(quat);
      } else {  // Rotate around NEP or SEP using only directions of p, q.
        quat.setFromUnitVectors(u, u);
      }
      p.sub(tmp.copy(u).multiplyScalar(u.dot(p)));
      q.sub(tmp.copy(u).multiplyScalar(u.dot(q)));
      qtmp.setFromUnitVectors(p.normalize(), q.normalize());  // p->q, u->u
      quat.premultiply(qtmp);
      if (!dragStrategy) {
        
      }
      // camera.quaternion is worldToLocal transform
      camera.quaternion.multiply(quat.conjugate());
      p.copy(q0);  // Subsequent move needs to begin from original q.
      self.dispatchEvent(_changeEvent);
    }

    function onPointerUp(event) {
      for (let i=0; i<pointers.length; i++) {
        if (pointers[i].pointerId == event.pointerId) {
          pointers.splice(i, 1);
          break;
        }
      }
      if (pointers.length === 0) {
        const domElement = self.domElement;
        domElement.releasePointerCapture(event.pointerId)
        domElement.removeEventListener("pointermove", onPointerMove);
        domElement.removeEventListener("pointerup", onPointerUp);
      }
      self.dispatchEvent(_endEvent);
    }

    domElement.addEventListener("pointerdown", onPointerDown);
    domElement.addEventListener("pointercancel", onPointerUp);
  }
}

const controls = new SkyControls(camera, renderer.domElement);
controls.addEventListener("change", () => {
  renderer.render(scene, camera);
});
controls.enabled = trackingMode == "sky";

/* ------------------------------------------------------------------------ */

if ( WebGL.isWebGLAvailable() ) {
  setupSky();
} else {
  const warning = WebGL.getWebGLErrorMessage();
  document.getElementById( 'container' ).appendChild( warning );
  console.log("Your graphics card does not seem to support WebGL");
}
