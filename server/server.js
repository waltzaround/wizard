import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://localhost:5173", // Vite dev server
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

// Game state
const gameState = {
  players: new Map(),
  projectiles: new Map(),
  gameSettings: {
    worldSize: 500, // Much larger world bounds
    maxPlayers: 20,
    projectileSpeed: 2, // Very slow projectiles (2 units per second)
    projectileLifetime: 30000 // 30 seconds lifetime
  }
};

// Player class
class Player {
  constructor(id, username, socket) {
    this.id = id;
    this.username = username;
    this.socket = socket;
    this.position = { x: 0, y: 0, z: 0 };
    this.rotation = { x: 0, y: 0, z: 0 };
    this.health = 100;
    this.mana = 100;
    this.isAlive = true;
    this.lastUpdate = Date.now();
    this.color = this.generateRandomColor();
  }

  generateRandomColor() {
    const colors = [
      0x4169E1, // Royal Blue
      0xFF6347, // Tomato
      0x32CD32, // Lime Green
      0xFF69B4, // Hot Pink
      0xFFD700, // Gold
      0x8A2BE2, // Blue Violet
      0xFF4500, // Orange Red
      0x00CED1  // Dark Turquoise
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  updatePosition(position, rotation) {
    this.position = position;
    this.rotation = rotation;
    this.lastUpdate = Date.now();
  }

  takeDamage(damage) {
    this.health = Math.max(0, this.health - damage);
    if (this.health <= 0) {
      this.isAlive = false;
    }
  }

  toJSON() {
    return {
      id: this.id,
      username: this.username,
      position: this.position,
      rotation: this.rotation,
      health: this.health,
      mana: this.mana,
      isAlive: this.isAlive,
      color: this.color
    };
  }
}

// Projectile class
class Projectile {
  constructor(id, playerId, position, direction, type = 'fireball') {
    this.id = id;
    this.playerId = playerId;
    this.position = { ...position };
    this.direction = { ...direction };
    this.type = type;
    this.speed = gameState.gameSettings.projectileSpeed;
    this.damage = 25;
    this.createdAt = Date.now();
    this.isActive = true;
    
    // Homing properties for fireball
    if (type === 'fireball') {
      this.homingStrength = 0.3; // Weak tracking (0.0 = no homing, 1.0 = strong homing)
      this.homingRange = Infinity; // No range limit - track any target
      this.targetId = null;
    }
  }

  update(deltaTime) {
    if (!this.isActive) return;

    console.log(`🔄 Updating projectile ${this.id} (type: ${this.type})`);

    // Apply homing behavior for fireballs
    if (this.type === 'fireball') {
      console.log(`🔥 Applying homing to fireball ${this.id}`);
      this.updateHoming();
    }

    // Move projectile
    const oldPos = { ...this.position };
    this.position.x += this.direction.x * this.speed * deltaTime;
    this.position.y += this.direction.y * this.speed * deltaTime;
    this.position.z += this.direction.z * this.speed * deltaTime;

    // log direction, speed and deltatime
    console.log(`Direction: [${this.direction.x.toFixed(2)}, ${this.direction.y.toFixed(2)}, ${this.direction.z.toFixed(2)}]`);
    console.log(`Speed: ${this.speed.toFixed(2)}`);
    console.log(`Delta time: ${deltaTime.toFixed(2)}`);
    
    // Prevent projectiles from going underground
    const groundLevel = 0.5; // Minimum height above ground
    if (this.position.y < groundLevel) {
      this.position.y = groundLevel;
      // Adjust direction to be more horizontal when hitting ground
      if (this.direction.y < 0) {
        this.direction.y = Math.max(this.direction.y, -0.1);
        // Re-normalize direction
        const length = Math.sqrt(this.direction.x * this.direction.x + this.direction.y * this.direction.y + this.direction.z * this.direction.z);
        if (length > 0) {
          this.direction.x /= length;
          this.direction.y /= length;
          this.direction.z /= length;
        }
      }
    }

    // Check if projectile should expire
    const age = Date.now() - this.createdAt;
    if (age > gameState.gameSettings.projectileLifetime) {
      console.log(`⏰ Projectile ${this.id} expired due to lifetime (${age}ms > ${gameState.gameSettings.projectileLifetime}ms)`);
      this.isActive = false;
    }

    // Check world bounds
    const worldSize = gameState.gameSettings.worldSize;
    if (Math.abs(this.position.x) > worldSize || 
        Math.abs(this.position.z) > worldSize ||
        this.position.y < -10 || this.position.y > 50) {
      console.log(`🌍 Projectile ${this.id} expired due to world bounds at [${this.position.x.toFixed(1)}, ${this.position.y.toFixed(1)}, ${this.position.z.toFixed(1)}]`);
      this.isActive = false;
    }
  }
  
  updateHoming() {
    // Find the closest enemy player (no range limit)
    let closestTarget = null;
    let closestDistance = Infinity;
    
    console.log(`Fireball ${this.id} (fired by ${this.playerId}) checking for targets. Players in game: ${gameState.players.size}`);
    
    for (const player of gameState.players.values()) {
      // IMPORTANT: Skip the player who fired this projectile and dead players
      if (player.id === this.playerId) {
        console.log(`Skipping caster ${player.username} (ID: ${player.id})`);
        continue;
      }
      
      if (!player.isAlive) {
        console.log(`Skipping dead player ${player.username}`);
        continue;
      }
      
      const distance = Math.sqrt(
        Math.pow(this.position.x - player.position.x, 2) +
        Math.pow(this.position.y - player.position.y, 2) +
        Math.pow(this.position.z - player.position.z, 2)
      );
      
      console.log(`Valid target ${player.username} (ID: ${player.id}) at distance ${distance.toFixed(2)}`);
      
      if (distance < closestDistance) {
        closestTarget = player;
        closestDistance = distance;
      }
    }
    
    // If we have a target, adjust direction towards it
    if (closestTarget) {
      this.targetId = closestTarget.id;
      console.log(`🎯 Fireball ${this.id} TARGETING ${closestTarget.username} (ID: ${closestTarget.id}) at distance ${closestDistance.toFixed(2)}`);
      
      // Calculate direction to target
      const toTarget = {
        x: closestTarget.position.x - this.position.x,
        y: closestTarget.position.y - this.position.y,
        z: closestTarget.position.z - this.position.z
      };
      
      // Normalize target direction
      const targetLength = Math.sqrt(toTarget.x * toTarget.x + toTarget.y * toTarget.y + toTarget.z * toTarget.z);
      if (targetLength > 0) {
        toTarget.x /= targetLength;
        toTarget.y /= targetLength;
        toTarget.z /= targetLength;
        
        // Blend current direction with target direction (weak homing)
        const oldDirection = { ...this.direction };
        this.direction.x = this.direction.x * (1 - this.homingStrength) + toTarget.x * this.homingStrength;
        this.direction.y = this.direction.y * (1 - this.homingStrength) + toTarget.y * this.homingStrength;
        this.direction.z = this.direction.z * (1 - this.homingStrength) + toTarget.z * this.homingStrength;
        
        // Re-normalize direction to maintain speed
        const dirLength = Math.sqrt(this.direction.x * this.direction.x + this.direction.y * this.direction.y + this.direction.z * this.direction.z);
        if (dirLength > 0) {
          this.direction.x /= dirLength;
          this.direction.y /= dirLength;
          this.direction.z /= dirLength;
        }
        
        console.log(`🔄 Direction adjusted from [${oldDirection.x.toFixed(2)}, ${oldDirection.y.toFixed(2)}, ${oldDirection.z.toFixed(2)}] to [${this.direction.x.toFixed(2)}, ${this.direction.y.toFixed(2)}, ${this.direction.z.toFixed(2)}]`);
      }
    } else {
      this.targetId = null;
      console.log(`❌ Fireball ${this.id} found no valid enemy targets`);
    }
  }

  checkCollision(player) {
    if (!this.isActive || this.playerId === player.id || !player.isAlive) {
      return false;
    }

    const distance = Math.sqrt(
      Math.pow(this.position.x - player.position.x, 2) +
      Math.pow(this.position.y - player.position.y, 2) +
      Math.pow(this.position.z - player.position.z, 2)
    );

    return distance < 2; // Hit radius
  }

  toJSON() {
    return {
      id: this.id,
      playerId: this.playerId,
      position: this.position,
      direction: this.direction,
      type: this.type,
      isActive: this.isActive,
      targetId: this.targetId // Include target info for client-side effects
    };
  }
}

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  // Player joins game
  socket.on('join-game', (data) => {
    const { username } = data;
    const player = new Player(socket.id, username, socket);
    
    // Spawn player at random position
    player.position = {
      x: (Math.random() - 0.5) * 20,
      y: 0,
      z: (Math.random() - 0.5) * 20
    };

    gameState.players.set(socket.id, player);

    // Send initial game state to new player
    socket.emit('game-joined', {
      playerId: socket.id,
      player: player.toJSON(),
      gameSettings: gameState.gameSettings
    });

    // Send existing players to new player
    const existingPlayers = Array.from(gameState.players.values())
      .filter(p => p.id !== socket.id)
      .map(p => p.toJSON());
    
    socket.emit('existing-players', existingPlayers);

    // Notify other players of new player
    socket.broadcast.emit('player-joined', player.toJSON());

    console.log(`${username} (${socket.id}) joined the game`);
  });

  // Player movement update
  socket.on('player-update', (data) => {
    const player = gameState.players.get(socket.id);
    if (player) {
      player.updatePosition(data.position, data.rotation);
      
      // Broadcast to other players
      socket.broadcast.emit('player-moved', {
        playerId: socket.id,
        position: data.position,
        rotation: data.rotation
      });
    }
  });

  // Player casts spell/shoots projectile
  socket.on('cast-spell', (data) => {
    const player = gameState.players.get(socket.id);
    if (!player || !player.isAlive) return;
    
    const spellType = data.spellType || 'fireball';
    
    console.log(`Player ${player.username} casting ${spellType}`);
    
    const projectileId = uuidv4();
    const projectile = new Projectile(
      projectileId,
      socket.id,
      data.position,
      data.direction,
      spellType
    );

    gameState.projectiles.set(projectileId, projectile);

    console.log(`Created projectile ${projectileId} of type ${spellType}`);
    
    // Broadcast projectile to all players
    io.emit('projectile-created', projectile.toJSON());
  });

  // Player disconnection
  socket.on('disconnect', () => {
    const player = gameState.players.get(socket.id);
    if (player) {
      gameState.players.delete(socket.id);
      socket.broadcast.emit('player-left', socket.id);
      console.log(`${player.username} (${socket.id}) left the game`);
    }
  });
});

