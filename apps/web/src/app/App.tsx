import { Navigate, Route, Routes } from 'react-router-dom';
import { CanvasPage } from '../pages/CanvasPage';
import { SpacesPage } from '../pages/SpacesPage';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<SpacesPage />} />
      <Route path="/spaces/:spaceId" element={<CanvasPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
