import { useState } from 'react';
import { Send, Terminal, AlertCircle, CheckCircle, Database } from 'lucide-react';
import { TriageSession, TriageResult } from '../types';

interface WebhookPanelProps {
  session: TriageSession | null;
  onSendWebhook: () => Promise<void>;
  sending: boolean;
  webhookResponse: any;
}

export default function WebhookPanel({ session, onSendWebhook, sending, webhookResponse }: WebhookPanelProps) {
  const result = session?.triageResult;
  const state = session?.state;

  const [simulatedDomain, setSimulatedDomain] = useState('https://fms-gateway.vendingops.it/webhooks/incoming');

  // Verify which fields are collected
  const isCodeCollected = !!session?.deviceCode;
  const isPosCollected = !!(session?.triageResult?.posizione);
  const isDateCollected = !!(session?.triageResult?.dataRilevazione);

  // Payload structure
  const payload = {
    ticket_id: session?.id || "N/D",
    created_at: session?.createdAt || "N/D",
    reparto_urgente: result?.reparto || "IN VALUTAZIONE",
    classificazione_guasto: {
      sintomo_primario: result?.sintomo || "da_rilevare",
      condizione_chiave: result?.condizione || "triage_attivo",
      descrizione_azione: result?.azione || "Sottoposta a domande diagnostiche."
    },
    apparecchiatura: {
      codice_macchina: session?.deviceCode || "VM-CONTROLLARE",
      posizione_ufficio: result?.posizione || "NON RILEVATA",
      data_rilevazione_guasto: result?.dataRilevazione || "NON REGISTRATA"
    },
    diagnostica_conversazione: session?.history.map(m => ({
      mittente: m.sender,
      messaggio: m.text,
      orario: new Date(m.timestamp).toLocaleTimeString('it-IT')
    })) || []
  };

  const getDepartmentColor = (reparto: string) => {
    switch (reparto) {
      case 'CLIENTE': return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20 shadow-xs shadow-emerald-500/5';
      case 'OPERATORE RIFORNIMENTO': return 'text-amber-400 bg-amber-500/10 border-amber-500/20 shadow-xs shadow-amber-500/5';
      case 'INTERVENTO GUASTI': return 'text-rose-400 bg-rose-500/10 border-rose-500/20 shadow-xs shadow-rose-500/5';
      default: return 'text-slate-200 bg-white/5 border-white/10 shadow-xs shadow-slate-500/5';
    }
  };

  return (
    <div id="webhook-panel" className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl flex flex-col h-full overflow-hidden shadow-xl">
      <div className="p-4 border-b border-white/10 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Database className="w-5 h-5 text-orange-400" />
          <h2 className="font-semibold text-white text-sm tracking-tight uppercase">Instradamento ed Escalation</h2>
        </div>
        <span className="text-[10px] bg-white/10 text-slate-300 border border-white/10 font-semibold px-2 py-0.5 rounded-full uppercase">API Router</span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Triage Verdict */}
        <div className="space-y-2">
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Verdetto Corrente</label>
          <div className={`p-3 rounded-xl border text-xs font-semibold ${getDepartmentColor(result?.reparto || 'IN VALUTAZIONE')}`}>
            {result?.reparto ? `REPARTO: ${result.reparto}` : "IN VALUTAZIONE NLU..."}
          </div>
        </div>

        {/* Dynamic Checklist */}
        {(state === 'ESCALATING' || state === 'ROUTED') && result?.reparto !== 'CLIENTE' && (
          <div className="space-y-2 bg-white/5 p-3 rounded-xl border border-white/5 text-xs text-slate-300">
            <span className="font-semibold text-white text-[11px] uppercase tracking-wider block">Dati Escalation Richiesti</span>
            <div className="space-y-1.5 mt-2">
              <div className="flex items-center gap-2">
                {isCodeCollected ? (
                  <CheckCircle className="w-4 h-4 text-emerald-400" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-slate-500" />
                )}
                <span className={isCodeCollected ? 'text-slate-200 font-medium' : 'text-slate-400'}>
                  Codice Macchina: {isCodeCollected ? <strong className="font-mono text-orange-300">{session?.deviceCode}</strong> : "mancante"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {isPosCollected ? (
                  <CheckCircle className="w-4 h-4 text-emerald-400" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-slate-500" />
                )}
                <span className={isPosCollected ? 'text-slate-200 font-medium' : 'text-slate-400'}>
                  Posizione: {isPosCollected ? <strong className="text-orange-300">{result?.posizione}</strong> : "mancante"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {isDateCollected ? (
                  <CheckCircle className="w-4 h-4 text-emerald-400" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-slate-500" />
                )}
                <span className={isDateCollected ? 'text-slate-200 font-medium' : 'text-slate-400'}>
                  Data Rilevazione: {isDateCollected ? <strong className="text-orange-300">{result?.dataRilevazione}</strong> : "mancante"}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* JSON Payload View */}
        <div className="space-y-2 flex-1 flex flex-col min-h-48">
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">JSON Payload (Webhook)</label>
          <div className="flex-1 bg-black/40 rounded-xl p-3 font-mono text-[10px] text-emerald-400 overflow-y-auto border border-white/5 relative select-all scrollbar-thin">
            <pre>{JSON.stringify(payload, null, 2)}</pre>
          </div>
        </div>

        {/* simulated target URL */}
        <div className="space-y-1">
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">URL Endpoint Webhook</label>
          <input
            type="text"
            value={simulatedDomain}
            onChange={(e) => setSimulatedDomain(e.target.value)}
            className="w-full text-xs font-mono p-1.5 bg-white/5 border border-white/10 rounded-lg text-slate-300 focus:outline-none focus:ring-1 focus:ring-orange-500"
          />
        </div>

        {/* Send Action */}
        {result?.reparto && result.reparto !== 'CLIENTE' && (
          <button
            onClick={onSendWebhook}
            disabled={sending || !isCodeCollected || !isPosCollected}
            className={`w-full py-2 px-4 rounded-lg font-bold text-xs flex items-center justify-center gap-2 transition-all ${
              (!isCodeCollected || !isPosCollected)
                ? 'bg-white/5 text-slate-500 cursor-not-allowed border border-white/5'
                : 'bg-orange-500 hover:bg-orange-600 text-white cursor-pointer shadow-md shadow-orange-500/25 active:scale-95 text-xs font-bold font-sans tracking-wide transition-all'
            }`}
          >
            <Send className="w-3.5 h-3.5" />
            {sending ? "Incollo e Inviando..." : "Invia ed Esegui Webhook"}
          </button>
        )}

        {/* Webhook API response logger */}
        {webhookResponse && (
          <div id="webhook-response" className="p-3 bg-black/60 text-white rounded-xl border border-white/10 animate-fadeIn space-y-1">
            <div className="flex items-center gap-2 text-[10px] text-orange-400 font-bold uppercase tracking-widest">
              <Terminal className="w-3.5 h-3.5" />
              <span>LOG: Risposta dal Server CRM</span>
            </div>
            <pre className="text-[10px] font-mono text-emerald-300">{JSON.stringify(webhookResponse, null, 2)}</pre>
          </div>
        )}
      </div>
    </div>
  );
}
