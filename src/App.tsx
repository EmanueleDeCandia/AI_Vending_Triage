import { useState, useEffect, useRef, FormEvent } from 'react';
import {
  Coffee,
  Database,
  History,
  LogOut,
  MessageSquare,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  Terminal,
  User,
  Wrench,
  Truck,
  AlertCircle,
  Clock,
  HelpCircle
} from 'lucide-react';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';

// Import Libs
import { auth, loginWithGoogle, logoutUser, db } from './lib/firebase';
import { saveSessionToFirestore, fetchUserSessions, fetchSessionById } from './lib/sessionService';
import { TriageSession, ChatMessage, SymptomType, TriageState } from './types';
import { getInitialSession, transitionState, QUESTIONS } from './utils/triageMachine';

// Import Components
import KnowledgeBasePanel from './components/KnowledgeBasePanel';
import WebhookPanel from './components/WebhookPanel';

export default function App() {
  // Authentication State
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [guestEmail, setGuestEmail] = useState<string>('');
  const [isGuest, setIsGuest] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);

  // App Triage Sessions States
  const [sessions, setSessions] = useState<TriageSession[]>([]);
  const [currentSession, setCurrentSession] = useState<TriageSession | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(false);

  // UI Interactive States
  const [inputText, setInputText] = useState('');
  const [communicatingWithAI, setCommunicatingWithAI] = useState(false);
  const [sendingWebhook, setSendingWebhook] = useState(false);
  const [webhookResponse, setWebhookResponse] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'chat' | 'knowledge'>('chat');

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Handle Firebase Auth changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        setIsGuest(false);
      } else if (!isGuest) {
        setUser(null);
      }
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, [isGuest]);

  // Load user sessions list from Firestore once authenticated or guest email is updated
  const currentUserEmail = user?.email || (isGuest ? guestEmail : null);
  useEffect(() => {
    if (currentUserEmail) {
      loadSessions(currentUserEmail);
    } else {
      setSessions([]);
      setCurrentSession(null);
    }
  }, [currentUserEmail]);

  // Auto-scroll chat on message updates
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentSession?.history, communicatingWithAI]);

  // Load Sessions function
  async function loadSessions(email: string) {
    setSessionsLoading(true);
    try {
      const data = await fetchUserSessions(email);
      setSessions(data);
      if (data.length > 0 && !currentSession) {
        setCurrentSession(data[0]);
      }
    } catch (e) {
      console.error('Error loading sessions:', e);
    } finally {
      setSessionsLoading(false);
    }
  }

  // Guest Authentication fallback
  function handleGuestLogin(e: FormEvent) {
    e.preventDefault();
    if (!guestEmail.trim() || !guestEmail.includes('@')) {
      alert('Inserisci un indirizzo email valido per loggarti come ospite.');
      return;
    }
    setIsGuest(true);
  }

  // Create & Start a New Triage session
  async function handleStartNewSession() {
    const email = currentUserEmail;
    if (!email) return;

    const newSess = getInitialSession(email);
    setCurrentSession(newSess);
    setWebhookResponse(null);
    // Optimistic insert
    setSessions((prev) => [newSess, ...prev]);

    try {
      await saveSessionToFirestore(newSess);
    } catch (e) {
      console.error('Error saving new session:', e);
    }
  }

  // Switch between sessions in left tab panel
  function handleSelectSession(session: TriageSession) {
    setCurrentSession(session);
    setWebhookResponse(null);
  }

  // Send message and execute Core triage analysis pipeline
  async function handleSendMessage(e?: FormEvent) {
    if (e) e.preventDefault();
    if (!inputText.trim() || !currentSession || communicatingWithAI) return;

    const userMsgText = inputText.trim();
    setInputText('');

    // 1. Create user message and add to session logs
    const userMessage: ChatMessage = {
      id: 'msg_u_' + Date.now(),
      sender: 'user',
      text: userMsgText,
      timestamp: Date.now()
    };

    let updatedSession = {
      ...currentSession,
      history: [...currentSession.history, userMessage],
      updatedAt: new Date().toISOString()
    };

    setCurrentSession(updatedSession);
    setCommunicatingWithAI(true);

    try {
      // Step A: Parse current operational state
      const state = updatedSession.state;

      if (state === 'INIT') {
        // ---- FASE 1: Ingestion ed Estrazione del Sintomo (NLU) ----
        const nluResponse = await fetch('/api/triage/analyze-initial', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: userMsgText })
        });

        if (!nluResponse.ok) {
          throw new Error('Errore NLU durante la chiamata server.');
        }

        const nluData = await nluResponse.json();
        const extractedSymptom = nluData.symptom as SymptomType;

        updatedSession.symptom = extractedSymptom;
        if (nluData.extractedDeviceCode) {
          updatedSession.deviceCode = nluData.extractedDeviceCode;
        }

        // Initialize session result fields
        updatedSession.triageResult = {
          reparto: (extractedSymptom === 'blocco_hardware' || extractedSymptom === 'senza_bicchiere') ? 'INTERVENTO GUASTI' : 'CLIENTE',
          sintomo: extractedSymptom,
          condizione: 'in_corso',
          azione: nluData.explanation || 'Analisi sintomo completata.',
          resolved: false,
          dataRilevazione: new Date().toLocaleDateString('it-IT'),
          posizione: nluData.extractedLocation || '',
          codiceMacchina: nluData.extractedDeviceCode || ''
        };

        // Transition through business decision rules based on identified symptom
        if (extractedSymptom === 'unknown') {
          const systemMsg: ChatMessage = {
            id: 'msg_sys_' + Date.now(),
            sender: 'assistant',
            text: "Non sono riuscito a mappare chiaramente il malfunzionamento. Potresti riformulare o specificare se la macchina è del tutto spenta, se il display segnala vuoto d'acqua, se ha il cassetto dei fondi pieno o se le monete si incastrano?",
            timestamp: Date.now()
          };
          updatedSession.history.push(systemMsg);
        } else if (extractedSymptom === 'blocco_hardware') {
          // Hardware block is completely critical. Route instantly to Technical Intervention without checks.
          updatedSession.state = 'ESCALATING';
          updatedSession.triageResult.reparto = 'INTERVENTO GUASTI';
          updatedSession.triageResult.condizione = 'nessuna_autodiagnosi';
          updatedSession.triageResult.azione = 'Errore hardware critico (RAM/Scheda/Caldaia). Blocco bloccante inevitabile.';

          const botMsg: ChatMessage = {
            id: 'msg_sys_' + Date.now(),
            sender: 'assistant',
            text: `Rilevato Errore Hardware Critico: ${nluData.explanation}. Questa categoria non prevede autodiagnosi utente.\n\nIl triage qualifica questo ticket per: INTERVENTO GUASTI.\n\nPer abilitare l'escalation, ho bisogno di confermare alcune informazioni. Per favore, forniscimi il Codice Macchina (es. VM-9012) e la tua Posizione nell'edificio.`,
            timestamp: Date.now()
          };
          updatedSession.history.push(botMsg);
        } else if (extractedSymptom === 'senza_bicchiere') {
          // Glass sensor error is critical. Route instantly to Technical Intervention without checks.
          updatedSession.state = 'ESCALATING';
          updatedSession.triageResult.reparto = 'INTERVENTO GUASTI';
          updatedSession.triageResult.condizione = 'sensore_bicchieri_guasto';
          updatedSession.triageResult.azione = 'Sensore bicchieri guasto o braccetto di erogazione non rientrato correttamente.';

          const botMsg: ChatMessage = {
            id: 'msg_sys_' + Date.now(),
            sender: 'assistant',
            text: `Rilevata anomalia bloccante "Senza Bicchiere" fissa. Il sensore bicchieri o il braccetto di erogazione è probabilmente guasto/inceppato.\n\nIl triage qualifica questo ticket per: INTERVENTO GUASTI.\n\nPer procedere all'escalation, ho bisogno di confermare alcune informazioni. Per favore, forniscimi il Codice Macchina (es. VM-9012) e la tua Posizione nell'edificio.`,
            timestamp: Date.now()
          };
          updatedSession.history.push(botMsg);
        } else if (extractedSymptom === 'macchina_spenta') {
          updatedSession.state = 'ASKED_START_BLOCK';
          const botMsg: ChatMessage = {
            id: 'msg_sys_' + Date.now(),
            sender: 'assistant',
            text: QUESTIONS.ASKED_START_BLOCK,
            timestamp: Date.now()
          };
          updatedSession.history.push(botMsg);
        } else if (extractedSymptom === 'display_vuoto_acqua') {
          updatedSession.state = 'ASKED_PUMP_RESET';
          const botMsg: ChatMessage = {
            id: 'msg_sys_' + Date.now(),
            sender: 'assistant',
            text: QUESTIONS.ASKED_PUMP_RESET,
            timestamp: Date.now()
          };
          updatedSession.history.push(botMsg);
        } else if (extractedSymptom === 'pieno_fondi') {
          updatedSession.state = 'ASKED_GROUNDS_CLEAN';
          const botMsg: ChatMessage = {
            id: 'msg_sys_' + Date.now(),
            sender: 'assistant',
            text: QUESTIONS.ASKED_GROUNDS_CLEAN,
            timestamp: Date.now()
          };
          updatedSession.history.push(botMsg);
        } else if (extractedSymptom === 'vuoto_bicchieri') {
          updatedSession.state = 'ASKED_GLASSES_EMPTY';
          const botMsg: ChatMessage = {
            id: 'msg_sys_' + Date.now(),
            sender: 'assistant',
            text: QUESTIONS.ASKED_GLASSES_EMPTY,
            timestamp: Date.now()
          };
          updatedSession.history.push(botMsg);
        } else if (extractedSymptom === 'monete_esatte') {
          updatedSession.state = 'ASKED_COIN_JAM';
          const botMsg: ChatMessage = {
            id: 'msg_sys_' + Date.now(),
            sender: 'assistant',
            text: QUESTIONS.ASKED_COIN_JAM,
            timestamp: Date.now()
          };
          updatedSession.history.push(botMsg);
        } else if (extractedSymptom === 'riscaldamento') {
          updatedSession.state = 'ASKED_HEATING_TIME';
          const botMsg: ChatMessage = {
            id: 'msg_sys_' + Date.now(),
            sender: 'assistant',
            text: QUESTIONS.ASKED_HEATING_TIME,
            timestamp: Date.now()
          };
          updatedSession.history.push(botMsg);
        } else if (extractedSymptom === 'bevanda_non_disponibile') {
          updatedSession.state = 'ASKED_PROD_TYPE';
          const botMsg: ChatMessage = {
            id: 'msg_sys_' + Date.now(),
            sender: 'assistant',
            text: QUESTIONS.ASKED_PROD_TYPE,
            timestamp: Date.now()
          };
          updatedSession.history.push(botMsg);
        } else if (extractedSymptom === 'icone_grigie') {
          updatedSession.state = 'ASKED_ICONS_BLOCK_TYPE';
          const botMsg: ChatMessage = {
            id: 'msg_sys_' + Date.now(),
            sender: 'assistant',
            text: QUESTIONS.ASKED_ICONS_BLOCK_TYPE,
            timestamp: Date.now()
          };
          updatedSession.history.push(botMsg);
        }

      } else if (state !== 'INIT' && state !== 'ROUTED' && state !== 'ESCALATING') {
        // ---- FASE 2: Ragionamento e Triage (Attraversamento Decisionale) ----
        const classificationResponse = await fetch('/api/triage/classify-answer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: userMsgText, state })
        });

        if (!classificationResponse.ok) {
          throw new Error('Errore di classificazione risposta sul server.');
        }

        const classificationData = await classificationResponse.json();
        const classificationOutput = classificationData.classification;

        // Apply 100% deterministic local business routing transition!
        updatedSession = transitionState(updatedSession, classificationOutput);

        // Generate bot reaction based on destination state
        const nextState = updatedSession.state;
        let followUpText = '';

        if (nextState === 'ROUTED') {
          const finalDept = updatedSession.triageResult?.reparto;
          const labelAction = updatedSession.triageResult?.azione;
          followUpText = `Triage completato con successo. Il problema rientra nella gestione del reparto **${finalDept}**.\n\nDescrizione azione: ${labelAction}\n\nGrazie per la collaborazione.`;
        } else if (nextState === 'ESCALATING') {
          const finalDept = updatedSession.triageResult?.reparto;
          followUpText = `Triage concluso con esito positivo. Il ticket è stato assegnato a: **${finalDept}**.

**Descrizione azione:** ${updatedSession.triageResult?.azione}

Ora avvio la procedura automatica di Escalation FMS per sincronizzare il ticket.
Per favore inserisci il Codice della Macchina o la tua Posizione se non già indicati! Ad esempio scrivendo: "Macchina codice VM-2212, Ufficio Sala Mensa, Terzo piano".`;
        } else {
          followUpText = QUESTIONS[nextState] || "Come procediamo?";
        }

        const botMsg: ChatMessage = {
          id: 'msg_sys_' + Date.now(),
          sender: 'assistant',
          text: followUpText,
          timestamp: Date.now()
        };
        updatedSession.history.push(botMsg);

      } else if (state === 'ESCALATING') {
        // ---- FASE 3: Estrazione dei dati per l'Escalation ----
        const extractionResponse = await fetch('/api/triage/extract-escalation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: userMsgText })
        });

        if (!extractionResponse.ok) {
          throw new Error('Errore server nel modulo di estrazione escalation.');
        }

        const extractionData = await extractionResponse.json();

        if (extractionData.extractedDeviceCode) {
          updatedSession.deviceCode = extractionData.extractedDeviceCode;
        }
        if (extractionData.extractedLocation && updatedSession.triageResult) {
          updatedSession.triageResult.posizione = extractionData.extractedLocation;
        }
        if (extractionData.extractedDate && updatedSession.triageResult) {
          updatedSession.triageResult.dataRilevazione = extractionData.extractedDate;
        }

        // Verify if we collected enough details
        const blockMac = updatedSession.deviceCode;
        const blockPos = updatedSession.triageResult?.posizione;

        let systemReply = '';
        if (blockMac && blockPos) {
          updatedSession.state = 'ROUTED';
          systemReply = `Splendido! Ho raccolto tutti i dati obbligatori per l'invio del ticket di escalation:
- Codice Macchina: ${blockMac}
- Posizione fisica: ${blockPos}
- Data Evento: ${updatedSession.triageResult?.dataRilevazione || new Date().toLocaleDateString('it-IT')}

Il verdetto finale di routing è immutabile: ${updatedSession.triageResult?.reparto}.
Puoi cliccare sul pulsante a destra "Invia ed Esegui Webhook" per inoltrare ufficialmente la segnalazione ai sistemi operativi di competenza!`;
        } else {
          systemReply = `Grazie per le informazioni, ho estratto i seguenti dati:
${blockMac ? `• Codice Macchina: **${blockMac}**\n` : '• Codice Macchina: *mancante*\n'}${blockPos ? `• Posizione: **${blockPos}**\n` : '• Posizione: *mancante*\n'}
Per procedere all'invio sicuro del Webhook nel CRM, indicami il dato ancora mancante.`;
        }

        const botMsg: ChatMessage = {
          id: 'msg_sys_' + Date.now(),
          sender: 'assistant',
          text: systemReply,
          timestamp: Date.now()
        };
        updatedSession.history.push(botMsg);
      }

      // Save updated state to Firestore in real-time
      await saveSessionToFirestore(updatedSession);
      setCurrentSession(updatedSession);

      // Refresh list to keep synced
      setSessions((prev) =>
        prev.map((s) => (s.id === updatedSession.id ? updatedSession : s))
      );
    } catch (err: any) {
      console.error(err);
      const botErrorMsg: ChatMessage = {
        id: 'msg_err_' + Date.now(),
        sender: 'system',
        text: `Errore di elaborazione: ${err.message || 'Controlla la connessione o inserisci la chiave API Gemini.'}`,
        timestamp: Date.now()
      };
      const fallbackSession = {
        ...updatedSession,
        history: [...updatedSession.history, botErrorMsg]
      };
      setCurrentSession(fallbackSession);
    } finally {
      setCommunicatingWithAI(false);
    }
  }

  // Submit simulated Webhook client-side event log
  async function handleSendWebhook() {
    if (!currentSession || sendingWebhook) return;
    setSendingWebhook(true);
    setWebhookResponse(null);

    try {
      // Simulate post with a real delay to demonstrate full async reliability
      await new Promise((resolve) => setTimeout(resolve, 1500));

      const payload = {
        statis: "SUCCESS",
        status_code: 201,
        external_ticket_ref: "FMS-" + Math.floor(100000 + Math.random() * 900000),
        message: `Ticket registrato con successo nel sistema CRM / Field Service per il reparto: ${currentSession.triageResult?.reparto}`,
        assigned_agent: currentSession.triageResult?.reparto === 'OPERATORE RIFORNIMENTO' ? "Francesco (Gestione Zone)" : "Squadra Tecnica di Turno Nord-Est",
        timestamp: new Date().toISOString()
      };

      setWebhookResponse(payload);

      // Update resolution status in Firestore
      const updatedSess = {
        ...currentSession,
        triageResult: {
          ...currentSession.triageResult!,
          resolved: true,
          escalationPayload: payload
        }
      };

      await saveSessionToFirestore(updatedSess);
      setCurrentSession(updatedSess);
      setSessions((prev) =>
        prev.map((s) => (s.id === updatedSess.id ? updatedSess : s))
      );
    } catch (e) {
      console.error('Webhook error:', e);
      setWebhookResponse({ status: "ERROR", error_description: "Impossibile inviare l'elaborato." });
    } finally {
      setSendingWebhook(false);
    }
  }

  // Quick inputs to assist during diagnostic testing
  function handleQuickInput(text: string) {
    setInputText(text);
  }

  // Sign out
  async function handleLogout() {
    try {
      await logoutUser();
      setUser(null);
      setIsGuest(false);
      setGuestEmail('');
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <div id="app-root" className="min-h-screen flex flex-col antialiased bg-transparent p-3 md:p-6 text-slate-100 max-w-7xl mx-auto w-full">
      {/* Absolute top navbar header */}
      <header className="bg-white/5 backdrop-blur-md border border-white/10 px-6 py-4 flex items-center justify-between sticky top-0 z-40 shadow-lg rounded-2xl mb-6 text-white">
        <div className="flex items-center gap-3">
          <div className="bg-orange-500 text-white p-2.5 rounded-xl flex items-center justify-center shadow-lg shadow-orange-500/30">
            <Coffee className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-bold text-white text-lg tracking-tight">AI Vending Triage</h1>
            <p className="text-[10px] text-orange-400 font-mono tracking-wider uppercase font-semibold">Pipeline di Qualificazione Automatica Ticket</p>
          </div>
        </div>

        {/* User Info & logout */}
        { (user || isGuest) && (
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex flex-col text-right">
              <span className="text-xs font-semibold text-slate-200">{user?.displayName || 'Ospite Autenticato'}</span>
              <span className="text-[10px] font-mono text-slate-400 select-all">{currentUserEmail}</span>
            </div>
            <div className="bg-white/10 p-2 rounded-full text-slate-300 border border-white/5">
              <User className="w-4 h-4" />
            </div>
            <button
              onClick={handleLogout}
              className="p-2 text-slate-400 hover:text-rose-400 hover:bg-white/10 rounded-lg transition-colors cursor-pointer"
              title="Disconnetti"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        )}
      </header>

      {/* Main Container */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {(!user && !isGuest) ? (
          /* Authentication Screen */
          <div id="auth-panel" className="max-w-md w-full mx-auto my-auto p-10 bg-white/5 backdrop-blur-xl border border-white/10 shadow-2xl rounded-3xl flex flex-col text-center space-y-6 text-white">
            <div className="text-center space-y-3">
              <div className="mx-auto w-14 h-14 bg-orange-500/15 text-orange-400 rounded-2xl flex items-center justify-center border border-orange-500/15">
                <Sparkles className="w-7 h-7 animate-pulse" />
              </div>
              <h2 className="text-2xl font-bold tracking-tight text-white">Accedi a AI Vending Triage</h2>
              <p className="text-xs text-slate-400 leading-relaxed">
                Applica il triage deterministico per instradare guasti dei distributori automatici.
              </p>
            </div>

            <div className="space-y-4">
              {/* Google Login button */}
              <button
                onClick={async () => {
                  try {
                    await loginWithGoogle();
                  } catch (e) {
                    alert('Impossibile autenticarsi con Google: verifica i popup.');
                  }
                }}
                className="w-full py-3 px-4 bg-orange-500 hover:bg-orange-600 text-white font-bold text-sm rounded-xl transition-all shadow-lg shadow-orange-500/20 flex items-center justify-center gap-2 cursor-pointer active:scale-95"
              >
                <Database className="w-4 h-4 text-white" />
                Accedi con Google Workspace
              </button>

              <div className="flex items-center justify-center gap-2 py-1 text-slate-500">
                <span className="border-t border-white/10 flex-1"></span>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">oppure</span>
                <span className="border-t border-white/10 flex-1"></span>
              </div>

              {/* Guest Login Form */}
              <form onSubmit={handleGuestLogin} className="space-y-3">
                <div className="text-left">
                  <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block mb-1.5 ml-1">
                    Entra come Ospite (E-mail d'istrice)
                  </label>
                  <input
                    type="email"
                    required
                    placeholder="nome@azienda.it"
                    value={guestEmail}
                    onChange={(e) => setGuestEmail(e.target.value)}
                    className="w-full text-xs px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl focus:outline-none focus:ring-1 focus:ring-orange-500 focus:bg-white/10 text-white font-mono placeholder-slate-450"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full py-2.5 px-4 bg-white/10 hover:bg-white/15 text-white font-bold text-xs border border-white/5 rounded-xl transition-colors cursor-pointer"
                >
                  Continua come Operatore Demo
                </button>
              </form>
            </div>

            <div className="text-[10px] text-slate-500 leading-relaxed pt-2 border-t border-white/5">
              * Questo applicativo sfrutta <strong>Firestore</strong> per la sincronizzazione real-time e <strong>Gemini</strong> per l'estrazione linguistica accurata.
            </div>
          </div>
        ) : (
          /* Main Application Workspace Dashboard */
          <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 overflow-hidden h-full">

            {/* Colonna Sinistra (3/12): Storico Sessioni + Accedi di Riferimento */}
            <section className="lg:col-span-3 bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl flex flex-col h-full overflow-hidden shadow-xl">
              <div className="p-4 border-b border-white/10 flex items-center justify-between bg-white/5">
                <div className="flex items-center gap-2">
                  <History className="w-4 h-4 text-orange-400" />
                  <span className="font-bold text-xs text-white uppercase tracking-wider">Ticket di Triage</span>
                </div>
                <button
                  onClick={handleStartNewSession}
                  className="p-1 px-2.5 bg-orange-500/15 border border-orange-500/35 text-orange-400 hover:bg-orange-500/25 text-[10px] font-bold rounded-lg transition-colors flex items-center gap-1 cursor-pointer shadow-sm"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Nuovo
                </button>
              </div>

              {/* List of active firestore sessions */}
              <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {sessionsLoading ? (
                  <div className="py-6 flex items-center justify-center gap-2 text-slate-400 text-xs">
                    <RefreshCw className="w-4 h-4 animate-spin text-orange-500" />
                    <span>Caricamento Firestore...</span>
                  </div>
                ) : (
                  <>
                    {sessions.map((sess) => {
                      const isActive = currentSession?.id === sess.id;
                      const hasResult = !!sess.triageResult;
                      const category = sess.triageResult?.reparto;

                      return (
                        <button
                          key={sess.id}
                          onClick={() => handleSelectSession(sess)}
                          className={`w-full text-left p-3.5 rounded-xl border transition-all cursor-pointer flex flex-col space-y-2 group ${
                            isActive
                              ? 'bg-orange-500/10 border-orange-500/40 text-white shadow-lg'
                              : 'bg-white/5 hover:bg-white/10 border-white/5'
                          }`}
                        >
                          <div className="flex items-center justify-between w-full">
                            <span className={`text-[9px] font-mono font-bold tracking-wider uppercase ${isActive ? 'text-orange-300 font-bold' : 'text-slate-450'}`}>
                              {sess.id.replace('session_', 'TICKET-')}
                            </span>
                            <span className={`text-[9px] px-1.5 py-0.5 rounded uppercase font-bold border ${
                              isActive
                                ? 'bg-orange-500/20 text-orange-300 border-orange-500/30'
                                : sess.state === 'ROUTED'
                                ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20'
                                : 'bg-white/10 text-slate-350 border-white/5'
                            }`}>
                              {sess.state === 'ROUTED' ? 'QUALIFICATO' : 'IN DIAGNOSI'}
                            </span>
                          </div>

                          <span className={`text-xs font-semibold leading-snug line-clamp-2 ${isActive ? 'text-white' : 'text-slate-200'}`}>
                            {sess.history.find(m => m.sender === 'user')?.text || "Nuova diagnosi vuota"}
                          </span>

                          <div className="pt-2 flex items-center justify-between border-t border-dashed w-full border-opacity-25 border-white/10">
                            <span className={`text-[8px] font-mono uppercase ${isActive ? 'text-orange-400' : 'text-slate-450'}`}>
                              {new Date(sess.createdAt).toLocaleDateString('it-IT')}
                            </span>
                            {hasResult && category && (
                              <span className={`text-[9px] font-bold flex items-center gap-1 ${
                                isActive ? 'text-orange-300' :
                                category === 'CLIENTE' ? 'text-emerald-400' :
                                category === 'OPERATORE RIFORNIMENTO' ? 'text-amber-400' :
                                'text-rose-400'
                              }`}>
                                {category === 'CLIENTE' && <User className="w-3 h-3" />}
                                {category === 'OPERATORE RIFORNIMENTO' && <Truck className="w-3 h-3" />}
                                {category === 'INTERVENTO GUASTI' && <Wrench className="w-3 h-3" />}
                                {category}
                              </span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                    {sessions.length === 0 && (
                      <div className="py-12 text-center text-slate-500 text-xs">
                        Nessun ticket registrato. Clicca su "+ Nuovo" per avviare il triage.
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Desktop quick instructions */}
              <div className="p-4 bg-white/5 border-t border-white/10 text-[11px] text-slate-400 leading-relaxed text-center">
                Autenticato: <strong className="font-mono text-slate-350">{currentUserEmail}</strong>
              </div>
            </section>

            {/* Colonna Centrale (5/12): Flusso Conversazione / Chat e Controllo */}
            <section className="lg:col-span-5 flex flex-col h-full bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden shadow-xl">
              {/* Tab Selector mobile and Desktop */}
              <div className="flex bg-white/5 px-2 py-1.5 border-b border-white/10 gap-2">
                <button
                  onClick={() => setActiveTab('chat')}
                  className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                    activeTab === 'chat' ? 'bg-orange-500 text-white shadow-md' : 'text-slate-300 hover:bg-white/5'
                  }`}
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  Conversazione
                </button>
                <button
                  onClick={() => setActiveTab('knowledge')}
                  className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                    activeTab === 'knowledge' ? 'bg-orange-500 text-white shadow-md' : 'text-slate-300 hover:bg-white/5'
                  }`}
                >
                  <Terminal className="w-3.5 h-3.5" />
                  Base Regole NLU
                </button>
              </div>

              {activeTab === 'knowledge' ? (
                /* Tab Knowledge Base */
                <div className="flex-1 p-4 bg-transparent overflow-hidden">
                  <KnowledgeBasePanel />
                </div>
              ) : (
                /* Tab Chat Triage */
                <div className="flex-1 flex flex-col overflow-hidden h-full">
                  {currentSession ? (
                    <>
                      {/* Active State Node Indicator */}
                      <div className="bg-white/5 p-2.5 px-4 border-b border-white/10 flex items-center justify-between text-xs text-slate-300 font-mono">
                        <span className="flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-orange-400 animate-spin" />
                          <span>Mappa di Stato:</span>
                          <strong className="text-orange-300 bg-white/10 px-1.5 py-0.5 rounded font-mono text-[10px]">{currentSession.state}</strong>
                        </span>
                        {currentSession.symptom !== 'unknown' && (
                          <span className="bg-orange-500/20 px-1.5 py-0.5 rounded text-orange-300 font-bold font-mono text-[9px] uppercase border border-orange-500/20">
                            {currentSession.symptom}
                          </span>
                        )}
                      </div>

                      {/* Chat Messages Log */}
                      <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
                        {currentSession.history.map((msg) => {
                          const isBot = msg.sender === 'assistant' || msg.sender === 'system';
                          const isErr = msg.sender === 'system';

                          return (
                            <div
                              key={msg.id}
                              className={`flex flex-col space-y-1 max-w-[85%] animate-fadeIn ${
                                isBot ? 'mr-auto items-start' : 'ml-auto items-end text-right'
                              }`}
                            >
                              <div className={`p-3 rounded-xl text-xs leading-relaxed border ${
                                isErr
                                  ? 'bg-rose-500/10 border-rose-500/20 text-rose-300'
                                  : isBot
                                  ? 'bg-white/5 border-white/10 shadow-sm text-slate-100'
                                  : 'bg-orange-500/25 border-orange-500/35 text-white'
                              }`}>
                                <p className="whitespace-pre-line">{msg.text}</p>
                              </div>
                              <span className="text-[8px] text-slate-450 font-mono">
                                {new Date(msg.timestamp).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                          );
                        })}

                        {communicatingWithAI && (
                          <div className="mr-auto bg-white/5 border border-white/10 text-slate-300 text-xs p-3 rounded-xl flex items-center gap-2 shadow-sm max-w-[85%]">
                            <RefreshCw className="w-4 h-4 animate-spin text-orange-400" />
                            <span className="font-medium">NLU analizza intenzioni e vincoli...</span>
                          </div>
                        )}

                        <div ref={messagesEndRef} />
                      </div>

                      {/* Diagnostic Helper Quick Answers Input shortcuts */}
                      {currentSession.state !== 'ROUTED' && (
                        <div className="p-2.5 bg-white/5 border-t border-white/10 flex flex-wrap gap-1.5 items-center justify-center">
                          <span className="text-[9px] font-bold text-slate-400 uppercase mr-1">Suggerimenti veloci:</span>
                          {currentSession.state === 'INIT' && (
                            <>
                              <button onClick={() => handleQuickInput("La macchina è spenta, nessun led")} className="text-[10px] bg-white/5 border border-white/10 hover:border-orange-500 hover:bg-white/10 text-slate-200 px-2 py-0.5 rounded transition-all cursor-pointer font-medium">"Macchina spenta"</button>
                              <button onClick={() => handleQuickInput("Sul display compare errore vuoto acqua")} className="text-[10px] bg-white/5 border border-white/10 hover:border-orange-500 hover:bg-white/10 text-slate-200 px-2 py-0.5 rounded transition-all cursor-pointer font-medium">"Vuoto acqua"</button>
                              <button onClick={() => handleQuickInput("La macchina segnala vuoto bicchieri sul display")} className="text-[10px] bg-white/5 border border-white/10 hover:border-orange-500 hover:bg-white/10 text-slate-200 px-2 py-0.5 rounded transition-all cursor-pointer font-medium">"Vuoto bicchieri"</button>
                              <button onClick={() => handleQuickInput("Cassetto d'errore pieno fondi")} className="text-[10px] bg-white/5 border border-white/10 hover:border-orange-500 hover:bg-white/10 text-slate-200 px-2 py-0.5 rounded transition-all cursor-pointer font-medium">"Pieno fondi"</button>
                              <button onClick={() => handleQuickInput("Visualizzo inserire monete esatte")} className="text-[10px] bg-white/5 border border-white/10 hover:border-orange-500 hover:bg-white/10 text-slate-200 px-2 py-0.5 rounded transition-all cursor-pointer font-medium">"Inserire monete esatte"</button>
                              <button onClick={() => handleQuickInput("La scritta Riscaldamento... è sempre bloccata fissa")} className="text-[10px] bg-white/5 border border-white/10 hover:border-orange-500 hover:bg-white/10 text-slate-200 px-2 py-0.5 rounded transition-all cursor-pointer font-medium">"Riscaldamento..."</button>
                              <button onClick={() => handleQuickInput("Eroga solo acqua ma non scende il solubile cioccolato")} className="text-[10px] bg-white/5 border border-white/10 hover:border-orange-500 hover:bg-white/10 text-slate-200 px-2 py-0.5 rounded transition-all cursor-pointer font-medium">"Bevande solubili disabilitate"</button>
                              <button onClick={() => handleQuickInput("Errore visualizzato senza bicchiere fisso")} className="text-[10px] bg-white/5 border border-white/10 hover:border-orange-500 hover:bg-white/10 text-slate-200 px-2 py-0.5 rounded transition-all cursor-pointer font-medium">"Senza bicchiere"</button>
                              <button onClick={() => handleQuickInput("Tutte le icone dei prodotti sono grigie")} className="text-[10px] bg-white/5 border border-white/10 hover:border-orange-500 hover:bg-white/10 text-slate-200 px-2 py-0.5 rounded transition-all cursor-pointer font-medium">"Icone grigie"</button>
                            </>
                          )}
                          {currentSession.state === 'ASKED_START_BLOCK' && (
                            <>
                              <button onClick={() => handleQuickInput("Si ferma all'accensione in blocco anomala")} className="text-[10px] bg-white/5 border border-white/10 hover:border-orange-500 hover:bg-white/10 text-slate-200 px-2 py-0.5 rounded transition-all cursor-pointer font-medium">"Si blocca all'accensione"</button>
                              <button onClick={() => handleQuickInput("La macchina risulta del tutto spenta e inerte")} className="text-[10px] bg-white/5 border border-white/10 hover:border-orange-500 hover:bg-white/10 text-slate-200 px-2 py-0.5 rounded transition-all cursor-pointer font-medium">"Completamente spenta"</button>
                            </>
                          )}
                          {currentSession.state === 'ASKED_POWER' && (
                            <>
                              <button onClick={() => handleQuickInput("Sì, è inserita correttamente")} className="text-[10px] bg-white/5 border border-white/10 hover:border-orange-500 hover:bg-white/10 text-slate-200 px-2 py-0.5 rounded transition-all cursor-pointer font-medium">"Sì, inserita"</button>
                              <button onClick={() => handleQuickInput("No, noto che era leggermente staccata")} className="text-[10px] bg-white/5 border border-white/10 hover:border-orange-500 hover:bg-white/10 text-slate-200 px-2 py-0.5 rounded transition-all cursor-pointer font-medium">"No, staccata"</button>
                            </>
                          )}
                          {currentSession.state === 'ASKED_BUILDING_POWER' && (
                            <>
                              <button onClick={() => handleQuickInput("Sì, c'è corrente negli altri uffici ed impianti")} className="text-[10px] bg-white/5 border border-white/10 hover:border-orange-500 hover:bg-white/10 text-slate-200 px-2 py-0.5 rounded transition-all cursor-pointer font-medium">"Sì, c'è corrente"</button>
                              <button onClick={() => handleQuickInput("No, noto che c'è un blackout generale")} className="text-[10px] bg-white/5 border border-white/10 hover:border-orange-500 hover:bg-white/10 text-slate-200 px-2 py-0.5 rounded transition-all cursor-pointer font-medium">"No, manca corrente"</button>
                            </>
                          )}
                          {currentSession.state === 'ASKED_PUMP_RESET' && (
                            <>
                              <button onClick={() => handleQuickInput("Sì, ho staccato la spina ma l'errore sul display persiste")} className="text-[10px] bg-white/5 border border-white/10 hover:border-orange-500 hover:bg-white/10 text-slate-200 px-2 py-0.5 rounded transition-all cursor-pointer font-medium">"Errore persiste"</button>
                              <button onClick={() => handleQuickInput("No, dopo aver riacceso è sparito ed ora eroga caffè")} className="text-[10px] bg-white/5 border border-white/10 hover:border-orange-500 hover:bg-white/10 text-slate-200 px-2 py-0.5 rounded transition-all cursor-pointer font-medium">"No, rimosso blocco"</button>
                            </>
                          )}
                          {currentSession.state === 'ASKED_WATER_SOURCE' && (
                            <>
                              <button onClick={() => handleQuickInput("Usa una tanica interna d'acqua")} className="text-[10px] bg-white/5 border border-white/10 hover:border-orange-500 hover:bg-white/10 text-slate-200 px-2 py-0.5 rounded transition-all cursor-pointer font-medium">"Tanica interna"</button>
                              <button onClick={() => handleQuickInput("Collegata alla rete idrica a muro")} className="text-[10px] bg-white/5 border border-white/10 hover:border-orange-500 hover:bg-white/10 text-slate-200 px-2 py-0.5 rounded transition-all cursor-pointer font-medium">"Rete idrica"</button>
                            </>
                          )}
                          {currentSession.state === 'ASKED_BUILDING_WATER' && (
                            <>
                              <button onClick={() => handleQuickInput("Sì, dagli altri rubinetti scorre acqua regolarmente")} className="text-[10px] bg-white/5 border border-white/10 hover:border-orange-500 hover:bg-white/10 text-slate-200 px-2 py-0.5 rounded transition-all cursor-pointer font-medium">"Sì, c'è acqua"</button>
                              <button onClick={() => handleQuickInput("No, è stata chiusa l'acqua in tutto l'edificio")} className="text-[10px] bg-white/5 border border-white/10 hover:border-orange-500 hover:bg-white/10 text-slate-200 px-2 py-0.5 rounded transition-all cursor-pointer font-medium">"No, manca acqua"</button>
                            </>
                          )}
                          {currentSession.state === 'ASKED_GROUNDS_CLEAN' && (
                            <>
                              <button onClick={() => handleQuickInput("Sì, è stracolma e ha macchiato il vano")} className="text-[10px] bg-white/5 border border-white/10 hover:border-orange-500 hover:bg-white/10 text-slate-200 px-2 py-0.5 rounded transition-all cursor-pointer font-medium">"Sì, è piena"</button>
                              <button onClick={() => handleQuickInput("No, l'ho pulita e svuotata ma resta bloccata")} className="text-[10px] bg-white/5 border border-white/10 hover:border-orange-500 hover:bg-white/10 text-slate-200 px-2 py-0.5 rounded transition-all cursor-pointer font-medium">"No, svuotata ma errore"</button>
                            </>
                          )}
                          {currentSession.state === 'ASKED_GLASSES_EMPTY' && (
                            <>
                              <button onClick={() => handleQuickInput("Sì, la colonna dei bicchieri è vuota")} className="text-[10px] bg-white/5 border border-white/10 hover:border-orange-500 hover:bg-white/10 text-slate-200 px-2 py-0.5 rounded transition-all cursor-pointer font-medium">"Colonna vuota"</button>
                              <button onClick={() => handleQuickInput("I bicchieri ci sono ma sono inceppati e non scendono")} className="text-[10px] bg-white/5 border border-white/10 hover:border-orange-500 hover:bg-white/10 text-slate-200 px-2 py-0.5 rounded transition-all cursor-pointer font-medium">"Bicchieri inceppati"</button>
                            </>
                          )}
                          {currentSession.state === 'ASKED_COIN_JAM' && (
                            <>
                              <button onClick={() => handleQuickInput("La gettoniera è completamente bloccata o le monete si incastrano")} className="text-[10px] bg-white/5 border border-white/10 hover:border-orange-500 hover:bg-white/10 text-slate-200 px-2 py-0.5 rounded transition-all cursor-pointer font-medium">"Bloccata/Incastrata"</button>
                              <button onClick={() => handleQuickInput("Accetta le monete regolarmente ma non dà resto")} className="text-[10px] bg-white/5 border border-white/10 hover:border-orange-500 hover:bg-white/10 text-slate-200 px-2 py-0.5 rounded transition-all cursor-pointer font-medium">"Non dà resto"</button>
                            </>
                          )}
                          {currentSession.state === 'ASKED_COIN_OBSTRUCTION' && (
                            <>
                              <button onClick={() => handleQuickInput("Sì, c'è un'ostruzione visibile nella feritoia")} className="text-[10px] bg-white/5 border border-white/10 hover:border-orange-500 hover:bg-white/10 text-slate-200 px-2 py-0.5 rounded transition-all cursor-pointer font-medium">"Sì, ostruita"</button>
                              <button onClick={() => handleQuickInput("No, la feritoia è libera")} className="text-[10px] bg-white/5 border border-white/10 hover:border-orange-500 hover:bg-white/10 text-slate-200 px-2 py-0.5 rounded transition-all cursor-pointer font-medium">"No, libera"</button>
                            </>
                          )}
                          {currentSession.state === 'ASKED_HEATING_TIME' && (
                            <>
                              <button onClick={() => handleQuickInput("È appena stata accesa da pochi minuti")} className="text-[10px] bg-white/5 border border-white/10 hover:border-orange-500 hover:bg-white/10 text-slate-200 px-2 py-0.5 rounded transition-all cursor-pointer font-medium">"Appena accesa"</button>
                              <button onClick={() => handleQuickInput("La scritta è fissa da oltre 20 minuti con scocca bollente")} className="text-[10px] bg-white/5 border border-white/10 hover:border-orange-500 hover:bg-white/10 text-slate-200 px-2 py-0.5 rounded transition-all cursor-pointer font-medium">"Fissa da oltre 20 min"</button>
                            </>
                          )}
                          {currentSession.state === 'ASKED_PROD_TYPE' && (
                            <>
                              <button onClick={() => handleQuickInput("Il problema si presenta solo con il Caffè in grani")} className="text-[10px] bg-white/5 border border-white/10 hover:border-orange-500 hover:bg-white/10 text-slate-200 px-2 py-0.5 rounded transition-all cursor-pointer font-medium">"Solo Caffè"</button>
                              <button onClick={() => handleQuickInput("Riguarda i prodotti solubili in polvere")} className="text-[10px] bg-white/5 border border-white/10 hover:border-orange-500 hover:bg-white/10 text-slate-200 px-2 py-0.5 rounded transition-all cursor-pointer font-medium">"Prodotti Solubili"</button>
                            </>
                          )}
                          {currentSession.state === 'ASKED_PROD_COFFEE_EMPTY' && (
                            <>
                              <button onClick={() => handleQuickInput("Sì, il contenitore superiore è vuoto")} className="text-[10px] bg-white/5 border border-white/10 hover:border-orange-500 hover:bg-white/10 text-slate-200 px-2 py-0.5 rounded transition-all cursor-pointer font-medium">"Sì, vuoto"</button>
                              <button onClick={() => handleQuickInput("No, è pieno e sento girare il macinino")} className="text-[10px] bg-white/5 border border-white/10 hover:border-orange-500 hover:bg-white/10 text-slate-200 px-2 py-0.5 rounded transition-all cursor-pointer font-medium">"No, è pieno"</button>
                            </>
                          )}
                          {currentSession.state === 'ASKED_PROD_COFFEE_OBSTRUCTION' && (
                            <>
                              <button onClick={() => handleQuickInput("Sì, il dosatore caffè macinato si è ostruito")} className="text-[10px] bg-white/5 border border-white/10 hover:border-orange-500 hover:bg-white/10 text-slate-200 px-2 py-0.5 rounded transition-all cursor-pointer font-medium">"Sì, dosatore ostruito"</button>
                              <button onClick={() => handleQuickInput("No, il dornatore è completamente libero")} className="text-[10px] bg-white/5 border border-white/10 hover:border-orange-500 hover:bg-white/10 text-slate-200 px-2 py-0.5 rounded transition-all cursor-pointer font-medium">"No, libero"</button>
                            </>
                          )}
                          {currentSession.state === 'ASKED_PROD_SOLUBLE_STATUS' && (
                            <>
                              <button onClick={() => handleQuickInput("Sì, vedo polvere versata e mixer incrostato")} className="text-[10px] bg-white/5 border border-white/10 hover:border-orange-500 hover:bg-white/10 text-slate-200 px-2 py-0.5 rounded transition-all cursor-pointer font-medium">"Polvere sparsa/Incrostata"</button>
                              <button onClick={() => handleQuickInput("Il contenitore è palesemente vuoto")} className="text-[10px] bg-white/5 border border-white/10 hover:border-orange-500 hover:bg-white/10 text-slate-200 px-2 py-0.5 rounded transition-all cursor-pointer font-medium">"Contenitore vuoto"</button>
                            </>
                          )}
                          {currentSession.state === 'ASKED_ICONS_BLOCK_TYPE' && (
                            <>
                              <button onClick={() => handleQuickInput("Sì, è attiva la fascia oraria pianificata di blocco")} className="text-[10px] bg-white/5 border border-white/10 hover:border-orange-500 hover:bg-white/10 text-slate-200 px-2 py-0.5 rounded transition-all cursor-pointer font-medium">"Modalità Fascia Oraria"</button>
                              <button onClick={() => handleQuickInput("No, non c'è nessuna modalità o lavaggio attivo")} className="text-[10px] bg-white/5 border border-white/10 hover:border-orange-500 hover:bg-white/10 text-slate-200 px-2 py-0.5 rounded transition-all cursor-pointer font-medium">"Dosatori vuoti"</button>
                            </>
                          )}
                          {currentSession.state === 'ESCALATING' && (
                            <>
                              <button onClick={() => handleQuickInput("La macchina è VM-2041, posizione ufficio sesto piano")} className="text-[10px] bg-white/5 border border-white/10 hover:border-orange-550 hover:bg-white/10 text-slate-200 px-2 py-0.5 rounded transition-all cursor-pointer font-mono">"Invia dati escalation"</button>
                            </>
                          )}
                        </div>
                      )}

                      {/* Main Message Submission forms */}
                      <form onSubmit={handleSendMessage} className="p-4 bg-white/5 border-t border-white/10 flex items-center gap-2">
                        <input
                          type="text"
                          disabled={communicatingWithAI || currentSession.state === 'ROUTED'}
                          value={inputText}
                          onChange={(e) => setInputText(e.target.value)}
                          placeholder={
                            currentSession.state === 'ROUTED'
                              ? 'Triage completato con successo.'
                              : 'Inserisci qui la tua risposta...'
                          }
                          className="flex-1 text-sm bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-1 focus:ring-orange-500 focus:bg-white/10 text-white placeholder-slate-450 disabled:opacity-50"
                        />
                        <button
                          type="submit"
                          disabled={!inputText.trim() || communicatingWithAI || currentSession.state === 'ROUTED'}
                          className="p-3 bg-orange-500 hover:bg-orange-600 disabled:bg-white/5 disabled:text-slate-600 text-white rounded-xl transition-all duration-150 cursor-pointer shadow-md shadow-orange-500/20 active:scale-95"
                        >
                          <Send className="w-4 h-4" />
                        </button>
                      </form>
                    </>
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-400 space-y-4 bg-transparent">
                      <HelpCircle className="w-14 h-14 text-orange-400/50 animate-pulse-slow" />
                      <div>
                        <h3 className="font-bold text-white text-sm">Nessuna sessione triage selezionata</h3>
                        <p className="text-xs text-slate-500 mt-1">Carica un ticket esistente o creane uno premendo "Nuovo".</p>
                      </div>
                      <button
                        onClick={handleStartNewSession}
                        className="py-2 px-5 bg-orange-500 text-white hover:bg-orange-600 font-bold text-xs rounded-xl transition-all cursor-pointer shadow-lg shadow-orange-500/20 active:scale-95"
                      >
                        Avvia Primo Triage
                      </button>
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* Colonna Destra (4/12): FMS / Webhook Escalation API logger */}
            <section className="lg:col-span-4 bg-transparent h-full overflow-hidden flex flex-col">
              <WebhookPanel
                session={currentSession}
                onSendWebhook={handleSendWebhook}
                sending={sendingWebhook}
                webhookResponse={webhookResponse}
              />
            </section>

          </div>
        )}
      </main>
    </div>
  );
}
