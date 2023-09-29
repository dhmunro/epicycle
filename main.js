// import * as THREE from 'three';
import {Scene, PerspectiveCamera, WebGLRenderer, Vector3, EllipseCurve,
        Matrix4, DefaultLoadingManager, Sprite, SpriteMaterial, TextureLoader,
        CubeTextureLoader, CanvasTexture, EventDispatcher, Quaternion
       } from 'three';
import WebGL from 'three/addons/capabilities/WebGL.js';
import {Line2} from 'three/addons/lines/Line2.js';
import {LineMaterial} from 'three/addons/lines/LineMaterial.js';
import {LineGeometry} from 'three/addons/lines/LineGeometry.js';
import {LineSegments2} from 'three/addons/lines/LineSegments2.js';
import {LineSegmentsGeometry} from 'three/addons/lines/LineSegmentsGeometry.js';

// console.log(THREE.REVISION);  --> 155

/* Ideas:

   1. Ruler tool: Double click to set one end, switch to ruler mode,
      leaving mark at position of double click and creating second mark
      that can be dragged around, showing HUD with delta (lon, lat) and
      angular distance to first mark.

   2. Overlay showing model with orthographic camera.  This should show
      both orbits, with grid that rotates when animation is on.  In Venus
      mode, can show either Sun orbit or Earth orbit, with animation
      flipping the two.  Inactive orbit dims but still visible (so three
      orbits shown).  In Mars mode, the epicycle-heliocentric mode
      animation swaps the orbit centers in addition to flipping the
      orbits; the radius parallelogram is shown.  Possibly add third
      tychonic switch.

   3. Survey Earth orbit - animation goes until Mars opposition, then
      puts mark on sky and orbit, producing a new mark each Mars year,
      along with the Earth-Mars and Earth-Sun sight lines.

   4. Survey Mars orbit - sky scene fades out, animation is in diagram
      showing sight lines moving with pause at each earth year marking
      new point on Mars orbit.

 */

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

const scene = new Scene();
const camera = new PerspectiveCamera(VFOV, ASPECT, 0.1, 2000);
const renderer = new WebGLRenderer(
  {canvas: document.getElementById("container"), antialias: true, alpha: true});
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setClearColor( 0x000000, 0.0 );
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
const ra2xyz = (ra) => [Math.sin(ra), 0, Math.cos(ra)];
const jd2xyz = { sun: (jd) => ra2xyz(sun0+sunt*jd),
                 mars: (jd) => ra2xyz(mars0+marst*jd) };
// J2000 obliquity of ecliptic 23.43928 degrees

let jdInitial = dayOfDate(new Date());
let jdNow = null;  // signals reset to jdInitial
let daysPerSecond = 40;
let trackingMode = "sky";

const planets = {};
const labels = {};

let dialogOpen = false;
let animationFrameId = undefined;

const labelsForModes = {
  sky: ["sun", "mercury", "venus", "mars", "jupiter", "saturn", "antisun"],
  sun: ["sun", "meansun"],
  venus: ["sun", "venus", "earth"],
  mars: ["sun", "mars",  "antisun", "sunmars", "earth"]
};

function cameraTracking(tracking) {
  for (let name in labels) labels[name].visible = false;
  labelsForModes[tracking].forEach((name) => {labels[name].visible = true;});
  trackingMode = tracking;
  pointCameraForMode();
  const skyMode = trackingMode == "sky";
  scene.backgroundIntensity = skyMode? 0.6 : 0.3;
  controls.enabled = skyMode || skyAnimator.isPaused;
  for (let name of ["sun", "venus", "earth", "mars"]) {
    ellipses[name].visible = false;
  }
  if (showOrbits) {
    ellipses.earth.visible = helioCenter;
    ellipses.sun.visible = !helioCenter;
    ellipses.sun.position.set(0, 0, 0);
    ellipses.mars.position.set(0, 0, 0);
    if (skyMode) {
      ellipses.venus.visible = true;
      ellipses.mars.visible = true;
    } else if (trackingMode == "venus") {
      ellipses.venus.visible = true;
    } else if (trackingMode == "mars") {
      ellipses.mars.visible = true;
      if (polarAnimator.isPolar) labels.antisun.visible = false;
    }
  }
  render();
}

function render() {
  setPlanetPositions();
  if (!skyAnimator.isPaused) pointCameraForMode();
  renderer.render(scene, camera);
  overlayDate();
}

function pointCameraForMode() {
  if (trackingMode == "sky") return;
  let rsun = planets.sun.position;
  let z = rsun.z, x = rsun.x;  // rsun=(z,x) and rperp=(-x,z)
  if (trackingMode == "mars") {
    let rmars = planets.mars.position;
    [x, z] = [rmars.x-rsun.x, rmars.z-rsun.z];
  } else if (trackingMode == "sun") {
    let rmean = labels.meansun.position;
    [x, z] = [rmean.x, rmean.z];
  }
  if (polarAnimator.isPolar) {
    const pos = camera.position;
    if (helioCenter) {
      camera.position.set(rsun.x, pos.y, rsun.z);
    } else if (pos.x**2+pos.z**2 > 0.2) {
      camera.position.set(0, pos.y, 0);
    }
  } else {
    camera.lookAt(x, 0, z);
  }
}

/* ------------------------------------------------------------------------ */

function addListenerTo(elem, eventType, callback) {
  elem.addEventListener(eventType, callback);
}

function connectRadioButton(id, callback) {
  const elem = document.getElementById(id);
  elem.addEventListener("change", callback);
  radioButtons.push(elem);
}

const radioButtons = [];

function disableRadioButtons(state=true) {
  radioButtons.forEach(b => {
    if (b.checked) disableLabeledInput(b, false);
    else disableLabeledInput(b, state);
  });
}

function checkRadioButton(iButton) {
  radioButtons.forEach((b, i) => {
    b.checked = (i == iButton);
  });
}

function disableLabeledInput(elem, state) {
  if (state) {
    elem.setAttribute("disabled", "");
    elem.parentElement.classList.add("disabled");
  } else {
    elem.removeAttribute("disabled");
    elem.parentElement.classList.remove("disabled");
  }
}

function date4jd(jd) {
  let date = dateOfDay(jd);
  return (date.getFullYear() + "-" +
          ("0" + (1+date.getMonth())).slice(-2) + "-" +
          ("0" + date.getDate()).slice(-2));
}

function jd4date(text) {
  let parts = text.split("-");
  const minus = parts[0] == "";
  if (minus) parts = parts.slice(1);
  parts = parts.map((v) => parseInt(v));
  if (minus) parts[0] = -parts[0];
  const date = new Date();
  date.setFullYear(parts[0]);
  date.setMonth((parts.length>1)? parts[1]-1 : 0);
  date.setDate((parts.length>2)? parts[2] : 1);
  return dayOfDate(date);
}

function setStartDate(event) {
  const text = event.target.value;
  const match = event.target.value.match(/(-?[012]\d\d\d)(-\d\d)?(-\d\d)?/);
  const jd = match? jd4date(event.target.value) : jdInitial;
  jdInitial = jd;
  jdNow = null;
  DATE_BOX.value = date4jd(jdInitial);
  gotoStartDate();
}

function gotoStartDate() {
  jdNow = null;
  // Collect orbital parameters for modelScene
  setEllipseShapes(jdInitial + 3653);  // plus 10 yrs
  setPlanetPositions();  // before pointCameraMode, even if paused
  pointCameraForMode();
  render();
}

