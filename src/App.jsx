import { Routes, Route, Navigate } from 'react-router-dom';
import ChatPage from './pages/ChatPage';
import AdminPage from './pages/AdminPage';
import LoginPage from './pages/LoginPage';
import GalleryPage from './pages/GalleryPage';
import FaqPage from './pages/FaqPage';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<ChatPage />} />
      <Route path="/gallery" element={<GalleryPage />} />
      <Route path="/faq" element={<FaqPage />} />
      <Route path="/admin/login" element={<LoginPage />} />
      <Route path="/admin/*" element={<AdminPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
