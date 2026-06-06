import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

const PORT = 3000;

// Lazy initialization of Gemini API Client to prevent startup crashes if key is empty
let aiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (!key || key === 'MY_GEMINI_API_KEY') {
      throw new Error('GEMINI_API_KEY non configurata nei Secrets dell\'applicazione.');
    }
    aiClient = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }
  return aiClient;
}

// ---- deterministic Fallback Functions (Hybrid Mode support for 429 / Out of Quota) ----
function fallbackAnalyzeInitial(text: string) {
  const norm = text.toLowerCase();
  let symptomOfChoice = 'unknown';

  if (norm.includes('senza bicchiere') || norm.includes('senza_bicchiere')) {
    symptomOfChoice = 'senza_bicchiere';
  } else if (norm.includes('spenta') || norm.includes('spento') || norm.includes('nessun led') || norm.includes('non si accende') || norm.includes(' spent') || norm.includes('spegner') || norm.includes('spenga')) {
    symptomOfChoice = 'macchina_spenta';
  } else if (norm.includes('acqua') || norm.includes('idric') || norm.includes('idraul') || norm.includes('vuoto acqua') || norm.includes('vuoto_acqua') || norm.includes('pompa')) {
    symptomOfChoice = 'display_vuoto_acqua';
  } else if (norm.includes('fondi') || norm.includes('cassetto') || norm.includes('vaschetta') || norm.includes('pieno fondi') || norm.includes('pieno_fondi')) {
    symptomOfChoice = 'pieno_fondi';
  } else if (norm.includes('bicchier') || norm.includes('colonna') || norm.includes('sgancio') || norm.includes('vuoto bicchieri')) {
    symptomOfChoice = 'vuoto_bicchieri';
  } else if (norm.includes('monet') || norm.includes('gettonier') || norm.includes('esatte') || norm.includes('resto') || norm.includes('chiavett') || norm.includes('incastrat') || norm.includes('accetta')) {
    symptomOfChoice = 'monete_esatte';
  } else if (norm.includes('riscaldamento') || norm.includes('caldaia') || norm.includes('temperatura') || norm.includes('caldo')) {
    symptomOfChoice = 'riscaldamento';
  } else if (norm.includes('bevanda') || norm.includes('non disponibile') || norm.includes('solubil') || norm.includes('cioccolato') || norm.includes('latte') || norm.includes('caffè') || norm.includes('chicchi') || norm.includes('macin')) {
    symptomOfChoice = 'bevanda_non_disponibile';
  } else if (norm.includes('icone grigie') || norm.includes('icone_grigie') || norm.includes('grigie') || norm.includes('grigi') || norm.includes('disabilit')) {
    symptomOfChoice = 'icone_grigie';
  } else if (norm.includes('ram') || norm.includes('scheda') || norm.includes('hardware') || norm.includes('blocco_hardware') || norm.includes('errore critico')) {
    symptomOfChoice = 'blocco_hardware';
  }

  // Extract device code
  const codeMatch = text.match(/(VM-\d+|Vending\s*\d+|Macchina\s*\d+|\b\d{4,}\b)/i);
  const extractedDeviceCode = codeMatch ? codeMatch[0] : "";

  // Extract location
  const locMatch = text.match(/(ufficio\s*\d*|piano\s*\d*|mensa|sala|corridoio[^\.,]*)/i);
  const extractedLocation = locMatch ? locMatch[0].trim() : "";

  return {
    symptom: symptomOfChoice,
    confidence: 0.95,
    explanation: "Analisi eseguita in modalità Deterministic Fallback (Gemini API Quota/Service offline): corrispondenza di parole chiave trovata.",
    extractedDeviceCode,
    extractedLocation
  };
}

