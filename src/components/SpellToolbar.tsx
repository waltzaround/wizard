import { useState, useEffect, useCallback } from "react";

export interface Spell {
  id: string;
  name: string;
  icon: string;
  manaCost: number;
  cooldown: number;
  description: string;
  color: string;
  type: "projectile" | "area" | "self" | "utility";
}

interface SpellToolbarProps {
  onSpellCast: (spell: Spell) => void;
  isConnected: boolean;
}

const SPELLS: Spell[] = [
  {
    id: "fireball",
    name: "Fireball",
    icon: "🔥",
    manaCost: 20,
    cooldown: 1000,
    description: "Launch a burning projectile",
    color: "#FF4500",
    type: "projectile",
  },
  {
    id: "iceball",
    name: "Artillery Strike",
    icon: "💥",
    manaCost: 40,
    cooldown: 3000,
    description: "Shotgun artillery barrage at closest enemy",
    color: "#FF8C00",
    type: "area",
  },
  {
    id: "laser",
    name: "Laser Sweep",
    icon: "🔴", // You can change this to a better laser/beam emoji if you prefer
    manaCost: 35,
    cooldown: 2000,
    description: "Unleash a massive laser beam that sweeps a 90° arc",
    color: "#FF0000",
    type: "projectile",
  },
  {
    id: "heal",
    name: "Heal",
    icon: "💚",
    manaCost: 30,
    cooldown: 3000,
    description: "Restore health over time",
    color: "#32CD32",
    type: "self",
  },
  {
    id: "teleport",
    name: "Teleport",
    icon: "✨",
    manaCost: 40,
    cooldown: 5000,
    description: "Instantly move forward",
    color: "#9370DB",
    type: "utility",
  },
];

export function SpellToolbar({ onSpellCast, isConnected }: SpellToolbarProps) {
  const [selectedSpell, setSelectedSpell] = useState(0);
  const [cooldowns, setCooldowns] = useState<{ [key: string]: number }>({});

  const castSelectedSpell = useCallback(() => {
    const spell = SPELLS[selectedSpell];
    if (!spell || !isConnected) return;

    const currentCooldown = cooldowns[spell.id] || 0;
    if (currentCooldown <= 0) {
      onSpellCast(spell);
      setCooldowns((prev) => ({ ...prev, [spell.id]: spell.cooldown }));
    }
  }, [selectedSpell, isConnected, cooldowns, onSpellCast]);

  // Handle number key presses for spell selection
  useEffect(() => {
    const handleKeyPress = (event: KeyboardEvent) => {
      const key = event.key;
      if (key >= "1" && key <= "5") {
        const spellIndex = parseInt(key) - 1;
        if (spellIndex < SPELLS.length) {
          setSelectedSpell(spellIndex);
        }
      }

      // Cast selected spell with Space or Enter
      if ((key === " " || key === "Enter") && isConnected) {
        event.preventDefault();
        castSelectedSpell();
      }
    };

    window.addEventListener("keydown", handleKeyPress);
    return () => window.removeEventListener("keydown", handleKeyPress);
  }, [castSelectedSpell, isConnected]);

  // Update cooldowns
  useEffect(() => {
    const interval = setInterval(() => {
      setCooldowns((prev) => {
        const updated = { ...prev };
        let hasChanges = false;

        Object.keys(updated).forEach((spellId) => {
          if (updated[spellId] > 0) {
            updated[spellId] = Math.max(0, updated[spellId] - 100);
            hasChanges = true;
          }
        });

        return hasChanges ? updated : prev;
      });
    }, 100);

    return () => clearInterval(interval);
  }, []);

  const handleSpellClick = (index: number) => {
    setSelectedSpell(index);
    // Cast immediately if clicked while selected
    if (index === selectedSpell) {
      castSelectedSpell();
    }
  };

  const canCastSpell = (spell: Spell) => {
    const currentCooldown = cooldowns[spell.id] || 0;
    return currentCooldown <= 0 && isConnected;
  };

  const getCooldownPercent = (spell: Spell) => {
    const currentCooldown = cooldowns[spell.id] || 0;
    return (currentCooldown / spell.cooldown) * 100;
  };

  return (
    <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 z-50">
      <div className="bg-black/80 backdrop-blur-sm rounded-lg p-2 border border-gray-600">
        <div className="flex gap-2">
          {SPELLS.map((spell, index) => {
            const isSelected = index === selectedSpell;
            const canCast = canCastSpell(spell);
            const cooldownPercent = getCooldownPercent(spell);

            return (
              <div
                key={spell.id}
                className={`relative w-16 h-16 rounded-lg border-2 cursor-pointer transition-all duration-200 ${
                  isSelected
                    ? "border-white bg-white/20 scale-110"
                    : "border-gray-500 bg-gray-800/50 hover:border-gray-400 hover:bg-gray-700/50"
                } ${!canCast ? "opacity-50" : ""}`}
                onClick={() => handleSpellClick(index)}
                title={`${spell.name} - ${spell.description}`}
              >
                {/* Spell Icon */}
                <div className="absolute inset-0 flex items-center justify-center">
                  <span
                    className="text-2xl"
                    style={{ filter: canCast ? "none" : "grayscale(100%)" }}
                  >
                    {spell.icon}
                  </span>
                </div>

                {/* Number indicator */}
                <div className="absolute top-0 left-0 bg-black/70 text-white text-xs px-1 rounded-br">
                  {index + 1}
                </div>

                {/* Cooldown overlay */}
                {cooldownPercent > 0 && (
                  <div
                    className="absolute inset-0 bg-black/60 rounded-lg transition-all duration-100"
                    style={{
                      clipPath: `polygon(0 ${100 - cooldownPercent}%, 100% ${
                        100 - cooldownPercent
                      }%, 100% 100%, 0% 100%)`,
                    }}
                  />
                )}

                {/* Cooldown timer */}
                {cooldownPercent > 0 && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-white text-xs font-bold">
                      {Math.ceil((cooldowns[spell.id] || 0) / 1000)}
                    </span>
                  </div>
                )}

                {/* Selection glow */}
                {isSelected && (
                  <div
                    className="absolute inset-0 rounded-lg animate-pulse"
                    style={{
                      boxShadow: `0 0 20px ${spell.color}`,
                      border: `2px solid ${spell.color}`,
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* Selected spell info */}
        <div className="mt-2 text-center">
          <div className="text-white text-sm font-semibold">
            {SPELLS[selectedSpell].name}
          </div>
          <div className="text-gray-300 text-xs">
            {SPELLS[selectedSpell].description}
          </div>
          <div className="text-blue-400 text-xs mt-1">
            Press {selectedSpell + 1} to select • Space/Enter to cast
          </div>
        </div>
      </div>
    </div>
  );
}

export { SPELLS };
