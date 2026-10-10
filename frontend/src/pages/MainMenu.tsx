import { Link, useNavigate } from 'react-router-dom';
import { AudioLines, BarChart3, Settings, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useApp } from '../state/AppContext';
import { LanguageSelect } from '../components/Layout';
import GameIcons from '../components/GameIcons';
import { api } from '../api';
import { PHASES, PHASE_DESCRIPTIONS, PHASE_LABELS, gamesForPhase } from '../../../shared/games';
import type { ProgressSummary } from '../../../shared/types';

export default function MainMenu() {
  const { language, languages, ready } = useApp();
  const navigate = useNavigate();
  const [progress, setProgress] = useState<ProgressSummary | null>(null);

  useEffect(() => {
    setProgress(null);
    if (!language) return;
    api
      .progress(language.id)
      .then(setProgress)
      .catch(() => setProgress(null));
  }, [language?.id]);

  if (ready && languages.length === 0) {
    return (
      <div className="page narrow">
        <h1 className="page-title">Welcome to lang</h1>
        <div className="card welcome">
          <p>
            Learn any language from its most common words to its rarest: batches of 7 words, immediate feedback, spaced
            repetition and many different exercise types.
          </p>
          <ol>
            <li>Add a language (e.g. Spanish).</li>
            <li>Import public-domain books — words are counted and sorted by frequency automatically.</li>
            <li>Connect a translation service (Google Colab or an API) to get definitions, sentences and audio.</li>
          </ol>
          <Link className="button primary" to="/config/language">
            <Sparkles size={16} /> Add your first language
          </Link>
          <p className="muted">
            Or start with the <Link to="/pronunciation">pronunciation mode</Link>: the sounds of speech and their IPA symbols, no language needed.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="page menu">
      <header className="menu-header">
        <h1 className="page-title">Main menu</h1>
        <LanguageSelect />
      </header>

      <div className="menu-actions">
        <Link to="/config" className="menu-action">
          <Settings size={28} />
          <div>
            <strong>Configuration</strong>
            <span className="muted">
              {language ? `${language.wordCount.toLocaleString()} words · ${language.sentenceCount.toLocaleString()} sentences · ${language.sourceCount} sources` : 'Languages, books, services, images'}
            </span>
          </div>
        </Link>
        <Link to="/progress" className="menu-action primary">
          <BarChart3 size={28} />
          <div>
            <strong>Personal progress</strong>
            <span>
              {progress
                ? `${progress.learnedWords.toLocaleString()} learned · ${progress.dueNow} due for review${progress.learn?.block ? ` · block ${progress.learn.block}, batch ${progress.learn.batch} (${PHASE_LABELS[progress.learn.phase!]})` : ''}`
                : 'Guided learning and spaced repetition'}
            </span>
          </div>
        </Link>
        <Link to="/pronunciation" className="menu-action">
          <AudioLines size={28} />
          <div>
            <strong>Pronunciation (IPA)</strong>
            <span className="muted">The sounds of speech and their symbols, for every language</span>
          </div>
        </Link>
      </div>

      {PHASES.map((phase) => (
        <section key={phase} className="menu-section">
          <h2>
            {PHASE_LABELS[phase]} <span className="muted">{PHASE_DESCRIPTIONS[phase]}</span>
          </h2>
          <div className="games-grid">
            {gamesForPhase(phase).map((game) => (
              <button key={game.id} className={`game-card phase-${phase}`} onClick={() => navigate(`/play/${game.id}`)} disabled={!language}>
                <GameIcons game={game} />
                <span>{game.title}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
