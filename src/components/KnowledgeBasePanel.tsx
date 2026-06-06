import { useState } from 'react';
import { Search, Shield, ChevronDown, ChevronRight, FileText, Settings } from 'lucide-react';

export default function KnowledgeBasePanel() {
  const [search, setSearch] = useState('');
  const [docsOpen, setDocsOpen] = useState(true);
  const [matrixOpen, setMatrixOpen] = useState(true);

  const csvRows = [
    { sintomo: 'macchina_spenta', condizione: 'presa_staccata', reparto: 'CLIENTE', azione: "Inserire la presa elettrica a muro." },
    { sintomo: 'macchina_spenta', condizione: 'manca_corrente_edificio', reparto: 'CLIENTE', azione: "Impianto elettrico dell'edificio spento. Ripristinarlo." },
    { sintomo: 'macchina_spenta', condizione: 'guasto_alimentatore_interno', reparto: 'INTERVENTO GUASTI', azione: "Guasto alimentatore interno o fusibile." },
    { sintomo: 'macchina_spenta', condizione: 'blocco_accensione_hardware', reparto: 'INTERVENTO GUASTI', azione: "RAM/Scheda/Caldaia bloccati in fase di accensione." },
    
    { sintomo: 'display_vuoto_acqua', condizione: 'pompa_sbloccata', reparto: 'CLIENTE', azione: "Riavvio elettrico ha sbloccato la pompa." },
    { sintomo: 'display_vuoto_acqua', condizione: 'persiste_tanica', reparto: 'OPERATORE RIFORNIMENTO', azione: "Sblocco galleggiante o riempimento manuale tanica interna." },
    { sintomo: 'display_vuoto_acqua', condizione: 'manca_acqua_edificio', reparto: 'CLIENTE', azione: "Assenza acqua rete principale. Ripristinare sbarra generale." },
    { sintomo: 'display_vuoto_acqua', condizione: 'guasto_idrico_interno', reparto: 'INTERVENTO GUASTI', azione: "Elettrovalvola difettosa o air-break intasato." },
    
    { sintomo: 'pieno_fondi', condizione: 'vaschetta_piena_reale', reparto: 'OPERATORE RIFORNIMENTO', azione: "Svuotamento cassetti fondi e lavaggio vaschetta." },
    { sintomo: 'pieno_fondi', condizione: 'falso_pieno_fondi', reparto: 'INTERVENTO GUASTI', azione: "Errore sensore microinterruttore o contatto ossidato." },
    
    { sintomo: 'blocco_hardware', condizione: 'nessuna_autodiagnosi', reparto: 'INTERVENTO GUASTI', azione: "Blocco critico RAM/Scheda/Caldaia. Riparazione tecnica interna." },
    
    { sintomo: 'vuoto_bicchieri', condizione: 'bicchieri_esauriti', reparto: 'OPERATORE RIFORNIMENTO', azione: "Colonna dei bicchieri esaurita. Effettuare rifornimento." },
    { sintomo: 'vuoto_bicchieri', condizione: 'inceppamento_sgancio_bicchieri', reparto: 'INTERVENTO GUASTI', azione: "Bicchieri presenti ma bloccati. Sostituzione motore sgancio." },
    
    { sintomo: 'monete_esatte', condizione: 'mancanza_resto', reparto: 'OPERATORE RIFORNIMENTO', azione: "Tubi resto vuoti. Effettuare ricarica fondo cassa." },
    { sintomo: 'monete_esatte', condizione: 'ostruzione_feritoia_rimovibile', reparto: 'OPERATORE RIFORNIMENTO', azione: "Ostruzione visibile feritoia. Pulizia e rimozione residui." },
    { sintomo: 'monete_esatte', condizione: 'guasto_meccanico_moneta', reparto: 'INTERVENTO GUASTI', azione: "Errore meccanico/ottico lettura o gettoniera elettronica KO." },
    
    { sintomo: 'riscaldamento', condizione: 'riscaldamento_attesa', reparto: 'CLIENTE', azione: "La macchina è appena stata accesa. Attendere il ciclo termico." },
    { sintomo: 'riscaldamento', condizione: 'guasto_temperatura_caldaia', reparto: 'INTERVENTO GUASTI', azione: "Caldaia bloccata. Guasto resistenza o sonda NTC interrotta." },
    
    { sintomo: 'bevanda_non_disponibile', condizione: 'caffe_grani_finito', reparto: 'OPERATORE RIFORNIMENTO', azione: "Contenitore chicchi vuoto. Rifornimento caffè in grani." },
    { sintomo: 'bevanda_non_disponibile', condizione: 'dosatore_caffe_ostruito', reparto: 'OPERATORE RIFORNIMENTO', azione: "Caffè macinato incastrato. Pulizia ostruzione dosatore." },
    { sintomo: 'bevanda_non_disponibile', condizione: 'guasto_macina_bloccata', reparto: 'INTERVENTO GUASTI', azione: "Macine bloccate o rotte. Sostituzione motore macinino." },
    { sintomo: 'bevanda_non_disponibile', condizione: 'mixer_otturato_guasto', reparto: 'INTERVENTO GUASTI', azione: "Mixer polveri ostruito. Manutenzione motorino di miscelazione." },
    { sintomo: 'bevanda_non_disponibile', condizione: 'solubile_esaurito', reparto: 'OPERATORE RIFORNIMENTO', azione: "Contenitore polveri vuoto. Rifornimento latte o cioccolato." },
    
    { sintomo: 'senza_bicchiere', condizione: 'sensore_bicchieri_guasto', reparto: 'INTERVENTO GUASTI', azione: "Errore bloccante fisso. Sostituzione fotocellula presenza bicchiere." },
    
    { sintomo: 'icone_grigie', condizione: 'blocco_programmazione', reparto: 'CLIENTE', azione: "Fascia oraria di blocco programmata o ciclo lavaggio attivo." },
    { sintomo: 'icone_grigie', condizione: 'dosatori_segnalati_vuoti', reparto: 'OPERATORE RIFORNIMENTO', azione: "Sensori segnalano dosatori vuoti. Rifornire e azzerare allarmi." }
  ];

  const filteredMatrix = csvRows.filter(row =>
    row.sintomo.toLowerCase().includes(search.toLowerCase()) ||
    row.condizione.toLowerCase().includes(search.toLowerCase()) ||
    row.reparto.toLowerCase().includes(search.toLowerCase()) ||
    row.azione.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div id="kb-panel" className="flex flex-col h-full bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl shadow-xl">
      <div className="p-4 border-b border-white/10 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-orange-400" />
          <h2 className="font-semibold text-white text-sm tracking-tight uppercase">Base Conoscenza Deterministica</h2>
        </div>
        <span className="text-[10px] bg-orange-500/20 text-orange-400 border border-orange-500/20 font-semibold px-2 py-0.5 rounded-full uppercase">Regole Rigide</span>
      </div>

      {/* Search Bar */}
      <div className="p-3 border-b border-white/10">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Cerca regole, sintomi o reparto..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full text-xs pl-9 pr-3 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:ring-1 focus:ring-orange-500 focus:bg-white/10 text-white placeholder-slate-400"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* State Flow Document Section */}
        <div>
          <button
            onClick={() => setDocsOpen(!docsOpen)}
            className="w-full flex items-center justify-between font-semibold text-xs text-slate-200 uppercase tracking-widest hover:text-white pb-2 border-b border-white/10 cursor-pointer"
          >
            <div className="flex items-center gap-1.5 text-slate-300">
              <FileText className="w-3.5 h-3.5 text-orange-400" />
              <span>Sintomi e Diagnostiche (TXT)</span>
            </div>
            {docsOpen ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
          </button>
          {docsOpen && (
            <div className="mt-2 text-[11px] text-slate-300 space-y-2 bg-white/5 p-2.5 rounded-lg font-mono leading-relaxed max-h-56 overflow-y-auto border border-white/5">
              <div className="font-bold text-orange-400 uppercase">Sintomi Mappati</div>
              <p>• <strong>macchina_spenta</strong>: Blocco accensione vs Presa staccata / Corrente edificio.</p>
              <p>• <strong>display_vuoto_acqua</strong>: Sblocco pompa vs Serbatoio vuoto vs Rete KO.</p>
              <p>• <strong>pieno_fondi</strong>: Svuotamento cassetti vs Guasto microinterruttore.</p>
              <p>• <strong>blocco_hardware</strong>: RAM/Caldaia/Scheda. Escalation istantanea (GUASTI).</p>
              <p>• <strong>vuoto_bicchieri</strong>: Rifornimento bicchieri vs Inceppamento sgancio (Er.06).</p>
              <p>• <strong>monete_esatte</strong>: Ricarica resto vs Ostruzione feritoia vs Guasto lettore.</p>
              <p>• <strong>riscaldamento</strong>: Attesa riscaldamento vs Errore sonda/caldaia (Er.02).</p>
              <p>• <strong>bevanda_non_disponibile</strong>: Rifornimento grani/solubili vs Ostruzione dosatore/mixer vs Macina KO.</p>
              <p>• <strong>senza_bicchiere</strong>: Errore fotocellula o braccetto inceppato. Escalation istantanea (GUASTI).</p>
              <p>• <strong>icone_grigie</strong>: Fascia oraria di lavaggio attiva vs Sensori ingredienti vuoti.</p>
            </div>
          )}
        </div>

        {/* Matrix CSV Section */}
        <div>
          <button
            onClick={() => setMatrixOpen(!matrixOpen)}
            className="w-full flex items-center justify-between font-semibold text-xs text-slate-200 uppercase tracking-widest hover:text-white pb-2 border-b border-white/10 cursor-pointer"
          >
            <div className="flex items-center gap-1.5 text-slate-300">
              <Settings className="w-3.5 h-3.5 text-orange-400" />
              <span>Matrice di Routing di Triage</span>
            </div>
            {matrixOpen ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
          </button>
          {matrixOpen && (
            <div className="mt-2 space-y-2 animate-fadeIn">
              <div className="overflow-x-auto border border-white/5 rounded-lg max-h-72 overflow-y-auto">
                <table className="w-full text-left border-collapse text-[10px]">
                  <thead>
                    <tr className="bg-white/5 border-b border-white/10 text-slate-300 font-medium font-mono sticky top-0">
                      <th className="p-2">Sintomo</th>
                      <th className="p-2">Condizione</th>
                      <th className="p-2 text-right">Reparto</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-slate-300">
                    {filteredMatrix.map((row, i) => (
                      <tr key={i} className="hover:bg-white/5 transition-colors">
                        <td className="p-2 font-mono text-orange-300">{row.sintomo}</td>
                        <td className="p-2 font-mono text-emerald-300">{row.condizione}</td>
                        <td className="p-2 text-right">
                          <span className={`px-1 rounded text-[9px] font-semibold border ${
                            row.reparto === 'CLIENTE' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                            row.reparto === 'OPERATORE RIFORNIMENTO' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
                            'bg-rose-500/10 text-rose-400 border-rose-500/20'
                          }`}>
                            {row.reparto}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {filteredMatrix.length === 0 && (
                      <tr>
                        <td colSpan={3} className="p-3 text-center text-slate-500">Nessuna regola corrispondente</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
