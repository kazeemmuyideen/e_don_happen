import { useCallback, useEffect, useState } from 'react';
import { api, session } from '../lib/api.js';

const field =
  'w-full rounded-xl border border-ink/15 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary';
const panel = 'rounded-3xl border border-ink/10 bg-white p-5 shadow-sm';

const MIME_EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

function scanBadgeClasses(state) {
  if (state === 'clean') return 'bg-green-100 text-green-800';
  if (state === 'infected') return 'bg-red-100 text-red-800';
  return 'bg-amber-100 text-amber-900';
}

function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsDataURL(file);
  });
}

export default function EvidencePanel({
  reportId,
  profile,
  canUpload = false,
  onChanged,
}) {
  const [assets, setAssets] = useState([]);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const moderator = ['moderator', 'super_admin'].includes(profile?.role);

  const load = useCallback(async () => {
    setAssets(await api(`/reports/${reportId}/evidence`));
  }, [reportId]);

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
      onChanged?.();
      if (success) setNotice(success);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function upload(event) {
    event.preventDefault();
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setError('Images must be 5 MB or smaller.');
      return;
    }
    await run(async () => {
      const data = await readAsBase64(file);
      await api(`/reports/${reportId}/evidence`, {
        method: 'POST',
        body: {
          fileName: file.name,
          mimeType: file.type,
          data,
        },
      });
      setFile(null);
    }, 'Image uploaded and scanned. It stays hidden until a moderator approves it.');
  }

  async function open(asset) {
    if (asset.scanState !== 'clean') return;
    setError('');
    try {
      const response = await fetch(`/api/evidence/${asset.id}/file`, {
        headers: {
          Authorization: `Bearer ${session()?.accessToken || ''}`,
        },
      });
      if (!response.ok) throw new Error('Could not load this image.');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      setError(err.message);
    }
  }

  function moderate(asset, moderationState) {
    return run(
      () =>
        api(`/evidence/${asset.id}/moderation`, {
          method: 'PUT',
          body: { moderationState, reason: 'Reviewed in dashboard' },
        }),
      `Evidence ${moderationState}.`,
    );
  }

  return (
    <div className={`${panel} space-y-4`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold">Photo evidence</h3>
        <span className="text-xs text-ink-soft">
          PNG, JPEG or WebP | 5 MB max
        </span>
      </div>
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
      {assets.length ? (
        <ul className="space-y-2">
          {assets.map((asset) => {
            const openable = asset.scanState === 'clean';
            const scanDetail = [
              asset.scannedAt &&
                `Scanned: ${new Date(asset.scannedAt).toLocaleString('en-NG')}`,
              asset.scanEngine && `Engine: ${asset.scanEngine}`,
              asset.scanSignature && `Signature: ${asset.scanSignature}`,
            ]
              .filter(Boolean)
              .join(' | ');
            return (
              <li
                key={asset.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-ink/10 px-3 py-2 text-sm"
              >
                <button
                  className="text-left font-semibold underline disabled:cursor-not-allowed disabled:text-ink-soft disabled:no-underline"
                  disabled={!openable || busy}
                  title={
                    openable
                      ? 'Open image'
                      : 'This file cannot be opened because its scan did not pass'
                  }
                  onClick={() => open(asset)}
                >
                  {asset.fileName || 'Evidence image'}
                </button>
                <span className="flex items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-1 text-xs font-bold capitalize ${scanBadgeClasses(asset.scanState)}`}
                    title={scanDetail || undefined}
                  >
                    Scan: {asset.scanState}
                  </span>
                  <span className="text-xs capitalize text-ink-soft">
                    {asset.moderationState}
                  </span>
                </span>
                {moderator && asset.moderationState !== 'approved' && (
                  <span className="flex gap-2">
                    <button
                      className="text-xs font-bold underline"
                      disabled={busy}
                      onClick={() => moderate(asset, 'approved')}
                    >
                      Approve
                    </button>
                    <button
                      className="text-xs font-bold text-red-700 underline"
                      disabled={busy}
                      onClick={() => moderate(asset, 'rejected')}
                    >
                      Reject
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-ink-soft">No visible photos for this report.</p>
      )}
      {canUpload && (
        <form onSubmit={upload} className="space-y-3">
          <label className="block text-sm font-bold">
            Add a photo
            <input
              className={`${field} mt-2`}
              type="file"
              accept={Object.keys(MIME_EXTENSIONS).join(',')}
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              disabled={busy}
            />
          </label>
          <button className="btn-outline" disabled={busy || !file}>
            {busy ? 'Uploading...' : 'Upload evidence'}
          </button>
        </form>
      )}
    </div>
  );
}
