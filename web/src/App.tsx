import { useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation, useSearchParams } from 'react-router-dom';
import { LIBRARY_CHANGED, api } from './api';
import { SessionProvider, useSession } from './session';
import { Auth } from './pages/Auth';
import { Library } from './pages/Library';
import { Discover } from './pages/Discover';
import { Friends, FriendLibrary } from './pages/Friends';
import { Data } from './pages/Data';
import { Settings } from './pages/Settings';
import { MEDIA_ICONS, MEDIA_LABELS, MEDIA_TYPES, type Stats } from './types';

function Sidebar() {
  const { me, signOut } = useSession();
  const [stats, setStats] = useState<Stats | null>(null);
  const [pending, setPending] = useState(0);
  const location = useLocation();
  const [params] = useSearchParams();

  // NavLink matches on pathname alone, so the collection links — which differ
  // only by ?type= — would all light up at once. Decide those ourselves.
  const onLibrary = location.pathname === '/';
  const activeType = onLibrary ? params.get('type') : null;
  const showingRemoved = onLibrary && params.get('deleted') === '1';

  // Re-read on navigation, and whenever something changed the library.
  useEffect(() => {
    const load = () => {
      void api.stats().then((response) => setStats(response.stats)).catch(() => undefined);
      void api
        .friends()
        .then((response) => setPending(response.requests.incoming.length))
        .catch(() => undefined);
    };
    load();
    window.addEventListener(LIBRARY_CHANGED, load);
    return () => window.removeEventListener(LIBRARY_CHANGED, load);
  }, [location.key]);

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">◎</span>
        <span>Open Library</span>
      </div>

      <nav className="nav">
        <Link to="/" className={onLibrary && !activeType && !showingRemoved ? 'active' : ''}>
          <span>All items</span>
          <span className="count">{stats?.total ?? ''}</span>
        </Link>
        <NavLink to="/discover">Find something</NavLink>

        <div className="nav-label">Collections</div>
        {MEDIA_TYPES.map((type) => (
          <Link key={type} to={`/?type=${type}`} className={activeType === type ? 'active' : ''}>
            <span>
              {MEDIA_ICONS[type]} {MEDIA_LABELS[type]}
            </span>
            <span className="count">{stats?.byMediaType[type] ?? ''}</span>
          </Link>
        ))}

        <div className="nav-label">Yours to keep</div>
        <NavLink to="/data">Sync &amp; backup</NavLink>
        <NavLink to="/friends">
          <span>Friends</span>
          {pending > 0 ? <span className="count">{pending} new</span> : null}
        </NavLink>
        <NavLink to="/settings">Settings</NavLink>
      </nav>

      <div className="sidebar-footer">
        <div style={{ fontWeight: 600 }}>{me?.displayName}</div>
        <div className="muted-note">@{me?.handle}</div>
        <button className="btn ghost small" style={{ marginTop: 8 }} onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    </aside>
  );
}

function Shell() {
  const { me, loading } = useSession();

  if (loading) {
    return (
      <div className="auth-shell">
        <span className="spinner" />
      </div>
    );
  }

  if (!me) return <Auth />;

  return (
    <div className="app">
      <Sidebar />
      <main className="main">
        <Routes>
          <Route path="/" element={<Library />} />
          <Route path="/discover" element={<Discover />} />
          <Route path="/friends" element={<Friends />} />
          <Route path="/friends/:handle" element={<FriendLibrary />} />
          <Route path="/data" element={<Data />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export function App() {
  return (
    <SessionProvider>
      <Shell />
    </SessionProvider>
  );
}