let titleOpen = true;
const THE_TITLE = document.getElementById("thetitle");
document.getElementById("xtitle").addEventListener("click", () => {
  closeTitle(true);
});
document.getElementById("tour").addEventListener("click", takeTour);
function closeTitle(activateDialog=false) {
  if (!titleOpen) return;
  titleOpen = false;
  THE_TITLE.classList.add("hidden");
  if (activateDialog && !dialogOpen) toggleDialog();
}
const THE_TOUR = document.getElementById("thetour");
const INFO_ELEM = document.getElementById("top-info");
INFO_ELEM.addEventListener("click", toggleInfo);
const INFO_BODY = document.getElementById("theinfo");

const DATE_ELEM = document.getElementById("date");
const PAUSE_ELEM = document.getElementById("pause");
const PLAY_ELEM = document.getElementById("play");
const DIALOG_ELEM = document.getElementById("dialog");
const CHEVRON_ELEM = document.getElementById("chevron-right");
const XMARK_ELEM = document.getElementById("xmark");

const LEFT_DIALOG = document.getElementById("left-dialog");
const DIALOG_HIDER = `translate(-${LEFT_DIALOG.clientWidth}px)`;
DIALOG_ELEM.style.transform = DIALOG_HIDER;

connectRadioButton("sky", () => setTrackingMode("sky"));
connectRadioButton("sun", () => setTrackingMode("sun"));
connectRadioButton("venus", () => setTrackingMode("venus"));
connectRadioButton("mars", () => setTrackingMode("mars"));

function setTrackingMode(mode) {
  cameraTracking(mode);
  disableRadioButtons(polarAnimator.isPolar || centerSwap);
  if (mode == "venus") {
    disableLabeledInput(POLAR_CHECKBOX, !showOrbits || helioCenter);
    if (SWAP_CHECKBOX.checked) unswapCenters();
    disableLabeledInput(SWAP_CHECKBOX, true);
  } else if (mode == "mars") {
    disableLabeledInput(POLAR_CHECKBOX, !showOrbits || helioCenter);
    disableLabeledInput(SWAP_CHECKBOX, helioCenter);
  } else {
    disableLabeledInput(POLAR_CHECKBOX, true);
    if (SWAP_CHECKBOX.checked) unswapCenters();
    disableLabeledInput(SWAP_CHECKBOX, true);
  }
  disableLabeledInput(HELIO_CHECKBOX, !polarAnimator.isPolar || centerSwap);
}

function unswapCenters() {
  centerSwap = false;
  SWAP_CHECKBOX.checked = false;
}

const DATE_BOX = document.getElementById("date-box");
addListenerTo(DATE_BOX, "change", setStartDate);
const RESTART_BUTTON = document.getElementById("restart");
addListenerTo(RESTART_BUTTON, "click", gotoStartDate);
const FULLSCREEN_ICON = document.querySelector("#fullscreen > use");
document.getElementById("fullscreen").addEventListener("click",
                                                       toggleFullscreen);

let showOrbits=false, centerSwap=false;
const SHOW_CHECKBOX = document.getElementById("showorb");
SHOW_CHECKBOX.addEventListener("change", (e) => {
  showOrbits = e.target.checked;
  setTrackingMode(trackingMode);
});
const SWAP_CHECKBOX = document.getElementById("swap");
SWAP_CHECKBOX.addEventListener("change", (e) => {
  if (centerSwap == !e.target.checked) {
    if (polarAnimator.isPolar) {
      swapAnimator.toggle();
    } else {
      centerSwap = e.target.checked;
      setTrackingMode(trackingMode);
    }
  }
});
const POLAR_CHECKBOX = document.getElementById("polar");
POLAR_CHECKBOX.addEventListener("change", (e) => {
  if (e.target.checked) {
    ["saturn", "jupiter", "mercury"].forEach(p => {
      planets[p].visible = false; });
    if (trackingMode == "mars") planets.venus.visible = false;
    else planets.mars.visible = false;
  }
  polarAnimator.toggle();
});
let helioCenter = false;
const HELIO_CHECKBOX = document.getElementById("helio");
HELIO_CHECKBOX.addEventListener("change", (e) => {
  if (helioCenter == !e.target.checked) {
    if (!helioCenter) disableLabeledInput(SWAP_CHECKBOX, true);
    helioAnimator.toggle();
  }
});

function overlayDate() {
  DATE_ELEM.innerHTML = date4jd((jdNow===null)? jdInitial : jdNow);
}

const _dummyVector = new Vector3();

function recenterEcliptic() {
  camera.up.set(0, 1, 0);
  let dir = camera.getWorldDirection(_dummyVector);
  if (dir.x != 0 || dir.z != 0) {
    dir.y = 0;
    dir.normalize();
  } else {
    dir.set(1, 0, 0);
  }
  camera.lookAt(dir.x, 0, dir.z);
}

function togglePause() {
  if (titleOpen) closeTitle();
  if (polarAnimator.isPlaying || helioAnimator.isPlaying ||
      tourPlaying || infoOpen) return;
  if (!skyAnimator.isPaused) {
    ppToggler(PLAY_ELEM, PAUSE_ELEM);
    controls.enabled = true;
    if (!dialogOpen) CHEVRON_ELEM.classList.remove("hidden");
    skyAnimator.pause();
  } else {
    ppToggler(PAUSE_ELEM, PLAY_ELEM);
    controls.enabled = trackingMode == "sky";
    if (!polarAnimator.isPolar) recenterEcliptic();
    if (!dialogOpen
        && trackingMode!="sky") CHEVRON_ELEM.classList.add("hidden");
    skyAnimator.play();
  }
}

function ppToggler(elemOn, elemOff, toggler) {
  elemOff.removeEventListener("click", togglePause);
  elemOff.classList.add("hidden");
  elemOn.classList.remove("hidden");
  elemOn.addEventListener("click", togglePause);
}

addListenerTo(PAUSE_ELEM, "click", togglePause);

function toggleDialog() {
  if (infoOpen) return;
  dialogOpen = !dialogOpen;
  if (dialogOpen) {
    diaToggler(XMARK_ELEM, CHEVRON_ELEM);
    DIALOG_ELEM.style.transform = "translate(0)";
    DATE_BOX.value = date4jd(jdInitial);
  } else {
    diaToggler(CHEVRON_ELEM, XMARK_ELEM);
    DIALOG_ELEM.style.transform = DIALOG_HIDER;
    if (trackingMode != "sky" &&
        !skyAnimator.isPaused) CHEVRON_ELEM.classList.add("hidden");
  }
}

function diaToggler(elemOn, elemOff) {
  elemOff.removeEventListener("click", toggleDialog);
  elemOff.classList.add("hidden");
  elemOn.classList.remove("hidden");
  elemOn.addEventListener("click", toggleDialog);
}

addListenerTo(CHEVRON_ELEM, "click", toggleDialog);

/* ------------------------------------------------------------------------ */

