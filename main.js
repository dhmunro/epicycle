import * as THREE from 'three';
import WebGL from 'three/addons/capabilities/WebGL.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// console.log(THREE.REVISION);  --> 155

const scene = new THREE.Scene();
// FOV is the vertical FOV
const cameraHFOV = 100;  // horizontal field of view
let aspect = window.innerWidth / window.innerHeight
const camera = new THREE.PerspectiveCamera(
  cameraHFOV/aspect, aspect, 0.1, 1000);

const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

let raCurrent = 0;  // right ascension in radians

function animate() {
  raCurrent += 0.005;  // 200*2*pi/60 ~ 20 sec/year
  if (raCurrent > 2*Math.PI) raCurrent -= 2*Math.PI;
  rotateCameraTo(raCurrent);
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

function rotateCameraTo(ra) {
  const [x, z] = [Math.sin(ra), Math.cos(ra)];
  camera.lookAt(x, 0, z);
  // controls.update();
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
  scene.backgroundIntensity = 1  // 0.3-0.4 fades to less distracting level
  // scene.backgroundBlurriness = 0.04

  // controls = new OrbitControls(camera, renderer.domElement);
  // controls.addEventListener("change", () => renderer.render(scene, camera));

}

window.addEventListener("resize", () => {
  const elem = renderer.domElement;
  const [width, height] = [window.innerWidth, window.innerHeight];
  elem.width = width;
  elem.height = height;
  camera.aspect = width / height;
  camera.fov = cameraHFOV / camera.aspect;
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
