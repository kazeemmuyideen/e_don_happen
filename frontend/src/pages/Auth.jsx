import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { api, saveSession } from '../lib/api.js';
import { restorePushForCurrentUser } from '../lib/push.js';
import { AREAS, CATEGORIES } from '../data/areas.js';

const OTP_WINDOW_MS = 15 * 60 * 1000;
const OTP_REQUEST_LIMIT = 3;
const field =
  'mt-2 w-full rounded-xl border border-ink/20 bg-white px-4 py-3 outline-none focus:ring-2 focus:ring-primary';
const emptyErrors = { phone: '', name: '', consent: '', otp: '' };

function inputClass(error) {
  return `${field}${error ? ' border-red-500 focus:ring-red-500' : ''}`;
}

function normalizePhone(value) {
  const cleaned = value.trim().replace(/[\s()-]/g, '');
  if (/^\+[1-9]\d{7,14}$/.test(cleaned)) return cleaned;
  if (/^0\d{10}$/.test(cleaned)) return `+234${cleaned.slice(1)}`;
  if (/^234\d{10}$/.test(cleaned)) return `+${cleaned}`;
  return cleaned;
}

function maskPhone(value) {
  const match = value.match(/^(\+\d{1,3})(\d+)$/);
  if (!match) return value;
  const [, code, rest] = match;
  return `${code}${'•'.repeat(Math.max(rest.length - 4, 0))}${rest.slice(-4)}`;
}

function formatCountdown(seconds) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

