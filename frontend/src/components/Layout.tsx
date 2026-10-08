import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { BarChart3, Home, Settings, X } from 'lucide-react';
import { useApp } from '../state/AppContext';

export function LanguageSelect({ compact = false }: { compact?: boolean }) {
  const { languages, languageId, selectLanguage } = useApp();
  const navigate = useNavigate();
  return (
    <label className={`language-select${compact ? ' compact' : ''}`}>
      {!compact && <span>Language</span>}
      <select
        value={languageId ?? ''}
        onChange={(event) => {
          if (event.target.value === '__add') navigate('/config/language');
          else selectLanguage(event.target.value);
        }}
      >
        {languages.length === 0 && <option value="">No language yet</option>}
        {languages.map((language) => (
          <option key={language.id} value={language.id}>
            {language.name}
          </option>
        ))}
        <option value="__add">+ Add a language…</option>
      </select>
    </label>
  );
}

export default function Layout() {
  const { toasts, dismissToast, backendError } = useApp();
  return (
    <div className="app">
      <nav className="topbar">
        <NavLink to="/" className="brand" end>
          lang
        </NavLink>
        <div className="nav-links">
          <NavLink to="/" end>
            <Home size={16} /> Menu
          </NavLink>
          <NavLink to="/progress">
            <BarChart3 size={16} /> Personal progress
          </NavLink>
          <NavLink to="/config">
            <Settings size={16} /> Configuration
          </NavLink>
        </div>
        <LanguageSelect compact />
      </nav>
      {backendError && <div className="banner error">Backend unavailable: {backendError}</div>}
      <main>
        <Outlet />
      </main>
      <div className="toasts" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.kind}`}>
            <span>{toast.message}</span>
            <button className="icon-button" onClick={() => dismissToast(toast.id)} aria-label="Dismiss">
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
