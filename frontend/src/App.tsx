import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { AppProvider, useApp } from './state/AppContext';
import Layout from './components/Layout';
import MainMenu from './pages/MainMenu';
import PlayPage from './pages/PlayPage';
import ProgressPage from './pages/ProgressPage';
import SessionPage from './pages/SessionPage';
import ConfigPage from './pages/config/ConfigPage';
import PronunciationPage from './pages/PronunciationPage';
import PronunciationPlayPage from './pages/PronunciationPlayPage';

function Routed() {
  const { ready, languageId } = useApp();
  if (!ready) {
    return (
      <div className="splash">
        <Loader2 className="spin" />
      </div>
    );
  }
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<MainMenu />} />
        <Route path="/play/:gameId" element={<PlayPage key={languageId ?? ''} />} />
        <Route path="/progress" element={<ProgressPage />} />
        <Route path="/progress/session" element={<SessionPage key={languageId ?? ''} />} />
        <Route path="/pronunciation" element={<PronunciationPage />} />
        <Route path="/pronunciation/:gameId" element={<PronunciationPlayPage />} />
        <Route path="/config" element={<ConfigPage />} />
        <Route path="/config/:tab" element={<ConfigPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppProvider>
        <Routed />
      </AppProvider>
    </BrowserRouter>
  );
}
