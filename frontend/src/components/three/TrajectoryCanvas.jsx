import React, { useEffect, useRef, useState, useMemo } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// Color palette for agents
const CLASS_COLORS = {
  pedestrian: 0x10b981, // Emerald Green
  people: 0x10b981,
  bicycle: 0x06b6d4,    // Cyan
  motorcycle: 0x06b6d4,
  motor: 0x06b6d4,
  car: 0x38bdf8,        // Sky Blue
  van: 0x60a5fa,        // Blue
  truck: 0xa855f7,      // Purple
  bus: 0xd946ef,        // Magenta
  tricycle: 0xf59e0b,   // Amber
  'awning-tricycle': 0xf59e0b,
  default: 0x64748b     // Slate
};

function getClassColor(clsName) {
  if (!clsName) return CLASS_COLORS.default;
  const key = String(clsName).toLowerCase();
  for (const [k, v] of Object.entries(CLASS_COLORS)) {
    if (key.includes(k)) return v;
  }
  return CLASS_COLORS.default;
}



// Procedural 3D Vehicle Mesh Builders
function createCarMesh(colorHex) {
  const group = new THREE.Group();

  // 1. Lower Chassis
  const bodyGeo = new THREE.BoxGeometry(26, 8, 44);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: colorHex,
    roughness: 0.2,
    metalness: 0.4
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 7;
  group.add(body);

  // 2. Cabin / Roof with tinted glass
  const cabinGeo = new THREE.BoxGeometry(20, 7, 24);
  const cabinMat = new THREE.MeshStandardMaterial({
    color: 0x111827,
    roughness: 0.1,
    metalness: 0.9,
    transparent: true,
    opacity: 0.85
  });
  const cabin = new THREE.Mesh(cabinGeo, cabinMat);
  cabin.position.set(0, 13.5, -2);
  group.add(cabin);

  // 3. 4 Rubber Wheels
  const wheelGeo = new THREE.CylinderGeometry(4.5, 4.5, 3.5, 12);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.8 });
  [
    [-13, 4.5, 13],
    [13, 4.5, 13],
    [-13, 4.5, -13],
    [13, 4.5, -13]
  ].forEach(([wx, wy, wz]) => {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.position.set(wx, wy, wz);
    group.add(wheel);
  });

  // 4. Front Glowing Headlights (Cyan/White)
  const headGeo = new THREE.BoxGeometry(4, 2, 1);
  const headMat = new THREE.MeshBasicMaterial({ color: 0xe0f2fe });
  const hl1 = new THREE.Mesh(headGeo, headMat);
  hl1.position.set(-8, 8, 22.5);
  const hl2 = new THREE.Mesh(headGeo, headMat);
  hl2.position.set(8, 8, 22.5);
  group.add(hl1, hl2);

  // 5. Rear Brake Lights (Red)
  const tailMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
  const tl1 = new THREE.Mesh(headGeo, tailMat);
  tl1.position.set(-8, 8, -22.5);
  const tl2 = new THREE.Mesh(headGeo, tailMat);
  tl2.position.set(8, 8, -22.5);
  group.add(tl1, tl2);

  return { root: group, mainMat: bodyMat };
}

function createTruckMesh(colorHex) {
  const group = new THREE.Group();

  // Cabin
  const cabGeo = new THREE.BoxGeometry(32, 18, 24);
  const cabMat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.3, metalness: 0.3 });
  const cab = new THREE.Mesh(cabGeo, cabMat);
  cab.position.set(0, 13, 24);
  group.add(cab);

  // Windshield
  const winGeo = new THREE.BoxGeometry(28, 7, 2);
  const winMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.1 });
  const win = new THREE.Mesh(winGeo, winMat);
  win.position.set(0, 15, 36.5);
  group.add(win);

  // Container Body
  const cargoGeo = new THREE.BoxGeometry(32, 22, 54);
  const cargoMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.5, metalness: 0.2 });
  const cargo = new THREE.Mesh(cargoGeo, cargoMat);
  cargo.position.set(0, 16, -14);
  group.add(cargo);

  // Tandem Wheels
  const wheelGeo = new THREE.CylinderGeometry(6, 6, 4, 12);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x0f172a });
  [
    [-17, 6, 24],
    [17, 6, 24],
    [-17, 6, -6],
    [17, 6, -6],
    [-17, 6, -26],
    [17, 6, -26]
  ].forEach(([wx, wy, wz]) => {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.position.set(wx, wy, wz);
    group.add(w);
  });

  return { root: group, mainMat: cabMat };
}