function setPlanetPositions() {
  const jd = (jdNow===null)? jdInitial : jdNow;
  let x, y, z;
  for (let p of ["sun", "venus", "mars", "jupiter", "saturn", "mercury"]) {
    [x, y, z] = ssModel1.xyzRel(p, jd);
    // xecl -> zgl, yecl -> xgl, zecl -> ygl
    planets[p].position.set(y, z, x);
    labels[p].position.set(y, z, x);
  }
  const sun = planets.sun.position;
  const mars = planets.mars.position;
  labels.antisun.position.set(-sun.x, -sun.y, -sun.z);
  labels.sunmars.position.set(mars.x-sun.x, mars.y-sun.y, mars.z-sun.z);
  [x, y, z] = jd2xyz.sun(jd);
  labels.meansun.position.set(x, 0, z);
  if (showOrbits) {
    ellipses.earth.position.set(sun.x, sun.y, sun.z);
    const venus = planets.venus.position;
    if (trackingMode == "sky") {
      ellipses.venus.position.set(sun.x, sun.y, sun.z);
      ellipses.mars.position.set(sun.x, sun.y, sun.z);
      radii.venus.geometry.setPositions([sun.x, sun.y, sun.z,
                                         venus.x, venus.y, venus.z]);
      radii.mars.geometry.setPositions([sun.x, sun.y, sun.z,
                                        mars.x, mars.y, mars.z]);
    } else if (trackingMode == "venus") {
      ellipses.venus.position.set(sun.x, sun.y, sun.z);
      radii.venus.geometry.setPositions([sun.x, sun.y, sun.z,
                                         venus.x, venus.y, venus.z]);
      radii.earth.geometry.setPositions([0, 0, 0,  sun.x, sun.y, sun.z]);
    } else if (trackingMode == "mars") {
      const sm = labels.sunmars.position;
      if (centerSwap) {
        ellipses.sun.position.set(sm.x, sm.y, sm.z);
        radii.gmars.geometry.setPositions([sun.x, sun.y, sun.z,
                                           mars.x, mars.y, mars.z]);
        radii.gearth.geometry.setPositions([0, 0, 0,  sun.x, sun.y, sun.z]);
        radii.mars.geometry.setPositions([0, 0, 0, sm.x, sm.y, sm.z]);
        radii.earth.geometry.setPositions([sm.x, sm.y, sm.z,
                                           mars.x, mars.y, mars.z]);
      } else {
        ellipses.mars.position.set(sun.x, sun.y, sun.z);
        radii.mars.geometry.setPositions([sun.x, sun.y, sun.z,
                                          mars.x, mars.y, mars.z]);
        radii.earth.geometry.setPositions([0, 0, 0,  sun.x, sun.y, sun.z]);
        radii.gmars.geometry.setPositions([0, 0, 0, sm.x, sm.y, sm.z]);
        radii.gearth.geometry.setPositions([sm.x, sm.y, sm.z,
                                            mars.x, mars.y, mars.z]);
      }
      radii.gearth.computeLineDistances();  // for dash lengths
      radii.gmars.computeLineDistances();
    }
  }
}

const CIRCLE_N = 180;  // actually 181 points
const circlePoints = new EllipseCurve().getPoints(CIRCLE_N).map(
  p => [p.y, 0, p.x]);

const fatLineMaterials = [];

const ellipses = (() => {
  const shapes = { matrix: new Matrix4(), vector: new Vector3() };
  [["sun", 0xccccff], ["venus", 0xcccccc],
   ["earth", 0xccccff], ["mars", 0xffcccc]].forEach(([p, c]) => {
     let geom = new LineGeometry();
     geom.setPositions(circlePoints.flat());
     shapes[p] = new Line2(geom, new LineMaterial(
       {color: c, linewidth: 2, dashed: false, dashSize: 0.03, gapSize: 0.05}));
     fatLineMaterials.push(shapes[p].material);
     shapes[p].visible = false;
     scene.add(shapes[p]);
  });
  return shapes;
})();

const radii = (() => {
  function makeRadius(c, dashed=false) {
    const geom = new LineGeometry();
    geom.setPositions([0, 0, 0,  1, 0, 0]);
    const line = new Line2(geom, new LineMaterial(
      {color: c, linewidth: 2, dashed: dashed, dashSize: 0.03, gapSize: 0.05}));
    fatLineMaterials.push(line.material);
    line.visible = false;
    scene.add(line);
    return line;
  }
  return {
    earth: makeRadius(0xccccff),
    venus: makeRadius(0xcccccc),
    mars: makeRadius(0xffcccc),
    gearth: makeRadius(0xccccff, true),
    gmars: makeRadius(0xffcccc, true)
  }
})();

function setEllipseShapes(day) {
  let xAxis, yAxis, zAxis, e, a, b, ea, ma, madot;
  let {matrix, vector} = ellipses;
  for (let p of ["venus", "earth", "mars"]) {
    [xAxis, yAxis, zAxis, e, a, b, ea, ma, madot] = orbitParams(p, day);
    // Construct matrix which takes points generated by this EllipseCurve
    // into [xAxis, yAxis, zAxis] basis (by point.applyMatrix3).
    // (x, y, z) in ecliptic coords --> (y, z, x) in GL coords
    xAxis = xAxis.map(v => a*v);
    yAxis = yAxis.map(v => b*v);
    matrix.set(yAxis[1], zAxis[1], xAxis[1], -e*xAxis[1],
               yAxis[2], zAxis[2], xAxis[2], -e*xAxis[2],
               yAxis[0], zAxis[0], xAxis[0], -e*xAxis[0],
               0, 0, 0, 1);
    let pts = circlePoints.map(p => {
      vector.set(...p).applyMatrix4(matrix);
      return [vector.x, vector.y, vector.z];
    });
    let geom = ellipses[p].geometry;
    geom.setPositions(pts.flat());
    if (p == "earth") {
      ellipses.earth.computeLineDistances();
      ellipses.sun.computeLineDistances();
      geom = ellipses.sun.geometry;
      geom.setPositions(pts.map(p => [-p[0], -p[1], -p[2]]).flat());
    }
  }
}

/* ------------------------------------------------------------------------ */

const solidLine = new LineMaterial({color: 0x335577, linewidth: 2});
const dashedLine = new LineMaterial({
  color: 0x335577, linewidth: 3,
  dashed: true, dashScale: 1.5, dashSize: 10, gapSize: 10});
fatLineMaterials.push(solidLine, dashedLine);

