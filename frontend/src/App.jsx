import { useEffect, useState } from 'react';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import Navbar from './components/Navbar.jsx';
import Footer from './components/Footer.jsx';
import Landing from './pages/Landing.jsx';
import Register from './pages/Register.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';

function NotFound() {
  return (
    <section className="container-app flex min-h-[60vh] flex-col items-center justify-center py-16 text-center">
      <p className="text-sm font-bold text-primary-dark">404</p>
      <h1 className="mt-3 text-3xl font-extrabold sm:text-4xl">
        Page not found
      </h1>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-ink-soft">
        That page does not exist or has moved. Head back to the home page to
        find your way.
      </p>
      <Link to="/" className="btn-primary mt-7">
        Back to home
      </Link>
    </section>
  );
}

export default function App() {
  const { hash, pathname } = useLocation();
  const [updateAvailable, setUpdateAvailable] = useState(
    () => Boolean(window.__PWA_UPDATE__),
  );

  useEffect(() => {
    const onUpdate = (event) => {
      if (typeof event.detail?.updateSW === 'function')
        window.__PWA_UPDATE__ = event.detail.updateSW;
      setUpdateAvailable(true);
    };
    window.addEventListener('app-update-available', onUpdate);
    return () => window.removeEventListener('app-update-available', onUpdate);
  }, []);

  useEffect(() => {
    if (!hash) return undefined;
    const id = decodeURIComponent(hash.slice(1));
    let secondFrame;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        document
          .getElementById(id)
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      if (secondFrame) cancelAnimationFrame(secondFrame);
    };
  }, [hash, pathname]);

  function applyUpdate() {
    const update = window.__PWA_UPDATE__;
    setUpdateAvailable(false);
    if (typeof update === 'function') update();
    else window.location.reload();
  }

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-ink focus:px-4 focus:py-2 focus:text-sm focus:font-bold focus:text-white"
      >
        Skip to main content
      </a>
      <Navbar />
      <main id="main-content" tabIndex={-1} className="flex-1">
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/register" element={<Register />} />
          <Route path="/login" element={<Login />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <Footer />
      {updateAvailable && (
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-md items-center justify-between gap-4 rounded-2xl border border-ink/10 bg-white p-4 shadow-lg"
        >
          <p className="text-sm font-medium">
            A new version is ready. Reload when you are ready.
          </p>
          <button type="button" onClick={applyUpdate} className="btn-primary shrink-0">
            Reload
          </button>
        </div>
      )}
    </div>
  );
}