function createPedestrianMesh(colorHex) {
  const group = new THREE.Group();

  // Legs / Base
  const baseGeo = new THREE.CylinderGeometry(4, 5, 12, 8);
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.5 });
  const base = new THREE.Mesh(baseGeo, baseMat);
  base.position.y = 6;
  group.add(base);

  // Torso
  const torsoGeo = new THREE.CylinderGeometry(5, 5, 14, 8);
  const torsoMat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.3 });
  const torso = new THREE.Mesh(torsoGeo, torsoMat);
  torso.position.y = 17;
  group.add(torso);

  // Head
  const headGeo = new THREE.SphereGeometry(4, 12, 12);
  const headMat = new THREE.MeshStandardMaterial({ color: 0xfde047 });
  const head = new THREE.Mesh(headGeo, headMat);
  head.position.y = 27;
  group.add(head);

  return { root: group, mainMat: torsoMat };
}

function createMotorcycleMesh(colorHex) {
  const group = new THREE.Group();

  // Frame
  const frameGeo = new THREE.BoxGeometry(10, 8, 30);
  const frameMat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.3, metalness: 0.5 });
  const frame = new THREE.Mesh(frameGeo, frameMat);
  frame.position.y = 9;
  group.add(frame);

  // Wheels
  const wheelGeo = new THREE.CylinderGeometry(5.5, 5.5, 3, 12);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x0f172a });
  const w1 = new THREE.Mesh(wheelGeo, wheelMat);
  w1.position.set(0, 5.5, 12);
  const w2 = new THREE.Mesh(wheelGeo, wheelMat);
  w2.position.set(0, 5.5, -12);
  group.add(w1, w2);

  // Rider Torso
  const riderGeo = new THREE.BoxGeometry(8, 12, 10);
  const riderMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8 });
  const rider = new THREE.Mesh(riderGeo, riderMat);
  rider.position.set(0, 17, -2);
  rider.rotation.x = -0.2;
  group.add(rider);

  return { root: group, mainMat: frameMat };
}

// Billboard text sprite for floating 3D labels
function makeTextSprite(message, colorHex = '#ffffff', bgHex = 'rgba(15, 23, 42, 0.85)') {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');

  // Background pill
  ctx.fillStyle = bgHex;
  ctx.beginPath();
  ctx.roundRect(8, 8, 240, 48, 10);
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = colorHex;
  ctx.stroke();

  // Text
  ctx.font = 'bold 22px monospace';
  ctx.fillStyle = colorHex;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(message, 128, 32);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(spriteMat);
  sprite.scale.set(48, 12, 1);
  return sprite;
}