function setFatLineResolutions() {
  fatLineMaterials.forEach(m => {
    m.resolution.set(WIDTH, HEIGHT);  // crucial!!
    m.resolution.needsUpdate = true;
  });
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

  // scene.add(camera);

  DefaultLoadingManager.onLoad = () => {
    camera.position.set(0, 0, 0);
    camera.up.set(0, 1, 0);
    camera.scale.set(1, 1, 1);
    fixSpriteScales();
    skyAnimator.play();
  }

  scene.background = new CubeTextureLoader()
    .setPath("images/")
    .load(textureMaps);
  scene.backgroundIntensity = 0.6;  // 0.3-0.4 fades to less distracting level

  // It would be more efficient to draw ecliptic, equator, and pole marks
  // directly onto the sky map.
  setFatLineResolutions();
  let geom = new LineGeometry();
  geom.setPositions(
    new EllipseCurve(0, 0, 1000, 1000).getPoints(24).map(
      p => [p.x, p.y, 0]).flat());
  const ecliptic = new Line2(geom, solidLine);
  ecliptic.rotation.x = Math.PI / 2;
  scene.add(ecliptic);
  const equator = new Line2(geom, dashedLine);
  equator.computeLineDistances();
  equator.rotation.x = Math.PI / 2;
  equator.rotation.y = -23.43928 * Math.PI/180.;
  scene.add(equator);
  geom = new LineSegmentsGeometry();
  geom.setPositions([-30, 1000, 0,  30, 1000, 0, 0, 1000, -30,  0, 1000, 30,
                     -30,-1000, 0,  30,-1000, 0, 0,-1000, -30,  0,-1000, 30]);
  const poleMarks = new LineSegments2(geom, solidLine);
  scene.add(poleMarks);
  const qpoleMarks = new LineSegments2(geom, dashedLine);
  qpoleMarks.computeLineDistances();
  qpoleMarks.rotation.z = -23.43928 * Math.PI/180.;
  scene.add(qpoleMarks);

  planets.sun = new Sprite(
    new SpriteMaterial({
      map: new TextureLoader().load("images/sun-alpha.png"),
      color: 0xffffff, sizeAttenuation: false}));
  textureSpriteSetScale(planets.sun, 0.6);  // correct scale is about 0.03

  const planetTexture = new TextureLoader().load(
    "images/planet-alpha.png");
  planets.venus = new Sprite(
    new SpriteMaterial({
      map: planetTexture,
      color: 0xffffff, sizeAttenuation: false}));
  textureSpriteSetScale(planets.venus, 0.6);
  planets.mars = new Sprite(
    new SpriteMaterial({
      map: planetTexture,
      color: 0xffcccc, sizeAttenuation: false}));
  textureSpriteSetScale(planets.mars, 0.6);

  planets.jupiter = new Sprite(
    new SpriteMaterial({
      map: planetTexture,
      color: 0xffffff, sizeAttenuation: false}));
  textureSpriteSetScale(planets.jupiter, 0.6);
  planets.saturn = new Sprite(
    new SpriteMaterial({
      map: planetTexture,
      color: 0xffffcc, sizeAttenuation: false}));
  textureSpriteSetScale(planets.saturn, 0.6);
  planets.mercury = new Sprite(
    new SpriteMaterial({
      map: planetTexture,
      color: 0xffffff, sizeAttenuation: false}));
  textureSpriteSetScale(planets.mercury, 0.4);

  planets.earth = new Sprite(
    new SpriteMaterial({
      map: planetTexture,
      color: 0xccccff, sizeAttenuation: false}));
  textureSpriteSetScale(planets.earth, 0.6);

  labels.sun = makeLabel("sun", {}, 2, 1.8);
  labels.venus = makeLabel("venus", {}, 2, 1.25);
  labels.mars = makeLabel("mars", {}, 2, 1.25);
  labels.antisun = makeLabel("anti-sun", {}, 2);
  labels.meansun = makeLabel("mean-sun", {}, 4, 0);
  labels.sunmars = makeLabel("sun-mars", {}, 2);
  labels.mercury = makeLabel("mercury", {}, 2, 1.25);
  labels.jupiter = makeLabel("jupiter", {}, 2, 1.25);
  labels.saturn = makeLabel("saturn", {}, 2, 1.25);
  labels.earth = makeLabel("earth", {}, 2, 1.25);

  camera.lookAt(-1, 0, 0);
  cameraTracking("sky");
  setPlanetPositions();
  scene.add(planets.sun);
  scene.add(planets.venus);
  scene.add(planets.mars);
  scene.add(planets.jupiter);
  scene.add(planets.saturn);
  scene.add(planets.mercury);
  scene.add(planets.earth);

  scene.add(labels.sun);
  scene.add(labels.venus);
  scene.add(labels.mars);
  scene.add(labels.antisun);
  scene.add(labels.meansun);
  scene.add(labels.sunmars);
  scene.add(labels.mercury);
  scene.add(labels.jupiter);
  scene.add(labels.saturn);
  scene.add(labels.earth);

  setEllipseShapes(jdInitial);
}

function fixSpriteScales() {  // call from onLoad
  // planet sprite image data not available during setupSky
  for (name in planets) {
    const sprite = planets[name];
    const mapData = sprite.material.map.source.data;
    const width = mapData.width * sprite.userData.width;
    const height = mapData.height * sprite.userData.height;
    sprite.userData.width = width;
    sprite.userData.height = height;
    sprite.scale.set(width*SPRITE_SCALE, height*SPRITE_SCALE, 1);
  }
}

function textureSpriteSetScale(sprite, scalex, scaley) {
  // just save relative scale for later
  sprite.userData.width = scalex;
  sprite.userData.height = scaley? scaley : scalex;
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

  const sprite = new Sprite(
    new SpriteMaterial(
      { map: new CanvasTexture(canvas), sizeAttenuation: false }));
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
  setFOVParams(window.innerWidth, window.innerHeight);
  elem.width = WIDTH;
  elem.height = HEIGHT;
  camera.aspect = ASPECT;
  let fov, spriteScale;
  if (polarAnimator.isPolar) {
    changeCameraFOV(polarAnimator.polarFOV);
  } else {
    changeCameraFOV(VFOV, SPRITE_SCALE);
  }
  renderer.setSize(WIDTH, HEIGHT);
  setFatLineResolutions();
  render();
}, false);

function changeCameraFOV(fov, spriteScale) {
  if (spriteScale === undefined) {
    spriteScale = 2 * Math.tan(fov * Math.PI/360.) / HEIGHT;
  }
  for (let name in labels) {
    const sprite = labels[name];
    const width = sprite.userData.width, height = sprite.userData.height;
    sprite.scale.set(width*spriteScale, height*spriteScale, 1);
  }
  for (let name in planets) {
    const sprite = planets[name];
    const width = sprite.userData.width, height = sprite.userData.height;
    sprite.scale.set(width*spriteScale, height*spriteScale, 1);
  }
  camera.fov = fov
  camera.updateProjectionMatrix();
}

/* ------------------------------------------------------------------------ */

class Animator {
  constructor(...parts) {
    // Each argument is either a callback function or a delay time in ms.
    // Callback function argument is ms with first call always 0 and
    // subsequent calls the time interval since previous call in ms.
    // The callback should return true when finished, false until then.
    // Callbacks are invoked with 'this' set to Animator instance, so you
    // can access other data you have stored as properties.

    function makeTimer(timeout) {
      const original = timeout;
      let timeLeft = timeout;
      function timer(dt) {
        if (dt !== null) timeLeft -= dt;
        else timeLeft = original;  // reset the timer
        return timeLeft <= 0;
      }
      timer.wantsAnimatorResetCallback = true;
      return timer;
    }

    this.parts = parts.map(p => Number.isFinite(p)? makeTimer(p) : p);
    this.stepper = undefined;  // will be called by requestAnimationFrame
    this.frameId = undefined;  // returned by requestAnimationFrame
    this.onFinish = undefined;  // called when animation finishes
    this._paused = true;
  }

  play = () => {
    this._cancelPending();
    this._paused = false;
    let stepper = this.stepper;
    if (stepper === undefined) {  // start new run
      let msPrev = null, iPart = 0;
      const self = this;
      function stepper(ms) {  // argument is window.performance.now();
        self._cancelPending();  // cancel any pending frame requests
        if (ms !== null) {
          const parts = self.parts;
          let dms = 0;
          if (msPrev !== null) {
            dms = ms - msPrev;
            if (dms <= 0) dms = 1;  // assure finite step after start
          }
          msPrev = ms;
          while (parts[iPart].call(self, dms)) {  // iPart finished
            iPart += 1;
            if (iPart >= parts.length) {  // whole animation finished
              self.stop();
              return;
            }
            // This is a loop to permit any part to abort on its first call,
            // and to make the initial call to the next part immediately
            // after final call to previous part, rather than waiting for
            // next animation frame request callback.
            dms = 0;
          }
        } else {
          // To wake up from pause, just reset msPrev to huge value.
          // First step after pause will be very short interval (1 ms).
          msPrev = 1.e30;
        }
        self.frameId = requestAnimationFrame(self.stepper);
      }
      self.stepper = stepper;
      stepper(window.performance.now());
    } else {  // wake up from pause
      stepper(null);
    }
  }

  pause = () => {
    this._cancelPending();
    this._paused = true;
  }

  stop = (noOnFinish=false) => {
    this.pause();
    this.stepper = undefined;
    this.parts.forEach(p => {
      if (p.wantsAnimatorResetCallback) p(null);
    });
    let onFinish = this.onFinish;
    this.onFinish = undefined;
    if (onFinish && !noOnFinish) onFinish.call(self);
  }

  get isPaused() {
    return this._paused;
  }

