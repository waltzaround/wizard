import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { socketClient, Player, Projectile } from "../utils/socketClient";
import { SpellToolbar, Spell } from "./SpellToolbar";

interface GameState {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  wizard: THREE.Group;
  keys: { [key: string]: boolean };
  cameraOffset: THREE.Vector3;
  cameraAngleX?: number;
  cameraAngleY?: number;
  otherPlayers: Map<string, THREE.Group>;
  projectiles: Map<string, THREE.Group>;
  playerId?: string;
  playerHealth: number;
  playerMana: number;
  playerStamina: number;
}

interface WizardGameProps {
  username: string;
  onExitGame: () => void;
}

// Helper functions moved outside component for proper scoping
function createWizard(): THREE.Group {
  const wizard = new THREE.Group();

  // Body (cylinder)
  const bodyGeometry = new THREE.CylinderGeometry(0.8, 1.2, 2.5, 8);
  const bodyMaterial = new THREE.MeshLambertMaterial({ color: 0x4169e1 }); // Royal blue
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.position.y = 1.25;
  body.castShadow = true;
  wizard.add(body);

  // Head (sphere)
  const headGeometry = new THREE.SphereGeometry(0.6, 8, 6);
  const headMaterial = new THREE.MeshLambertMaterial({ color: 0xffdbac }); // Skin color
  const head = new THREE.Mesh(headGeometry, headMaterial);
  head.position.y = 3.1;
  head.castShadow = true;
  wizard.add(head);

  // Hat (cone)
  const hatGeometry = new THREE.ConeGeometry(0.7, 1.5, 8);
  const hatMaterial = new THREE.MeshLambertMaterial({ color: 0x800080 }); // Purple
  const hat = new THREE.Mesh(hatGeometry, hatMaterial);
  hat.position.y = 4.3;
  hat.castShadow = true;
  wizard.add(hat);

  // Staff (cylinder)
  const staffGeometry = new THREE.CylinderGeometry(0.05, 0.05, 3, 8);
  const staffMaterial = new THREE.MeshLambertMaterial({ color: 0x8b4513 }); // Brown
  const staff = new THREE.Mesh(staffGeometry, staffMaterial);
  staff.position.set(1.8, 2.5, 0);
  staff.castShadow = true;
  wizard.add(staff);

  // Staff orb
  const orbGeometry = new THREE.SphereGeometry(0.3, 8, 6);
  const orbMaterial = new THREE.MeshLambertMaterial({
    color: 0x00ffff,
    emissive: 0x004444,
  });
  const orb = new THREE.Mesh(orbGeometry, orbMaterial);
  orb.position.set(1.8, 4, 0);
  orb.castShadow = true;
  wizard.add(orb);

  return wizard;
}

function updateGame(gameState: GameState) {
  const { wizard, keys, camera, cameraOffset } = gameState;
  const moveSpeed = 0.1;

  // Client-side stamina regeneration (20 stamina per second, same as server)
  const deltaTime = 1/60; // Assuming 60 FPS
  if (typeof gameState.playerStamina === 'number' && gameState.playerStamina < 100) {
    gameState.playerStamina = Math.min(100, gameState.playerStamina + 20 * deltaTime);
  }

  // Calculate camera's forward direction (projected onto the ground plane)
  const cameraDirection = new THREE.Vector3();
  camera.getWorldDirection(cameraDirection);
  cameraDirection.y = 0; // Remove vertical component
  cameraDirection.normalize();

  // Calculate camera's right direction
  const cameraRight = new THREE.Vector3();
  cameraRight.crossVectors(cameraDirection, new THREE.Vector3(0, 1, 0));
  cameraRight.normalize();

  // Movement vector
  const moveVector = new THREE.Vector3(0, 0, 0);
  let isMoving = false;

  // WASD movement relative to camera direction
  if (keys["KeyW"]) {
    moveVector.add(cameraDirection.clone().multiplyScalar(moveSpeed));
    isMoving = true;
  }
  if (keys["KeyS"]) {
    moveVector.add(cameraDirection.clone().multiplyScalar(-moveSpeed));
    isMoving = true;
  }
  if (keys["KeyA"]) {
    moveVector.add(cameraRight.clone().multiplyScalar(-moveSpeed));
    isMoving = true;
  }
  if (keys["KeyD"]) {
    moveVector.add(cameraRight.clone().multiplyScalar(moveSpeed));
    isMoving = true;
  }

  // Apply movement with boundary checking
  if (isMoving) {
    const newPosition = wizard.position.clone().add(moveVector);
    
    // Define arena boundaries (arena is 200x200, so boundaries are -100 to +100)
    const arenaSize = 100; // Half of the 200x200 arena
    const boundary = arenaSize - 2; // Leave 2 units margin from edge
    
    // Clamp position to stay within boundaries
    newPosition.x = Math.max(-boundary, Math.min(boundary, newPosition.x));
    newPosition.z = Math.max(-boundary, Math.min(boundary, newPosition.z));
    
    // Apply the clamped position
    wizard.position.copy(newPosition);
  }

  // Make wizard always face camera direction
  wizard.lookAt(
    wizard.position.x + cameraDirection.x,
    wizard.position.y,
    wizard.position.z + cameraDirection.z
  );

  // Update camera to follow wizard smoothly
  const targetPosition = wizard.position.clone().add(cameraOffset);
  camera.position.lerp(targetPosition, 0.1);

  // Always look at wizard (this handles both movement and mouse rotation)
  camera.lookAt(wizard.position);

  // Staff orb animation removed to avoid confusion with projectiles
}

function updateMultiplayerObjects(gameState: GameState, setPlayerStats: React.Dispatch<React.SetStateAction<{ health: number; mana: number; stamina: number }>>) {
  // Send player position update to server
  if (socketClient.getIsConnected() && gameState.playerId) {
    const position = {
      x: gameState.wizard.position.x,
      y: gameState.wizard.position.y,
      z: gameState.wizard.position.z,
    };

    const rotation = {
      x: gameState.wizard.rotation.x,
      y: gameState.wizard.rotation.y,
      z: gameState.wizard.rotation.z,
    };

    socketClient.updatePlayer(position, rotation);
  }

  // Update stamina UI (throttled to avoid excessive updates)
  if (Math.random() < 0.1) { // Update UI roughly 6 times per second instead of 60
    setPlayerStats((prev) => ({ ...prev, stamina: gameState.playerStamina }));
  }
}

