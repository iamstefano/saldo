# Saldo — finanza personale

Dashboard responsive, realizzata con HTML, CSS e JavaScript vanilla. Non richiede installazione o un account: apri `index.html` tramite un server statico.

## Funzioni

- Registra, modifica ed elimina spese con descrizione, importo, categoria, data e nota.
- Crea categorie personalizzate e imposta il budget mensile.
- Visualizza riepilogo, spesa media, grafico settimanale/mensile/annuale e ripartizione per categoria.
- Cerca e filtra i movimenti.
- Dettatura italiana tramite Web Speech API, quando supportata dal browser. La disponibilità del riconoscimento vocale e il trattamento dell'audio dipendono dal browser e dalle sue impostazioni.

## Dati e privacy

Spese, categorie e budget sono conservati nel `localStorage` del browser, su questo dispositivo; non è previsto un server o un account. Cancellando i dati del sito dal browser si cancellano anche i movimenti salvati. La dettatura è un servizio del browser e può avere un trattamento separato: controlla le relative impostazioni privacy. La dashboard non salva registrazioni audio.

## Avvio

Apri `index.html` in un browser moderno oppure servi la cartella con un server statico. Per usare il microfono, il browser potrebbe richiedere HTTPS o un'origine locale (`localhost`) e il relativo permesso.