  get isPlaying() {
    return this.stepper !== undefined;
  }

  _cancelPending = () => {
    let id = this.frameId;
    this.frameId = undefined;
    if (id !== undefined) cancelAnimationFrame(id);
  }
}

class PolarViewAnimator extends Animator {
  constructor(skyAnimator) {
    super(dms => (this.rate > 0)? (dms => true) : this._longZoom(dms),
          dms => (this.rate > 0)? this._rZoom(dms) : this._latZoom(dms),
          dms => (this.rate > 0)? this._latZoom(dms) : this._rZoom(dms));

    this.skyAnimator = skyAnimator;
    this.rate = 0.002;  // sign toggles to indicate direction
    this.polarFOV = 45;  // vertical FOV in polar view
    this.rCameraMax = 0;  // rCamera goes from 0 to rCameraMax (venus 5, mars 7)
    this.rCamera = 0;  // distance of polar view from earth (AU)
    this.axisCamera = [0, 0, 1];
    this.latCamera = 0;
    this.longCamera = 0;
    this.unpauseSky = false;
    this._polar = false;
  }

  reset() {
    if (this.isPlaying) this.stop();
    this.rate = Math.abs(this.rate);
    this.rCameraMax = 0;  // rCamera goes from 0 to rCameraMax (venus 5, mars 7)
    this.rCamera = 0;  // distance of polar view from earth (AU)
    this.axisCamera = [0, 0, 1];
    this.latCamera = 0;
    this.longCamera = 0;
    this.unpauseSky = false;
    this._polar = false;
    ["saturn", "jupiter", "mars", "venus", "mercury"].forEach(p => {
      planets[p].visible = true; });
    if (trackingMode == "mars") labels.antisun.visible = true;
    ["earth", "venus", "mars", "gearth", "gmars"].forEach(p => {
      radii[p].visible = false;
    });
  }

  toggle() {
    const skyAnimator = this.skyAnimator;
    const mode = trackingMode;
    const rCameraMax = PolarViewAnimator.rCameraMaxs[mode];
    if (!rCameraMax) return;

    this.rCameraMax = rCameraMax;
    this.label = (mode == "venus")? labels.sun : labels.sunmars;
    const unpauseSky = !skyAnimator.isPaused;
    this.onFinish = () => {
      this.rate = ((this.latCamera > 0.785)? -1 : 1) * Math.abs(this.rate);
      if (this.rate > 0) {
        camera.up.set(0, 1, 0);
        ["saturn", "jupiter", "mars", "venus", "mercury"].forEach(p => {
          planets[p].visible = true; });
        if (trackingMode == "mars") labels.antisun.visible = true;
        ["earth", "venus", "mars", "gearth", "gmars"].forEach(p => {
          radii[p].visible = false;
        });
        disableLabeledInput(SHOW_CHECKBOX, false);
        disableRadioButtons(centerSwap);
      } else {
        if (!centerSwap) disableLabeledInput(HELIO_CHECKBOX, false);
      }
      const unpauseSky = this.unpauseSky;
      this.unpauseSky = false;
      if (unpauseSky) skyAnimator.play();
      else render();  // to have visibility changes take effect
    };
    POLAR_CHECKBOX.checked = !this._polar;
    if (!this._polar) {
      disableRadioButtons(true);
      pointCameraForMode();
    }
    disableLabeledInput(HELIO_CHECKBOX, true);
    this.unpauseSky = unpauseSky;
    if (unpauseSky) skyAnimator.pause();
    this.play();
  }

  get isPolar() {
    return this._polar;
  }

  _rZoom(dms) {
    if (dms == 0) {
      if (this.rate < 0) return;  // _longZoom first in this case
      disableLabeledInput(SHOW_CHECKBOX, true);
      ["saturn", "jupiter", "mercury"].forEach(p => {
        planets[p].visible = false; });
      if (trackingMode == "mars") {
        planets.venus.visible = false;
        labels.antisun.visible = false;
        ["earth", "mars", "gearth", "gmars"].forEach(p => {
          radii[p].visible = true;
        });
      } else {
        planets.mars.visible = false;
        ["earth", "venus"].forEach(p => {
          radii[p].visible = true;
        });
      }
      // set camera axis, longitude, latitude
      this._setupZoom();
      return false;
    }
    const rMax = this.rCameraMax;
    const dr = this.rate * dms;
    let r = this.rCamera + dr;
    let done = dr < 0 && r < 0;
    if (done) {
      r = 0;
    } else {
      done = dr > 0 && r > rMax;
      if (done) r = rMax;
    }
    this.rCamera = r;
    const frac = r / rMax;
    changeCameraFOV(VFOV*(1-frac) + this.polarFOV*frac);
    const axis = this.axisCamera;
    camera.position.set(r*axis[0], 0, r*axis[2]);
    render();
    return done;
  }

  _latZoom(dms) {
    if (dms == 0) {
      if (this.angRate > 0) this._polar = true;
      return false;
    }
    const axis = this.axisCamera;
    const dlat = this.angRate * dms;
    let lat = this.latCamera + dlat;
    let done = dlat < 0 && lat < 0;
    if (done) {
      this._polar = false;
      lat = 0;
    } else {
      done = dlat > 0 && lat > Math.PI/2;
      if (done) lat = Math.PI/2;
    }
    this.latCamera = lat;
    let rMax = this.rCameraMax;
    let c = rMax*Math.cos(lat), s = rMax*Math.sin(lat);
    camera.position.set(c*axis[0], s, c*axis[2]);
    camera.lookAt(0, 0, 0);
    render();
    return done;
  }

  _longZoom(dms) {
    if (dms == 0) {
      if (this.rate > 0) return;  // _rZoom first in this case
      // set camera axis, longitude, latitude
      let ax0 = [-this.axisCamera[2], -this.axisCamera[0]];
      this._setupZoom();
      let ax = [PolarViewAnimator.vec.z, PolarViewAnimator.vec.x];
      // Complete rotation should take ax0 --> ax; both have y=0.
      let ca = ax0[0]*ax[0] + ax0[1]*ax[1];
      let sa = ax0[0]*ax[1] - ax0[1]*ax[0];
      let lon = Math.atan2(sa, ca);  // total rotation about z (CCW>0, CW<0)
      this.longSign = (lon < 0)? 1 : -1;
      lon = Math.abs(lon);
      if (lon < 1.e-3) return true;
      this.longCamera = lon;
      return false;
    }
    let dlong = this.angRate * dms;  // always < 0!
    let lon = this.longCamera + dlong;
    let done = lon <= 0;
    if (done) {
      lon = 0;
      dlong = -this.longCamera;
    }
    this.longCamera = lon;
    camera.rotateZ(this.longSign * dlong);  // in camera coordinates
    render();
    return done;
  }

  _setupZoom() {
    const rMax = this.rCameraMax;
    this.angRate = this.rate * 1.57/rMax;
    const vec = PolarViewAnimator.vec;
    vec.copy(this.label.position);
    vec.y = 0;
    vec.normalize();
    this.axisCamera = [-vec.x, 0, -vec.z];
    let sqrth = Math.sqrt(0.5);
    camera.up.set(sqrth*vec.x, sqrth, sqrth*vec.z);
  }

  static rCameraMaxs = {venus: 5, mars: 7};
  static vec = new Vector3();
}

const skyAnimator = new Animator(dms => {
  if (jdNow === null) {
    jdNow = jdInitial;
  } else {
    jdNow += 0.001 * dms * daysPerSecond;
  }
  render();
  return false;
});

const polarAnimator = new PolarViewAnimator(skyAnimator);