function fallbackClassifyAnswer(text: string, state: string): string {
  const norm = text.toLowerCase();
  switch (state) {
    case 'ASKED_START_BLOCK':
      if (norm.includes('ferma') || norm.includes('blocca') || norm.includes('accension') || norm.includes('avvio') || norm.includes('ram') || norm.includes('caldaia')) {
        return 'FERMA';
      }
      return 'OFF';

    case 'ASKED_POWER':
      if (norm.includes('no') || norm.includes('staccat') || norm.includes('scollegat')) {
        return 'NO';
      }
      return 'YES';

    case 'ASKED_BUILDING_POWER':
      if (norm.includes('no') || norm.includes('blackout') || norm.includes('buio') || norm.includes('manca')) {
        return 'NO';
      }
      return 'YES';

    case 'ASKED_PUMP_RESET':
      if (norm.includes('no') || norm.includes('risolt') || norm.includes('sparito') || norm.includes('funziona') || norm.includes('posto')) {
        return 'NO'; // Resolved: error gone
      }
      return 'YES'; // Persists

    case 'ASKED_WATER_SOURCE':
      if (norm.includes('tanica') || norm.includes('serbatoio') || norm.includes('manual') || norm.includes('dentro')) {
        return 'TANICA';
      }
      if (norm.includes('rete') || norm.includes('tubo') || norm.includes('muro') || norm.includes('allacciat')) {
        return 'RETE';
      }
      return 'UNKNOWN';

    case 'ASKED_BUILDING_WATER':
      if (norm.includes('no') || norm.includes('manca') || norm.includes('chius') || norm.includes('assent')) {
        return 'NO';
      }
      if (norm.includes('si') || norm.includes('sì') || norm.includes('scorr') || norm.includes('rubinett') || norm.includes('c\'è')) {
        return 'YES';
      }
      return 'UNKNOWN';

    case 'ASKED_GROUNDS_CLEAN':
      if (norm.includes('vuot') || norm.includes('pulit') || norm.includes('svuotat') || norm.includes('no') || norm.includes('liber')) {
        return 'NO';
      }
      return 'YES';

    case 'ASKED_GLASSES_EMPTY':
      if (norm.includes('vuot') || norm.includes('finit') || norm.includes('senza')) {
        return 'COLONNA_VUOTA';
      }
      return 'PRESENTI_INCEPPATI';

    case 'ASKED_COIN_JAM':
      if (norm.includes('blocc') || norm.includes('incast') || norm.includes('feritoia') || norm.includes('ostru')) {
        return 'BLOCCATA_INCASTRATA';
      }
      return 'ACCETTA_NO_RESTO';

    case 'ASKED_COIN_OBSTRUCTION':
      if (norm.includes('no') || norm.includes('liber') || norm.includes('pulit')) {
        return 'NO';
      }
      return 'YES';

    case 'ASKED_HEATING_TIME':
      if (norm.includes('appen') || norm.includes('access') || norm.includes('minut') || norm.includes('ora')) {
        return 'ATTENDERE';
      }
      return 'PERSISTE_CALDO';

    case 'ASKED_PROD_TYPE':
      if (norm.includes('caff') || norm.includes('grani') || norm.includes('espress') || norm.includes('chicc') || norm.includes('macin')) {
        return 'COFFEE';
      }
      return 'SOLUBILI';

    case 'ASKED_PROD_COFFEE_EMPTY':
      if (norm.includes('no') || norm.includes('pien') || norm.includes('c\'è')) {
        return 'NO';
      }
      return 'YES';

    case 'ASKED_PROD_COFFEE_OBSTRUCTION':
      if (norm.includes('no') || norm.includes('liber') || norm.includes('pulit')) {
        return 'NO';
      }
      return 'YES';

    case 'ASKED_PROD_SOLUBLE_STATUS':
      if (norm.includes('polver') || norm.includes('spars') || norm.includes('incrost') || norm.includes('mixer') || norm.includes('rumor')) {
        return 'POLVERE_SPARSA';
      }
      return 'CONTENITORE_VUOTO';

    case 'ASKED_ICONS_BLOCK_TYPE':
      if (norm.includes('fascia') || norm.includes('orari') || norm.includes('programm') || norm.includes('pianific') || norm.includes('lavaggi')) {
        return 'FASCIA_ORARIA';
      }
      return 'DOSATORI_VUOTI';

    default:
      return 'YES';
  }
}

function fallbackExtractEscalation(text: string) {
  const codeMatch = text.match(/(VM-\d+|Vending\s*\d+|Macchina\s*\d+|\b\d{4,}\b)/i);
  const extractedDeviceCode = codeMatch ? codeMatch[0] : "";

  const locMatch = text.match(/(ufficio\s*\d*|piano\s*\d*|mensa|sala|corridoio[^\.,]*)/i);
  const extractedLocation = locMatch ? locMatch[0].trim() : "";

  return {
    extractedDeviceCode,
    extractedLocation,
    extractedDate: new Date().toLocaleDateString('it-IT'),
    explanation: "Estrazione completata con successo tramite Fallback deterministico a causa di quota/offline Gemini API."
  };
}

