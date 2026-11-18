import { useCallback, useEffect, useRef, useState } from 'react';
import { api, session } from '../lib/api.js';

const field =
  'w-full rounded-xl border border-ink/15 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary';
const panel = 'rounded-3xl border border-ink/10 bg-white p-5 shadow-sm';
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 5 * 1024 * 1024;

function scanBadgeClasses(state) {
  if (state === 'clean') return 'bg-green-100 text-green-800';
  if (state === 'infected') return 'bg-red-100 text-red-800';
  return 'bg-amber-100 text-amber-900';
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function validateFile(file) {
  const extensionOk = /\.(jpe?g|png|webp)$/i.test(file.name);
  if (
    !ALLOWED_MIME_TYPES.includes(file.type) &&
    !(file.type === '' && extensionOk)
  )
    return 'Choose a PNG, JPEG or WebP image.';
  if (file.size === 0) return 'That file is empty.';
  if (file.size > MAX_BYTES) return 'Images must be 5 MB or smaller.';
  return '';
}

export default function EvidencePanel({
  reportId,
  profile,
  canUpload = false,
  onChanged,
}) {
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [file, setFile] = useState(null);
  const [fileError, setFileError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadStage, setUploadStage] = useState('');
  const [pendingAction, setPendingAction] = useState(null);
  const [openingId, setOpeningId] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [moderationReason, setModerationReason] = useState('');
  const [reasonError, setReasonError] = useState('');
  const [lightbox, setLightbox] = useState(null);
  const fileInputRef = useRef(null);
  const triggerRef = useRef(null);
  const closeRef = useRef(null);
  const moderator = ['moderator', 'super_admin'].includes(profile?.role);

  const load = useCallback(async () => {
    setAssets(await api(`/reports/${reportId}/evidence`));
  }, [reportId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
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
    return () => {
      active = false;
    };
  }, [load]);

  useEffect(() => {
    if (!lightbox) return;
    closeRef.current?.focus();
    function handleKey(event) {
      if (event.key === 'Escape') closeLightbox();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [lightbox]);

  useEffect(
    () => () => {
      if (lightbox?.url) URL.revokeObjectURL(lightbox.url);
    },
    [lightbox],
  );

  function closeLightbox() {
    setLightbox(null);
    triggerRef.current?.focus();
  }

  function selectFile(event) {
    const selected = event.target.files?.[0] || null;
    setError('');
    setNotice('');
    setFileError('');
    if (!selected) {
      setFile(null);
      return;
    }
    const problem = validateFile(selected);
    if (problem) {
      setFile(null);
      setFileError(problem);
      event.target.value = '';
      return;
    }
    setFile(selected);
  }

  async function upload(event) {
    event.preventDefault();
    if (!file) return;
    const problem = validateFile(file);
    if (problem) {
      setFileError(problem);
      return;
    }
    setError('');
    setNotice('');
    setFileError('');
    setUploading(true);
    setUploadStage('Uploading and scanning file…');
    try {
      const data = new FormData();
      data.append('file', file);
      const result = await api(`/reports/${reportId}/evidence/upload`, {
        method: 'POST',
        body: data,
      });
      setUploadStage('Refreshing evidence list…');
      await load();
      onChanged?.();
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setNotice(
        result?.scanState === 'infected'
          ? 'Upload was flagged as unsafe. It was kept for moderator review and cannot be opened.'
          : result?.scanState === 'error'
            ? 'Upload was stored, but the scanner could not finish. Its status is visible below.'
            : 'Image uploaded and submitted for scanning. It stays hidden until a moderator approves it.',
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
      setUploadStage('');
    }
  }

  async function open(asset, event) {
    if (asset.scanState !== 'clean') return;
    triggerRef.current = event.currentTarget;
    setOpeningId(asset.id);
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
      setLightbox({
        url,
        fileName: asset.fileName || 'Evidence image',
      });
    } catch (err) {
      setError(err.message);
      triggerRef.current = null;
    } finally {
      setOpeningId(null);
    }
  }

  async function moderate(asset, moderationState) {
    const reason = moderationReason.trim();
    if (!reason) {
      setReasonError('Enter a reason before reviewing this evidence.');
      return;
    }
    setReasonError('');
    setError('');
    setNotice('');
    setPendingAction(`${moderationState}:${asset.id}`);
    try {
      await api(`/evidence/${asset.id}/moderation`, {
        method: 'PUT',
        body: { moderationState, reason },
      });
      await load();
      onChanged?.();
      setModerationReason('');
      setNotice(`Evidence ${moderationState}. Reason recorded.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setPendingAction(null);
    }
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
      {moderator && (
        <label className="block text-sm font-bold">
          Moderation reason
          <input
            className={`${field} mt-2`}
            maxLength={500}
            value={moderationReason}
            onChange={(e) => {
              setModerationReason(e.target.value);
              setReasonError('');
            }}
            placeholder="Record why you are approving or rejecting evidence"
            aria-invalid={Boolean(reasonError)}
            aria-describedby={reasonError ? 'evidence-reason-error' : undefined}
          />
          {reasonError && (
            <span
              id="evidence-reason-error"
              role="alert"
              className="mt-1 block text-xs font-normal text-red-700"
            >
              {reasonError}
            </span>
          )}
        </label>
      )}
      {loading ? (
        <div role="status" aria-live="polite" className="space-y-2">
          <p className="text-sm text-ink-soft">Loading evidence…</p>
          <div aria-hidden className="h-16 animate-pulse rounded-xl bg-ink/10" />
          <div aria-hidden className="h-16 animate-pulse rounded-xl bg-ink/10" />
        </div>
      ) : assets.length ? (
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
                className="rounded-xl border border-ink/10 px-3 py-2 text-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button
                    className="text-left font-semibold underline disabled:cursor-not-allowed disabled:text-ink-soft disabled:no-underline"
                    disabled={!openable || uploading || Boolean(pendingAction)}
                    aria-label={`Open ${asset.fileName || 'evidence image'} in image viewer; scan status ${asset.scanState}`}
                    onClick={(event) => open(asset, event)}
                  >
                    {openingId === asset.id
                      ? 'Opening…'
                      : asset.fileName || 'Evidence image'}
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
                </div>
                {scanDetail && (
                  <p className="mt-1 text-xs text-ink-soft">
                    Scan details: {scanDetail}
                  </p>
                )}
                {moderator && asset.moderationState !== 'approved' && (
                  <span className="mt-2 flex gap-2">
                    <button
                      className="text-xs font-bold underline disabled:cursor-not-allowed disabled:no-underline disabled:text-ink-soft"
                      disabled={uploading || Boolean(pendingAction)}
                      onClick={() => moderate(asset, 'approved')}
                    >
                      {pendingAction === `approved:${asset.id}`
                        ? 'Approving…'
                        : 'Approve'}
                    </button>
                    <button
                      className="text-xs font-bold text-red-700 underline disabled:cursor-not-allowed disabled:no-underline disabled:text-ink-soft"
                      disabled={uploading || Boolean(pendingAction)}
                      onClick={() => moderate(asset, 'rejected')}
                    >
                      {pendingAction === `rejected:${asset.id}`
                        ? 'Rejecting…'
                        : 'Reject'}
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-ink-soft">
          No evidence is visible for this report. Uploaded photos stay hidden
          until a moderator approves them.
        </p>
      )}
      {canUpload && (
        <form onSubmit={upload} className="space-y-3" aria-busy={uploading}>
          <label className="block text-sm font-bold">
            Add a photo
            <input
              ref={fileInputRef}
              className={`${field} mt-2`}
              type="file"
              accept={ALLOWED_MIME_TYPES.join(',')}
              onChange={selectFile}
              disabled={uploading}
              aria-invalid={Boolean(fileError)}
              aria-describedby={fileError ? 'evidence-file-error' : 'evidence-file-help'}
            />
            {fileError ? (
              <span
                id="evidence-file-error"
                role="alert"
                className="mt-1 block text-xs font-normal text-red-700"
              >
                {fileError}
              </span>
            ) : (
              <span id="evidence-file-help" className="mt-1 block text-xs font-normal text-ink-soft">
                Up to 5 MB. The file is scanned before it can be opened.
              </span>
            )}
          </label>
          {file && (
            <p role="status" className="rounded-xl bg-primary-soft p-3 text-xs">
              Selected: <strong>{file.name}</strong> ({formatSize(file.size)})
            </p>
          )}
          {uploading && (
            <div role="status" aria-live="polite" className="space-y-2">
              <p className="text-sm font-semibold">
                {uploadStage || 'Preparing upload…'}
              </p>
              <div
                aria-hidden
                className="h-2 overflow-hidden rounded-full bg-primary-soft"
              >
                <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
              </div>
            </div>
          )}
          <button className="btn-outline" disabled={uploading || !file}>
            {uploading ? 'Uploading…' : 'Upload evidence'}
          </button>
        </form>
      )}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={closeLightbox}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="evidence-lightbox-title"
            className="w-full max-w-3xl rounded-2xl bg-white p-4 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <h4 id="evidence-lightbox-title" className="truncate font-bold">
                {lightbox.fileName}
              </h4>
              <button
                ref={closeRef}
                type="button"
                className="btn-outline shrink-0"
                onClick={closeLightbox}
              >
                Close
              </button>
            </div>
            <img
              src={lightbox.url}
              alt={`Evidence image: ${lightbox.fileName}`}
              className="mx-auto mt-3 max-h-[70vh] max-w-full rounded-xl object-contain"
            />
          </div>
        </div>
      )}
    </div>
  );
}
