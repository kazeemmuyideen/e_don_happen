import PhoneNotifications from '../components/PhoneNotifications.jsx';
import SosPanel from '../components/SosPanel.jsx';
import CommunityPanel from '../components/CommunityPanel.jsx';
import OpsPanel from '../components/OpsPanel.jsx';
import EvidencePanel from '../components/EvidencePanel.jsx';
import { disablePush } from '../lib/push.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { api, isOfflineError, logout, session } from '../lib/api.js';
import { AREAS, CATEGORIES, STATUS_HELP } from '../data/areas.js';

const field =
  'w-full rounded-xl border border-ink/15 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary';
const panel = 'rounded-3xl border border-ink/10 bg-white p-5 shadow-sm sm:p-6';

function when(value) {
  return new Date(value).toLocaleString('en-NG', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Africa/Lagos',
  });
}

function Badge({ state }) {
  const color =
    state === 'verified'
      ? 'bg-green-100 text-green-800'
      : state === 'disputed'
        ? 'bg-red-100 text-red-800'
        : state === 'corroborated'
          ? 'bg-blue-100 text-blue-800'
          : 'bg-amber-100 text-amber-800';
  return (
    <span
      title={STATUS_HELP[state]}
      className={`rounded-full px-3 py-1 text-xs font-bold capitalize ${color}`}
    >
      {state}
    </span>
  );
}

function toError(value) {
  return value instanceof Error
    ? value
    : new Error(value || 'Something went wrong. Please try again.');
}

function PanelError({ error, onRetry }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div
      role="alert"
      className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
    >
      <span>{message}</span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-full border border-red-300 px-3 py-1.5 text-xs font-bold hover:bg-red-100"
        >
          {isOfflineError(error) ? 'Reconnect and retry' : 'Retry'}
        </button>
      )}
    </div>
  );
}

