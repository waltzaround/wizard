import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import { v4 as uuidv4 } from "uuid";

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Allow all origins for local dev
    methods: ["GET", "POST"],
  },
});

app.use(
  cors({
    origin: "*", // Allow all origins for local dev
    methods: ["GET", "POST"],
    credentials: true,
  })
);
app.use(express.json());

// Game state
const gameState = {
  players: new Map(),
  projectiles: new Map(),
  gameSettings: {
    worldSize: 500, // Much larger world bounds
    maxPlayers: 20,
    projectileSpeed: 2, // Very slow projectiles (2 units per second)
    projectileLifetime: 30000, // 30 seconds lifetime
  },
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
      0x4169e1, // Royal Blue
      0xff6347, // Tomato
      0x32cd32, // Lime Green
      0xff69b4, // Hot Pink
      0xffd700, // Gold
      0x8a2be2, // Blue Violet
      0xff4500, // Orange Red
      0x00ced1, // Dark Turquoise
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
    if (this.health <= 0 && this.isAlive) {
      this.die();
    }
  }

  die() {
    this.isAlive = false;
    console.log(`💀 Player ${this.username} died!`);

    // Notify the player they died
    this.socket.emit("player-died-self", {
      message: "You died! Respawning in 5 seconds...",
    });

    // Notify all other players that this player died (to hide their character)
    this.socket.broadcast.emit("player-died-other", {
      playerId: this.id,
      username: this.username,
    });

    // Schedule respawn after 5 seconds
    setTimeout(() => {
      this.respawn();
    }, 5000);
  }

  respawn() {
    // Reset health and status
    this.health = 100;
    this.mana = 100;
    this.isAlive = true;

    // Respawn within the green square (grid area)
    // The grid appears to be around 50x50 units based on the game setup
    const gridSize = 50; // Green square grid size
    this.position = {
      x: (Math.random() - 0.5) * gridSize, // Random position within grid
      y: 0, // Spawn above ground
      z: (Math.random() - 0.5) * gridSize, // Random position within grid
    };

    console.log(
      `✨ Player ${this.username} respawned at [${this.position.x.toFixed(
        1
      )}, ${this.position.y.toFixed(1)}, ${this.position.z.toFixed(1)}]`
    );

    // Notify the player they respawned
    this.socket.emit("player-respawned", {
      message: "You have respawned!",
      position: this.position,
      health: this.health,
      mana: this.mana,
    });

    // Notify all other players of the respawn
    this.socket.broadcast.emit("player-respawned-other", {
      playerId: this.id,
      username: this.username,
      position: this.position,
      health: this.health,
    });
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
      color: this.color,
    };
  }
}

// Projectile class
class Projectile {
  constructor(id, playerId, position, direction, type = "fireball") {
    this.id = id;
    this.playerId = playerId;
    this.position = { ...position };
    this.direction = { ...direction };
    this.type = type;
    this.speed = gameState.gameSettings.projectileSpeed;
    this.damage = 25;
    this.createdAt = Date.now();
    this.isActive = true;
    this.exploded = false;
    this.explosionBroadcasted = false; // NEW: Track if explosion was sent to client

    // Homing properties for fireball
    if (type === "fireball") {
      this.homingStrength = 0.3; // Weak tracking (0.0 = no homing, 1.0 = strong homing)
      this.homingRange = Infinity; // No range limit - track any target
      this.targetId = null;
    }

    // Artillery properties for iceball (mortar-style)
    if (type === "iceball") {
      this.isArtillery = true;
      this.gravity = -20; // Stronger gravity for mortar-style arc
      // For mortar artillery, we need special physics
      this.velocity = { ...direction };
      // Scale velocity appropriately for mortar trajectory
      const ballisticSpeed = this.speed * 15; // Higher speed for mortar launch
      this.velocity.x *= ballisticSpeed;
      this.velocity.y *= ballisticSpeed; // Strong upward velocity
      this.velocity.z *= ballisticSpeed;

      // Store launch position and find target for course correction
      this.launchPosition = { ...position };
      this.hasAppliedTargeting = false;
      this.launchTime = Date.now();

      // Find the target player for course correction
      this.targetPlayer = null;
      let closestDistance = Infinity;
      for (const player of gameState.players.values()) {
        if (player.id !== this.playerId && player.isAlive) {
          const distance = Math.sqrt(
            Math.pow(position.x - player.position.x, 2) +
              Math.pow(position.z - player.position.z, 2)
          );
          if (distance < closestDistance) {
            closestDistance = distance;
            this.targetPlayer = player;
          }
        }
      }

      console.log(
        `🎯 Mortar shell created with direction [${direction.x.toFixed(
          2
        )}, ${direction.y.toFixed(2)}, ${direction.z.toFixed(2)}]`
      );
      console.log(
        `🚀 Mortar shell velocity [${this.velocity.x.toFixed(
          2
        )}, ${this.velocity.y.toFixed(2)}, ${this.velocity.z.toFixed(2)}]`
      );
      console.log(
        `🎯 Target player: ${
          this.targetPlayer ? this.targetPlayer.username : "none"
        }`
      );
    }

    if (type === "laser") {
      this.sweepAngle = -90; // Start at -90 degrees (to the left of facing direction)
      this.sweepSpeed = 120; // degrees per second (180 deg in 1.5s)
      this.sweepDuration = 1.5; // seconds
      this.sweepElapsed = 0;
      this.beamLength = 20; // How far the laser reaches
      this.beamWidth = 6; // How wide the laser is
      this.hitPlayers = new Set(); // Track already hit players
    }
  }

