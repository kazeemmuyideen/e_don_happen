import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { session } from '../lib/api.js';
import Logo from './Logo.jsx';

const NAV_LINKS = [
  { label: 'Home', to: '/#hero' },
  { label: 'How it works', to: '/#how-it-works' },
  { label: 'Features', to: '/#features' },
  { label: 'FAQ', to: '/#faq' },
];

function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);

  useEffect(() => {
    const handler = (event) => {
      event.preventDefault();
      setDeferredPrompt(event);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const install = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
  };

  return { canInstall: Boolean(deferredPrompt), install };
}

export default function Navbar() {
  const [open, setOpen] = useState(false);
  const menuButton = useRef(null);
  const { canInstall, install } = useInstallPrompt();
  const { pathname } = useLocation();
  const signedIn = Boolean(session());

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
        menuButton.current?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const close = () => setOpen(false);

  return (
    <header className="sticky top-0 z-40 border-b border-ink/10 bg-white/90 backdrop-blur">
      <nav className="container-app flex h-16 items-center justify-between" aria-label="Primary navigation">
        <Link to="/" onClick={close} aria-label="E don happen home">
          <Logo />
        </Link>

        <div className="hidden items-center gap-1 md:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              onClick={close}
              className="rounded-full px-3 py-2 text-sm font-medium text-ink-soft transition hover:bg-ink/5 hover:text-ink"
            >
              {link.label}
            </Link>
          ))}
        </div>

        <div className="hidden items-center gap-2 md:flex">
          {canInstall && (
            <button
              type="button"
              onClick={install}
              aria-label="Install E don happen app"
              className="btn-ghost text-sm"
            >
              Install app
            </button>
          )}
          {signedIn && (
            <NavLink to="/dashboard" className="btn-ghost text-sm">
              Dashboard
            </NavLink>
          )}
          {!signedIn && (
            <>
              <NavLink to="/login" className="btn-ghost text-sm">
                Login
              </NavLink>
              <NavLink to="/register" className="btn-primary text-sm">
                Sign up
              </NavLink>
            </>
          )}
        </div>

        <button
          ref={menuButton}
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-controls="mobile-menu"
          aria-expanded={open}
          aria-label={open ? 'Close navigation menu' : 'Open navigation menu'}
          className="grid size-10 place-items-center rounded-xl text-ink hover:bg-ink/5 md:hidden"
        >
          <svg
            viewBox="0 0 24 24"
            className="size-6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            {open ? (
              <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
            ) : (
              <path strokeLinecap="round" d="M4 7h16M4 12h16M4 17h16" />
            )}
          </svg>
        </button>
      </nav>

      <div
        id="mobile-menu"
        aria-label="Mobile navigation"
        className={`${open ? 'block' : 'hidden'} border-t border-ink/10 bg-white px-4 py-4 md:hidden`}
      >
        <div className="flex flex-col gap-1">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              onClick={close}
              className="rounded-xl px-3 py-3 text-sm font-medium text-ink-soft hover:bg-ink/5"
            >
              {link.label}
            </Link>
          ))}
        </div>
        <div className="mt-4 flex flex-col gap-2">
          {canInstall && (
            <button
              type="button"
              onClick={install}
              className="btn-outline w-full text-sm"
            >
              Install app
            </button>
          )}
          {signedIn && (
            <Link to="/dashboard" onClick={close} className="btn-outline">
              Dashboard
            </Link>
          )}
          {!signedIn && (
            <>
              <Link
                to="/login"
                onClick={close}
                className="btn-outline w-full text-sm"
              >
                Login
              </Link>
              <Link
                to="/register"
                onClick={close}
                className="btn-primary w-full text-sm"
              >
                Sign up
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
