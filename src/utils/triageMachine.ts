import { TriageSession, TriageState, SymptomType, TriageResult, ChatMessage } from '../types';

export const QUESTIONS: Record<TriageState, string> = {
  INIT: "Descrivi il problema riscontrato con la vending machine.",
  ASKED_START_BLOCK: "La macchina risulta completamente spenta o si ferma in modo anomalo durante la fase di accensione?",
  ASKED_POWER: "La presa di corrente è saldamente inserita nella presa a muro?",
  ASKED_BUILDING_POWER: "C'è corrente nell'impianto elettrico generale?",
  ASKED_PUMP_RESET: "Hai provato a effettuare un riavvio di sblocco della pompa (spegnendo la macchina, staccando la spina dalla presa per circa 10 secondi e riattaccandola)? Il display mostra ancora l'errore?",
  ASKED_WATER_SOURCE: "La macchina utilizza una tanica di ricarica interna oppure è collegata direttamente alla rete idrica?",
  ASKED_BUILDING_WATER: "L'acqua scorre regolarmente dagli altri rubinetti della sede?",
  ASKED_GROUNDS_CLEAN: "La macchina è stata pulita di recente? Vedi del liquido o dei fondi di caffè che fuoriescono o riempiono la vaschetta inferiore?",
  ASKED_GLASSES_EMPTY: "Riesci a vedere attraverso la fessura se la colonna dei bicchieri è effettivamente vuota, oppure i bicchieri ci sono ma non scendono?",
  ASKED_COIN_JAM: "La gettoniera è completamente bloccata (le monete si incastrano) o accetta le monete e le restituisce subito? Il lettore di chiavette/carte funziona?",
  ASKED_COIN_OBSTRUCTION: "Puoi verificare visivamente se ci sono ostruzioni nella feritoia di inserimento delle monete?",
  ASKED_HEATING_TIME: "La macchina è appena stata accesa o presenta questa scritta fissa da più di 15-20 minuti?",
  ASKED_PROD_TYPE: "Quale prodotto specifico risulta non disponibile? Riguarda il caffè in grani o i prodotti in polvere (latte, cioccolato)?",
  ASKED_PROD_COFFEE_EMPTY: "Il contenitore trasparente del caffè in alto è vuoto?",
  ASKED_PROD_COFFEE_OBSTRUCTION: "Controllando il contenitore dei chicchi, puoi verificare se il caffè macinato ha ostruito il dosatore?",
  ASKED_PROD_SOLUBLE_STATUS: "Vedi della polvere versata o incrostata all'interno del vano di erogazione o il contenitore è semplicemente vuoto?",
  ASKED_ICONS_BLOCK_TYPE: "Sono disabilitate tutte le bevande o solo alcune? Sai se è attiva una modalità di blocco per 'Fascia Oraria' o lavaggio automatico?",
  ROUTED: "Triage completato.",
  ESCALATING: "Per procedere all'escalation del ticket, inserisci i dati della macchina: Codice Macchina (es. VM-1234), Posizione (es. Ufficio 3, Piano 1) e Data Rilevazione."
};

