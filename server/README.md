# Wizard Game Multiplayer Server

A real-time multiplayer server for the Wizard Game using Socket.IO and Express.

## Features

- **Real-time multiplayer**: Up to 20 players can play simultaneously
- **Player tracking**: Position, rotation, health, mana, and status
- **Projectile system**: Fireball spells with collision detection
- **Game state management**: Centralized game loop at 60 FPS
- **Health/Mana system**: Damage dealing and mana regeneration
- **Player colors**: Unique colors for each player
- **World boundaries**: 100x100 unit game world

## API Endpoints

- `GET /health` - Server health check
- `GET /stats` - Current game statistics

## Socket Events

### Client → Server
- `join-game` - Join the game with username
- `player-update` - Update player position/rotation
- `cast-spell` - Cast a spell/projectile

### Server → Client
- `game-joined` - Successful game join confirmation
- `existing-players` - List of current players
- `player-joined` - New player joined
- `player-left` - Player disconnected
- `player-moved` - Player position update
- `projectile-created` - New projectile created
- `projectiles-update` - Projectile state updates
- `player-hit` - Player took damage
- `player-died` - Player was eliminated
- `player-stats-updated` - Health/mana updates

## Game Mechanics

### Combat System
- **Fireball damage**: 25 HP per hit
- **Mana cost**: 20 mana per spell
- **Mana regeneration**: 0.5 mana per tick (60 FPS)
- **Projectile speed**: 0.5 units per second
- **Projectile lifetime**: 5 seconds
- **Hit radius**: 2 units

### Player Stats
- **Health**: 100 HP (dies at 0)
- **Mana**: 100 MP (regenerates over time)
- **Spawn**: Random position within 20x20 area

## Running the Server

```bash
# Install dependencies
npm install

# Start development server with auto-reload
npm run dev

# Start production server
npm start
```

The server will run on port 3001 by default.

## Environment Variables

- `PORT` - Server port (default: 3001)

## Development

The server uses:
- **Express** for HTTP endpoints
- **Socket.IO** for real-time communication
- **UUID** for unique IDs
- **CORS** for cross-origin requests

Game state is stored in memory and includes:
- Active players Map
- Active projectiles Map
- Game settings configuration
