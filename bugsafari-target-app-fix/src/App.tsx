import { Link, Route, Routes } from 'react-router-dom';
import { SCENARIOS } from './scenarios/registry';
import Home from './pages/Home';

export default function App() {
  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">🦁 BugSafari Target</Link>
        <span className="tagline">deterministic benchmark for every detected bug class</span>
      </header>
      <main className="content">
        <Routes>
          <Route path="/" element={<Home />} />
          {SCENARIOS.map((s) => (
            <Route key={s.slug} path={`/${s.slug}`} element={<s.component />} />
          ))}
          <Route path="*" element={<Home />} />
        </Routes>
      </main>
    </div>
  );
}