class OrbitCenterSwapper extends Animator {
  constructor() {
    super(dms => this._swapper(dms));

    this.swapTime = 2;  // time to swap in seconds
    this.frac = 0;
    this.unpauseSky = false;
  }

  toggle() {
    const unpauseSky = !skyAnimator.isPaused;
    if (!centerSwap) disableLabeledInput(HELIO_CHECKBOX, true);
    this.onFinish = () => {
      const unpauseSky = this.unpauseSky;
      this.unpauseSky = false;
      centerSwap = !centerSwap;
      setTrackingMode(trackingMode);
      if (unpauseSky) skyAnimator.play();
    };
    SWAP_CHECKBOX.checked = !centerSwap;
    this.unpauseSky = unpauseSky;
    if (unpauseSky) skyAnimator.pause();
    this.play();
  }

  _swapper(dms) {
    if (dms == 0) {
      ["sun", "mars", "sunmars"].forEach(name => {
        let pos = labels[name].position;
        this[name] = [pos.x, pos.y, pos.z];
      });
    }
    const interp = this._interp;
    let frac;
    // ellipses.sun: 0 -> sm
    // ellipses.mars: sun -> 0
    // radii.earth: (0, sun) -> (sm, mars)
    // radii.mars: (sun, mars) -> (0, sm)
    const sun=this.sun, mars=this.mars, sm=this.sunmars, zero=[0, 0, 0];
    if (dms == 0) {
      if (centerSwap) {
        this.frac = frac = 1;
        this.frate = -0.001/this.swapTime;
      } else {
        this.frac = frac = 0;
        this.frate = 0.001/this.swapTime;
      }
      radii.gearth.geometry.setPositions(
        [interp(frac, zero, sm), interp(frac, sun, mars)].flat());
      radii.gmars.geometry.setPositions(
        [interp(frac, sun, zero), interp(frac, mars, sm)].flat());
      return false;
    }
    frac = this.frac;
    frac += this.frate * dms;
    let done = (this.frate > 0) && (frac >= 1);
    if (done) {
      frac = 1;
    } else {
      done = (this.frate < 0) && (frac <= 0);
      if (done) frac = 0;
    }
    this.frac = frac;
    ellipses.sun.position.set(...interp(frac, zero, sm));
    ellipses.mars.position.set(...interp(frac, sun, zero));
    radii.earth.geometry.setPositions(
      [interp(frac, zero, sm), interp(frac, sun, mars)].flat());
    radii.mars.geometry.setPositions(
      [interp(frac, sun, zero), interp(frac, mars, sm)].flat());
    renderer.render(scene, camera);  // raw render
    return done;
  }

  _interp(f, v0, v1) {
    const g = 1 - f;
    return v0.map((a, i) => g*a + f*v1[i]);
  }
}

const swapAnimator = new OrbitCenterSwapper();

class HelioCenterSwapper extends Animator {
  constructor() {
    super(dms => this._swapper(dms), dms => this._slider(dms));

    this.swapTime = 2;  // time to swap in seconds
    this.frac = 0;
    this.unpauseSky = false;
  }

  toggle() {
    const unpauseSky = !skyAnimator.isPaused;
    this.onFinish = () => {
      const unpauseSky = this.unpauseSky;
      this.unpauseSky = false;
      helioCenter = !helioCenter;
      ellipses.sun.material.dashed = false;
      ellipses.earth.material.dashed = false;
      setTrackingMode(trackingMode);
      if (unpauseSky) skyAnimator.play();
      if (this.tourCallback) {
        this.tourCallback();
        delete this.tourCallback;
      }
    };
    HELIO_CHECKBOX.checked = !helioCenter;
    this.unpauseSky = unpauseSky;
    if (unpauseSky) skyAnimator.pause();
    this.play();
  }

  _swapper(dms) {
    if (dms == 0) {
      this.rate = 0.001 * Math.PI / this.swapTime;
      this.ang = Math.PI;
      let active, passive;
      if (helioCenter) [active, passive] = ["sun", "earth"];
      else [active, passive] = ["earth", "sun"];
      this.active = ellipses[active];
      this.passive = ellipses[passive];
      let pos0 = planets[active].position;
      let pos1 = planets[passive].position;
      this.active.visible = true;
      this.passive.material.dashed = true;
      this.pos0 = [pos0.x, pos0.y, pos0.z];
      this.pos1 = [pos1.x, pos1.y, pos1.z];
      return false;
    }
    const yaxis = HelioCenterSwapper.yaxis;
    let ang = this.ang;
    ang -= this.rate * dms;
    let done = ang <= 0;
    if (done) ang = 0;
    this.ang = ang;
    // start active at pos0 rotated by pi, animate to pos1 rotated by 0
    let pos0 = this.pos0, pos1 = this.pos1;
    if (done) {
      this.active.position.set(0, 0, 0);
      this.active.setRotationFromAxisAngle(yaxis, 0);
      this.active.position.set(...this.pos1);
    } else {
      this.active.position.set(0, 0, 0);
      this.active.setRotationFromAxisAngle(yaxis, ang);
      const cen = pos1.map((p, i) => 0.5*(p + pos0[i]));
      const dp = pos1.map((p, i) => p - cen[i]);  // dp[1] always very near 0
      const c = Math.cos(ang), s = Math.sin(ang);
      const pos = [cen[0]+c*dp[0]+s*dp[2], cen[1], cen[2]+c*dp[2]-s*dp[0]];
      this.active.position.set(...pos);
    }
    renderer.render(scene, camera);  // raw render
    return done;
  }

  _slider(dms) {
    if (dms == 0) {
      // most setup already done in _swapper
      this.rate = 0.001 / this.swapTime;
      this.frac = 0;
      this.ycamera = camera.position.y;
      return false;
    }
    let frac = this.frac;
    frac += this.rate * dms;
    let done = frac >= 1;
    if (done) frac = 1;
    this.frac = frac;
    // active has arrived at pos1 from pos0, need camera to pan to look there
    let pos0 = this.pos0, pos1 = this.pos1;
    const pos = pos1.map((p, i) => pos0[i]*(1-frac) + p*frac);
    camera.position.set(pos[0], this.ycamera, pos[2]);
    if (done) {
      this.passive.visible = false;
      this.passive.material.dashed = false;
    }
    renderer.render(scene, camera);  // raw render
    return done;
  }

  static yaxis = new Vector3(0, 1, 0);
}

const helioAnimator = new HelioCenterSwapper();

/* ------------------------------------------------------------------------ */
// SkyControls allows you to drag the sky more intuitively than any of
// the built-in ontrols (OrbitControls, FlyControls, etc.)

const _changeEvent = { type: 'change' };
const _startEvent = { type: 'start' };
const _endEvent = { type: 'end' };

class SkyControls extends EventDispatcher {
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
    const u = new Vector3();
    const p = new Vector3();
    const q = new Vector3();
    const u0 = new Vector3();
    const q0 = new Vector3();
    const pxq = new Vector3();
    const pp = new Vector3();
    const tmp = new Vector3();
    const quat = new Quaternion();
    const qtmp = new Quaternion();

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
      if (!self.enabled || tourPlaying || infoOpen) return;
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
      u.set(0, 1, 0);  // north ecliptic pole
      self.camera.worldToLocal(u);
      dragStrategy = u.y > ((u.z < 0)? p.y : -p.y);
    }

    function onPointerMove(event) {
      if (!self.enabled || polarAnimator.isPolar) return;
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
  render();
});
controls.enabled = trackingMode == "sky";

/* ------------------------------------------------------------------------ */

function amFullscreen() {
  return (document.fullScreenElement && document.fullScreenElement !== null) ||
    (document.mozFullScreen || document.webkitIsFullScreen);
}

