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
}

interface WizardGameProps {
  username: string;
  onExitGame: () => void;
}

export function WizardGame({ username, onExitGame }: WizardGameProps) {
  // Store username for potential multiplayer use
  console.log(`Player ${username} entered the game`);
  
  // Multiplayer state
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [playerStats, setPlayerStats] = useState({ health: 100, mana: 100 });
  const mountRef = useRef<HTMLDivElement>(null);
  const gameStateRef = useRef<GameState | null>(null);
  const animationIdRef = useRef<number | undefined>();
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

    // Initialize Three.js scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB); // Sky blue background
    
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

    // Create ground plane with grid
    const groundGeometry = new THREE.PlaneGeometry(100, 100);
    const groundMaterial = new THREE.MeshLambertMaterial({ color: 0x90EE90 });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // Create custom grid for better visibility
    const createGrid = () => {
      const gridGroup = new THREE.Group();
      const gridSize = 50;
      const gridStep = 2;
      const gridColor = 0x333333;
      
      const material = new THREE.LineBasicMaterial({ color: gridColor, opacity: 0.7, transparent: true });
      
      // Create horizontal lines
      for (let i = -gridSize; i <= gridSize; i += gridStep) {
        const geometry = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(-gridSize, 0.02, i),
          new THREE.Vector3(gridSize, 0.02, i)
        ]);
        const line = new THREE.Line(geometry, material);
        gridGroup.add(line);
      }
      
      // Create vertical lines
      for (let i = -gridSize; i <= gridSize; i += gridStep) {
        const geometry = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(i, 0.02, -gridSize),
          new THREE.Vector3(i, 0.02, gridSize)
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
      playerMana: 100
    };
    
    // Store camera angles in gameState so they can be accessed in updateGame
    Object.defineProperty(gameState, 'getCameraAngles', {
      value: () => ({ x: cameraAngleX, y: cameraAngleY }),
      writable: false
    });
    
    Object.defineProperty(gameState, 'setCameraAngles', {
      value: (x: number, y: number) => {
        cameraAngleX = x;
        cameraAngleY = y;
      },
      writable: false
    });
    gameStateRef.current = gameState;

    // Initialize multiplayer connection
    initializeMultiplayer(gameState);

    // Event listeners for keyboard input
    const handleKeyDown = (event: KeyboardEvent) => {
     // console.log('Key down:', event.code);
      
      // Handle ESC key to exit game
      if (event.code === 'Escape') {
        // Exit pointer lock first if active
        if (document.pointerLockElement === renderer.domElement) {
          document.exitPointerLock();
        } else {
          // If not in pointer lock, exit the game
          onExitGame();
        }
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
      cameraAngleX = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, cameraAngleX));
      
      // Apply rotation to camera offset using the tracked distance
      cameraOffset.x = Math.sin(cameraAngleY) * Math.cos(cameraAngleX) * cameraDistance;
      cameraOffset.y = Math.sin(cameraAngleX) * cameraDistance + 5; // Keep some base height
      cameraOffset.z = Math.cos(cameraAngleY) * Math.cos(cameraAngleX) * cameraDistance;
      
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
      cameraOffset.x = Math.sin(cameraAngleY) * Math.cos(cameraAngleX) * cameraDistance;
      cameraOffset.y = Math.sin(cameraAngleX) * cameraDistance + 5;
      cameraOffset.z = Math.cos(cameraAngleY) * Math.cos(cameraAngleX) * cameraDistance;
    };

    // Add event listeners
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('resize', handleResize);
    document.addEventListener('pointerlockchange', handlePointerLockChange);
    renderer.domElement.addEventListener('mousedown', handleMouseDown);
    renderer.domElement.addEventListener('mousemove', handleMouseMove);
    renderer.domElement.addEventListener('wheel', handleWheel, { passive: false });
    
    // Prevent context menu on right click
    renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
    
    // Make sure the canvas can receive focus for keyboard events
    renderer.domElement.tabIndex = 0;
    renderer.domElement.focus();

    // Start game loop
    const animate = () => {
      animationIdRef.current = requestAnimationFrame(animate);
      updateGame(gameState);
      updateMultiplayerObjects(gameState);
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
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('resize', handleResize);
      
      const currentRenderer = rendererRef.current;
      if (currentRenderer?.domElement) {
        currentRenderer.domElement.removeEventListener('mousedown', handleMouseDown);
        currentRenderer.domElement.removeEventListener('mousemove', handleMouseMove);
        currentRenderer.domElement.removeEventListener('wheel', handleWheel);
      }
      document.removeEventListener('pointerlockchange', handlePointerLockChange);
      
      // Exit pointer lock if active
      if (document.pointerLockElement === currentRenderer?.domElement) {
        try {
          document.exitPointerLock();
        } catch (error) {
          console.warn('Pointer lock exit warning:', error);
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
          console.log('Canvas already removed by React');
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
        console.warn('Three.js cleanup warning:', error);
      }
      
      // Disconnect from multiplayer server
      try {
        socketClient.disconnect();
      } catch (error) {
        console.warn('Socket disconnect warning:', error);
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
      
      {/* Health Display */}
      <div className="absolute top-4 left-4 bg-black/50 backdrop-blur-sm rounded-lg p-4 text-white">
        <div className="flex items-center gap-3">
          <div className="text-sm font-medium">Health:</div>
          <div className="w-32 h-3 bg-gray-700 rounded-full overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-red-500 to-green-500 transition-all duration-300"
              style={{ width: `${(playerStats.health / 100) * 100}%` }}
            />
          </div>
          <div className="text-sm font-mono">{playerStats.health}/100</div>
        </div>
        {playerStats.health <= 25 && (
          <div className="text-red-400 text-xs mt-1 animate-pulse">
            ⚠️ Low Health!
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
        gameState.playerId = data.playerId;
        gameState.playerHealth = data.player.health;
        gameState.playerMana = data.player.mana;
        setPlayerStats({ health: data.player.health, mana: data.player.mana });
        setIsConnected(true);
        console.log('Joined game as:', data.player.username);
      });
      
      socketClient.setOnExistingPlayers((players) => {
        players.forEach(player => {
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
        updateOtherPlayer(gameState, data.playerId, data.position, data.rotation);
      });
      
      socketClient.setOnProjectileCreated((projectile) => {
        if (gameStateRef.current) {
          createProjectile(gameStateRef.current, projectile);
          console.log('Created projectile:', projectile.id, projectile.type);
        }
      });
      
      socketClient.setOnProjectilesUpdate((data: { active: Projectile[]; expired: string[] }) => {
        if (!gameStateRef.current) return;
        
        // Remove expired projectiles
        for (const expiredId of data.expired) {
          const projectile = gameStateRef.current.projectiles.get(expiredId);
          if (projectile) {
            gameStateRef.current.scene.remove(projectile);
            gameStateRef.current.projectiles.delete(expiredId);
            console.log('Removed expired projectile:', expiredId);
          }
        }
        
        // Update existing projectiles (don't create new ones here)
        updateProjectiles(gameStateRef.current, data.active);
      });
      
      socketClient.setOnPlayerHit((data) => {
        if (data.playerId === gameState.playerId) {
          gameState.playerHealth = data.health;
          setPlayerStats(prev => ({ ...prev, health: data.health }));
        }
      });
      
      socketClient.setOnPlayerStatsUpdated((data) => {
        if (data.playerId === gameState.playerId) {
          gameState.playerHealth = data.health;
          gameState.playerMana = data.mana;
          setPlayerStats({ health: data.health, mana: data.mana });
        }
      });
      
      // Join the game
      socketClient.joinGame(username);
      
    } catch (error) {
      console.error('Failed to connect to multiplayer server:', error);
      setConnectionError('Failed to connect to multiplayer server. Please try again.');
    }
  }

  // Cast spell function
  function castSpell(gameState: GameState, spell: Spell) {
    console.log('Attempting to cast spell:', spell.name, 'Connected:', socketClient.getIsConnected());
    
    if (!socketClient.getIsConnected()) {
      console.log('Cannot cast spell: Not connected to server');
      return;
    }
    
    console.log('Casting spell:', spell.name, 'Type:', spell.type);
    
    // Handle different spell types
    switch (spell.type) {
      case 'projectile':
        castProjectileSpell(gameState, spell);
        break;
      case 'self':
        castSelfSpell(gameState, spell);
        break;
      case 'utility':
        castUtilitySpell(gameState, spell);
        break;
      case 'area':
        castAreaSpell(gameState, spell);
        break;
    }
  }
  
  // Cast projectile spells (fireball, iceball, lightning)
  function castProjectileSpell(gameState: GameState, spell: Spell) {
    console.log('Casting projectile spell:', spell.id);
    
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
    
    // Cast from wizard position at a good height
    const spellPosition = {
      x: gameState.wizard.position.x,
      y: gameState.wizard.position.y + 2.5, // Cast from higher up
      z: gameState.wizard.position.z
    };
    
    const spellDirection = {
      x: cameraDirection.x,
      y: cameraDirection.y,
      z: cameraDirection.z
    };
    
    console.log('Sending spell to server:', {
      position: spellPosition,
      direction: spellDirection,
      spellType: spell.id
    });
    
    socketClient.castSpell(spellPosition, spellDirection, spell.id);
  }
  
  // Cast self spells (heal)
  function castSelfSpell(gameState: GameState, spell: Spell) {
    if (spell.id === 'heal') {
      // Heal spell - restore health
      gameState.playerHealth = Math.min(100, gameState.playerHealth + 30);
      setPlayerStats(prev => ({ ...prev, health: gameState.playerHealth }));
      
      // Create visual healing effect
      createHealingEffect(gameState);
    }
  }
  
  // Cast utility spells (teleport)
  function castUtilitySpell(gameState: GameState, spell: Spell) {
    if (spell.id === 'teleport') {
      // Teleport spell - move forward
      const cameraDirection = new THREE.Vector3();
      gameState.camera.getWorldDirection(cameraDirection);
      cameraDirection.y = 0; // Keep on ground level
      cameraDirection.normalize();
      
      const teleportDistance = 10;
      gameState.wizard.position.add(cameraDirection.multiplyScalar(teleportDistance));
      
      // Create visual teleport effect
      createTeleportEffect(gameState);
    }
  }
  
  // Cast area spells (future implementation)
  function castAreaSpell(_gameState: GameState, spell: Spell) {
    // Placeholder for area spells
    console.log(`Area spell ${spell.name} not implemented yet`);
  }
  
  // Create healing visual effect
  function createHealingEffect(gameState: GameState) {
    const healingGeometry = new THREE.SphereGeometry(0.5, 8, 6);
    const healingMaterial = new THREE.MeshBasicMaterial({ 
      color: 0x32CD32, 
      transparent: true, 
      opacity: 0.7 
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
      color: 0x9370DB, 
      transparent: true, 
      opacity: 0.8,
      side: THREE.DoubleSide
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

  // Create other player function
  function createOtherPlayer(gameState: GameState, player: Player) {
    const otherWizard = createWizard();
    
    // Set player color
    const bodyMesh = otherWizard.children.find(child => 
      child instanceof THREE.Mesh && 
      (child.material as THREE.MeshLambertMaterial).color.getHex() === 0x4169E1
    ) as THREE.Mesh;
    
    if (bodyMesh) {
      (bodyMesh.material as THREE.MeshLambertMaterial).color.setHex(player.color);
    }
    
    // Set position and rotation
    otherWizard.position.set(player.position.x, player.position.y, player.position.z);
    otherWizard.rotation.set(player.rotation.x, player.rotation.y, player.rotation.z);
    
    // Add username label
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d')!;
    canvas.width = 256;
    canvas.height = 64;
    context.fillStyle = 'rgba(0, 0, 0, 0.8)';
    context.fillRect(0, 0, 256, 64);
    context.fillStyle = 'white';
    context.font = '20px Arial';
    context.textAlign = 'center';
    context.fillText(player.username, 128, 40);
    
    const texture = new THREE.CanvasTexture(canvas);
    const labelMaterial = new THREE.SpriteMaterial({ map: texture });
    const label = new THREE.Sprite(labelMaterial);
    label.position.set(0, 6, 0);
    label.scale.set(4, 1, 1);
    otherWizard.add(label);
    
    gameState.otherPlayers.set(player.id, otherWizard);
    gameState.scene.add(otherWizard);
    
    console.log(`Added other player: ${player.username}`);
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

  // Update other player function
  function updateOtherPlayer(gameState: GameState, playerId: string, position: any, rotation: any) {
    const otherWizard = gameState.otherPlayers.get(playerId);
    if (otherWizard) {
      // Smooth interpolation to new position
      otherWizard.position.lerp(new THREE.Vector3(position.x, position.y, position.z), 0.3);
      otherWizard.rotation.set(rotation.x, rotation.y, rotation.z);
    }
  }

  // Create projectile function
  function createProjectile(gameState: GameState, projectile: Projectile) {
    let projectileGeometry, projectileMaterial, glowMaterial;
    
    // Different visuals based on spell type
    switch (projectile.type) {
      case 'fireball':
        projectileGeometry = new THREE.SphereGeometry(0.3, 8, 6);
        projectileMaterial = new THREE.MeshLambertMaterial({ 
          color: 0xFF4500,
          emissive: 0xFF2200,
          emissiveIntensity: 0.7
        });
        glowMaterial = new THREE.MeshLambertMaterial({
          color: 0xFF6600,
          transparent: true,
          opacity: 0.6
        });
        break;
      case 'iceball':
        projectileGeometry = new THREE.SphereGeometry(0.25, 8, 6);
        projectileMaterial = new THREE.MeshLambertMaterial({ 
          color: 0x00BFFF,
          emissive: 0x0088CC,
          emissiveIntensity: 0.2
        });
        glowMaterial = new THREE.MeshLambertMaterial({
          color: 0x87CEEB,
          transparent: true,
          opacity: 0.4
        });
        break;
      case 'lightning':
        projectileGeometry = new THREE.SphereGeometry(0.2, 6, 4);
        projectileMaterial = new THREE.MeshLambertMaterial({ 
          color: 0xFFD700,
          emissive: 0xFFFF00,
          emissiveIntensity: 0.5
        });
        glowMaterial = new THREE.MeshLambertMaterial({
          color: 0xFFFF00,
          transparent: true,
          opacity: 0.5
        });
        break;
      default:
        projectileGeometry = new THREE.SphereGeometry(0.3, 8, 6);
        projectileMaterial = new THREE.MeshLambertMaterial({ 
          color: 0xFF4500,
          emissive: 0xFF2200,
          emissiveIntensity: 0.3
        });
        glowMaterial = new THREE.MeshLambertMaterial({
          color: 0xFF6600,
          transparent: true,
          opacity: 0.3
        });
    }
    
    const projectileMesh = new THREE.Mesh(projectileGeometry, projectileMaterial);
    
    // Set initial position
    projectileMesh.position.set(
      projectile.position.x,
      projectile.position.y,
      projectile.position.z
    );
    
    // Add glow effect
    const glowGeometry = new THREE.SphereGeometry(
      projectileGeometry.parameters.radius * 1.5, 
      8, 
      6
    );
    const glowMesh = new THREE.Mesh(glowGeometry, glowMaterial);
    
    const projectileGroup = new THREE.Group();
    projectileGroup.add(projectileMesh);
    projectileGroup.add(glowMesh);
    
    // Add homing trail effect for fireballs
    if (projectile.type === 'fireball') {
      const trailGeometry = new THREE.ConeGeometry(0.1, 1, 4);
      const trailMaterial = new THREE.MeshLambertMaterial({ 
        color: 0xFF8C00, 
        transparent: true, 
        opacity: 0.6 
      });
      const trail = new THREE.Mesh(trailGeometry, trailMaterial);
      trail.position.z = -0.5; // Behind the fireball
      projectileGroup.add(trail);
    }
    
    // Store projectile data for updates
    projectileGroup.userData = {
      id: projectile.id,
      type: projectile.type,
      targetId: projectile.targetId,
      lastPosition: { ...projectile.position }
    };
    
    gameState.projectiles.set(projectile.id, projectileGroup);
    gameState.scene.add(projectileGroup);
  }

  // Update projectiles function
  function updateProjectiles(gameState: GameState, projectileUpdates: Projectile[]) {
    for (const update of projectileUpdates) {
      const projectileGroup = gameState.projectiles.get(update.id);
      if (projectileGroup) {
        // Smooth interpolation for better visual feedback
        const targetPos = update.position;
        
        // Lerp position for smooth movement
        const lerpFactor = 0.3;
        projectileGroup.position.lerp(
          new THREE.Vector3(targetPos.x, targetPos.y, targetPos.z),
          lerpFactor
        );
        
        // Enhanced rotation and effects based on type
        if (update.type === 'fireball') {
          // Fireball specific effects
          projectileGroup.rotation.x += 0.3;
          projectileGroup.rotation.y += 0.2;
          
          // Enhanced pulsing effect for homing fireballs
          if (update.targetId) {
            const time = Date.now() * 0.008;
            projectileGroup.scale.setScalar(1.2 + Math.sin(time) * 0.4);
            
            // Add more dramatic wobble effect for homing
            const wobble = Math.sin(time * 3) * 0.2;
            projectileGroup.position.x += wobble;
            projectileGroup.position.z += wobble * 0.7;
            
            // Add glowing trail effect
            const fireball = projectileGroup.children[0] as THREE.Mesh;
            if (fireball && fireball.material) {
              const material = fireball.material as THREE.MeshLambertMaterial;
              if (material.emissive) {
                material.emissive.setHex(0xff4400);
              }
            }
          } else {
            // Regular fireball scaling
            const time = Date.now() * 0.005;
            projectileGroup.scale.setScalar(1 + Math.sin(time) * 0.2);
          }
        } else if (update.type === 'iceball') {
          // Ice shard effects
          projectileGroup.rotation.z += 0.4;
          const time = Date.now() * 0.01;
          projectileGroup.scale.setScalar(1 + Math.sin(time) * 0.15);
        } else if (update.type === 'lightning') {
          // Lightning effects
          projectileGroup.rotation.y += 0.35;
          const time = Date.now() * 0.012;
          projectileGroup.scale.setScalar(1 + Math.sin(time) * 0.25);
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

  // Update multiplayer objects function
  function updateMultiplayerObjects(gameState: GameState) {
    // Send player position update to server
    if (socketClient.getIsConnected() && gameState.playerId) {
      const position = {
        x: gameState.wizard.position.x,
        y: gameState.wizard.position.y,
        z: gameState.wizard.position.z
      };
      
      const rotation = {
        x: gameState.wizard.rotation.x,
        y: gameState.wizard.rotation.y,
        z: gameState.wizard.rotation.z
      };
      
      socketClient.updatePlayer(position, rotation);
    }
  }
}

function createWizard(): THREE.Group {
  const wizard = new THREE.Group();

  // Body (cylinder)
  const bodyGeometry = new THREE.CylinderGeometry(0.8, 1.2, 2.5, 8);
  const bodyMaterial = new THREE.MeshLambertMaterial({ color: 0x4169E1 }); // Royal blue
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.position.y = 1.25;
  body.castShadow = true;
  wizard.add(body);

  // Head (sphere)
  const headGeometry = new THREE.SphereGeometry(0.6, 8, 6);
  const headMaterial = new THREE.MeshLambertMaterial({ color: 0xFFDBAC }); // Skin color
  const head = new THREE.Mesh(headGeometry, headMaterial);
  head.position.y = 3.1;
  head.castShadow = true;
  wizard.add(head);

  // Hat (cone)
  const hatGeometry = new THREE.ConeGeometry(0.8, 1.5, 8);
  const hatMaterial = new THREE.MeshLambertMaterial({ color: 0x800080 }); // Purple
  const hat = new THREE.Mesh(hatGeometry, hatMaterial);
  hat.position.y = 4.4;
  hat.castShadow = true;
  wizard.add(hat);

  // Arms
  const armGeometry = new THREE.CylinderGeometry(0.2, 0.2, 1.5, 6);
  const armMaterial = new THREE.MeshLambertMaterial({ color: 0xFFDBAC });
  
  const leftArm = new THREE.Mesh(armGeometry, armMaterial);
  leftArm.position.set(-1.2, 1.8, 0);
  leftArm.rotation.z = Math.PI / 6;
  leftArm.castShadow = true;
  wizard.add(leftArm);

  const rightArm = new THREE.Mesh(armGeometry, armMaterial);
  rightArm.position.set(1.2, 1.8, 0);
  rightArm.rotation.z = -Math.PI / 6;
  rightArm.castShadow = true;
  wizard.add(rightArm);

  // Staff
  const staffGeometry = new THREE.CylinderGeometry(0.05, 0.05, 3, 6);
  const staffMaterial = new THREE.MeshLambertMaterial({ color: 0x8B4513 }); // Brown
  const staff = new THREE.Mesh(staffGeometry, staffMaterial);
  staff.position.set(1.8, 2.5, 0);
  staff.castShadow = true;
  wizard.add(staff);

  // Staff orb
  const orbGeometry = new THREE.SphereGeometry(0.3, 8, 6);
  const orbMaterial = new THREE.MeshLambertMaterial({ 
    color: 0x00FFFF,
    emissive: 0x004444
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
  if (keys['KeyW']) {
    moveVector.add(cameraDirection.clone().multiplyScalar(moveSpeed));
    isMoving = true;
  }
  if (keys['KeyS']) {
    moveVector.add(cameraDirection.clone().multiplyScalar(-moveSpeed));
    isMoving = true;
  }
  if (keys['KeyA']) {
    moveVector.add(cameraRight.clone().multiplyScalar(-moveSpeed));
    isMoving = true;
  }
  if (keys['KeyD']) {
    moveVector.add(cameraRight.clone().multiplyScalar(moveSpeed));
    isMoving = true;
  }

  // Apply movement
  if (isMoving) {
    wizard.position.add(moveVector);
  }
  
  // Always make wizard face the camera direction (projected onto ground plane)
  const cameraForward = new THREE.Vector3();
  camera.getWorldDirection(cameraForward);
  cameraForward.y = 0; // Project onto ground plane
  cameraForward.normalize();
  
  // Set wizard rotation to face camera direction
  wizard.rotation.y = Math.atan2(cameraForward.x, cameraForward.z);

  // Update camera to follow wizard (third person)
  const targetPosition = wizard.position.clone().add(cameraOffset);
  camera.position.lerp(targetPosition, 0.1);
  
  // Always look at wizard (this handles both movement and mouse rotation)
  camera.lookAt(wizard.position);

  // Add some floating animation to the staff orb
  const time = Date.now() * 0.001;
  const orb = wizard.children.find(child => 
    child instanceof THREE.Mesh && 
    (child.material as THREE.MeshLambertMaterial).color.getHex() === 0x00FFFF
  );
  if (orb) {
    orb.position.y = 4 + Math.sin(time * 2) * 0.1;
  }
}