  update(deltaTime) {
    if (!this.isActive) return;

    console.log(`🔄 Updating projectile ${this.id} (type: ${this.type})`);

    // Apply homing behavior for fireballs
    if (this.type === "fireball") {
      console.log(`🔥 Applying homing to fireball ${this.id}`);
      this.updateHoming();
    }

    // Laser beam sweeping logic
    if (this.type === "laser") {
      this.sweepElapsed += deltaTime;
      // Calculate current sweep progress (0 to 1)
      const sweepProgress = Math.min(this.sweepElapsed / this.sweepDuration, 1);
      this.sweepAngle = -90 + 180 * sweepProgress; // For server-side collision only
      // Check for players in the current laser arc
      for (const player of gameState.players.values()) {
        if (
          player.id === this.playerId ||
          !player.isAlive ||
          this.hitPlayers.has(player.id)
        )
          continue;
        // Vector from laser origin to player
        const dx = player.position.x - this.position.x;
        const dz = player.position.z - this.position.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist > this.beamLength) continue;
        // Angle between laser forward and player
        const laserDir = Math.atan2(this.direction.z, this.direction.x);
        const playerDir = Math.atan2(dz, dx);
        let relAngle = (playerDir - laserDir) * (180 / Math.PI);
        // Normalize to [-180, 180]
        relAngle = ((relAngle + 180) % 360) - 180;
        if (
          relAngle >= this.sweepAngle - this.beamWidth / 2 &&
          relAngle <= this.sweepAngle + this.beamWidth / 2
        ) {
          // Player is in the beam
          player.takeDamage(40); // Laser does high damage
          this.hitPlayers.add(player.id);
          io.emit("player-hit", {
            playerId: player.id,
            projectileId: this.id,
            damage: 40,
            health: player.health,
            isAlive: player.isAlive,
          });
          if (!player.isAlive) {
            io.emit("player-died", {
              playerId: player.id,
              killedBy: this.playerId,
            });
          }
        }
      }
      // End the laser after the sweep
      if (this.sweepElapsed >= this.sweepDuration) {
        this.isActive = false;
      }
      return;
    }

    // Move projectile
    const oldPos = { ...this.position };