function updateProjectiles(
  gameState: GameState,
  projectileUpdates: Projectile[]
) {
  for (const update of projectileUpdates) {
    const projectileGroup = gameState.projectiles.get(update.id);
    if (projectileGroup) {
      // Debug logging for artillery shells
      if (update.type === "iceball") {
        console.log(
          `🔥 Artillery shell ${update.id}: exploded=${
            update.exploded
          }, explosionBroadcasted=${
            (update as any).explosionBroadcasted
          }, hasExploded=${
            projectileGroup.userData.hasExploded
          }, pos=[${update.position.x.toFixed(1)}, ${update.position.y.toFixed(
            1
          )}, ${update.position.z.toFixed(1)}]`
        );
      }

      // Check if artillery shell exploded
      if (
        update.type === "iceball" &&
        update.exploded &&
        !projectileGroup.userData.hasExploded
      ) {
        console.log(
          `💥 EXPLOSION TRIGGERED! Creating explosion effect for artillery shell ${update.id} at position:`,
          update.position
        );
        createExplosionEffect(gameState, update.position);
        projectileGroup.userData.hasExploded = true;
        // Don't update position after explosion
        continue;
      }

      // Smooth interpolation for better visual feedback
      const targetPos = update.position;

      // Lerp position for smooth movement
      const lerpFactor = 0.3;
      projectileGroup.position.lerp(
        new THREE.Vector3(targetPos.x, targetPos.y, targetPos.z),
        lerpFactor
      );

      // Simple rotation effects based on type
      if (update.type === "fireball") {
        // Fireball flame particle animation (removed rotation)
        // Animate flame particles if they exist
        const time = Date.now() * 0.01;
        projectileGroup.children.forEach((child, index) => {
          if (index > 0) {
            // Skip the main fireball mesh (index 0)
            const flameParticle = child as THREE.Mesh;
            // Make particles flicker and move slightly
            const material = flameParticle.material as THREE.MeshBasicMaterial;
            material.opacity = 0.6 + Math.sin(time + index) * 0.3;

            // Small random movement for flame effect
            const baseAngle = (index / 8) * Math.PI * 2;
            const radius = 0.3 + Math.sin(time * 2 + index) * 0.1;
            flameParticle.position.x = Math.cos(baseAngle) * radius;
            flameParticle.position.z = Math.sin(baseAngle) * radius;
            flameParticle.position.y = Math.sin(baseAngle * 0.5 + time) * 0.2;
          }
        });
      } else if (update.type === "iceball") {
        // Artillery shells - no rotation effects, just follow ballistic trajectory
        // Let the server-side physics handle the movement
      } else if (update.type === "laser") {
        // Laser beam: big glowing cylinder that sweeps a 180-degree arc
        let laserMesh = projectileGroup.getObjectByName("laserBeam");
        if (!laserMesh) {
          // Create the glowing horizontal cylinder
          const geometry = new THREE.CylinderGeometry(3, 3, 20, 32, 1, true);
          const material = new THREE.MeshBasicMaterial({
            color: 0xff0000,
            transparent: true,
            opacity: 0.5,
            side: THREE.DoubleSide,
            depthWrite: false,
          });
          laserMesh = new THREE.Mesh(geometry, material);
          laserMesh.name = "laserBeam";
          // Make the cylinder horizontal (rotate around Z)
          laserMesh.rotation.z = Math.PI / 2;
          // Place the base of the cylinder at the wizard: center at (0, 3, 0), then offset along local X by half length
          laserMesh.position.set(10, 3, 0); // 10 units along local X (after rotation)
          projectileGroup.add(laserMesh);
        }
        // Animate sweep: always left-to-right relative to facing direction
        const laserUpdate = update as any;
        if (typeof laserUpdate.sweepProgress === "number") {
          const baseRotation = Math.atan2(
            update.direction.z,
            update.direction.x
          );
          const sweepRadians =
            ((90 - 180 * laserUpdate.sweepProgress) * Math.PI) / 180;
          projectileGroup.rotation.y = baseRotation + sweepRadians;
        }
        // Optionally, add a pulsing effect
        const time = Date.now() * 0.004;
        (
          (laserMesh as THREE.Mesh).material as THREE.MeshBasicMaterial
        ).opacity = 0.5 + 0.2 * Math.sin(time);
      } else {
        // Default rotation
        projectileGroup.rotation.x += 0.15;
        projectileGroup.rotation.y += 0.15;
      }

      // Update user data
      projectileGroup.userData.targetId = update.targetId;
      projectileGroup.userData.lastPosition = { ...update.position };
      projectileGroup.userData.lastUpdate = Date.now();
    }
  }
}

// Add this type above updateProjectiles
interface LaserProjectile extends Projectile {
  sweepAngle: number;
}

// Create explosion effect for artillery shells
function createExplosionEffect(
  gameState: GameState,
  position: { x: number; y: number; z: number }
) {
  console.log(
    `💥 Creating spectacular explosion effect at [${position.x.toFixed(
      1
    )}, ${position.y.toFixed(1)}, ${position.z.toFixed(1)}]`
  );

  // Play randomized explosion sound effect
  const playExplosionSound = () => {
    try {
      // Randomly select explosion sound (explosion.mp3 to explosion4.mp3)
      const explosionNumber = Math.floor(Math.random() * 4) + 1;
      const soundFile = explosionNumber === 1 ? '/explosion.mp3' : `/explosion${explosionNumber}.mp3`;
      
      // Create audio with random volume between 0.2 and 0.6
      const explosionAudio = new Audio(soundFile);
      explosionAudio.volume = 0.2 + Math.random() * 0.4; // Random volume 20%-60%
      
      explosionAudio.play().catch((error) => {
        console.warn(`Failed to play explosion sound ${soundFile}:`, error);
      });
      
      console.log(`🔊 Playing explosion sound: ${soundFile} at volume ${(explosionAudio.volume * 100).toFixed(0)}%`);
    } catch (error) {
      console.warn('Failed to load explosion sound:', error);
    }
  };

  // Play the explosion sound
  playExplosionSound();

  // Create explosion particles - more particles for bigger explosion
  const particleCount = 40; // Doubled from 20
  const explosionGroup = new THREE.Group();

  // Create main explosion flash
  const flashGeometry = new THREE.SphereGeometry(3, 16, 12);
  const flashMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.9,
  });
  const flash = new THREE.Mesh(flashGeometry, flashMaterial);
  flash.position.set(position.x, position.y, position.z);
  explosionGroup.add(flash);

  // Create shockwave ring
  const shockwaveGeometry = new THREE.RingGeometry(0.5, 8, 32);
  const shockwaveMaterial = new THREE.MeshBasicMaterial({
    color: 0xff6600,
    transparent: true,
    opacity: 0.6,
    side: THREE.DoubleSide,
  });
  const shockwave = new THREE.Mesh(shockwaveGeometry, shockwaveMaterial);
  shockwave.position.set(position.x, position.y + 0.1, position.z);
  shockwave.rotation.x = -Math.PI / 2;
  explosionGroup.add(shockwave);

  for (let i = 0; i < particleCount; i++) {
    // Create particle geometry and material with more variety
    const particleSize = 0.15 + Math.random() * 0.35; // Larger particles
    const particleGeometry = new THREE.SphereGeometry(particleSize, 8, 6);

    // More varied colors for realistic explosion
    let particleColor;
    const colorRand = Math.random();
    if (colorRand < 0.3) {
      particleColor = 0xff0000; // Red
    } else if (colorRand < 0.6) {
      particleColor = 0xff4500; // Orange red
    } else if (colorRand < 0.8) {
      particleColor = 0xff8c00; // Dark orange
    } else {
      particleColor = 0xffd700; // Gold
    }

    const particleMaterial = new THREE.MeshBasicMaterial({
      color: particleColor,
      transparent: true,
      opacity: 0.9,
    });

    const particle = new THREE.Mesh(particleGeometry, particleMaterial);

    // Position particle at explosion center
    particle.position.set(position.x, position.y, position.z);

    // More dramatic velocity for bigger explosion
    const velocity = {
      x: (Math.random() - 0.5) * 15, // Increased from 10
      y: Math.random() * 12 + 3, // Increased upward velocity
      z: (Math.random() - 0.5) * 15, // Increased from 10
    };

    // Store velocity in userData for animation
    particle.userData = { velocity, startTime: Date.now() };

    explosionGroup.add(particle);
  }

  // Add explosion group to scene
  gameState.scene.add(explosionGroup);

  // Store explosion start time
  const explosionStartTime = Date.now();

  // Animate explosion particles with enhanced effects
  const animateExplosion = () => {
    const currentTime = Date.now();
    const explosionElapsed = (currentTime - explosionStartTime) / 1000;
    let activeParticles = 0;

    explosionGroup.children.forEach((particle, index) => {
      const mesh = particle as THREE.Mesh;

      // Handle flash effect (first child)
      if (index === 0) {
        if (explosionElapsed < 0.2) {
          activeParticles++;
          const progress = explosionElapsed / 0.2;
          const material = mesh.material as THREE.MeshBasicMaterial;
          material.opacity = 0.9 * (1 - progress);
          mesh.scale.setScalar(1 + progress * 2); // Expand quickly
        }
        return;
      }

      // Handle shockwave effect (second child)
      if (index === 1) {
        if (explosionElapsed < 1.0) {
          activeParticles++;
          const progress = explosionElapsed / 1.0;
          const material = mesh.material as THREE.MeshBasicMaterial;
          material.opacity = 0.6 * (1 - progress);
          mesh.scale.setScalar(1 + progress * 3); // Expand shockwave
        }
        return;
      }

      // Handle regular particles
      if (mesh.userData && mesh.userData.startTime) {
        const elapsed = (currentTime - mesh.userData.startTime) / 1000;
        const maxLifetime = 3; // Longer lifetime for more dramatic effect

        if (elapsed < maxLifetime) {
          activeParticles++;

          // Update particle position
          const velocity = mesh.userData.velocity;
          const deltaTime = 0.016; // ~60fps

          mesh.position.x += velocity.x * deltaTime;
          mesh.position.y += velocity.y * deltaTime;
          mesh.position.z += velocity.z * deltaTime;

          // Apply gravity
          velocity.y -= 9.8 * deltaTime;

          // Fade out over time with more dramatic curve
          const progress = elapsed / maxLifetime;
          const material = mesh.material as THREE.MeshBasicMaterial;
          material.opacity = 0.9 * Math.pow(1 - progress, 2); // Quadratic fade

          // Scale down over time
          const scale = 1 - progress * 0.7; // More dramatic scaling
          mesh.scale.setScalar(Math.max(0.1, scale));
        }
      }
    });

    // Continue animation if particles are still active
    if (activeParticles > 0) {
      requestAnimationFrame(animateExplosion);
    } else {
      // Clean up explosion
      gameState.scene.remove(explosionGroup);
      explosionGroup.children.forEach((particle) => {
        const mesh = particle as THREE.Mesh;
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      });
    }
  };

  // Start explosion animation
  animateExplosion();
}

