import { Routes, Route, NavLink, useLocation } from 'react-router-dom';
import Tokens from './pages/Tokens';
import Feed from './pages/Feed';
import Launch from './pages/Launch';
import Fees from './pages/Fees';
import Profile from './pages/Profile';
import Coin from './pages/Coin';
import XCallback from './pages/XCallback';

/**
 * Trends Mini — the X-embeddable terminal. Phone-width shell with a 5-tab footer
 * (Tokens | Feed | LAUNCH | Fees | Profile) mirroring the browser terminal's
 * surfaces. /embed/:mint renders the compact coin view with NO footer — that
 * route is the twitter:player iframe target.
 */
export default function App() {
  const { pathname } = useLocation();
  const isEmbed = pathname.startsWith('/embed/') || pathname === '/x-callback';

  return (
    <div className={isEmbed ? 'shell embed' : 'shell'}>
      <main className="content">
        <Routes>
          <Route path="/" element={<Tokens />} />
          <Route path="/feed" element={<Feed />} />
          <Route path="/launch" element={<Launch />} />
          <Route path="/fees" element={<Fees />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/t/:mint" element={<Coin />} />
          <Route path="/embed/:mint" element={<Coin embed />} />
          <Route path="/x-callback" element={<XCallback />} />
          <Route path="*" element={<Tokens />} />
        </Routes>
      </main>

      {!isEmbed && (
        <nav className="footer">
          <NavLink to="/" end className={({ isActive }) => 'tab' + (isActive ? ' active' : '')}>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 17l5-5 4 3 6-7 3 3" /><path d="M3 21h18" /></svg>
            <span>Tokens</span>
          </NavLink>
          <NavLink to="/feed" className={({ isActive }) => 'tab' + (isActive ? ' active' : '')}>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
            <span>Feed</span>
          </NavLink>
          <NavLink to="/launch" className="tab launch-tab">
            <span className="launch-btn">
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#000" strokeWidth="2.4"><path d="M12 19V5" /><path d="M5 12l7-7 7 7" /></svg>
            </span>
            <span>Launch</span>
          </NavLink>
          <NavLink to="/fees" className={({ isActive }) => 'tab' + (isActive ? ' active' : '')}>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 7v10M15.5 9.5c-.6-1-1.9-1.5-3.5-1.5-1.8 0-3 .9-3 2.2 0 2.9 7 1.6 7 4.5 0 1.4-1.4 2.3-3.5 2.3-1.8 0-3.2-.7-3.8-1.8" /></svg>
            <span>Fees</span>
          </NavLink>
          <NavLink to="/profile" className={({ isActive }) => 'tab' + (isActive ? ' active' : '')}>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></svg>
            <span>Profile</span>
          </NavLink>
        </nav>
      )}
    </div>
  );
}
