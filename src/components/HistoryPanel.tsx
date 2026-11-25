import { useState } from 'react';
import {
  Clock,
  Download,
  History as HistoryIcon,
  Loader2,
  LogOut,
  RotateCcw,
  Trash2,
  UserCheck,
  UserPlus,
} from 'lucide-react';
import {
  GUEST_HISTORY_LIMIT,
  type HistoryEntry,
  type HistoryUser,
} from '../lib/historyStore';

interface HistoryPanelProps {
  user: HistoryUser | null;
  entries: HistoryEntry[];
  isLoadingHistory: boolean;
  onReloadEntry: (entry: HistoryEntry) => void;
  onDeleteEntry: (entryId: string) => void;
  onAuthLogin: (username: string, password: string) => Promise<void>;
  onAuthRegister: (username: string, password: string) => Promise<void>;
  onAuthLogout: () => Promise<void>;
}

function formatHistoryTimestamp(ts: number): string {
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(ts);
  }
}

export function HistoryPanel({
  user,
  entries,
  isLoadingHistory,
  onReloadEntry,
  onDeleteEntry,
  onAuthLogin,
  onAuthRegister,
  onAuthLogout,
}: HistoryPanelProps) {
  const [authMode, setAuthMode] = useState<'none' | 'login' | 'register'>('none');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const visibleEntries = user ? entries : entries.slice(0, GUEST_HISTORY_LIMIT);

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    const cleanUser = username.trim();
    if (!cleanUser || !password) {
      setAuthError('Enter both a username and password.');
      return;
    }
    setAuthSubmitting(true);
    try {
      if (authMode === 'register') {
        await onAuthRegister(cleanUser, password);
      } else {
        await onAuthLogin(cleanUser, password);
      }
      setAuthMode('none');
      setPassword('');
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setAuthSubmitting(false);
    }
  };

  return (
    <section id="history" aria-label="Render History" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-base font-semibold text-slate-900">
            History
          </h2>
          <p className="text-xs text-slate-500">
            {user
              ? `Signed in as ${user.username} · Saving last 5+ videos`
              : `Guest mode · Only ${GUEST_HISTORY_LIMIT} recent videos saved`}
          </p>
        </div>

        {user ? (
          <button
            type="button"
            onClick={() => void onAuthLogout()}
            className="inline-flex items-center gap-1.5 min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-medium bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer whitespace-nowrap"
          >
            <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
            Sign Out
          </button>
        ) : (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                setAuthMode((m) => (m === 'register' ? 'none' : 'register'));
                setAuthError(null);
              }}
              className="inline-flex items-center gap-1.5 min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#7C3AED] hover:bg-[#6D28D9] text-white transition-colors cursor-pointer whitespace-nowrap"
            >
              <UserPlus className="w-3.5 h-3.5" aria-hidden="true" />
              Create Account
            </button>
            <button
              type="button"
              onClick={() => {
                setAuthMode((m) => (m === 'login' ? 'none' : 'login'));
                setAuthError(null);
              }}
              className="inline-flex items-center gap-1.5 min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-medium bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer whitespace-nowrap"
            >
              Sign In
            </button>
          </div>
        )}
      </div>

      {/* Account Create / Login Form */}
      {!user && authMode !== 'none' && (
        <form
          onSubmit={handleAuthSubmit}
          className="rounded-lg bg-slate-50 border border-slate-200 p-3.5 space-y-2.5"
          noValidate
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-900 inline-flex items-center gap-1.5">
              <UserCheck className="w-3.5 h-3.5 text-[#7C3AED]" aria-hidden="true" />
              {authMode === 'register'
                ? 'Create account to save 5+ videos'
                : 'Sign in to your history'}
            </span>
            <button
              type="button"
              onClick={() => setAuthMode(authMode === 'register' ? 'login' : 'register')}
              className="text-[11px] font-medium text-[#7C3AED] hover:underline cursor-pointer"
            >
              {authMode === 'register' ? 'Have an account? Sign In' : 'Need an account? Register'}
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label htmlFor="history-auth-username" className="sr-only">
                Username
              </label>
              <input
                id="history-auth-username"
                type="text"
                autoComplete="username"
                placeholder="Username (3+ chars)"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full min-h-[38px] rounded-lg bg-white border border-slate-300 px-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#7C3AED]"
              />
            </div>
            <div>
              <label htmlFor="history-auth-password" className="sr-only">
                Password
              </label>
              <input
                id="history-auth-password"
                type="password"
                autoComplete={authMode === 'register' ? 'new-password' : 'current-password'}
                placeholder="Password (6+ chars)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full min-h-[38px] rounded-lg bg-white border border-slate-300 px-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#7C3AED]"
              />
            </div>
          </div>

          {authError && (
            <p role="alert" className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-2.5 py-1.5">
              {authError}
            </p>
          )}

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setAuthMode('none');
                setAuthError(null);
              }}
              className="min-h-[34px] px-3 py-1 rounded-md text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={authSubmitting}
              className="inline-flex items-center gap-1.5 min-h-[36px] px-4 py-1.5 rounded-lg text-xs font-semibold bg-[#7C3AED] hover:bg-[#6D28D9] text-white disabled:opacity-50 transition-colors cursor-pointer"
            >
              {authSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
              {authMode === 'register' ? 'Create Account' : 'Sign In'}
            </button>
          </div>
        </form>
      )}

      {!user && authMode === 'none' && (
        <div className="rounded-lg bg-amber-50/70 border border-amber-200 px-3 py-2 flex items-center justify-between gap-2 text-xs text-amber-900">
          <span>Guest saves only 2 renders. Create a free account for 5+ history.</span>
        </div>
      )}

      {/* History List */}
      {isLoadingHistory ? (
        <div className="py-8 flex items-center justify-center gap-2 text-xs text-slate-500">
          <Loader2 className="w-4 h-4 animate-spin text-[#7C3AED]" aria-hidden="true" />
          <span>Loading history...</span>
        </div>
      ) : visibleEntries.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 py-8 px-4 text-center space-y-2">
          <HistoryIcon className="w-6 h-6 text-slate-400 mx-auto" aria-hidden="true" />
          <p className="text-xs font-medium text-slate-700">No rendered videos yet</p>
          <p className="text-[11px] text-slate-500">
            Export a video to save its file, settings, and timestamp here.
          </p>
        </div>
      ) : (
        <ul aria-label="Rendered video history" className="space-y-2 max-h-[460px] overflow-y-auto pr-1">
          {visibleEntries.map((entry) => {
            const resTier = entry.settings.resolutionTier === '2160p' ? '4K' : entry.settings.resolutionTier;
            const aspect = entry.settings.frameAspect === 'auto' ? 'Auto' : entry.settings.frameAspect;
            return (
              <li
                key={entry.id}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 flex items-center justify-between gap-2.5 hover:border-slate-300 transition-colors"
              >
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="text-xs font-semibold text-slate-900 truncate" title={entry.filename}>
                    {entry.filename}
                  </p>
                  <p className="text-[11px] text-slate-500 font-mono-tabular flex items-center gap-1.5 flex-wrap">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="w-3 h-3" aria-hidden="true" />
                      {formatHistoryTimestamp(entry.timestamp)}
                    </span>
                    <span>&middot;</span>
                    <span>
                      {aspect} {resTier}
                    </span>
                    {entry.renderResult?.voiceoverEmbedded && (
                      <>
                        <span>&middot;</span>
                        <span>Voiceover</span>
                      </>
                    )}
                  </p>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => onReloadEntry(entry)}
                    aria-label={`Reload ${entry.filename}`}
                    className="inline-flex items-center gap-1 min-h-[34px] px-2.5 py-1 rounded-md text-xs font-semibold bg-purple-50 border border-purple-200 text-[#6D28D9] hover:bg-purple-100 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <RotateCcw className="w-3 h-3" aria-hidden="true" />
                    Reload
                  </button>

                  {entry.renderResult?.downloadUrl && (
                    <a
                      href={entry.renderResult.downloadUrl}
                      download
                      aria-label={`Download ${entry.filename}`}
                      className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-slate-50 border border-slate-200 text-slate-600 hover:text-[#7C3AED] hover:border-[#7C3AED] transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" aria-hidden="true" />
                    </a>
                  )}

                  <button
                    type="button"
                    onClick={() => onDeleteEntry(entry.id)}
                    aria-label={`Delete ${entry.filename} from history`}
                    className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-slate-50 border border-slate-200 text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
