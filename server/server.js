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
    worldSize: 1500, // Massive world bounds for extreme long-range artillery
    maxPlayers: 20,
    projectileSpeed: 2, // Faster projectiles (12 units per second)
    projectileLifetime: 60000, // 60 seconds lifetime for long-range strikes
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
    this.stamina = 100;
    this.maxStamina = 100;
    this.isAlive = true;
    this.lastUpdate = Date.now();
    this.color = this.generateRandomColor();
    
    // Movement abilities
    this.isJumping = false;
    this.jumpStartTime = 0;
    this.jumpDuration = 800; // 800ms jump duration
    this.isDashing = false;
    this.dashStartTime = 0;
    this.dashDuration = 200; // 200ms dash duration
    this.dashDirection = { x: 0, z: 0 };
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

  // Jump ability
  jump() {
    const jumpCost = 25; // 25 stamina per jump
    
    if (this.stamina >= jumpCost && !this.isJumping && this.isAlive) {
      this.stamina -= jumpCost;
      this.isJumping = true;
      this.jumpStartTime = Date.now();
      
      console.log(`🦘 Player ${this.username} jumped! Stamina: ${this.stamina}`);
      return true;
    }
    return false;
  }

  // Dash ability
  dash(direction) {
    const dashCost = 35; // 35 stamina per dash
    
    if (this.stamina >= dashCost && !this.isDashing && this.isAlive) {
      this.stamina -= dashCost;
      this.isDashing = true;
      this.dashStartTime = Date.now();
      this.dashDirection = { ...direction };
      
      console.log(`💨 Player ${this.username} dashed! Stamina: ${this.stamina}`);
      return true;
    }
    return false;
  }

  // Update movement abilities (called each game tick)
  updateMovementAbilities() {
    const now = Date.now();
    
    // Update jump state
    if (this.isJumping && (now - this.jumpStartTime) >= this.jumpDuration) {
      this.isJumping = false;
    }
    
    // Update dash state
    if (this.isDashing && (now - this.dashStartTime) >= this.dashDuration) {
      this.isDashing = false;
    }
  }

  respawn() {
    // Reset health and status
    this.health = 100;
    this.mana = 100;
    this.stamina = 100;
    this.isAlive = true;
    
    // Reset movement abilities
    this.isJumping = false;
    this.isDashing = false;

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
      stamina: this.stamina,
      isAlive: this.isAlive,
      color: this.color,
      isJumping: this.isJumping,
      isDashing: this.isDashing,
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
      this.speed = this.speed * 2; // Fireballs are 2x faster than other projectiles
    }

    // Artillery properties for iceball (mortar-style)
    if (type === "iceball") {
      this.isArtillery = true;
      this.gravity = -15; // Stronger gravity for more realistic arc
      this.speed = this.speed * 0.8; // Make shells slower and more visible
      
      // For mortar artillery, we need special physics
      this.velocity = { ...direction };
      
      // Find the target player first to calculate proper trajectory
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
      
      // Calculate ballistic trajectory toward target with proper spread
      if (this.targetPlayer) {
        const targetDistance = Math.sqrt(
          Math.pow(position.x - this.targetPlayer.position.x, 2) +
            Math.pow(position.z - this.targetPlayer.position.z, 2)
        );
        
        // Calculate direction to target
        const toTarget = {
          x: this.targetPlayer.position.x - position.x,
          z: this.targetPlayer.position.z - position.z
        };
        
        // CREATE CIRCULAR SHOTGUN SPREAD AROUND TARGET - like a shotgun blast pattern
        // Generate random angle and distance for circular spread around target
        const spreadRadius = Math.max(8, Math.min(20, targetDistance * 0.15)); // Tighter spread for better accuracy
        const randomAngle = Math.random() * 2 * Math.PI; // Random angle 0-360 degrees
        const randomDistance = Math.random() * spreadRadius; // Random distance within radius
        
        // Calculate circular spread offset around target position
        const spreadOffsetX = Math.cos(randomAngle) * randomDistance;
        const spreadOffsetZ = Math.sin(randomAngle) * randomDistance;
        
        // Apply circular spread to target position (not direction)
        const targetWithSpread = {
          x: this.targetPlayer.position.x + spreadOffsetX,
          z: this.targetPlayer.position.z + spreadOffsetZ
        };
        
        // Calculate direction to spread target position
        toTarget.x = targetWithSpread.x - position.x;
        toTarget.z = targetWithSpread.z - position.z;
        
        // Normalize horizontal direction after applying spread
        const horizontalDistance = Math.sqrt(toTarget.x * toTarget.x + toTarget.z * toTarget.z);
        if (horizontalDistance > 0) {
          toTarget.x /= horizontalDistance;
          toTarget.z /= horizontalDistance;
        }
        
        // Calculate ballistic velocity with improved accuracy for target landing
        // Use physics-based calculation for proper trajectory to target
        const gravity = Math.abs(this.gravity); // 15
        const targetHeight = 0.5; // Ground level where target is
        const launchHeight = position.y; // Current launch height
        const heightDiff = targetHeight - launchHeight;
        
        // Calculate optimal launch angle and speed for accurate target landing
        // Use ballistic trajectory formula: range = (v²sin(2θ))/g + (v²sin²(θ))/g * (2h/v²sin²(θ))
        const optimalAngle = 45; // 45 degrees for maximum range efficiency
        const angleRad = (optimalAngle * Math.PI) / 180;
        
        // Calculate required speed to reach target distance with spread consideration
        const baseSpeed = Math.sqrt((targetDistance * gravity) / Math.sin(2 * angleRad));
        const adjustedSpeed = Math.max(15, Math.min(80, baseSpeed * 0.8)); // Much higher max speed for long-range
        
        // Calculate velocity components for accurate landing
        const horizontalSpeed = adjustedSpeed * Math.cos(angleRad);
        const verticalSpeed = adjustedSpeed * Math.sin(angleRad);
        
        this.velocity.x = toTarget.x * horizontalSpeed;
        this.velocity.y = verticalSpeed;
        this.velocity.z = toTarget.z * horizontalSpeed;
        
        console.log(
          `🎯 Artillery circular spread applied: radius=${spreadRadius.toFixed(1)}, angle=${(randomAngle * 180 / Math.PI).toFixed(1)}°, distance=${randomDistance.toFixed(1)}`
        );
      } else {
        // No target found, use original direction with high speed for long range
        const ballisticSpeed = 60; // Much higher default speed for extreme range
        this.velocity.x = direction.x * ballisticSpeed;
        this.velocity.y = Math.abs(direction.y) * ballisticSpeed + 20; // Higher upward trajectory
        this.velocity.z = direction.z * ballisticSpeed;
      }

      // Store launch position for tracking
      this.launchPosition = { ...position };
      this.hasAppliedTargeting = false;
      this.launchTime = Date.now();

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
        } at distance ${this.targetPlayer ? Math.sqrt(
          Math.pow(position.x - this.targetPlayer.position.x, 2) +
            Math.pow(position.z - this.targetPlayer.position.z, 2)
        ).toFixed(1) : "N/A"}`
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

    // Apply homing behavior for fireballs BEFORE movement calculation
    if (this.type === "fireball") {
      console.log(`🔥 Applying homing to fireball ${this.id}`);
      this.updateHoming();
      console.log(`🚀 Fireball speed after homing: ${this.speed}`);
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

      // Apply mortar course correction after initial launch - improved for long-range targeting
      const flightTime = (Date.now() - this.launchTime) / 1000; // Flight time in seconds
      const distanceToTarget = this.targetPlayer ? Math.sqrt(
        Math.pow(this.launchPosition.x - this.targetPlayer.position.x, 2) +
        Math.pow(this.launchPosition.z - this.targetPlayer.position.z, 2)
      ) : 0;
      
      // MINIMAL mid-flight corrections to prevent desync - only for very long range
      const correctionDelay = Math.min(3.0, Math.max(2.0, distanceToTarget / 100)); // 2.0-3.0s delay, longer for stability
      
      if (
        flightTime > correctionDelay && // Longer delay for stability
        !this.hasAppliedTargeting &&
        this.velocity.y < -8 && // Much lower threshold - only correct when falling fast
        this.targetPlayer &&
        distanceToTarget > 100 // Only apply corrections for very long-range shots
      ) {
        // Minimal correction for extreme long-range only
        const targetDirection = {
          x: this.targetPlayer.position.x - this.position.x,
          z: this.targetPlayer.position.z - this.position.z,
        };

        const currentDistance = Math.sqrt(
          targetDirection.x * targetDirection.x +
          targetDirection.z * targetDirection.z
        );
        
        // Minimal correction with no random spread to prevent desync
        if (currentDistance > 0) {
          targetDirection.x /= currentDistance;
          targetDirection.z /= currentDistance;

          // Very weak correction strength to maintain trajectory stability
          const targetingStrength = 2; // Much weaker correction
          
          this.velocity.x += targetDirection.x * targetingStrength;
          this.velocity.z += targetDirection.z * targetingStrength;
          this.hasAppliedTargeting = true;

          console.log(
            `🎯 Minimal long-range correction applied to shell ${this.id} at distance ${currentDistance.toFixed(1)}`
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
    console.log(`💨 Movement Speed: ${this.speed.toFixed(2)} (should be 24 for fireballs)`);
    console.log(`Delta time: ${deltaTime.toFixed(2)}`);

    // Handle ground collision
    const groundLevel = 0.5; // Minimum height above ground
    if (this.position.y <= groundLevel) {
      if (this.type === "iceball" && this.isArtillery) {
        // CRITICAL FIX: Do NOT modify position after impact to prevent desync
        // Store the exact impact position and use it for explosion
        const exactImpactPosition = {
          x: this.position.x,
          y: Math.max(groundLevel, this.position.y), // Only ensure not below ground
          z: this.position.z
        };
        
        // Artillery shells explode on ground impact with area damage
        console.log(
          `💥 Artillery shell ${
            this.id
          } exploded on ground impact at [${exactImpactPosition.x.toFixed(
            1
          )}, ${exactImpactPosition.y.toFixed(1)}, ${exactImpactPosition.z.toFixed(1)}]`
        );
        
        // Use exact impact position for explosion - NO MODIFICATIONS
        this.position = exactImpactPosition;
        
        this.isActive = false; // Deactivate projectile
        this.exploded = true; // Mark as exploded for client-side effects
        this.explosionBroadcasted = false; // Reset flag so it will be sent to client

        // Apply area-of-effect damage to nearby players
        const explosionRadius = 12; // Increased from 5 to 12 for much larger blast radius
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

    // Check world bounds - extended for long-range artillery
    const worldSize = gameState.gameSettings.worldSize;
    if (
      Math.abs(this.position.x) > worldSize ||
      Math.abs(this.position.z) > worldSize ||
      this.position.y < -20 ||
      this.position.y > 100
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
    // Apply fireball speed boost during homing (every frame)
    this.speed = gameState.gameSettings.projectileSpeed * 2;
    console.log(`🚀 Fireball speed boosted to: ${this.speed} (base: ${gameState.gameSettings.projectileSpeed})`);

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
    const playerData = player.toJSON();
    console.log(`🎮 Sending player data to ${username}:`, playerData);
    socket.emit("game-joined", {
      playerId: socket.id,
      player: playerData,
      gameSettings: gameState.gameSettings,
    });

    // Send existing players to new player
    const existingPlayers = Array.from(gameState.players.values())
      .filter((p) => p.id !== socket.id)
      .map((p) => p.toJSON());

    socket.emit("existing-players", existingPlayers);

    // Send existing projectiles to new player
    const existingProjectiles = Array.from(gameState.projectiles.values())
      .filter((p) => p.isActive)
      .map((p) => p.toJSON());

    if (existingProjectiles.length > 0) {
      socket.emit("existing-projectiles", existingProjectiles);
      console.log(`Sent ${existingProjectiles.length} existing projectiles to new player ${username}`);
    }

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

  // Player jump action
  socket.on("player-jump", () => {
    const player = gameState.players.get(socket.id);
    if (!player || !player.isAlive) return;

    if (player.jump()) {
      // Broadcast jump to all players
      io.emit("player-jumped", {
        playerId: socket.id,
        stamina: player.stamina,
        jumpStartTime: player.jumpStartTime,
      });
    }
  });

  // Player dash action
  socket.on("player-dash", (data) => {
    const player = gameState.players.get(socket.id);
    if (!player || !player.isAlive) return;

    const direction = data.direction || { x: 0, z: 0 };

    if (player.dash(direction)) {
      // Broadcast dash to all players
      io.emit("player-dashed", {
        playerId: socket.id,
        stamina: player.stamina,
        dashStartTime: player.dashStartTime,
        dashDirection: player.dashDirection,
      });
    }
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

    // Handle exploded projectiles - send explosion data and keep alive for animation duration
    if (projectile.exploded && !projectile.explosionBroadcasted) {
      projectile.explosionBroadcasted = true;
      projectile.explosionStartTime = Date.now(); // Track when explosion started
      const explosionData = projectile.toJSON();
      console.log(`🚀 SENDING EXPLOSION DATA TO CLIENT:`, {
        id: explosionData.id,
        type: explosionData.type,
        exploded: explosionData.exploded,
        explosionBroadcasted: explosionData.explosionBroadcasted,
        position: explosionData.position
      });
      activeProjectiles.push(explosionData); // Send explosion state to client
      continue;
    }

    // Keep exploded projectiles alive for explosion animation duration (3 seconds)
    if (projectile.exploded && projectile.explosionBroadcasted) {
      const explosionDuration = 3000; // 3 seconds for explosion animation
      const timeSinceExplosion = Date.now() - (projectile.explosionStartTime || 0);
      
      if (timeSinceExplosion < explosionDuration) {
        // Keep sending explosion data to maintain client-side effect
        const explosionData = projectile.toJSON();
        activeProjectiles.push(explosionData);
        continue;
      } else {
        // Explosion animation complete, safe to remove
        expiredProjectiles.push(id);
        continue;
      }
    }

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
    gameState.projectiles.delete(id);
  }

  // Always broadcast projectile updates (even if empty) to ensure sync
  io.emit("projectiles-update", {
    active: activeProjectiles,
    expired: expiredProjectiles,
  });

  // Update all players
  for (const player of gameState.players.values()) {
    if (player.isAlive) {
      // Update movement abilities
      player.updateMovementAbilities();
      
      // Regenerate stamina
      if (player.stamina < player.maxStamina) {
        player.stamina = Math.min(player.maxStamina, player.stamina + 20 * deltaTime); // 20 stamina per second
      }
    }
    
    // Regenerate mana for all players (alive or dead)
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
