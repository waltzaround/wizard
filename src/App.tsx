
import { useState } from "react";
import { WizardGame } from "./components/WizardGame";
import { GameEntry } from "./components/GameEntry";

interface GameState {
  isInGame: boolean;
  username: string;
}

function App() {
  const [gameState, setGameState] = useState<GameState>({
    isInGame: false,
    username: ""
  });

  const handlePlayNow = (username: string) => {
    setGameState({
      isInGame: true,
      username
    });
  };

  const handleExitGame = () => {
    setGameState({
      isInGame: false,
      username: ""
    });
  };

  if (!gameState.isInGame) {
    return <GameEntry onPlayNow={handlePlayNow} />;
  }

  return (
    <div className="w-screen h-screen bg-black relative">
      <WizardGame username={gameState.username} onExitGame={handleExitGame} />
      
      {/* Game UI Overlay */}
      <div className="absolute bottom-4 left-4 text-white bg-black/50 rounded-lg p-3 backdrop-blur-sm">
        <p className="text-xs text-purple-300">Playing as: {gameState.username}</p>
      </div>
      
      {/* Exit Game Button */}
      <div className="absolute top-4 right-4">
        <button
          onClick={handleExitGame}
          className="bg-red-600/80 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm backdrop-blur-sm transition-colors"
        >
          Exit Game
        </button>
      </div>
      
      {/* Instructions */}
      <div className="absolute top-4 right-4 text-white bg-black/50 rounded-lg p-3 backdrop-blur-sm max-w-xs">
        <p className="text-xs text-purple-200 mb-1">Controls:</p>
        <p className="text-xs">Click to lock mouse • WASD to move • SPACE to cast • Scroll to zoom • ESC to unlock</p>
      </div>
    </div>
  );
}

export default App;
