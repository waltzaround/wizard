import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface GameEntryProps {
  onPlayNow: (username: string) => void;
}

// Generate random username
function generateRandomUsername(): string {
  const adjectives = [
    "Mystic", "Ancient", "Wise", "Powerful", "Arcane", "Stellar", "Shadow", 
    "Crystal", "Fire", "Storm", "Lightning", "Frost", "Golden", "Silver",
    "Dark", "Bright", "Swift", "Noble", "Brave", "Wild"
  ];
  
  const nouns = [
    "Wizard", "Mage", "Sorcerer", "Enchanter", "Warlock", "Sage", "Oracle",
    "Spellcaster", "Conjurer", "Magician", "Mystic", "Adept", "Master",
    "Scholar", "Keeper", "Guardian", "Wielder", "Seeker", "Walker", "Rider"
  ];
  
  const randomAdjective = adjectives[Math.floor(Math.random() * adjectives.length)];
  const randomNoun = nouns[Math.floor(Math.random() * nouns.length)];
  const randomNumber = Math.floor(Math.random() * 999) + 1;
  
  return `${randomAdjective}${randomNoun}${randomNumber}`;
}

export function GameEntry({ onPlayNow }: GameEntryProps) {
  const [username, setUsername] = useState(generateRandomUsername());
  const [isLoading, setIsLoading] = useState(false);

  const handlePlayNow = async () => {
    if (!username.trim()) return;
    
    setIsLoading(true);
    // Simulate connection delay
    await new Promise(resolve => setTimeout(resolve, 500));
    onPlayNow(username.trim());
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handlePlayNow();
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-purple-900 via-blue-900 to-indigo-900 flex items-center justify-center p-4">
      <Card className="w-full max-w-md bg-black/40 backdrop-blur-sm border-purple-500/30">
        <CardHeader className="text-center">
          <CardTitle className="text-3xl font-bold text-white mb-2">
            🧙‍♂️ Hairy Wizards
          </CardTitle>
          <CardDescription className="text-purple-200">
           Do battle with other hairy wizards
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <label htmlFor="username" className="text-sm font-medium text-purple-200">
              Choose your wizard name:
            </label>
            <Input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Enter your wizard name..."
              className="bg-black/20 border-purple-500/50 text-white placeholder:text-purple-300 focus:border-purple-400"
              maxLength={20}
            />
          </div>
          
          <Button
            onClick={handlePlayNow}
            disabled={!username.trim() || isLoading}
            className="w-full bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white font-semibold py-3 text-lg disabled:opacity-50"
          >
            {isLoading ? (
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Entering Realm...
              </div>
            ) : (
              "🚀 Play Now"
            )}
          </Button>
          
          <div className="text-center">
            <button
              onClick={() => setUsername(generateRandomUsername())}
              className="text-sm text-purple-300 hover:text-purple-200 underline"
            >
              Generate new name
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