    if (this.type === "iceball" && this.isArtillery) {
      // Mortar-style artillery physics with gravity
      const oldPos = { ...this.position };
      const oldVel = { ...this.velocity };

      // Apply mortar course correction after initial launch
      const flightTime = (Date.now() - this.launchTime) / 1000; // Flight time in seconds
      if (
        flightTime > 0.5 &&
        !this.hasAppliedTargeting &&
        this.velocity.y < 0 &&
        this.targetPlayer
      ) {
        // Shell has reached peak and is falling - apply targeting correction
        const targetDirection = {
          x: this.targetPlayer.position.x - this.position.x,
          z: this.targetPlayer.position.z - this.position.z,
        };

        // Normalize target direction
        const distance = Math.sqrt(
          targetDirection.x * targetDirection.x +
            targetDirection.z * targetDirection.z
        );
        if (distance > 0) {
          targetDirection.x /= distance;
          targetDirection.z /= distance;

          // Apply strong horizontal velocity toward target
          const targetingStrength = 25; // Strong correction toward target
          this.velocity.x += targetDirection.x * targetingStrength;
          this.velocity.z += targetDirection.z * targetingStrength;
          this.hasAppliedTargeting = true;

          console.log(
            `🎯 Mortar shell ${this.id} applying targeting correction toward ${this.targetPlayer.username}`
          );
          console.log(
            `   Target direction: [${targetDirection.x.toFixed(
              2
            )}, ${targetDirection.z.toFixed(2)}]`
          );
          console.log(
            `   New velocity: [${this.velocity.x.toFixed(
              2
            )}, ${this.velocity.y.toFixed(2)}, ${this.velocity.z.toFixed(2)}]`
          );
        }
      }

      this.position.x += this.velocity.x * deltaTime;
      this.position.y += this.velocity.y * deltaTime;
      this.position.z += this.velocity.z * deltaTime;

      // Apply gravity to velocity
      this.velocity.y += this.gravity * deltaTime;

      console.log(`💥 Mortar shell ${this.id}:`);
      console.log(
        `   Old pos: [${oldPos.x.toFixed(1)}, ${oldPos.y.toFixed(
          1
        )}, ${oldPos.z.toFixed(1)}]`
      );
      console.log(
        `   New pos: [${this.position.x.toFixed(1)}, ${this.position.y.toFixed(
          1
        )}, ${this.position.z.toFixed(1)}]`
      );
      console.log(
        `   Velocity: [${this.velocity.x.toFixed(2)}, ${this.velocity.y.toFixed(
          2
        )}, ${this.velocity.z.toFixed(2)}]`
      );
      console.log(
        `   Flight time: ${flightTime.toFixed(2)}s, Targeting applied: ${
          this.hasAppliedTargeting
        }`
      );
    } else {
      // Normal projectile movement
      this.position.x += this.direction.x * this.speed * deltaTime;
      this.position.y += this.direction.y * this.speed * deltaTime;
      this.position.z += this.direction.z * this.speed * deltaTime;
    }

    // log direction, speed and deltatime
    console.log(
      `Direction: [${this.direction.x.toFixed(2)}, ${this.direction.y.toFixed(
        2
      )}, ${this.direction.z.toFixed(2)}]`
    );
    console.log(`Speed: ${this.speed.toFixed(2)}`);
    console.log(`Delta time: ${deltaTime.toFixed(2)}`);

    // Handle ground collision
    const groundLevel = 0.5; // Minimum height above ground
    if (this.position.y <= groundLevel) {
      if (this.type === "iceball" && this.isArtillery) {
        // Artillery shells explode on ground impact with area damage
        console.log(
          `💥 Artillery shell ${
            this.id
          } exploded on ground impact at [${this.position.x.toFixed(
            1
          )}, ${groundLevel.toFixed(1)}, ${this.position.z.toFixed(1)}]`
        );
        this.position.y = groundLevel; // Set exact ground position
        this.isActive = false; // Deactivate projectile
        this.exploded = true; // Mark as exploded for client-side effects
        this.explosionBroadcasted = false; // Reset flag so it will be sent to client

        // Apply area-of-effect damage to nearby players
        const explosionRadius = 5; // 5 unit blast radius
        const explosionDamage = 35; // Higher damage for artillery

        for (const player of gameState.players.values()) {
          if (player.id === this.playerId || !player.isAlive) continue; // Skip caster and dead players

          const distance = Math.sqrt(
            Math.pow(this.position.x - player.position.x, 2) +
              Math.pow(this.position.z - player.position.z, 2) // Only check horizontal distance
          );

          if (distance <= explosionRadius) {
            // Calculate damage falloff based on distance
            const damageMultiplier = Math.max(
              0.3,
              1 - distance / explosionRadius
            ); // 30% minimum damage
            const actualDamage = Math.round(explosionDamage * damageMultiplier);

            console.log(
              `💥 Artillery explosion hit ${
                player.username
              } at distance ${distance.toFixed(1)} for ${actualDamage} damage`
            );

            player.takeDamage(actualDamage);

            // Notify all players of the hit
            io.emit("player-hit", {
              playerId: player.id,
              projectileId: this.id,
              damage: actualDamage,
              health: player.health,
              isAlive: player.isAlive,
            });

            if (!player.isAlive) {
              io.emit("player-died", {
                playerId: player.id,
                killedBy: this.playerId,
              });
            }
          }
        }

        return; // Stop further processing
      } else {
        // Other projectiles bounce/slide along ground
        this.position.y = groundLevel;
        // Adjust direction to be more horizontal when hitting ground
        if (this.direction.y < 0) {
          this.direction.y = Math.max(this.direction.y, -0.1);
          // Re-normalize direction
          const length = Math.sqrt(
            this.direction.x * this.direction.x +
              this.direction.y * this.direction.y +
              this.direction.z * this.direction.z
          );
          if (length > 0) {
            this.direction.x /= length;
            this.direction.y /= length;
            this.direction.z /= length;
          }
        }
      }
    }

