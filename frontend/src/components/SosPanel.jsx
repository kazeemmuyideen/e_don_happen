import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { AREAS } from '../data/areas.js';

const field =
  'w-full rounded-xl border border-ink/15 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary';
const panel = 'rounded-3xl border border-ink/10 bg-white p-5 shadow-sm sm:p-6';
const TYPES = ['medical', 'fire', 'security', 'utilities', 'other'];
const OPEN = ['active', 'acknowledged'];
const CHANNEL_OPTIONS = {
  in_app: ['in_app'],
  sms: ['sms'],
  both: ['in_app', 'sms'],
};

function Skeleton({ className }) {
  return (
    <div
      aria-hidden
      className={`animate-pulse rounded-xl bg-ink/10 ${className}`}
    />
  );
}

function when(value) {
  return new Date(value).toLocaleString('en-NG', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Africa/Lagos',
  });
}

function mapLink(sos) {
  const coordinates = sos.location?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length !== 2) return null;
  return `https://www.google.com/maps?q=${coordinates[1]},${coordinates[0]}`;
}

export default function SosPanel({ area, profile, focusSosId }) {
  const [mine, setMine] = useState([]);
  const [assigned, setAssigned] = useState([]);
  const [type, setType] = useState('medical');
  const [message, setMessage] = useState('');
  const [locationLabel, setLocationLabel] = useState('');
  const [place, setPlace] = useState(area);
  const [escalationEnabled, setEscalationEnabled] = useState(false);
  const [maxLevels, setMaxLevels] = useState('2');
  const [channels, setChannels] = useState('in_app');
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [noticeTone, setNoticeTone] = useState('ok');
  const [focusNotice, setFocusNotice] = useState('');
  const focusHandled = useRef('');

  useEffect(() => {
    setPlace(area);
  }, [area]);

  const load = useCallback(async () => {
    const [myRequests, dispatched] = await Promise.all([
      api('/sos/mine'),
      api('/sos/assigned'),
    ]);
    setMine(Array.isArray(myRequests) ? myRequests : []);
    setAssigned(Array.isArray(dispatched) ? dispatched : []);
  }, []);

  useEffect(() => {
    let active = true;
    load()
      .then(() => {
        if (active) setLoading(false);
      })
      .catch((err) => {
        if (active) {
          setError(err.message);
          setLoading(false);
        }
      });
    const timer = setInterval(() => {
      setPending((current) => ({ ...current, refresh: true }));
      load()
        .catch((err) => {
          if (active) setError(err.message);
        })
        .finally(() => {
          if (!active) return;
          setPending((current) => {
            const next = { ...current };
            delete next.refresh;
            return next;
          });
        });
    }, 20000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [load]);

  useEffect(() => {
    if (!focusSosId || loading) return;
    if (focusHandled.current === focusSosId) return;
    setFocusNotice('');
    const node = document.getElementById(`sos-${focusSosId}`);
    focusHandled.current = focusSosId;
    if (node) {
      node.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    let active = true;
    api(`/sos/${encodeURIComponent(focusSosId)}`)
      .then((sos) => {
        if (!active) return;
        setFocusNotice(
          OPEN.includes(sos.state)
            ? `This SOS is still ${sos.state}, but it is not in your current lists. Check with the requester or your community admin.`
            : `This SOS is already ${sos.state}. Closed signals are not shown in the open lists.`,
        );
      })
      .catch((err) => {
        if (!active) return;
        setFocusNotice(
          /not found/i.test(err.message)
            ? 'This SOS link could not be found. It may have expired or been removed.'
            : `This SOS is not available to your account. ${err.message}`,
        );
      });
    return () => {
      active = false;
    };
  }, [focusSosId, loading, mine, assigned]);

  async function run(key, work, success, tone = 'ok') {
    setPending((current) => ({ ...current, [key]: true }));
    setError('');
    setNotice('');
    try {
      const result = await work();
      await load();
      const message =
        typeof success === 'function' ? success(result) : success;
      const nextTone = typeof tone === 'function' ? tone(result) : tone;
      if (message) {
        setNotice(message);
        setNoticeTone(nextTone);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setPending((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
  }

  async function raise(event) {
    event.preventDefault();
    await run(
      'send',
      async () => {
        const result = await api('/sos', {
          method: 'POST',
          body: {
            incidentType: type,
            ...AREAS[place],
            ...(message.trim() ? { message: message.trim() } : {}),
            ...(locationLabel.trim()
              ? { locationLabel: locationLabel.trim() }
              : {}),
            ...(escalationEnabled
              ? {
                  escalationPolicy: {
                    maxLevels: Number(maxLevels),
                    channels: CHANNEL_OPTIONS[channels],
                  },
                }
              : {}),
          },
        });
        setMessage('');
        setLocationLabel('');
        return result;
      },
      (result) => {
        const count = result?.recipientCount ?? 0;
        return count > 0
          ? `SOS sent. ${count} responder${count === 1 ? '' : 's'} and the community admin were notified.`
          : 'SOS saved, but no responder covers this area right now. Contact neighbours and local help directly.';
      },
      (result) => ((result?.recipientCount ?? 0) > 0 ? 'ok' : 'warn'),
    );
  }

  const openMine = mine.filter((sos) => OPEN.includes(sos.state));
  const openAssigned = assigned.filter((sos) => OPEN.includes(sos.state));
  const stateKey = (id, state) => `state:${id}:${state}`;
  const ackKey = (id) => `ack:${id}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 rounded-2xl border-2 border-red-700 bg-red-700 px-4 py-4 text-white sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-base font-black">
            If someone is in immediate danger, call local emergency services now.
          </p>
          <p className="mt-1 text-sm text-red-50">
            Demo SOS only alerts registered responders and the community admin in
            this app. It does not call police, fire or ambulance services.
          </p>
        </div>
        <a
          href="tel:112"
          className="inline-flex shrink-0 items-center justify-center rounded-full bg-white px-5 py-2.5 text-sm font-black text-red-700 hover:bg-red-50"
        >
          Call 112
        </a>
      </div>
      {error && (
        <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className={`rounded-xl border p-3 text-sm ${
            noticeTone === 'warn'
              ? 'border-amber-300 bg-amber-50 text-amber-900'
              : 'border-green-200 bg-white text-green-800'
          }`}
        >
          {notice}
        </p>
      )}
      {focusNotice && (
        <p
          role="status"
          className="rounded-xl border border-ink/15 bg-primary-soft p-3 text-sm"
        >
          {focusNotice}
        </p>
      )}
      <form onSubmit={raise} className={`${panel} space-y-4`}>
        <div>
          <h2 className="text-xl font-bold">Raise an SOS around {place}</h2>
          <p className="mt-2 text-sm text-ink-soft">
            Your display name, message and approximate location are shared with
            dispatched responders. Keep the message short and factual.
          </p>
        </div>
        <label className="block text-sm font-bold">
          Area
          <select
            aria-label="SOS area"
            className={`${field} mt-2`}
            value={place}
            onChange={(e) => setPlace(e.target.value)}
          >
            {Object.keys(AREAS).map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-bold">
          Type of emergency
          <select
            className={`${field} mt-2 capitalize`}
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-bold">
          Landmark{' '}
          <span className="font-normal text-ink-soft">(optional)</span>
          <input
            className={`${field} mt-2`}
            maxLength={200}
            value={locationLabel}
            onChange={(e) => setLocationLabel(e.target.value)}
            placeholder="For example: Market gate on Herbert Macaulay Way"
          />
        </label>
        <label className="block text-sm font-bold">
          Message <span className="font-normal text-ink-soft">(optional)</span>
          <textarea
            className={`${field} mt-2 min-h-20`}
            maxLength={500}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="For example: Someone collapsed near the market gate."
          />
        </label>
        <fieldset className="rounded-2xl border border-ink/10 p-3">
          <legend className="px-1 text-sm font-bold">
            Escalation policy (optional)
          </legend>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={escalationEnabled}
              onChange={(e) => setEscalationEnabled(e.target.checked)}
            />
            Escalate if responders do not acknowledge
          </label>
          {escalationEnabled && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="block text-sm font-bold">
                Maximum levels
                <select
                  className={`${field} mt-2`}
                  value={maxLevels}
                  onChange={(e) => setMaxLevels(e.target.value)}
                >
                  {[1, 2, 3, 4, 5].map((level) => (
                    <option key={level} value={level}>
                      {level}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-bold">
                Channels
                <select
                  className={`${field} mt-2`}
                  value={channels}
                  onChange={(e) => setChannels(e.target.value)}
                >
                  <option value="in_app">In-app</option>
                  <option value="sms">SMS</option>
                  <option value="both">In-app and SMS</option>
                </select>
              </label>
            </div>
          )}
          <p className="mt-3 text-xs leading-relaxed text-ink-soft">
            Escalation is best-effort. In-app alerts only reach responders
            registered here; SMS needs a configured provider and may be
            unavailable.
          </p>
          {escalationEnabled && channels !== 'in_app' && (
            <p
              role="status"
              className="mt-2 rounded-xl border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900"
            >
              SMS delivery is not guaranteed. In-app alerts still apply when a
              provider is unavailable.
            </p>
          )}
        </fieldset>
        <button
          className="btn-primary bg-red-600 hover:bg-red-700"
          disabled={Boolean(pending.send)}
        >
          {pending.send ? 'Sending SOS…' : 'Send SOS'}
        </button>
      </form>

      <section className={`${panel} space-y-4`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-bold">Your open signals</h2>
          <button
            className="btn-outline"
            disabled={Boolean(pending.refresh)}
            onClick={() => run('refresh', async () => {})}
          >
            {pending.refresh ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        {loading ? (
          <div role="status" aria-live="polite" className="space-y-3">
            <p className="text-sm text-ink-soft">Loading your SOS requests…</p>
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
        ) : openMine.length ? (
          openMine.map((sos) => (
            <article
              key={sos.id}
              id={`sos-${sos.id}`}
              className="rounded-2xl border border-red-200 p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-bold capitalize">{sos.incidentType}</h3>
                <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-bold capitalize text-red-800">
                  {sos.state}
                </span>
              </div>
              {sos.message && <p className="mt-2 text-sm">{sos.message}</p>}
              {sos.locationLabel && (
                <p className="mt-1 text-xs text-ink-soft">
                  Landmark: {sos.locationLabel}
                </p>
              )}
              <p className="mt-2 text-xs text-ink-soft">
                Raised {when(sos.createdAt)} | {sos.recipientCount || 0}{' '}
                responder{(sos.recipientCount || 0) === 1 ? '' : 's'} notified
              </p>
              {sos.recipientCount === 0 && (
                <p className="mt-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-900">
                  No responder or community admin covers this area. Nobody has
                  been notified in the app. Call local help directly if this is
                  urgent.
                </p>
              )}
              {sos.recipients?.length > 0 && (
                <ul className="mt-2 text-xs text-ink-soft">
                  {sos.recipients.map((r) => (
                    <li key={r.recipientId}>
                      {r.displayName || 'Responder'} | {r.role} |{' '}
                      {r.acknowledgementState}
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  className="btn-outline"
                  disabled={Boolean(pending[stateKey(sos.id, 'resolved')])}
                  onClick={() =>
                    run(
                      stateKey(sos.id, 'resolved'),
                      () =>
                        api(`/sos/${sos.id}/state`, {
                          method: 'PUT',
                          body: {
                            state: 'resolved',
                            reason: 'Resolved in app',
                          },
                        }),
                      'SOS marked resolved.',
                    )
                  }
                >
                  {pending[stateKey(sos.id, 'resolved')]
                    ? 'Resolving…'
                    : 'Mark resolved'}
                </button>
                <button
                  className="btn-outline text-red-700"
                  disabled={Boolean(pending[stateKey(sos.id, 'cancelled')])}
                  onClick={() =>
                    run(
                      stateKey(sos.id, 'cancelled'),
                      () =>
                        api(`/sos/${sos.id}/state`, {
                          method: 'PUT',
                          body: {
                            state: 'cancelled',
                            reason: 'Cancelled in app',
                          },
                        }),
                      'SOS cancelled. Responders were told it is closed.',
                    )
                  }
                >
                  {pending[stateKey(sos.id, 'cancelled')]
                    ? 'Cancelling…'
                    : 'Cancel SOS'}
                </button>
              </div>
            </article>
          ))
        ) : (
          <p className="py-6 text-center text-sm text-ink-soft">
            You have no open SOS requests. Use the form above if you still need
            in-app help.
          </p>
        )}
      </section>

      <section className={`${panel} space-y-4`}>
        <h2 className="text-xl font-bold">Dispatched to you</h2>
        {loading ? (
          <div role="status" aria-live="polite" className="space-y-3">
            <p className="text-sm text-ink-soft">Loading assigned SOS requests…</p>
            <Skeleton className="h-24" />
          </div>
        ) : openAssigned.length ? (
          openAssigned.map((sos) => {
            const link = mapLink(sos);
            return (
              <article
                key={sos.id}
                id={`sos-${sos.id}`}
                className="rounded-2xl border border-ink/10 p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-bold capitalize">
                    {sos.incidentType} |{' '}
                    {sos.requester?.displayName || 'Neighbour'}
                  </h3>
                  <span className="text-xs font-bold capitalize text-ink-soft">
                    {sos.state}
                  </span>
                </div>
                {sos.message && <p className="mt-2 text-sm">{sos.message}</p>}
                {sos.locationLabel && (
                  <p className="mt-1 text-xs text-ink-soft">
                    Landmark: {sos.locationLabel}
                  </p>
                )}
                <p className="mt-2 text-xs text-ink-soft">
                  Raised {when(sos.createdAt)}
                  {Array.isArray(sos.location?.coordinates) && (
                    <>
                      {' '}
                      | approximate point{' '}
                      {sos.location.coordinates[1]},{' '}
                      {sos.location.coordinates[0]}
                    </>
                  )}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {link && (
                    <a
                      className="btn-outline"
                      href={link}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open map (opens in a new tab)
                    </a>
                  )}
                  {sos.acknowledgementState !== 'acknowledged' && (
                    <button
                      className="btn-primary"
                      disabled={Boolean(pending[ackKey(sos.id)])}
                      onClick={() =>
                        run(
                          ackKey(sos.id),
                          () =>
                            api(`/sos/${sos.id}/acknowledge`, {
                              method: 'PUT',
                              body: { note: 'Acknowledged in app' },
                            }),
                          'Acknowledged. The requester was notified.',
                        )
                      }
                    >
                      {pending[ackKey(sos.id)]
                        ? 'Acknowledging…'
                        : 'Acknowledge'}
                    </button>
                  )}
                </div>
              </article>
            );
          })
        ) : (
          <p className="py-6 text-center text-sm text-ink-soft">
            {profile?.role === 'responder'
              ? 'No open SOS requests are dispatched to you right now. You will see them here when a nearby signal is assigned.'
              : 'SOS requests dispatched to responders appear here. Only assigned responders and community admins can view them.'}
          </p>
        )}
      </section>
    </div>
  );
}
