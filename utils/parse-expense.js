export async function handleParseExpense(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Metodo non supportato." });
  }

  const transcript = typeof req.body?.transcript === "string" ? req.body.transcript.trim() : "";
  const categories = Array.isArray(req.body?.categories)
    ? [...new Set(req.body.categories.filter((name) => typeof name === "string").map((name) => name.trim()).filter((name) => name.length > 0 && name.length <= 50))].slice(0, 50)
    : [];

  if (!transcript || transcript.length > 500) {
    return res.status(400).json({ error: "La frase deve contenere da 1 a 500 caratteri." });
  }
  if (!categories.length) {
    return res.status(400).json({ error: "Non ci sono categorie disponibili." });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: "Servizio non configurato: aggiungi GROQ_API_KEY alle variabili d'ambiente del deploy." });
  }

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || "openai/gpt-oss-20b",
        messages: [
          {
            role: "system",
            content: `Interpreti dettature in italiano per registrare una singola spesa personale. Estrai l'importo numerico in euro, una descrizione breve e la categoria più adatta scegliendola esclusivamente tra quelle fornite. Non inventare un importo: se non è chiaro, usa 0. Non aggiungere informazioni non dette. Rispondi esclusivamente con un oggetto JSON con le proprietà amount (numero), description (stringa) e category (stringa). La categoria deve corrispondere esattamente a una delle categorie disponibili: ${JSON.stringify(categories)}.`,
          },
          {
            role: "user",
            content: JSON.stringify({ frase: transcript, categorie_disponibili: categories }),
          },
        ],
        temperature: 0,
        max_tokens: 200,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "expense",
            strict: true,
            schema: {
              type: "object",
              properties: {
                amount: { type: "number" },
                description: { type: "string" },
                category: { type: "string", enum: categories },
              },
              required: ["amount", "description", "category"],
              additionalProperties: false,
            },
          },
        },
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) {
      const error = new Error(`Groq API ha risposto con HTTP ${response.status}.`);
      error.status = response.status;
      throw error;
    }

    const payload = await response.json();
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error("Il modello non ha restituito dati strutturati.");
    const result = JSON.parse(content);
    const amount = Number(result.amount);
    const description = typeof result.description === "string" ? result.description.trim().slice(0, 60) : "";

    if (!Number.isFinite(amount) || amount <= 0 || !description || !categories.includes(result.category)) {
      return res.status(422).json({ error: "Non ho identificato con certezza importo e descrizione. Modifica i campi manualmente." });
    }

    return res.json({ amount: Math.round(amount * 100) / 100, description, category: result.category });
  } catch (error) {
    console.error("Interpretazione della spesa non riuscita:", {
      message: error.message,
      status: error.status,
      code: error.code,
    });
    if (error.status === 429) {
      return res.status(429).json({ error: "Il limite gratuito di Groq è stato raggiunto. Riprova più tardi." });
    }
    if (error.status === 401 || error.status === 403) {
      return res.status(503).json({ error: "La chiave Groq non è valida o non è autorizzata. Verifica la configurazione del servizio." });
    }
    if (error.status === 404) {
      return res.status(503).json({ error: "Il modello Groq configurato non è disponibile. Verifica GROQ_MODEL." });
    }
    if (error.status >= 500 || error.name === "TimeoutError" || error.name === "AbortError" || error instanceof TypeError) {
      return res.status(503).json({ error: "Groq è temporaneamente non disponibile. Riprova tra poco." });
    }
    return res.status(502).json({ error: "Non riesco a interpretare la frase in questo momento. Riprova o compila i campi manualmente." });
  }
}