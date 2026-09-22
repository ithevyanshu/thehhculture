import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from './auth/AuthContext';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { Wordmark } from './components/Wordmark';
import { HomePage } from './pages/HomePage';
import { ArtistsPage } from './pages/ArtistsPage';
import { ArtistPage } from './pages/ArtistPage';
import { SongsPage } from './pages/SongsPage';
import { SongPage } from './pages/SongPage';
import { AlbumPage } from './pages/AlbumPage';
import { SearchPage } from './pages/SearchPage';
import { ScenesPage } from './pages/ScenesPage';
import { ShowPage, ShowsPage } from './pages/ShowsPage';
import { EventsPage } from './pages/EventsPage';
import { EventPage } from './pages/EventPage';
import { LoginPage, RegisterPage } from './pages/AuthPages';
import { OnboardingPage } from './pages/TastePicker';
import { LibraryPage } from './pages/LibraryPage';
import { PlaylistPage } from './pages/PlaylistPage';
import { SettingsPage } from './pages/SettingsPage';
import { AdminPage } from './pages/admin/AdminPage';
import { ChangePasswordPage } from './pages/ChangePasswordPage';
import { StudioPage } from './pages/StudioPage';
import { isStaff } from './lib/permissions';

function RequireAuth({ children, staff }: { children: ReactNode; staff?: boolean }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  if (staff && !isStaff(user)) return <Navigate to="/" replace />;
  return children;
}

function NotFound() {
  return (
    <div className="py-24 text-center">
      <p className="display text-8xl text-saffron">404</p>
      <p className="mt-3 text-muted">This page dropped off the tracklist.</p>
    </div>
  );
}

export default function App() {
  const { loading } = useAuth();
  // Wait for session restore so personalised queries use the right identity.
  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Wordmark className="animate-pulse text-4xl md:text-5xl" />
      </div>
    );
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="artists" element={<ArtistsPage />} />
        <Route path="artists/:slug" element={<ArtistPage />} />
        <Route path="songs" element={<SongsPage />} />
        <Route path="songs/:slug" element={<SongPage />} />
        <Route path="albums/:slug" element={<AlbumPage />} />
        <Route path="search" element={<SearchPage />} />
        <Route path="scenes" element={<ScenesPage />} />
        <Route path="shows" element={<ShowsPage />} />
        <Route path="shows/:slug" element={<ShowPage />} />
        <Route path="events" element={<EventsPage />} />
        <Route path="events/:slug" element={<EventPage />} />
        <Route path="playlists/:id" element={<PlaylistPage />} />
        <Route path="login" element={<LoginPage />} />
        <Route path="register" element={<RegisterPage />} />
        <Route path="onboarding" element={<RequireAuth><OnboardingPage /></RequireAuth>} />
        <Route path="library" element={<RequireAuth><LibraryPage /></RequireAuth>} />
        <Route path="settings" element={<RequireAuth><SettingsPage /></RequireAuth>} />
        <Route path="admin" element={<RequireAuth staff><AdminPage /></RequireAuth>} />
        <Route path="change-password" element={<RequireAuth><ChangePasswordPage /></RequireAuth>} />
        <Route path="studio" element={<RequireAuth><StudioPage /></RequireAuth>} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