// 1. API: Estrazione del Sintomo Iniziale (NLU)
app.post('/api/triage/analyze-initial', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Il testo descrittivo è richiesto.' });
    }

    const ai = getGeminiClient();

    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: `Analizza questa segnalazione di guasto di una macchina da caffè o distributore automatico (vending machine):
"${text}"`,
      config: {
        systemInstruction: `Sei il modulo NLU (Natural Language Understanding) di un sistema di Triage automatizzato per vending machine.
Mappa la richiesta dell'utente in UNO dei seguenti sintomi prestabiliti:
1. 'macchina_spenta': La macchina è spenta, non dà segni di vita, non si accende, nessun led o display.
2. 'display_vuoto_acqua': Errori o messaggi di assenza acqua, vuoto acqua, guasto acqua sul display o led di blocco idrico.
3. 'pieno_fondi': Segnalazione di cassetto fondi pieno, blocco fondi, vaschetta piena o residui/liquidi fuoriusciti.
4. 'blocco_hardware': Codici d'errore gravi come Errore RAM, Errore Scheda, Errore Caldaia, guasti hardware interni non risolvibili dall'utente (es. ferma all'accensione).
5. 'vuoto_bicchieri': Pila o colonna bicchieri vuota, o bicchieri inceppati, o errore bicchieri.
6. 'monete_esatte': Display mostra "Inserire Monete Esatte", gettoniera bloccata o che rifiuta, tubi monete vuoti o problemi con chiavette.
7. 'riscaldamento': Scritta fissa "Riscaldamento..." sul display da più minuti, o surriscaldamento scocca.
8. 'bevanda_non_disponibile': Singoli prodotti disabilitati o bevanda specifica non disponibile (es. caffè finito, contenitore vuoto, solubili finiti).
9. 'senza_bicchiere': Errore o LED fisso "Senza Bicchiere".
10. 'icone_grigie': Icone prodotti grigie non cliccabili.
11. 'unknown': Qualsiasi altro problema o se il messaggio non fornisce dettagli coerenti sul sintomo iniziale.

Inoltre, estrai se presenti:
- Un codice macchina (es. 'VM-1234', 'Vending 4', ecc.).
- La posizione/locazione fornita dell'apparecchiatura.
- Una data di osservazione/rilevazione.`,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            symptom: {
              type: Type.STRING,
              description: "Uno tra: 'macchina_spenta', 'display_vuoto_acqua', 'pieno_fondi', 'blocco_hardware', 'vuoto_bicchieri', 'monete_esatte', 'riscaldamento', 'bevanda_non_disponibile', 'senza_bicchiere', 'icone_grigie', 'unknown'."
            },
            confidence: {
              type: Type.NUMBER,
              description: "Valore di confidenza dell'estrazione (0.0 a 1.0)."
            },
            explanation: {
              type: Type.STRING,
              description: "Spiegazione sintetica in italiano del perché è stata scelta questa classificazione."
            },
            extractedDeviceCode: {
              type: Type.STRING,
              description: "Codice della macchina estratto, se menzionato, altrimenti vuoto."
            },
            extractedLocation: {
              type: Type.STRING,
              description: "Posizione fisica estratta, se menzionata, altrimenti vuoto."
            }
          },
          required: ['symptom', 'confidence', 'explanation']
        }
      }
    });

    const resultText = response.text;
    if (!resultText) {
      throw new Error("Risposta vuota da parte del modello AI.");
    }

    const data = JSON.parse(resultText.trim());
    res.json(data);
  } catch (error: any) {
    console.warn('Initial analysis: running deterministic fallback due to Gemini error/quota:', error.message || error);
    try {
      const fallbackData = fallbackAnalyzeInitial(req.body.text || "");
      res.json(fallbackData);
    } catch (fallbackErr: any) {
      console.error('Fallback initial analysis failed:', fallbackErr);
      res.status(500).json({ error: error.message || 'Errore interno del server.' });
    }
  }
});

