import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import HomePage from './pages/HomePage'
import BeatCreatorPage from './pages/BeatCreatorPage'
import BeatEditorPage from './pages/BeatEditorPage'
import GeneratePage from './pages/GeneratePage'
import CockHeroPage from './pages/CockHeroPage'
import LibrariesPage from './pages/LibrariesPage'
import HistoryPage from './pages/HistoryPage'
import SettingsPage from './pages/SettingsPage'

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/beats" element={<BeatCreatorPage />} />
        <Route path="/editor" element={<BeatEditorPage />} />
        <Route path="/generate" element={<GeneratePage />} />
        <Route path="/libraries" element={<LibrariesPage />} />
        <Route path="/cockhero" element={<CockHeroPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </Layout>
  )
}