export function WizardGame({ username, onExitGame }: WizardGameProps) {
  // Store username for potential multiplayer use
  console.log(`Player ${username} entered the game`);

  // Multiplayer state
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [playerStats, setPlayerStats] = useState({ health: 100, mana: 100, stamina: 100 });
  const [showDeathScreen, setShowDeathScreen] = useState(false);
  const [deathMessage, setDeathMessage] = useState("");
  const mountRef = useRef<HTMLDivElement>(null);
  const gameStateRef = useRef<GameState | null>(null);
  const animationIdRef = useRef<number | undefined>(undefined);
  const isInitializedRef = useRef<boolean>(false);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);

  useEffect(() => {
    if (!mountRef.current) return;

    // Prevent duplicate initialization
    if (isInitializedRef.current) {
      return;
    }

    isInitializedRef.current = true;

    // Store mount element reference to avoid React conflicts
    const mountElement = mountRef.current;

    // Play intro music followed by Harry Potter theme music
    const playGameAudio = () => {
      try {
        // First play the intro music
        const introAudio = new Audio('/intro.mp3');
        introAudio.volume = 0.3; // Set volume to 30%
        
        // Set up theme music to play after intro
        const themeAudio = new Audio('/harry.mp3');
        themeAudio.volume = 0.1; // Set volume to 30%
        themeAudio.loop = true; // Loop the theme music
        
        // When intro ends, start theme music
        introAudio.addEventListener('ended', () => {
          console.log('🎵 Intro finished, starting Harry Potter theme music');
          themeAudio.play().catch((error) => {
            console.warn('Failed to start theme music after intro:', error);
          });
        });
        
        // Start playing intro
        introAudio.play().then(() => {
          console.log('🎵 Intro music started');
        }).catch((error) => {
          console.log('Audio autoplay prevented by browser:', error);
          // Add click listener to play audio on first user interaction
          const playOnInteraction = () => {
            introAudio.play().then(() => {
              console.log('🎵 Intro music started after user interaction');
            }).catch(console.error);
            document.removeEventListener('click', playOnInteraction);
            document.removeEventListener('keydown', playOnInteraction);
          };
          document.addEventListener('click', playOnInteraction);
          document.addEventListener('keydown', playOnInteraction);
        });
        
      } catch (error) {
        console.warn('Failed to load game audio:', error);
      }
    };

    // Start game audio sequence
    playGameAudio();

    // Initialize Three.js scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87ceeb); // Sky blue background

    // Create camera
    const camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );

    // Create renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Append canvas safely
    if (mountElement && !mountElement.contains(renderer.domElement)) {
      mountElement.appendChild(renderer.domElement);
    }

    // Add lighting
    const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(50, 50, 50);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    scene.add(directionalLight);

    // Create ground plane with grid (made bigger)
    const groundGeometry = new THREE.PlaneGeometry(200, 200);
    const groundMaterial = new THREE.MeshLambertMaterial({ color: 0x90ee90 });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // Create custom grid for better visibility
    const createGrid = () => {
      const gridGroup = new THREE.Group();
      const gridSize = 100; // Increased from 50 to match new ground size
      const gridStep = 2;
      const gridColor = 0x333333;

      const material = new THREE.LineBasicMaterial({
        color: gridColor,
        opacity: 0.7,
        transparent: true,
      });

      // Create horizontal lines
      for (let i = -gridSize; i <= gridSize; i += gridStep) {
        const geometry = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(-gridSize, 0.02, i),
          new THREE.Vector3(gridSize, 0.02, i),
        ]);
        const line = new THREE.Line(geometry, material);
        gridGroup.add(line);
      }

      // Create vertical lines
      for (let i = -gridSize; i <= gridSize; i += gridStep) {
        const geometry = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(i, 0.02, -gridSize),
          new THREE.Vector3(i, 0.02, gridSize),
        ]);
        const line = new THREE.Line(geometry, material);
        gridGroup.add(line);
      }

      return gridGroup;
    };

    const grid = createGrid();
    scene.add(grid);

    // Create wizard character (low-poly style)
    const wizard = createWizard();
    wizard.position.set(0, 0, 0);
    scene.add(wizard);

    // Set up camera position (third person)
    const cameraOffset = new THREE.Vector3(0, 5, 8);
    let cameraDistance = cameraOffset.length(); // Track distance separately
    camera.position.copy(wizard.position).add(cameraOffset);
    camera.lookAt(wizard.position);

    // Initialize game state
    const keys: { [key: string]: boolean } = {};
    const gameState: GameState = {
      scene,
      camera,
      renderer,
      wizard,
      keys,
      cameraOffset,
      cameraAngleX: 0,
      cameraAngleY: 0,
      otherPlayers: new Map(),
      projectiles: new Map(),
      playerHealth: 100,
      playerMana: 100,
      playerStamina: 100,
    };

    // Store camera angles in gameState so they can be accessed in updateGame
    Object.defineProperty(gameState, "getCameraAngles", {
      value: () => ({ x: cameraAngleX, y: cameraAngleY }),
      writable: false,
    });

    Object.defineProperty(gameState, "setCameraAngles", {
      value: (x: number, y: number) => {
        cameraAngleX = x;
        cameraAngleY = y;
      },
      writable: false,
    });
    gameStateRef.current = gameState;

    // Initialize multiplayer connection
    initializeMultiplayer(gameState);

    // Event listeners for keyboard input
    const handleKeyDown = (event: KeyboardEvent) => {
      // console.log('Key down:', event.code);

      // Handle ESC key to exit game
      if (event.code === "Escape") {
        // Exit pointer lock first if active
        if (document.pointerLockElement === renderer.domElement) {
          document.exitPointerLock();
        } else {
          // If not in pointer lock, exit the game
          onExitGame();
        }
        return;
      }

      // Handle jump with Space key
      if (event.code === " ") {
        if (socketClient.getIsConnected()) {
          socketClient.playerJump();
          console.log("🦘 Jump requested");
        }
        event.preventDefault();
        return;
      }

      // Handle dash with Shift key
      if (event.code === "ShiftLeft" || event.code === "ShiftRight") {
        if (socketClient.getIsConnected()) {
          // Calculate dash direction based on current movement keys
          const dashDirection = { x: 0, z: 0 };
          
          // Get camera direction for dash
          const cameraDirection = new THREE.Vector3();
          gameState.camera.getWorldDirection(cameraDirection);
          cameraDirection.y = 0; // Remove vertical component
          cameraDirection.normalize();
          
          // Calculate camera's right direction
          const cameraRight = new THREE.Vector3();
          cameraRight.crossVectors(cameraDirection, new THREE.Vector3(0, 1, 0));
          cameraRight.normalize();
          
          // Determine dash direction based on movement keys
          if (keys["KeyW"]) {
            dashDirection.x += cameraDirection.x;
            dashDirection.z += cameraDirection.z;
          }
          if (keys["KeyS"]) {
            dashDirection.x -= cameraDirection.x;
            dashDirection.z -= cameraDirection.z;
          }
          if (keys["KeyA"]) {
            dashDirection.x -= cameraRight.x;
            dashDirection.z -= cameraRight.z;
          }
          if (keys["KeyD"]) {
            dashDirection.x += cameraRight.x;
            dashDirection.z += cameraRight.z;
          }
          
          // If no movement keys are pressed, dash forward
          if (dashDirection.x === 0 && dashDirection.z === 0) {
            dashDirection.x = cameraDirection.x;
            dashDirection.z = cameraDirection.z;
          }
          
          // Normalize dash direction
          const length = Math.sqrt(dashDirection.x * dashDirection.x + dashDirection.z * dashDirection.z);
          if (length > 0) {
            dashDirection.x /= length;
            dashDirection.z /= length;
          }
          
          socketClient.playerDash(dashDirection);
          console.log("💨 Dash requested with direction:", dashDirection);
        }
        event.preventDefault();
        return;
      }

      // Test explosion effect with 'E' key
      if (event.code === "KeyE") {
        console.log("🧪 Testing explosion effect at wizard position");
        const testPosition = {
          x: gameState.wizard.position.x + 5,
          y: gameState.wizard.position.y + 2,
          z: gameState.wizard.position.z,
        };
        createExplosionEffect(gameState, testPosition);
        event.preventDefault();
        return;
      }

      // Note: Spell casting is now handled by SpellToolbar component

      keys[event.code] = true;
      event.preventDefault();
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      // console.log('Key up:', event.code);
      keys[event.code] = false;
      event.preventDefault();
    };

    // Mouse controls for camera with pointer lock
    let cameraAngleX = 0;
    let cameraAngleY = 0;
    let isPointerLocked = false;

    const handlePointerLockChange = () => {
      isPointerLocked = document.pointerLockElement === renderer.domElement;
    };

    const handleMouseDown = (event: MouseEvent) => {
      // Only request pointer lock if not already locked
      if (!isPointerLocked) {
        renderer.domElement.requestPointerLock();
        event.preventDefault();
      }
      // Don't prevent default when already locked to allow other interactions
    };

    const handleMouseMove = (event: MouseEvent) => {
      if (!isPointerLocked) return;

      const sensitivity = 0.002;
      const deltaX = event.movementX * sensitivity;
      const deltaY = event.movementY * sensitivity;

      cameraAngleY -= deltaX;
      cameraAngleX -= deltaY;

      // Limit vertical rotation
      cameraAngleX = Math.max(
        -Math.PI / 3,
        Math.min(Math.PI / 3, cameraAngleX)
      );

      // Apply rotation to camera offset using the tracked distance
      cameraOffset.x =
        Math.sin(cameraAngleY) * Math.cos(cameraAngleX) * cameraDistance;
      cameraOffset.y = Math.sin(cameraAngleX) * cameraDistance + 5; // Keep some base height
      cameraOffset.z =
        Math.cos(cameraAngleY) * Math.cos(cameraAngleX) * cameraDistance;

      event.preventDefault();
    };

    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };

    // Scroll wheel zoom control
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();

      const zoomSpeed = 0.5;
      const minDistance = 3;
      const maxDistance = 20;

      // Adjust tracked distance based on scroll direction
      const deltaY = event.deltaY;

      if (deltaY > 0) {
        // Scroll down - zoom out
        cameraDistance = Math.min(maxDistance, cameraDistance + zoomSpeed);
      } else {
        // Scroll up - zoom in
        cameraDistance = Math.max(minDistance, cameraDistance - zoomSpeed);
      }

      // Update camera offset using current angles and new distance
      cameraOffset.x =
        Math.sin(cameraAngleY) * Math.cos(cameraAngleX) * cameraDistance;
      cameraOffset.y = Math.sin(cameraAngleX) * cameraDistance + 5;
      cameraOffset.z =
        Math.cos(cameraAngleY) * Math.cos(cameraAngleX) * cameraDistance;
    };

    // Add event listeners
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("resize", handleResize);
    document.addEventListener("pointerlockchange", handlePointerLockChange);
    renderer.domElement.addEventListener("mousedown", handleMouseDown);
    renderer.domElement.addEventListener("mousemove", handleMouseMove);
    renderer.domElement.addEventListener("wheel", handleWheel, {
      passive: false,
    });

    // Prevent context menu on right click
    renderer.domElement.addEventListener("contextmenu", (e) =>
      e.preventDefault()
    );

    // Make sure the canvas can receive focus for keyboard events
    renderer.domElement.tabIndex = 0;
    renderer.domElement.focus();

    // Start game loop
    const animate = () => {
      animationIdRef.current = requestAnimationFrame(animate);
      updateGame(gameState);
      updateMultiplayerObjects(gameState, setPlayerStats);
      renderer.render(scene, camera);
    };
    animate();

    // Store refs for cleanup
    rendererRef.current = renderer;
    sceneRef.current = scene;

    // Cleanup function
    return () => {
      isInitializedRef.current = false;

      if (animationIdRef.current) {
        cancelAnimationFrame(animationIdRef.current);
      }
      animationIdRef.current = undefined;

      // Remove event listeners
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("resize", handleResize);

      const currentRenderer = rendererRef.current;
      if (currentRenderer?.domElement) {
        currentRenderer.domElement.removeEventListener(
          "mousedown",
          handleMouseDown
        );
        currentRenderer.domElement.removeEventListener(
          "mousemove",
          handleMouseMove
        );
        currentRenderer.domElement.removeEventListener("wheel", handleWheel);
      }
      document.removeEventListener(
        "pointerlockchange",
        handlePointerLockChange
      );

      // Exit pointer lock if active
      if (document.pointerLockElement === currentRenderer?.domElement) {
        try {
          document.exitPointerLock();
        } catch (error) {
          console.warn("Pointer lock exit warning:", error);
        }
      }

      // Clear game state reference
      gameStateRef.current = null;

      // Remove canvas safely
      if (mountElement && currentRenderer?.domElement) {
        try {
          if (mountElement.contains(currentRenderer.domElement)) {
            mountElement.removeChild(currentRenderer.domElement);
          }
        } catch (error) {
          // This is expected in React StrictMode - just log it
          console.log("Canvas already removed by React:", error);
        }
      }

      // Dispose of Three.js resources safely
      try {
        if (currentRenderer) {
          currentRenderer.dispose();
          rendererRef.current = null;
        }
        const currentScene = sceneRef.current;
        if (currentScene) {
          currentScene.clear();
          sceneRef.current = null;
        }
      } catch (error) {
        console.warn("Three.js cleanup warning:", error);
      }

      // Disconnect from multiplayer server
      try {
        socketClient.disconnect();
      } catch (error) {
        console.warn("Socket disconnect warning:", error);
      }
    };
  }, []);

  return (
    <div ref={mountRef} className="w-full h-full">
      {connectionError && (
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-red-600/90 text-white p-4 rounded-lg">
          <p className="font-semibold">Connection Error</p>
          <p className="text-sm">{connectionError}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-2 bg-white/20 px-3 py-1 rounded text-sm hover:bg-white/30"
          >
            Retry
          </button>
        </div>
      )}

      {!isConnected && !connectionError && (
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-purple-600/90 text-white p-4 rounded-lg">
          <p className="font-semibold">Connecting to multiplayer...</p>
          <div className="mt-2 w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin mx-auto" />
        </div>
      )}

      {/* Death Screen Overlay */}
      {showDeathScreen && (
        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-red-900/90 border-2 border-red-500 rounded-lg p-8 text-center text-white max-w-md">
            <div className="text-6xl mb-4">💀</div>
            <h2 className="text-3xl font-bold mb-4 text-red-300">
              {" "}
              🥀🥀🥀YOU DIED! 🥀🥀🥀
            </h2>
            <p className="text-lg mb-6">{deathMessage}</p>
            <div className="flex items-center justify-center gap-2 text-yellow-300">
              <div className="animate-spin text-2xl">⏳</div>
              <span>Respawning...</span>
            </div>
          </div>
        </div>
      )}

      {/* Health and Stamina Display */}
      <div className="absolute top-4 left-4 bg-black/50 backdrop-blur-sm rounded-lg p-4 text-white">
        {/* Health Bar */}
        <div className="flex items-center gap-3 mb-3">
          <div className="text-sm font-medium">Health:</div>
          <div className="w-32 h-3 bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-red-500 to-green-500 transition-all duration-300"
              style={{ width: `${(playerStats.health / 100) * 100}%` }}
            />
          </div>
          <div className="text-sm font-mono">{playerStats.health}/100</div>
        </div>
        
        {/* Stamina Bar */}
        <div className="flex items-center gap-3">
          <div className="text-sm font-medium">Stamina:</div>
          <div className="w-32 h-3 bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-yellow-500 to-blue-500 transition-all duration-300"
              style={{ width: `${(playerStats.stamina / 100) * 100}%` }}
            />
          </div>
          <div className="text-sm font-mono">{Math.round(playerStats.stamina)}/100</div>
        </div>
        
        {/* Warning Messages */}
        {playerStats.health <= 25 && (
          <div className="text-red-400 text-xs mt-1 animate-pulse">
            ⚠️ Low Health!
          </div>
        )}
        {playerStats.stamina <= 25 && (
          <div className="text-yellow-400 text-xs mt-1 animate-pulse">
            ⚡ Low Stamina!
          </div>
        )}
      </div>

      {/* Spell Toolbar */}
      <SpellToolbar
        onSpellCast={(spell) => castSpell(gameStateRef.current!, spell)}
        isConnected={isConnected}
      />
    </div>
  );

  // Initialize multiplayer connection
  async function initializeMultiplayer(gameState: GameState) {
    try {
      setConnectionError(null);
      await socketClient.connect();

      // Set up event handlers
      socketClient.setOnGameJoined((data) => {
        console.log("🎮 Received game-joined data:", data);
        console.log("🎮 Player data:", data.player);
        console.log("🎮 Stamina value:", data.player.stamina, "Type:", typeof data.player.stamina);
        
        gameState.playerId = data.playerId;
        gameState.playerHealth = data.player.health;
        gameState.playerMana = data.player.mana;
        gameState.playerStamina = data.player.stamina;
        setPlayerStats({ health: data.player.health, mana: data.player.mana, stamina: data.player.stamina });
        setIsConnected(true);
        console.log("Joined game as:", data.player.username);
        console.log("🎮 Final gameState.playerStamina:", gameState.playerStamina);
      });

      socketClient.setOnExistingPlayers((players) => {
        players.forEach((player) => {
          if (player.id !== gameState.playerId) {
            createOtherPlayer(gameState, player);
          }
        });
      });

      socketClient.setOnPlayerJoined((player) => {
        if (player.id !== gameState.playerId) {
          createOtherPlayer(gameState, player);
        }
      });

      socketClient.setOnPlayerLeft((playerId) => {
        removeOtherPlayer(gameState, playerId);
      });

      socketClient.setOnPlayerMoved((data) => {
        updateOtherPlayer(
          gameState,
          data.playerId,
          data.position,
          data.rotation
        );
      });

      socketClient.setOnProjectileCreated((projectile) => {
        if (gameStateRef.current) {
          createProjectile(gameStateRef.current, projectile);
          console.log("Created projectile:", projectile.id, projectile.type);
        }
      });

      socketClient.setOnProjectilesUpdate(
        (data: { active: Projectile[]; expired: string[] }) => {
          if (!gameStateRef.current) return;

          // Remove expired projectiles
          for (const expiredId of data.expired) {
            const projectile = gameStateRef.current.projectiles.get(expiredId);
            if (projectile) {
              gameStateRef.current.scene.remove(projectile);
              gameStateRef.current.projectiles.delete(expiredId);
              console.log("Removed expired projectile:", expiredId);
            }
          }

          // Update existing projectiles (don't create new ones here)
          updateProjectiles(gameStateRef.current, data.active);
        }
      );

      socketClient.setOnPlayerHit((data) => {
        if (data.playerId === gameState.playerId) {
          gameState.playerHealth = data.health;
          setPlayerStats((prev) => ({ ...prev, health: data.health }));
        } else {
          // Update other player's health bar
          updateOtherPlayerHealth(gameState, data.playerId, data.health);
        }
      });

      socketClient.setOnPlayerStatsUpdated((data) => {
        if (data.playerId === gameState.playerId) {
          gameState.playerHealth = data.health;
          gameState.playerMana = data.mana;
          setPlayerStats((prev) => ({ ...prev, health: data.health, mana: data.mana }));
        } else {
          // Update other player's health bar
          updateOtherPlayerHealth(gameState, data.playerId, data.health);
        }
      });

      // Handle player death
      socketClient.setOnPlayerDiedSelf((data) => {
        console.log("💀 You died!", data.message);
        setDeathMessage(data.message);
        setShowDeathScreen(true);
      });

      // Handle player respawn
      socketClient.setOnPlayerRespawned((data) => {
        console.log("✨ You respawned!", data.message);
        if (gameStateRef.current) {
          // Update player position and stats
          gameStateRef.current.wizard.position.set(
            data.position.x,
            data.position.y,
            data.position.z
          );
          gameStateRef.current.camera.position.set(
            data.position.x,
            data.position.y + 5,
            data.position.z + 10
          );
          gameStateRef.current.playerHealth = data.health;
          gameStateRef.current.playerMana = data.mana;
          gameStateRef.current.playerStamina = 100; // Reset stamina on respawn
          setPlayerStats({ health: data.health, mana: data.mana, stamina: 100 });
        }
        setShowDeathScreen(false);
        setDeathMessage("");
      });

      // Handle other player deaths (hide their character)
      socketClient.setOnPlayerDiedOther((data) => {
        console.log(`💀 Player ${data.username} died - hiding their character`);
        if (gameStateRef.current) {
          const otherPlayer = gameStateRef.current.otherPlayers.get(
            data.playerId
          );
          if (otherPlayer) {
            otherPlayer.visible = false;
            console.log(`Hidden dead player: ${data.playerId}`);
          }
        }
      });

      // Handle other player respawns (show their character again)
      socketClient.setOnPlayerRespawnedOther((data) => {
        console.log(
          `✨ Player ${data.username} respawned - showing their character`
        );
        if (gameStateRef.current) {
          const otherPlayer = gameStateRef.current.otherPlayers.get(
            data.playerId
          );
          if (otherPlayer) {
            otherPlayer.visible = true;
            // Update position to respawn location
            otherPlayer.position.set(
              data.position.x,
              data.position.y,
              data.position.z
            );
            // Update health bar to full health (100)
            updateOtherPlayerHealth(gameStateRef.current, data.playerId, 100);
            console.log(`Showed respawned player: ${data.playerId}`);
          }
        }
      });

      // Handle jump events
      socketClient.setOnPlayerJumped((data) => {
        if (data.playerId === gameState.playerId) {
          // Update own stamina
          gameState.playerStamina = data.stamina;
          setPlayerStats((prev) => ({ ...prev, stamina: data.stamina }));
          console.log(`🦘 You jumped! Stamina: ${data.stamina}`);
        }
        // Could add visual effects for other players jumping here
      });

      // Handle dash events
      socketClient.setOnPlayerDashed((data) => {
        if (data.playerId === gameState.playerId) {
          // Update own stamina
          gameState.playerStamina = data.stamina;
          setPlayerStats((prev) => ({ ...prev, stamina: data.stamina }));
          console.log(`💨 You dashed! Stamina: ${data.stamina}`);
        }
        // Could add visual effects for other players dashing here
      });

      // Join the game
      socketClient.joinGame(username);
    } catch (error) {
      console.error("Failed to connect to multiplayer server:", error);
      setConnectionError(
        "Failed to connect to multiplayer server. Please try again."
      );
    }
  }

  // Cast spell function
  function castSpell(gameState: GameState, spell: Spell) {
    console.log(
      "Attempting to cast spell:",
      spell.name,
      "Connected:",
      socketClient.getIsConnected()
    );

    if (!socketClient.getIsConnected()) {
      console.log("Cannot cast spell: Not connected to server");
      return;
    }

    console.log("Casting spell:", spell.name, "Type:", spell.type);

    // Handle different spell types
    switch (spell.type) {
      case "projectile":
        castProjectileSpell(gameState, spell);
        break;
      case "self":
        castSelfSpell(gameState, spell);
        break;
      case "utility":
        castUtilitySpell(gameState, spell);
        break;
      case "area":
        castAreaSpell(gameState, spell);
        break;
    }
  }

  // Cast projectile spells (fireball, iceball, lightning)
  function castProjectileSpell(gameState: GameState, spell: Spell) {
    console.log("Casting projectile spell:", spell.id);

    // Get camera direction for spell casting
    const cameraDirection = new THREE.Vector3();
    gameState.camera.getWorldDirection(cameraDirection);
    cameraDirection.normalize();

    // Prevent fireballs from going underground by limiting downward angle
    const minY = -0.2; // Limit downward angle to prevent going underground
    if (cameraDirection.y < minY) {
      cameraDirection.y = minY;
      cameraDirection.normalize(); // Re-normalize after adjustment
    }

    // Cast from wizard's staff orb position for better visual origin
    const staffOrbWorldPosition = new THREE.Vector3();

    // Find the staff orb in the wizard group
    const staffOrb = gameState.wizard.children.find(
      (child) =>
        child instanceof THREE.Mesh &&
        (child.material as THREE.MeshLambertMaterial).color.getHex() ===
          0x00ffff
    );

    if (staffOrb) {
      // Get the world position of the staff orb
      staffOrb.getWorldPosition(staffOrbWorldPosition);
    } else {
      // Fallback to wizard position + offset if orb not found
      staffOrbWorldPosition.copy(gameState.wizard.position);
      staffOrbWorldPosition.y += 4; // Staff orb height
      staffOrbWorldPosition.x += 1.8; // Staff orb x offset
    }

    const spellPosition = {
      x: staffOrbWorldPosition.x,
      y: staffOrbWorldPosition.y,
      z: staffOrbWorldPosition.z,
    };

    const spellDirection = {
      x: cameraDirection.x,
      y: cameraDirection.y,
      z: cameraDirection.z,
    };

    console.log("Sending spell to server:", {
      position: spellPosition,
      direction: spellDirection,
      spellType: spell.id,
    });

    socketClient.castSpell(
      spellPosition,
      spellDirection,
      spell.id === "lightning" ? "laser" : spell.id
    );
  }

  // Cast self spells (heal)
  function castSelfSpell(gameState: GameState, spell: Spell) {
    if (spell.id === "heal") {
      // Heal spell - restore health
      gameState.playerHealth = Math.min(100, gameState.playerHealth + 30);
      setPlayerStats((prev) => ({ ...prev, health: gameState.playerHealth }));

      // Create visual healing effect
      createHealingEffect(gameState);
    }
  }

  // Cast utility spells (teleport)
  function castUtilitySpell(gameState: GameState, spell: Spell) {
    if (spell.id === "teleport") {
      // Teleport spell - move forward
      const cameraDirection = new THREE.Vector3();
      gameState.camera.getWorldDirection(cameraDirection);
      cameraDirection.y = 0; // Keep on ground level
      cameraDirection.normalize();

      const teleportDistance = 10;
      gameState.wizard.position.add(
        cameraDirection.multiplyScalar(teleportDistance)
      );

      // Create visual teleport effect
      createTeleportEffect(gameState);
    }
  }

  // Cast area spells (artillery strike)
  function castAreaSpell(gameState: GameState, spell: Spell) {
    if (spell.id === "iceball") {
      castArtilleryStrike(gameState);
    } else {
      console.log(`Area spell ${spell.name} not implemented yet`);
    }
  }

  // Cast artillery strike - shotgun barrage at closest player
  function castArtilleryStrike(gameState: GameState) {
    console.log("Casting artillery strike");

    if (!socketClient.getIsConnected()) {
      console.log("Cannot cast artillery: Not connected to server");
      return;
    }

    // Find closest enemy player
    let closestPlayer = null;
    let closestDistance = Infinity;

    console.log(`Looking for targets. Other players count: ${gameState.otherPlayers.size}`);
    
    for (const [playerId, playerWizard] of gameState.otherPlayers) {
      if (playerId !== gameState.playerId) {
        const distance = gameState.wizard.position.distanceTo(
          playerWizard.position
        );
        console.log(`Found potential target ${playerId} at distance ${distance.toFixed(2)}`);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestPlayer = { id: playerId, wizard: playerWizard };
        }
      }
    }

    if (!closestPlayer) {
      console.log("No target found for artillery strike - firing at random area ahead");
      // If no enemy players, fire at a random area in front of the caster
      const cameraDirection = new THREE.Vector3();
      gameState.camera.getWorldDirection(cameraDirection);
      cameraDirection.y = 0; // Keep horizontal
      cameraDirection.normalize();
      
      // Create a fake target position ahead of the player
      const targetDistance = 20 + Math.random() * 15; // 20-35 units ahead
      const fakeTarget = gameState.wizard.position.clone();
      fakeTarget.add(cameraDirection.multiplyScalar(targetDistance));
      
      // Add some random offset to the fake target
      fakeTarget.x += (Math.random() - 0.5) * 20;
      fakeTarget.z += (Math.random() - 0.5) * 20;
      
      closestPlayer = {
        id: "fake",
        wizard: { position: fakeTarget }
      };
      closestDistance = targetDistance;
    }

    console.log(
      `Artillery targeting ${closestPlayer.id === "fake" ? "random area" : "player"} at distance ${closestDistance.toFixed(2)}`
    );

    // Get staff orb position for origin
    const staffOrbWorldPosition = new THREE.Vector3();
    const staffOrb = gameState.wizard.children.find(
      (child) =>
        child instanceof THREE.Mesh &&
        (child.material as THREE.MeshLambertMaterial).color.getHex() ===
          0x00ffff
    );

    if (staffOrb) {
      staffOrb.getWorldPosition(staffOrbWorldPosition);
    } else {
      staffOrbWorldPosition.copy(gameState.wizard.position);
      staffOrbWorldPosition.y += 4;
      staffOrbWorldPosition.x += 1.8;
    }

    // Cast multiple projectiles in a shotgun pattern
    const projectileCount = 16; // Increased from 12 to 16 for even more coverage

    for (let i = 0; i < projectileCount; i++) {
      // Get target position
      const targetPos = closestPlayer.wizard.position;

      console.log(
        `Artillery shell ${i + 1}: Caster at [${staffOrbWorldPosition.x.toFixed(
          1
        )}, ${staffOrbWorldPosition.y.toFixed(
          1
        )}, ${staffOrbWorldPosition.z.toFixed(1)}]`
      );
      console.log(
        `Artillery shell ${i + 1}: Target at [${targetPos.x.toFixed(
          1
        )}, ${targetPos.y.toFixed(1)}, ${targetPos.z.toFixed(1)}]`
      );

      // Calculate direction vector from caster to target
      const deltaX = targetPos.x - staffOrbWorldPosition.x;
      const deltaZ = targetPos.z - staffOrbWorldPosition.z;

      console.log(
        `Artillery shell ${i + 1}: Delta [${deltaX.toFixed(
          1
        )}, ${deltaZ.toFixed(1)}]`
      );

      // Create mortar-style trajectory aimed at target with spread
      const direction = new THREE.Vector3();

      // Calculate base direction toward target
      const baseDirection = new THREE.Vector3(
        deltaX,
        0, // Start with horizontal aim
        deltaZ
      );
      baseDirection.normalize();

      // Set higher mortar angle for much higher arcs (60 degrees instead of 45)
      const mortarAngle = Math.PI / 3; // 60 degrees for much higher arcs
      direction.x = baseDirection.x * Math.cos(mortarAngle);
      direction.y = Math.sin(mortarAngle); // Much stronger upward component for higher arcs
      direction.z = baseDirection.z * Math.cos(mortarAngle);

      // Add much more random spread around the target for wider artillery barrage
      const spreadAmount = 0.8; // Increased from 0.3 to 0.8 for much wider spread
      direction.x += (Math.random() - 0.5) * spreadAmount;
      direction.z += (Math.random() - 0.5) * spreadAmount;

      // Add more variation in launch angle for more realistic artillery spread
      direction.y += (Math.random() - 0.5) * 0.4; // Increased from 0.2 to 0.4 for more launch angle variation

      // Normalize to maintain consistent launch speed
      direction.normalize();

      console.log(
        `Artillery shell ${i + 1}: Final direction [${direction.x.toFixed(
          2
        )}, ${direction.y.toFixed(2)}, ${direction.z.toFixed(2)}]`
      );

      const spellPosition = {
        x: staffOrbWorldPosition.x,
        y: staffOrbWorldPosition.y,
        z: staffOrbWorldPosition.z,
      };

      const spellDirection = {
        x: direction.x,
        y: direction.y,
        z: direction.z,
      };

      // Stagger the shots slightly for visual effect
      setTimeout(() => {
        console.log(`Firing artillery shell ${i + 1}/${projectileCount}`);
        socketClient.castSpell(spellPosition, spellDirection, "iceball");
      }, i * 100); // 100ms delay between shots
    }
  }

  // Create healing visual effect
  function createHealingEffect(gameState: GameState) {
    const healingGeometry = new THREE.SphereGeometry(0.5, 8, 6);
    const healingMaterial = new THREE.MeshBasicMaterial({
      color: 0x32cd32,
      transparent: true,
      opacity: 0.7,
    });

    // Create multiple healing orbs
    for (let i = 0; i < 5; i++) {
      const healingOrb = new THREE.Mesh(healingGeometry, healingMaterial);
      healingOrb.position.copy(gameState.wizard.position);
      healingOrb.position.y += 1 + Math.random() * 2;
      healingOrb.position.x += (Math.random() - 0.5) * 2;
      healingOrb.position.z += (Math.random() - 0.5) * 2;

      gameState.scene.add(healingOrb);

      // Animate healing orb
      const startTime = Date.now();
      const animateHealing = () => {
        const elapsed = Date.now() - startTime;
        const progress = elapsed / 2000; // 2 second animation

        if (progress < 1) {
          healingOrb.position.y += 0.02;
          healingOrb.material.opacity = 0.7 * (1 - progress);
          healingOrb.rotation.y += 0.1;
          requestAnimationFrame(animateHealing);
        } else {
          gameState.scene.remove(healingOrb);
          healingGeometry.dispose();
          healingMaterial.dispose();
        }
      };

      setTimeout(() => animateHealing(), i * 200); // Stagger the orbs
    }
  }

  // Create teleport visual effect
  function createTeleportEffect(gameState: GameState) {
    const teleportGeometry = new THREE.RingGeometry(0.5, 2, 16);
    const teleportMaterial = new THREE.MeshBasicMaterial({
      color: 0x9370db,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
    });

    // Create teleport ring at current position
    const teleportRing = new THREE.Mesh(teleportGeometry, teleportMaterial);
    teleportRing.position.copy(gameState.wizard.position);
    teleportRing.position.y = 0.1; // Just above ground
    teleportRing.rotation.x = -Math.PI / 2; // Lay flat

    gameState.scene.add(teleportRing);

    // Animate teleport ring
    const startTime = Date.now();
    const animateTeleport = () => {
      const elapsed = Date.now() - startTime;
      const progress = elapsed / 1000; // 1 second animation

      if (progress < 1) {
        teleportRing.scale.setScalar(1 + progress * 2);
        teleportRing.material.opacity = 0.8 * (1 - progress);
        teleportRing.rotation.z += 0.1;
        requestAnimationFrame(animateTeleport);
      } else {
        gameState.scene.remove(teleportRing);
        teleportGeometry.dispose();
        teleportMaterial.dispose();
      }
    };

    animateTeleport();
  }

  // Create health bar for other players
  function createHealthBar(health: number): THREE.Sprite {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d")!;
    canvas.width = 200;
    canvas.height = 32;
    
    // Clear canvas
    context.clearRect(0, 0, canvas.width, canvas.height);
    
    // Background
    context.fillStyle = "rgba(0, 0, 0, 0.6)";
    context.fillRect(0, 0, canvas.width, canvas.height);
    
    // Health bar background
    const barWidth = 180;
    const barHeight = 16;
    const barX = 10;
    const barY = 8;
    
    context.fillStyle = "rgba(100, 100, 100, 0.8)";
    context.fillRect(barX, barY, barWidth, barHeight);
    
    // Health bar fill
    const healthPercent = Math.max(0, Math.min(100, health)) / 100;
    const fillWidth = barWidth * healthPercent;
    
    // Color based on health percentage
    let healthColor;
    if (healthPercent > 0.6) {
      healthColor = "#4ade80"; // Green
    } else if (healthPercent > 0.3) {
      healthColor = "#fbbf24"; // Yellow
    } else {
      healthColor = "#ef4444"; // Red
    }
    
    context.fillStyle = healthColor;
    context.fillRect(barX, barY, fillWidth, barHeight);
    
    // Health text
    context.fillStyle = "white";
    context.font = "12px Arial";
    context.textAlign = "center";
    context.fillText(`${Math.round(health)}/100`, canvas.width / 2, barY + barHeight - 2);
    
    const texture = new THREE.CanvasTexture(canvas);
    const healthBarMaterial = new THREE.SpriteMaterial({ map: texture });
    const healthBarSprite = new THREE.Sprite(healthBarMaterial);
    healthBarSprite.scale.set(3, 0.5, 1);
    
    return healthBarSprite;
  }

  // Create other player function
  function createOtherPlayer(gameState: GameState, player: Player) {
    const otherWizard = createWizard();

    // Set player color
    const bodyMesh = otherWizard.children.find(
      (child: THREE.Object3D) =>
        child instanceof THREE.Mesh &&
        (child.material as THREE.MeshLambertMaterial).color.getHex() ===
          0x4169e1
    ) as THREE.Mesh;

    if (bodyMesh) {
      (bodyMesh.material as THREE.MeshLambertMaterial).color.setHex(
        player.color
      );
    }

    // Set position and rotation
    otherWizard.position.set(
      player.position.x,
      player.position.y,
      player.position.z
    );
    otherWizard.rotation.set(
      player.rotation.x,
      player.rotation.y,
      player.rotation.z
    );

    // Add username label
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d")!;
    canvas.width = 256;
    canvas.height = 64;
    context.fillStyle = "rgba(0, 0, 0, 0.4)";
    context.fillRect(0, 0, 256, 64);
    context.fillStyle = "white";
    context.font = "20px Arial";
    context.textAlign = "center";
    context.fillText(player.username, 128, 40);

    const texture = new THREE.CanvasTexture(canvas);
    const labelMaterial = new THREE.SpriteMaterial({ map: texture });
    const label = new THREE.Sprite(labelMaterial);
    label.position.set(0, 7.5, 0);
    label.scale.set(4, 1, 1);
    label.name = "usernameLabel";
    otherWizard.add(label);

    // Add health bar
    const healthBar = createHealthBar(player.health);
    healthBar.position.set(0, 6.5, 0);
    healthBar.name = "healthBar";
    otherWizard.add(healthBar);

    // Store player data for health updates
    otherWizard.userData = {
      playerId: player.id,
      username: player.username,
      health: player.health
    };

    gameState.otherPlayers.set(player.id, otherWizard);
    gameState.scene.add(otherWizard);

    console.log(`Added other player: ${player.username} with health: ${player.health}`);
  }

  // Remove other player function
  function removeOtherPlayer(gameState: GameState, playerId: string) {
    const otherWizard = gameState.otherPlayers.get(playerId);
    if (otherWizard) {
      gameState.scene.remove(otherWizard);
      gameState.otherPlayers.delete(playerId);
      console.log(`Removed other player: ${playerId}`);
    }
  }

  // Update other player health bar
  function updateOtherPlayerHealth(gameState: GameState, playerId: string, health: number) {
    const otherWizard = gameState.otherPlayers.get(playerId);
    if (otherWizard) {
      // Update stored health data
      otherWizard.userData.health = health;
      
      // Find and update the health bar
      const healthBar = otherWizard.getObjectByName("healthBar") as THREE.Sprite;
      if (healthBar) {
        // Create new health bar texture
        const newHealthBar = createHealthBar(health);
        
        // Update the material with new texture
        if (healthBar.material instanceof THREE.SpriteMaterial) {
          // Dispose old texture to prevent memory leaks
          if (healthBar.material.map) {
            healthBar.material.map.dispose();
          }
          healthBar.material.map = newHealthBar.material.map;
          healthBar.material.needsUpdate = true;
        }
      }
    }
  }

  // Update other player function
  function updateOtherPlayer(
    gameState: GameState,
    playerId: string,
    position: { x: number; y: number; z: number },
    rotation: { x: number; y: number; z: number }
  ) {
    const otherWizard = gameState.otherPlayers.get(playerId);
    if (otherWizard) {
      // Smooth interpolation to new position
      otherWizard.position.lerp(
        new THREE.Vector3(position.x, position.y, position.z),
        0.3
      );
      otherWizard.rotation.set(rotation.x, rotation.y, rotation.z);
    }
  }

  // Note: hideOtherPlayer and showOtherPlayer functionality is now handled inline in event handlers

  // Create projectile function
  function createProjectile(gameState: GameState, projectile: Projectile) {
    let projectileGeometry, projectileMaterial;

    // Play laser sound when laser projectile is created
    if (projectile.type === "laser") {
      try {
        const laserAudio = new Audio('/laser.mp3');
        laserAudio.volume = 0.4; // Set volume to 40%
        laserAudio.play().catch((error) => {
          console.warn('Failed to play laser sound:', error);
        });
        console.log('🔫 Playing laser sound effect');
      } catch (error) {
        console.warn('Failed to load laser sound:', error);
      }
    }

    // Play fireball sound when fireball projectile is created
    if (projectile.type === "fireball") {
      try {
        const fireballAudio = new Audio('/fireball.mp3');
        fireballAudio.volume = 0.5; // Set volume to 50%
        fireballAudio.play().catch((error) => {
          console.warn('Failed to play fireball sound:', error);
        });
        console.log('🔥 Playing fireball sound effect');
      } catch (error) {
        console.warn('Failed to load fireball sound:', error);
      }
    }

    // Choose geometry/material based on projectile type
    if (projectile.type === "fireball") {
      projectileGeometry = new THREE.SphereGeometry(0.3, 10, 8);
      projectileMaterial = new THREE.MeshBasicMaterial({ color: 0xff6600 });
    } else if (projectile.type === "iceball") {
      projectileGeometry = new THREE.SphereGeometry(0.4, 12, 10);
      projectileMaterial = new THREE.MeshBasicMaterial({ color: 0xff6600 });
    } else {
      projectileGeometry = new THREE.SphereGeometry(0.25, 8, 6);
      projectileMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    }

    const projectileMesh = new THREE.Mesh(
      projectileGeometry,
      projectileMaterial
    );

    // Set initial position
    projectileMesh.position.set(
      projectile.position.x,
      projectile.position.y,
      projectile.position.z
    );

    // Create projectile group
    const projectileGroup = new THREE.Group();
    projectileGroup.add(projectileMesh);

    // Add flame particles for fireball (but no orbiting)
    if (projectile.type === "fireball") {
      // Create flame particles around the fireball
      for (let i = 0; i < 8; i++) {
        const flameGeometry = new THREE.SphereGeometry(0.1, 6, 4);
        const flameMaterial = new THREE.MeshBasicMaterial({
          color: Math.random() > 0.5 ? 0xff6600 : 0xff2200,
          transparent: true,
          opacity: 0.8,
        });
        const flameParticle = new THREE.Mesh(flameGeometry, flameMaterial);

        // Position particles around the main fireball
        const angle = (i / 8) * Math.PI * 2;
        const radius = 0.3;
        flameParticle.position.set(
          Math.cos(angle) * radius,
          Math.sin(angle * 0.5) * 0.2,
          Math.sin(angle) * radius
        );

        projectileGroup.add(flameParticle);
      }
    }

    // Store projectile data for updates
    projectileGroup.userData = {
      id: projectile.id,
      type: projectile.type,
      targetId: projectile.targetId,
      lastPosition: { ...projectile.position },
    };

    gameState.projectiles.set(projectile.id, projectileGroup);
    gameState.scene.add(projectileGroup);
  }
} // End of WizardGame component function

// Export the component
export default WizardGame;
