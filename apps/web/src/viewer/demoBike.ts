import * as THREE from 'three';

// A procedural road bike so the viewer, hotspots and comments can be developed and
// demoed before any real capture exists. Units are meters, ground at y=0, the bike
// faces +X and its drive side is +Z. Each component is a named group so default
// hotspots can be derived from real geometry bounds.

export const DEMO_PARTS = ['frame', 'fork', 'front-wheel', 'rear-wheel', 'drivetrain', 'cockpit', 'saddle'] as const;
export type DemoPart = (typeof DEMO_PARTS)[number];

type P = [number, number, number];

const UP = new THREE.Vector3(0, 1, 0);

function tube(a: P, b: P, radius: number, mat: THREE.Material): THREE.Mesh {
  const va = new THREE.Vector3(...a);
  const vb = new THREE.Vector3(...b);
  const length = va.distanceTo(vb);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 16), mat);
  mesh.position.copy(va).add(vb).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(UP, vb.clone().sub(va).normalize());
  return mesh;
}

function wheel(name: DemoPart, x: number, mats: Record<string, THREE.Material>): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  g.position.set(x, 0.34, 0);
  const tire = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.014, 16, 96), mats.rubber);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.305, 0.012, 8, 96), mats.carbon);
  rim.scale.z = 1.6;
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.1, 16), mats.metal);
  hub.rotation.x = Math.PI / 2;
  g.add(tire, rim, hub);
  const spokes = 24;
  for (let i = 0; i < spokes; i++) {
    const ang = (i / spokes) * Math.PI * 2;
    const side = i % 2 === 0 ? 0.035 : -0.035;
    g.add(tube([0, 0, side], [Math.cos(ang) * 0.3, Math.sin(ang) * 0.3, 0], 0.0018, mats.metal));
  }
  return g;
}

