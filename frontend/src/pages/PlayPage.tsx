import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Star } from 'lucide-react';
import { useApp } from '../state/AppContext';
import { api } from '../api';
import { useStoredState } from '../lib/hooks';
import MinigameRunner from '../components/minigame/MinigameRunner';
import LevelDots from '../components/LevelDots';
import GameIcons from '../components/GameIcons';
import { GAMES_BY_ID, isGameId } from '../../../shared/games';
import { BATCH_SIZE, requiredLevels } from '../../../shared/scoring';
import type { BatchWord, NextResponse } from '../../../shared/types';

// Free play: one minigame, one batch of 7 words (or every batch up to it).
export default function PlayPage() {
  const { gameId } = useParams();
  const { language, settings } = useApp();
  const [batch, setBatch] = useStoredState<number>(`lang.batch.${language?.id ?? ''}`, 1);
  const [cumulative, setCumulative] = useStoredState<boolean>('lang.cumulative', false);
  const [batchWords, setBatchWords] = useState<BatchWord[]>([]);
  const [batchInput, setBatchInput] = useState(String(batch));
  const totalBatches = language ? Math.max(1, Math.ceil(language.wordCount / BATCH_SIZE)) : 1;

  useEffect(() => setBatchInput(String(batch)), [batch]);

  // Start at the batch currently being learnt the first time.
  useEffect(() => {
    if (!language) return;
    try {
      if (localStorage.getItem(`lang.batch.${language.id}`) !== null) return;
    } catch {
      return;
    }
    api
      .progress(language.id)
      .then((summary) => summary.learn?.batch && setBatch(summary.learn.batch))
      .catch(() => undefined);
  }, [language?.id]);

  const game = isGameId(gameId) ? GAMES_BY_ID[gameId] : null;
  const fetchNext = useCallback(
    (recent: number[]) => api.playNext(language!.id, { gameId: game!.id, batch, cumulative, recent }),
    [language, game, batch, cumulative]
  );
  const onUpdate = useCallback((response: NextResponse) => setBatchWords(response.state.batchWords), []);

  if (!game) {
    return (
      <div className="page narrow">
        <p>Unknown minigame.</p>
        <Link to="/">Back to the menu</Link>
      </div>
    );
  }
  if (!language || !settings) {
    return (
      <div className="page narrow">
        <p>
          Select or <Link to="/config/language">add a language</Link> first.
        </p>
      </div>
    );
  }

  const required = requiredLevels(settings.learning)[game.phase];
  const perfect = batchWords.length > 0 && batchWords.every((word) => word.levels[game.phase] >= required);
  const go = (value: number) => setBatch(Math.max(1, Math.min(totalBatches, value)));

  return (
    <div className="page play">
      <header className="play-header">
        <div>
          <h1 className="page-title">
            <GameIcons game={game} /> {game.title}
          </h1>
        </div>
        <div className="batch-picker">
          <button className="icon-button" onClick={() => go(batch - 1)} disabled={batch <= 1} aria-label="Previous batch">
            <ChevronLeft />
          </button>
          <label>
            Batch
            <input
              type="number"
              min={1}
              max={totalBatches}
              value={batchInput}
              onChange={(event) => setBatchInput(event.target.value)}
              onBlur={() => go(Number(batchInput) || 1)}
              onKeyDown={(event) => event.key === 'Enter' && go(Number(batchInput) || 1)}
            />
            <span className="muted">of {totalBatches}</span>
          </label>
          <button className="icon-button" onClick={() => go(batch + 1)} disabled={batch >= totalBatches} aria-label="Next batch">
            <ChevronRight />
          </button>
          <label className="toggle">
            <input type="checkbox" checked={cumulative} onChange={(event) => setCumulative(event.target.checked)} />
            include earlier batches
          </label>
          {perfect && (
            <span className="star" title="Every word of this batch is mastered in this category">
              <Star size={20} fill="currentColor" />
            </span>
          )}
        </div>
      </header>
      <div className="batch-words">
        {batchWords.map((word) => (
          <span key={word.id} className="batch-word" title={word.english.join('; ')}>
            {word.display}
            <LevelDots levels={word.levels} only={game.phase} />
          </span>
        ))}
      </div>
      <MinigameRunner
        language={language}
        settings={settings}
        fetchNext={fetchNext}
        resetKey={`${game.id}:${batch}:${cumulative}`}
        onUpdate={onUpdate}
        onResults={(results) =>
          setBatchWords((words) => words.map((word) => (results.levels[word.id] ? { ...word, levels: results.levels[word.id] } : word)))
        }
      />
    </div>
  );
}
