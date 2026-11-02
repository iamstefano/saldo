# Saldo — finanza personale

Dashboard responsive realizzata con HTML, CSS e JavaScript vanilla, con un piccolo backend Node.js per interpretare le spese dettate.

## Funzioni

- Registra, modifica ed elimina spese con descrizione, importo, categoria, data e nota.
- Crea categorie personalizzate e imposta il budget mensile.
- Visualizza riepilogo, spesa media, grafico settimanale/mensile/annuale e ripartizione per categoria.
- Cerca e filtra i movimenti.
- Dettatura italiana tramite Web Speech API, quando supportata dal browser; Groq interpreta la trascrizione e restituisce importo, descrizione e categoria in formato strutturato.

## Dati e privacy

Spese, categorie e budget sono conservati nel `localStorage` del browser. Il microfono è gestito dal browser tramite Web Speech API; solo il testo riconosciuto viene inviato al backend e a Groq per l'interpretazione. La dashboard non salva né invia registrazioni audio. Il piano gratuito di Groq ha limiti d'uso e disponibilità variabili: consulta [limiti aggiornati](https://console.groq.com/docs/rate-limits) e [informativa sulla privacy](https://groq.com/privacy-policy/) prima dell'uso.

## Avvio

1. Installa Node.js 18 o successivo e le dipendenze con `npm install`.
2. Crea una chiave API Groq in [Groq Console](https://console.groq.com/keys), copia `.env.example` in `.env` e inserisci la chiave in `GROQ_API_KEY` (non inserirla mai nel codice frontend o nel repository). Il modello predefinito è `openai/gpt-oss-20b`, presente nei [limiti del Free Plan](https://console.groq.com/docs/rate-limits); puoi cambiarlo con `GROQ_MODEL` solo con un ID abilitato nel tuo account.
3. Avvia l'app con `npm start` e apri `http://localhost:3000`.

Per usare il microfono, il browser richiede il relativo permesso e un'origine sicura come `localhost`. La trascrizione audio resta affidata alla Web Speech API del browser; solo il testo riconosciuto viene inviato al backend e interpretato da Groq. Il Free Plan ha limiti giornalieri e di frequenza: quando vengono raggiunti, le richieste possono fallire temporaneamente senza passare automaticamente a un piano a pagamento.

## Deploy su Vercel

1. Importa il repository in Vercel e lascia la directory di progetto come root; non impostare un Output Directory personalizzato.
2. In **Project → Settings → Environment Variables**, aggiungi `GROQ_API_KEY` e, facoltativamente, `GROQ_MODEL`. Seleziona gli ambienti da usare.
3. Esegui il deploy (o fai redeploy dopo aver aggiunto le variabili). Vercel esporrà `api/parse-expense.js` all'indirizzo `/api/parse-expense` e servirà i file statici del progetto.
4. Verifica la funzione da **Deployments → Functions/Logs**. In locale, `npm start` usa invece `local-server.js` e il file `.env`.

La logica della route è condivisa in `utils/parse-expense.js`; non inserire la chiave API nel frontend o nel repository.
