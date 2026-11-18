import { useCallback, useEffect, useState } from 'react';
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [noticeTone, setNoticeTone] = useState('ok');

  useEffect(() => {
    setPlace(area);
  }, [area]);

  const load = useCallback(async () => {
    const [myRequests, dispatched] = await Promise.all([
      api('/sos/mine'),
      api('/sos/assigned'),
    ]);
    setMine(myRequests);
    setAssigned(dispatched);
  }, []);

  useEffect(() => {
    let active = true;
    load().catch((err) => {
      if (active) setError(err.message);
    });
    const timer = setInterval(() => load().catch(() => {}), 20000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [load]);

  useEffect(() => {
    if (!focusSosId) return;
    const node = document.getElementById(`sos-${focusSosId}`);
    node?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [focusSosId, mine, assigned]);

  async function run(work, success, tone = 'ok') {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
      await load();
      if (success) {
        setNotice(success);
        setNoticeTone(tone);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function raise(event) {
    event.preventDefault();
    await run(async () => {
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
      const count = result.recipientCount ?? 0;
      setNotice(
        count > 0
          ? `SOS sent. ${count} responder${count === 1 ? '' : 's'} and the community admin were notified.`
          : 'SOS saved, but no responder covers this area right now. Contact neighbours and local help directly.',
      );
      setNoticeTone(count > 0 ? 'ok' : 'warn');
    });
  }

  const openMine = mine.filter((sos) => OPEN.includes(sos.state));
  const openAssigned = assigned.filter((sos) => OPEN.includes(sos.state));

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-900">
        <strong>Demo SOS</strong> | This alerts nearby responders and the
        community admin inside the app. It does not call police, fire, or
        ambulance services.
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
      <form onSubmit={raise} className={`${panel} space-y-4`}>
        <div>
          <h2 className="text-xl font-bold">Raise an SOS around {place}</h2>
          <p className="mt-2 text-sm text-ink-soft">
            Your display name, message and approximate location are shared
            with dispatched responders. Keep the message short and factual.
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
        </fieldset>
        <button
          className="btn-primary bg-red-600 hover:bg-red-700"
          disabled={busy}
        >
          {busy ? 'Sending...' : 'Send SOS'}
        </button>
      </form>

      <section className={`${panel} space-y-4`}>
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">Your open signals</h2>
          <button className="btn-outline" disabled={busy} onClick={() => run()}>
            Refresh
          </button>
        </div>
        {openMine.length ? (
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
                  been notified in the app.
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
                  disabled={busy}
                  onClick={() =>
                    run(
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
                  Mark resolved
                </button>
                <button
                  className="btn-outline text-red-700"
                  disabled={busy}
                  onClick={() =>
                    run(
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
                  Cancel SOS
                </button>
              </div>
            </article>
          ))
        ) : (
          <p className="py-6 text-center text-sm text-ink-soft">
            You have no open SOS requests.
          </p>
        )}
      </section>

      <section className={`${panel} space-y-4`}>
        <h2 className="text-xl font-bold">Dispatched to you</h2>
        {openAssigned.length ? (
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
                      Open map
                    </a>
                  )}
                  {sos.acknowledgementState !== 'acknowledged' && (
                    <button
                      className="btn-primary"
                      disabled={busy}
                      onClick={() =>
                        run(
                          () =>
                            api(`/sos/${sos.id}/acknowledge`, {
                              method: 'PUT',
                              body: { note: 'Acknowledged in app' },
                            }),
                          'Acknowledged. The requester was notified.',
                        )
                      }
                    >
                      Acknowledge
                    </button>
                  )}
                </div>
              </article>
            );
          })
        ) : (
          <p className="py-6 text-center text-sm text-ink-soft">
            {profile?.role === 'responder'
              ? 'No open SOS requests are dispatched to you right now.'
              : 'SOS requests dispatched to responders appear here.'}
          </p>
        )}
      </section>
    </div>
  );
}
