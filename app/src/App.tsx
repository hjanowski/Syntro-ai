import { Navigate, Route, Routes } from 'react-router-dom';
import { Shell } from './components/Shell.tsx';
import Overview from './pages/Overview.tsx';
import Projects from './pages/Projects.tsx';
import ProjectDetail from './pages/ProjectDetail.tsx';
import Journeys from './pages/Journeys.tsx';
import JourneyBuilder from './pages/JourneyBuilder.tsx';
import Customers from './pages/Customers.tsx';
import Simulations from './pages/Simulations.tsx';
import RunDetail from './pages/RunDetail.tsx';
import Results from './pages/Results.tsx';
import ResultsIndex from './pages/ResultsIndex.tsx';
import Integrations from './pages/Integrations.tsx';
import Settings from './pages/Settings.tsx';

export default function App() {
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Overview />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/projects/:projectId" element={<ProjectDetail />} />
        <Route path="/journeys" element={<Journeys />} />
        <Route path="/journeys/:journeyId" element={<JourneyBuilder />} />
        <Route path="/customers" element={<Customers />} />
        <Route path="/simulations" element={<Simulations />} />
        <Route path="/simulations/:runId" element={<RunDetail />} />
        <Route path="/results" element={<ResultsIndex />} />
        <Route path="/results/:runId" element={<Results />} />
        <Route path="/integrations" element={<Integrations />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}
