import { ArrowRight, Ear, Image, Keyboard, Languages, List, Mic, ScrollText, Type } from 'lucide-react';
import type { GameDef } from '../../../shared/games';

// Visual summary of a minigame: prompt → response.
export default function GameIcons({ game, size = 22 }: { game: GameDef; size?: number }) {
  const side = (s: 'foreign' | 'english') =>
    s === 'foreign' ? <Languages size={size} aria-label="foreign" /> : <Type size={size} aria-label="English" />;
  return (
    <span className="game-icons">
      {game.prompt.mode === 'image' ? <Image size={size} aria-label="image" /> : side(game.prompt.side)}
      {game.prompt.mode === 'audio' && <Ear size={size} aria-label="listen" />}
      {game.unit === 'sentence' && <ScrollText size={size} aria-label="sentence" />}
      <ArrowRight size={size - 4} className="arrow" />
      {side(game.response.side)}
      {game.response.mode === 'choice' && <List size={size} aria-label="multiple choice" />}
      {game.response.mode === 'type' && <Keyboard size={size} aria-label="type" />}
      {game.response.mode === 'speak' && <Mic size={size} aria-label="speak" />}
    </span>
  );
}
