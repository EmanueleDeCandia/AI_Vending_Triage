export type SymptomType =
  | 'macchina_spenta'
  | 'display_vuoto_acqua'
  | 'pieno_fondi'
  | 'blocco_hardware'
  | 'vuoto_bicchieri'
  | 'monete_esatte'
  | 'riscaldamento'
  | 'bevanda_non_disponibile'
  | 'senza_bicchiere'
  | 'icone_grigie'
  | 'unknown';

export type TriageState =
  | 'INIT'                  // Initial input waiting
  | 'ASKED_START_BLOCK'      // Waiting for startup block answer (RAM/Scheda/Caldaia vs completely off)
  | 'ASKED_POWER'            // Waiting for power plug answer
  | 'ASKED_BUILDING_POWER'   // Waiting for building power answer
  | 'ASKED_PUMP_RESET'       // Waiting for pump reset answer
  | 'ASKED_WATER_SOURCE'     // Waiting for water source answer
  | 'ASKED_BUILDING_WATER'   // Waiting for building water answer
  | 'ASKED_GROUNDS_CLEAN'    // Waiting for grounds clean/leak answer
  | 'ASKED_GLASSES_EMPTY'    // Waiting for glasses empty/jammed answer
  | 'ASKED_COIN_JAM'         // Waiting for coin mechanim jam answer
  | 'ASKED_COIN_OBSTRUCTION' // Waiting for coin slot obstruction answer
  | 'ASKED_HEATING_TIME'     // Waiting for heating time duration answer
  | 'ASKED_PROD_TYPE'                // Waiting for product type (Coffee vs Soluble) answer
  | 'ASKED_PROD_COFFEE_EMPTY'        // Waiting for coffee beans container empty answer
  | 'ASKED_PROD_COFFEE_OBSTRUCTION'  // Waiting for coffee grinder obstruction check answer
  | 'ASKED_PROD_SOLUBLE_STATUS'      // Waiting for soluble powder status answer
  | 'ASKED_ICONS_BLOCK_TYPE'         // Waiting for grigie icons block reason answer
  | 'ROUTED'                // Final routing decision reached
  | 'ESCALATING';           // Collecting machine info and escalating the ticket

export type DepartmentType = 'CLIENTE' | 'OPERATORE RIFORNIMENTO' | 'INTERVENTO GUASTI';

export interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant' | 'system';
  text: string;
  timestamp: number;
}

export interface TriageResult {
  reparto: DepartmentType;
  sintomo: SymptomType;
  condizione: string;
  azione: string;
  resolved: boolean;
  dataRilevazione: string;
  codiceMacchina?: string;
  posizione?: string;
  escalationPayload?: any;
}

export interface TriageSession {
  id: string;
  userEmail: string;
  deviceCode: string;
  symptom: SymptomType;
  state: TriageState;
  history: ChatMessage[];
  triageResult?: TriageResult | null;
  createdAt: string;
  updatedAt: string;
}
