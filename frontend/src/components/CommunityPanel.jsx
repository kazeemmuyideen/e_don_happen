import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { AREAS } from '../data/areas.js';

const field =
  'w-full rounded-xl border border-ink/15 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary';
const panel = 'rounded-3xl border border-ink/10 bg-white p-5 shadow-sm sm:p-6';
const ADMIN_ROLES = ['moderator', 'super_admin'];

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
  const [candidate, setCandidate] = useState(null);
  const [plan, setPlan] = useState('standard');
  const [subscriptions, setSubscriptions] = useState([]);
  const [busy, setBusy] = useState(false);
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
    loadList().catch((err) => {
      if (active) setError(err.message);
    });
    return () => {
      active = false;
    };
  }, [loadList]);

  async function run(work, success) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
      if (success) setNotice(success);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function createCommunity(event) {
    event.preventDefault();
    await run(async () => {
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
    await run(async () => {
      const found = await api(
        `/communities/${detail.id}/users/lookup?phone=${encodeURIComponent(
          phone.trim(),
        )}`,
      );
      setCandidate(found);
    });
  }

  async function addResponder() {
    await run(async () => {
      await api(`/communities/${detail.id}/responders`, {
        method: 'POST',
        body: {
          userId: candidate.id,
          coverageArea: squareAround(area),
        },
      });
      setCandidate(null);
      setPhone('');
      await loadDetail(detail.id);
    }, `${candidate.displayName} can now receive SOS alerts for ${detail.name}.`);
  }

  async function removeResponder(userId) {
    await run(async () => {
      await api(`/communities/${detail.id}/responders/${userId}`, {
        method: 'DELETE',
      });
      await loadDetail(detail.id);
    }, 'Responder removed.');
  }

  async function createSubscription(event) {
    event.preventDefault();
    await run(async () => {
      await api('/billing/subscriptions', {
        method: 'POST',
        body: { communityId: detail.id, plan },
      });
      await loadDetail(detail.id);
    }, `${plan} billing record created for ${detail.name}.`);
  }

  async function cancelSubscription(id) {
    await run(async () => {
      await api(`/billing/subscriptions/${id}/cancel`, { method: 'PUT' });
      await loadDetail(detail.id);
    }, 'Subscription cancelled.');
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
            <button className="btn-primary" disabled={busy}>
              {busy ? 'Working...' : 'Create community'}
            </button>
          </form>

          <div className={panel}>
            <h2 className="text-xl font-bold">Communities</h2>
            <div className="mt-3 space-y-2">
              {communities.length ? (
                communities.map((community) => (
                  <button
                    key={community.id}
                    className={`w-full rounded-xl border px-3 py-2 text-left text-sm ${
                      detail?.id === community.id
                        ? 'border-primary bg-primary-soft'
                        : 'border-ink/10'
                    }`}
                    onClick={() =>
                      run(() => loadDetail(community.id)).catch(() => {})
                    }
                  >
                    <span className="font-bold">{community.name}</span>
                    <span className="ml-2 text-xs text-ink-soft">
                      {community.status} | {community.plan}
                    </span>
                  </button>
                ))
              ) : (
                <p className="text-sm text-ink-soft">
                  No communities yet. Create the first one.
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-5">
          {detail ? (
            <>
              <div className={panel}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-xl font-bold">{detail.name}</h2>
                  <span className="rounded-full bg-primary-soft px-3 py-1 text-xs font-bold text-primary-dark">
                    {detail.status} | {detail.plan}
                  </span>
                </div>
                <p className="mt-2 text-sm text-ink-soft">
                  Admin: {detail.admin?.displayName || 'Unknown'} |{' '}
                  {detail.responders?.length || 0} responders
                </p>
                <ul className="mt-4 space-y-2">
                  {detail.responders?.length ? (
                    detail.responders.map((responder) => (
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
                            className="text-xs font-bold text-red-700 underline"
                            disabled={busy}
                            onClick={() => removeResponder(responder.userId)}
                          >
                            Remove
                          </button>
                        )}
                      </li>
                    ))
                  ) : (
                    <li className="text-sm text-ink-soft">
                      No responders yet.
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
                      }}
                      placeholder="+2348012345678"
                    />
                    <button className="btn-outline" disabled={busy}>
                      Find account
                    </button>
                  </form>
                  {candidate && (
                    <div className="rounded-xl bg-primary-soft p-3 text-sm">
                      <p>
                        {candidate.displayName} | {candidate.phone} |{' '}
                        {candidate.role}
                      </p>
                      <button
                        className="btn-primary mt-3"
                        disabled={busy}
                        onClick={addResponder}
                      >
                        Add {candidate.displayName} as responder
                      </button>
                    </div>
                  )}
                </div>
              )}

              {isAdmin && (
                <div className={`${panel} space-y-4`}>
                  <h2 className="text-xl font-bold">Billing record</h2>
                  <p className="text-sm text-ink-soft">
                    Demo records only. No payment is captured.
                  </p>
                  <form onSubmit={createSubscription} className="flex flex-wrap gap-2">
                    <select
                      className={`${field} flex-1`}
                      value={plan}
                      onChange={(e) => setPlan(e.target.value)}
                    >
                      {['standard', 'premium', 'enterprise'].map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                    <button className="btn-outline" disabled={busy}>
                      Add subscription
                    </button>
                  </form>
                  <ul className="space-y-2">
                    {subscriptions.map((subscription) => (
                      <li
                        key={subscription.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-ink/10 px-3 py-2 text-sm"
                      >
                        <span>
                          {subscription.plan} | {subscription.status} | renews{' '}
                          {new Date(subscription.renewalDate).toLocaleDateString(
                            'en-NG',
                          )}
                        </span>
                        {subscription.status === 'active' && (
                          <button
                            className="text-xs font-bold text-red-700 underline"
                            disabled={busy}
                            onClick={() => cancelSubscription(subscription.id)}
                          >
                            Cancel
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
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
