import { NavLink, Navigate, useParams } from 'react-router-dom';
import { useApp } from '../../state/AppContext';
import LanguageTab from './LanguageTab';
import SourcesTab from './SourcesTab';
import WordsTab from './WordsTab';
import SentencesTab from './SentencesTab';
import ServicesTab from './ServicesTab';
import ImagesTab from './ImagesTab';
import LearningTab from './LearningTab';
import DataTab from './DataTab';

const TABS = [
  { id: 'language', label: 'Language', needsLanguage: false },
  { id: 'sources', label: 'Sources', needsLanguage: true },
  { id: 'services', label: 'Services', needsLanguage: false },
  { id: 'words', label: 'Words', needsLanguage: true },
  { id: 'sentences', label: 'Sentences', needsLanguage: true },
  { id: 'images', label: 'Images', needsLanguage: false },
  { id: 'learning', label: 'Learning', needsLanguage: false },
  { id: 'data', label: 'Save & transfer', needsLanguage: false },
];

export default function ConfigPage() {
  const { tab } = useParams();
  const { language } = useApp();
  if (!tab) return <Navigate to={language ? '/config/sources' : '/config/language'} replace />;
  const current = TABS.find((entry) => entry.id === tab);
  if (!current) return <Navigate to="/config/language" replace />;

  return (
    <div className="page config">
      <h1 className="page-title">Configuration{language ? ` — ${language.name}` : ''}</h1>
      <nav className="tabs">
        {TABS.map((entry) => (
          <NavLink key={entry.id} to={`/config/${entry.id}`} className={entry.needsLanguage && !language ? 'disabled' : ''}>
            {entry.label}
          </NavLink>
        ))}
      </nav>
      {current.needsLanguage && !language ? (
        <div className="card">
          Add a language first in the <NavLink to="/config/language">Language</NavLink> tab.
        </div>
      ) : (
        <>
          {tab === 'language' && <LanguageTab />}
          {tab === 'sources' && language && <SourcesTab language={language} />}
          {tab === 'services' && <ServicesTab />}
          {tab === 'words' && language && <WordsTab language={language} />}
          {tab === 'sentences' && language && <SentencesTab language={language} />}
          {tab === 'images' && <ImagesTab />}
          {tab === 'learning' && <LearningTab />}
          {tab === 'data' && <DataTab />}
        </>
      )}
    </div>
  );
}