function goFullscreen() {
  if (amFullscreen()) return;
  const el = document.documentElement;
  const rfs = el.requestFullScreen || el.webkitRequestFullScreen ||
        el.mozRequestFullScreen || el.msRequestFullscreen;
  rfs.call(el);
}

function stopFullscreen() {
  if (!amFullscreen()) return;
  const el = document;
  const cfs = el.cancelFullScreen || el.webkitCancelFullScreen ||
        el.mozCancelFullScreen || el.exitFullscreen || el.webkitExitFullscreen;
  cfs.call(el);
}

if (amFullscreen()) {
  FULLSCREEN_ICON.setAttribute("xlink:href", "#fa-compress");
}

function toggleFullscreen() {
  if (amFullscreen()) {
    stopFullscreen();
    FULLSCREEN_ICON.setAttribute("xlink:href", "#fa-expand");
  } else {
    goFullscreen();
    FULLSCREEN_ICON.setAttribute("xlink:href", "#fa-compress");
  }
}

/* ------------------------------------------------------------------------ */

let infoOpen = false, infoUnseen = true;
const INFO_USE = INFO_ELEM.querySelector("use");
function toggleInfo() {
  if (titleOpen) closeTitle();
  if (tourPlaying) {
    INFO_USE.setAttribute("xlink:href", "#fa-circle-info");
    if (tourReject) tourReject(new Error("tour aborted"));
    return;
  }
  if (!infoOpen) {
    INFO_USE.setAttribute("xlink:href", "#fa-circle-xmark");
    if (dialogOpen) toggleDialog();
    if (!skyAnimator.isPaused) togglePause();
    INFO_BODY.parentElement.classList.remove("hidden");
    infoOpen = true;
    if (infoUnseen) {
      INFO_BODY.scrollTo(0, 0);
    } else {
      scrollToDialogState();
    }
  } else {
    INFO_USE.setAttribute("xlink:href", "#fa-circle-info");
    INFO_BODY.parentElement.classList.add("hidden");
    infoOpen = false;
    if (infoUnseen) {
      infoUnseen = false;
      if (!dialogOpen) toggleDialog();
    }
  }
}
const scrollSections = {};
INFO_BODY.querySelectorAll("a[id$='-section']").forEach(a => {
  scrollSections[a.id.replace("-section", "")] = a;
});

let tourPlaying = false;
function takeTour() {
  if (titleOpen) closeTitle();
  if (skyAnimator.isPaused) togglePause();
  tourPlaying = true;
  INFO_USE.setAttribute("xlink:href", "#fa-circle-xmark");
  let tourTopics = THE_TOUR.querySelectorAll(".tour-topic");
  // tourTopics = tourTopics[Symbol.iterator](); .next() -> {value, done}
  let topic = tourTopics[0];
  let parts = topic.querySelectorAll(".tour-p");
  topic.classList.remove("hidden");
  parts[0].classList.remove("hidden");
  THE_TOUR.classList.remove("hidden");
  setTrackingMode("sun");
  gotoStartDate();
  skyAnimator.pause();
  const partPromise = WaitNSeconds();
  partPromise.then(() => {
    THE_TOUR.classList.add("hidden");
    skyAnimator.play();
    return waitNDays(400);  // mean sun
  }).then(() => {
    parts[0].classList.add("hidden");
    parts[1].classList.remove("hidden");
    THE_TOUR.classList.remove("hidden");
    skyAnimator.pause();
    setTrackingMode("venus");
    gotoStartDate();
    return WaitNSeconds();
  }).then(() => {
    THE_TOUR.classList.add("hidden");
    skyAnimator.play();
    return waitNDays(700);  // venus tracking
  }).then(() => {
    parts[1].classList.add("hidden");
    parts[2].classList.remove("hidden");
    THE_TOUR.classList.remove("hidden");
    skyAnimator.pause();
    setTrackingMode("mars");
    gotoStartDate();
    return WaitNSeconds();
  }).then(() => {
    THE_TOUR.classList.add("hidden");
    skyAnimator.play();
    return waitNDays(900);  // mars tracking
  }).then(() => {
    parts[2].classList.add("hidden");
    topic.classList.add("hidden");
    topic = tourTopics[1];
    parts = topic.querySelectorAll(".tour-p");
    topic.classList.remove("hidden");
    parts[0].classList.remove("hidden");
    THE_TOUR.classList.remove("hidden");
    skyAnimator.pause();
    SHOW_CHECKBOX.checked = true;
    showOrbits = true;
    setTrackingMode("venus");
    gotoStartDate();
    return WaitNSeconds();
  }).then(() => {
    THE_TOUR.classList.add("hidden");
    skyAnimator.play();
    return waitNDays(584);  // venus, orbit shown
  }).then(() => {
    ["saturn", "jupiter", "mercury", "mars"].forEach(p => {
      planets[p].visible = false; });
    polarAnimator.toggle();
    return waitNDays(800);  // venus, polar view
  }).then(() => {
    parts[0].classList.add("hidden");
    parts[1].classList.remove("hidden");
    THE_TOUR.classList.remove("hidden");
    skyAnimator.pause();
    return WaitNSeconds();
  }).then(() => {
    THE_TOUR.classList.add("hidden");
    skyAnimator.play();
    if (!helioCenter) disableLabeledInput(SWAP_CHECKBOX, true);
    helioAnimator.toggle();
    return waitNDays(800);  // venus, heliocentric
  }).then(() => {
    helioAnimator.toggle();
    return waitNDays(1);
  }).then(() => {
    polarAnimator.toggle();
    return waitNDays(1);
  }).then(() => {
    parts[1].classList.add("hidden");
    parts[2].classList.remove("hidden");
    THE_TOUR.classList.remove("hidden");
    skyAnimator.pause();
    gotoStartDate();
    SWAP_CHECKBOX.checked = true;
    centerSwap = true;  // swapAnimator.toggle();
    setTrackingMode("mars");
    return WaitNSeconds();
  }).then(() => {
    THE_TOUR.classList.add("hidden");
    skyAnimator.play();
    return waitNDays(780);  // mars, epicycle orbit shown
  }).then(() => {
    ["saturn", "jupiter", "mercury", "venus"].forEach(p => {
      planets[p].visible = false; });
    polarAnimator.toggle();
    return waitNDays(1000);  // mars, epicycle polar view
  }).then(() => {
    parts[2].classList.add("hidden");
    parts[3].classList.remove("hidden");
    THE_TOUR.classList.remove("hidden");
    skyAnimator.pause();
    return WaitNSeconds();
  }).then(() => {
    THE_TOUR.classList.add("hidden");
    skyAnimator.play();
    swapAnimator.toggle();
    return waitNDays(1000);  // mars, tychonic polar view
  }).then(() => {
    parts[3].classList.add("hidden");
    parts[4].classList.remove("hidden");
    THE_TOUR.classList.remove("hidden");
    skyAnimator.pause();
    return WaitNSeconds();
  }).then(() => {
    THE_TOUR.classList.add("hidden");
    skyAnimator.play();
    if (!helioCenter) disableLabeledInput(SWAP_CHECKBOX, true);
    helioAnimator.toggle();
    return waitNDays(1000);  // mars, heliocentric polar view
  }).then(() => {
    helioAnimator.toggle();
    return waitNDays(1);
  }).then(() => {
    polarAnimator.toggle();
    return waitNDays(1);
  }).then(() => {
    parts[4].classList.add("hidden");
    topic.classList.add("hidden");
    topic = tourTopics[2];
    parts = topic.querySelectorAll(".tour-p");
    topic.classList.remove("hidden");
    parts[0].classList.remove("hidden");
    THE_TOUR.classList.remove("hidden");
    skyAnimator.pause();
    gotoStartDate();
    SHOW_CHECKBOX.checked = false;
    showOrbits = false;
    setTrackingMode("sky");
    return WaitNSeconds();
  }).then(() => {
    tourReject = undefined;
    THE_TOUR.classList.add("hidden");
    topic.classList.add("hidden");
    parts[0].classList.add("hidden");
    skyAnimator.play();
    toggleDialog();
    tourPlaying = false;
    INFO_USE.setAttribute("xlink:href", "#fa-circle-info");
  }).catch((error) => {
    tourReject = undefined;
    THE_TOUR.classList.add("hidden");
    tourPlaying = false;
    INFO_USE.setAttribute("xlink:href", "#fa-circle-info");
    resetTracking();
    toggleDialog();
  });
}

