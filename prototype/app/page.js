"use client";

import { useState, useEffect } from 'react';

const BACKEND_URL = 'http://localhost:3000';

// Sample sites for easy testing in the sandbox
const SAMPLE_SITES = [
  { name: 'Alza (Mock In Stock)', url: 'https://www.alza.cz/mobilni-telefony/18851259.htm' },
  { name: 'CZC (Mock Out of Stock)', url: 'https://www.czc.cz/out-of-stock-sample-product' },
  { name: 'Datart (Mock Delayed Delivery)', url: 'https://www.datart.cz/availability-delayed-sample-product' },
];

export default function Home() {
  const [merchants, setMerchants] = useState([]);
  const [selectedMerchant, setSelectedMerchant] = useState(null);
  const [apiOnline, setApiOnline] = useState(false);
  
  // Sandbox Simulator State
  const [sandboxUrl, setSandboxUrl] = useState('');
  const [reportedStock, setReportedStock] = useState('IN_STOCK');
  const [isVerifying, setIsVerifying] = useState(false);
  const [simulationLogs, setSimulationLogs] = useState([]);
  const [verificationResult, setVerificationResult] = useState(null);

  // Load initial merchant data and check health
  useEffect(() => {
    checkHealthAndFetchData();
    // Poll updates every 5 seconds
    const interval = setInterval(checkHealthAndFetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  const checkHealthAndFetchData = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/merchants`);
      if (res.ok) {
        setApiOnline(true);
        const data = await res.json();
        setMerchants(data);
      } else {
        setApiOnline(false);
      }
    } catch (err) {
      setApiOnline(false);
    }
  };

  const fetchMerchantDetails = async (domain) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/merchants/${domain}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedMerchant(data);
      }
    } catch (err) {
      console.error('Failed to load merchant details:', err);
    }
  };

  // Run the full verification simulation pipeline
  const handleSimulateVerification = async (e) => {
    e.preventDefault();
    if (!sandboxUrl) return;

    setIsVerifying(true);
    setVerificationResult(null);
    setSimulationLogs([]);

    // Helpers to append logs step by step to simulate pipeline latency
    const addLog = (text, type = 'info') => {
      setSimulationLogs(prev => [...prev, { text, type, time: new Date().toLocaleTimeString() }]);
    };

    try {
      addLog(`[Trigger] Initializing real-time verifier for URL: ${sandboxUrl}`, 'trigger');
      await new Promise(r => setTimeout(r, 800));

      addLog(`[Puppeteer] Launching headless browser context...`, 'puppeteer');
      await new Promise(r => setTimeout(r, 600));

      addLog(`[Puppeteer] Navigating to page & intercepting media assets to optimize load times...`, 'puppeteer');
      await new Promise(r => setTimeout(r, 1200));

      addLog(`[Puppeteer] Heuristic scan searching for purchase/stock layout regions...`, 'scraper');
      await new Promise(r => setTimeout(r, 1000));

      addLog(`[Scraper] Found HTML add-to-cart snippet! Extracting cleaned outerHTML & text context (3.2KB)...`, 'scraper');
      
      // Map selections to feed values
      let repStatus = 'IN_STOCK';
      let repDays = 0;
      if (reportedStock === 'DELAYED') {
        repStatus = 'DELAYED';
        repDays = 3; // Simulate a 3-day feed delay default
      } else if (reportedStock === 'OUT_OF_STOCK') {
        repStatus = 'OUT_OF_STOCK';
        repDays = null;
      }

      // Trigger actual backend sync call
      const res = await fetch(`${BACKEND_URL}/api/verify-sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
          url: sandboxUrl,
          reportedStatus: repStatus,
          reportedDays: repDays
        })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Server processing error.');
      }

      const data = await res.json();

      addLog(`[Gemini Flash] Parsing snippet using schema-based JSON mode...`, 'gemini');
      await new Promise(r => setTimeout(r, 1500));

      addLog(`[Gemini Flash] Resolved status: ${data.status} | shipping_days: ${data.shipping_days} | reasoning: ${data.reasoning || 'N/A'}`, 'gemini');
      
      // Matching rules
      let isDiscrepancy = false;
      if (data.status === 'OUT_OF_STOCK' && repStatus !== 'OUT_OF_STOCK') {
        isDiscrepancy = true;
      } else if (data.status === 'DELAYED') {
        if (repStatus === 'IN_STOCK' || (repStatus === 'DELAYED' && data.shipping_days > repDays)) {
          isDiscrepancy = true;
        }
      }

      addLog(`[Scoring Engine] Feed reported: ${reportedStock} (limit: ${repDays}d) vs Scraped: ${data.status} (actual: ${data.shipping_days}d)`, 'engine');
      if (isDiscrepancy) {
        addLog(`[Scoring Engine] Discrepancy detected! Adjusting merchant score to ${data.merchant.score}%`, 'error');
      } else {
        addLog(`[Scoring Engine] Stock matching successful. Current score: ${data.merchant.score}%`, 'success');
      }

      setVerificationResult(data);
      checkHealthAndFetchData(); // refresh table

      // Update selected merchant views
      if (selectedMerchant && selectedMerchant.domain === data.merchant.domain) {
        fetchMerchantDetails(data.merchant.domain);
      }

    } catch (err) {
      console.error(err);
      addLog(`[Pipeline Error] Verification cycle failed: ${err.message}`, 'error');
    } finally {
      setIsVerifying(false);
    }
  };

  const getScoreColorClass = (score) => {
    if (score >= 90) return 'text-emerald-400';
    if (score >= 70) return 'text-amber-400';
    return 'text-rose-400';
  };

  const getScoreBgClass = (score) => {
    if (score >= 90) return 'bg-emerald-500';
    if (score >= 70) return 'bg-amber-500';
    return 'bg-rose-500';
  };

  return (
    <div className="flex-1 flex flex-col p-6 max-w-7xl mx-auto w-full gap-6">
      {/* Header section */}
      <header className="flex justify-between items-center bg-slate-900/60 backdrop-blur-xl border border-white/10 rounded-xl p-5 shadow-xl">
        <div className="flex items-center gap-3">
          <span className="text-3xl">🛡️</span>
          <div>
            <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">
              Heureka Stock Reliability Hub
            </h1>
            <p className="text-xs text-slate-400">AI-Powered XML Feed Mismatch Discrepancy Detector</p>
          </div>
        </div>
        
        <div className="flex items-center gap-2 bg-slate-950/60 border border-white/5 px-4 py-2 rounded-full">
          <span className={`w-2.5 h-2.5 rounded-full ${apiOnline ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
            Backend API: {apiOnline ? 'Online' : 'Offline'}
          </span>
        </div>
      </header>

      {/* Main Grid Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1 items-start">
        
        {/* Left Side: Scoreboard & Details (Column span 7) */}
        <div className="lg:col-span-7 flex flex-col gap-6">
          
          {/* Merchant Scoreboard List */}
          <div className="bg-slate-900/60 backdrop-blur-xl border border-white/10 rounded-xl p-6 shadow-2xl">
            <h2 className="text-sm font-semibold tracking-wider uppercase text-slate-400 mb-4">
              Merchant Rankings
            </h2>
            
            {merchants.length === 0 ? (
              <div className="text-center py-10 border border-dashed border-white/5 rounded-lg text-slate-500 text-sm">
                No active records. Simulate a verify check on the right to register a merchant.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-white/5 text-slate-500 text-xs">
                      <th className="pb-3 font-medium">Domain</th>
                      <th className="pb-3 font-medium">Reliability score</th>
                      <th className="pb-3 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {merchants.map((m) => (
                      <tr 
                        key={m.domain} 
                        className={`border-b border-white/5 hover:bg-white/2.5 transition-colors cursor-pointer ${selectedMerchant?.domain === m.domain ? 'bg-white/5' : ''}`}
                        onClick={() => fetchMerchantDetails(m.domain)}
                      >
                        <td className="py-4 font-medium text-slate-200">{m.domain}</td>
                        <td className="py-4">
                          <div className="flex items-center gap-3">
                            <span className={`font-bold w-10 text-right ${getScoreColorClass(m.score)}`}>
                              {m.score}%
                            </span>
                            <div className="w-28 bg-slate-800 rounded-full h-1.5 overflow-hidden">
                              <div 
                                className={`h-full ${getScoreBgClass(m.score)}`} 
                                style={{ width: `${m.score}%` }} 
                              />
                            </div>
                          </div>
                        </td>
                        <td className="py-4 text-right">
                          <button 
                            className="text-xs text-blue-400 hover:text-blue-300 font-semibold underline"
                            onClick={(e) => {
                              e.stopPropagation();
                              fetchMerchantDetails(m.domain);
                            }}
                          >
                            Audit logs
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Selected Merchant Audit History Details */}
          {selectedMerchant && (
            <div className="bg-slate-900/60 backdrop-blur-xl border border-white/10 rounded-xl p-6 shadow-2xl animate-fadeIn">
              <div className="flex justify-between items-center border-b border-white/10 pb-4 mb-4">
                <div>
                  <h3 className="text-base font-bold text-slate-200">{selectedMerchant.domain}</h3>
                  <p className="text-xs text-slate-400">Discrepancy Audit History Log</p>
                </div>
                <div className="text-right">
                  <span className={`text-2xl font-bold ${getScoreColorClass(selectedMerchant.score)}`}>
                    {selectedMerchant.score}%
                  </span>
                  <p className="text-[10px] text-slate-500 uppercase tracking-widest">Reliability</p>
                </div>
              </div>

              <div className="flex flex-col gap-3 max-h-96 overflow-y-auto pr-2">
                {selectedMerchant.history.length === 0 ? (
                  <p className="text-slate-500 text-sm py-4">No audit logs registered yet.</p>
                ) : (
                  selectedMerchant.history.map((h, i) => (
                    <div key={i} className="bg-slate-950/40 border border-white/5 rounded-lg p-3 text-xs">
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-[10px] text-slate-500">
                          {new Date(h.timestamp).toLocaleString()}
                        </span>
                        <span className={`font-semibold px-2 py-0.5 rounded text-[10px] ${
                          h.status === 'IN_STOCK' ? 'bg-emerald-500/10 text-emerald-400' :
                          h.status === 'DELAYED' ? 'bg-amber-500/10 text-amber-400' : 'bg-rose-500/10 text-rose-400'
                        }`}>
                          {h.status}
                        </span>
                      </div>
                      <p className="text-slate-300 mb-2 font-medium break-all">{h.url}</p>
                      <p className="text-slate-400 bg-slate-900/50 p-2 rounded border border-white/5">
                        {h.description} {h.scoreDiff !== 0 && (
                          <span className={`font-semibold ${h.scoreDiff < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                            ({h.scoreDiff > 0 ? `+${h.scoreDiff}` : h.scoreDiff} pts)
                          </span>
                        )}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right Side: Simulator Playground (Column span 5) */}
        <div className="lg:col-span-5 flex flex-col gap-6">
          <div className="bg-slate-900/60 backdrop-blur-xl border border-white/10 rounded-xl p-6 shadow-2xl">
            <h2 className="text-sm font-semibold tracking-wider uppercase text-slate-400 mb-4">
              Scraper Sandbox Simulator
            </h2>
            
            <form onSubmit={handleSimulateVerification} className="flex flex-col gap-4">
              {/* Presets */}
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wide">
                  Test Presets
                </label>
                <div className="flex flex-wrap gap-2">
                  {SAMPLE_SITES.map((preset) => (
                    <button
                      key={preset.name}
                      type="button"
                      className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded-lg border border-white/5 transition-all"
                      onClick={() => setSandboxUrl(preset.url)}
                    >
                      {preset.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* URL input */}
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wide">
                  Product Target URL
                </label>
                <input
                  type="url"
                  placeholder="https://example-shop.cz/product-1"
                  required
                  className="w-full text-sm bg-slate-950 border border-white/10 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-blue-500 transition-colors"
                  value={sandboxUrl}
                  onChange={(e) => setSandboxUrl(e.target.value)}
                />
              </div>

              {/* Reported XML feed state */}
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wide">
                  Reported XML Feed Status (Heureka)
                </label>
                <select
                  className="w-full text-sm bg-slate-950 border border-white/10 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-blue-500 transition-colors"
                  value={reportedStock}
                  onChange={(e) => setReportedStock(e.target.value)}
                >
                  <option value="IN_STOCK">IN STOCK (0 days delivery)</option>
                  <option value="DELAYED">DELAYED (XML claims delayed)</option>
                  <option value="OUT_OF_STOCK">OUT OF STOCK (XML claims sold out)</option>
                </select>
              </div>

              <button
                type="submit"
                disabled={isVerifying || !apiOnline}
                className="w-full mt-2 font-semibold text-sm bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-lg py-2.5 shadow-lg shadow-blue-500/15 hover:shadow-blue-500/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isVerifying ? 'Running Puppeteer + Gemini Flash...' : 'Run Stock Verification Pipeline'}
              </button>
            </form>

            {/* Simulated Live Logs Console */}
            {simulationLogs.length > 0 && (
              <div className="mt-6">
                <h4 className="text-xs font-semibold text-slate-400 uppercase mb-2 tracking-wide">
                  Verification Pipeline Logs
                </h4>
                <div className="bg-slate-950/80 border border-white/10 rounded-lg p-4 font-mono text-[10px] h-60 overflow-y-auto flex flex-col gap-1.5">
                  {simulationLogs.map((log, i) => (
                    <div key={i} className="flex gap-2">
                      <span className="text-slate-600">[{log.time}]</span>
                      <span className={
                        log.type === 'error' ? 'text-rose-400' :
                        log.type === 'success' ? 'text-emerald-400' :
                        log.type === 'gemini' ? 'text-purple-400 font-bold' :
                        log.type === 'scraper' ? 'text-cyan-400' : 'text-slate-300'
                      }>
                        {log.text}
                      </span>
                    </div>
                  ))}
                  {isVerifying && (
                    <div className="flex gap-2 text-blue-400 items-center animate-pulse">
                      <span>⏳</span> Running next verification step...
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Results Alert Card */}
            {verificationResult && (
              <div className={`mt-6 rounded-xl border p-5 animate-fadeIn ${
                verificationResult.status === 'IN_STOCK' ? 'bg-emerald-500/10 border-emerald-500/35 text-emerald-200' :
                verificationResult.status === 'DELAYED' ? 'bg-amber-500/10 border-amber-500/35 text-amber-200' :
                'bg-rose-500/10 border-rose-500/35 text-rose-200'
              }`}>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-bold uppercase tracking-wider">
                    Pipeline Results: {verificationResult.status.replace('_', ' ')}
                  </h4>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase tracking-wider ${
                    verificationResult.status === 'IN_STOCK' ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400' :
                    verificationResult.status === 'DELAYED' ? 'bg-amber-500/20 border-amber-500/30 text-amber-400' :
                    'bg-rose-500/20 border-rose-500/30 text-rose-400'
                  }`}>
                    {verificationResult.status === 'IN_STOCK' ? 'Match' : 'Mismatch'}
                  </span>
                </div>
                
                <p className="text-xs mb-3 text-slate-300 leading-relaxed">
                  <strong>Gemini Flash analysis:</strong> "{verificationResult.reasoning || 'N/A'}"
                </p>
                
                <div className="grid grid-cols-2 gap-4 border-t border-white/5 pt-4 text-xs">
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase tracking-widest block mb-0.5">Shipping Delay</span>
                    <span className="font-bold text-slate-200">
                      {verificationResult.shipping_days === 0 ? 'Immediate (0 days)' : 
                       verificationResult.shipping_days ? `${verificationResult.shipping_days} days` : 'N/A'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase tracking-widest block mb-0.5">Reliability Score</span>
                    <span className="font-bold text-slate-200">
                      {verificationResult.merchant.score}%
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