function Skeleton({ label }) {
  return (
    <div
      aria-busy="true"
      aria-label={label}
      className={`${panel} animate-pulse space-y-3`}
    >
      <div className="h-4 w-1/3 rounded bg-ink/10" />
      <div className="h-4 w-2/3 rounded bg-ink/10" />
      <div className="h-24 rounded-2xl bg-ink/5" />
      <span className="sr-only">{label}</span>
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const locationRef = useRef({ pathname, search });
  locationRef.current = { pathname, search };
  const params = new URLSearchParams(search);
  const tabParam = params.get('tab');
  const reportParam = params.get('report');
  const focusSosId = params.get('sos');

  const [profile, setProfile] = useState(null);
  const [area, setArea] = useState('Yaba');
  const [radius, setRadius] = useState(5);
  const [category, setCategory] = useState('');
  const [tab, setTab] = useState('Nearby');
  const [reports, setReports] = useState([]);
  const [inbox, setInbox] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [queue, setQueue] = useState([]);
  const [selected, setSelected] = useState(null);
  const [errors, setErrors] = useState({});
  const [actionError, setActionError] = useState(null);
  const [loading, setLoading] = useState({
    profile: true,
    feed: true,
    inbox: true,
    subscriptions: true,
    queue: false,
    detail: false,
  });
  const [loaded, setLoaded] = useState({
    profile: false,
    feed: false,
    inbox: false,
    subscriptions: false,
    queue: false,
    detail: false,
  });
  const [lastUpdated, setLastUpdated] = useState(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [form, setForm] = useState({
    category: 'traffic',
    description: '',
    observedAt: '',
    postcode: '',
  });
  const [reason, setReason] = useState('');

  const generations = useRef({
    profile: 0,
    feed: 0,
    inbox: 0,
    subscriptions: 0,
    queue: 0,
    detail: 0,
  });
  const mounted = useRef(true);
  const initialized = useRef(false);
  const noticeTimer = useRef(null);

  const current = session();
  const moderator = ['moderator', 'super_admin'].includes(profile?.role);

  const begin = useCallback((key) => {
    generations.current[key] += 1;
    return generations.current[key];
  }, []);
  const isCurrent = useCallback(
    (key, id) => mounted.current && generations.current[key] === id,
    [],
  );
  const setPanelLoading = useCallback((key, value) => {
    setLoading((previous) =>
      previous[key] === value ? previous : { ...previous, [key]: value },
    );
  }, []);
  const setPanelError = useCallback((key, value) => {
    setErrors((previous) => {
      const next = value ? toError(value) : null;
      return previous[key] === next ? previous : { ...previous, [key]: next };
    });
  }, []);
  const markLoaded = useCallback((key) => {
    setLoaded((previous) =>
      previous[key] ? previous : { ...previous, [key]: true },
    );
    setLastUpdated(new Date());
  }, []);
  const clearNotice = useCallback(() => {
    clearTimeout(noticeTimer.current);
    setNotice('');
  }, []);
  const showNotice = useCallback((message) => {
    clearTimeout(noticeTimer.current);
    setNotice(message);
    noticeTimer.current = setTimeout(() => setNotice(''), 5000);
  }, []);

  const updateParams = useCallback(
    (updates, options = {}) => {
      const next = new URLSearchParams(locationRef.current.search);
      Object.entries(updates).forEach(([key, value]) => {
        if (value === null || value === undefined || value === '')
          next.delete(key);
        else next.set(key, String(value));
      });
      const query = next.toString();
      navigate(
        {
          pathname: locationRef.current.pathname,
          search: query ? `?${query}` : '',
        },
        { replace: Boolean(options.replace) },
      );
    },
    [navigate],
  );

  const changeArea = useCallback((value) => {
    initialized.current = true;
    setArea(value);
  }, []);

  const fetchProfile = useCallback(async () => {
    const id = begin('profile');
    setPanelLoading('profile', true);
    try {
      const data = await api('/auth/profile');
      if (!isCurrent('profile', id)) return null;
      setProfile(data);
      setPanelError('profile', null);
      markLoaded('profile');
      if (!initialized.current && AREAS[data?.lgas?.[0]]) {
        initialized.current = true;
        setArea(data.lgas[0]);
      }
      return data;
    } catch (err) {
      if (isCurrent('profile', id)) setPanelError('profile', err);
      return null;
    } finally {
      if (isCurrent('profile', id)) setPanelLoading('profile', false);
    }
  }, [begin, isCurrent, markLoaded, setPanelError, setPanelLoading]);

  const fetchFeed = useCallback(async () => {
    const id = begin('feed');
    setPanelLoading('feed', true);
    const query = new URLSearchParams({
      ...AREAS[area],
      radius: radius * 1000,
      limit: 100,
    });
    if (category) query.set('category', category);
    try {
      const data = await api(`/reports?${query}`);
      if (!isCurrent('feed', id)) return;
      setReports(Array.isArray(data) ? data : []);
      setPanelError('feed', null);
      markLoaded('feed');
    } catch (err) {
      if (isCurrent('feed', id)) setPanelError('feed', err);
    } finally {
      if (isCurrent('feed', id)) setPanelLoading('feed', false);
    }
  }, [area, begin, category, isCurrent, markLoaded, radius, setPanelError, setPanelLoading]);

  const fetchInbox = useCallback(async () => {
    const id = begin('inbox');
    setPanelLoading('inbox', true);
    try {
      const data = await api('/notifications/inbox');
      if (!isCurrent('inbox', id)) return;
      setInbox(Array.isArray(data) ? data : []);
      setPanelError('inbox', null);
      markLoaded('inbox');
    } catch (err) {
      if (isCurrent('inbox', id)) setPanelError('inbox', err);
    } finally {
      if (isCurrent('inbox', id)) setPanelLoading('inbox', false);
    }
  }, [begin, isCurrent, markLoaded, setPanelError, setPanelLoading]);

  const fetchSubscriptions = useCallback(async () => {
    const id = begin('subscriptions');
    setPanelLoading('subscriptions', true);
    try {
      const data = await api('/notifications/subscriptions');
      if (!isCurrent('subscriptions', id)) return;
      setSubscriptions(Array.isArray(data) ? data : []);
      setPanelError('subscriptions', null);
      markLoaded('subscriptions');
    } catch (err) {
      if (isCurrent('subscriptions', id)) setPanelError('subscriptions', err);
    } finally {
      if (isCurrent('subscriptions', id)) setPanelLoading('subscriptions', false);
    }
  }, [begin, isCurrent, markLoaded, setPanelError, setPanelLoading]);

  const fetchQueue = useCallback(async () => {
    const id = begin('queue');
    setPanelLoading('queue', true);
    try {
      const data = await api('/moderation/queue');
      if (!isCurrent('queue', id)) return;
      setQueue(Array.isArray(data) ? data : []);
      setPanelError('queue', null);
      markLoaded('queue');
    } catch (err) {
      if (isCurrent('queue', id)) setPanelError('queue', err);
    } finally {
      if (isCurrent('queue', id)) setPanelLoading('queue', false);
    }
  }, [begin, isCurrent, markLoaded, setPanelError, setPanelLoading]);

  const fetchReport = useCallback(
    async (id) => {
      const requestId = begin('detail');
      setPanelLoading('detail', true);
      try {
        const report = await api(`/reports/${id}`);
        if (!isCurrent('detail', requestId)) return;
        setSelected(report);
        setPanelError('detail', null);
        markLoaded('detail');
      } catch (err) {
        if (isCurrent('detail', requestId)) setPanelError('detail', err);
      } finally {
        if (isCurrent('detail', requestId)) setPanelLoading('detail', false);
      }
    },
    [begin, isCurrent, markLoaded, setPanelError, setPanelLoading],
  );

  const reload = useCallback(async () => {
    if (!session()) return;
    const profileData = await fetchProfile();
    const tasks = [fetchFeed(), fetchInbox(), fetchSubscriptions()];
    if (['moderator', 'super_admin'].includes(profileData?.role))
      tasks.push(fetchQueue());
    await Promise.all(tasks);
  }, [fetchFeed, fetchInbox, fetchProfile, fetchQueue, fetchSubscriptions]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(noticeTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!session()) return;
    reload();
  }, [reload]);

  useEffect(() => {
    if (!session()) return undefined;
    const timer = setInterval(() => reload(), 20000);
    return () => clearInterval(timer);
  }, [reload]);

  useEffect(() => {
    if (!profile?.id) return;
    const allowed = [
      'Nearby',
      'Report',
      'My reports',
      'SOS',
      'Community',
      'Notifications',
      'Preferences',
      ...(moderator ? ['Moderation', 'Operations'] : []),
    ];
    if (!tabParam || !allowed.includes(tabParam)) {
      if (tabParam !== tab) updateParams({ tab }, { replace: true });
      return;
    }
    if (tabParam !== tab) setTab(tabParam);
  }, [moderator, profile?.id, tab, tabParam, updateParams]);

  useEffect(() => {
    if (!profile?.id) return;
    if (!reportParam) {
      begin('detail');
      setSelected(null);
      setPanelError('detail', null);
      setPanelLoading('detail', false);
      return;
    }
    if (!/^[a-f0-9-]{36}$/i.test(reportParam)) {
      begin('detail');
      setSelected(null);
      setPanelError('detail', 'That report link is invalid.');
      updateParams({ report: null }, { replace: true });
      return;
    }
    fetchReport(reportParam);
  }, [
    begin,
    fetchReport,
    profile?.id,
    reportParam,
    setPanelError,
    setPanelLoading,
    updateParams,
  ]);

  if (!current) return <Navigate to={`/login${search}`} replace />;

  function changeTab(nextTab, extra = {}) {
    setTab(nextTab);
    if (!extra.report && !extra.sos) setSelected(null);
    updateParams({
      tab: nextTab,
      report: extra.report || null,
      sos: nextTab === 'SOS' ? extra.sos || null : null,
    });
  }

  function openReport(id) {
    updateParams({ report: id });
  }

  function closeReport() {
    begin('detail');
    setSelected(null);
    updateParams({ report: null });
  }

  async function act(work, message) {
    setBusy(true);
    setActionError(null);
    clearNotice();
    try {
      await work();
      await reload();
      if (message) showNotice(message);
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    setRefreshing(true);
    clearNotice();
    try {
      await reload();
      showNotice('Feed refreshed.');
    } finally {
      setRefreshing(false);
    }
  }

  async function publish(event) {
    event.preventDefault();
    await act(async () => {
      const report = await api('/reports', {
        method: 'POST',
        body: {
          category: form.category,
          description: form.description,
          location: {
            ...AREAS[area],
            areaName: area,
            radius: 1000,
            ...(form.postcode.trim() ? { postcode: form.postcode.trim() } : {}),
          },
          ...(form.observedAt
            ? { observedAt: new Date(form.observedAt).toISOString() }
            : {}),
        },
      });
      setForm({
        category: 'traffic',
        description: '',
        observedAt: '',
        postcode: '',
      });
      setSelected(report);
      changeTab('Nearby', { report: report.id });
    }, 'Report saved. It starts as unverified until independent review.');
  }

  async function vote(report, action) {
    if (
      action === 'confirm' &&
      !window.confirm(
        'Did you personally witness this incident? Confirm only firsthand observations.',
      )
    )
      return;
    await act(async () => {
      const updated = await api('/reports/confirm', {
        method: 'POST',
        body: { reportId: report.id, action, firsthand: action === 'confirm' },
      });
      if (selected?.id === report.id) setSelected(updated);
    }, 'Your contribution was saved. Each account has one vote per report.');
  }

  async function moderate(report, newState) {
    await act(async () => {
      await api('/moderation/actions', {
        method: 'POST',
        body: {
          targetId: report.id,
          targetType: 'report',
          action:
            newState === 'verified'
              ? 'approve'
              : newState === 'removed'
                ? 'remove'
                : 'label',
          newState,
          reason,
        },
      });
      setReason('');
      closeReport();
    }, `Report marked ${newState}. An audit record was saved.`);
  }

  async function toggleCategory(cat) {
    const existing = subscriptions.some((s) => s.category === cat);
    await act(
      () =>
        api(`/notifications/subscriptions${existing ? `/${cat}` : ''}`, {
          method: existing ? 'DELETE' : 'POST',
          ...(!existing
            ? {
                body: {
                  category: cat,
                  areaOrRadius: radius,
                  ...AREAS[area],
                  priorityThreshold: 'normal',
                },
              }
            : {}),
        }),
      `${cat} notifications ${existing ? 'disabled' : 'enabled'} for this account.`,
    );
  }

  const unread = inbox.filter((n) => n.deliveryState !== 'acknowledged').length;
  const tabs = [
    'Nearby',
    'Report',
    'My reports',
    'SOS',
    'Community',
    'Notifications',
    'Preferences',
    ...(moderator ? ['Moderation', 'Operations'] : []),
  ];
  const items =
    tab === 'My reports'
      ? reports.filter((r) => r.reporterId === profile?.id)
      : reports;
  const votable = ['unverified', 'corroborated', 'disputed'];

  function emptyState() {
    return (
      <div className={`${panel} py-12 text-center`}>
        <h3 className="text-lg font-bold">No reports in this view</h3>
        <p className="mt-2 text-sm text-ink-soft">
          Try another area or category, or share a local observation.
        </p>
        <button
          type="button"
          className="btn-primary mt-5"
          onClick={() => changeTab('Report')}
        >
          Create a report
        </button>
      </div>
    );
  }

  function queueCard(item) {
    return (
      <article key={item.id} className={panel}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-ink-soft">
            {item.category || 'report'} | {item.areaName || 'Lagos'}
          </span>
          <Badge state={item.currentState} />
          {item.flagCount > 0 && (
            <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-amber-900">
              {item.flagCount} flag{item.flagCount === 1 ? '' : 's'}
            </span>
          )}
        </div>
        <button
          className="mt-3 block text-left text-lg font-bold leading-relaxed hover:underline"
          onClick={() => openReport(item.id)}
        >
          {item.description || item.targetPreview}
        </button>
        <p className="mt-2 text-xs text-ink-soft">
          Reported by {item.reporterDisplayName || 'Resident'} | Submitted{' '}
          {when(item.submittedAt)}
        </p>
        <p className="mt-3 text-xs text-ink-soft">
          {STATUS_HELP[item.currentState] || 'Awaiting review.'}
        </p>
        <div className="mt-4 border-t border-ink/10 pt-4">
          <button className="btn-outline" onClick={() => openReport(item.id)}>
            Open report and review
          </button>
        </div>
      </article>
    );
  }

  function card(report) {
    const own = report.reporterId === profile?.id;
    return (
      <article key={report.id} className={panel}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-ink-soft">
            {report.category} |{' '}
            {report.areaName || report.metadata?.areaName || 'Lagos'}
            {report.postcode && (
              <span className="font-mono normal-case">
                {' '}
                | postcode {report.postcode}
              </span>
            )}
          </span>
          <Badge state={report.state} />
        </div>
        <button
          className="mt-3 block text-left text-lg font-bold leading-relaxed hover:underline"
          onClick={() => openReport(report.id)}
        >
          {report.description}
        </button>
        <p className="mt-2 text-xs text-ink-soft">
          Observed {when(report.observedAt)} | Posted {when(report.submittedAt)}
        </p>
        <p className="mt-3 text-xs text-ink-soft">
          {STATUS_HELP[report.state] || 'Awaiting review.'}
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-ink/10 pt-4">
          <span className="text-sm font-semibold">
            {report.reporter?.displayName ||
              (own ? profile.displayName : 'Resident')}
            {report.reporter?.trustedContributor && (
              <span
                className="ml-2 rounded-full bg-primary-soft px-2 py-1 text-xs text-primary-dark"
                title="At least 10 currently moderator-verified reports"
              >
                Trusted contributor
              </span>
            )}
          </span>
          <div className="flex gap-2">
            <button
              className="rounded-full border border-ink/15 px-3 py-2 text-xs font-bold disabled:opacity-40"
              disabled={busy || own || !votable.includes(report.state)}
              onClick={() => vote(report, 'confirm')}
            >
              Confirm firsthand | {report.confirmationsCount || 0}
            </button>
            <button
              className="rounded-full border border-ink/15 px-3 py-2 text-xs font-bold disabled:opacity-40"
              disabled={busy || own || !votable.includes(report.state)}
              onClick={() => vote(report, 'dispute')}
            >
              Dispute | {report.disputesCount || 0}
            </button>
          </div>
        </div>
        {own && (
          <p className="mt-2 text-xs text-ink-soft">
            Your report | other residents can confirm or dispute it.
          </p>
        )}
      </article>
    );
  }

  return (
    <section className="min-h-screen bg-primary-soft/50 py-8">
      <div className="container-app">
        <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          <strong>Local pilot demo</strong> | Seeded reports are illustrative.
          Install from the HTTPS sharing link to enable optional phone
          notifications. SMS delivery and external emergency dispatch require
          provider credentials; local demo keeps SOS alerts in this app.
        </div>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-primary-dark">
              Your neighbourhood, in the know
            </p>
            <h1 className="mt-2 text-3xl font-extrabold sm:text-4xl">
              Hello, {profile?.displayName || 'neighbour'}.
            </h1>
            <p className="mt-2 text-sm text-ink-soft">
              Fresh observations. Clear confidence. A more informed community.
            </p>
            <p className="mt-2 text-xs text-ink-soft" aria-live="polite">
              {lastUpdated
                ? `Last updated ${when(lastUpdated)}`
                : 'Waiting for first update'}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-outline"
              disabled={busy || refreshing}
              onClick={refresh}
            >
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
            <button
              className="btn-ghost"
              onClick={async () => {
                setBusy(true);
                await disablePush().catch(() => {});
                logout();
                navigate('/login');
              }}
            >
              Sign out
            </button>
          </div>
        </div>
        <nav
          aria-label="Dashboard"
          className="my-7 flex gap-2 overflow-x-auto pb-2"
        >
          {tabs.map((t) => (
            <button
              key={t}
              type="button"
              aria-current={tab === t ? 'page' : undefined}
              className={`shrink-0 rounded-full px-5 py-2.5 text-sm font-bold ${tab === t ? 'bg-ink text-white' : 'bg-white text-ink'}`}
              onClick={() => changeTab(t)}
            >
              {t}
              {t === 'Notifications' && unread > 0 ? ` (${unread})` : ''}
            </button>
          ))}
        </nav>
        <PanelError error={actionError} />
        {notice && (
          <p
            role="status"
            className="mb-5 rounded-xl border border-green-200 bg-white p-4 text-sm text-green-800"
          >
            {notice}
          </p>
        )}
        <div className="grid gap-6 lg:grid-cols-[1fr_290px]">
          <div className="min-w-0 space-y-5">
            {['Nearby', 'My reports', 'Moderation'].includes(tab) && (
              <div className={`${panel} grid gap-3 sm:grid-cols-3`}>
                <label className="text-xs font-bold">
                  Area
                  <select
                    aria-label="Feed area"
                    className={`${field} mt-2`}
                    value={area}
                    onChange={(e) => changeArea(e.target.value)}
                  >
                    {Object.keys(AREAS).map((a) => (
                      <option key={a}>{a}</option>
                    ))}
                  </select>
                </label>
                <label className="text-xs font-bold">
                  Radius
                  <select
                    className={`${field} mt-2`}
                    value={radius}
                    onChange={(e) => setRadius(Number(e.target.value))}
                  >
                    {[1, 3, 5, 10, 25].map((r) => (
                      <option key={r} value={r}>
                        {r} km
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs font-bold">
                  Category
                  <select
                    className={`${field} mt-2`}
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                  >
                    <option value="">All categories</option>
                    {CATEGORIES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
              </div>
            )}
            {selected && (
              <div className="space-y-3 rounded-3xl border-2 border-primary p-3">
                <div className="flex items-center justify-between px-2">
                  <h2 className="font-bold">Report detail</h2>
                  <button
                    type="button"
                    onClick={closeReport}
                    className="text-sm underline"
                  >
                    Close detail
                  </button>
                </div>
                {loading.detail && (
                  <p role="status" className="px-3 text-xs text-ink-soft">
                    Updating report…
                  </p>
                )}
                <PanelError
                  error={errors.detail}
                  onRetry={() => fetchReport(selected.id)}
                />
                {card(selected)}
                <p className="px-3 text-xs text-ink-soft">
                  Approximate location |{' '}
                  {selected.coordinates?.coordinates?.join(', ')}. Exact
                  coordinates and private contact details are hidden from the
                  public feed.
                </p>
                <EvidencePanel
                  reportId={selected.id}
                  profile={profile}
                  canUpload={selected.reporterId === profile?.id || moderator}
                  onChanged={() => fetchReport(selected.id)}
                />
                {moderator && selected.reporterId !== profile?.id && (
                  <div className={panel}>
                    <label className="text-sm font-bold">
                      Moderation reason
                      <textarea
                        className={`${field} mt-2`}
                        minLength={10}
                        maxLength={1000}
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="Explain what you reviewed (at least 10 characters)"
                      />
                    </label>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {['verified', 'resolved', 'removed'].map((state) => (
                        <button
                          key={state}
                          type="button"
                          className="btn-outline capitalize"
                          disabled={
                            busy ||
                            reason.trim().length < 10 ||
                            selected.state === state ||
                            (state === 'resolved' &&
                              !['verified', 'corroborated', 'stale'].includes(
                                selected.state,
                              ))
                          }
                          onClick={() => moderate(selected, state)}
                        >
                          Mark {state}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            {['Nearby', 'My reports', 'Moderation'].includes(tab) && (
              <>
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-bold">
                    {tab === 'Moderation'
                      ? 'Review queue'
                      : tab === 'My reports'
                        ? 'Your contributions in this area'
                        : `Around ${area}`}
                  </h2>
                  <span className="text-sm text-ink-soft">
                    {tab === 'Moderation' ? queue.length : items.length} reports
                    {(tab === 'Moderation'
                      ? loading.queue && loaded.queue
                      : loading.feed && loaded.feed)
                      ? ' • Updating…'
                      : ''}
                  </span>
                </div>
                {tab === 'Moderation' ? (
                  <>
                    <PanelError error={errors.queue} onRetry={fetchQueue} />
                    {loading.queue && !loaded.queue ? (
                      <Skeleton label="Loading the review queue" />
                    ) : queue.length ? (
                      queue.map(queueCard)
                    ) : errors.queue ? null : (
                      emptyState()
                    )}
                  </>
                ) : (
                  <>
                    <PanelError error={errors.feed} onRetry={fetchFeed} />
                    {loading.feed && !loaded.feed ? (
                      <Skeleton label="Loading the local feed" />
                    ) : items.length ? (
                      items.map(card)
                    ) : errors.feed ? null : (
                      emptyState()
                    )}
                  </>
                )}
              </>
            )}
            {tab === 'Report' && (
              <form onSubmit={publish} className={`${panel} space-y-5`}>
                <div>
                  <h2 className="text-xl font-bold">What did you observe?</h2>
                  <p className="mt-2 text-sm text-ink-soft">
                    Share facts about the selected area. Your report starts as
                    unverified. Avoid names, private addresses, or speculation.
                  </p>
                </div>
                <label className="block text-sm font-bold">
                  Area
                  <select
                    aria-label="Report area"
                    className={`${field} mt-2`}
                    value={area}
                    onChange={(e) => changeArea(e.target.value)}
                  >
                    {Object.keys(AREAS).map((name) => (
                      <option key={name}>{name}</option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm font-bold">
                  Incident category
                  <select
                    className={`${field} mt-2`}
                    value={form.category}
                    onChange={(e) =>
                      setForm({ ...form, category: e.target.value })
                    }
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm font-bold">
                  Description
                  <textarea
                    className={`${field} mt-2 min-h-32`}
                    required
                    minLength={10}
                    maxLength={1500}
                    value={form.description}
                    onChange={(e) =>
                      setForm({ ...form, description: e.target.value })
                    }
                    placeholder="For example: Slow-moving traffic near the Yaba bus stop after heavy rain."
                  />
                </label>
                <label className="block text-sm font-bold">
                  NIPOST postcode{' '}
                  <span className="font-normal text-ink-soft">
                    (optional metadata — the public point stays at the area
                    centre)
                  </span>
                  <input
                    className={`${field} mt-2 font-mono uppercase`}
                    value={form.postcode}
                    onChange={(e) =>
                      setForm({ ...form, postcode: e.target.value })
                    }
                    placeholder="e.g. EK 01 A03 FK 01"
                    pattern="[A-Za-z]{2}[\s-]?\d{2}[\s-]?[A-Za-z0-9]{3}[\s-]?[A-Za-z]{2}[\s-]?\d{2}"
                    title="Five-segment NIPOST code, e.g. EK 01 A03 FK 01"
                  />
                </label>
                <label className="block text-sm font-bold">
                  Observed time{' '}
                  <span className="font-normal text-ink-soft">
                    (leave blank for now)
                  </span>
                  <input
                    className={`${field} mt-2`}
                    type="datetime-local"
                    value={form.observedAt}
                    onChange={(e) =>
                      setForm({ ...form, observedAt: e.target.value })
                    }
                  />
                </label>
                <div className="rounded-xl bg-primary-soft p-4 text-sm">
                  Public preview: {area} | approximate area centre |{' '}
                  {form.postcode.trim()
                    ? `postcode ${form.postcode.trim().toUpperCase()} | `
                    : ''}
                  {form.category} | Unverified
                </div>
                <button disabled={busy} className="btn-primary">
                  {busy ? 'Saving...' : 'Publish report'}
                </button>
              </form>
            )}
            {tab === 'SOS' && (
              <SosPanel
                area={area}
                profile={profile}
                focusSosId={focusSosId}
              />
            )}
            {tab === 'Community' && (
              <CommunityPanel
                area={area}
                profile={profile}
                onProfileChanged={reload}
              />
            )}
            {tab === 'Operations' && moderator && <OpsPanel />}
            {tab === 'Notifications' && (
              <div className={panel}>
                <h2 className="text-xl font-bold">Your local inbox</h2>
                <PhoneNotifications />
                <p className="mt-2 text-sm text-ink-soft">
                  New reports matching your saved area, radius and categories.
                  Updates appear every 20 seconds or when you refresh.
                </p>
                <PanelError error={errors.inbox} onRetry={fetchInbox} />
                {loading.inbox && !loaded.inbox ? (
                  <Skeleton label="Loading local notifications" />
                ) : (
                  <>
                    {loading.inbox && loaded.inbox && (
                      <p role="status" className="mt-3 text-xs text-ink-soft">
                        Updating inbox…
                      </p>
                    )}
                    <div className="mt-5 space-y-3">
                      {inbox.length ? (
                        inbox.map((n) => (
                          <article
                            key={n.id}
                            className={`rounded-2xl border p-4 ${n.deliveryState === 'acknowledged' ? 'border-ink/10' : 'border-primary bg-primary-soft'}`}
                          >
                            <h3 className="font-bold">
                              {n.payload?.title || 'Local report update'}
                            </h3>
                            <p className="mt-2 text-sm">{n.payload?.body}</p>
                            <p className="mt-2 text-xs text-ink-soft">
                              {when(n.createdAt)} |{' '}
                              {n.deliveryState === 'acknowledged' ? 'Read' : 'New'}
                            </p>
                            <div className="mt-3 flex gap-4">
                              <button
                                className="text-sm font-bold underline"
                                onClick={() => {
                                  if (n.payload?.sosId) {
                                    begin('detail');
                                    setSelected(null);
                                    changeTab('SOS', { sos: n.payload.sosId });
                                    return;
                                  }
                                  openReport(
                                    n.payload?.reportId || n.incidentIdOrSosId,
                                  );
                                }}
                              >
                                {n.payload?.sosId ? 'Open SOS' : 'Open report'}
                              </button>
                              {n.deliveryState !== 'acknowledged' && (
                                <button
                                  className="text-sm underline"
                                  disabled={busy}
                                  onClick={() =>
                                    act(() =>
                                      api(`/notifications/inbox/${n.id}/read`, {
                                        method: 'PUT',
                                      }),
                                    )
                                  }
                                >
                                  Mark read
                                </button>
                              )}
                            </div>
                          </article>
                        ))
                      ) : (
                        <p className="py-10 text-center text-ink-soft">
                          No matching reports yet. Save your preferences, then
                          publish from a second account.
                        </p>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
            {tab === 'Preferences' && (
              <div className={`${panel} space-y-5`}>
                <h2 className="text-xl font-bold">Notification preferences</h2>
                <PhoneNotifications />
                <p className="text-sm text-ink-soft">
                  Choose the area, radius and categories used for new alerts.
                  Changes apply when you save below.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm font-bold">
                    Area
                    <select
                      aria-label="Preference area"
                      className={`${field} mt-2`}
                      value={area}
                      onChange={(e) => changeArea(e.target.value)}
                    >
                      {Object.keys(AREAS).map((name) => (
                        <option key={name}>{name}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm font-bold">
                    Radius
                    <select
                      aria-label="Preference radius"
                      className={`${field} mt-2`}
                      value={radius}
                      onChange={(e) => setRadius(Number(e.target.value))}
                    >
                      {[1, 3, 5, 10, 25].map((r) => (
                        <option key={r} value={r}>
                          {r} km
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <PanelError
                  error={errors.subscriptions}
                  onRetry={fetchSubscriptions}
                />
                {loading.subscriptions && !loaded.subscriptions ? (
                  <Skeleton label="Loading notification preferences" />
                ) : (
                  <>
                    {loading.subscriptions && loaded.subscriptions && (
                      <p role="status" className="text-xs text-ink-soft">
                        Updating preferences…
                      </p>
                    )}
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      {CATEGORIES.map((cat) => (
                        <label
                          key={cat}
                          className="flex items-center gap-2 rounded-xl border border-ink/10 p-3 text-sm capitalize"
                        >
                          <input
                            type="checkbox"
                            checked={subscriptions.some(
                              (s) => s.category === cat,
                            )}
                            onChange={() => toggleCategory(cat)}
                            disabled={busy}
                          />
                          {cat}
                        </label>
                      ))}
                    </div>
                  </>
                )}
                <button
                  className="btn-primary"
                  disabled={busy}
                  onClick={() =>
                    act(async () => {
                      await api('/auth/profile', {
                        method: 'PUT',
                        body: { lgas: [area] },
                      });
                      await Promise.all(
                        subscriptions.map((s) =>
                          api(`/notifications/subscriptions/${s.category}`, {
                            method: 'PUT',
                            body: { areaOrRadius: radius, ...AREAS[area] },
                          }),
                        ),
                      );
                    }, `Saved ${area} within ${radius} km for enabled notifications.`)
                  }
                >
                  Save area and radius
                </button>
                <div className="text-xs text-ink-soft">
                  {subscriptions.map((s) => (
                    <p key={s.category}>
                      {s.category}: {s.areaOrRadius} km around{' '}
                      {Number(s.latitude || 6.5244).toFixed(2)},{' '}
                      {Number(s.longitude || 3.3792).toFixed(2)}
                    </p>
                  ))}
                </div>
              </div>
            )}
          </div>
          <aside className="space-y-5">
            <PanelError
              error={errors.profile}
              onRetry={fetchProfile}
            />
            {loading.profile && !loaded.profile ? (
              <Skeleton label="Loading contribution summary" />
            ) : (
              <div className="rounded-3xl bg-ink p-6 text-white">
                <p className="text-xs font-bold uppercase tracking-wider text-white/60">
                  Your contribution
                </p>
                <h2 className="mt-3 text-xl font-bold">
                  {profile?.trustedContributor
                    ? 'Trusted contributor'
                    : 'Building local trust'}
                </h2>
                <p className="mt-3 text-sm text-white/75">
                  {profile?.verifiedReports || 0} / 10 moderator-verified reports
                </p>
                <progress
                  className="mt-4 w-full accent-primary"
                  max={10}
                  value={Math.min(profile?.verifiedReports || 0, 10)}
                />
                <p className="mt-3 text-xs leading-relaxed text-white/60">
                  Earn the badge through ten currently verified reports. It
                  reflects contribution history; every new report still needs
                  its own review.
                </p>
              </div>
            )}
            <div className={panel}>
              <h2 className="font-bold">Confidence, explained</h2>
              <dl className="mt-4 space-y-4">
                {['unverified', 'corroborated', 'verified', 'disputed'].map(
                  (state) => (
                    <div key={state}>
                      <dt>
                        <Badge state={state} />
                      </dt>
                      <dd className="mt-2 text-xs leading-relaxed text-ink-soft">
                        {STATUS_HELP[state]}
                      </dd>
                    </div>
                  ),
                )}
              </dl>
            </div>
            <div className={panel}>
              <h2 className="font-bold">Pilot scope</h2>
              <p className="mt-3 text-xs leading-relaxed text-ink-soft">
                Manual area selection keeps the feed useful without location
                permission. Reports use approximate area centres. SOS alerts
                are routed to responders whose demo coverage area contains the
                signal; no external emergency service is contacted.
              </p>
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}
