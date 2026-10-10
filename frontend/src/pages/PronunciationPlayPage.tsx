import { useCallback, useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { api } from '../api';
import { useApp } from '../state/AppContext';
import { useStoredState } from '../lib/hooks';
import IpaRunner from '../components/ipa/IpaRunner';
import IpaGameIcons from '../components/ipa/IpaGameIcons';
import { IPA_GAMES_BY_ID, isIpaGameId, type IpaSoundSet } from '../../../shared/ipa/games';

// One game of the pronunciation mode, with the sounds and words chosen on the
// Pronunciation page.
export default function PronunciationPlayPage() {
  const { gameId } = useParams();
  const { settings, languages } = useApp();
  const [sounds, setSounds] = useStoredState<IpaSoundSet>('lang.ipa.sounds', 'english');
  const [words] = useStoredState<string>('lang.ipa.words', 'examples');
  const game = isIpaGameId(gameId) ? IPA_GAMES_BY_ID[gameId] : null;
  const language = words === 'examples' ? null : languages.find((entry) => entry.id === words) ?? null;
  const scope = useMemo(() => ({ sounds, words: language ? language.id : 'examples' }), [sounds, language]);
  const fetchNext = useCallback((recent: string[]) => api.ipaNext({ gameId: game!.id, recent, ...scope }), [game, scope]);

  if (!game) {
    return (
      <div className="page narrow">
        <p>Unknown pronunciation game.</p>
        <Link to="/pronunciation">Back to Pronunciation</Link>
      </div>
    );
  }
  if (!settings) return null;

  return (
    <div className="page play">
      <header className="play-header">
        <div>
          <Link to="/pronunciation" className="back-link">
            <ArrowLeft size={14} /> Pronunciation
          </Link>
          <h1 className="page-title">
            <IpaGameIcons game={game} /> {game.title}
          </h1>
        </div>
        <div className="batch-picker">
          <label>
            Sounds
            <select value={sounds} onChange={(event) => setSounds(event.target.value as IpaSoundSet)}>
              <option value="english">English sounds</option>
              <option value="all">All sounds</option>
            </select>
          </label>
          <span className="muted">Words: {language ? `${language.name} words` : 'example words'}</span>
        </div>
      </header>
      <IpaRunner
        key={`${game.id}:${scope.sounds}:${scope.words}`}
        fetchNext={fetchNext}
        scope={scope}
        settings={settings}
        language={language}
      />
    </div>
  );
}