// 2. API: Classificazione Risposta Utente ai Passaggi Diagnostici
app.post('/api/triage/classify-answer', async (req, res) => {
  try {
    const { text, state } = req.body;
    if (!text || !state) {
      return res.status(400).json({ error: 'Testo e stato sono richiesti.' });
    }

    const ai = getGeminiClient();

    let classificationInstructions = '';
    const validOutputs: string[] = [];

    switch (state) {
      case 'ASKED_START_BLOCK':
        classificationInstructions = "Classifica se l'utente indica che la macchina si ferma/blocca anomala in fase di accensione ('FERMA') o se è del tutto spenta, non dà segni di vita ('OFF').";
        validOutputs.push('FERMA', 'OFF');
        break;

      case 'ASKED_POWER':
        classificationInstructions = "Classifica se l'utente indica che la spina di corrente È attaccata/inserita ('YES') oppure NO ('NO'). Se risponde in modo ambiguo e sembra propendere per non attaccata, usa 'NO'.";
        validOutputs.push('YES', 'NO');
        break;

      case 'ASKED_BUILDING_POWER':
        classificationInstructions = "Classifica se c'è corrente elettrica nell'edificio/impianto generale ('YES') oppure se manca o c'è un blackout generale ('NO').";
        validOutputs.push('YES', 'NO');
        break;

      case 'ASKED_PUMP_RESET':
        classificationInstructions = "Classifica se l'utente afferma che l'errore sul display OPPURE il malfunzionamento persiste ancora ('YES') oppure se è RISOLTO/andato a buon fine/sparito l'errore ('NO'). Ad esempio: 'no, non va', 'persiste' -> YES. 'Sì, ora va', 'risolto' -> NO.";
        validOutputs.push('YES', 'NO');
        break;

      case 'ASKED_WATER_SOURCE':
        classificationInstructions = "Classifica se la macchina vending usa una 'TANICA' interna d'acqua (serbatoio caricabile) oppure se è allacciata alla 'RETE' idrica (rete principale a muro). Se il cliente esprime incertezza totale, classifica come 'UNKNOWN'.";
        validOutputs.push('TANICA', 'RETE', 'UNKNOWN');
        break;

      case 'ASKED_BUILDING_WATER':
        classificationInstructions = "Classifica se l'acqua scorre regolarmente dagli altri rubinetti della sede ('YES') o se manca in tutto l'edificio ('NO'). Altrimenti usa 'UNKNOWN'.";
        validOutputs.push('YES', 'NO', 'UNKNOWN');
        break;

      case 'ASKED_GROUNDS_CLEAN':
        classificationInstructions = "Classifica se l'utente indica che la vaschetta raccogli-fondi è visibilmente piena, sporca o con liquidi che fuoriescono ('YES') oppure se dice che l'ha appena svuotata ma il blocco persiste, o che è vuota/pulita ('NO').";
        validOutputs.push('YES', 'NO');
        break;

      case 'ASKED_GLASSES_EMPTY':
        classificationInstructions = "Classifica se l'utente conferma che la colonna dei bicchieri è effettivamente vuota ('COLONNA_VUOTA') oppure se i bicchieri sono presenti nella colonna ma sono inceppati/bloccati ('PRESENTI_INCEPPATI').";
        validOutputs.push('COLONNA_VUOTA', 'PRESENTI_INCEPPATI');
        break;

      case 'ASKED_COIN_JAM':
        classificationInstructions = "Classifica se la gettoniera è bloccata fisicamente o monete incastrate ('BLOCCATA_INCASTRATA') oppure se accetta le monete ma non dà il resto / i tubi sono vuoti ('ACCETTA_NO_RESTO').";
        validOutputs.push('BLOCCATA_INCASTRATA', 'ACCETTA_NO_RESTO');
        break;

      case 'ASKED_COIN_OBSTRUCTION':
        classificationInstructions = "Classifica se l'utente conferma la presenza visibile di ostruzioni/corpi estranei nella feritoia di inserimento monete ('YES') o se la feritoia è libera ('NO').";
        validOutputs.push('YES', 'NO');
        break;

      case 'ASKED_HEATING_TIME':
        classificationInstructions = "Classifica se la macchina è appena stata accesa / da meno di 10 minuti ('ATTENDERE') o se la scritta Riscaldamento è fissa da oltre 15-20 minuti / scocca calda ('PERSISTE_CALDO').";
        validOutputs.push('ATTENDERE', 'PERSISTE_CALDO');
        break;

      case 'ASKED_PROD_TYPE':
        classificationInstructions = "Classifica se il malfunzionamento riguarda esclusivamente le bevande a base di 'COFFEE' (caffè in grani) o riguarda bevande a base di prodotti solubili in polvere come latte, tè, cioccolato ('SOLUBILI').";
        validOutputs.push('COFFEE', 'SOLUBILI');
        break;

      case 'ASKED_PROD_COFFEE_EMPTY':
        classificationInstructions = "Classifica se il contenitore trasparente del caffè in grani in alto è effettivamente vuoto ('YES') oppure se è pieno ('NO').";
        validOutputs.push('YES', 'NO');
        break;

      case 'ASKED_PROD_COFFEE_OBSTRUCTION':
        classificationInstructions = "Classifica se l'utente riscontra che il caffè macinato ha ostruito il dosatore sotto il contenitore chicchi ('YES') o se no, è libero ('NO').";
        validOutputs.push('YES', 'NO');
        break;

      case 'ASKED_PROD_SOLUBLE_STATUS':
        classificationInstructions = "Classifica se si nota della polvere sparsa/incrostata o rumore anomalo del mixer ('POLVERE_SPARSA') oppure se il contenitore della polvere solubile è vuoto ('CONTENITORE_VUOTO').";
        validOutputs.push('POLVERE_SPARSA', 'CONTENITORE_VUOTO');
        break;

      case 'ASKED_ICONS_BLOCK_TYPE':
        classificationInstructions = "Classifica se è attiva una modalità di blocco per 'FASCI_ORARIA' (lavaggio automatico/fasce orarie programmata) o se non è attiva alcuna tale modalità ('DOSATORI_VUOTI').";
        validOutputs.push('FASCIA_ORARIA', 'DOSATORI_VUOTI');
        break;

      default:
        return res.status(400).json({ error: 'Stato non supportato per la classificazione.' });
    }

    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: `Risposta utente: "${text}"`,
      config: {
        systemInstruction: `Sei il classificatore deterministico di risposte per l'albero decisionale.
Segui attentamente queste istruzioni:
${classificationInstructions}
Formatta la risposta ESCLUSIVAMENTE con la stringa di output corretta tra quelle permesse: ${validOutputs.join(', ')}.`,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            classification: {
              type: Type.STRING,
              description: `Valore classificato. Deve essere rigorosamente uno tra: ${validOutputs.join(', ')}.`
            },
            explanation: {
              type: Type.STRING,
              description: "Breve spiegazione logica dell'assegnazione."
            }
          },
          required: ['classification']
        }
      }
    });

    const resultText = response.text;
    if (!resultText) {
      throw new Error("Risposta vuota da parte del modello AI.");
    }

    const data = JSON.parse(resultText.trim());
    res.json(data);
  } catch (error: any) {
    console.warn('Answer classification: running deterministic fallback due to Gemini error/quota:', error.message || error);
    try {
      const fallbackValue = fallbackClassifyAnswer(req.body.text || "", req.body.state || "");
      res.json({
        classification: fallbackValue,
        explanation: `Classificazione di fallback per lo stato ${req.body.state || ""} eseguita con successo per salvaguardare l'esperienza utente.`
      });
    } catch (fallbackErr: any) {
      console.error('Fallback answer classification failed:', fallbackErr);
      res.status(500).json({ error: error.message || 'Errore interno del server.' });
    }
  }
});