export default function Auth({ register = false }) {
  const navigate = useNavigate();
  const { search } = useLocation();
  const [phone, setPhone] = useState('');
  const [targetPhone, setTargetPhone] = useState('');
  const [name, setName] = useState('');
  const [consent, setConsent] = useState(false);
  const [area, setArea] = useState('Yaba');
  const [otp, setOtp] = useState('');
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState({ ...emptyErrors });
  const [deliveryMessage, setDeliveryMessage] = useState('');
  const [requestCount, setRequestCount] = useState(0);
  const [windowEndsAt, setWindowEndsAt] = useState(null);
  const [now, setNow] = useState(Date.now());
  const phoneRef = useRef(null);
  const otpRef = useRef(null);

  const remainingSeconds = windowEndsAt
    ? Math.max(0, Math.ceil((windowEndsAt - now) / 1000))
    : 0;
  const resendBlocked = remainingSeconds > 0 && requestCount >= OTP_REQUEST_LIMIT;

  useEffect(() => {
    if (!windowEndsAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [windowEndsAt]);

  useEffect(() => {
    if (windowEndsAt && now >= windowEndsAt) {
      setWindowEndsAt(null);
      setRequestCount(0);
    }
  }, [now, windowEndsAt]);

  useEffect(() => {
    if (sent) otpRef.current?.focus();
  }, [sent, requestCount]);

  function clearField(key) {
    setErrors((current) => ({ ...current, [key]: '' }));
    setError('');
  }

  function resetFlow() {
    setPhone('');
    setTargetPhone('');
    setName('');
    setConsent(false);
    setOtp('');
    setSent(false);
    setError('');
    setErrors({ ...emptyErrors });
    setDeliveryMessage('');
    setRequestCount(0);
    setWindowEndsAt(null);
    setNow(Date.now());
  }

  function changeNumber() {
    setTargetPhone('');
    setOtp('');
    setSent(false);
    setError('');
    setErrors({ ...emptyErrors });
    setDeliveryMessage('');
  }

  function noteSend() {
    const current = Date.now();
    setNow(current);
    if (!windowEndsAt || windowEndsAt <= current) {
      setRequestCount(1);
      setWindowEndsAt(current + OTP_WINDOW_MS);
    } else {
      setRequestCount((count) => Math.min(count + 1, OTP_REQUEST_LIMIT));
    }
  }

  function noteRateLimit() {
    const current = Date.now();
    setNow(current);
    setRequestCount(OTP_REQUEST_LIMIT);
    setWindowEndsAt(current + OTP_WINDOW_MS);
  }

  async function sendCode(event) {
    event?.preventDefault();
    if (sending || verifying) return;
    const normalized = normalizePhone(targetPhone || phone);
    const nextErrors = { ...emptyErrors };
    if (!/^\+[1-9]\d{7,14}$/.test(normalized))
      nextErrors.phone =
        'Enter a phone number such as 08012345678 or +2348012345678.';
    if (register) {
      if (name.trim().length < 2)
        nextErrors.name = 'Enter a display name of at least 2 characters.';
      if (!consent)
        nextErrors.consent = 'Acknowledge the local demo notice to continue.';
    }
    if (Object.values(nextErrors).some(Boolean)) {
      setErrors(nextErrors);
      setError('');
      if (nextErrors.phone) phoneRef.current?.focus();
      return;
    }
    setErrors({ ...emptyErrors });
    setError('');
    setSending(true);
    try {
      const result = await api('/auth/send-otp', {
        method: 'POST',
        body: { phone: normalized },
      });
      setTargetPhone(normalized);
      setDeliveryMessage(result?.message || 'Verification code requested.');
      setSent(true);
      setOtp('');
      noteSend();
    } catch (err) {
      if (/too many|15 minutes/i.test(err.message)) noteRateLimit();
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  async function verifyCode(code = otp) {
    if (sending || verifying) return;
    const value = String(code || '').replace(/\D/g, '').slice(0, 6);
    setError('');
    if (!/^\d{6}$/.test(value)) {
      setOtp(value);
      setErrors((current) => ({
        ...current,
        otp: 'Enter the six-digit code from your verification message.',
      }));
      otpRef.current?.focus();
      return;
    }
    setErrors((current) => ({ ...current, otp: '' }));
    setVerifying(true);
    try {
      const result = await api('/auth/verify-otp', {
        method: 'POST',
        body: { phone: targetPhone, otp: value },
      });
      if (register) {
        const auth = {
          headers: { Authorization: `Bearer ${result.accessToken}` },
        };
        await api(
          '/auth/profile',
          {
            method: 'PUT',
            body: { displayName: name.trim(), lgas: [area] },
            ...auth,
          },
          false,
        );
        await Promise.all(
          CATEGORIES.map((category) =>
            api(
              '/notifications/subscriptions',
              {
                method: 'POST',
                body: {
                  category,
                  areaOrRadius: 5,
                  ...AREAS[area],
                  priorityThreshold: 'normal',
                },
                ...auth,
              },
              false,
            ),
          ),
        );
      }
      saveSession(result);
      await restorePushForCurrentUser().catch(() => {});
      navigate(`/dashboard${search}`);
    } catch (err) {
      setError(err.message);
      setErrors((current) => ({ ...current, otp: err.message }));
      setOtp('');
      otpRef.current?.focus();
    } finally {
      setVerifying(false);
    }
  }

  function handleOtpChange(event) {
    const digits = event.target.value.replace(/\D/g, '').slice(0, 6);
    setOtp(digits);
    clearField('otp');
    if (digits.length === 6) void verifyCode(digits);
  }

  async function resend() {
    if (resendBlocked || sending || verifying) return;
    setErrors({ ...emptyErrors });
    await sendCode();
  }

  return (
    <section className="bg-primary-soft py-14 sm:py-20">
      <div className="container-app max-w-lg">
        <p className="text-sm font-bold text-primary-dark">
          E don happen · Lagos pilot
        </p>
        <h1 className="mt-3 text-4xl font-extrabold">
          {register ? 'Join your neighbourhood' : 'Welcome back'}
        </h1>
        <p className="mt-3 text-ink-soft">
          Phone verification connects you to the real local feed.
        </p>
        {!register && (
          <div className="mt-5 flex flex-wrap gap-2">
            {[
              ['Ada', '1'],
              ['Tunde', '2'],
              ['Zainab', '3'],
              ['Moderator', '4'],
            ].map(([label, id]) => (
              <button
                type="button"
                key={id}
                className="rounded-full border border-ink/15 bg-white px-3 py-2 text-xs font-semibold"
                onClick={() => {
                  resetFlow();
                  setPhone(`+234800000000${id}`);
                }}
              >
                {label} | sample account
              </button>
            ))}
          </div>
        )}
        <div className="mt-8 space-y-5 rounded-3xl border border-ink/10 bg-white p-7 shadow-xl">
          {!sent ? (
            <form onSubmit={sendCode} className="space-y-5" noValidate>
              <p className="text-xs font-bold uppercase tracking-wider text-primary-dark">
                Step 1 of 2 · Send verification code
              </p>
              {register && (
                <>
                  <label className="block text-sm font-semibold">
                    Display name
                    <input
                      className={inputClass(errors.name)}
                      required
                      minLength={2}
                      maxLength={100}
                      value={name}
                      onChange={(e) => {
                        setName(e.target.value);
                        clearField('name');
                      }}
                      aria-invalid={Boolean(errors.name)}
                      aria-describedby={errors.name ? 'auth-name-error' : undefined}
                    />
                    {errors.name && (
                      <p
                        id="auth-name-error"
                        role="alert"
                        className="mt-1 text-xs font-normal text-red-700"
                      >
                        {errors.name}
                      </p>
                    )}
                  </label>
                  <label className="block text-sm font-semibold">
                    Your area
                    <select
                      className={field}
                      value={area}
                      onChange={(e) => setArea(e.target.value)}
                    >
                      {Object.keys(AREAS).map((a) => (
                        <option key={a}>{a}</option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              <label className="block text-sm font-semibold">
                Phone number
                <input
                  ref={phoneRef}
                  autoFocus
                  className={inputClass(errors.phone)}
                  required
                  type="tel"
                  autoComplete="tel"
                  placeholder="08012345678"
                  value={phone}
                  onChange={(e) => {
                    setPhone(e.target.value);
                    clearField('phone');
                  }}
                  disabled={sending}
                  aria-invalid={Boolean(errors.phone)}
                  aria-describedby={
                    errors.phone ? 'auth-phone-error' : 'auth-phone-help'
                  }
                />
                {errors.phone ? (
                  <p
                    id="auth-phone-error"
                    role="alert"
                    className="mt-1 text-xs font-normal text-red-700"
                  >
                    {errors.phone}
                  </p>
                ) : (
                  <p id="auth-phone-help" className="mt-1 text-xs font-normal text-ink-soft">
                    Local or +234 numbers work; spaces and dashes are ignored.
                  </p>
                )}
              </label>
              {register && (
                <label className="flex gap-2 text-xs leading-relaxed text-ink-soft">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => {
                      setConsent(e.target.checked);
                      clearField('consent');
                    }}
                    aria-invalid={Boolean(errors.consent)}
                    aria-describedby={
                      errors.consent ? 'auth-consent-error' : undefined
                    }
                  />
                  I understand this is a local demonstration. Reports are community
                  observations and are not guaranteed facts.
                  {errors.consent && (
                    <span
                      id="auth-consent-error"
                      role="alert"
                      className="block text-red-700"
                    >
                      {errors.consent}
                    </span>
                  )}
                </label>
              )}
              {error && (
                <p
                  role="alert"
                  className="rounded-xl bg-red-50 p-3 text-sm text-red-700"
                >
                  {error}
                </p>
              )}
              <button className="btn-primary w-full" disabled={sending || resendBlocked}>
                {sending
                  ? 'Sending code…'
                  : resendBlocked
                    ? `Try again in ${formatCountdown(remainingSeconds)}`
                    : 'Send verification code'}
              </button>
              {remainingSeconds > 0 && (
                <p role="status" className="text-center text-xs text-ink-soft">
                  {OTP_REQUEST_LIMIT} requests allowed per 15 minutes.{' '}
                  {Math.max(0, OTP_REQUEST_LIMIT - requestCount)} left · window resets
                  in {formatCountdown(remainingSeconds)}.
                </p>
              )}
            </form>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void verifyCode();
              }}
              className="space-y-5"
              noValidate
            >
              <p className="text-xs font-bold uppercase tracking-wider text-primary-dark">
                Step 2 of 2 · Verify code
              </p>
              <p
                role="status"
                className="rounded-xl bg-primary-soft p-4 text-sm"
              >
                <strong>Code sent to {maskPhone(targetPhone)}.</strong>{' '}
                {deliveryMessage}
              </p>
              <label className="block text-sm font-semibold">
                Six-digit code
                <input
                  ref={otpRef}
                  autoFocus
                  className={inputClass(errors.otp)}
                  required
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={otp}
                  onChange={handleOtpChange}
                  disabled={verifying}
                  aria-invalid={Boolean(errors.otp)}
                  aria-describedby={errors.otp ? 'auth-otp-error' : 'auth-otp-help'}
                />
                {errors.otp ? (
                  <p
                    id="auth-otp-error"
                    role="alert"
                    className="mt-1 text-xs font-normal text-red-700"
                  >
                    {errors.otp}
                  </p>
                ) : (
                  <p id="auth-otp-help" className="mt-1 text-xs font-normal text-ink-soft">
                    The code expires after 5 minutes. It submits automatically when
                    all six digits are entered.
                  </p>
                )}
              </label>
              {error && (
                <p
                  role="alert"
                  className="rounded-xl bg-red-50 p-3 text-sm text-red-700"
                >
                  {error}
                </p>
              )}
              <button className="btn-primary w-full" disabled={verifying || sending}>
                {verifying ? 'Verifying…' : 'Verify code'}
              </button>
              <div className="flex flex-wrap justify-center gap-4 text-sm">
                <button
                  type="button"
                  className="font-bold text-primary-dark underline disabled:cursor-not-allowed disabled:text-ink-soft"
                  disabled={resendBlocked || sending || verifying}
                  onClick={resend}
                >
                  {resendBlocked
                    ? `Resend in ${formatCountdown(remainingSeconds)}`
                    : sending
                      ? 'Sending code…'
                      : 'Resend code'}
                </button>
                <button
                  type="button"
                  className="underline"
                  disabled={sending || verifying}
                  onClick={changeNumber}
                >
                  Change number
                </button>
              </div>
              <p role="status" className="text-center text-xs text-ink-soft">
                {resendBlocked
                  ? `Maximum ${OTP_REQUEST_LIMIT} requests reached. Resend opens when the 15-minute window resets in ${formatCountdown(remainingSeconds)}.`
                  : `${Math.max(0, OTP_REQUEST_LIMIT - requestCount)} of ${OTP_REQUEST_LIMIT} code requests left in this 15-minute window${
                      remainingSeconds
                        ? ` (${formatCountdown(remainingSeconds)} remaining)`
                        : ''
                    }.`}
              </p>
            </form>
          )}
          <p className="text-center text-sm text-ink-soft">
            {register ? 'Already joined? ' : 'New here? '}
            <Link
              className="font-bold text-primary-dark"
              to={register ? '/login' : '/register'}
            >
              {register ? 'Sign in' : 'Create an account'}
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}
