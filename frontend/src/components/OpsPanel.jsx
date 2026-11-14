import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';

const panel = 'rounded-3xl border border-ink/10 bg-white p-5 shadow-sm sm:p-6';

function Stat({ label, value, hint }) {
  return (
    <div className={panel}>
      <p className="text-xs font-bold uppercase tracking-wider text-ink-soft">
        {label}
      </p>
      <p className="mt-2 text-3xl font-extrabold">{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-soft">{hint}</p>}
    </div>
  );
}

function Breakdown({ title, rows }) {
  return (
    <div className={panel}>
      <h3 className="font-bold">{title}</h3>
      <dl className="mt-3 space-y-2 text-sm">
        {rows?.length ? (
          rows.map((row) => (
            <div key={row.key} className="flex justify-between gap-3">
              <dt className="capitalize text-ink-soft">{row.key || 'unknown'}</dt>
              <dd className="font-bold">{row.count}</dd>
            </div>
          ))
        ) : (
          <p className="text-ink-soft">No activity in this window.</p>
        )}
      </dl>
    </div>
  );
}

export default function OpsPanel() {
  const [reports, setReports] = useState(null);
  const [notifications, setNotifications] = useState(null);
  const [incidents, setIncidents] = useState(null);
  const [sos, setSos] = useState(null);
  const [queue, setQueue] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    const [reportStats, notificationStats, incidentStats, sosStats, incidentList] =
      await Promise.all([
        api('/analytics/reports?sinceDays=7'),
        api('/analytics/notifications?sinceDays=7'),
        api('/analytics/incidents'),
        api('/analytics/sos?sinceDays=7'),
        api('/incidents?limit=20'),
      ]);
    setReports(reportStats);
    setNotifications(notificationStats);
    setIncidents(incidentStats);
    setSos(sosStats);
    setQueue(incidentList.items);
  }, []);

  useEffect(() => {
    let active = true;
    load().catch((err) => {
      if (active) setError(err.message);
    });
    return () => {
      active = false;
    };
  }, [load]);

  async function run(work, success) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
      await load();
      if (success) setNotice(success);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function verify(incident, verificationState) {
    return run(
      () =>
        api(`/incidents/${incident.id}/verification`, {
          method: 'PUT',
          body: { verificationState },
        }),
      `Incident marked ${verificationState}.`,
    );
  }

  return (
    <div className="space-y-5">
      {error && (
        <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="rounded-xl border border-green-200 bg-white p-3 text-sm text-green-800"
        >
          {notice}
        </p>
      )}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Operations snapshot</h2>
        <button className="btn-outline" disabled={busy} onClick={() => run()}>
          Refresh
        </button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Reports (7d)"
          value={reports?.total ?? '—'}
          hint={`${reports?.last24h ?? 0} in the last 24h`}
        />
        <Stat
          label="Deliveries (7d)"
          value={notifications?.total ?? '—'}
          hint={`${notifications?.last24h ?? 0} in the last 24h`}
        />
        <Stat
          label="Incidents"
          value={incidents?.total ?? '—'}
          hint={`${incidents?.byVerification?.find((r) => r.key === 'Verified')?.count ?? 0} verified`}
        />
        <Stat
          label="SOS (7d)"
          value={sos?.total ?? '—'}
          hint={`${sos?.last24h ?? 0} in the last 24h`}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Breakdown title="Reports by state" rows={reports?.byState} />
        <Breakdown title="Reports by category" rows={reports?.byCategory} />
        <Breakdown
          title="Notification delivery"
          rows={notifications?.byDeliveryState}
        />
        <Breakdown title="SOS by state" rows={sos?.byState} />
      </div>
      <div className={`${panel} space-y-3`}>
        <h2 className="text-xl font-bold">Incident grouping</h2>
        <p className="text-sm text-ink-soft">
          Moderator-created incident groups and their linked reports.
        </p>
        {queue.length ? (
          queue.map((incident) => (
            <article
              key={incident.id}
              className="rounded-2xl border border-ink/10 p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-bold capitalize">
                  {incident.canonicalCategory} | {incident.severity}
                </h3>
                <span className="text-xs font-bold text-ink-soft">
                  {incident.status} | {incident.verificationState}
                </span>
              </div>
              <p className="mt-2 text-sm">{incident.summary}</p>
              <p className="mt-1 text-xs text-ink-soft">
                {incident.reportLinks?.length || 0} linked reports
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {['Verified', 'Disputed', 'Unverified'].map((state) => (
                  <button
                    key={state}
                    className="btn-outline"
                    disabled={busy || incident.verificationState === state}
                    onClick={() => verify(incident, state)}
                  >
                    Mark {state}
                  </button>
                ))}
              </div>
            </article>
          ))
        ) : (
          <p className="py-6 text-center text-sm text-ink-soft">
            No incident groups yet. Moderators create them through the API.
          </p>
        )}
      </div>
    </div>
  );
}