// 3. API: Estrazione Informazioni in Fase di Escalation
app.post('/api/triage/extract-escalation', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Il testo è richiesto.' });
    }

    const ai = getGeminiClient();

    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: `Testo inserito: "${text}"`,
      config: {
        systemInstruction: `Sei un estrattore intelligente di dati in fase di escalation ticket.
Trova e analizza le seguenti tre variabili cruciali per l'invio della segnalazione:
- 'deviceCode': codice identificativo della vending machine (es. 'VM-1234', 'Codice Macchina: 9021', 'VM902').
- 'location': posizione fisica dell'apparecchio nell'edificio (es. 'Ufficio 3A, Primo Piano', 'Corridoio Mensa').
- 'date': data di rilevamento o odierna se l'utente scrive oggi/ieri. Formattala se possibile come AAAA-MM-GG o mantieni il formato trovato.

Ritorna valori vuoti per quelli non individuati, così da permettere al sistema di richiederli.`,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            extractedDeviceCode: { type: Type.STRING },
            extractedLocation: { type: Type.STRING },
            extractedDate: { type: Type.STRING },
            explanation: { type: Type.STRING }
          },
          required: ['extractedDeviceCode', 'extractedLocation', 'extractedDate']
        }
      }
    });

    const resultText = response.text;
    if (!resultText) {
      throw new Error("Risposta vuota da parte del modello AI.");
    }

    const data = JSON.parse(resultText.trim());
    res.json(data);
  } catch (error: any) {
    console.warn('Escalation extraction: running deterministic fallback due to Gemini error/quota:', error.message || error);
    try {
      const fallbackData = fallbackExtractEscalation(req.body.text || "");
      res.json(fallbackData);
    } catch (fallbackErr: any) {
      console.error('Fallback escalation extraction failed:', fallbackErr);
      res.status(500).json({ error: error.message || 'Errore interno del server.' });
    }
  }
});

// UI Server setup: Vite middleware in development, static files in production
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Vending AI Triage Server] avviato con successo su http://0.0.0.0:${PORT}`);
  });
}

startServer();
