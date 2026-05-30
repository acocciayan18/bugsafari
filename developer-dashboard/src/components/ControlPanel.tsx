// Control Panel Component - Monochrome Developer Aesthetic
// Handles target URL input and test controls only
// Part of the 2-column layout: Sidebar | ControlPanel + ForensicView

import { useState, type FormEvent } from 'react';

interface User {
  id: string;
  email: string;
}

interface ControlPanelProps {
  targetUrl: string;
  setTargetUrl: (url: string) => void;
  isConnected: boolean;
  isTestRunning: boolean;
  testStatus: 'IDLE' | 'RUNNING' | 'PAUSED';
  authToken: string | null;
  user: User | null;
  onStart: (url: string) => void;
  onPause?: () => void;
  onResume?: () => void;
  onStop?: () => void;
  onSaveSession?: () => void;
  onShowLoginPrompt?: () => void;
}

export default function ControlPanel({
  targetUrl: initialTargetUrl,
  setTargetUrl,
  isConnected,
  isTestRunning,
  testStatus,
  authToken,
  user,
  onStart,
  onPause,
  onResume,
  onStop,
  onSaveSession,
  onShowLoginPrompt,
}: ControlPanelProps) {
  const [localTargetUrl, setLocalTargetUrl] = useState(initialTargetUrl);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const isLoggedIn = !!user && !!authToken;

  const handleStartTest = (e?: FormEvent) => {
    e?.preventDefault();
    if (localTargetUrl && onStart) {
      onStart(localTargetUrl);
    }
  };

  const handleSaveSession = async () => {
    if (!authToken || !user) {
      if (onShowLoginPrompt) {
        onShowLoginPrompt();
      }
      return;
    }

    setIsSaving(true);
    setSaveMessage(null);

    try {
      const API_BASE_URL = import.meta.env.VITE_BUGSAFARI_API_URL ?? 'http://localhost:3000';
      const response = await fetch(`${API_BASE_URL}/api/history/save-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ targetUrl: localTargetUrl }),
      });

      const data = await response.json();

      if (!response.ok) {
        setSaveMessage(data.error || 'Failed to save session');
        return;
      }

      setSaveMessage('Session saved successfully!');
      setTimeout(() => setSaveMessage(null), 3000);
    } catch {
      setSaveMessage('Unable to connect to server');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="w-[27%] flex flex-col border-r border-slate-200 bg-white">
      {/* Infiltration Target Card */}
      <div className="border-b border-slate-200 p-5">
        {/* Header with Status Badge */}
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-bold tracking-wider text-slate-900">
            INFILTRATION TARGET
          </h2>
          <span className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold ${
            isTestRunning
              ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
              : 'border-slate-300 bg-white text-slate-600'
          }`}>
            <span className={`h-1.5 w-1.5 rounded-full ${
              isTestRunning ? 'bg-emerald-500' : 'bg-slate-400'
            }`} />
            {isTestRunning ? '● LIVE' : '● READY'}
          </span>
        </div>

        {/* Target URL Input */}
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
          <svg className="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-1.343 3-3m0-3c0-1.657-1.343-3-3-3m0 3c-1.657 0-3 1.343-3 3m3-3c0 1.657 1.343 3 3 3m0-3c0-1.657-1.343-3-3-3" />
          </svg>
          <input
            type="text"
            className="flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
            placeholder="Enter target URL..."
            value={localTargetUrl}
            onChange={(e) => setLocalTargetUrl(e.target.value)}
          />
        </div>

        {/* Main Action Button */}
        <button
          onClick={() => handleStartTest()}
          className="flex w-full items-center justify-center gap-2 rounded-none bg-black px-4 py-3 text-sm font-bold text-white hover:bg-slate-800"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M10 8l6 4-6 4V8z" fill="currentColor" />
          </svg>
          INITIALIZE EXPLORATORY SAFARI
        </button>

        {/* Save to History Button */}
        <button
          onClick={handleSaveSession}
          disabled={isSaving}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-none border border-slate-300 px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
          </svg>
          {isSaving ? 'Saving...' : 'Save to History'}
        </button>

        {/* Save Message Feedback */}
        {saveMessage && (
          <div className={`mt-2 p-2 rounded text-xs font-medium ${
            saveMessage.includes('success')
              ? 'bg-green-50 text-green-700 border border-green-200'
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}>
            {saveMessage}
          </div>
        )}

        {/* Test Control Buttons - Pause/Resume/Stop */}
        {(testStatus === 'RUNNING' || testStatus === 'PAUSED') && (
          <div className="mt-3 flex gap-2">
            {testStatus === 'RUNNING' && onPause && (
              <button
                onClick={onPause}
                className="flex-1 flex items-center justify-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-100 transition-colors"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 9v6m4-6v6m7-3a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Pause
              </button>
            )}
            {testStatus === 'PAUSED' && onResume && (
              <button
                onClick={onResume}
                className="flex-1 flex items-center justify-center gap-2 rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-xs font-semibold text-green-700 hover:bg-green-100 transition-colors"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                </svg>
                Resume
              </button>
            )}
            {onStop && (
              <button
                onClick={onStop}
                className="flex-1 flex items-center justify-center gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100 transition-colors"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                </svg>
                Stop
              </button>
            )}
          </div>
        )}
      </div>

      {/* Optimization Matrix */}
      <div className="flex-1 p-5">
        <div className="mb-4 text-xs font-bold tracking-wider text-slate-700">
          OPTIMIZATION MATRIX
        </div>

        <div className="space-y-3">
          {/* Switch Row 1 */}
          <div className="flex items-center justify-between rounded-lg border border-slate-200 p-3">
            <span className="text-xs font-medium text-slate-700">
              Adaptive Risk Scorer
            </span>
            <button className="relative h-6 w-10 rounded-full bg-slate-300 transition-colors">
              <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow" />
            </button>
          </div>

          {/* Switch Row 2 */}
          <div className="flex items-center justify-between rounded-lg border border-slate-200 p-3">
            <span className="text-xs font-medium text-slate-700">
              State-Aware Domain Hashing
            </span>
            <button className="relative h-6 w-10 rounded-full bg-slate-300 transition-colors">
              <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow" />
            </button>
          </div>

          {/* Switch Row 3 */}
          <div className="flex items-center justify-between rounded-lg border border-slate-200 p-3">
            <span className="text-xs font-medium text-slate-700">
              Concurrent Event Spamming
            </span>
            <button className="relative h-6 w-10 rounded-full bg-slate-300 transition-colors">
              <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow" />
            </button>
          </div>
        </div>
      </div>

      {/* Footer Security Protocol */}
      <div className="border-t border-slate-200 p-4">
        <p className="text-[10px] text-slate-400">
          🛡️ SECURITY PROTOCOL: AES-256 ACTIVE
        </p>
      </div>
    </section>
  );
}
