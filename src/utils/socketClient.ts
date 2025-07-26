import { io, Socket } from 'socket.io-client';

export interface Player {
  id: string;
  username: string;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  health: number;
  mana: number;
  isAlive: boolean;
  color: number;
}

export interface Projectile {
  id: string;
  playerId: string;
  position: { x: number; y: number; z: number };
  direction: { x: number; y: number; z: number };
  type: string;
  isActive: boolean;
  targetId?: string; // For homing missiles
}

export interface GameSettings {
  worldSize: number;
  maxPlayers: number;
  projectileSpeed: number;
  projectileLifetime: number;
}

export class SocketClient {
  private socket: Socket | null = null;
  private isConnected = false;
  private playerId: string | null = null;

  // Event callbacks
  private onGameJoined: ((data: { playerId: string; player: Player; gameSettings: GameSettings }) => void) | null = null;
  private onExistingPlayers: ((players: Player[]) => void) | null = null;
  private onPlayerJoined: ((player: Player) => void) | null = null;
  private onPlayerLeft: ((playerId: string) => void) | null = null;
  private onPlayerMoved: ((data: { playerId: string; position: any; rotation: any }) => void) | null = null;
  private onProjectileCreated: ((projectile: Projectile) => void) | null = null;
  private onProjectilesUpdate: ((data: { active: Projectile[]; expired: string[] }) => void) | null = null;
  private onPlayerHit: ((data: { playerId: string; projectileId: string; damage: number; health: number; isAlive: boolean }) => void) | null = null;
  private onPlayerDied: ((data: { playerId: string; killedBy: string }) => void) | null = null;
  private onPlayerStatsUpdated: ((data: { playerId: string; health: number; mana: number }) => void) | null = null;

  connect(serverUrl: string = 'http://localhost:3001'): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.socket) {
        this.disconnect();
      }

      this.socket = io(serverUrl);

      this.socket.on('connect', () => {
        console.log('Connected to multiplayer server');
        this.isConnected = true;
        resolve();
      });

      this.socket.on('disconnect', () => {
        console.log('Disconnected from multiplayer server');
        this.isConnected = false;
        this.playerId = null;
      });

      this.socket.on('connect_error', (error) => {
        console.error('Failed to connect to server:', error);
        reject(error);
      });

      // Game event listeners
      this.socket.on('game-joined', (data) => {
        this.playerId = data.playerId;
        this.onGameJoined?.(data);
      });

      this.socket.on('existing-players', (players) => {
        this.onExistingPlayers?.(players);
      });

      this.socket.on('player-joined', (player) => {
        this.onPlayerJoined?.(player);
      });

      this.socket.on('player-left', (playerId) => {
        this.onPlayerLeft?.(playerId);
      });

      this.socket.on('player-moved', (data) => {
        this.onPlayerMoved?.(data);
      });

      this.socket.on('projectile-created', (projectile) => {
        this.onProjectileCreated?.(projectile);
      });

      this.socket.on('projectiles-update', (data) => {
        this.onProjectilesUpdate?.(data);
      });

      this.socket.on('player-hit', (data) => {
        this.onPlayerHit?.(data);
      });

      this.socket.on('player-died', (data) => {
        this.onPlayerDied?.(data);
      });

      this.socket.on('player-stats-updated', (data) => {
        this.onPlayerStatsUpdated?.(data);
      });
    });
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.isConnected = false;
      this.playerId = null;
    }
  }

  joinGame(username: string) {
    if (!this.socket || !this.isConnected) {
      throw new Error('Not connected to server');
    }
    this.socket.emit('join-game', { username });
  }

  updatePlayer(position: { x: number; y: number; z: number }, rotation: { x: number; y: number; z: number }) {
    if (!this.socket || !this.isConnected) return;
    this.socket.emit('player-update', { position, rotation });
  }

  castSpell(position: { x: number; y: number; z: number }, direction: { x: number; y: number; z: number }, spellType: string = 'fireball') {
    if (!this.socket || !this.isConnected) return;
    this.socket.emit('cast-spell', { position, direction, spellType });
  }

  // Event listener setters
  setOnGameJoined(callback: (data: { playerId: string; player: Player; gameSettings: GameSettings }) => void) {
    this.onGameJoined = callback;
  }

  setOnExistingPlayers(callback: (players: Player[]) => void) {
    this.onExistingPlayers = callback;
  }

  setOnPlayerJoined(callback: (player: Player) => void) {
    this.onPlayerJoined = callback;
  }

  setOnPlayerLeft(callback: (playerId: string) => void) {
    this.onPlayerLeft = callback;
  }

  setOnPlayerMoved(callback: (data: { playerId: string; position: any; rotation: any }) => void) {
    this.onPlayerMoved = callback;
  }

  setOnProjectileCreated(callback: (projectile: Projectile) => void) {
    this.onProjectileCreated = callback;
  }

  setOnProjectilesUpdate(callback: (data: { active: Projectile[]; expired: string[] }) => void) {
    this.onProjectilesUpdate = callback;
  }

  setOnPlayerHit(callback: (data: { playerId: string; projectileId: string; damage: number; health: number; isAlive: boolean }) => void) {
    this.onPlayerHit = callback;
  }

  setOnPlayerDied(callback: (data: { playerId: string; killedBy: string }) => void) {
    this.onPlayerDied = callback;
  }

  setOnPlayerStatsUpdated(callback: (data: { playerId: string; health: number; mana: number }) => void) {
    this.onPlayerStatsUpdated = callback;
  }

  // Getters
  getPlayerId(): string | null {
    return this.playerId;
  }

  getIsConnected(): boolean {
    return this.isConnected;
  }
}

// Singleton instance
export const socketClient = new SocketClient();
