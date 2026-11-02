(() => {
  const SCOPE = "https://www.googleapis.com/auth/drive.file";
  const STATE_SHEET = "Saldo";
  const STATE_MARKER = "SALDO_STATE_V1";
  const CHUNK_SIZE = 40000;
  let config = {};
  let tokenClient = null;
  let accessToken = null;
  let tokenExpiresAt = 0;
  let tokenPromiseResolver = null;
  let consentRetryUsed = false;
  let pickerPromise = null;

  function configure(nextConfig = {}) {
    config = nextConfig;
  }

  function isConfigured() {
    return Boolean(config.clientId && config.apiKey && config.appId);
  }

  function missingConfiguration() {
    return [
      ["clientId", "OAuth Client ID"],
      ["apiKey", "API key"],
      ["appId", "Google Cloud project number"],
    ].filter(([key]) => !config[key]).map(([, label]) => label);
  }

  function loadScript(id, src) {
    const existing = document.getElementById(id);
    if (existing?.dataset.loaded === "true") return Promise.resolve();
    if (existing) {
      return new Promise((resolve, reject) => {
        existing.addEventListener("load", resolve, { once: true });
        existing.addEventListener("error", reject, { once: true });
      });
    }
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.id = id;
      script.src = src;
      script.async = true;
      script.onload = () => {
        script.dataset.loaded = "true";
        resolve();
      };
      script.onerror = () => reject(new Error("Non riesco a caricare i servizi Google. Controlla la connessione e le impostazioni del browser."));
      document.head.append(script);
    });
  }

  async function authorize() {
    if (!isConfigured()) {
      throw new Error(`Configurazione Google mancante: ${missingConfiguration().join(", ")}.`);
    }
    await loadScript("google-identity-services", "https://accounts.google.com/gsi/client");
    if (!window.google?.accounts?.oauth2) throw new Error("Il servizio di accesso Google non è disponibile.");

    if (!tokenClient) {
      tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: config.clientId,
        scope: SCOPE,
        callback: (response) => {
          if (response.error === "interaction_required" && !consentRetryUsed) {
            consentRetryUsed = true;
            tokenClient.requestAccessToken({ prompt: "consent" });
            return;
          }
          const resolve = tokenPromiseResolver;
          tokenPromiseResolver = null;
          if (response.error || !response.access_token) {
            resolve?.(new Error("Google non ha autorizzato l'accesso al foglio."));
            return;
          }
          accessToken = response.access_token;
          tokenExpiresAt = Date.now() + (Number(response.expires_in) || 3600) * 1000;
          resolve?.(accessToken);
        },
        error_callback: (error) => {
          const resolve = tokenPromiseResolver;
          tokenPromiseResolver = null;
          resolve?.(new Error(error?.message || "Accesso Google annullato."));
        },
      });
    }

    if (accessToken && Date.now() < tokenExpiresAt - 60000) return accessToken;
    return new Promise((resolve, reject) => {
      consentRetryUsed = false;
      tokenPromiseResolver = (result) => {
        if (result instanceof Error) reject(result);
        else resolve(result);
      };
      let consentGiven = false;
      try {
        consentGiven = localStorage.getItem("saldo-google-consent") === "granted";
      } catch {
        // Continue with the normal Google consent flow when storage is unavailable.
      }
      tokenClient.requestAccessToken({ prompt: consentGiven ? "" : "consent" });
    }).then((token) => {
      try {
        localStorage.setItem("saldo-google-consent", "granted");
      } catch {
        // A missing consent marker only means Google may show consent again later.
      }
      return token;
    });
  }

  async function loadPicker() {
    if (!pickerPromise) {
      pickerPromise = loadScript("google-api-loader", "https://apis.google.com/js/api.js")
        .then(() => new Promise((resolve, reject) => {
          if (!window.gapi?.load) return reject(new Error("Google Picker non è disponibile."));
          window.gapi.load("picker", { callback: resolve, onerror: () => reject(new Error("Non riesco ad avviare Google Picker.")) });
        }));
    }
    return pickerPromise;
  }

  async function pickSpreadsheet() {
    await loadPicker();
    if (!accessToken) throw new Error("Autorizza prima l'accesso Google.");

    return new Promise((resolve, reject) => {
      const picker = new window.google.picker.PickerBuilder()
        .addView(window.google.picker.ViewId.SPREADSHEETS)
        .setOAuthToken(accessToken)
        .setDeveloperKey(config.apiKey)
        .setAppId(config.appId)
        .setOrigin(window.location.origin)
        .setCallback((data) => {
          if (data.action === window.google.picker.Action.PICK) {
            const doc = data.docs?.[0];
            if (doc?.id) resolve({ id: doc.id, name: doc.name || "Foglio Google" });
            else reject(new Error("Non è stato selezionato un foglio Google valido."));
          } else if (data.action === window.google.picker.Action.CANCEL) {
            resolve(null);
          }
        })
        .build();
      picker.setVisible(true);
    });
  }

  async function apiRequest(url, options = {}) {
    if (!accessToken || Date.now() >= tokenExpiresAt) throw new Error("La sessione Google è scaduta. Ricollega il foglio per continuare la sincronizzazione.");
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = body.error?.message || `Google API ha risposto con HTTP ${response.status}.`;
      if (response.status === 401 || response.status === 403) accessToken = null;
      throw new Error(message);
    }
    return body;
  }

  async function getSheetInfo(spreadsheetId) {
    return apiRequest(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=properties.title,sheets.properties`);
  }

  async function ensureStateTab(spreadsheetId, sheetInfo) {
    const sheet = sheetInfo.sheets?.find((item) => item.properties?.title === STATE_SHEET);
    if (sheet) return sheetInfo;
    const result = await apiRequest(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: STATE_SHEET } } }] }),
    });
    const added = result.replies?.[0]?.addSheet?.properties;
    return { ...sheetInfo, sheets: [...(sheetInfo.sheets || []), { properties: added || { title: STATE_SHEET } }] };
  }

  function quotedRange(title) {
    return `'${title.replaceAll("'", "''")}'!A:Z`;
  }

  async function readState(spreadsheetId) {
    let sheetInfo = await getSheetInfo(spreadsheetId);
    sheetInfo = await ensureStateTab(spreadsheetId, sheetInfo);
    const title = sheetInfo.sheets.find((item) => item.properties?.title === STATE_SHEET).properties.title;
    const range = encodeURIComponent(quotedRange(title));
    const response = await apiRequest(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${range}?majorDimension=ROWS`);
    const rows = response.values || [];
    if (rows[0]?.[0] !== STATE_MARKER) {
      if (rows.some((row) => row.some((cell) => String(cell).trim()))) {
        throw new Error(`La scheda “${STATE_SHEET}” contiene già dati non riconosciuti da Saldo. Non li ho modificati: scegli un foglio vuoto o rinomina la scheda esistente.`);
      }
      return { title: sheetInfo.properties?.title || "Foglio Google", data: null };
    }
    const json = rows.slice(1).map((row) => row[0] || "").join("");
    if (!json) return { title: sheetInfo.properties?.title || "Foglio Google", data: null };
    try {
      return { title: sheetInfo.properties?.title || "Foglio Google", data: JSON.parse(json) };
    } catch {
      throw new Error("I dati del foglio Saldo non sono validi. Non ho modificato il foglio.");
    }
  }

  async function writeState(spreadsheetId, data) {
    let sheetInfo = await getSheetInfo(spreadsheetId);
    sheetInfo = await ensureStateTab(spreadsheetId, sheetInfo);
    const title = sheetInfo.sheets.find((item) => item.properties?.title === STATE_SHEET).properties.title;
    const range = encodeURIComponent(quotedRange(title));
    const existing = await apiRequest(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${range}?majorDimension=ROWS`);
    if (existing.values?.length && existing.values[0]?.[0] !== STATE_MARKER) {
      throw new Error(`La scheda “${STATE_SHEET}” contiene dati non riconosciuti da Saldo. Non li ho sovrascritti.`);
    }
    const oldRows = existing.values?.length || 0;
    const json = JSON.stringify(data);
    const chunks = [];
    for (let index = 0; index < json.length; index += CHUNK_SIZE) {
      let end = Math.min(index + CHUNK_SIZE, json.length);
      if (end < json.length && /[\uD800-\uDBFF]/.test(json[end - 1])) end -= 1;
      chunks.push(json.slice(index, end));
      index = end - CHUNK_SIZE;
    }
    const rows = [[STATE_MARKER], ...chunks.map((chunk) => [chunk])];
    const rowCount = Math.max(oldRows, rows.length);
    while (rows.length < rowCount) rows.push([""]);
    const writeRange = encodeURIComponent(`'${title.replaceAll("'", "''")}'!A1:A${rowCount}`);
    await apiRequest(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${writeRange}?valueInputOption=RAW`, {
      method: "PUT",
      body: JSON.stringify({ majorDimension: "ROWS", values: rows }),
    });
    return json;
  }

  function disconnect() {
    if (accessToken && window.google?.accounts?.oauth2?.revoke) {
      window.google.accounts.oauth2.revoke(accessToken, () => {});
    }
    accessToken = null;
    tokenExpiresAt = 0;
    try {
      localStorage.removeItem("saldo-google-consent");
    } catch {
      // Revoking the token is sufficient if browser storage is unavailable.
    }
  }

  window.SaldoGoogleSheets = {
    configure,
    isConfigured,
    missingConfiguration,
    authorize,
    pickSpreadsheet,
    readState,
    writeState,
    disconnect,
  };
})();
