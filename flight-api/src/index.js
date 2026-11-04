const jsonHeaders = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = (env.ALLOWED_ORIGINS || "").split(",").map(value => value.trim()).filter(Boolean);
    const cors = allowed.includes(origin) ? {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin"
    } : {};
    const respond = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...jsonHeaders, ...cors } });

    if (request.method === "OPTIONS") {
      if (!allowed.includes(origin)) return respond({ error: "Origine non autorisée." }, 403);
      return new Response(null, { status: 204, headers: cors });
    }
    if (!allowed.includes(origin)) return respond({ error: "Origine non autorisée." }, 403);
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/api/flight-search") return respond({ error: "Adresse introuvable." }, 404);
    if (!env.RAPIDAPI_KEY) return respond({ error: "Le service de recherche n’est pas encore configuré." }, 503);

    let input;
    try { input = await request.json(); } catch { return respond({ error: "Requête invalide." }, 400); }
    const flightNumber = String(input.flightNumber || "").toUpperCase().replace(/[\s-]+/g, "");
    const date = String(input.date || "");
    if (!/^[A-Z0-9]{3,10}$/.test(flightNumber) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return respond({ error: "Indique un numéro de vol et une date valides." }, 400);
    }

    try {
      const providerUrl = `https://aerodatabox.p.rapidapi.com/flights/number/${encodeURIComponent(flightNumber)}/${date}?dateLocalRole=Departure`;
      const upstream = await fetch(providerUrl, {
        headers: { "X-RapidAPI-Key": env.RAPIDAPI_KEY, "X-RapidAPI-Host": "aerodatabox.p.rapidapi.com", "Accept": "application/json" }
      });
      if (!upstream.ok) {
        const providerBody = (await upstream.text()).trim();
        let providerMessage = "";
        if (providerBody) {
          try {
            const parsedError = JSON.parse(providerBody);
            providerMessage = String(parsedError.message || parsedError.error || parsedError.detail || "");
          } catch {
            providerMessage = providerBody.slice(0, 240);
          }
        }
        if (env.RAPIDAPI_KEY && providerMessage) providerMessage = providerMessage.split(env.RAPIDAPI_KEY).join("[clé masquée]");
        const error = upstream.status === 401 || upstream.status === 403
          ? "RapidAPI refuse la requête : vérifie l’abonnement AeroDataBox et la clé enregistrée dans Cloudflare."
          : upstream.status === 429
            ? "La limite de recherches RapidAPI est atteinte."
            : upstream.status === 400
              ? "AeroDataBox refuse les paramètres de recherche."
              : "Le fournisseur n’a pas pu répondre à la recherche.";
        const detail = [`HTTP ${upstream.status}`, providerMessage].filter(Boolean).join(" · ");
        console.warn("AeroDataBox request returned an error:", detail);
        return respond({ error, detail }, upstream.status === 429 ? 429 : 502);
      }
      if (upstream.status === 204) {
        return respond({
          results: [],
          message: "Aucune donnée de vol trouvée pour ce numéro à cette date. Vérifie le numéro et la date ; la disponibilité dépend aussi de la couverture et de l’offre AeroDataBox."
        });
      }
      const responseText = await upstream.text();
      if (!responseText.trim()) {
        console.warn("AeroDataBox returned an empty response:", upstream.status, upstream.headers.get("content-type") || "no content type");
        return respond({
          results: [],
          message: `AeroDataBox a renvoyé une réponse vide (HTTP ${upstream.status}). Vérifie que l’abonnement RapidAPI donne accès à l’endpoint Flight API utilisé.`
        });
      }

      let payload;
      try {
        payload = JSON.parse(responseText);
      } catch {
        const contentType = upstream.headers.get("content-type") || "type inconnu";
        console.warn("AeroDataBox returned a non-JSON response:", upstream.status, contentType, responseText.length);
        return respond({
          error: "AeroDataBox a renvoyé une réponse dans un format inattendu.",
          detail: `HTTP ${upstream.status} · ${contentType} · ${responseText.length} caractères`
        }, 502);
      }
      const flights = Array.isArray(payload) ? payload : Array.isArray(payload.flights) ? payload.flights : Array.isArray(payload.data) ? payload.data : [];
      const results = flights.map(flight => mapFlight(flight, flightNumber)).filter(Boolean);
      return respond({ results, message: results.length ? undefined : "Aucun vol trouvé pour cette date." });
    } catch (error) {
      // Keep the provider key out of logs and responses; the error message is
      // useful for diagnosing network or response parsing failures.
      console.error("AeroDataBox lookup failed:", error instanceof Error ? error.message : String(error));
      return respond({
        error: "Impossible de joindre le fournisseur de vols pour le moment.",
        detail: error instanceof Error ? error.message : "Erreur réseau inconnue"
      }, 502);
    }
  }
};

function mapFlight(flight, requestedNumber) {
  const departure = flight.departure || {};
  const arrival = flight.arrival || {};
  const airport = side => {
    const data = side.airport || {};
    const scheduled = side.scheduledTime?.local || "";
    const revised = side.revisedTime?.local || "";
    return {
      code: data.iata || data.icao || "",
      city: data.municipalityName || data.shortName || "",
      name: data.name || data.shortName || "",
      terminal: side.terminal || "",
      gate: side.gate || "",
      checkInDesk: side.checkInDesk || "",
      baggageBelt: side.baggageBelt || "",
      time: localTime(revised || scheduled),
      scheduledTime: localTime(scheduled),
      revisedTime: localTime(revised),
      runwayTime: localTime(side.runwayTime?.local || ""),
      quality: Array.isArray(side.quality) ? side.quality : []
    };
  };
  return {
    number: flight.number || flight.callSign || requestedNumber,
    airline: flight.airline?.name || "",
    airlineCode: flight.airline?.iata || flight.airline?.icao || "",
    status: flight.status || "",
    lastUpdatedUtc: flight.lastUpdatedUtc || "",
    callSign: flight.callSign || "",
    codeshareStatus: flight.codeshareStatus || "",
    aircraft: flight.aircraft?.model || "",
    aircraftRegistration: flight.aircraft?.reg || "",
    departure: airport(departure),
    arrival: airport(arrival),
    quality: [...new Set([...(departure.quality || []), ...(arrival.quality || [])])]
  };
}

function localTime(value) {
  const match = String(value).match(/(?:T|\s)(\d{2}:\d{2})/);
  return match ? match[1] : "";
}
