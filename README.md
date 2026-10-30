# Saldo — finanza personale

Dashboard responsive realizzata con HTML, CSS e JavaScript vanilla, con un piccolo backend Node.js per interpretare le spese dettate.

## Funzioni

- Registra, modifica ed elimina spese con descrizione, importo, categoria, data e nota.
- Crea categorie personalizzate e imposta il budget mensile.
- Visualizza riepilogo, spesa media, grafico settimanale/mensile/annuale e ripartizione per categoria.
- Cerca e filtra i movimenti.
- Dettatura italiana tramite Web Speech API, quando supportata dal browser; Gemini interpreta la trascrizione e restituisce importo, descrizione e categoria in formato strutturato.

## Dati e privacy

Spese, categorie e budget sono conservati nel `localStorage` del browser. Il microfono è gestito dal browser tramite Web Speech API; solo il testo riconosciuto viene inviato al backend e a Gemini per l'interpretazione. La dashboard non salva né invia registrazioni audio. Il piano gratuito di Gemini ha quote e limiti variabili; Google può usare i contenuti inviati nel livello gratuito per migliorare i propri prodotti. Consulta [prezzi e condizioni aggiornati](https://ai.google.dev/gemini-api/docs/pricing) prima dell'uso.

## Avvio

1. Installa Node.js 18 o successivo e le dipendenze con `npm install`.
2. Crea una chiave Gemini in [Google AI Studio](https://aistudio.google.com/apikey), copia `.env.example` in `.env` e inserisci la chiave in `GEMINI_API_KEY` (non inserirla mai nel codice frontend o nel repository). Per restare sul livello gratuito, non attivare la fatturazione del progetto Google Cloud.
3. Avvia l'app con `npm start` e apri `http://localhost:3000`.

Per usare il microfono, il browser richiede il relativo permesso e un'origine sicura come `localhost`. La trascrizione vocale dipende dal supporto del browser; l'interpretazione di importo, descrizione e categoria avviene invece tramite il backend e la Gemini API. Quando la quota gratuita viene raggiunta, le richieste possono fallire fino al ripristino della quota.
