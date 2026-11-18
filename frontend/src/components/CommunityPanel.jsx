import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { AREAS } from '../data/areas.js';

const field =
  'w-full rounded-xl border border-ink/15 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary';
const panel = 'rounded-3xl border border-ink/10 bg-white p-5 shadow-sm sm:p-6';
const ADMIN_ROLES = ['moderator', 'super_admin'];

function Skeleton({ className }) {
  return (
    <div
      aria-hidden
      className={`animate-pulse rounded-xl bg-ink/10 ${className}`}
    />
  );
}

function money(amount, currency) {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: currency || 'NGN',
  }).format((Number(amount) || 0) / 100);
}

function normalizePhone(value) {
  const cleaned = value.trim().replace(/[\s()-]/g, '');
  if (/^\+[1-9]\d{7,14}$/.test(cleaned)) return cleaned;
  if (/^0\d{10}$/.test(cleaned)) return `+234${cleaned.slice(1)}`;
  if (/^234\d{10}$/.test(cleaned)) return `+${cleaned}`;
  return cleaned;
}

function squareAround(area) {
  const { latitude: lat, longitude: lng } = AREAS[area];
  const d = 0.01;
  return {
    type: 'Polygon',
    coordinates: [
      [
        [lng - d, lat - d],
        [lng + d, lat - d],
        [lng + d, lat + d],
        [lng - d, lat + d],
        [lng - d, lat - d],
      ],
    ],
  };
}