export function getInitialSession(userEmail: string): TriageSession {
  const sessionId = 'session_' + Math.random().toString(36).substring(2, 11);
  return {
    id: sessionId,
    userEmail,
    deviceCode: '',
    symptom: 'unknown',
    state: 'INIT',
    history: [
      {
        id: 'msg_greet',
        sender: 'assistant',
        text: "Benvenuto nel servizio di Triage Automatizzato per Vending Machine. Descrivi qui il malfunzionamento riscontrato.",
        timestamp: Date.now()
      }
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

// State Machine logic mapped strictly from full specifications
export function transitionState(
  session: TriageSession,
  nluClassification: string
): TriageSession {
  const updated = { ...session, updatedAt: new Date().toISOString() };
  if (!updated.triageResult) {
    updated.triageResult = {
      reparto: 'CLIENTE',
      sintomo: session.symptom,
      condizione: 'in_corso',
      azione: 'Triage in elaborazione.',
      resolved: false,
      dataRilevazione: new Date().toLocaleDateString('it-IT')
    };
  }

  const result = updated.triageResult;

  switch (session.state) {
    case 'ASKED_START_BLOCK':
      if (nluClassification === 'FERMA') {
        updated.state = 'ESCALATING';
        result.reparto = 'INTERVENTO GUASTI';
        result.condizione = 'blocco_accensione_hardware';
        result.azione = "RAM/Scheda/Caldaia bloccati all'accensione (Blocco hardware critico).";
        result.resolved = false;
      } else {
        // 'OFF' -> Completamente spenta. Proceed to power check
        updated.state = 'ASKED_POWER';
      }
      break;

    case 'ASKED_POWER':
      if (nluClassification === 'NO') {
        updated.state = 'ROUTED';
        result.reparto = 'CLIENTE';
        result.condizione = 'presa_staccata';
        result.azione = "Inserire saldamente la presa elettrica a muro.";
        result.resolved = true;
      } else {
        // YES -> Controllare interruttore generale
        updated.state = 'ASKED_BUILDING_POWER';
      }
      break;

    case 'ASKED_BUILDING_POWER':
      if (nluClassification === 'NO') {
        updated.state = 'ROUTED';
        result.reparto = 'CLIENTE';
        result.condizione = 'manca_corrente_edificio';
        result.azione = "Ripristinare l'interruttore dell'impianto elettrico generale dell'edificio.";
        result.resolved = true;
      } else {
        // YES -> Corrente c'è ma non accende -> Fusibile/Guasto interno
        updated.state = 'ESCALATING';
        result.reparto = 'INTERVENTO GUASTI';
        result.condizione = 'guasto_alimentatore_interno';
        result.azione = "Alimentazione stabile ma macchina spenta. Possibile fusibile rotto o guasto trasformatore interno.";
        result.resolved = false;
      }
      break;

    case 'ASKED_PUMP_RESET':
      if (nluClassification === 'NO') {
        // Errore sparito / risolto
        updated.state = 'ROUTED';
        result.reparto = 'CLIENTE';
        result.condizione = 'pompa_sbloccata';
        result.azione = "Il riavvio elettrico ha sbloccato la pompa. Problema risolto dal CLIENTE.";
        result.resolved = true;
      } else {
        // YES -> Persiste -> Chiedere tanica/rete
        updated.state = 'ASKED_WATER_SOURCE';
      }
      break;

    case 'ASKED_WATER_SOURCE':
      if (nluClassification === 'TANICA') {
        updated.state = 'ESCALATING';
        result.reparto = 'OPERATORE RIFORNIMENTO';
        result.condizione = 'persiste_tanica';
        result.azione = "Necessario controllo/riempimento della tanica interna o sblocco galleggiante.";
        result.resolved = false;
      } else if (nluClassification === 'RETE') {
        // RETE -> Chiedere se c'è acqua nell'edificio
        updated.state = 'ASKED_BUILDING_WATER';
      } else {
        // UNKNOWN -> Assumere problema tecnico
        updated.state = 'ESCALATING';
        result.reparto = 'INTERVENTO GUASTI';
        result.condizione = 'persiste_sorgente_ignota';
        result.azione = "Blocco idrico persistente con alimentazione ignota. Richiesto esame tecnico dell'impianto.";
        result.resolved = false;
      }
      break;

    case 'ASKED_BUILDING_WATER':
      if (nluClassification === 'NO') {
        updated.state = 'ROUTED';
        result.reparto = 'CLIENTE';
        result.condizione = 'manca_acqua_edificio';
        result.azione = "La fornitura idrica della rete principale dell'edificio è assente. Ripristinare l'acqua generale.";
        result.resolved = true;
      } else {
        // YES o UNKNOWN -> Acqua in edificio c'è -> Guasto valvola idrica o air-break
        updated.state = 'ESCALATING';
        result.reparto = 'INTERVENTO GUASTI';
        result.condizione = 'guasto_idrico_interno';
        result.azione = "Errore vuoto acqua persistente. Possibile malfunzionamento dell'air-break o elettrovalvola idrica di carico.";
        result.resolved = false;
      }
      break;

    case 'ASKED_GROUNDS_CLEAN':
      if (nluClassification === 'YES') {
        updated.state = 'ESCALATING';
        result.reparto = 'OPERATORE RIFORNIMENTO';
        result.condizione = 'vaschetta_piena_reale';
        result.azione = "Svuotamento cassetti fondi e pulizia ordinaria della vaschetta inferiore.";
        result.resolved = false;
      } else {
        updated.state = 'ESCALATING';
        result.reparto = 'INTERVENTO GUASTI';
        result.condizione = 'falso_pieno_fondi';
        result.azione = "Cassetto vuoto ma errore persistente. Sensore microinterruttore o contatto presenza ossidato/guasto.";
        result.resolved = false;
      }
      break;

    case 'ASKED_GLASSES_EMPTY':
      if (nluClassification === 'COLONNA_VUOTA') {
        updated.state = 'ESCALATING';
        result.reparto = 'OPERATORE RIFORNIMENTO';
        result.condizione = 'bicchieri_esauriti';
        result.azione = "Colonna bicchieri esaurita. Rifornimento consumabili.";
        result.resolved = false;
      } else {
        updated.state = 'ESCALATING';
        result.reparto = 'INTERVENTO GUASTI';
        result.condizione = 'inceppamento_sgancio_bicchieri';
        result.azione = "Bicchieri presenti ma bloccati. Sostituzione motore sgancio o taratura sensore di presenza (Er.06).";
        result.resolved = false;
      }
      break;

    case 'ASKED_COIN_JAM':
      if (nluClassification === 'BLOCCATA_INCASTRATA') {
        updated.state = 'ASKED_COIN_OBSTRUCTION';
      } else {
        // ACCETTA_NO_RESTO
        updated.state = 'ESCALATING';
        result.reparto = 'OPERATORE RIFORNIMENTO';
        result.condizione = 'mancanza_resto';
        result.azione = "Gettoniera funzionante ma tubi di resto vuoti. Effettuare ricarica fondo cassa.";
        result.resolved = false;
      }
      break;

    case 'ASKED_COIN_OBSTRUCTION':
      if (nluClassification === 'YES') {
        updated.state = 'ESCALATING';
        result.reparto = 'OPERATORE RIFORNIMENTO';
        result.condizione = 'ostruzione_feritoia_rimovibile';
        result.azione = "Rilevata ostruzione visibile nella feritoia. Pulizia e rimozione residui/ostruzioni gettoniera.";
        result.resolved = false;
      } else {
        updated.state = 'ESCALATING';
        result.reparto = 'INTERVENTO GUASTI';
        result.condizione = 'guasto_meccanico_moneta';
        result.azione = "Nessuna ostruzione visibile. Guasto interno della gettoniera elettronica o sensore ottico di lettura sporco.";
        result.resolved = false;
      }
      break;

    case 'ASKED_HEATING_TIME':
      if (nluClassification === 'ATTENDERE') {
        updated.state = 'ROUTED';
        result.reparto = 'CLIENTE';
        result.condizione = 'riscaldamento_attesa';
        result.azione = "La macchina è appena stata accesa. Attendere il completamento del ciclo termico di avvio.";
        result.resolved = true;
      } else {
        // PERSISTE_CALDO
        updated.state = 'ESCALATING';
        result.reparto = 'INTERVENTO GUASTI';
        result.condizione = 'guasto_temperatura_caldaia';
        result.azione = "Riscaldamento bloccato fisso. Guasto alla resistenza caldaia (Er.02), accumulo calcare o sonda NTC interrotta.";
        result.resolved = false;
      }
      break;

    case 'ASKED_PROD_TYPE':
      if (nluClassification === 'COFFEE') {
        updated.state = 'ASKED_PROD_COFFEE_EMPTY';
      } else {
        // SOLUBILI
        updated.state = 'ASKED_PROD_SOLUBLE_STATUS';
      }
      break;

    case 'ASKED_PROD_COFFEE_EMPTY':
      if (nluClassification === 'YES') {
        updated.state = 'ESCALATING';
        result.reparto = 'OPERATORE RIFORNIMENTO';
        result.condizione = 'caffe_grani_finito';
        result.azione = "Contenitore chicchi vuoto. Rifornimento caffè in grani.";
        result.resolved = false;
      } else {
        // NO -> Verificare ostruzione dosatore
        updated.state = 'ASKED_PROD_COFFEE_OBSTRUCTION';
      }
      break;

    case 'ASKED_PROD_COFFEE_OBSTRUCTION':
      if (nluClassification === 'YES') {
        updated.state = 'ESCALATING';
        result.reparto = 'OPERATORE RIFORNIMENTO';
        result.condizione = 'dosatore_caffe_ostruito';
        result.azione = "Il caffè macinato ha ostruito il dosatore sotto il contenitore chicchi. Pulizia ostruzione.";
        result.resolved = false;
      } else {
        updated.state = 'ESCALATING';
        result.reparto = 'INTERVENTO GUASTI';
        result.condizione = 'guasto_macina_bloccata';
        result.azione = "Chicchi presenti e dosatore libero, ma macinino KO. Sostituzione o riparazione motore macine (Er.09).";
        result.resolved = false;
      }
      break;

    case 'ASKED_PROD_SOLUBLE_STATUS':
      if (nluClassification === 'POLVERE_SPARSA') {
        updated.state = 'ESCALATING';
        result.reparto = 'INTERVENTO GUASTI';
        result.condizione = 'mixer_otturato_guasto';
        result.azione = "Incrostazione solubili o mixer otturato/bloccato. Manutenzione motorino di miscelazione o coppetta erogatrice.";
        result.resolved = false;
      } else {
        // CONTENITORE_VUOTO
        updated.state = 'ESCALATING';
        result.reparto = 'OPERATORE RIFORNIMENTO';
        result.condizione = 'solubile_esaurito';
        result.azione = "Contenitore polveri palesemente vuoto. Rifornimento di latte/cioccolato/tè solubile.";
        result.resolved = false;
      }
      break;

    case 'ASKED_ICONS_BLOCK_TYPE':
      if (nluClassification === 'FASCIA_ORARIA') {
        updated.state = 'ROUTED';
        result.reparto = 'CLIENTE';
        result.condizione = 'blocco_programmazione';
        result.azione = "La macchina è bloccata per fascia oraria pianificata o ciclo di lavaggio programmato automatico. Attendere.";
        result.resolved = true;
      } else {
        // DOSATORI_VUOTI
        updated.state = 'ESCALATING';
        result.reparto = 'OPERATORE RIFORNIMENTO';
        result.condizione = 'dosatori_segnalati_vuoti';
        result.azione = "Sensori segnalano dosatori vuoti. Rifornimento ingredienti e reset allarmi.";
        result.resolved = false;
      }
      break;

    default:
      break;
  }

  updated.triageResult = result;
  return updated;
}