function resetTracking() {
  if (infoOpen) toggleInfo();
  if (helioAnimator.isPlaying) helioAnimator.stop();
  if (swapAnimator.isPlaying) swapAnimator.stop();
  polarAnimator.reset();
  HELIO_CHECKBOX.checked = helioCenter = false;
  disableLabeledInput(HELIO_CHECKBOX, true);
  SWAP_CHECKBOX.checked = centerSwap = false;
  disableLabeledInput(SWAP_CHECKBOX, true);
  POLAR_CHECKBOX.checked = false;
  disableLabeledInput(POLAR_CHECKBOX, true);
  SHOW_CHECKBOX.checked = false;
  showOrbits = false;
  disableLabeledInput(SHOW_CHECKBOX, false);
  camera.position.set(0, 0, 0);
  camera.up.set(0, 1, 0);
  camera.lookAt(-1, 0, 0);
  checkRadioButton(0);
  setTrackingMode("sky");
  if (skyAnimator.isPaused) skyAnimator.play();
  togglePause();
  gotoStartDate();
}

let tourReject;
function waitNDays(djd) {
  let jd = (jdNow===null)? jdInitial : jdNow;
  const jdFinal = jd + djd/tourSpeedup;
  const checker = (resolve) => {
    jd = (jdNow===null)? jdInitial : jdNow;
    if (jd >= jdFinal) {
      resolve();
      return;
    }
    setTimeout(() => checker(resolve), 1000);
  };
  return new Promise((resolve, reject) => {
    tourReject = reject;
    checker(resolve);
  });
}

function WaitNSeconds(n=4000) {
  return new Promise((resolve, reject) => {
    tourReject = reject;
    setTimeout(resolve, n/tourSpeedup);
  });
}

let tourSpeedup = 1;

function scrollToDialogState() {
  // trackingMode, showOrbits, centerSwap, helioCenter, polarAnimator.isPolar;
  if (!showOrbits) {
    scrollSections[trackingMode].scrollIntoView();
  } else if (!polarAnimator.isPolar) {
    if (trackingMode == "mars") {
      scrollSections.mars1.scrollIntoView();
    } else if (trackingMode == "venus") {
      scrollSections.venus1.scrollIntoView();
    } else {
      scrollSections.model.scrollIntoView();
    }
  } else if (trackingMode == "mars") {
    if (helioCenter) scrollSections.mars4.scrollIntoView();
    else if (centerSwap) scrollSections.mars3.scrollIntoView();
    else scrollSections.mars2.scrollIntoView();
  } else if (trackingMode == "venus") {
    if (helioCenter) scrollSections.venus3.scrollIntoView();
    else scrollSections.venus2.scrollIntoView();
  } else {
    // should never get here
    INFO_BODY.scrollTo(0, 0);
  }
}

function setDialogTo(section) {
  resetTracking();  // toggles info, which toggles dialog
  if (section == "sky") {
    // resetTracking already did this
  } else if (section == "sun") {
    checkRadioButton(1);
    setTrackingMode("sun");
  } else if (section == "venus") {
    checkRadioButton(2);
    setTrackingMode("venus");
  } else if (section == "mars") {
    checkRadioButton(3);
    setTrackingMode("mars");
  } else if (section == "model") {
    SHOW_CHECKBOX.checked = true;
    showOrbits = true;
    checkRadioButton(0);
    setTrackingMode("sky");
  } else if (section == "venus1") {
    SHOW_CHECKBOX.checked = true;
    showOrbits = true;
    checkRadioButton(2);
    setTrackingMode("venus");
    if (skyAnimator.isPaused) skyAnimator.play();
  } else if (section == "venus2") {
    SHOW_CHECKBOX.checked = true;
    showOrbits = true;
    checkRadioButton(2);
    setTrackingMode("venus");
    jumpToPolar("venus");
  } else if (section == "venus3") {
    SHOW_CHECKBOX.checked = true;
    showOrbits = true;
    checkRadioButton(2);
    setTrackingMode("venus");
    HELIO_CHECKBOX.checked = true;
    helioCenter = true;
    jumpToPolar("venus");
  } else if (section == "mars1") {
    SHOW_CHECKBOX.checked = true;
    showOrbits = true;
    SWAP_CHECKBOX.checked = true;
    centerSwap = true;
    checkRadioButton(3);
    setTrackingMode("mars");
    if (skyAnimator.isPaused) skyAnimator.play();
  } else if (section == "mars2") {
    SHOW_CHECKBOX.checked = true;
    showOrbits = true;
    SWAP_CHECKBOX.checked = true;
    centerSwap = true;
    checkRadioButton(3);
    setTrackingMode("mars");
    jumpToPolar("mars");
  }
}

window.setDialogTo = setDialogTo;  // expose so accessible as onClick

function jumpToPolar(planet) {
  const r = PolarViewAnimator.rCameraMaxs[planet];
  const label = (planet == "venus")? labels.sun : labels.sunmars;
  polarAnimator.rCameraMax = r
  polarAnimator.label = label;
  polarAnimator.rate = -Math.abs(polarAnimator.rate);
  polarAnimator.unpauseSky = false;
  polarAnimator._polar = true;
  polarAnimator.rCamera = r;
  polarAnimator.latCamera = Math.PI/2;
  disableLabeledInput(SHOW_CHECKBOX, true);
  POLAR_CHECKBOX.checked = true;
  disableLabeledInput(POLAR_CHECKBOX, helioCenter);
  if (planet == "venus") {
    disableLabeledInput(HELIO_CHECKBOX, false);
  } else {
    disableLabeledInput(HELIO_CHECKBOX, !centerSwap);
  }
  ["saturn", "jupiter", "mercury"].forEach(p => {
    planets[p].visible = false; });
  if (planet == "mars") {
    planets.venus.visible = false;
    labels.antisun.visible = false;
    ["earth", "mars", "gearth", "gmars"].forEach(p => {
      radii[p].visible = true;
    });
  } else {
    planets.mars.visible = false;
    ["earth", "venus"].forEach(p => {
      radii[p].visible = true;
    });
  }
  // set camera axis, longitude, latitude
  camera.position.set(0, r, 0);
  polarAnimator._setupZoom();
  changeCameraFOV(polarAnimator.polarFOV)
  camera.lookAt(0, 0, 0);
  if (helioCenter) {
    let rsun = planets.sun.position;
    camera.position.set(rsun.x, r, rsun.z);
    ellipses.sun.visible = false;
    ellipses.earth.visible = true;
  }
  if (skyAnimator.isPaused) skyAnimator.play();
}

/* ------------------------------------------------------------------------ */

if ( WebGL.isWebGLAvailable() ) {
  setupSky();
} else {
  const warning = WebGL.getWebGLErrorMessage();
  document.getElementById( 'container' ).appendChild( warning );
  console.log("Your graphics card does not seem to support WebGL");
}
