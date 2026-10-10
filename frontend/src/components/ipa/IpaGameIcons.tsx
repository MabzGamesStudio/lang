import type { ReactNode } from 'react';
import { ArrowRight, BookOpen, Ear, Keyboard, List, Type } from 'lucide-react';
import type { IpaGameDef, IpaPrompt, IpaResponse } from '../../../../shared/ipa/games';

// Visual summary of a pronunciation game: prompt → response.
function Glyph({ text }: { text: string }) {
  return <span className="ipa-glyph">{text}</span>;
}

export default function IpaGameIcons({ game, size = 22 }: { game: IpaGameDef; size?: number }) {
  const prompts: Record<IpaPrompt, ReactNode> = {
    sound: <Ear size={size} aria-label="listen to a sound" />,
    symbol: <Glyph text="ʃ" />,
    examples: (
      <>
        <BookOpen size={size} aria-label="example words" />
        <Glyph text="_" />
      </>
    ),
    wordAudio: (
      <>
        <Ear size={size} aria-label="listen to a word" />
        <Type size={size} aria-label="word" />
      </>
    ),
    ipa: <Glyph text="/ə/" />,
    word: <Type size={size} aria-label="word" />,
  };
  const responses: Record<IpaResponse, ReactNode> = {
    symbolChoice: (
      <>
        <Glyph text="ʃ" />
        <List size={size} aria-label="multiple choice" />
      </>
    ),
    soundChoice: (
      <>
        <Ear size={size} aria-label="sounds" />
        <List size={size} aria-label="multiple choice" />
      </>
    ),
    ipaChoice: (
      <>
        <Glyph text="/ə/" />
        <List size={size} aria-label="multiple choice" />
      </>
    ),
    wordAudioChoice: (
      <>
        <Ear size={size} aria-label="recordings" />
        <List size={size} aria-label="multiple choice" />
      </>
    ),
    symbolTyped: (
      <>
        <Glyph text="ʃ" />
        <Keyboard size={size} aria-label="type" />
      </>
    ),
    ipaTyped: (
      <>
        <Glyph text="/ə/" />
        <Keyboard size={size} aria-label="type" />
      </>
    ),
    wordTyped: (
      <>
        <Type size={size} aria-label="word" />
        <Keyboard size={size} aria-label="type" />
      </>
    ),
  };
  return (
    <span className="game-icons">
      {prompts[game.prompt]}
      <ArrowRight size={size - 4} className="arrow" />
      {responses[game.response]}
    </span>
  );
}
