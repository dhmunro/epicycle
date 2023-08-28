import * as THREE from 'three';
import WebGL from 'three/addons/capabilities/WebGL.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// console.log(THREE.REVISION);  --> 155

const HFOV = 100;  // horizontal field of view
let VFOV, WIDTH, HEIGHT, ASPECT;  // TAN_VFOV = 2*tan(VFOV/2)
let SPRITE_SCALE;  // sprite x, y scales are this times canvas width, height
function setFOVParams(width, height) {
  [WIDTH, HEIGHT, ASPECT] = [width, height, width/height];
  let tanHV = Math.tan(HFOV * Math.PI/360.) / ASPECT;
  VFOV = Math.atan(tanHV) * 360./Math.PI;
  SPRITE_SCALE = 0.5 / (tanHV * HEIGHT);
}
setFOVParams(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(VFOV, ASPECT, 0.1, 1000);

const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

//  mercury      venus      earth       mars     jupiter    saturn
// 0.2408467  0.61519726  1.0000174  1.8808476  11.862615  29.447498  yr
// relative to Sun, t in Julian centuries (36525 days):
// 102.93768193 + 0.32327364*t  lon of Earth's perihelion
// 100.46457166 + 35999.37244981*t  lon of Earth
// -23.94362959 + 0.44441088*t  lon of Mars's perihelion
//  -4.55343205 + 19140.30268499*t  lon of Mars
const [sun0, sunt, mars0, marst] = [
  280.46457166 * Math.PI/180., 35999.37244981/36525. * Math.PI/180.,
  -4.55343205 * Math.PI/180., 19140.30268499/36525. * Math.PI/180.];
// J2000 obliquity of ecliptic 23.43928 degrees

let jdNow = dayOfDate(new Date());
let pointingNow = "mars";
const jd2ra = { sun: (jd) => sun0+sunt*jd, mars: (jd) => mars0+marst*jd };

const planets = {};
const markers = {};
const labels = {};

let elongmx = 40, elongmn = -40;

function animate() {
  jdNow += 0.6;  // about 10 sec/yr
  setPlanetPositions();
  let rsun = planets.sun.position;
  let z=rsun.z, x=rsun.x;  // rsun=(z,x) and rperp=(-x,z)
  // let cosa = Math.cos(48.*Math.PI/180.), sina = Math.sin(48.*Math.PI/180.);
  // planets.jupiter.position.set(cosa*x+sina*z, 0.02, cosa*z-sina*x);
  // planets.saturn.position.set(cosa*x-sina*z, -0.02, cosa*z+sina*x);
  // let r = Math.sqrt(x**2 + z**2);
  // planets.jupiter.position.set(x, r*Math.tan(29.*Math.PI/180.), z);
  // planets.saturn.position.set(x, -r*Math.tan(29.*Math.PI/180.), z);
  if (pointingNow == "sun") {
    labels.venus.visible = true;
    labels.mars.visible = false;
    labels.sunmars.visible = false;
    rotateCameraTo(Math.atan2(x, z));
  } else if (pointingNow == "mars") {
    let rmars = planets.mars.position;
    [x, z] = [rmars.x-rsun.x, rmars.z-rsun.z];
    // let ra = jd2ra[pointingNow](jdNow);
    // if (ra > 2*Math.PI) ra -= 2*Math.PI;
    labels.venus.visible = false;
    labels.mars.visible = true;
    labels.sunmars.visible = true;
    // markers.antisun.position.set(Math.sin(ra), 0, Math.cos(ra));
    rotateCameraTo(Math.atan2(x, z));
  }
  // let ra = jd2ra[pointingNow](jdNow);
  // if (ra > 2*Math.PI) ra -= 2*Math.PI;
  // rotateCameraTo(ra);
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

function setPlanetPositions() {
  for (let p of ["sun", "venus", "mars", "jupiter", "saturn", "mercury"]) {
    let [x, y, z] = ssModel1.xyzRel(p, jdNow);
    // xecl -> zgl, yecl -> xgl, zecl -> ygl
    planets[p].position.set(y, z, x);
    if (p == "sun") {
      labels.antisun.position.set(-y, 0, -x);
      labels.sun.position.set(y, z, x);
    } else if (p == "mars") {
      labels.mars.position.set(y, z, x);
      [x, y, z] = [x-planets.sun.position.z, y-planets.sun.position.x,
                   z-planets.sun.position.y];
      labels.sunmars.position.set(y, z, x);
    } else if (p == "venus") {
      labels.venus.position.set(y, z, x);
    }
  }
}

function rotateCameraTo(ra) {
  const [x, z] = [Math.sin(ra), Math.cos(ra)];
  camera.lookAt(x, 0, z);
  // controls.update();
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
  const textureMaps = [  // URLs of the six faces of the cube map
    "starmap_2020_4k_rt.png",
    "starmap_2020_4k_lf.png",
    "starmap_2020_4k_tp.png",
    "starmap_2020_4k_bt.png",
    "starmap_2020_4k_fr.png",
    "starmap_2020_4k_bk.png"
  ];

  // let controls;

  scene.add(camera);
  // camera.position.z = 3;  // cannot be same as controls.target
  let zDir = new THREE.Vector3(0, 0, 1);
  let yDir = new THREE.Vector3(0, 1, 0);

  THREE.DefaultLoadingManager.onLoad = () => {
    camera.up = yDir;
    // camera.lookAt(1, 0, 0);
    // controls.update();
    // renderer.render(scene, camera);
    animate();
  }

  scene.background = new THREE.CubeTextureLoader()
    .setPath("images/")
    .load(textureMaps);
  scene.backgroundIntensity = 0.3  // 0.3-0.4 fades to less distracting level
  // scene.backgroundBlurriness = 0.04

  // controls = new OrbitControls(camera, renderer.domElement);
  // controls.addEventListener("change", () => renderer.render(scene, camera));

  const geom = getFloat32Geom(
    200, 3, function*(nVerts) {
      let dtheta = 2*Math.PI / nVerts;
      for (let i=0 ; i<nVerts ; i++) {
        let theta = i*dtheta;
        // theta is RA, celestial +x -> +z, celestial +y -> +x
        yield [100*Math.sin(theta), 0., 100*Math.cos(theta)];
      }
    });
  const eMat = new THREE.LineBasicMaterial({color: 0x446644});
  const ecliptic = new THREE.LineLoop(geom, eMat);
  scene.add(ecliptic);

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

  markers.antisun = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: planetTexture,
      color: 0x00ff00, sizeAttenuation: false}));
  markers.antisun.scale.set(0.04, 0.04, 1);
  markers.defmars = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: planetTexture,
      color: 0x00ff00, sizeAttenuation: false}));
  markers.defmars.scale.set(0.04, 0.04, 1);
  markers.antisun.visible = false;
  markers.defmars.visible = false;

  labels.sun = makeLabel("sun", {}, 50, 40);
  labels.venus = makeLabel("venus", {}, 50, 25);
  labels.mars = makeLabel("mars", {}, 50, 25);
  labels.antisun = makeLabel("anti-sun", {}, 50);
  labels.sunmars = makeLabel("sun-mars", {}, 50);
  if (pointingNow == "sun") {
    labels.antisun.visible = false;
    labels.sunmars.visible = false;
    labels.mars.visible = false;
  } else {
    labels.venus.visible = false;
  }

  setPlanetPositions();
  scene.add(planets.sun);
  scene.add(planets.venus);
  scene.add(planets.mars);
  scene.add(planets.jupiter);
  scene.add(planets.saturn);
  scene.add(planets.mercury);

  // planets.venus.visible = false;
  scene.add(labels.sun);
  scene.add(labels.venus);
  scene.add(labels.mars);
  scene.add(labels.antisun);
  scene.add(labels.sunmars);
}

