'use client';

import React, { useState, useEffect } from 'react';

interface WhatsAppStatusResponse {
  isConnected: boolean;
  status: 'DISCONNECTED' | 'SCAN_QR' | 'CONNECTING' | 'CONNECTED';
  connectedNumber: string | null;
  qrDataUrl: string | null;
  lastError: string | null;
}

interface Props {
  className?: string;
  showTextAlways?: boolean;
}

export function WhatsAppIndicator({ className = '', showTextAlways = true }: Props) {
  const [status, setStatus] = useState<WhatsAppStatusResponse | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const [testResult, setTestResult] = useState<string | null>(null);
  const [isSendingTest, setIsSendingTest] = useState(false);

  const fetchStatus = async () => {
    try {
      const res = await fetch('http://localhost:5000/api/whatsapp/status', {
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
      }
    } catch {
      // Backend may not be reachable
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, showModal ? 4000 : 15000);
    return () => clearInterval(interval);
  }, [showModal]);

  const handleLogout = async () => {
    if (!window.confirm('Are you sure you want to unlink the current WhatsApp number?')) return;
    setLoading(true);
    try {
      await fetch('http://localhost:5000/api/whatsapp/logout', { method: 'POST' });
      await fetchStatus();
    } catch (err: any) {
      alert(err?.message || 'Failed to logout WhatsApp session');
    } finally {
      setLoading(false);
    }
  };

  const handleSendTest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testPhone.trim()) return;
    setIsSendingTest(true);
    setTestResult(null);
    try {
      const res = await fetch('http://localhost:5000/api/whatsapp/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: testPhone.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setTestResult('✅ Test receipt sent successfully to your WhatsApp!');
        setTestPhone('');
      } else {
        setTestResult(`❌ Failed: ${data?.error || 'Error sending'}`);
      }
    } catch (err: any) {
      setTestResult(`❌ Failed to send: ${err?.message || 'Error sending message'}`);
    } finally {
      setIsSendingTest(false);
    }
  };

  const isConnected = status?.isConnected ?? false;
  const isScanQr = status?.status === 'SCAN_QR';

  return (
    <>
      <button
        type="button"
        onClick={() => setShowModal(true)}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-all cursor-pointer shadow-sm ${
          isConnected
            ? 'bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100'
            : isScanQr
            ? 'bg-amber-100 text-amber-900 border-amber-400 hover:bg-amber-200 animate-pulse ring-2 ring-amber-400/40'
            : 'bg-emerald-600 hover:bg-emerald-700 text-white border-transparent'
        } ${className}`}
        title="Enactus WhatsApp Automated Billing Gateway"
      >
        <span className="text-sm">💬</span>
        <span className={showTextAlways ? 'inline' : 'hidden sm:inline'}>
          {isConnected
            ? `WhatsApp: +${status?.connectedNumber || 'Linked'}`
            : isScanQr
            ? '📲 Link WhatsApp (Scan QR)'
            : '📲 Link WhatsApp'}
        </span>
      </button>

      {/* Modal for QR scan & management */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-5 border border-slate-200 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center text-lg">
                  💬
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Enactus WhatsApp Gateway</h3>
                  <p className="text-[11px] text-slate-500">Automated Bill Delivery to Customers</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer text-lg font-bold"
              >
                ✕
              </button>
            </div>

            {/* Status section */}
            {isConnected ? (
              <div className="space-y-4">
                <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl flex items-start gap-3">
                  <span className="text-emerald-600 text-lg">✓</span>
                  <div>
                    <h4 className="text-xs font-bold text-emerald-900">WhatsApp Gateway Active & Connected</h4>
                    <p className="text-[11px] text-emerald-800 mt-0.5">
                      Customer bills will automatically be sent from <strong>+{status?.connectedNumber}</strong> whenever contact numbers are submitted.
                    </p>
                  </div>
                </div>

                {/* Send a test receipt */}
                <form onSubmit={handleSendTest} className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-2.5">
                  <label className="text-xs font-bold text-slate-700 block">
                    Test Auto-Billing Dispatch
                  </label>
                  <p className="text-[11px] text-slate-500">
                    Enter your WhatsApp phone number to receive a sample Enactus VIPS bill:
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="tel"
                      value={testPhone}
                      onChange={(e) => setTestPhone(e.target.value)}
                      placeholder="e.g. 9876543210"
                      className="flex-1 px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 font-mono"
                    />
                    <button
                      type="submit"
                      disabled={isSendingTest || !testPhone.trim()}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg cursor-pointer shadow-sm"
                    >
                      {isSendingTest ? 'Sending...' : 'Send'}
                    </button>
                  </div>
                  {testResult && (
                    <div className="text-[11px] font-medium pt-1">
                      {testResult}
                    </div>
                  )}
                </form>

                <div className="pt-2 flex justify-between items-center text-xs">
                  <button
                    type="button"
                    onClick={handleLogout}
                    disabled={loading}
                    className="text-rose-600 hover:text-rose-800 font-semibold cursor-pointer"
                  >
                    Unlink This WhatsApp Number
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="px-4 py-1.5 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-lg cursor-pointer"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : isScanQr && status?.qrDataUrl ? (
              <div className="space-y-4 text-center">
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 inline-block mx-auto shadow-sm">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={status.qrDataUrl}
                    alt="Scan WhatsApp QR"
                    className="w-56 h-56 mx-auto rounded-lg"
                  />
                  <div className="flex items-center justify-center gap-1.5 mt-2 text-slate-500 text-[10px]">
                    <span>🔄 Auto-refreshes automatically</span>
                  </div>
                </div>

                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-left text-xs space-y-1 text-amber-900">
                  <div className="font-bold flex items-center gap-1.5">
                    <span>📱 How to connect Enactus VIPS phone:</span>
                  </div>
                  <ol className="list-decimal list-inside text-[11px] space-y-0.5 text-amber-800 pl-1">
                    <li>Open WhatsApp on the Enactus phone</li>
                    <li>Tap <strong>Settings</strong> or the 3 dots (⋮)</li>
                    <li>Select <strong>Linked Devices</strong> &rarr; <strong>Link a Device</strong></li>
                    <li>Point camera at this screen to scan the QR code</li>
                  </ol>
                </div>
              </div>
            ) : (
              <div className="py-8 text-center space-y-3">
                <div className="text-2xl animate-spin inline-block">⏳</div>
                <p className="text-xs font-semibold text-slate-700">Connecting to WhatsApp Gateway...</p>
                <p className="text-[11px] text-slate-500 max-w-xs mx-auto">
                  Ensure the backend service is running (<code>npm run dev:backend</code>) on port 5000.
                </p>
                <button
                  type="button"
                  onClick={fetchStatus}
                  className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs rounded-lg cursor-pointer inline-flex items-center gap-1"
                >
                  Refresh Status
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