    // Check if projectile should expire
    const age = Date.now() - this.createdAt;
    if (age > gameState.gameSettings.projectileLifetime) {
      console.log(
        `⏰ Projectile ${this.id} expired due to lifetime (${age}ms > ${gameState.gameSettings.projectileLifetime}ms)`
      );
      this.isActive = false;
    }

    // Check world bounds
    const worldSize = gameState.gameSettings.worldSize;
    if (
      Math.abs(this.position.x) > worldSize ||
      Math.abs(this.position.z) > worldSize ||
      this.position.y < -10 ||
      this.position.y > 50
    ) {
      console.log(
        `🌍 Projectile ${
          this.id
        } expired due to world bounds at [${this.position.x.toFixed(
          1
        )}, ${this.position.y.toFixed(1)}, ${this.position.z.toFixed(1)}]`
      );
      this.isActive = false;
    }
  }

  updateHoming() {
    // Find the closest enemy player (no range limit)
    let closestTarget = null;
    let closestDistance = Infinity;

    console.log(
      `Fireball ${this.id} (fired by ${this.playerId}) checking for targets. Players in game: ${gameState.players.size}`
    );

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

      console.log(
        `Valid target ${player.username} (ID: ${
          player.id
        }) at distance ${distance.toFixed(2)}`
      );

      if (distance < closestDistance) {
        closestTarget = player;
        closestDistance = distance;
      }
    }

    // If we have a target, adjust direction towards it
    if (closestTarget) {
      this.targetId = closestTarget.id;
      console.log(
        `🎯 Fireball ${this.id} TARGETING ${closestTarget.username} (ID: ${
          closestTarget.id
        }) at distance ${closestDistance.toFixed(2)}`
      );

      // Calculate direction to target
      const toTarget = {
        x: closestTarget.position.x - this.position.x,
        y: closestTarget.position.y - this.position.y,
        z: closestTarget.position.z - this.position.z,
      };

      // Normalize target direction
      const targetLength = Math.sqrt(
        toTarget.x * toTarget.x +
          toTarget.y * toTarget.y +
          toTarget.z * toTarget.z
      );
      if (targetLength > 0) {
        toTarget.x /= targetLength;
        toTarget.y /= targetLength;
        toTarget.z /= targetLength;

        // Blend current direction with target direction (weak homing)
        const oldDirection = { ...this.direction };
        this.direction.x =
          this.direction.x * (1 - this.homingStrength) +
          toTarget.x * this.homingStrength;
        this.direction.y =
          this.direction.y * (1 - this.homingStrength) +
          toTarget.y * this.homingStrength;
        this.direction.z =
          this.direction.z * (1 - this.homingStrength) +
          toTarget.z * this.homingStrength;

        // Re-normalize direction to maintain speed
        const dirLength = Math.sqrt(
          this.direction.x * this.direction.x +
            this.direction.y * this.direction.y +
            this.direction.z * this.direction.z
        );
        if (dirLength > 0) {
          this.direction.x /= dirLength;
          this.direction.y /= dirLength;
          this.direction.z /= dirLength;
        }

        console.log(
          `🔄 Direction adjusted from [${oldDirection.x.toFixed(
            2
          )}, ${oldDirection.y.toFixed(2)}, ${oldDirection.z.toFixed(
            2
          )}] to [${this.direction.x.toFixed(2)}, ${this.direction.y.toFixed(
            2
          )}, ${this.direction.z.toFixed(2)}]`
        );
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
    const base = {
      id: this.id,
      playerId: this.playerId,
      position: this.position,
      direction: this.direction,
      type: this.type,
      isActive: this.isActive,
      targetId: this.targetId, // Include target info for client-side effects
      exploded: this.exploded || false, // Include explosion info for client-side effects
      explosionBroadcasted: this.explosionBroadcasted || false, // Include explosion broadcast info for client-side effects
    };
    // For laser, include sweepProgress (0 to 1)
    if (this.type === "laser") {
      const sweepProgress = Math.min(this.sweepElapsed / this.sweepDuration, 1);
      return { ...base, sweepProgress };
    }
    return base;
  }
}

