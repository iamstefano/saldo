import { GoogleGenAI, Type } from "@google/genai";

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

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: "Servizio non configurato: aggiungi GEMINI_API_KEY alle variabili d'ambiente del deploy." });
  }

  try {
    const gemini = new GoogleGenAI({ apiKey });
    const response = await gemini.models.generateContent({
      model: process.env.GEMINI_MODEL || "gemini-3.8-flash",
      contents: JSON.stringify({ frase: transcript, categorie_disponibili: categories }),
      config: {
        systemInstruction: "Interpreti dettature in italiano per registrare una singola spesa personale. Estrai l'importo numerico in euro, una descrizione breve e la categoria più adatta scegliendola esclusivamente tra quelle fornite. Non inventare un importo: se non è chiaro, usa 0. Non aggiungere informazioni non dette.",
        temperature: 0,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            amount: { type: Type.NUMBER },
            description: { type: Type.STRING },
            category: { type: Type.STRING, enum: categories },
          },
          required: ["amount", "description", "category"],
        },
      },
    });

    const content = response.text;
    if (!content) throw new Error("Il modello non ha restituito dati strutturati.");
    const result = JSON.parse(content);
    const amount = Number(result.amount);
    const description = typeof result.description === "string" ? result.description.trim().slice(0, 60) : "";

    if (!Number.isFinite(amount) || amount <= 0 || !description || !categories.includes(result.category)) {
      return res.status(422).json({ error: "Non ho identificato con certezza importo e descrizione. Modifica i campi manualmente." });
    }

    return res.json({ amount: Math.round(amount * 100) / 100, description, category: result.category });
  } catch (error) {
    console.error("Interpretazione della spesa non riuscita:", error.message);
    if (error.status === 429) {
      return res.status(429).json({ error: "La quota gratuita di Gemini è temporaneamente esaurita. Riprova più tardi." });
    }
    return res.status(502).json({ error: "Non riesco a interpretare la frase in questo momento. Riprova o compila i campi manualmente." });
  }
}