// Game loop
const TICK_RATE = 60; // 60 FPS
const TICK_INTERVAL = 1000 / TICK_RATE;
let lastTick = Date.now();

setInterval(() => {
  const now = Date.now();
  const deltaTime = (now - lastTick) / 1000; // Convert to seconds
  lastTick = now;

  // Update projectiles
  const activeProjectiles = [];
  const expiredProjectiles = [];

  for (const [id, projectile] of gameState.projectiles) {
    projectile.update(deltaTime);

    if (!projectile.isActive) {
      expiredProjectiles.push(id);
      continue;
    }

    // Check collisions with players
    for (const player of gameState.players.values()) {
      if (projectile.checkCollision(player)) {
        player.takeDamage(projectile.damage);
        projectile.isActive = false;
        expiredProjectiles.push(id);

        // Notify all players of hit
        io.emit('player-hit', {
          playerId: player.id,
          projectileId: id,
          damage: projectile.damage,
          health: player.health,
          isAlive: player.isAlive
        });

        if (!player.isAlive) {
          io.emit('player-died', {
            playerId: player.id,
            killedBy: projectile.playerId
          });
        }
        break;
      }
    }

    if (projectile.isActive) {
      activeProjectiles.push(projectile.toJSON());
    }
  }

  // Remove expired projectiles
  for (const id of expiredProjectiles) {
    gameState.projectiles.delete(id);
  }

  // Always broadcast projectile updates (even if empty) to ensure sync
  io.emit('projectiles-update', {
    active: activeProjectiles,
    expired: expiredProjectiles
  });

  // Regenerate mana for all players
  for (const player of gameState.players.values()) {
    if (player.mana < 100) {
      player.mana = Math.min(100, player.mana + 0.5); // Regenerate mana
    }
  }

}, TICK_INTERVAL);

// Health endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    players: gameState.players.size,
    projectiles: gameState.projectiles.size,
    uptime: process.uptime()
  });
});

// Game stats endpoint
app.get('/stats', (req, res) => {
  res.json({
    players: Array.from(gameState.players.values()).map(p => ({
      id: p.id,
      username: p.username,
      health: p.health,
      mana: p.mana,
      isAlive: p.isAlive
    })),
    projectileCount: gameState.projectiles.size,
    gameSettings: gameState.gameSettings
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🧙‍♂️ Wizard multiplayer server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Game stats: http://localhost:${PORT}/stats`);
});