export default function TrajectoryCanvas({
  agents = [],
  coordinateSpace = 'IMAGE-SPACE ONLY',
  height = 540,
  showControls = true,
  onSelectAgent,
  selectedTrackId: externalSelectedId,
  useSimulation = false
}) {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const rendererRef = useRef(null);
  const cameraRef = useRef(null);
  const controlsRef = useRef(null);
  const objectsRef = useRef({});
  const conflictLinesRef = useRef([]);
  const animFrameRef = useRef(null);
  const timeRef = useRef(0);

  const [cameraPreset, setCameraPreset] = useState('perspective');
  const [internalSelectedId, setInternalSelectedId] = useState(null);
  const [showRays, setShowRays] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [webglError, setWebglError] = useState(null);

  const activeSelectedId = externalSelectedId !== undefined ? externalSelectedId : internalSelectedId;

  // Real live detected agents from CCTV pipeline (strictly genuine data)
  const effectiveAgents = useMemo(() => {
    return Array.isArray(agents) ? agents : [];
  }, [agents]);

  // Dynamic centroid of active traffic for centering camera framing
  const trafficCentroid = useMemo(() => {
    if (!effectiveAgents || effectiveAgents.length === 0) return { x: 960, z: 540 };
    let sumX = 0;
    let sumZ = 0;
    effectiveAgents.forEach((a) => {
      sumX += a.position?.x ?? 960;
      sumZ += a.position?.y ?? 540;
    });
    return {
      x: sumX / effectiveAgents.length,
      z: sumZ / effectiveAgents.length
    };
  }, [effectiveAgents]);

  // Selected agent details
  const selectedAgent = useMemo(() => {
    if (!activeSelectedId) return null;
    return effectiveAgents.find((a) => a.track_id === activeSelectedId) || null;
  }, [effectiveAgents, activeSelectedId]);

  const handleSelect = (id) => {
    const nextId = id === activeSelectedId ? null : id;
    setInternalSelectedId(nextId);
    if (onSelectAgent) onSelectAgent(nextId);
  };

  // Init Three.js Scene
  useEffect(() => {
    if (!mountRef.current) return;

    // Purge any residual canvas elements to prevent duplicate or ghost WebGL contexts
    while (mountRef.current.firstChild) {
      mountRef.current.removeChild(mountRef.current.firstChild);
    }

    const width = mountRef.current.clientWidth || 800;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#070d19');
    scene.fog = new THREE.FogExp2('#070d19', 0.00045);
    sceneRef.current = scene;

    // 1. Realistic Roadway Environment (Asphalt Intersection Plane)
    // Scale: 1920x1080 center at (960, 0, 540)
    const roadGroup = new THREE.Group();
    roadGroup.name = 'roadEnvironment';

    // Base Terrain
    const groundGeo = new THREE.PlaneGeometry(4200, 3200);
    groundGeo.rotateX(-Math.PI / 2);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x070c18, roughness: 0.95 });
    const groundMesh = new THREE.Mesh(groundGeo, groundMat);
    groundMesh.position.set(960, -1, 540);
    roadGroup.add(groundMesh);

    // Main East-West Multi-Lane Highway (covers complete CCTV travel corridor from 80px to 1020px in depth)
    const ewRoadGeo = new THREE.PlaneGeometry(3800, 960);
    ewRoadGeo.rotateX(-Math.PI / 2);
    const roadMat = new THREE.MeshStandardMaterial({ color: 0x141b29, roughness: 0.72 });
    const ewRoad = new THREE.Mesh(ewRoadGeo, roadMat);
    ewRoad.position.set(960, 0, 540);
    roadGroup.add(ewRoad);

    // North-South Arterial Crossing
    const nsRoadGeo = new THREE.PlaneGeometry(560, 2600);
    nsRoadGeo.rotateX(-Math.PI / 2);
    const nsRoad = new THREE.Mesh(nsRoadGeo, roadMat);
    nsRoad.position.set(960, 0.1, 540);
    roadGroup.add(nsRoad);

    // Road Shoulder Edge Lines (White)
    const lineMatWhite = new THREE.MeshBasicMaterial({ color: 0xe2e8f0 });
    const lineMatYellow = new THREE.MeshBasicMaterial({ color: 0xf59e0b });
    const edgeGeo = new THREE.PlaneGeometry(3800, 3.5);
    edgeGeo.rotateX(-Math.PI / 2);
    const topEdge = new THREE.Mesh(edgeGeo, lineMatWhite);
    topEdge.position.set(960, 0.4, 65);
    const bottomEdge = new THREE.Mesh(edgeGeo, lineMatWhite);
    bottomEdge.position.set(960, 0.4, 1015);
    roadGroup.add(topEdge, bottomEdge);

    // Double Solid Yellow Centerlines (Median Divider)
    const yLineGeo = new THREE.PlaneGeometry(3800, 2.5);
    yLineGeo.rotateX(-Math.PI / 2);
    const yl1 = new THREE.Mesh(yLineGeo, lineMatYellow);
    yl1.position.set(960, 0.5, 536);
    const yl2 = new THREE.Mesh(yLineGeo, lineMatYellow);
    yl2.position.set(960, 0.5, 544);
    roadGroup.add(yl1, yl2);

    // Multi-Lane Dashed White Lines (6 Lanes)
    const lanePositions = [220, 380, 700, 860];
    lanePositions.forEach((lz) => {
      for (let x = -700; x < 2700; x += 75) {
        if (Math.abs(x - 960) > 290) {
          const dashGeo = new THREE.PlaneGeometry(36, 2.5);
          dashGeo.rotateX(-Math.PI / 2);
          const dash = new THREE.Mesh(dashGeo, lineMatWhite);
          dash.position.set(x, 0.5, lz);
          roadGroup.add(dash);
        }
      }
    });

    // Pedestrian Zebra Crosswalks
    for (let i = -240; i <= 240; i += 24) {
      const zGeo = new THREE.PlaneGeometry(14, 42);
      zGeo.rotateX(-Math.PI / 2);
      // West crosswalk
      const z1 = new THREE.Mesh(zGeo, lineMatWhite);
      z1.position.set(670, 0.6, 540 + i);
      // East crosswalk
      const z2 = new THREE.Mesh(zGeo, lineMatWhite);
      z2.position.set(1250, 0.6, 540 + i);
      roadGroup.add(z1, z2);
    }

    // Cyber Range Rings (Radar distance markers at intersection)
    [250, 500, 850].forEach((radius) => {
      const ringGeo = new THREE.RingGeometry(radius - 1.5, radius, 64);
      ringGeo.rotateX(-Math.PI / 2);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0x0ea5e9,
        transparent: true,
        opacity: 0.15,
        side: THREE.DoubleSide
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.set(960, 0.3, 540);
      roadGroup.add(ring);
    });

    scene.add(roadGroup);

    // 2. High-Tech Grid Helper
    const gridHelper = new THREE.GridHelper(3000, 60, 0x1e293b, 0x0f172a);
    gridHelper.position.set(960, 0, 540);
    gridHelper.name = 'cyberGrid';
    scene.add(gridHelper);

    // 3. Lighting Rig
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.9);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(800, 1500, 1000);
    dirLight.castShadow = true;
    scene.add(dirLight);

    const blueRimLight = new THREE.DirectionalLight(0x38bdf8, 0.5);
    blueRimLight.position.set(-600, 800, -600);
    scene.add(blueRimLight);

    // 4. Perspective Camera
    const camera = new THREE.PerspectiveCamera(45, width / height, 5, 12000);
    cameraRef.current = camera;
    setCameraToPreset(camera, 'perspective');

    // 5. WebGL Renderer with Solid Opaque Background (avoids Chrome D3D11 blend mode blowout)
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        powerPreference: 'default'
      });
    } catch (err) {
      console.warn('WebGL initialization failed:', err);
      setWebglError('WebGL is unavailable or disabled in browser settings.');
      return;
    }

    renderer.setClearColor(0x070d19, 1.0);
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;

    const canvas = renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.borderRadius = '10px';
    canvas.style.background = '#070d19';
    mountRef.current.appendChild(canvas);
    rendererRef.current = renderer;

    // 6. Smooth Mouse OrbitControls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2 - 0.05; // Prevent dipping beneath ground
    controls.minDistance = 80;
    controls.maxDistance = 4500;
    controls.target.set(960, 0, 540);
    controls.update();
    controlsRef.current = controls;

    // 7. Interactive 3D Raycaster for Direct Vehicle Clicking
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    const handleCanvasClick = (event) => {
      if (!mountRef.current) return;
      const rect = mountRef.current.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const meshesToTest = [];
      Object.entries(objectsRef.current).forEach(([tid, obj]) => {
        if (obj.hitBox) meshesToTest.push({ tid: Number(tid), mesh: obj.hitBox });
      });

      const intersects = raycaster.intersectObjects(meshesToTest.map((m) => m.mesh));
      if (intersects.length > 0) {
        const hit = meshesToTest.find((m) => m.mesh === intersects[0].object);
        if (hit) handleSelect(hit.tid);
      }
    };

    canvas.addEventListener('click', handleCanvasClick);

    // Prevent unhandled WebGL context loss crash in Chromium
    const handleContextLost = (e) => {
      e.preventDefault();
      console.warn('WebGL context lost. Sentinel holding context for recovery.');
    };
    const handleContextRestored = () => {
      console.info('WebGL context successfully restored.');
      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    };
    canvas.addEventListener('webglcontextlost', handleContextLost, false);
    canvas.addEventListener('webglcontextrestored', handleContextRestored, false);

    // 8. Main Render Animation Loop
    let lastTime = performance.now();
    const animate = (currentTime) => {
      animFrameRef.current = requestAnimationFrame(animate);

      const dt = (currentTime - lastTime) / 1000;
      lastTime = currentTime;
      timeRef.current += dt;

      // Update OrbitControls
      if (controlsRef.current) {
        controlsRef.current.update();
      }

      // Pulsing aura animation for alerts
      Object.values(objectsRef.current).forEach((obj) => {
        if (obj.dangerRing && obj.dangerRing.visible) {
          const s = 1.0 + 0.25 * Math.sin(timeRef.current * 6);
          obj.dangerRing.scale.set(s, s, s);
        }
      });

      try {
        renderer.render(scene, camera);
      } catch (err) {
        // Silently skip if frame render failed
      }
    };
    animFrameRef.current = requestAnimationFrame(animate);

    // Resize Observer
    const handleResize = () => {
      if (!mountRef.current || !renderer || !camera) return;
      const newWidth = mountRef.current.clientWidth;
      camera.aspect = newWidth / height;
      camera.updateProjectionMatrix();
      renderer.setSize(newWidth, height);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
      canvas.removeEventListener('click', handleCanvasClick);
      canvas.removeEventListener('webglcontextlost', handleContextLost);
      canvas.removeEventListener('webglcontextrestored', handleContextRestored);

      // Clean up meshes and textures
      Object.values(objectsRef.current).forEach((obj) => {
        if (obj.root) scene.remove(obj.root);
        if (obj.line) { scene.remove(obj.line); if (obj.line.geometry) obj.line.geometry.dispose(); if (obj.line.material) obj.line.material.dispose(); }
        if (obj.futureRay) { scene.remove(obj.futureRay); if (obj.futureRay.geometry) obj.futureRay.geometry.dispose(); if (obj.futureRay.material) obj.futureRay.material.dispose(); }
        if (obj.dangerRing) { scene.remove(obj.dangerRing); if (obj.dangerRing.geometry) obj.dangerRing.geometry.dispose(); if (obj.dangerRing.material) obj.dangerRing.material.dispose(); }
        if (obj.labelSprite) {
          scene.remove(obj.labelSprite);
          if (obj.labelSprite.material?.map) obj.labelSprite.material.map.dispose();
          if (obj.labelSprite.material) obj.labelSprite.material.dispose();
        }
      });
      objectsRef.current = {};

      if (controlsRef.current) {
        controlsRef.current.dispose();
      }

      renderer.dispose();

      if (mountRef.current && canvas && mountRef.current.contains(canvas)) {
        mountRef.current.removeChild(canvas);
      }
    };
  }, [height]);

  // Set Camera Preset Angles centered around active traffic flow
  const setCameraToPreset = (cam, preset) => {
    if (!cam) return;
    setCameraPreset(preset);
    const cx = trafficCentroid.x;
    const cz = trafficCentroid.z;
    if (preset === 'top-down') {
      cam.position.set(cx, 1900, cz);
      cam.lookAt(cx, 0, cz);
      if (controlsRef.current) {
        controlsRef.current.target.set(cx, 0, cz);
        controlsRef.current.update();
      }
    } else if (preset === 'street') {
      cam.position.set(cx, 130, cz + 650);
      cam.lookAt(cx, 30, cz);
      if (controlsRef.current) {
        controlsRef.current.target.set(cx, 30, cz);
        controlsRef.current.update();
      }
    } else {
      // Perspective / Surveillance Angle
      cam.position.set(cx, 950, cz + 1150);
      cam.lookAt(cx, 0, cz);
      if (controlsRef.current) {
        controlsRef.current.target.set(cx, 0, cz);
        controlsRef.current.update();
      }
    }
  };

  // One-click Auto Center Camera on active traffic
  const handleCenterTraffic = () => {
    if (!cameraRef.current || !controlsRef.current) return;
    const cx = trafficCentroid.x;
    const cz = trafficCentroid.z;
    controlsRef.current.target.set(cx, 0, cz);
    cameraRef.current.position.set(cx, 900, cz + 1100);
    cameraRef.current.lookAt(cx, 0, cz);
    controlsRef.current.update();
  };

  // Follow Selected Vehicle smoothly if locked
  useEffect(() => {
    if (selectedAgent && cameraPreset === 'follow' && cameraRef.current && controlsRef.current) {
      const px = selectedAgent.position?.x ?? 960;
      const pz = selectedAgent.position?.y ?? 540;
      controlsRef.current.target.set(px, 15, pz);
      cameraRef.current.position.set(px, 350, pz + 450);
    }
  }, [selectedAgent, cameraPreset]);

  // Sync Effective Agents to 3D Scene
  useEffect(() => {
    if (!sceneRef.current) return;
    const scene = sceneRef.current;
    const currentTrackIds = new Set(effectiveAgents.map((a) => a.track_id));

    // Remove defunct tracks and dispose GPU resources
    Object.keys(objectsRef.current).forEach((tidStr) => {
      const tid = Number(tidStr);
      if (!currentTrackIds.has(tid)) {
        const obj = objectsRef.current[tidStr];
        if (obj.root) scene.remove(obj.root);
        if (obj.line) { scene.remove(obj.line); if (obj.line.geometry) obj.line.geometry.dispose(); if (obj.line.material) obj.line.material.dispose(); }
        if (obj.futureRay) { scene.remove(obj.futureRay); if (obj.futureRay.geometry) obj.futureRay.geometry.dispose(); if (obj.futureRay.material) obj.futureRay.material.dispose(); }
        if (obj.dangerRing) { scene.remove(obj.dangerRing); if (obj.dangerRing.geometry) obj.dangerRing.geometry.dispose(); if (obj.dangerRing.material) obj.dangerRing.material.dispose(); }
        if (obj.labelSprite) {
          scene.remove(obj.labelSprite);
          if (obj.labelSprite.material?.map) obj.labelSprite.material.map.dispose();
          if (obj.labelSprite.material) obj.labelSprite.material.dispose();
        }
        delete objectsRef.current[tidStr];
      }
    });

    // Clean up previous conflict lines and dispose resources
    conflictLinesRef.current.forEach((l) => {
      scene.remove(l);
      if (l.geometry) l.geometry.dispose();
      if (l.material) l.material.dispose();
    });
    conflictLinesRef.current = [];

    // Update / Create Active Tracks
    effectiveAgents.forEach((agent) => {
      const tidStr = String(agent.track_id);
      const px = agent.position?.x ?? 0;
      const pz = agent.position?.y ?? 0;
      const isSelected = activeSelectedId === agent.track_id;
      const isAlert = agent.risk_probability > 0.65;
      const baseColor = isAlert ? 0xef4444 : getClassColor(agent.class);

      if (!objectsRef.current[tidStr]) {
        // Instantiate specialized 3D vehicle model based on class
        const cls = (agent.class || '').toLowerCase();
        let builder;
        if (cls.includes('bus') || cls.includes('truck')) {
          builder = createTruckMesh(baseColor);
        } else if (cls.includes('pedestrian') || cls.includes('people')) {
          builder = createPedestrianMesh(baseColor);
        } else if (cls.includes('motor') || cls.includes('bicycle')) {
          builder = createMotorcycleMesh(baseColor);
        } else {
          builder = createCarMesh(baseColor);
        }

        const root = builder.root;

        // Bounding hit-box for raycaster clicks
        const hitBoxGeo = new THREE.BoxGeometry(40, 30, 60);
        const hitBoxMat = new THREE.MeshBasicMaterial({ visible: false });
        const hitBox = new THREE.Mesh(hitBoxGeo, hitBoxMat);
        root.add(hitBox);

        // Historical Trajectory Ribbon
        const lineGeo = new THREE.BufferGeometry();
        const lineMat = new THREE.LineBasicMaterial({
          color: baseColor,
          linewidth: 3,
          transparent: true,
          opacity: 0.85
        });
        const line = new THREE.Line(lineGeo, lineMat);

        // Future Velocity Ray (Dashed vector)
        const rayGeo = new THREE.BufferGeometry();
        const rayMat = new THREE.LineDashedMaterial({
          color: isAlert ? 0xf87171 : 0x38bdf8,
          dashSize: 12,
          gapSize: 6,
          linewidth: 2
        });
        const futureRay = new THREE.Line(rayGeo, rayMat);

        // Ground Danger / Selection Ring
        const ringGeo = new THREE.RingGeometry(24, 28, 32);
        ringGeo.rotateX(-Math.PI / 2);
        const ringMat = new THREE.MeshBasicMaterial({
          color: isAlert ? 0xef4444 : 0xfbbf24,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.8
        });
        const dangerRing = new THREE.Mesh(ringGeo, ringMat);

        // Floating 3D Label Sprite
        const labelText = `#${agent.track_id} ${agent.class} (${agent.speed}px/s)`;
        const labelSprite = makeTextSprite(labelText, isAlert ? '#ef4444' : '#38bdf8');

        scene.add(root);
        scene.add(line);
        scene.add(futureRay);
        scene.add(dangerRing);
        scene.add(labelSprite);

        objectsRef.current[tidStr] = {
          root,
          hitBox,
          mainMat: builder.mainMat,
          line,
          futureRay,
          dangerRing,
          labelSprite
        };
      }

      const obj = objectsRef.current[tidStr];

      // Update 3D Position
      obj.root.position.set(px, 0, pz);
      obj.dangerRing.position.set(px, 1.2, pz);
      obj.dangerRing.visible = isSelected || isAlert;
      obj.labelSprite.position.set(px, 42, pz);

      // Color Updates
      obj.mainMat.color.setHex(isSelected ? 0xfbbf24 : baseColor);

      // Heading / Rotation Angle
      if (agent.velocity && (agent.velocity.x !== 0 || agent.velocity.y !== 0)) {
        // Invert for Three.js Z-forward convention
        const angle = Math.atan2(agent.velocity.x, agent.velocity.y);
        obj.root.rotation.y = angle;
      }

      // Update Historical Trajectory Line
      if (agent.trajectory && agent.trajectory.length > 1) {
        const points = agent.trajectory.map((p) => new THREE.Vector3(p[0], 2, p[1]));
        obj.line.geometry.setFromPoints(points);
      }

      // Update Future Velocity Projection Ray
      if (showRays && agent.velocity) {
        const futureX = px + (agent.velocity.x || 0) * 1.5;
        const futureZ = pz + (agent.velocity.y || 0) * 1.5;
        obj.futureRay.geometry.setFromPoints([
          new THREE.Vector3(px, 3, pz),
          new THREE.Vector3(futureX, 3, futureZ)
        ]);
        obj.futureRay.computeLineDistances();
        obj.futureRay.visible = true;
      } else {
        obj.futureRay.visible = false;
      }
    });

    // Render Dynamic Inter-Vehicle Conflict Laser Lines (G3 Interaction Graph - strictly for real converging hazards)
    for (let i = 0; i < effectiveAgents.length; i++) {
      for (let j = i + 1; j < effectiveAgents.length; j++) {
        const a1 = effectiveAgents[i];
        const a2 = effectiveAgents[j];

        // Draw laser ONLY between agents that have a mutual active conflict (BOTH risk >= 0.50, distance < 150px)
        const r1 = a1.risk_probability || 0;
        const r2 = a2.risk_probability || 0;
        if (r1 < 0.50 || r2 < 0.50) continue;

        const isPed1 = a1.class?.toLowerCase().includes('ped') || a1.class?.toLowerCase().includes('person');
        const isPed2 = a2.class?.toLowerCase().includes('ped') || a2.class?.toLowerCase().includes('person');
        if (isPed1 && isPed2) continue; // Never connect two pedestrians

        const dx = (a2.position?.x || 0) - (a1.position?.x || 0);
        const dz = (a2.position?.y || 0) - (a1.position?.y || 0);
        const dist = Math.sqrt(dx * dx + dz * dz);

        if (dist > 150) continue;

        const isActualCrash = (a1.collision_flag || a2.collision_flag);
        const laserGeo = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(a1.position?.x, 8, a1.position?.y),
          new THREE.Vector3(a2.position?.x, 8, a2.position?.y)
        ]);
        const laserMat = new THREE.LineBasicMaterial({
          color: isActualCrash ? 0xef4444 : 0xf59e0b,
          linewidth: 2,
          transparent: true,
          opacity: 0.85
        });
        const laser = new THREE.Line(laserGeo, laserMat);
        scene.add(laser);
        conflictLinesRef.current.push(laser);
      }
    }
  }, [effectiveAgents, activeSelectedId, showRays]);

  // Toggle Cyber Grid visibility
  useEffect(() => {
    if (!sceneRef.current) return;
    const grid = sceneRef.current.getObjectByName('cyberGrid');
    if (grid) grid.visible = showGrid;
  }, [showGrid]);

  return (
    <div style={{ position: 'relative', width: '100%', height, borderRadius: 12, overflow: 'hidden', background: '#070d19', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-card)' }}>
      {/* Three.js WebGL Canvas Mount */}
      {webglError ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', gap: 10 }}>
          <span style={{ fontSize: 32 }}>🎮</span>
          <span style={{ fontWeight: 600 }}>3D Trajectory Viewport Paused</span>
          <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{webglError}</span>
        </div>
      ) : (
        <div ref={mountRef} style={{ width: '100%', height: '100%', cursor: 'grab', background: '#070d19' }} />
      )}

      {/* Top Left: Coordinate Space & Mode Badge */}
      <div
        style={{
          position: 'absolute',
          top: 14,
          left: 14,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          background: 'var(--bg-card)',
          backdropFilter: 'blur(10px)',
          border: '1px solid var(--border-subtle)',
          boxShadow: 'var(--shadow-card)',
          padding: '6px 12px',
          borderRadius: 8,
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: 12,
          zIndex: 10
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: coordinateSpace.includes('METRIC') ? 'var(--status-normal)' : 'var(--accent-cyan)',
            boxShadow: `0 0 8px ${coordinateSpace.includes('METRIC') ? 'var(--status-normal)' : 'var(--accent-cyan)'}`
          }}
        />
        <span style={{ color: 'var(--text-main)', fontWeight: 700 }}>
          {coordinateSpace}
        </span>
        <span style={{ color: 'var(--text-dim)' }}>|</span>
        <span style={{ color: 'var(--accent-cyan)', fontWeight: 600 }}>
          {effectiveAgents.length} Agents
        </span>
        {useSimulation && (
          <span style={{ background: 'var(--badge-warning-bg)', color: 'var(--badge-warning-text)', border: '1px solid var(--badge-warning-border)', padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 700 }}>
            SIMULATION PREVIEW
          </span>
        )}
      </div>

      {/* Top Right: Full Interactive 3D Control Bar */}
      {showControls && (
        <div
          style={{
            position: 'absolute',
            top: 14,
            right: 14,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: 'var(--bg-card)',
            backdropFilter: 'blur(10px)',
            border: '1px solid var(--border-subtle)',
            boxShadow: 'var(--shadow-card)',
            padding: '6px 8px',
            borderRadius: 8,
            zIndex: 10
          }}
        >
          {/* Camera Preset: Surveillance Perspective */}
          <button
            onClick={() => setCameraToPreset(cameraRef.current, 'perspective')}
            title="Perspective Surveillance View"
            style={{
              background: cameraPreset === 'perspective' ? 'var(--bg-accent-soft)' : 'transparent',
              border: cameraPreset === 'perspective' ? '1px solid rgba(2, 132, 199, 0.3)' : '1px solid transparent',
              color: cameraPreset === 'perspective' ? 'var(--accent-cyan)' : 'var(--text-muted)',
              padding: '4px 8px',
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            🎥 3D Angle
          </button>

          {/* Camera Preset: Bird's-Eye Top-Down */}
          <button
            onClick={() => setCameraToPreset(cameraRef.current, 'top-down')}
            title="Top-Down Bird's-Eye View"
            style={{
              background: cameraPreset === 'top-down' ? 'var(--bg-accent-soft)' : 'transparent',
              border: cameraPreset === 'top-down' ? '1px solid rgba(2, 132, 199, 0.3)' : '1px solid transparent',
              color: cameraPreset === 'top-down' ? 'var(--accent-cyan)' : 'var(--text-muted)',
              padding: '4px 8px',
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            🦅 Bird's-Eye
          </button>

          {/* Camera Preset: Street Level */}
          <button
            onClick={() => setCameraToPreset(cameraRef.current, 'street')}
            title="Street-Level Driver View"
            style={{
              background: cameraPreset === 'street' ? 'var(--bg-accent-soft)' : 'transparent',
              border: cameraPreset === 'street' ? '1px solid rgba(2, 132, 199, 0.3)' : '1px solid transparent',
              color: cameraPreset === 'street' ? 'var(--accent-cyan)' : 'var(--text-muted)',
              padding: '4px 8px',
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            🚗 Street
          </button>

          {/* Quick Auto-Center on Traffic */}
          <button
            onClick={handleCenterTraffic}
            title="Center 3D Camera Directly on Active Vehicles"
            style={{
              background: 'var(--bg-accent-soft)',
              border: '1px solid rgba(2, 132, 199, 0.35)',
              color: 'var(--accent-cyan)',
              padding: '4px 8px',
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 700,
              cursor: 'pointer'
            }}
          >
            🎯 Center Traffic
          </button>

          {/* Follow Selected Agent */}
          {selectedAgent && (
            <button
              onClick={() => setCameraToPreset(cameraRef.current, 'follow')}
              title="Follow Selected Agent"
              style={{
                background: cameraPreset === 'follow' ? 'var(--badge-warning-bg)' : 'transparent',
                border: cameraPreset === 'follow' ? '1px solid var(--badge-warning-border)' : '1px solid transparent',
                color: cameraPreset === 'follow' ? 'var(--badge-warning-text)' : 'var(--text-muted)',
                padding: '4px 8px',
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              🎯 Follow #{selectedAgent.track_id}
            </button>
          )}

          {/* Velocity Ray Vectors Toggle */}
          <button
            onClick={() => setShowRays(!showRays)}
            title="Toggle Velocity Direction Rays"
            style={{
              background: showRays ? 'var(--badge-normal-bg)' : 'transparent',
              border: 'none',
              color: showRays ? 'var(--badge-normal-text)' : 'var(--text-dim)',
              padding: '4px 8px',
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            ↗ Rays
          </button>

          {/* Grid Toggle */}
          <button
            onClick={() => setShowGrid(!showGrid)}
            title="Toggle Ground Cyber Grid"
            style={{
              background: showGrid ? 'var(--bg-accent-soft)' : 'transparent',
              border: 'none',
              color: showGrid ? 'var(--accent-cyan)' : 'var(--text-dim)',
              padding: '4px 8px',
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            # Grid
          </button>
        </div>
      )}

      {/* Mouse Navigation Help Tip Overlay */}
      <div
        style={{
          position: 'absolute',
          bottom: selectedAgent ? 64 : 14,
          left: 14,
          background: 'var(--bg-card)',
          backdropFilter: 'blur(8px)',
          border: '1px solid var(--border-subtle)',
          boxShadow: 'var(--shadow-card)',
          padding: '4px 10px',
          borderRadius: 6,
          fontSize: 10,
          color: 'var(--text-dim)',
          display: 'flex',
          gap: 12,
          pointerEvents: 'none',
          fontFamily: 'JetBrains Mono, monospace'
        }}
      >
        <span>🖱️ Left Click: Rotate</span>
        <span>🖱️ Right Click: Pan</span>
        <span>📜 Scroll: Zoom</span>
        <span>🎯 Click Car: Select</span>
      </div>

      {/* Selected Agent Quick Telemetry Banner */}
      {selectedAgent && (
        <div
          style={{
            position: 'absolute',
            bottom: 14,
            left: 14,
            right: 14,
            background: 'var(--bg-card)',
            backdropFilter: 'blur(12px)',
            border: '1px solid var(--border-subtle)',
            boxShadow: 'var(--shadow-card)',
            padding: '10px 16px',
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 12,
            zIndex: 10
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ background: '#f59e0b', color: '#ffffff', padding: '3px 8px', borderRadius: 4, fontWeight: 800 }}>
              TRACK #{selectedAgent.track_id}
            </span>
            <span style={{ color: 'var(--text-main)', fontWeight: 700, textTransform: 'uppercase' }}>
              {selectedAgent.class}
            </span>
          </div>

          <div style={{ display: 'flex', gap: 16, color: 'var(--text-muted)' }}>
            <span>POS: <b style={{ color: 'var(--text-main)' }}>({selectedAgent.position?.x?.toFixed(0)}, {selectedAgent.position?.y?.toFixed(0)})</b></span>
            <span>SPEED: <b style={{ color: 'var(--accent-cyan)' }}>{selectedAgent.speed} px/s</b></span>
            <span>UNCERTAINTY: <b style={{ color: '#9333ea' }}>{selectedAgent.uncertainty?.toFixed(4)}</b></span>
            <span>RISK: <b style={{ color: selectedAgent.risk_probability > 0.65 ? 'var(--status-danger)' : 'var(--status-normal)' }}>{((selectedAgent.risk_probability || 0) * 100).toFixed(1)}%</b></span>
          </div>

          <button
            onClick={() => handleSelect(selectedAgent.track_id)}
            style={{
              background: 'var(--bg-muted)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-muted)',
              padding: '4px 8px',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 11
            }}
          >
            ✕ Deselect
          </button>
        </div>
      )}

      {/* Empty State Banner when idle (Strictly genuine stream indicator) */}
      {effectiveAgents.length === 0 && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(7, 13, 25, 0.75)',
            color: '#94a3b8',
            fontSize: 13,
            gap: 10,
            zIndex: 5
          }}
        >
          <span style={{ fontSize: 32 }}>🌐</span>
          <span style={{ fontSize: 15, fontWeight: 600, color: '#ffffff' }}>
            3D Trajectory Telemetry Idle
          </span>
          <span style={{ fontSize: 12, color: '#64748b' }}>
            Start live stream in Dashboard or Live Monitoring to visualize genuine 3D vehicle models and motion vectors
          </span>
        </div>
      )}
    </div>
  );
}