function getProp(params, name, value) {
  return params.hasOwnProperty(name)? params[name] : value;
}

function makeLabel(text, params, tick=0, gap=-10) {
  if (params === undefined) params = {};
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  // style variant weight size[/lineheight] family[,fam2,fam3,...]
  // style = normal | italic | oblique
  // variant = small-caps
  // weight = normal | bold | bolder | lighter | 100-900 (400 normal, 700 bold)
  // size = in px or em, optional /lineheight in px or em
  // family = optional
  let font = getProp(params, "font", "18px Arial, sans-serif");
  ctx.font = font;
  // console.log(ctx.font);
  let {actualBoundingBoxLeft, actualBoundingBoxRight, actualBoundingBoxAscent,
       actualBoundingBoxDescent} = ctx.measureText(text);
  let [textWidth, textHeight] = [
    actualBoundingBoxLeft + actualBoundingBoxRight + 2,
    actualBoundingBoxAscent + actualBoundingBoxDescent + 2];
  canvas.width = textWidth;
  canvas.height = 2*tick + gap + textHeight;
  ctx.font = font;  // gets reset when canvas size changes
  // rgba(r, g, b, a)  either 0-255 or 0.0 to 1.0, a=0 transparent
  // or just a color
  ctx.fillStyle = getProp(params, "color", "#ffffff7f");
  ctx.fillText(text, actualBoundingBoxLeft+1,
               2*tick+gap+actualBoundingBoxAscent+1);
  if (tick) {
    ctx.strokeStyle = ctx.fillStyle;
    ctx.beginPath();
    ctx.moveTo(0.5*textWidth, 0.);
    ctx.lineTo(0.5*textWidth, tick);
    if (gap < 0) {
      ctx.moveTo(0.5*textWidth+gap, tick+0.5);
      ctx.lineTo(0.5*textWidth-gap, tick+0.5);
      ctx.moveTo(0.5*textWidth, tick);
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
  sprite.scale.set(canvas.width*SPRITE_SCALE, canvas.height*SPRITE_SCALE, 1);
  return sprite;
}

window.addEventListener("resize", () => {
  const elem = renderer.domElement;
  const [width, height] = [window.innerWidth, window.innerHeight];
  elem.width = width;
  elem.height = height;
  camera.aspect = width / height;
  camera.fov = HFOV / camera.aspect;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
  renderer.render(scene, camera);
}, false);

if ( WebGL.isWebGLAvailable() ) {
  setupSky();
} else {
  const warning = WebGL.getWebGLErrorMessage();
  document.getElementById( 'container' ).appendChild( warning );
  console.log("Your graphics card does not seem to support WebGL");
}
