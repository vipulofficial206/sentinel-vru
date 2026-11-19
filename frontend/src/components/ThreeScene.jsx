import { useEffect, useRef } from 'react';
import * as THREE from 'three';

export default function ThreeScene({ data }) {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const rendererRef = useRef(null);
  const objectsRef = useRef({});

  useEffect(() => {
    if (!mountRef.current) return;
    
    // Init Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0f172a');
    sceneRef.current = scene;

    // Grid (Ground Plane)
    const grid = new THREE.GridHelper(2000, 40, '#334155', '#1e293b');
    scene.add(grid);

    // Camera
    const camera = new THREE.PerspectiveCamera(45, mountRef.current.clientWidth / 250, 1, 5000);
    // Position for Image-Space (Bottom center Y mapped to Z)
    camera.position.set(500, 1000, 1500);
    camera.lookAt(500, 0, 500);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(mountRef.current.clientWidth, 250);
    mountRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    let animId = null;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      if (rendererRef.current && sceneRef.current) {
        try {
          renderer.render(scene, camera);
        } catch (e) {
          // Ignore render errors after disposal
        }
      }
    };
    animId = requestAnimationFrame(animate);

    return () => {
      if (animId) cancelAnimationFrame(animId);
      renderer.dispose();
      if (mountRef.current && mountRef.current.contains(renderer.domElement)) {
        mountRef.current.removeChild(renderer.domElement);
      }
    };
  }, []);

  // Update loop
  useEffect(() => {
    if (!sceneRef.current || !data?.agents) return;
    const scene = sceneRef.current;
    const currentIds = new Set(data.agents.map(a => a.track_id));

    // Remove stale tracks
    Object.keys(objectsRef.current).forEach(id => {
      if (!currentIds.has(Number(id))) {
        const obj = objectsRef.current[id];
        if (obj) {
          scene.remove(obj.mesh);
          scene.remove(obj.line);
          if (obj.mesh?.geometry) obj.mesh.geometry.dispose();
          if (obj.mesh?.material) obj.mesh.material.dispose();
          if (obj.line?.geometry) obj.line.geometry.dispose();
          if (obj.line?.material) obj.line.material.dispose();
        }
        delete objectsRef.current[id];
      }
    });

    // Update/Add tracks
    data.agents.forEach(agent => {
      if (!agent || !agent.position) return;
      // Map Image-Space to 3D Plane: X -> X, Y -> Z (inverted for depth)
      const px = agent.position.x;
      const pz = agent.position.y;

      if (!objectsRef.current[agent.track_id]) {
        // Create Mesh
        const geo = new THREE.BoxGeometry(20, 20, 40);
        const mat = new THREE.MeshBasicMaterial({ color: 0x3b82f6 });
        const mesh = new THREE.Mesh(geo, mat);
        
        // Create Trajectory Line
        const lineMat = new THREE.LineBasicMaterial({ color: 0x60a5fa });
        const lineGeo = new THREE.BufferGeometry();
        const line = new THREE.Line(lineGeo, lineMat);
        
        scene.add(mesh);
        scene.add(line);
        objectsRef.current[agent.track_id] = { mesh, line };
      }

      const obj = objectsRef.current[agent.track_id];
      if (obj?.mesh) {
        obj.mesh.position.set(px, 10, pz);
      }

      // Update Line Geometry from real trajectory
      if (obj?.line && agent.trajectory && agent.trajectory.length > 0) {
        const points = agent.trajectory.map(p => new THREE.Vector3(p[0], 1, p[1]));
        obj.line.geometry.setFromPoints(points);
      }
    });
  }, [data]);

  return <div ref={mountRef} style={{ width: '100%', height: '250px', background: '#000' }} />;
}