// Socket.IO connection handling
io.on("connection", (socket) => {
  console.log(`Player connected: ${socket.id}`);

  // Player joins game
  socket.on("join-game", (data) => {
    const { username } = data;
    const player = new Player(socket.id, username, socket);

    // Spawn player at random position
    player.position = {
      x: (Math.random() - 0.5) * 20,
      y: 0,
      z: (Math.random() - 0.5) * 20,
    };

    gameState.players.set(socket.id, player);

    // Send initial game state to new player
    socket.emit("game-joined", {
      playerId: socket.id,
      player: player.toJSON(),
      gameSettings: gameState.gameSettings,
    });

    // Send existing players to new player
    const existingPlayers = Array.from(gameState.players.values())
      .filter((p) => p.id !== socket.id)
      .map((p) => p.toJSON());

    socket.emit("existing-players", existingPlayers);

    // Notify other players of new player
    socket.broadcast.emit("player-joined", player.toJSON());

    console.log(`${username} (${socket.id}) joined the game`);
  });

  // Player movement update
  socket.on("player-update", (data) => {
    const player = gameState.players.get(socket.id);
    if (player) {
      player.updatePosition(data.position, data.rotation);

      // Broadcast to other players
      socket.broadcast.emit("player-moved", {
        playerId: socket.id,
        position: data.position,
        rotation: data.rotation,
      });
    }
  });

  // Player casts spell/shoots projectile
  socket.on("cast-spell", (data) => {
    const player = gameState.players.get(socket.id);
    if (!player || !player.isAlive) return;

    const spellType = data.spellType || "fireball";

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
    io.emit("projectile-created", projectile.toJSON());
  });

  // Player disconnection
  socket.on("disconnect", () => {
    const player = gameState.players.get(socket.id);
    if (player) {
      gameState.players.delete(socket.id);
      socket.broadcast.emit("player-left", socket.id);
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

    // --- ARTILLERY EXPLOSION BROADCAST FIX ---
    if (projectile.exploded && !projectile.explosionBroadcasted) {
      // Keep projectile for one more tick to broadcast explosion
      projectile.explosionBroadcasted = true;
      activeProjectiles.push(projectile.toJSON());
      continue;
    }
    // --- END FIX ---

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
        io.emit("player-hit", {
          playerId: player.id,
          projectileId: id,
          damage: projectile.damage,
          health: player.health,
          isAlive: player.isAlive,
        });

        if (!player.isAlive) {
          io.emit("player-died", {
            playerId: player.id,
            killedBy: projectile.playerId,
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
    // Only remove if not waiting to broadcast explosion
    const projectile = gameState.projectiles.get(id);
    if (projectile && projectile.exploded && !projectile.explosionBroadcasted) {
      // Don't remove yet
      continue;
    }
    gameState.projectiles.delete(id);
  }

  // Always broadcast projectile updates (even if empty) to ensure sync
  io.emit("projectiles-update", {
    active: activeProjectiles,
    expired: expiredProjectiles,
  });

  // Regenerate mana for all players
  for (const player of gameState.players.values()) {
    if (player.mana < 100) {
      player.mana = Math.min(100, player.mana + 0.5); // Regenerate mana
    }
  }
}, TICK_INTERVAL);

// Health endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    players: gameState.players.size,
    projectiles: gameState.projectiles.size,
    uptime: process.uptime(),
  });
});

// Game stats endpoint
app.get("/stats", (req, res) => {
  res.json({
    players: Array.from(gameState.players.values()).map((p) => ({
      id: p.id,
      username: p.username,
      health: p.health,
      mana: p.mana,
      isAlive: p.isAlive,
    })),
    projectileCount: gameState.projectiles.size,
    gameSettings: gameState.gameSettings,
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`🧙‍♂️ Wizard multiplayer server running on port ${PORT}`);
  console.log(`Health check: http://<your-local-ip>:${PORT}/health`);
  console.log(`Game stats: http://<your-local-ip>:${PORT}/stats`);
});