export function createDemoBike(): THREE.Group {
  const mats = {
    paint: new THREE.MeshStandardMaterial({ color: 0xc8102e, metalness: 0.4, roughness: 0.35 }),
    carbon: new THREE.MeshStandardMaterial({ color: 0x1b1b1f, metalness: 0.2, roughness: 0.4 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 }),
    metal: new THREE.MeshStandardMaterial({ color: 0xb8bcc4, metalness: 0.9, roughness: 0.25 }),
    leather: new THREE.MeshStandardMaterial({ color: 0x2a2320, roughness: 0.7 }),
  };

  const root = new THREE.Group();
  root.name = 'demo-bike';

  const rearAxle: P = [-0.5, 0.34, 0];
  const frontAxle: P = [0.5, 0.34, 0];
  const bb: P = [-0.08, 0.27, 0];
  const seatTop: P = [-0.22, 0.84, 0];
  const headTop: P = [0.36, 0.86, 0];
  const headBottom: P = [0.4, 0.7, 0];

  const frame = new THREE.Group();
  frame.name = 'frame';
  frame.add(
    tube(bb, seatTop, 0.017, mats.paint),
    tube(seatTop, headTop, 0.016, mats.paint),
    tube(bb, headBottom, 0.022, mats.paint),
    tube(headBottom, headTop, 0.024, mats.paint),
    tube([bb[0], bb[1], 0.04], [rearAxle[0], rearAxle[1], 0.06], 0.01, mats.paint),
    tube([bb[0], bb[1], -0.04], [rearAxle[0], rearAxle[1], -0.06], 0.01, mats.paint),
    tube([seatTop[0], seatTop[1] - 0.03, 0.02], [rearAxle[0], rearAxle[1], 0.06], 0.008, mats.paint),
    tube([seatTop[0], seatTop[1] - 0.03, -0.02], [rearAxle[0], rearAxle[1], -0.06], 0.008, mats.paint),
  );
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.09, 20), mats.paint);
  shell.position.set(...bb);
  shell.rotation.x = Math.PI / 2;
  frame.add(shell);

  const fork = new THREE.Group();
  fork.name = 'fork';
  const crown: P = [headBottom[0] + 0.01, headBottom[1] - 0.03, 0];
  fork.add(
    tube([crown[0], crown[1], 0], [crown[0], crown[1] + 0.2, 0], 0.014, mats.carbon),
    tube([crown[0] - 0.01, crown[1], -0.055], [crown[0] + 0.01, crown[1], 0.055], 0.02, mats.carbon),
    tube([crown[0], crown[1], 0.05], [frontAxle[0], frontAxle[1], 0.05], 0.012, mats.carbon),
    tube([crown[0], crown[1], -0.05], [frontAxle[0], frontAxle[1], -0.05], 0.012, mats.carbon),
  );

  const cockpit = new THREE.Group();
  cockpit.name = 'cockpit';
  const stemEnd: P = [0.46, 0.9, 0];
  cockpit.add(tube(headTop, [headTop[0] - 0.01, headTop[1] + 0.03, 0], 0.016, mats.metal), tube([headTop[0] - 0.01, headTop[1] + 0.03, 0], stemEnd, 0.015, mats.carbon));
  cockpit.add(tube([stemEnd[0], stemEnd[1], -0.21], [stemEnd[0], stemEnd[1], 0.21], 0.012, mats.carbon));
  for (const z of [-0.21, 0.21]) {
    const drop = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.012, 10, 24, Math.PI), mats.carbon);
    drop.position.set(stemEnd[0] + 0.0, stemEnd[1] - 0.07, z);
    drop.rotation.z = -Math.PI / 2;
    cockpit.add(drop);
    const hood = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.035, 0.03), mats.rubber);
    hood.position.set(stemEnd[0] + 0.07, stemEnd[1] - 0.005, z);
    cockpit.add(hood);
  }

  const saddle = new THREE.Group();
  saddle.name = 'saddle';
  const postTop: P = [-0.27, 0.98, 0];
  saddle.add(tube(seatTop, postTop, 0.0135, mats.carbon));
  const seat = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.2, 6, 16), mats.leather);
  seat.rotation.z = Math.PI / 2;
  seat.scale.set(0.45, 1, 1);
  seat.position.set(postTop[0] + 0.01, postTop[1] + 0.02, 0);
  saddle.add(seat);

  const drivetrain = new THREE.Group();
  drivetrain.name = 'drivetrain';
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.006, 8, 64), mats.metal);
  ring.position.set(bb[0], bb[1], 0.07);
  const cassette = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 32), mats.metal);
  cassette.position.set(rearAxle[0], rearAxle[1], 0.05);
  cassette.rotation.x = Math.PI / 2;
  drivetrain.add(ring, cassette);
  const crankEnd: P = [bb[0] + 0.12, bb[1] - 0.12, 0.09];
  drivetrain.add(tube([bb[0], bb[1], 0.09], crankEnd, 0.009, mats.metal), tube([bb[0], bb[1], -0.09], [bb[0] - 0.12, bb[1] + 0.12, -0.09], 0.009, mats.metal));
  // Chain: top and bottom runs between ring and cassette.
  drivetrain.add(
    tube([bb[0], bb[1] + 0.1, 0.06], [rearAxle[0], rearAxle[1] + 0.05, 0.06], 0.003, mats.rubber),
    tube([bb[0], bb[1] - 0.1, 0.06], [rearAxle[0], rearAxle[1] - 0.05, 0.06], 0.003, mats.rubber),
  );

  root.add(frame, fork, cockpit, saddle, drivetrain, wheel('front-wheel', frontAxle[0], mats), wheel('rear-wheel', rearAxle[0], mats));
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return root;
}

/** Human labels and preferred viewing directions for the default hotspots. */
export const DEMO_HOTSPOTS: { part: DemoPart; name: string; direction: P }[] = [
  { part: 'fork', name: 'Fork', direction: [0.9, 0.35, 0.8] },
  { part: 'drivetrain', name: 'Drivetrain', direction: [0.1, 0.3, 1] },
  { part: 'cockpit', name: 'Cockpit', direction: [-0.6, 0.9, 0.5] },
  { part: 'saddle', name: 'Saddle & seatpost', direction: [-0.5, 0.5, 0.9] },
  { part: 'front-wheel', name: 'Wheels', direction: [0.2, 0.15, 1] },
  { part: 'frame', name: 'Frame', direction: [0, 0.2, 1] },
];