export default function CommunityPanel({ area, profile, onProfileChanged }) {
  const [communities, setCommunities] = useState([]);
  const [detail, setDetail] = useState(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [candidate, setCandidate] = useState(null);
  const [plan, setPlan] = useState('standard');
  const [paymentEmail, setPaymentEmail] = useState('');
  const [payment, setPayment] = useState(null);
  const [subscriptions, setSubscriptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [pending, setPending] = useState({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const isAdmin =
    detail &&
    (detail.adminId === profile?.id || ADMIN_ROLES.includes(profile?.role));

  const loadDetail = useCallback(async (id) => {
    const [community, plans] = await Promise.all([
      api(`/communities/${id}`),
      api(`/billing/subscriptions/community/${id}`).catch(() => []),
    ]);
    setDetail(community);
    setSubscriptions(plans);
  }, []);

  const loadList = useCallback(async () => {
    const list = await api('/communities');
    setCommunities(list);
    if (list.length) await loadDetail(list[0].id);
    return list;
  }, [loadDetail]);

  useEffect(() => {
    let active = true;
    loadList()
      .catch((err) => {
        if (active) setError(err.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [loadList]);

  async function run(key, work, success) {
    setPending((current) => ({ ...current, [key]: true }));
    setError('');
    setNotice('');
    try {
      const result = await work();
      if (success) {
        setNotice(
          typeof success === 'function' ? success(result) : success,
        );
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

  async function selectCommunity(id) {
    await run('select', async () => {
      setPayment(null);
      setCandidate(null);
      setLoadingDetail(true);
      try {
        await loadDetail(id);
      } finally {
        setLoadingDetail(false);
      }
    });
  }

  async function createCommunity(event) {
    event.preventDefault();
    await run('create', async () => {
      const created = await api('/communities', {
        method: 'POST',
        body: { name: name.trim(), boundary: squareAround(area) },
      });
      setName('');
      await loadList();
      await loadDetail(created.id);
      await onProfileChanged?.();
    }, `Community created around ${area}. You are its admin.`);
  }

  async function lookup(event) {
    event.preventDefault();
    const normalized = normalizePhone(phone);
    if (!/^\+[1-9]\d{7,14}$/.test(normalized)) {
      setPhoneError('Use 08012345678 or +2348012345678.');
      return;
    }
    setPhoneError('');
    await run('lookup', async () => {
      const found = await api(
        `/communities/${detail.id}/users/lookup?phone=${encodeURIComponent(normalized)}`,
      );
      setCandidate(found);
    });
  }

  async function addResponder() {
    await run('add', async () => {
      await api(`/communities/${detail.id}/responders`, {
        method: 'POST',
        body: {
          userId: candidate.id,
          coverageArea: squareAround(area),
        },
      });
      setCandidate(null);
      setPhone('');
      setPhoneError('');
      await loadDetail(detail.id);
    }, `${candidate.displayName} can now receive SOS alerts for ${detail.name}.`);
  }

  async function removeResponder(userId) {
    await run(`remove:${userId}`, async () => {
      await api(`/communities/${detail.id}/responders/${userId}`, {
        method: 'DELETE',
      });
      await loadDetail(detail.id);
    }, 'Responder removed.');
  }

  async function createSubscription(event) {
    event.preventDefault();
    await run('subscription', async () => {
      await api('/billing/subscriptions', {
        method: 'POST',
        body: { communityId: detail.id, plan },
      });
      await loadDetail(detail.id);
    }, `${plan} billing record created for ${detail.name}.`);
  }

  async function cancelSubscription(id) {
    await run(`cancel:${id}`, async () => {
      await api(`/billing/subscriptions/${id}/cancel`, { method: 'PUT' });
      await loadDetail(detail.id);
    }, 'Subscription cancelled.');
  }

  async function initializePayment(event) {
    event.preventDefault();
    await run('payment', async () => {
      const result = await api('/billing/payments/checkout', {
        method: 'POST',
        body: {
          communityId: detail.id,
          plan,
          ...(paymentEmail.trim() ? { email: paymentEmail.trim() } : {}),
        },
      });
      setPayment(result);
    }, 'Payment initialized. Open the authorization link in a new tab to pay, then verify it here.');
  }

  async function refreshPayment() {
    await run('payment-refresh', async () => {
      setPayment(
        await api(`/billing/payments/${encodeURIComponent(payment.reference)}`),
      );
    });
  }

  async function verifyPayment() {
    await run('payment-verify', async () => {
      const result = await api('/billing/payments/verify', {
        method: 'POST',
        body: { reference: payment.reference },
      });
      setPayment(result);
      await loadDetail(detail.id);
      return result;
    }, (result) =>
      result.status === 'succeeded'
        ? 'Payment verified. The subscription is active.'
        : `Payment status: ${result.status}. Complete checkout and verify again if needed.`,
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

      <div className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
        <div className="space-y-5">
          <form onSubmit={createCommunity} className={`${panel} space-y-4`}>
            <div>
              <h2 className="text-xl font-bold">Start a community</h2>
              <p className="mt-2 text-sm text-ink-soft">
                Creates a demo boundary around {area} and makes you its admin.
              </p>
            </div>
            <label className="block text-sm font-bold">
              Community name
              <input
                className={`${field} mt-2`}
                required
                minLength={2}
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={`${area} Neighbourhood Watch`}
              />
            </label>
            <button className="btn-primary" disabled={Boolean(pending.create)}>
              {pending.create ? 'Creating…' : 'Create community'}
            </button>
          </form>

          <div className={panel}>
            <h2 className="text-xl font-bold">Communities</h2>
            <div className="mt-3 space-y-2">
              {loading ? (
                <div role="status" aria-live="polite" className="space-y-2">
                  <p className="text-sm text-ink-soft">Loading communities…</p>
                  <Skeleton className="h-14" />
                  <Skeleton className="h-14" />
                </div>
              ) : communities.length ? (
                communities.map((community) => {
                  const selected = detail?.id === community.id;
                  return (
                    <button
                      key={community.id}
                      className={`w-full rounded-xl border px-3 py-2 text-left text-sm ${
                        selected ? 'border-primary bg-primary-soft' : 'border-ink/10'
                      }`}
                      aria-current={selected ? 'true' : undefined}
                      disabled={Boolean(pending.select)}
                      onClick={() => selectCommunity(community.id)}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span>
                          <span className="font-bold">{community.name}</span>
                          <span className="ml-2 text-xs text-ink-soft">
                            {community.status} | {community.plan}
                          </span>
                        </span>
                        {selected && (
                          <span className="shrink-0 rounded-full bg-primary px-2 py-1 text-[10px] font-black text-ink">
                            Selected
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })
              ) : (
                <p className="text-sm text-ink-soft">
                  No communities yet. Create the first one.
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-5">
          {loading || loadingDetail ? (
            <div
              role="status"
              aria-live="polite"
              className={`${panel} space-y-3`}
            >
              <p className="text-sm text-ink-soft">
                {loading ? 'Loading community details…' : 'Switching community…'}
              </p>
              <Skeleton className="h-8 w-1/2" />
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
            </div>
          ) : detail ? (
            <>
              <div className={panel}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-xl font-bold">{detail.name}</h2>
                  <span className="rounded-full bg-primary-soft px-3 py-1 text-xs font-bold text-primary-dark">
                    {detail.status} | {detail.plan}
                  </span>
                </div>
                <p className="mt-2 text-sm text-ink-soft">
                  Selected community | Admin:{' '}
                  {detail.admin?.displayName || 'Unknown'} |{' '}
                  {detail.responders?.length || 0} responders
                </p>
                <ul className="mt-4 space-y-2">
                  {detail.responders?.length ? (
                    detail.responders.map((responder) => {
                      const removeKey = `remove:${responder.userId}`;
                      return (
                        <li
                          key={responder.userId}
                          className="flex items-center justify-between rounded-xl border border-ink/10 px-3 py-2 text-sm"
                        >
                          <span>
                            {responder.displayName || responder.userId} |{' '}
                            {responder.status}
                          </span>
                          {isAdmin && (
                            <button
                              className="text-xs font-bold text-red-700 underline disabled:cursor-not-allowed disabled:no-underline disabled:text-ink-soft"
                              disabled={Boolean(pending[removeKey])}
                              onClick={() => removeResponder(responder.userId)}
                            >
                              {pending[removeKey] ? 'Removing…' : 'Remove'}
                            </button>
                          )}
                        </li>
                      );
                    })
                  ) : (
                    <li className="text-sm text-ink-soft">
                      No responders yet. Add a responder below to receive SOS
                      alerts for this community.
                    </li>
                  )}
                </ul>
              </div>

              {isAdmin && (
                <div className={`${panel} space-y-4`}>
                  <h2 className="text-xl font-bold">Add a responder</h2>
                  <form onSubmit={lookup} className="flex flex-wrap gap-2">
                    <input
                      className={`${field} flex-1`}
                      required
                      value={phone}
                      onChange={(e) => {
                        setPhone(e.target.value);
                        setCandidate(null);
                        setPhoneError('');
                      }}
                      placeholder="+2348012345678"
                      aria-invalid={Boolean(phoneError)}
                      aria-describedby={
                        phoneError ? 'responder-phone-error' : 'responder-phone-help'
                      }
                    />
                    <button
                      className="btn-outline"
                      disabled={Boolean(pending.lookup)}
                    >
                      {pending.lookup ? 'Finding…' : 'Find account'}
                    </button>
                  </form>
                  <p
                    id={phoneError ? 'responder-phone-error' : 'responder-phone-help'}
                    className={`text-xs ${
                      phoneError ? 'text-red-700' : 'text-ink-soft'
                    }`}
                  >
                    {phoneError ||
                      'Use 08012345678 or +2348012345678; spaces and dashes are ignored.'}
                  </p>
                  {candidate && (
                    <div className="rounded-xl bg-primary-soft p-3 text-sm">
                      <p>
                        {candidate.displayName} | {candidate.phone} |{' '}
                        {candidate.role}
                      </p>
                      <button
                        className="btn-primary mt-3"
                        disabled={Boolean(pending.add)}
                        onClick={addResponder}
                      >
                        {pending.add
                          ? 'Adding…'
                          : `Add ${candidate.displayName} as responder`}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {isAdmin && (
                <div className={`${panel} space-y-4`}>
                  <h2 className="text-xl font-bold">Billing</h2>
                  <p className="text-sm text-ink-soft">
                    Add a demo billing record, or initialize and verify a
                    subscription payment for {detail.name}.
                  </p>
                  <label className="block text-sm font-bold">
                    Plan
                    <select
                      className={`${field} mt-2`}
                      value={plan}
                      onChange={(e) => setPlan(e.target.value)}
                    >
                      {['standard', 'premium', 'enterprise'].map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </label>
                  <form onSubmit={createSubscription}>
                    <button
                      className="btn-outline"
                      disabled={Boolean(pending.subscription)}
                    >
                      {pending.subscription
                        ? 'Adding…'
                        : 'Add demo subscription'}
                    </button>
                  </form>
                  <form onSubmit={initializePayment} className="space-y-3">
                    <label className="block text-sm font-bold">
                      Payment email{' '}
                      <span className="font-normal text-ink-soft">
                        (optional)
                      </span>
                      <input
                        className={`${field} mt-2`}
                        type="email"
                        value={paymentEmail}
                        onChange={(e) => setPaymentEmail(e.target.value)}
                        placeholder="admin@example.com"
                      />
                    </label>
                    <button
                      className="btn-primary"
                      disabled={Boolean(pending.payment)}
                    >
                      {pending.payment ? 'Initializing…' : 'Pay / Initialize'}
                    </button>
                  </form>
                  {payment && (
                    <div className="space-y-2 rounded-2xl border border-ink/10 bg-white p-3 text-sm">
                      <p className="font-bold">Reference: {payment.reference}</p>
                      <p className="text-ink-soft">
                        {payment.plan} | {money(payment.amount, payment.currency)}{' '}
                        |{' '}
                        <span
                          className={
                            payment.status === 'succeeded'
                              ? 'font-bold text-green-800'
                              : 'font-bold text-amber-800'
                          }
                        >
                          {payment.status}
                        </span>
                      </p>
                      {payment.authorizationUrl && (
                        <a
                          className="block break-all font-bold text-primary underline"
                          href={payment.authorizationUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open payment authorization link (opens in a new tab)
                        </a>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <button
                          className="btn-outline"
                          disabled={Boolean(pending['payment-verify'])}
                          onClick={verifyPayment}
                        >
                          {pending['payment-verify']
                            ? 'Verifying…'
                            : 'Verify payment'}
                        </button>
                        <button
                          className="btn-outline"
                          disabled={Boolean(pending['payment-refresh'])}
                          onClick={refreshPayment}
                        >
                          {pending['payment-refresh']
                            ? 'Checking…'
                            : 'Check status'}
                        </button>
                      </div>
                    </div>
                  )}
                  <div>
                    <h3 className="text-sm font-bold">Subscriptions</h3>
                    <ul className="mt-2 space-y-2">
                      {subscriptions.map((subscription) => {
                        const cancelKey = `cancel:${subscription.id}`;
                        return (
                          <li
                            key={subscription.id}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-ink/10 px-3 py-2 text-sm"
                          >
                            <span>
                              {subscription.plan} | {subscription.status} | renews{' '}
                              {new Date(
                                subscription.renewalDate,
                              ).toLocaleDateString('en-NG')}
                            </span>
                            {subscription.status === 'active' && (
                              <button
                                className="text-xs font-bold text-red-700 underline disabled:cursor-not-allowed disabled:no-underline disabled:text-ink-soft"
                                disabled={Boolean(pending[cancelKey])}
                                onClick={() => cancelSubscription(subscription.id)}
                              >
                                {pending[cancelKey] ? 'Cancelling…' : 'Cancel'}
                              </button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className={`${panel} py-10 text-center text-sm text-ink-soft`}>
              Select or create a community to see responders and billing.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
