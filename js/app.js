import {
    configureCurrency,
    convertCurrency,
    formatCurrency,
    updateCurrencyConverter,
    swapCurrencies,
    setBudgetBaseCurrency,
    fetchExchangeRate,
    populateCurrencySelectors
} from './currency.js';

/**
 * Cap Commun — client application module.
 * State, rendering and actions live here. UI interactions use delegated events.
 */
// Échappe les caractères HTML pour éviter l'injection de scripts (XSS) via les données saisies
function esc(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// N'autorise que les liens http(s) — bloque javascript: et autres schémas dangereux dans les href
function safeUrl(url) {
    if (!url) return '';
    const trimmed = String(url).trim();
    if (/^https?:\/\//i.test(trimmed)) return esc(trimmed);
    return '';
}

// Affiche une date "31 août" sous forme de pastille jour/mois empilés
function dateBadgeHtml(dateStr) {
    if (!dateStr) return '<span class="card-date"></span>';
    const spaceIndex = dateStr.indexOf(' ');
    const day = spaceIndex === -1 ? dateStr : dateStr.slice(0, spaceIndex);
    const month = spaceIndex === -1 ? '' : dateStr.slice(spaceIndex + 1);
    return `
        <div class="date-badge">
            <span class="date-badge-day">${esc(day)}</span>
            ${month ? `<span class="date-badge-month">${esc(month)}</span>` : ''}
        </div>
    `;
}

// --- CARTE "AUJOURD'HUI" (Accueil) : convertit les dates en texte libre
// ("31 août", "1er sept.") en vraies dates pour trouver ce qui se passe
// aujourd'hui (ou le prochain événement) parmi vols/trains/activités.
function stripAccents(str) {
    return String(str).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

const FR_MONTHS = [
    ['janv', 0], ['fevr', 1], ['mars', 2], ['avr', 3], ['mai', 4],
    ['juin', 5], ['juil', 6], ['aout', 7], ['sept', 8], ['oct', 9], ['nov', 10], ['dec', 11]
];

function parseFrenchShortDate(dateStr, year) {
    if (!dateStr) return null;
    const cleaned = stripAccents(String(dateStr).toLowerCase()).replace(/[^a-z0-9\s]/g, ' ');
    const m = cleaned.match(/(\d{1,2})\s*(?:er)?\s+([a-z]+)/);
    if (!m) return null;
    const day = parseInt(m[1], 10);
    const monthWord = m[2];
    const found = FR_MONTHS.find(([prefix]) => monthWord.startsWith(prefix) || prefix.startsWith(monthWord));
    if (!found || day < 1 || day > 31) return null;
    const d = new Date(year, found[1], day);
    return isNaN(d.getTime()) ? null : d;
}

function parsePickerDate(value) {
    const text = String(value || '').trim();
    if (!text) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        const date = new Date(`${text}T00:00:00`);
        return Number.isNaN(date.getTime()) || dateToPickerValue(date) !== text ? null : date;
    }
    const numericDate = text.match(/^(\d{1,2})[/. -](\d{1,2})(?:[/. -](\d{4}))?$/);
    if (numericDate) {
        const year = numericDate[3] ? Number(numericDate[3]) : tripYear();
        const date = new Date(year, Number(numericDate[2]) - 1, Number(numericDate[1]));
        return date.getDate() === Number(numericDate[1]) && date.getMonth() === Number(numericDate[2]) - 1 ? date : null;
    }
    return parseFrenchShortDate(text, tripYear());
}

function dateToPickerValue(date) {
    if (!date) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function dateToStoredValue(value) {
    const date = parsePickerDate(value);
    return date ? date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : String(value || '').trim();
}

function syncDateText(input) {
    const picker = document.getElementById(input.dataset.datePicker);
    if (picker) picker.value = dateToPickerValue(parsePickerDate(input.value));
}

function syncDatePicker(picker) {
    const input = document.getElementById(picker.dataset.dateText);
    if (input && picker.value) input.value = dateToStoredValue(picker.value);
}

function timeToPickerValue(value) {
    const match = String(value || '').trim().match(/^(\d{1,2})(?::|h)(\d{2})/i);
    if (!match) return '';
    const hours = Number(match[1]), minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) return '';
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function syncTimeText(input) {
    const picker = document.getElementById(input.dataset.timePicker);
    if (picker) picker.value = timeToPickerValue(input.value);
}

function syncTimePicker(picker) {
    const input = document.getElementById(picker.dataset.timeText);
    if (input) input.value = picker.value;
}

function syncPickerControls(root = document) {
    root.querySelectorAll('[data-date-picker]').forEach(syncDateText);
    root.querySelectorAll('[data-time-picker]').forEach(syncTimeText);
}

function tripYear() {
    const y = parseInt(String((appData && appData.tripStart) || '').slice(0, 4), 10);
    return isNaN(y) ? new Date().getFullYear() : y;
}

function timeSortKey(str) {
    const digits = String(str || '').replace(/\D/g, '');
    if (!digits) return '9999';
    return digits.length <= 3 ? ('0' + digits).slice(-4) : digits.slice(0, 4);
}

function isSameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function collectScheduleItems() {
    const year = tripYear();
    const items = [];
    (appData.vols || []).forEach(v => {
        const d = parseFrenchShortDate(v.date, year);
        if (d) items.push({ date: d, time: v.depTime || '', sortKey: timeSortKey(v.depTime), icon: 'fa-plane', label: `${v.depCity || ''} → ${v.arrCity || ''}`, sub: `Vol ${v.num1 || ''}` });
    });
    (appData.transports || []).forEach(t => {
        const d = parseFrenchShortDate(t.date, year);
        if (d) items.push({ date: d, time: t.depTime || '', sortKey: timeSortKey(t.depTime), icon: 'fa-train', label: `${t.depStation || ''} → ${t.arrStation || ''}`, sub: t.train || t.type || '' });
    });
    (appData.programme || []).forEach(prog => {
        (prog.activites || []).forEach(act => {
            const d = parseFrenchShortDate(act.date, year);
            if (d) items.push({ date: d, time: act.heure || '', sortKey: timeSortKey(act.heure), icon: 'fa-location-dot', label: act.texte || '', sub: prog.ville || '' });
        });
    });
    return items;
}

// Destination du Programme dont la plage de dates couvre aujourd'hui,
// sinon la prochaine à venir — utilisée pour la météo locale.
function getCurrentOrNextDestination() {
    const year = tripYear();
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let current = null, next = null, nextStart = null;
    (appData.programme || []).forEach(prog => {
        const start = parseFrenchShortDate(prog.dateStart, year);
        const end = parseFrenchShortDate(prog.dateEnd, year);
        if (!start || !end) return;
        const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
        const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
        if (today >= startDay && today <= endDay) current = prog;
        else if (startDay > today && (!nextStart || startDay < nextStart)) { next = prog; nextStart = startDay; }
    });
    return current || next;
}

function renderTodayCard() {
    const container = document.getElementById('today-card-container');
    if (!container) return;
    const items = collectScheduleItems();
    if (items.length === 0) { container.innerHTML = ''; return; }

    const now = new Date();
    const todayItems = items.filter(i => isSameDay(i.date, now)).sort((a, b) => a.sortKey.localeCompare(b.sortKey));

    let title, subtitle, showItems;
    if (todayItems.length > 0) {
        title = "Aujourd'hui";
        subtitle = now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
        showItems = todayItems;
    } else {
        const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const future = items.filter(i => i.date.getTime() > todayMidnight.getTime()).sort((a, b) => a.date - b.date || a.sortKey.localeCompare(b.sortKey));
        if (future.length === 0) { container.innerHTML = ''; return; }
        const nextDate = future[0].date;
        showItems = future.filter(i => isSameDay(i.date, nextDate)).sort((a, b) => a.sortKey.localeCompare(b.sortKey));
        const diffDays = Math.round((new Date(nextDate.getFullYear(), nextDate.getMonth(), nextDate.getDate()) - todayMidnight) / 86400000);
        title = diffDays === 1 ? "Demain" : `Dans ${diffDays} jours`;
        subtitle = nextDate.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    }

    const itemsHtml = showItems.map(i => `
        <div class="today-item">
            <div class="today-item-icon"><i class="fa-solid ${i.icon}"></i></div>
            <div class="today-item-body">
                <div class="today-item-label">${esc(i.label)}</div>
                ${i.sub ? `<div class="today-item-sub">${esc(i.sub)}</div>` : ''}
            </div>
            ${i.time ? `<div class="today-item-time">${esc(i.time)}</div>` : ''}
        </div>
    `).join('');

    container.innerHTML = `
        <div class="card today-card">
            <div class="today-card-header">
                <div>
                    <div class="today-card-title">${esc(title)}</div>
                    <div class="today-card-subtitle">${esc(subtitle)}</div>
                </div>
                <div class="today-card-weather" id="today-card-weather" style="display:none;"></div>
            </div>
            ${itemsHtml}
        </div>
    `;

    fetchAndShowWeather();
}

// --- MÉTÉO DU JOUR (sans clé API — Open-Meteo) ---
const WEATHER_ICONS = {
    0: '☀️', 1: '🌤️', 2: '⛅', 3: '☁️',
    45: '🌫️', 48: '🌫️',
    51: '🌦️', 53: '🌦️', 55: '🌦️', 56: '🌧️', 57: '🌧️',
    61: '🌧️', 63: '🌧️', 65: '🌧️', 66: '🌧️', 67: '🌧️',
    71: '🌨️', 73: '🌨️', 75: '🌨️', 77: '🌨️',
    80: '🌦️', 81: '🌦️', 82: '🌧️', 85: '🌨️', 86: '🌨️',
    95: '⛈️', 96: '⛈️', 99: '⛈️'
};

const CITY_COORDS = {
    'lisbonne': [38.7223, -9.1393],
    'lisbon': [38.7223, -9.1393],
    'sintra': [38.8029, -9.3817],
    'cascais': [38.6969, -9.4215],
    'porto': [41.1579, -8.6291],
    'baixa': [38.7139, -9.1394],
    'alfama': [38.7110, -9.1290],
    'belem': [38.6979, -9.2066],
    'tokyo': [35.6762, 139.6503],
    'osaka': [34.6937, 135.5023],
    'kyoto': [35.0116, 135.7681],
    'nara': [34.6851, 135.8048],
    'hiroshima': [34.3853, 132.4553],
    'fukuoka': [33.5904, 130.4017],
    'sapporo': [43.0618, 141.3545],
    'nagoya': [35.1815, 136.9066],
    'yokohama': [35.4437, 139.6380],
    'kobe': [34.6901, 135.1955],
    'kanazawa': [36.5613, 136.6562],
    'nikko': [36.7199, 139.6982],
    'hakone': [35.2325, 139.1069],
    'kamakura': [35.3193, 139.5466],
    'nagano': [36.6513, 138.1810],
    'takayama': [36.1461, 137.2521],
    'naha': [26.2124, 127.6809],
    'okinawa': [26.2124, 127.6809],
    'beppu': [33.2846, 131.4914],
    'kumamoto': [32.7898, 130.7417],
    'nagasaki': [32.7503, 129.8779],
    'sendai': [38.2682, 140.8694],
    'himeji': [34.8394, 134.6939],
    // Quartiers/zones fréquents : rattachés aux coordonnées de leur ville,
    // au cas où "ville" contient un nom de quartier plutôt que la ville
    'shinjuku': [35.6762, 139.6503], 'shibuya': [35.6762, 139.6503],
    'asakusa': [35.6762, 139.6503], 'ginza': [35.6762, 139.6503],
    'akihabara': [35.6762, 139.6503], 'roppongi': [35.6762, 139.6503],
    'ueno': [35.6762, 139.6503], 'harajuku': [35.6762, 139.6503],
    'namba': [34.6937, 135.5023], 'dotonbori': [34.6937, 135.5023],
    'umeda': [34.6937, 135.5023], 'shinsaibashi': [34.6937, 135.5023],
    'gion': [35.0116, 135.7681], 'arashiyama': [35.0116, 135.7681],
    'higashiyama': [35.0116, 135.7681], 'fushimi': [35.0116, 135.7681],
    'kawaramachi': [35.0116, 135.7681]
};

const weatherCache = {};

function findCityCoords(ville) {
    if (!ville) return null;
    const key = stripAccents(String(ville).toLowerCase().trim());
    if (CITY_COORDS[key]) return CITY_COORDS[key];
    const found = Object.keys(CITY_COORDS).find(k => key.includes(k) || k.includes(key));
    return found ? CITY_COORDS[found] : null;
}

function showWeatherBadge(badge, weather) {
    if (!weather || !document.body.contains(badge)) return;
    const icon = WEATHER_ICONS[weather.code] || '🌡️';
    badge.innerHTML = `<span>${icon}</span><span class="today-card-weather-temp">${weather.temp}°C</span>`;
    badge.style.display = '';
}

// Position GPS de l'appareil (préférée) : plus fiable que de deviner via
// le nom de la ville dans Programme. Repli sur la destination du
// Programme si la géolocalisation est refusée/indisponible.
function getDeviceLocation() {
    return new Promise(resolve => {
        if (!navigator.geolocation) { resolve(null); return; }
        // Filet de sécurité : certains navigateurs/contextes ne déclenchent
        // jamais le callback d'erreur (permission jamais accordée ni
        // refusée), donc l'option "timeout" native ne suffit pas toujours.
        let settled = false;
        const done = (value) => { if (!settled) { settled = true; resolve(value); } };
        setTimeout(() => done(null), 5000);
        navigator.geolocation.getCurrentPosition(
            pos => done([
                Math.round(pos.coords.latitude * 100) / 100,
                Math.round(pos.coords.longitude * 100) / 100
            ]),
            () => done(null),
            { timeout: 5000, maximumAge: 15 * 60 * 1000 }
        );
    });
}

async function fetchAndShowWeather() {
    const badge = document.getElementById('today-card-weather');
    if (!badge) return;
    let coords = await getDeviceLocation();
    if (!coords) {
        const dest = getCurrentOrNextDestination();
        coords = dest ? findCityCoords(dest.ville) : null;
    }
    if (!coords) return;
    if (!document.body.contains(badge)) return;

    const cacheKey = coords.join(',');
    if (cacheKey in weatherCache) {
        showWeatherBadge(badge, weatherCache[cacheKey]);
        return;
    }
    try {
        const [lat, lon] = coords;
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&timezone=auto`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 6000);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);
        if (!res.ok) throw new Error('weather error');
        const data = await res.json();
        if (!data.current) throw new Error('no data');
        const weather = { temp: Math.round(data.current.temperature_2m), code: data.current.weather_code };
        weatherCache[cacheKey] = weather;
        showWeatherBadge(badge, weather);
    } catch (e) {
        weatherCache[cacheKey] = null;
    }
}

const demoUrl = new URL(window.location.href);
const DEMO_PREVIEW = demoUrl.searchParams.get('demo') === 'lisbonne';
const RESET_DEMO_PREVIEW = DEMO_PREVIEW && demoUrl.searchParams.get('reset') === '1';
if (RESET_DEMO_PREVIEW) {
    localStorage.removeItem('cap_commun_demo_lisbonne');
    demoUrl.searchParams.delete('reset');
    window.history.replaceState(window.history.state, '', demoUrl);
}

// Scénario fictif utilisé comme exemple sur une nouvelle installation.
const defaultData = {
    tripTitle: "Lisbonne entre copines 🌞",
    tripStart: "2027-04-16",
    tripEnd: "2027-04-20",
    tripType: "Vacances",
    tripGroup: "Amis",
    budgetCurrency: "EUR",
    budgetPeople: ["Léa", "Inès", "Maya", "Zoé"],
    vols: [
        { id: 501, type: "Aller · EXEMPLE FICTIF", compagnie: "À choisir", date: "16 avr.", dep: "CDG", depCity: "Paris", depTerminal: "Terminal à confirmer", depTime: "08:10", num1: "DEMO 01", arr: "LIS", arrCity: "Lisbonne", arrTerminal: "Terminal à confirmer", arrTime: "10:00", num2: "DEMO 01" },
        { id: 502, type: "Retour · EXEMPLE FICTIF", compagnie: "À choisir", date: "20 avr.", dep: "LIS", depCity: "Lisbonne", depTerminal: "Terminal à confirmer", depTime: "18:30", num1: "DEMO 02", arr: "CDG", arrCity: "Paris", arrTerminal: "Terminal à confirmer", arrTime: "22:10", num2: "DEMO 02" }
    ],
    programme: [
        {
            id: 701, ville: "Lisbonne", hotel: "Baixa · adresse à définir", dateStart: "16 avr.", dateEnd: "18 avr.",
            maps: "https://maps.google.com/?q=Baixa+Lisbon+Portugal", jours: ["16 avr.", "17 avr.", "18 avr."],
            activites: [
                { id: 7101, date: "16 avr.", heure: "12:00", texte: "Déjeuner gourmand au Time Out Market", lien: "https://maps.google.com/?q=Time+Out+Market+Lisbon" },
                { id: 7102, date: "16 avr.", heure: "16:00", texte: "Première balade dans les ruelles de l’Alfama", lien: "https://maps.google.com/?q=Alfama+Lisbon" },
                { id: 7103, date: "17 avr.", heure: "09:30", texte: "Tramway jusqu’au quartier de Belém", lien: "https://maps.google.com/?q=Belem+Lisbon" },
                { id: 7104, date: "17 avr.", heure: "11:00", texte: "Pastéis et promenade au bord du Tage", lien: "https://maps.google.com/?q=Pasteis+de+Belem" },
                { id: 7105, date: "18 avr.", heure: "10:00", texte: "Miradouro da Senhora do Monte · photos de groupe", lien: "https://maps.google.com/?q=Miradouro+da+Senhora+do+Monte" }
            ]
        },
        {
            id: 702, ville: "Sintra", hotel: "Retour à Lisbonne · hébergement à choisir", dateStart: "19 avr.", dateEnd: "20 avr.",
            maps: "https://maps.google.com/?q=Sintra+Portugal", jours: ["19 avr.", "20 avr."],
            activites: [
                { id: 7201, date: "19 avr.", heure: "09:00", texte: "Train de Lisbonne vers Sintra", lien: "https://maps.google.com/?q=Rossio+Station+Lisbon" },
                { id: 7202, date: "19 avr.", heure: "11:00", texte: "Palais de Pena · billets à vérifier", lien: "https://maps.google.com/?q=Pena+Palace+Sintra" },
                { id: 7203, date: "19 avr.", heure: "16:00", texte: "Pause goûter dans le centre historique", lien: "https://maps.google.com/?q=Sintra+historic+centre" },
                { id: 7204, date: "20 avr.", heure: "10:00", texte: "Dernier café, souvenirs et retour à Lisbonne", lien: "https://maps.google.com/?q=Lisbon+Portugal" }
            ]
        }
    ],
    checklist: [
        { id: 1, categorie: "PAPIERS & RÉSERVATIONS", texte: "Vérifier les cartes d’identité", checked: true },
        { id: 2, categorie: "PAPIERS & RÉSERVATIONS", texte: "Choisir et réserver les vols (exemples fictifs)", checked: false },
        { id: 3, categorie: "PAPIERS & RÉSERVATIONS", texte: "Comparer les hébergements à Baixa", checked: false },
        { id: 4, categorie: "À GLISSER DANS LE SAC", texte: "Lunettes de soleil et crème solaire", checked: false },
        { id: 5, categorie: "À GLISSER DANS LE SAC", texte: "Chaussures confortables pour les pavés", checked: false },
        { id: 6, categorie: "À GLISSER DANS LE SAC", texte: "Batterie externe et adaptateur", checked: false },
        { id: 7, categorie: "PETITS PLAISIRS", texte: "Créer une playlist pour le trajet", checked: true },
        { id: 8, categorie: "PETITS PLAISIRS", texte: "Laisser de la place pour les pastéis 🍮", checked: false }
    ],
    checklistsJour: {
        701: [
            { id: 1, texte: "Chapeau, eau et appareil photo", checked: false },
            { id: 2, texte: "Repérer le tram vers Belém", checked: true }
        ],
        702: [
            { id: 3, texte: "Vérifier les billets du palais", checked: false },
            { id: 4, texte: "Chaussures de marche pour Sintra", checked: false }
        ]
    },
    budget: [
        { id: 801, nom: "Vols · estimation pour 4", amount: 560, currency: "EUR", eur: 560, categorie: "Transport", payeurs: ["Léa"], methode: "Carte bleue", paid: false },
        { id: 802, nom: "Hébergement · 4 nuits", amount: 640, currency: "EUR", eur: 640, categorie: "Hébergement", payeurs: ["Inès"], methode: "Carte bleue", paid: false },
        { id: 803, nom: "Repas & pauses gourmandes", amount: 320, currency: "EUR", eur: 320, categorie: "Nourriture", payeurs: ["Maya"], methode: "Espèces", paid: false },
        { id: 804, nom: "Train et visites à Sintra", amount: 180, currency: "EUR", eur: 180, categorie: "Activités & Billets", payeurs: ["Zoé"], methode: "Carte bleue", paid: false },
        { id: 805, nom: "Petits extras & souvenirs", amount: 160, currency: "EUR", eur: 160, categorie: "Shopping", payeurs: [], methode: "", paid: false }
    ],
    infos: [
        { id: 901, titre: "À propos de cet itinéraire", desc: "Scénario de démonstration : adresses, horaires, vols et montants sont des exemples fictifs. Rien n’est réservé. Vérifiez chaque information avant votre vrai départ." },
        { id: 902, titre: "Notre camp de base", desc: "Quartier visé : Baixa, Lisbonne. Hébergement à comparer et à réserver ensemble. Garder l’adresse finale dans cette fiche." },
        { id: 903, titre: "Petite règle de groupe 💛", desc: "On partage les idées et les frais, on garde du temps libre, et chacune peut proposer une pause ou changer le programme." }
    ],
    transports: [
        { id: 1001, type: "Métro", train: "Trajet d’exemple · aéroport → Baixa", date: "16 avr.", depStation: "Aéroport de Lisbonne (LIS)", depTime: "11:00", depPlatform: "À vérifier", arrStation: "Baixa-Chiado", arrTime: "11:45", arrPlatform: "À vérifier", seat: "—", notes: "Exemple de trajet, vérifier la ligne et les horaires le jour du voyage." },
        { id: 1002, type: "Train", train: "Excursion à Sintra · à planifier", date: "19 avr.", depStation: "Lisbonne · gare à choisir", depTime: "09:00", depPlatform: "À vérifier", arrStation: "Sintra", arrTime: "10:00", arrPlatform: "À vérifier", seat: "—", notes: "Horaires indicatifs fictifs. Acheter les billets après vérification." }
    ],
    billets: [
        { id: 1101, nom: "Palais de Pena · à réserver", date: "19 avr. 2027", reference: "EXEMPLE · NON RÉSERVÉ", lien: "", notes: "Vérifier les horaires, le transport jusqu’au palais et la disponibilité avant de réserver." },
        { id: 1102, nom: "Vols aller-retour · à choisir", date: "16–20 avr. 2027", reference: "EXEMPLES FICTIFS", lien: "", notes: "Les cartes de vol affichées sont des données de démonstration, sans compagnie ni billet réels." }
    ]
};

const STORAGE_KEY = DEMO_PREVIEW ? 'cap_commun_demo_lisbonne' : 'voyage_data';
let appData = DEMO_PREVIEW
    ? JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') || JSON.parse(JSON.stringify(defaultData))
    : JSON.parse(localStorage.getItem('voyage_data') || localStorage.getItem('voyage_japon_data')) || defaultData;
Object.defineProperty(window, 'appData', { configurable: true, get: () => appData, set: value => { appData = value; } });

// Rétrocompatibilité : complète les champs manquants sur d'anciennes
// données (locales OU reçues du cloud). Doit être appelée à chaque fois
// qu'un nouveau jeu de données remplace appData en entier — pas
// seulement au chargement initial — sinon un document Firestore créé
// avant l'ajout d'une fonctionnalité (ex: billets) fait planter les
// actions qui y touchent (ex: "Enregistrer" un billet) après une sync.
function ensureDataShape() {
    if (!appData.tripTitle) appData.tripTitle = defaultData.tripTitle;
    if (!appData.tripStart) appData.tripStart = defaultData.tripStart;
    if (!appData.tripEnd) appData.tripEnd = defaultData.tripEnd;
    if (!appData.tripType) appData.tripType = 'Vacances';
    if (!appData.tripGroup) appData.tripGroup = 'Amis';
    if (!appData.vols) appData.vols = [];
    if (!appData.programme) appData.programme = [];
    if (!appData.checklist) appData.checklist = [];
    if (!appData.budget) appData.budget = [];
    if (!appData.infos) appData.infos = [];
    if (!appData.transports) appData.transports = [];
    if (!appData.billets) appData.billets = [];
    if (!appData.checklistsJour) appData.checklistsJour = {};
    if (!appData.budgetPeople) appData.budgetPeople = [];
    if (!appData.budgetCurrency) appData.budgetCurrency = 'EUR';
    if (!appData.preferences || typeof appData.preferences !== 'object' || Array.isArray(appData.preferences)) appData.preferences = {};
    appData.budget.forEach(exp => {
        if (!exp.payeurs) exp.payeurs = exp.payeur ? [exp.payeur] : [];
        if (exp.amount === undefined) exp.amount = Number(exp.eur) || 0;
        if (!exp.currency) exp.currency = 'EUR';
    });
}
window.ensureDataShape = ensureDataShape;
ensureDataShape();
configureCurrency({
    getAppData: () => appData,
    requireEditor,
    saveAppData: saveToLocalStorage,
    refreshBudget: updateBudgetUI,
    refreshDashboard: renderDashboardSummary
});

// L'édition est toujours disponible. Aucun compte éditeur n'est requis.
window.isEditor = true;

function requireEditor() {
    return true;
}

// Migre l'ancien format (une entrée par jour) vers le nouveau format
// (une entrée par ville avec une plage de dates), en regroupant les
// anciennes entrées par ville et en conservant leurs activités et
// la liste des jours (une entrée = un jour, avec ou sans activité).
function migrateLegacyProgramme() {
    const isLegacy = appData.programme.some(p => p.dateStart === undefined);
    if (isLegacy && appData.programme.length > 0) {
        const groups = [];
        const groupByVille = {};
        appData.programme.forEach(prog => {
            if (!groupByVille[prog.ville]) {
                const group = { id: prog.id, ville: prog.ville, hotel: prog.hotel, maps: prog.maps || '', activites: [], jours: [], firstDate: prog.date, lastDate: prog.date };
                groupByVille[prog.ville] = group;
                groups.push(group);
            }
            const group = groupByVille[prog.ville];
            group.lastDate = prog.date;
            if (!group.jours.includes(prog.date)) group.jours.push(prog.date);
            (prog.activites || []).forEach(act => {
                group.activites.push({ id: act.id || (Date.now() + Math.floor(Math.random() * 1000)), date: prog.date, heure: act.heure, texte: act.texte, lien: act.lien || '' });
            });
        });

        appData.programme = groups.map(g => ({
            id: g.id,
            ville: g.ville,
            dateStart: g.firstDate,
            dateEnd: g.lastDate,
            hotel: g.hotel,
            maps: g.maps,
            jours: g.jours,
            activites: g.activites
        }));
    }

    // Complète le champ "jours" pour les destinations qui n'ont pas encore
    // ce champ (déjà passées au format "une carte par destination" avant
    // que la programmation jour par jour n'existe).
    let changed = isLegacy;
    appData.programme.forEach(prog => {
        if (!prog.jours) {
            const joursSet = [];
            (prog.activites || []).forEach(act => {
                if (!joursSet.includes(act.date)) joursSet.push(act.date);
            });
            prog.jours = joursSet;
            changed = true;
        }
    });

    if (changed) saveToLocalStorage();
}
migrateLegacyProgramme();
window.migrateLegacyProgramme = migrateLegacyProgramme;

function saveToLocalStorage() {
    const serialized = JSON.stringify(appData);
    localStorage.setItem(STORAGE_KEY, serialized);
    if (!DEMO_PREVIEW) localStorage.setItem('voyage_japon_data', serialized); // compatibilité avec l'ancienne version
}

const TRAVEL_BACKGROUNDS = {
    lisbon: { image: 'images/travel/lisbon.jpg', label: 'Lisbonne' },
    tokyo: { image: 'images/travel/tokyo.jpg', label: 'Tokyo' },
    coast: { image: 'images/travel/coast.jpg', label: 'une côte ensoleillée' },
    journey: { image: 'images/travel/journey.jpg', label: 'votre destination' }
};

function getAutomaticTravelBackground() {
    const flights = Array.isArray(appData.vols) ? appData.vols : [];
    const outboundFlight = flights.find(flight => !/retour|return/i.test(String(flight.type || '')) && (flight.arrCity || flight.arr)) || flights.find(flight => flight.arrCity || flight.arr);
    const destination = String(outboundFlight?.arrCity || outboundFlight?.arr || appData.programme?.[0]?.ville || '').trim();
    const normalized = stripAccents(destination).toLowerCase();
    let key = 'journey';
    if (/\b(lis|lisbon|lisbonne|portugal)\b/.test(normalized)) key = 'lisbon';
    else if (/\b(hnd|nrt|tokyo|japon|japan|osaka|kyoto)\b/.test(normalized)) key = 'tokyo';
    else if (/\b(nce|muc|bcn|nap|nice|marseille|barcelone|barcelona|mediterranee|mediterranean|cote)\b/.test(normalized)) key = 'coast';
    return { key, destination: destination || 'Votre prochaine destination' };
}

function applyAppearancePreferences() {
    const preferences = appData.preferences || {};
    const theme = ['sun', 'ocean', 'lavender'].includes(preferences.theme) ? preferences.theme : 'sun';
    const selectedBackground = ['auto', ...Object.keys(TRAVEL_BACKGROUNDS)].includes(preferences.background) ? preferences.background : 'auto';
    const motion = preferences.motion === 'reduced' || preferences.reduceMotion ? 'reduced' : 'system';
    const automatic = getAutomaticTravelBackground();
    const backgroundKey = selectedBackground === 'auto' ? automatic.key : selectedBackground;
    const background = TRAVEL_BACKGROUNDS[backgroundKey] || TRAVEL_BACKGROUNDS.journey;
    const hero = document.querySelector('.home-header');

    document.documentElement.dataset.theme = theme;
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) themeMeta.content = theme === 'ocean' ? '#347f98' : theme === 'lavender' ? '#7962a2' : '#28594f';
    document.body.classList.toggle('reduce-motion', motion === 'reduced');
    document.body.dataset.travelBackground = backgroundKey;
    if (hero) {
        hero.style.backgroundImage = `linear-gradient(90deg, rgba(16, 39, 35, .74) 0%, rgba(16, 39, 35, .5) 48%, rgba(16, 39, 35, .13) 100%), linear-gradient(0deg, rgba(16, 39, 35, .34), transparent 62%), url("${background.image}")`;
    }

    document.querySelectorAll('[data-background]').forEach(button => {
        const selected = button.dataset.background === selectedBackground;
        button.classList.toggle('is-selected', selected);
        button.setAttribute('aria-pressed', String(selected));
    });
    const autoPreview = document.querySelector('[data-background-preview="auto"]');
    if (autoPreview) autoPreview.style.backgroundImage = `linear-gradient(180deg,rgba(26,49,46,.12),rgba(26,49,46,.44)),url("${TRAVEL_BACKGROUNDS[automatic.key].image}")`;
    document.querySelectorAll('[data-theme-choice]').forEach(button => {
        const selected = button.dataset.themeChoice === theme;
        button.classList.toggle('is-selected', selected);
        button.setAttribute('aria-pressed', String(selected));
    });
    const autoDestination = document.getElementById('settings-auto-destination');
    if (autoDestination) autoDestination.textContent = automatic.destination;
    document.querySelectorAll('[data-motion-choice]').forEach(button => {
        const selected = button.dataset.motionChoice === motion;
        button.classList.toggle('is-selected', selected);
        button.setAttribute('aria-pressed', String(selected));
    });
}

function setTravelBackground(background) {
    if (!['auto', ...Object.keys(TRAVEL_BACKGROUNDS)].includes(background)) return;
    const changed = appData.preferences.background !== background;
    appData.preferences.background = background;
    saveToLocalStorage();
    applyAppearancePreferences();
    if (changed) animateTravelBackgroundChange();
}

function shouldReduceMotion() {
    return document.body.classList.contains('reduce-motion') || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function animateTravelBackgroundChange() {
    const hero = document.querySelector('.home-header');
    if (!hero || shouldReduceMotion()) return;
    hero.classList.remove('is-changing-background');
    void hero.offsetWidth;
    hero.classList.add('is-changing-background');
    window.setTimeout(() => hero.classList.remove('is-changing-background'), 650);
}

function setVisualTheme(theme) {
    if (!['sun', 'ocean', 'lavender'].includes(theme)) return;
    appData.preferences.theme = theme;
    saveToLocalStorage();
    applyAppearancePreferences();
}

function setMotionPreference(mode) {
    if (!['system', 'reduced'].includes(mode)) return;
    appData.preferences.motion = mode;
    appData.preferences.reduceMotion = mode === 'reduced';
    saveToLocalStorage();
    applyAppearancePreferences();
}

function resetAppearance() {
    appData.preferences = { ...appData.preferences, theme: 'sun', background: 'auto', motion: 'system', reduceMotion: false };
    saveToLocalStorage();
    applyAppearancePreferences();
}

function setTripBackupFeedback(message, state = '') {
    const feedback = document.getElementById('trip-backup-feedback');
    if (!feedback) return;
    feedback.textContent = message;
    feedback.dataset.state = state;
}

function exportTripBackup() {
    try {
        const backup = {
            format: 'cap-commun-backup',
            version: 1,
            exportedAt: new Date().toISOString(),
            data: appData
        };
        const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
        const objectUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        const safeTitle = String(appData.tripTitle || 'sejour')
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'sejour';
        link.href = objectUrl;
        link.download = `${safeTitle}-cap-commun.json`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
        setTripBackupFeedback('Copie téléchargée. Tu pourras la réimporter sur un autre appareil.', 'success');
    } catch {
        setTripBackupFeedback('Le téléchargement a échoué. Réessaie depuis un autre navigateur.', 'error');
    }
}

function importTripBackup(fileInput) {
    const file = fileInput.files?.[0];
    if (!file) return;
    (async () => {
        try {
            if (file.size > 5 * 1024 * 1024) throw new Error('Le fichier dépasse la limite de 5 Mo.');
            const backup = JSON.parse(await file.text());
            const data = backup?.format === 'cap-commun-backup' && backup?.version === 1 ? backup.data : null;
            const requiredLists = ['vols', 'programme', 'checklist', 'budget', 'transports', 'billets', 'infos'];
            if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.tripTitle !== 'string' ||
                requiredLists.some(key => !Array.isArray(data[key]))) {
                throw new Error('Ce fichier ne ressemble pas à une sauvegarde Cap Commun valide.');
            }
            if (!confirm(`Importer « ${data.tripTitle} » et remplacer le séjour actuellement enregistré dans ce navigateur ?`)) {
                setTripBackupFeedback('Import annulé. Tes données actuelles n’ont pas été remplacées.');
                return;
            }

            const previousData = appData;
            appData = data;
            try {
                ensureDataShape();
                migrateLegacyProgramme();
                saveToLocalStorage();
            } catch (error) {
                appData = previousData;
                throw error;
            }
            selectedItineraryProgrammeId = null;
            Object.keys(selectedItineraryDayByProgramme).forEach(key => delete selectedItineraryDayByProgramme[key]);
            currentChecklistScope = 'voyage';
            currentChecklistFilter = 'all';
            currentChecklistSearch = '';
            collapsedChecklistCategories.clear();
            Object.keys(expandedVols).forEach(key => delete expandedVols[key]);
            refreshAllUI();
            setTripBackupFeedback(`« ${appData.tripTitle} » a été importé sur cet appareil.`, 'success');
        } catch (error) {
            setTripBackupFeedback(error.message || 'Import impossible. Vérifie le fichier et réessaie.', 'error');
        } finally {
            fileInput.value = '';
        }
    })();
}

// Recalcule tout l'affichage - appelée au chargement ET quand une donnée arrive de l'autre téléphone
function refreshAllUI() {
    applyAppearancePreferences();
    buildChecklistSelector();
    updateChecklistAddFloat();
    updateCountdown();
    renderTodayCard();
    renderVols();
    renderTransports();
    renderProgramme();
    renderChecklist();
    updateBudgetUI();
    renderInfos();
    renderBillets();
    renderDashboardSummary();
}
window.refreshAllUI = refreshAllUI;

function renderDashboardSummary() {
    const destinationCount = appData.programme.length;
    const activityCount = appData.programme.reduce((sum, destination) => sum + (destination.activites || []).length, 0);
    const baseCurrency = appData.budgetCurrency || 'EUR';
    const plannedBudget = appData.budget.reduce((sum, expense) => {
        const converted = convertCurrency(Number(expense.amount ?? expense.eur) || 0, expense.currency || 'EUR', baseCurrency);
        return sum + (converted === null ? 0 : converted);
    }, 0);
    const remainingTasks = appData.checklist.filter(item => !item.checked).length;
    document.getElementById('dashboard-destinations').textContent = destinationCount;
    document.getElementById('dashboard-activities').textContent = activityCount;
    document.getElementById('dashboard-budget').textContent = formatCurrency(plannedBudget, baseCurrency);
    document.getElementById('dashboard-checklist').textContent = `${remainingTasks} à faire`;
}

function switchDashboardTab(tabId) {
    const navItem = document.querySelector(`.nav-item[data-tab="${tabId}"]`);
    if (navItem) switchTab(tabId, navItem);
    window.scrollTo({ top: 0, behavior: shouldReduceMotion() ? 'auto' : 'smooth' });
}

function switchTab(tabId, el) {
    document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
        item.removeAttribute('aria-current');
    });

    const nextPage = document.getElementById('page-' + tabId);
    if (!nextPage) return;
    nextPage.classList.add('active');
    if (el) { el.classList.add('active'); el.setAttribute('aria-current', 'page'); }
    document.body.dataset.page = tabId;

    if (tabId === 'programme') {
        requestAnimationFrame(() => {
            const behavior = shouldReduceMotion() ? 'auto' : 'smooth';
            document.querySelector('.itinerary-city-slide.is-active')?.scrollIntoView({ block: 'nearest', inline: 'center', behavior });
            document.querySelector('.itinerary-date-card.is-selected')?.scrollIntoView({ block: 'nearest', inline: 'center', behavior });
        });
    }

    if (tabId === 'budget') {
        updateBudgetUI();
    }
}

// --- GESTION DES DATES & COMPTE À REBOURS ---
function updateCountdown() {
    const dateDepart = appData.tripStart ? new Date(appData.tripStart + "T00:00:00") : null;
    const aujourdhui = new Date();
    const difference = dateDepart ? dateDepart - aujourdhui : 0;
    const joursRestants = dateDepart ? Math.ceil(difference / (1000 * 60 * 60 * 24)) : 0;
    document.getElementById('days-count').innerText = dateDepart ? (joursRestants > 0 ? joursRestants : 0) : '—';
    document.querySelector('.countdown-text').innerText = dateDepart ? 'jours avant le départ' : 'dates à planifier';
    document.querySelector('.hero-countdown-label').innerText = dateDepart ? 'ON Y EST DANS' : 'CHOISISSEZ LES DATES';

    // Formatage propre de l'affichage des dates du voyage
    const startOpt = { day: 'numeric', month: 'short' };
    const endOpt = { day: 'numeric', month: 'short', year: 'numeric' };
    const startDate = appData.tripStart ? new Date(appData.tripStart + 'T00:00:00').toLocaleDateString('fr-FR', startOpt) : '';
    const endDate = appData.tripEnd ? new Date(appData.tripEnd + 'T00:00:00').toLocaleDateString('fr-FR', endOpt) : '';

    document.getElementById('display-trip-title').innerHTML = `${esc(appData.tripTitle)} <i class="fa-solid fa-pen-to-square" style="font-size: 0.9rem; opacity: 0.5; margin-left: 5px;"></i>`;
    document.getElementById('display-trip-dates').innerText = startDate && endDate ? `${startDate} — ${endDate}` : 'Dates à définir';
    document.getElementById('trip-context-label').innerText = `${appData.tripType || 'Séjour'} · ${appData.tripGroup === 'Solo' ? 'En solo' : appData.tripGroup === 'Couple' ? 'En couple' : appData.tripGroup === 'Amis' ? 'Entre amis' : appData.tripGroup === 'Famille' ? 'En famille' : appData.tripGroup === 'Équipe' ? 'En équipe' : 'En groupe'}`;

    const groupLabels = {
        Solo: 'VOTRE CARNET DE VOYAGE', Couple: 'VOTRE CARNET À DEUX', Amis: 'VOTRE CARNET ENTRE AMIS',
        Famille: 'VOTRE CARNET DE FAMILLE', Équipe: 'VOTRE CARNET D’ÉQUIPE', Autre: 'VOTRE CARNET DE SÉJOUR'
    };
    const tripHeadlines = {
        Vacances: 'Vos vacances, au même endroit.',
        'Week-end': 'Votre week-end, bien organisé.',
        'Voyage professionnel': 'Votre déplacement, en un coup d’œil.',
        Événement: 'Le programme de votre événement.',
        'Road trip': 'Votre itinéraire, étape par étape.',
        Autre: 'Tout votre séjour, au même endroit.'
    };
    document.getElementById('dashboard-overline').textContent = groupLabels[appData.tripGroup] || groupLabels.Autre;
    document.getElementById('dashboard-intro-title').textContent = tripHeadlines[appData.tripType] || tripHeadlines.Autre;
}

function openEditTripModal() {
    document.getElementById('edit-trip-title').value = appData.tripTitle;
    document.getElementById('edit-trip-type').value = appData.tripType || 'Vacances';
    document.getElementById('edit-trip-group').value = appData.tripGroup || 'Amis';
    document.getElementById('edit-trip-start').value = appData.tripStart;
    document.getElementById('edit-trip-end').value = appData.tripEnd;
    openModal('modal-edit-trip');
}

function saveTripDates() {
    if (!requireEditor()) return;
    const title = document.getElementById('edit-trip-title').value;
    const start = document.getElementById('edit-trip-start').value;
    const end = document.getElementById('edit-trip-end').value;
    const tripType = document.getElementById('edit-trip-type').value;
    const tripGroup = document.getElementById('edit-trip-group').value;

    if (title && ((!start && !end) || (start && end && start <= end))) {
        appData.tripTitle = title;
        appData.tripStart = start;
        appData.tripEnd = end;
        appData.tripType = tripType;
        appData.tripGroup = tripGroup;
        saveToLocalStorage();
        updateCountdown();
        closeModal('modal-edit-trip');
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.classList.remove('active');
    modal.returnFocusElement?.focus?.();
}

function populateChecklistScopeSelector() {
    const scopeSelect = document.getElementById('check-scope');
    const catGroup = document.getElementById('check-cat-group');
    if (!scopeSelect) return;
    let html = `<option value="voyage">🧳 Checklist du voyage</option>`;
    appData.programme.forEach(prog => {
        html += `<option value="${prog.id}">📅 ${esc(prog.ville)}</option>`;
    });
    scopeSelect.innerHTML = html;
    const categorySelect = document.getElementById('check-cat');
    if (categorySelect) {
        const defaults = ['PAPIERS & RÉSERVATIONS', 'BAGAGES & VÊTEMENTS', 'SANTÉ & BIEN-ÊTRE', 'TRANSPORTS', 'ÉLECTRONIQUE', 'PETITS PLAISIRS', 'AUTRE'];
        const categories = [...new Set([...defaults, ...appData.checklist.map(item => item.categorie).filter(Boolean)])];
        categorySelect.innerHTML = categories.map(category => `<option value="${esc(category)}">${esc(category)}</option>`).join('');
    }
    updateChecklistScopeVisibility();
}

function updateChecklistScopeVisibility() {
    const scopeSelect = document.getElementById('check-scope');
    const catGroup = document.getElementById('check-cat-group');
    if (scopeSelect && catGroup) catGroup.style.display = scopeSelect.value === 'voyage' ? '' : 'none';
}

function saveChecklist() {
    if (!requireEditor()) return;
    const scope = document.getElementById('check-scope').value;
    const texte = document.getElementById('check-text').value.trim();
    if (!texte) return;
    if (scope === 'voyage') {
        const cat = document.getElementById('check-cat').value;
        appData.checklist.push({ id: Date.now(), categorie: cat, texte: texte, checked: false });
        saveToLocalStorage();
        renderChecklist();
        updateChecklistAddFloat();
    } else {
        const progId = parseInt(scope);
        if (!appData.checklistsJour) appData.checklistsJour = {};
        if (!appData.checklistsJour[progId]) appData.checklistsJour[progId] = [];
        appData.checklistsJour[progId].push({ id: Date.now(), texte: texte, checked: false });
        saveToLocalStorage();
        if (currentChecklistScope === progId) renderChecklist();
        else updateChecklistSelectorState();
        updateChecklistAddFloat();
    }
    document.getElementById('check-text').value = '';
    closeModal('modal-checklist');
}

function openModal(modalId) {
    if (modalId === 'modal-checklist') {
        populateChecklistScopeSelector();
    }
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.returnFocusElement = document.activeElement;
    modal.classList.add('active');
    requestAnimationFrame(() => {
        syncPickerControls(modal);
        modal.querySelector('input:not([type="hidden"]), select, textarea, button')?.focus();
    });
}

// --- APERÇU ET EDITION DES VOLS ---
let expandedVols = {};
const FLIGHT_STATUS_LABELS = { Expected: 'Programmé', EnRoute: 'En vol', CheckIn: 'Enregistrement ouvert', Boarding: 'Embarquement', GateClosed: 'Porte fermée', Departed: 'Parti', Delayed: 'Retardé', Approaching: 'En approche', Arrived: 'Arrivé', Canceled: 'Annulé', Diverted: 'Dérouté', Unknown: 'État inconnu' };

function toggleVolExpand(index) {
    expandedVols[index] = !expandedVols[index];
    renderVols();
}

function buildVolDetailHtml(vol, index) {
    const pnrHtml = vol.pnr ? `<div class="flight-meta-pill"><span>Réservation (PNR)</span><span>${esc(vol.pnr)}</span></div>` : '';
    const seatsHtml = vol.seats ? `<div class="flight-meta-pill"><span>Siège(s)</span><span>${esc(vol.seats)}</span></div>` : '';
    const ticketUrl = safeUrl(vol.ticketLink);
    const ticketHtml = ticketUrl ? `<div class="flight-meta-pill"><span>Billet Électronique</span><span><a href="${ticketUrl}" target="_blank" rel="noopener" style="color: var(--accent-primary); text-decoration: underline;">Ouvrir</a></span></div>` : '';

    const flightStatusHtml = vol.flightStatus
        ? `<div class="flight-meta-pill"><span>État du vol</span><span>${esc(FLIGHT_STATUS_LABELS[vol.flightStatus] || vol.flightStatus)}${vol.flightLastUpdated ? ` · actualisé ${esc(vol.flightLastUpdated)}` : ''}</span></div>`
        : '';
    const flightQualityHtml = vol.flightQuality ? `<div class="flight-meta-pill"><span>Source des horaires</span><span>${esc(vol.flightQuality)}</span></div>` : '';
    const departureInfo = [
        vol.depAirportName,
        vol.depTerminal && `Terminal ${vol.depTerminal}`,
        vol.depGate && `Porte ${vol.depGate}`,
        vol.depCheckInDesk && `Enregistrement ${vol.depCheckInDesk}`
    ].filter(Boolean).join(' · ');
    const arrivalInfo = [
        vol.arrAirportName,
        vol.arrTerminal && `Terminal ${vol.arrTerminal}`,
        vol.arrGate && `Porte ${vol.arrGate}`,
        vol.arrBaggageBelt && `Bagages ${vol.arrBaggageBelt}`
    ].filter(Boolean).join(' · ');

    let html = `
        <div class="flight-detail-segment">
            <div class="segment-dot"></div>
            <div style="font-weight: 800; font-size: 1rem; display: flex; justify-content: space-between;">
                <span>${esc(vol.depCity)} (${esc(vol.dep)})</span>
                <span style="color: var(--accent-primary);">${esc(vol.depTime || '')}</span>
            </div>
            <div style="font-size: 0.82rem; color: var(--text-muted); font-weight: 600; margin-top: 2px;">
                ${esc(departureInfo || vol.depTerminal || '')} • Vol ${esc(vol.num1 || '')}
            </div>
        </div>
    `;

    if (vol.layoverCode) {
        const layoverTimesHtml = (vol.layoverArrTime || vol.layoverDepTime)
            ? `<div style="font-weight: 600; font-size: 0.78rem; opacity: 0.85; margin-top: 2px;">Arrivée ${esc(vol.layoverArrTime || '—')} · Départ ${esc(vol.layoverDepTime || '—')}</div>`
            : '';
        html += `
            <div class="layover-card">
                <i class="fa-solid fa-clock"></i>
                <div>
                    <span>Escale à ${esc(vol.layoverCode)} (${esc(vol.layoverDuration || '')})</span>
                    ${layoverTimesHtml}
                </div>
            </div>
        `;
    }

    html += `
        <div class="flight-detail-segment">
            <div class="segment-dot"></div>
            <div style="font-weight: 800; font-size: 1rem; display: flex; justify-content: space-between;">
                <span>${esc(vol.arrCity)} (${esc(vol.arr)})</span>
                <span style="color: var(--accent-primary);">${esc(vol.arrTime || '')}</span>
            </div>
            <div style="font-size: 0.82rem; color: var(--text-muted); font-weight: 600; margin-top: 2px;">
                ${esc(arrivalInfo || vol.arrTerminal || '')} • Vol ${esc(vol.num2 || '')}
            </div>
        </div>
    `;

    const aircraftHtml = vol.aircraft
        ? `<div class="section-title" style="margin: 15px 0 8px 5px;">Appareils</div>
           <div class="aircraft-chips">
               ${vol.aircraft.split('&').map(a => a.trim()).filter(Boolean).map(a => `<span class="aircraft-chip"><i class="fa-solid fa-plane"></i> ${esc(a)}</span>`).join('')}
           </div>`
        : `<div class="flight-meta-pill"><span>Appareils</span><span>Non renseigné</span></div>`;

    html += `
        ${aircraftHtml}
        ${vol.aircraftRegistration ? `<div class="flight-meta-pill"><span>Immatriculation</span><span>${esc(vol.aircraftRegistration)}</span></div>` : ''}
        ${flightStatusHtml}
        ${flightQualityHtml}
        ${pnrHtml}
        ${seatsHtml}
        ${ticketHtml}
        <div style="text-align:right; margin-top: 10px;">
            <button ${actionAttrs('openEditVolModal', [index])} class="details-link" style="border: 1.5px solid var(--accent-primary); border-radius: 20px; padding: 6px 16px;">
                <i class="fa-solid fa-pen-to-square"></i> Modifier
            </button>
        </div>
    `;
    return html;
}

function openAddVolModal() {
    document.getElementById('vol-modal-title').innerText = "Ajouter un vol";
    document.getElementById('vol-edit-index').value = "";
    ['vol-type', 'vol-compagnie', 'vol-date', 'vol-dep', 'vol-dep-city', 'vol-dep-airport', 'vol-dep-terminal', 'vol-dep-gate', 'vol-dep-checkin', 'vol-dep-time',
     'vol-num-1', 'vol-layover-code', 'vol-layover-duration', 'vol-layover-arr-time', 'vol-layover-dep-time',
     'vol-arr', 'vol-arr-city', 'vol-arr-airport', 'vol-arr-terminal', 'vol-arr-gate', 'vol-arr-baggage',
     'vol-arr-time', 'vol-num-2', 'vol-aircraft', 'vol-aircraft-registration', 'vol-status', 'vol-status-updated', 'vol-data-quality', 'vol-seats', 'vol-pnr', 'vol-ticket-link', 'vol-paste-text'
    ].forEach(id => { document.getElementById(id).value = ''; });
    document.getElementById('vol-paste-feedback').textContent = '';
    document.getElementById('vol-lookup-number').value = '';
    flightLookupResults = [];
    renderFlightLookupResults();
    setFlightLookupFeedback('');
    syncPickerControls(document.getElementById('modal-vol'));
    openModal('modal-vol');
}

function openEditVolModal(index) {
    const vol = appData.vols[index];
    if (vol) {
        document.getElementById('vol-paste-text').value = '';
        document.getElementById('vol-paste-feedback').textContent = '';
        document.getElementById('vol-modal-title').innerText = "Modifier le vol";
        document.getElementById('vol-edit-index').value = index;
        document.getElementById('vol-type').value = vol.type || '';
        document.getElementById('vol-compagnie').value = vol.compagnie || '';
        document.getElementById('vol-date').value = vol.date || '';

        document.getElementById('vol-dep').value = vol.dep || '';
        document.getElementById('vol-dep-city').value = vol.depCity || '';
        document.getElementById('vol-dep-airport').value = vol.depAirportName || '';
        document.getElementById('vol-dep-terminal').value = vol.depTerminal || '';
        document.getElementById('vol-dep-gate').value = vol.depGate || '';
        document.getElementById('vol-dep-checkin').value = vol.depCheckInDesk || '';
        document.getElementById('vol-dep-time').value = vol.depTime || '';
        document.getElementById('vol-num-1').value = vol.num1 || '';

        document.getElementById('vol-layover-code').value = vol.layoverCode || '';
        document.getElementById('vol-layover-duration').value = vol.layoverDuration || '';
        document.getElementById('vol-layover-arr-time').value = vol.layoverArrTime || '';
        document.getElementById('vol-layover-dep-time').value = vol.layoverDepTime || '';

        document.getElementById('vol-arr').value = vol.arr || '';
        document.getElementById('vol-arr-city').value = vol.arrCity || '';
        document.getElementById('vol-arr-airport').value = vol.arrAirportName || '';
        document.getElementById('vol-arr-terminal').value = vol.arrTerminal || '';
        document.getElementById('vol-arr-gate').value = vol.arrGate || '';
        document.getElementById('vol-arr-baggage').value = vol.arrBaggageBelt || '';
        document.getElementById('vol-arr-time').value = vol.arrTime || '';
        document.getElementById('vol-num-2').value = vol.num2 || '';

        document.getElementById('vol-aircraft').value = vol.aircraft || '';
        document.getElementById('vol-aircraft-registration').value = vol.aircraftRegistration || '';
        document.getElementById('vol-status').value = vol.flightStatus || '';
        document.getElementById('vol-status-updated').value = vol.flightLastUpdated || '';
        document.getElementById('vol-data-quality').value = vol.flightQuality || '';
        document.getElementById('vol-seats').value = vol.seats || '';
        document.getElementById('vol-pnr').value = vol.pnr || '';
        document.getElementById('vol-ticket-link').value = vol.ticketLink || '';
        document.getElementById('vol-lookup-number').value = vol.num1 || '';
        flightLookupResults = [];
        document.getElementById('vol-lookup-results').innerHTML = '';
        setFlightLookupFeedback('');
        syncPickerControls(document.getElementById('modal-vol'));

        openModal('modal-vol');
    }
}

let flightLookupResults = [];

function setFlightLookupFeedback(message, state = '') {
    const feedback = document.getElementById('vol-lookup-feedback');
    if (!feedback) return;
    feedback.textContent = message;
    feedback.dataset.state = state;
}

function renderFlightLookupResults() {
    const container = document.getElementById('vol-lookup-results');
    if (!container) return;
    container.innerHTML = flightLookupResults.map((flight, index) => {
        const departure = flight.departure || {};
        const arrival = flight.arrival || {};
        const route = `${departure.code || 'Départ ?'} → ${arrival.code || 'Arrivée ?'}`;
        const times = [departure.time, arrival.time].filter(Boolean).join(' → ');
        const status = FLIGHT_STATUS_LABELS[flight.status] || flight.status;
        const airline = [flight.airline, flight.airlineCode && `(${flight.airlineCode})`].filter(Boolean).join(' ');
        const details = [airline, times, status].filter(Boolean).join(' · ');
        const timeDetails = [
            departure.scheduledTime && `Départ prévu ${departure.scheduledTime}`,
            departure.revisedTime && departure.revisedTime !== departure.scheduledTime && `estimé ${departure.revisedTime}`,
            arrival.scheduledTime && `Arrivée prévue ${arrival.scheduledTime}`,
            arrival.revisedTime && arrival.revisedTime !== arrival.scheduledTime && `estimée ${arrival.revisedTime}`
        ].filter(Boolean).join(' · ');
        const airportNames = [departure.name, arrival.name].filter(Boolean).join(' → ');
        const operational = [
            departure.terminal && `Départ · terminal ${departure.terminal}`,
            departure.gate && `porte ${departure.gate}`,
            departure.checkInDesk && `comptoir ${departure.checkInDesk}`,
            arrival.terminal && `Arrivée · terminal ${arrival.terminal}`,
            arrival.gate && `porte ${arrival.gate}`,
            arrival.baggageBelt && `bagages ${arrival.baggageBelt}`
        ].filter(Boolean).join(' · ');
        const aircraft = [flight.aircraft, flight.aircraftRegistration].filter(Boolean).join(' · ');
        const qualityLabels = { Basic: 'Horaires programmés', Live: 'Informations en direct', Approximate: 'Estimation' };
        const quality = (flight.quality || []).map(value => qualityLabels[value] || value).join(' · ');
        return `<button type="button" class="flight-lookup-result" ${actionAttrs('selectFlightLookupResult', [index])}>
            <span class="flight-lookup-result-plane"><i class="fa-solid fa-plane" aria-hidden="true"></i></span>
            <span class="flight-lookup-result-copy"><strong>${esc(flight.number || '')} · ${esc(route)}</strong><small>${esc(details || 'Détails à vérifier')}</small>
                ${airportNames ? `<small>${esc(airportNames)}</small>` : ''}
                ${timeDetails ? `<small>${esc(timeDetails)}</small>` : ''}
                ${operational ? `<small>${esc(operational)}</small>` : ''}
                ${aircraft ? `<small>Appareil : ${esc(aircraft)}</small>` : ''}
                ${quality ? `<small>${esc(quality)}</small>` : ''}
            </span>
            <i class="fa-solid fa-arrow-right flight-lookup-result-arrow" aria-hidden="true"></i>
        </button>`;
    }).join('');
}

async function searchFlightByNumber() {
    const rawNumber = document.getElementById('vol-lookup-number')?.value || '';
    const flightNumber = rawNumber.toUpperCase().replace(/[\s-]+/g, '');
    const date = parsePickerDate(document.getElementById('vol-date')?.value);
    const endpoint = String(window.CAP_COMMUN_FLIGHT_API_URL || '').trim().replace(/\/$/, '');
    const button = document.getElementById('vol-flight-search');

    flightLookupResults = [];
    renderFlightLookupResults();
    if (!/^[A-Z0-9]{3,10}$/.test(flightNumber)) {
        setFlightLookupFeedback('Saisis un numéro de vol valide, par exemple AF1234.', 'error');
        return;
    }
    if (!date) {
        setFlightLookupFeedback('Choisis d’abord la date de départ du vol.', 'error');
        return;
    }
    if (!endpoint) {
        setFlightLookupFeedback('Le formulaire est prêt. Il reste à connecter le service sécurisé de recherche (clé API et URL du Worker).', 'setup');
        return;
    }

    if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true'); }
    setFlightLookupFeedback('Recherche du vol en cours…', 'loading');
    try {
        const response = await fetch(`${endpoint}/api/flight-search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ flightNumber, date: dateToPickerValue(date) })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error([payload.error, payload.detail].filter(Boolean).join(' — ') || 'La recherche du vol a échoué. Réessaie dans un instant.');
        flightLookupResults = Array.isArray(payload.results) ? payload.results : [];
        if (!flightLookupResults.length) {
            setFlightLookupFeedback(payload.message || 'Aucun vol trouvé pour ce numéro et cette date. Vérifie les informations ou essaie avec le numéro de la compagnie opératrice.', 'empty');
            return;
        }
        renderFlightLookupResults();
        setFlightLookupFeedback(`${flightLookupResults.length} résultat${flightLookupResults.length > 1 ? 's' : ''}. Sélectionne le bon trajet pour préremplir le formulaire.`, 'success');
    } catch (error) {
        setFlightLookupFeedback(error.message || 'Connexion au service impossible. Tu peux toujours remplir les champs manuellement.', 'error');
    } finally {
        if (button) { button.disabled = false; button.removeAttribute('aria-busy'); }
    }
}

function selectFlightLookupResult(index) {
    const flight = flightLookupResults[index];
    if (!flight) return;
    const put = (id, value) => { if (value) document.getElementById(id).value = value; };
    const departure = flight.departure || {};
    const arrival = flight.arrival || {};

    put('vol-num-1', flight.number || document.getElementById('vol-lookup-number').value.toUpperCase().replace(/[\s-]+/g, ''));
    put('vol-compagnie', [flight.airline, flight.airlineCode && `(${flight.airlineCode})`].filter(Boolean).join(' '));
    put('vol-type', document.getElementById('vol-type').value || 'Aller');
    put('vol-dep', departure.code);
    put('vol-dep-city', departure.city);
    put('vol-dep-airport', departure.name);
    put('vol-dep-terminal', departure.terminal);
    put('vol-dep-gate', departure.gate);
    put('vol-dep-checkin', departure.checkInDesk);
    put('vol-dep-time', departure.time);
    put('vol-arr', arrival.code);
    put('vol-arr-city', arrival.city);
    put('vol-arr-airport', arrival.name);
    put('vol-arr-terminal', arrival.terminal);
    put('vol-arr-gate', arrival.gate);
    put('vol-arr-baggage', arrival.baggageBelt);
    put('vol-arr-time', arrival.time);
    put('vol-aircraft', flight.aircraft);
    put('vol-aircraft-registration', flight.aircraftRegistration);
    put('vol-status', flight.status);
    put('vol-status-updated', flight.lastUpdatedUtc ? new Date(flight.lastUpdatedUtc).toLocaleString('fr-FR') : '');
    put('vol-data-quality', (flight.quality || []).map(value => ({ Basic: 'Horaires programmés', Live: 'Informations en direct', Approximate: 'Estimations' }[value] || value)).join(' · '));
    syncPickerControls(document.getElementById('modal-vol'));
    setFlightLookupFeedback('Vol ajouté au formulaire. Vérifie les horaires et les aéroports avant de l’enregistrer.', 'success');
}

function saveVol() {
    if (!requireEditor()) return;
    const index = document.getElementById('vol-edit-index').value;
    const volData = {
        type: document.getElementById('vol-type').value,
        compagnie: document.getElementById('vol-compagnie').value,
        date: dateToStoredValue(document.getElementById('vol-date').value),

        dep: document.getElementById('vol-dep').value,
        depCity: document.getElementById('vol-dep-city').value,
        depAirportName: document.getElementById('vol-dep-airport').value,
        depTerminal: document.getElementById('vol-dep-terminal').value,
        depGate: document.getElementById('vol-dep-gate').value,
        depCheckInDesk: document.getElementById('vol-dep-checkin').value,
        depTime: document.getElementById('vol-dep-time').value,
        num1: document.getElementById('vol-num-1').value,

        layoverCode: document.getElementById('vol-layover-code').value,
        layoverDuration: document.getElementById('vol-layover-duration').value,
        layoverArrTime: document.getElementById('vol-layover-arr-time').value,
        layoverDepTime: document.getElementById('vol-layover-dep-time').value,

        arr: document.getElementById('vol-arr').value,
        arrCity: document.getElementById('vol-arr-city').value,
        arrAirportName: document.getElementById('vol-arr-airport').value,
        arrTerminal: document.getElementById('vol-arr-terminal').value,
        arrGate: document.getElementById('vol-arr-gate').value,
        arrBaggageBelt: document.getElementById('vol-arr-baggage').value,
        arrTime: document.getElementById('vol-arr-time').value,
        num2: document.getElementById('vol-num-2').value,

        aircraft: document.getElementById('vol-aircraft').value,
        aircraftRegistration: document.getElementById('vol-aircraft-registration').value,
        flightStatus: document.getElementById('vol-status').value,
        flightLastUpdated: document.getElementById('vol-status-updated').value,
        flightQuality: document.getElementById('vol-data-quality').value,
        seats: document.getElementById('vol-seats').value,
        pnr: document.getElementById('vol-pnr').value,
        ticketLink: document.getElementById('vol-ticket-link').value
    };

    if (!volData.date || !volData.dep || !volData.arr) return;

    if (index !== "") {
        appData.vols[parseInt(index)] = volData;
    } else {
        appData.vols.push(volData);
    }

    saveToLocalStorage();
    renderVols();
    applyAppearancePreferences();
    closeModal('modal-vol');
}

// --- ANALYSE AUTOMATIQUE D'UN EMAIL DE CONFIRMATION DE VOL ---
// Best-effort : extrait ce qu'elle reconnaît (aéroports, horaires,
// numéros de vol, terminaux, avion, escale, PNR, sièges) à partir du
// texte collé, et pré-remplit le formulaire. Ne devine jamais un champ
// qu'elle ne trouve pas — l'utilisateur reste maître de la relecture.
const FLIGHT_PASTE_MONTHS = {
    jan: 0, janv: 0, january: 0, janvier: 0,
    feb: 1, fev: 1, fevr: 1, february: 1, fevrier: 1,
    mar: 2, mars: 2, march: 2,
    apr: 3, avr: 3, april: 3, avril: 3,
    may: 4, mai: 4,
    jun: 5, juin: 5, june: 5,
    jul: 6, juil: 6, july: 6, juillet: 6,
    aug: 7, aout: 7, august: 7,
    sep: 8, sept: 8, september: 8, septembre: 8,
    oct: 9, october: 9, octobre: 9,
    nov: 10, november: 10, novembre: 10,
    dec: 11, dece: 11, december: 11, decembre: 11
};
const FLIGHT_PASTE_MONTH_DISPLAY = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const FLIGHT_PASTE_AIRLINES = ['TAP Air Portugal', 'easyJet', 'Transavia', 'Vueling', 'Qatar Airways', 'Air France', 'ANA', 'JAL', 'Japan Airlines', 'Emirates', 'Turkish Airlines', 'Lufthansa', 'KLM', 'Singapore Airlines', 'Cathay Pacific', 'British Airways'];

function dedupeKeepOrder(arr) {
    return arr.filter((v, i) => arr.indexOf(v) === i);
}

function parseFlightPasteDates(text) {
    const found = [];
    const patterns = [
        /\b(\d{1,2})\s+([A-Za-zÀ-ÿ]{3,12})\.?\s+(\d{4})\b/g,
        /\b(\d{4})-(\d{2})-(\d{2})\b/g,
        /\b(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4})\b/g
    ];
    let m;
    while ((m = patterns[0].exec(text))) {
        const monthKey = stripAccents(m[2].toLowerCase());
        const monthIdx = FLIGHT_PASTE_MONTHS[monthKey];
        if (monthIdx !== undefined) found.push({ day: parseInt(m[1], 10), month: monthIdx });
    }
    while ((m = patterns[1].exec(text))) {
        found.push({ day: parseInt(m[3], 10), month: parseInt(m[2], 10) - 1 });
    }
    while ((m = patterns[2].exec(text))) {
        const month = parseInt(m[2], 10) - 1;
        if (month >= 0 && month <= 11) found.push({ day: parseInt(m[1], 10), month });
    }
    return found;
}

function parseVolPasteText() {
    const text = document.getElementById('vol-paste-text').value;
    const feedback = document.getElementById('vol-paste-feedback');
    if (!text.trim()) {
        feedback.textContent = "Colle d'abord le texte de ta confirmation de vol ci-dessus.";
        return;
    }

    const setIfFound = (id, value) => {
        if (value) document.getElementById(id).value = value;
    };
    const found = [];
    const missing = [];

    // Compagnie
    const airline = FLIGHT_PASTE_AIRLINES.find(a => text.toLowerCase().includes(a.toLowerCase()));
    if (airline) { setIfFound('vol-compagnie', airline); found.push('compagnie'); }

    // Numéros de vol (ex: QR040, QR 813)
    const flightNumbers = dedupeKeepOrder(
        [...text.matchAll(/\b([A-Z]{2})\s?(\d{2,4})\b/g)].map(m => m[1] + m[2])
    );
    if (flightNumbers[0]) { setIfFound('vol-num-1', flightNumbers[0]); found.push('n° de vol 1'); } else { missing.push('numéros de vol'); }

    // Aéroports : "Ville (XXX)" — l'ordre d'apparition donne dép → escale → arrivée
    const airportMatches = [...text.matchAll(/([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ.\-'\s]{1,35}?)\s*\(([A-Z]{3})\)/g)];
    const seenCodes = [];
    const cityByCode = {};
    airportMatches.forEach(m => {
        const city = m[1].trim().replace(/\s{2,}/g, ' ');
        const code = m[2];
        if (!seenCodes.includes(code)) { seenCodes.push(code); cityByCode[code] = city; }
    });
    const hasLayover = seenCodes.length >= 3;
    if (seenCodes.length >= 2) {
        setIfFound('vol-dep', seenCodes[0]);
        setIfFound('vol-dep-city', cityByCode[seenCodes[0]]);
        const arrCode = seenCodes[seenCodes.length - 1];
        setIfFound('vol-arr', arrCode);
        setIfFound('vol-arr-city', cityByCode[arrCode]);
        found.push('aéroports');
        if (hasLayover) {
            setIfFound('vol-layover-code', seenCodes[1]);
            if (flightNumbers[1]) setIfFound('vol-num-2', flightNumbers[1]);
        }
    } else {
        missing.push('aéroports (codes à 3 lettres)');
    }

    // Horaires (HH:MM), dans l'ordre d'apparition dans le texte
    const times = [...text.matchAll(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g)].map(m => `${m[1].padStart(2, '0')}:${m[2]}`);
    if (times.length) {
        setIfFound('vol-dep-time', times[0]);
        if (hasLayover && times.length >= 4) {
            setIfFound('vol-layover-arr-time', times[1]);
            setIfFound('vol-layover-dep-time', times[2]);
            setIfFound('vol-arr-time', times[3]);
        } else if (hasLayover && times.length === 3) {
            setIfFound('vol-layover-arr-time', times[1]);
            setIfFound('vol-arr-time', times[2]);
        } else if (times.length >= 2) {
            setIfFound('vol-arr-time', times[times.length - 1]);
        }
        found.push('horaires');
    } else {
        missing.push('horaires');
    }

    // Terminaux (pas de dédoublonnage : "Terminal 1" peut désigner deux
    // terminaux différents selon l'aéroport, dédoublonner fausserait l'ordre)
    const terminals = [...text.matchAll(/Terminal\s*([A-Za-z0-9]{1,3})/gi)].map(m => `Terminal ${m[1]}`);
    if (terminals.length) {
        setIfFound('vol-dep-terminal', terminals[0]);
        if (terminals.length >= 2) setIfFound('vol-arr-terminal', terminals[terminals.length - 1]);
        found.push('terminaux');
    } else {
        missing.push('terminaux');
    }

    // Avion
    const aircraftMatches = dedupeKeepOrder(
        [...text.matchAll(/(Airbus\s*A\d{3}(?:-\d{2,3}[A-Z]{0,3})?|Boeing\s*7\d{2}(?:-\d{2,3}[A-Z]{0,3})?|Embraer\s*E?\d{3}|ATR\s*\d{2,3})/gi)].map(m => m[0].trim())
    );
    if (aircraftMatches.length) { setIfFound('vol-aircraft', aircraftMatches.join(' & ')); found.push('avion'); } else { missing.push('type d\'avion'); }

    // Durée d'escale (proche du mot "escale"/"layover"/"connection")
    const layoverDurationMatch = text.match(/(?:escale|layover|connect(?:ing|ion))[^\d]{0,20}(\d{1,2}\s?h(?:\s?\d{1,2}\s?m?)?)/i);
    if (hasLayover && layoverDurationMatch) { setIfFound('vol-layover-duration', layoverDurationMatch[1].replace(/\s+/g, ' ')); found.push('durée escale'); } else if (hasLayover) { missing.push('durée escale'); }

    // PNR / référence de réservation
    const pnrMatch = text.match(/(?:PNR|Booking reference|R[ée]f[ée]rence(?:\s+de\s+r[ée]servation)?|Confirmation number|Record locator)[^A-Za-z0-9]{0,5}([A-Z0-9]{5,8})\b/i);
    if (pnrMatch) { setIfFound('vol-pnr', pnrMatch[1]); found.push('PNR'); } else { missing.push('PNR'); }

    // Sièges
    const seatsMatch = text.match(/(?:Si[eè]ges?|Seats?)\s*[:\-]?\s*([0-9]{1,3}[A-Za-z](?:\s*,\s*[0-9]{1,3}[A-Za-z])*)/i);
    if (seatsMatch) { setIfFound('vol-seats', seatsMatch[1]); found.push('sièges'); } else { missing.push('sièges'); }

    // Date générale + suffixe (+1j) si l'arrivée est un autre jour que le départ
    const dates = parseFlightPasteDates(text);
    if (dates.length) {
        const d0 = dates[0];
        document.getElementById('vol-date').value = `${d0.day} ${FLIGHT_PASTE_MONTH_DISPLAY[d0.month]}`;
        syncDateText(document.getElementById('vol-date'));
        found.push('date');
        const dLast = dates[dates.length - 1];
        if (dLast && (dLast.day !== d0.day || dLast.month !== d0.month)) {
            const arrTimeInput = document.getElementById('vol-arr-time');
            if (arrTimeInput.value && !arrTimeInput.value.includes('+1j')) {
                arrTimeInput.value += ' (+1j)';
            }
        }
    } else {
        missing.push('date');
    }

    feedback.innerHTML = `✅ Trouvé automatiquement : ${found.length ? esc(found.join(', ')) : 'rien'}.` +
        (missing.length ? `<br>⚠️ À vérifier/compléter à la main : ${esc(missing.join(', '))}.` : '<br>Relis quand même les champs avant d\'enregistrer.');
}

function deleteVol(index) {
    if (!requireEditor()) return;
    if (confirm("Voulez-vous vraiment supprimer ce vol ?")) {
        appData.vols.splice(index, 1);
        saveToLocalStorage();
        renderVols();
        applyAppearancePreferences();
    }
}

function renderVols() {
    const list = document.getElementById('vols-list');
    list.innerHTML = '';
    if (!appData.vols.length) {
        list.innerHTML = `<p>Aucun vol enregistré. Ajoutez les trajets réservés pour les retrouver facilement.</p>`;
        return;
    }
    appData.vols.forEach((vol, index) => {
        const isExpanded = !!expandedVols[index];
        list.innerHTML += `
                <div class="card clickable" ${actionAttrs('toggleVolExpand', [index])}>
                    <button class="delete-btn-round" ${actionAttrs('deleteVol', [index])} aria-label="Supprimer ce vol"><i class="fa-solid fa-trash-can"></i></button>
                <div class="card-header-row">
                    <div class="card-title-group">
                        <div class="card-icon"><i class="fa-solid fa-plane"></i></div>
                        <div>
                            <div class="card-title">${esc(vol.type)} — ${esc(vol.compagnie)}</div>
                            <div class="card-subtitle" style="font-weight: 700; color: var(--accent-primary);">${esc(vol.num1)} ${vol.num2 ? ' & ' + esc(vol.num2) : ''}</div>
                        </div>
                    </div>
                    ${dateBadgeHtml(vol.date)}
                </div>
                <div class="flight-route">
                    <div class="flight-airport">
                        <div class="airport-code">${esc(vol.dep)}</div>
                        <div class="airport-city">${esc(vol.depCity)}</div>
                    </div>
                    <div class="flight-line-container">
                        <div class="flight-line"></div>
                        <i class="fa-solid fa-plane flight-icon-center"></i>
                    </div>
                    <div class="flight-airport right">
                        <div class="airport-code">${esc(vol.arr)}</div>
                        <div class="airport-city">${esc(vol.arrCity)}</div>
                    </div>
                </div>
                <div style="display: ${isExpanded ? 'block' : 'none'}; margin-top: 16px; padding-top: 14px; border-top: 1.5px dashed #ddd;">
                    ${isExpanded ? buildVolDetailHtml(vol, index) : ''}
                </div>
                <div style="text-align: center; margin-top: 8px; color: #ccc;">
                    <i class="fa-solid fa-chevron-${isExpanded ? 'up' : 'down'}"></i>
                </div>
            </div>
        `;
    });
}

// --- TRANSPORTS ---
const transportIcons = {
    "Train": "fa-train",
    "Shinkansen": "fa-train",
    "Limited Express": "fa-train-subway",
    "Train Local": "fa-train-subway",
    "Métro": "fa-train-subway",
    "Bus": "fa-bus",
    "Voiture": "fa-car",
    "Bateau": "fa-ship",
    "Autre": "fa-route"
};

let expandedTransports = {};

function toggleTransportExpand(index) {
    expandedTransports[index] = !expandedTransports[index];
    renderTransports();
}

function buildTransportDetailHtml(t, index) {
    const depVoieHtml = t.depPlatform ? `<div class="flight-meta-pill"><span>Voie de départ</span><span>${esc(t.depPlatform)}</span></div>` : '';
    const arrVoieHtml = t.arrPlatform ? `<div class="flight-meta-pill"><span>Voie d'arrivée</span><span>${esc(t.arrPlatform)}</span></div>` : '';
    const seatHtml = t.seat ? `<div class="flight-meta-pill"><span>Siège / Voiture</span><span>${esc(t.seat)}</span></div>` : '';
    const notesHtml = t.notes ? `<div class="flight-meta-pill"><span>Notes</span><span>${esc(t.notes)}</span></div>` : '';

    return `
        <div class="flight-detail-segment">
            <div class="segment-dot"></div>
            <div style="font-weight: 800; font-size: 1rem; display: flex; justify-content: space-between;">
                <span>${esc(t.depStation)}</span>
                <span style="color: var(--accent-primary);">${esc(t.depTime || '')}</span>
            </div>
        </div>
        <div class="flight-detail-segment">
            <div class="segment-dot"></div>
            <div style="font-weight: 800; font-size: 1rem; display: flex; justify-content: space-between;">
                <span>${esc(t.arrStation)}</span>
                <span style="color: var(--accent-primary);">${esc(t.arrTime || '')}</span>
            </div>
        </div>
        ${depVoieHtml}
        ${arrVoieHtml}
        ${seatHtml}
        ${notesHtml}
        <div style="text-align:right; margin-top: 10px;">
            <button ${actionAttrs('openEditTransportModal', [index])} class="details-link" style="border: 1.5px solid var(--accent-primary); border-radius: 20px; padding: 6px 16px;">
                <i class="fa-solid fa-pen-to-square"></i> Modifier
            </button>
        </div>
    `;
}

function renderTransports() {
    const list = document.getElementById('transports-list');
    if (!list) return;
    list.innerHTML = '';

    if (!appData.transports || appData.transports.length === 0) {
        list.innerHTML = `<p style="color: var(--text-muted); font-size: 0.9rem; padding: 4px 5px 10px;">Aucun trajet ajouté pour l'instant.</p>`;
        return;
    }

    appData.transports.forEach((t, index) => {
        const icon = transportIcons[t.type] || 'fa-train';
        const isExpanded = !!expandedTransports[index];
        list.innerHTML += `
                <div class="card clickable" ${actionAttrs('toggleTransportExpand', [index])}>
                    <button class="delete-btn-round" ${actionAttrs('deleteTransport', [index])} aria-label="Supprimer ce transport"><i class="fa-solid fa-trash-can"></i></button>
                <div class="card-header-row">
                    <div class="card-title-group">
                        <div class="card-icon"><i class="fa-solid ${icon}"></i></div>
                        <div>
                            <div class="card-title">${esc(t.train || t.type)}</div>
                            <div class="card-subtitle" style="font-weight: 700; color: var(--accent-primary);">${esc(t.type || '')}</div>
                        </div>
                    </div>
                    ${dateBadgeHtml(t.date)}
                </div>
                <div class="flight-route">
                    <div class="flight-airport">
                        <div class="airport-code" style="font-size: 1.2rem;">${esc(t.depStation)}</div>
                        <div class="airport-city">${esc(t.depTime || '')}</div>
                    </div>
                    <div class="flight-line-container">
                        <div class="flight-line"></div>
                        <i class="fa-solid ${icon} flight-icon-center"></i>
                    </div>
                    <div class="flight-airport right">
                        <div class="airport-code" style="font-size: 1.2rem;">${esc(t.arrStation)}</div>
                        <div class="airport-city">${esc(t.arrTime || '')}</div>
                    </div>
                </div>
                <div style="display: ${isExpanded ? 'block' : 'none'}; margin-top: 16px; padding-top: 14px; border-top: 1.5px dashed #ddd;">
                    ${isExpanded ? buildTransportDetailHtml(t, index) : ''}
                </div>
                <div style="text-align: center; margin-top: 8px; color: #ccc;">
                    <i class="fa-solid fa-chevron-${isExpanded ? 'up' : 'down'}"></i>
                </div>
            </div>
        `;
    });
}

function openAddTransportModal() {
    document.getElementById('transport-modal-title').innerText = "Ajouter un trajet";
    document.getElementById('transport-edit-id').value = "";
    document.getElementById('transport-type').value = "Train";
    document.getElementById('transport-nom').value = "";
    document.getElementById('transport-date').value = "";
    document.getElementById('transport-dep-gare').value = "";
    document.getElementById('transport-dep-heure').value = "";
    document.getElementById('transport-dep-voie').value = "";
    document.getElementById('transport-arr-gare').value = "";
    document.getElementById('transport-arr-heure').value = "";
    document.getElementById('transport-arr-voie').value = "";
    document.getElementById('transport-siege').value = "";
    document.getElementById('transport-notes').value = "";
    openModal('modal-transport');
}

function openEditTransportModal(index) {
    const t = appData.transports[index];
    if (!t) return;
    document.getElementById('transport-modal-title').innerText = "Modifier le trajet";
    document.getElementById('transport-edit-id').value = index;
    document.getElementById('transport-type').value = t.type || "Train";
    document.getElementById('transport-nom').value = t.train || "";
    document.getElementById('transport-date').value = t.date || "";
    document.getElementById('transport-dep-gare').value = t.depStation || "";
    document.getElementById('transport-dep-heure').value = t.depTime || "";
    document.getElementById('transport-dep-voie').value = t.depPlatform || "";
    document.getElementById('transport-arr-gare').value = t.arrStation || "";
    document.getElementById('transport-arr-heure').value = t.arrTime || "";
    document.getElementById('transport-arr-voie').value = t.arrPlatform || "";
    document.getElementById('transport-siege').value = t.seat || "";
    document.getElementById('transport-notes').value = t.notes || "";
    openModal('modal-transport');
}

function saveTransport() {
    if (!requireEditor()) return;
    const editIndex = document.getElementById('transport-edit-id').value;
    const type = document.getElementById('transport-type').value;
    const train = document.getElementById('transport-nom').value.trim();
    const date = dateToStoredValue(document.getElementById('transport-date').value);
    const depStation = document.getElementById('transport-dep-gare').value.trim();
    const depTime = document.getElementById('transport-dep-heure').value.trim();
    const depPlatform = document.getElementById('transport-dep-voie').value.trim();
    const arrStation = document.getElementById('transport-arr-gare').value.trim();
    const arrTime = document.getElementById('transport-arr-heure').value.trim();
    const arrPlatform = document.getElementById('transport-arr-voie').value.trim();
    const seat = document.getElementById('transport-siege').value.trim();
    const notes = document.getElementById('transport-notes').value.trim();

    if (!date || !depStation || !arrStation) return;

    if (!appData.transports) appData.transports = [];

    if (editIndex !== "") {
        const i = parseInt(editIndex);
        appData.transports[i] = { ...appData.transports[i], type, train, date, depStation, depTime, depPlatform, arrStation, arrTime, arrPlatform, seat, notes };
    } else {
        appData.transports.push({ id: Date.now(), type, train, date, depStation, depTime, depPlatform, arrStation, arrTime, arrPlatform, seat, notes });
    }

    saveToLocalStorage();
    renderTransports();
    closeModal('modal-transport');
}

function deleteTransport(index) {
    if (!requireEditor()) return;
    if (confirm("Voulez-vous vraiment supprimer ce trajet ?")) {
        appData.transports.splice(index, 1);
        saveToLocalStorage();
        renderTransports();
    }
}

// --- PROGRAMME ---
function openAddProgrammeModal() {
    document.getElementById('prog-modal-title').innerText = "Ajouter une destination";
    document.getElementById('prog-edit-id').value = "";
    document.getElementById('prog-ville').value = "";
    document.getElementById('prog-hotel').value = "";
    document.getElementById('prog-date-start').value = "";
    document.getElementById('prog-date-end').value = "";
    document.getElementById('prog-maps').value = "";
    syncPickerControls(document.getElementById('modal-programme'));
    openModal('modal-programme');
}

function openEditProgrammeModal(id) {
    const item = appData.programme.find(p => p.id === id);
    if (item) {
        document.getElementById('prog-modal-title').innerText = "Modifier la destination";
        document.getElementById('prog-edit-id').value = item.id;
        document.getElementById('prog-ville').value = item.ville;
        document.getElementById('prog-hotel').value = item.hotel;
        document.getElementById('prog-date-start').value = item.dateStart;
        document.getElementById('prog-date-end').value = item.dateEnd;
        document.getElementById('prog-maps').value = item.maps || "";
        syncPickerControls(document.getElementById('modal-programme'));
        openModal('modal-programme');
    }
}

let selectedItineraryProgrammeId = null;
const selectedItineraryDayByProgramme = {};
let itineraryInitialFocusSet = false;

function sortedItineraryDays(prog) {
    return (prog.jours || []).slice().sort((a, b) => {
        const da = parseFrenchShortDate(a, tripYear());
        const db = parseFrenchShortDate(b, tripYear());
        if (da && db) return da - db;
        if (da) return -1;
        if (db) return 1;
        return a.localeCompare(b);
    });
}

function bestItineraryDay(prog) {
    const days = sortedItineraryDays(prog);
    if (!days.length) return '';
    const today = new Date();
    const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    return days.find(day => {
        const parsed = parseFrenchShortDate(day, tripYear());
        return parsed && new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()).getTime() === todayDate.getTime();
    }) || days.find(day => {
        const parsed = parseFrenchShortDate(day, tripYear());
        return parsed && parsed >= todayDate;
    }) || days[0];
}

function focusInitialItineraryDay() {
    const programmes = appData.programme || [];
    if (!programmes.length) return;
    if (!programmes.some(prog => prog.id === selectedItineraryProgrammeId)) {
        selectedItineraryProgrammeId = programmes[0].id;
    }
    if (itineraryInitialFocusSet) return;

    const allDays = programmes.flatMap(prog => sortedItineraryDays(prog).map(date => ({ prog, date })));
    if (!allDays.length) {
        itineraryInitialFocusSet = true;
        return;
    }

    const today = new Date();
    const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    allDays.sort((a, b) => {
        const da = parseFrenchShortDate(a.date, tripYear());
        const db = parseFrenchShortDate(b.date, tripYear());
        return (da || 0) - (db || 0);
    });
    const initial = allDays.find(({ date }) => {
        const parsed = parseFrenchShortDate(date, tripYear());
        return parsed && new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()).getTime() === todayDate.getTime();
    }) || allDays.find(({ date }) => {
        const parsed = parseFrenchShortDate(date, tripYear());
        return parsed && parsed >= todayDate;
    }) || allDays[0];

    selectedItineraryProgrammeId = initial.prog.id;
    selectedItineraryDayByProgramme[initial.prog.id] = initial.date;
    itineraryInitialFocusSet = true;
}

function selectItineraryDestination(progId) {
    const prog = (appData.programme || []).find(item => item.id === progId);
    if (!prog) return;
    selectedItineraryProgrammeId = progId;
    if (!(progId in selectedItineraryDayByProgramme)) {
        selectedItineraryDayByProgramme[progId] = bestItineraryDay(prog);
    }
    document.querySelectorAll('[data-itinerary-destination]').forEach(button => {
        const active = String(button.dataset.itineraryDestination) === String(progId);
        button.setAttribute('aria-pressed', String(active));
        button.closest('.itinerary-city-slide')?.classList.toggle('is-active', active);
    });
    renderDestinationDayBar(progId);
}

function selectItineraryDay(progId, date) {
    selectedItineraryProgrammeId = progId;
    selectedItineraryDayByProgramme[progId] = date;
    renderDestinationDayBar(progId);
}

function safeId(str) {
    return String(str).replace(/[^a-zA-Z0-9]/g, '_');
}

function addDayToDestination(progId) {
    if (!requireEditor()) return;
    const input = document.getElementById('new-day-date-' + progId);
    if (!input) return;
    const date = dateToStoredValue(input.value);
    if (!date) return;
    const prog = appData.programme.find(p => p.id === progId);
    if (!prog) return;
    if (!prog.jours) prog.jours = [];
    if (!prog.jours.includes(date)) {
        prog.jours.push(date);
        saveToLocalStorage();
    }
    input.value = '';
    selectedItineraryProgrammeId = progId;
    selectedItineraryDayByProgramme[progId] = date;
    renderProgramme();
}

function deleteDay(progId, date) {
    if (!requireEditor()) return;
    if (!confirm(`Supprimer la journée du ${date} et ses activités ?`)) return;
    const prog = appData.programme.find(p => p.id === progId);
    if (!prog) return;
    prog.jours = (prog.jours || []).filter(d => d !== date);
    prog.activites = (prog.activites || []).filter(a => a.date !== date);
    saveToLocalStorage();
    selectedItineraryDayByProgramme[progId] = prog.jours.includes(selectedItineraryDayByProgramme[progId])
        ? selectedItineraryDayByProgramme[progId]
        : bestItineraryDay(prog);
    renderProgramme();
}

let editingDay = null; // "progId|date" de la journée en cours de modification, ou null

function startEditDay(progId, date) {
    if (!requireEditor()) return;
    editingDay = progId + '|' + date;
    renderDestinationDayBar(progId);
}

function cancelEditDay(progId) {
    editingDay = null;
    renderDestinationDayBar(progId);
}

function saveEditDay(progId, oldDate) {
    if (!requireEditor()) return;
    const idSuffix = progId + '_' + safeId(oldDate);
    const input = document.getElementById('edit-day-date-' + idSuffix);
    if (!input) return;
    const newDate = dateToStoredValue(input.value);
    if (!newDate) return;
    const prog = appData.programme.find(p => p.id === progId);
    if (!prog) return;

    if (newDate !== oldDate) {
        if ((prog.jours || []).includes(newDate)) {
            alert("Cette date existe déjà pour cette destination.");
            return;
        }
        prog.jours = (prog.jours || []).map(d => d === oldDate ? newDate : d);
        (prog.activites || []).forEach(a => { if (a.date === oldDate) a.date = newDate; });
        if (selectedItineraryDayByProgramme[progId] === oldDate) selectedItineraryDayByProgramme[progId] = newDate;
    }
    saveToLocalStorage();
    editingDay = null;
    renderDestinationDayBar(progId);
}

function addInlineDayActivite(progId, date) {
    if (!requireEditor()) return;
    const idSuffix = progId + '_' + safeId(date);
    const heure = document.getElementById('inline-act-heure-' + idSuffix).value.trim();
    const texte = document.getElementById('inline-act-texte-' + idSuffix).value.trim();
    const lien = document.getElementById('inline-act-lien-' + idSuffix).value.trim();
    if (!heure || !texte) return;
    const prog = appData.programme.find(p => p.id === progId);
    if (!prog) return;
    if (!prog.activites) prog.activites = [];
    prog.activites.push({ id: Date.now() + Math.floor(Math.random() * 1000), date: date, heure: heure, texte: texte, lien: lien });
    saveToLocalStorage();
    renderProgramme();
    renderDashboardSummary();
}

function deleteDayActivite(progId, date, activiteId) {
    if (!requireEditor()) return;
    const prog = appData.programme.find(p => p.id === progId);
    if (!prog) return;
    prog.activites = (prog.activites || []).filter(a => a.id !== activiteId);
    saveToLocalStorage();
    renderProgramme();
    renderDashboardSummary();
}

let editingActivite = null; // id de l'activité en cours de modification, ou null

function startEditActivite(progId, activiteId) {
    editingActivite = activiteId;
    renderDestinationDayBar(progId);
}

function cancelEditActivite(progId) {
    editingActivite = null;
    renderDestinationDayBar(progId);
}

function saveEditActivite(progId, activiteId) {
    if (!requireEditor()) return;
    const heure = document.getElementById('edit-act-heure-' + activiteId).value.trim();
    const texte = document.getElementById('edit-act-texte-' + activiteId).value.trim();
    const lien = document.getElementById('edit-act-lien-' + activiteId).value.trim();
    if (!heure || !texte) return;
    const prog = appData.programme.find(p => p.id === progId);
    if (!prog) return;
    const act = (prog.activites || []).find(a => a.id === activiteId);
    if (!act) return;
    act.heure = heure;
    act.texte = texte;
    act.lien = lien;
    saveToLocalStorage();
    editingActivite = null;
    renderDestinationDayBar(progId);
}

// Affiche les dates de la ville choisie puis le planning de la date sélectionnée.
function renderDestinationDayBar(progId) {
    const container = document.getElementById('itinerary-selected-stage');
    if (!container) return;
    const prog = appData.programme.find(p => p.id === progId);
    if (!prog) return;

    if (!(prog.jours || []).length && prog.dateStart && prog.dateEnd) {
        const generatedDays = itineraryDatesBetween(prog.dateStart, prog.dateEnd);
        if (generatedDays.length) {
            prog.jours = generatedDays;
            saveToLocalStorage();
        }
    }
    const jours = sortedItineraryDays(prog);
    if (!jours.includes(selectedItineraryDayByProgramme[progId])) {
        selectedItineraryDayByProgramme[progId] = bestItineraryDay(prog);
    }
    const selectedDate = selectedItineraryDayByProgramme[progId] || '';
    const selectedSuffix = selectedDate ? `${progId}_${safeId(selectedDate)}` : '';
    const progMapsUrl = mapsOpenLink(prog.maps);
    const cityRange = prog.dateStart === prog.dateEnd ? esc(prog.dateStart || '') : `${esc(prog.dateStart || '')} — ${esc(prog.dateEnd || '')}`;
    const hotel = prog.hotel ? esc(prog.hotel) : 'Hébergement à préciser';

    const daysHtml = jours.length ? jours.map((date, index) => {
        const parsed = parseFrenchShortDate(date, tripYear());
        const weekday = parsed ? parsed.toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', '') : 'jour';
        const dayNumber = parsed ? parsed.toLocaleDateString('fr-FR', { day: '2-digit' }) : String(index + 1).padStart(2, '0');
        const month = parsed ? parsed.toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '') : date;
        const activityCount = (prog.activites || []).filter(activity => activity.date === date).length;
        const chosen = date === selectedDate;
        return `
            <button type="button" id="itinerary-day-${progId}-${safeId(date)}" class="itinerary-date-card${chosen ? ' is-selected' : ''}" ${actionAttrs('selectItineraryDay', [progId, date])} aria-pressed="${chosen}">
                <span class="itinerary-date-weekday">${esc(weekday)}</span>
                <span class="itinerary-date-main"><strong>${esc(dayNumber)}</strong><span>${esc(month)}</span></span>
                <span class="itinerary-date-activity-count">${activityCount} activité${activityCount === 1 ? '' : 's'}</span>
            </button>
        `;
    }).join('') : `<div class="itinerary-no-dates"><i class="fa-regular fa-calendar-plus" aria-hidden="true"></i><span>Ajoute les dates de cette étape pour créer ton planning.</span></div>`;

    let activitiesHtml = '';
    if (selectedDate) {
        const dayActivities = (prog.activites || []).filter(activity => activity.date === selectedDate).sort((a, b) => String(a.heure || '').localeCompare(String(b.heure || '')));
        dayActivities.forEach(activity => {
            if (editingActivite === activity.id) {
                activitiesHtml += `
                    <div class="itinerary-activity-edit">
                        ${timePickerPairHtml(`edit-act-heure-${activity.id}`, activity.heure, 'Heure')}
                        <input type="text" id="edit-act-texte-${activity.id}" value="${esc(activity.texte)}" placeholder="Activité">
                        <input type="text" id="edit-act-lien-${activity.id}" value="${esc(activity.lien || '')}" placeholder="Lien Maps ou coordonnées">
                        <div class="itinerary-edit-actions">
                            <button ${actionAttrs('saveEditActivite', [progId, activity.id])}>Enregistrer</button>
                            <button ${actionAttrs('cancelEditActivite', [progId])}>Annuler</button>
                        </div>
                    </div>
                `;
                return;
            }
            const activityMapUrl = mapsOpenLink(activity.lien);
            const activityMapLink = activityMapUrl
                ? `<a href="${activityMapUrl}" target="_blank" rel="noopener" class="activity-link-btn" aria-label="Ouvrir le lieu sur la carte"><i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i><span>Carte</span></a>`
                : '';
            activitiesHtml += `
                <article class="itinerary-activity">
                    <time class="itinerary-activity-time">${esc(activity.heure || '—')}</time>
                    <div class="itinerary-activity-copy"><span>${esc(activity.texte)}</span>${activityMapLink}</div>
                    <div class="itinerary-activity-actions">
                        <button ${actionAttrs('startEditActivite', [progId, activity.id])} aria-label="Modifier cette activité"><i class="fa-solid fa-pen-to-square" aria-hidden="true"></i></button>
                        <button ${actionAttrs('deleteDayActivite', [progId, selectedDate, activity.id])} aria-label="Supprimer cette activité"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
                    </div>
                </article>
            `;
        });
        if (!activitiesHtml) activitiesHtml = `<p class="itinerary-empty-activity">Aucune activité prévue. Ajoute une idée à ton planning.</p>`;
    } else {
        activitiesHtml = `<div class="itinerary-plan-empty"><span class="itinerary-empty-icon"><i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i></span><strong>Ton planning prend forme ici</strong><p>Choisis une date ou ajoute une journée à cette étape.</p></div>`;
    }

    const dayTools = selectedDate ? (editingDay === `${progId}|${selectedDate}` ? `
        <div class="itinerary-day-edit">
            ${datePickerPairHtml(`edit-day-date-${selectedSuffix}`, selectedDate, 'Choisir une date')}
            <button ${actionAttrs('saveEditDay', [progId, selectedDate])}>Enregistrer</button>
            <button ${actionAttrs('cancelEditDay', [progId])}>Annuler</button>
        </div>
    ` : `
        <div class="itinerary-plan-heading">
            <div><span>PLANNING DE LA JOURNÉE</span><h3>${esc(selectedDate)}</h3></div>
            <div class="itinerary-plan-actions">
                <button ${actionAttrs('startEditDay', [progId, selectedDate])} aria-label="Modifier la date"><i class="fa-solid fa-pen-to-square" aria-hidden="true"></i><span>Modifier</span></button>
                <button ${actionAttrs('deleteDay', [progId, selectedDate])} aria-label="Supprimer cette journée"><i class="fa-solid fa-trash-can" aria-hidden="true"></i></button>
            </div>
        </div>
    `) : '';

    container.innerHTML = `
        <section class="itinerary-selected-place">
            <div class="itinerary-place-copy">
                <span class="itinerary-place-overline">TON ÉTAPE ${String((appData.programme.findIndex(item => item.id === progId) + 1)).padStart(2, '0')}</span>
                <div><i class="fa-solid fa-bed" aria-hidden="true"></i><span>${hotel}</span></div>
                ${cityRange ? `<small><i class="fa-regular fa-calendar" aria-hidden="true"></i>${cityRange}</small>` : ''}
            </div>
            ${progMapsUrl ? `<a class="itinerary-place-map" href="${progMapsUrl}" target="_blank" rel="noopener"><i class="fa-solid fa-map-location-dot" aria-hidden="true"></i><span>Carte</span></a>` : ''}
        </section>
        <section class="itinerary-day-picker-section">
            <div class="itinerary-section-title"><div><span>TES DATES</span><h3>Choisis ta journée</h3></div><span class="itinerary-day-total">${jours.length} jour${jours.length === 1 ? '' : 's'}</span></div>
            <div class="itinerary-date-rail" aria-label="Dates de cette étape">${daysHtml}</div>
            <div class="jour-checklist-add-row itinerary-add-day">
                ${datePickerPairHtml(`new-day-date-${prog.id}`, '', 'Ajouter une date')}
                <button ${actionAttrs('addDayToDestination', [prog.id])}><i class="fa-solid fa-plus" aria-hidden="true"></i><span>Ajouter</span></button>
            </div>
        </section>
        <section class="itinerary-day-plan">
            ${dayTools}
            <div class="itinerary-activities">${activitiesHtml}</div>
            ${selectedDate ? `<div class="inline-day-activite-add-row">
                ${timePickerPairHtml(`inline-act-heure-${selectedSuffix}`, '', 'Heure')}
                <input type="text" id="inline-act-texte-${selectedSuffix}" placeholder="Nom de l’activité">
                <input type="text" id="inline-act-lien-${selectedSuffix}" placeholder="Lien Maps (facultatif)">
                <button ${actionAttrs('addInlineDayActivite', [progId, selectedDate])} aria-label="Ajouter une activité"><i class="fa-solid fa-plus" aria-hidden="true"></i></button>
            </div>` : ''}
        </section>
    `;
    syncPickerControls(container);
    requestAnimationFrame(() => {
        const rail = container.querySelector('.itinerary-date-rail');
        const selected = rail?.querySelector('.itinerary-date-card.is-selected');
        if (!rail || !selected) return;
        const railRect = rail.getBoundingClientRect();
        const selectedRect = selected.getBoundingClientRect();
        const nextLeft = rail.scrollLeft + selectedRect.left + selectedRect.width / 2 - railRect.left - rail.clientWidth / 2;
        rail.scrollTo({
            left: nextLeft,
            behavior: shouldReduceMotion() ? 'auto' : 'smooth'
        });
    });
}

function renderProgramme() {
    const list = document.getElementById('programme-list');
    focusInitialItineraryDay();
    const programmes = appData.programme || [];
    if (!programmes.length) {
        list.innerHTML = `<div class="empty-state"><span class="empty-state-icon"><i class="fa-solid fa-map-location-dot"></i></span><h3>Le séjour commence ici</h3><p>Ajoute ta première ville, choisis tes dates, puis construis le planning journée par journée.</p><button ${actionAttrs('openAddProgrammeModal')}>Ajouter ma première ville</button></div>`;
        renderDashboardSummary();
        return;
    }

    const selectedProgramme = programmes.find(prog => prog.id === selectedItineraryProgrammeId) || programmes[0];
    selectedItineraryProgrammeId = selectedProgramme.id;
    const cityCards = programmes.map((prog, index) => {
        const active = prog.id === selectedProgramme.id;
        const dateRange = prog.dateStart === prog.dateEnd ? esc(prog.dateStart || 'Dates à choisir') : `${esc(prog.dateStart || 'Début à choisir')} — ${esc(prog.dateEnd || 'Fin à choisir')}`;
        const activityCount = (prog.activites || []).length;
        return `
            <article class="itinerary-city-slide${active ? ' is-active' : ''}">
                <button type="button" class="itinerary-city-card" data-itinerary-destination="${esc(prog.id)}" ${actionAttrs('selectItineraryDestination', [prog.id])} aria-pressed="${active}">
                    <span class="itinerary-city-kicker"><span class="itinerary-city-index">${String(index + 1).padStart(2, '0')}</span> ÉTAPE</span>
                    <strong>${esc(prog.ville)}</strong>
                    <span class="itinerary-city-dates"><i class="fa-regular fa-calendar" aria-hidden="true"></i>${dateRange}</span>
                    <span class="itinerary-city-foot"><span><i class="fa-solid fa-bed" aria-hidden="true"></i>${esc(prog.hotel || 'Hébergement à choisir')}</span><i class="fa-solid fa-arrow-right" aria-hidden="true"></i></span>
                </button>
                <div class="itinerary-city-actions">
                    <span>${(prog.jours || []).length} jour${(prog.jours || []).length === 1 ? '' : 's'} · ${activityCount} activité${activityCount === 1 ? '' : 's'}</span>
                    <button ${actionAttrs('openEditProgrammeModal', [prog.id])} aria-label="Modifier ${esc(prog.ville)}"><i class="fa-solid fa-pen-to-square" aria-hidden="true"></i></button>
                    <button ${actionAttrs('deleteItem', ['programme', prog.id])} aria-label="Supprimer ${esc(prog.ville)}"><i class="fa-solid fa-trash-can" aria-hidden="true"></i></button>
                </div>
            </article>
        `;
    }).join('');

    list.innerHTML = `
        <div class="itinerary-planner">
            <div class="itinerary-route-heading">
                <div><span>TON VOYAGE</span><h2>Choisis une ville</h2></div>
                <button class="itinerary-add-city" ${actionAttrs('openAddProgrammeModal')}><i class="fa-solid fa-plus" aria-hidden="true"></i><span>Ajouter une ville</span></button>
            </div>
            <p class="itinerary-route-hint">← Fais défiler les villes, puis les dates pour ouvrir le planning de ta journée →</p>
            <div class="itinerary-city-carousel" aria-label="Villes de l’itinéraire">${cityCards}</div>
            <div id="itinerary-selected-stage" class="itinerary-selected-stage"></div>
        </div>
    `;
    renderDestinationDayBar(selectedProgramme.id);
    renderDashboardSummary();
    requestAnimationFrame(() => {
        const behavior = shouldReduceMotion() ? 'auto' : 'smooth';
        list.querySelector('.itinerary-city-slide.is-active')?.scrollIntoView({ block: 'nearest', inline: 'center', behavior });
    });
}

// --- CHECKLIST ---
let currentChecklistScope = 'voyage'; // 'voyage' or a programme id number
let currentChecklistFilter = 'all';
let currentChecklistSearch = '';
const collapsedChecklistCategories = new Set();

function renderChecklist() {
    const container = document.getElementById('checklist-categories');
    if (!container) return;
    container.innerHTML = '';

    if (currentChecklistScope === 'voyage') {
        renderGeneralChecklist(container);
    } else {
        renderDayChecklist(container, currentChecklistScope);
    }
    updateChecklistProgress();
    updateChecklistSelectorState();
    renderDashboardSummary();
}

function checklistItemsForCurrentScope() {
    if (currentChecklistScope === 'voyage') return appData.checklist || [];
    return (appData.checklistsJour?.[currentChecklistScope] || []);
}

function checklistItemMatches(item) {
    const matchesFilter = currentChecklistFilter === 'all' ||
        (currentChecklistFilter === 'todo' && !item.checked) ||
        (currentChecklistFilter === 'done' && item.checked);
    const query = stripAccents(currentChecklistSearch).trim().toLowerCase();
    const searchable = stripAccents(`${item.texte || ''} ${item.categorie || ''}`).toLowerCase();
    return matchesFilter && (!query || searchable.includes(query));
}

function updateChecklistProgress() {
    const items = checklistItemsForCurrentScope();
    const completed = items.filter(item => item.checked).length;
    const remaining = items.length - completed;
    const percentage = items.length ? Math.round((completed / items.length) * 100) : 0;
    const progress = document.getElementById('checklist-progress');
    const percent = document.getElementById('checklist-progress-percent');
    const bar = document.getElementById('checklist-progress-bar');
    const track = document.getElementById('checklist-progress-track');
    const caption = document.getElementById('checklist-progress-caption');
    const checkedText = currentChecklistScope === 'voyage'
        ? `${completed} sur ${items.length} préparatifs terminés`
        : `${completed} sur ${items.length} éléments terminés`;

    if (progress) progress.textContent = checkedText;
    if (percent) percent.textContent = `${percentage}%`;
    if (bar) bar.style.width = `${percentage}%`;
    if (track) track.setAttribute('aria-valuenow', String(percentage));
    if (caption) {
        caption.textContent = !items.length ? 'Ajoute quelques éléments à ta liste.' : remaining === 0 ? 'Tout est prêt pour le départ ! 🎉' : `Encore ${remaining} préparatif${remaining > 1 ? 's' : ''} à cocher`;
    }

    const counts = {
        all: items.length,
        todo: remaining,
        done: completed
    };
    document.querySelectorAll('[data-filter]').forEach(button => {
        const filter = button.dataset.filter;
        const selected = filter === currentChecklistFilter;
        button.classList.toggle('is-active', selected);
        button.setAttribute('aria-pressed', String(selected));
        const count = button.querySelector('b');
        if (count) count.textContent = counts[filter] ?? 0;
    });

    const search = document.getElementById('checklist-search');
    if (search && search.value !== currentChecklistSearch) search.value = currentChecklistSearch;
}

function checklistCategoryIcon(category) {
    const value = stripAccents(String(category || '')).toLowerCase();
    if (/papier|reserv|administr|billet/.test(value)) return 'fa-passport';
    if (/bagage|vetement|sac|chauss/.test(value)) return 'fa-suitcase-rolling';
    if (/sante|bien-etre|medic|pharm/.test(value)) return 'fa-heart-pulse';
    if (/transport|trajet|vol/.test(value)) return 'fa-plane';
    if (/electron|tech|chargeur|numer/.test(value)) return 'fa-plug';
    if (/plaisir|loisir|sortie/.test(value)) return 'fa-sparkles';
    return 'fa-list-check';
}

function checklistCategoryLabel(category) {
    const label = String(category || 'Autre').trim().toLocaleLowerCase('fr-FR');
    return label ? label[0].toLocaleUpperCase('fr-FR') + label.slice(1) : 'Autre';
}

function checklistTaskHtml(item, dayScope = false, programmeId = null) {
    const toggleAction = dayScope ? 'toggleCheckJour' : 'toggleCheck';
    const toggleArgs = dayScope ? [programmeId, item.id] : [item.id];
    const deleteAction = dayScope ? 'deleteItemJour' : 'deleteItem';
    const deleteArgs = dayScope ? [programmeId, item.id] : ['checklist', item.id];
    return `<div class="checklist-item prep-task${item.checked ? ' checked' : ''}" data-checklist-item-id="${esc(item.id)}">
        <label class="checklist-main"><input type="checkbox" class="checkbox-round" ${item.checked ? 'checked' : ''} aria-label="${esc(item.texte)}" ${actionAttrs(toggleAction, toggleArgs, { event: 'change' })}><span class="checklist-label">${esc(item.texte)}</span></label>
        <button type="button" class="prep-task-delete" ${actionAttrs(deleteAction, deleteArgs)} aria-label="Supprimer : ${esc(item.texte)}"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
    </div>`;
}

function checklistEmptyState(container, message, description = 'Essaie un autre mot-clé ou affiche toute ta liste.', action = 'resetChecklistFilters', actionArgs = []) {
    container.innerHTML = `<div class="prep-empty-state"><span class="prep-empty-icon"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i></span><h2>${esc(message)}</h2><p>${esc(description)}</p><button type="button" data-action="${esc(action)}" data-action-args="${esc(JSON.stringify(actionArgs))}">${action === 'openModal' ? 'Ajouter un préparatif' : 'Tout afficher'}</button></div>`;
}

function renderGeneralChecklist(container) {
    const categories = new Map();
    (appData.checklist || []).forEach(item => {
        const category = item.categorie || 'AUTRE';
        if (!categories.has(category)) categories.set(category, []);
        categories.get(category).push(item);
    });
    const visibleGroups = [...categories.entries()].map(([category, allItems]) => ({
        category,
        allItems,
        items: allItems.filter(checklistItemMatches)
    })).filter(group => group.items.length);

    if (!visibleGroups.length) {
        if (appData.checklist.length) checklistEmptyState(container, 'Aucun résultat dans cette liste');
        else checklistEmptyState(container, 'Ta liste est encore vide', 'Ajoute les premiers éléments à ne pas oublier avant le départ.', 'openModal', ['modal-checklist']);
        return;
    }

    container.innerHTML = visibleGroups.map(({ category, allItems, items }) => {
        const completed = allItems.filter(item => item.checked).length;
        const percentage = allItems.length ? Math.round((completed / allItems.length) * 100) : 0;
        const key = `voyage:${category}`;
        const collapsed = collapsedChecklistCategories.has(key);
        return `<section class="prep-category${collapsed ? ' is-collapsed' : ''}" data-category-label="${esc(category)}">
            <button type="button" class="prep-category-heading" data-category-label="${esc(category)}" data-action="toggleChecklistCategory" data-action-args='${esc(JSON.stringify([category]))}' data-action-target aria-expanded="${!collapsed}">
                <span class="prep-category-icon"><i class="fa-solid ${checklistCategoryIcon(category)}" aria-hidden="true"></i></span>
                <span class="prep-category-name"><strong>${esc(checklistCategoryLabel(category))}</strong><small>${completed} / ${allItems.length} terminés</small></span>
                <span class="prep-category-meter"><span><i style="width:${percentage}%"></i></span><b>${percentage}%</b></span>
                <i class="fa-solid fa-chevron-down prep-category-chevron" aria-hidden="true"></i>
            </button>
            <div class="prep-category-items" ${collapsed ? 'hidden' : ''}>${items.map(item => checklistTaskHtml(item)).join('')}</div>
        </section>`;
    }).join('');
}

function renderDayChecklist(container, progId) {
    if (!appData.checklistsJour) appData.checklistsJour = {};
    if (!appData.checklistsJour[progId]) appData.checklistsJour[progId] = [];
    const items = appData.checklistsJour[progId];
    const prog = appData.programme.find(p => p.id === progId);
    const visibleItems = items.filter(checklistItemMatches);
    if (items.length && !visibleItems.length) checklistEmptyState(container, 'Aucun résultat dans cette liste');
    else if (!items.length) container.innerHTML = `<div class="prep-empty-state"><span class="prep-empty-icon"><i class="fa-solid fa-suitcase" aria-hidden="true"></i></span><h2>Rien à préparer ici, pour l’instant</h2><p>Ajoute les petits essentiels à ne pas oublier pour ${esc(prog?.ville || 'cette étape')}.</p></div>`;
    else container.innerHTML = `<section class="prep-category prep-day-category"><div class="prep-day-heading"><span class="prep-category-icon"><i class="fa-solid fa-location-dot" aria-hidden="true"></i></span><span><strong>${esc(prog?.ville || 'Cette étape')}</strong><small>Les essentiels de cette destination</small></span></div><div class="prep-category-items">${visibleItems.map(item => checklistTaskHtml(item, true, progId)).join('')}</div></section>`;

    const addRow = document.createElement('div');
    addRow.className = 'prep-day-add-row';
    addRow.innerHTML = `<input type="text" id="jour-checklist-add-input" placeholder="Ajouter un préparatif…" aria-label="Nouveau préparatif pour ${esc(prog?.ville || 'cette étape')}" data-action="handleChecklistEnter" data-action-event="keydown" data-action-event-object><button type="button" ${actionAttrs('addJourCheckItemGlobal', [progId])} aria-label="Ajouter une tâche"><i class="fa-solid fa-plus" aria-hidden="true"></i> Ajouter</button>`;
    container.appendChild(addRow);
}

function addJourCheckItemGlobal(progId) {
    if (!requireEditor()) return;
    const input = document.getElementById('jour-checklist-add-input');
    if (!input) return;
    const texte = input.value.trim();
    if (!texte) return;
    if (!appData.checklistsJour[progId]) appData.checklistsJour[progId] = [];
    appData.checklistsJour[progId].push({
        id: Date.now(),
        texte: texte,
        checked: false
    });
    input.value = '';
    saveToLocalStorage();
    renderChecklist();
}

function buildChecklistSelector() {
    const bar = document.getElementById('checklist-selector-bar');
    if (!bar) return;
    const tripChecked = appData.checklist.filter(item => item.checked).length;
    let html = `<span class="selector-label">MES LISTES</span>`;
    html += `<button type="button" class="checklist-selector-btn ${currentChecklistScope === 'voyage' ? 'active' : ''}" data-checklist-scope="voyage" ${actionAttrs('switchChecklistScope', ['voyage'])} aria-pressed="${currentChecklistScope === 'voyage'}"><i class="fa-solid fa-suitcase" aria-hidden="true"></i><span>Tout le séjour</span><small>${tripChecked}/${appData.checklist.length}</small></button>`;
    appData.programme.forEach(prog => {
        const isActive = currentChecklistScope === prog.id;
        const dayItems = appData.checklistsJour?.[prog.id] || [];
        const checked = dayItems.filter(item => item.checked).length;
        html += `<button type="button" class="checklist-selector-btn ${isActive ? 'active' : ''}" data-checklist-scope="${esc(prog.id)}" ${actionAttrs('switchChecklistScope', [prog.id])} aria-pressed="${isActive}"><i class="fa-solid fa-location-dot" aria-hidden="true"></i><span>${esc(prog.ville)}</span><small>${checked}/${dayItems.length}</small></button>`;
    });
    bar.innerHTML = html;
}

function updateChecklistSelectorState() {
    document.querySelectorAll('.checklist-selector-btn[data-checklist-scope]').forEach(button => {
        const scope = button.dataset.checklistScope;
        const isActive = String(currentChecklistScope) === scope;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-pressed', String(isActive));
        let items;
        if (scope === 'voyage') items = appData.checklist || [];
        else items = appData.checklistsJour?.[scope] || [];
        const count = button.querySelector('small');
        if (count) count.textContent = `${items.filter(item => item.checked).length}/${items.length}`;
    });
}

function switchChecklistScope(scope) {
    currentChecklistScope = scope;
    currentChecklistSearch = '';
    renderChecklist();
}

function switchChecklistFilter(filter) {
    if (!['all', 'todo', 'done'].includes(filter)) return;
    currentChecklistFilter = filter;
    renderChecklist();
}

function setChecklistSearch(input) {
    const selection = [input?.selectionStart, input?.selectionEnd];
    currentChecklistSearch = input?.value || '';
    renderChecklist();
    const search = document.getElementById('checklist-search');
    search?.focus({ preventScroll: true });
    if (search && selection[0] !== null && selection[1] !== null) search.setSelectionRange(selection[0], selection[1]);
}

function resetChecklistFilters() {
    currentChecklistFilter = 'all';
    currentChecklistSearch = '';
    renderChecklist();
}

function toggleChecklistCategory(category, button) {
    const key = `${currentChecklistScope}:${category}`;
    if (collapsedChecklistCategories.has(key)) collapsedChecklistCategories.delete(key);
    else collapsedChecklistCategories.add(key);
    renderChecklist();
    const label = button?.dataset.categoryLabel || category;
    [...document.querySelectorAll('.prep-category-heading')]
        .find(heading => heading.dataset.categoryLabel === label)
        ?.focus({ preventScroll: true });
}

function handleChecklistEnter(event) {
    if (event.key === 'Enter') {
        event.preventDefault();
        addJourCheckItemGlobal(currentChecklistScope);
    }
}

function toggleCheck(id) {
    if (!requireEditor()) { renderChecklist(); return; }
    const item = appData.checklist.find(i => i.id === id);
    if (item) {
        item.checked = !item.checked;
        saveToLocalStorage();
        if (currentChecklistScope === 'voyage' && currentChecklistFilter === 'all' && !currentChecklistSearch.trim()) {
            updateChecklistTaskInPlace(item);
        } else {
            renderChecklist();
        }
    }
}

function toggleCheckJour(progId, itemId) {
    if (!requireEditor()) { if (currentChecklistScope === progId) renderChecklist(); return; }
    if (!appData.checklistsJour[progId]) return;
    const items = appData.checklistsJour[progId];
    const item = items.find(i => i.id === itemId);
    if (item) {
        item.checked = !item.checked;
        saveToLocalStorage();
        if (currentChecklistScope === progId && currentChecklistFilter === 'all' && !currentChecklistSearch.trim()) updateChecklistTaskInPlace(item);
        else if (currentChecklistScope === progId) renderChecklist();
        else buildChecklistSelector();
    }
}

function updateChecklistTaskInPlace(item) {
    const row = [...document.querySelectorAll('#checklist-categories [data-checklist-item-id]')]
        .find(element => element.dataset.checklistItemId === String(item.id));
    if (row) row.classList.toggle('checked', Boolean(item.checked));

    const category = item.categorie || 'AUTRE';
    if (currentChecklistScope === 'voyage') {
        const categoryCard = [...document.querySelectorAll('#checklist-categories .prep-category[data-category-label]')]
            .find(element => element.dataset.categoryLabel === category);
        if (categoryCard) {
            const items = (appData.checklist || []).filter(entry => (entry.categorie || 'AUTRE') === category);
            const completed = items.filter(entry => entry.checked).length;
            const percentage = items.length ? Math.round((completed / items.length) * 100) : 0;
            const small = categoryCard.querySelector('.prep-category-name small');
            const meter = categoryCard.querySelector('.prep-category-meter i');
            const percent = categoryCard.querySelector('.prep-category-meter b');
            if (small) small.textContent = `${completed} / ${items.length} terminés`;
            if (meter) meter.style.width = `${percentage}%`;
            if (percent) percent.textContent = `${percentage}%`;
        }
    }
    updateChecklistProgress();
    updateChecklistSelectorState();
    renderDashboardSummary();
}

function deleteItemJour(progId, itemId) {
    if (!requireEditor()) return;
    if (!appData.checklistsJour[progId]) return;
    if (confirm("Voulez-vous vraiment supprimer cet élément ?")) {
        appData.checklistsJour[progId] = appData.checklistsJour[progId].filter(i => i.id !== itemId);
        saveToLocalStorage();
        if (currentChecklistScope === progId) renderChecklist();
        else buildChecklistSelector();
    }
}

// --- BUDGET ---
function updateBudgetUI() {
    const list = document.getElementById('expenses-list');
    list.innerHTML = '';
    const baseCurrency = appData.budgetCurrency || 'EUR';
    let total = 0, paid = 0;
    const paidByPerson = {};

    appData.budget.forEach(exp => {
        const amount = Number(exp.amount ?? exp.eur) || 0;
        const currency = exp.currency || 'EUR';
        const converted = convertCurrency(amount, currency, baseCurrency);
        const payeurs = exp.payeurs || [];
        if (converted !== null) total += converted;
        if (exp.paid && converted !== null) {
            paid += converted;
            if (payeurs.length) {
                const part = converted / payeurs.length;
                payeurs.forEach(name => { paidByPerson[name] = (paidByPerson[name] || 0) + part; });
            }
        }
        const cat = exp.categorie || 'Autre';
        const icon = budgetCategoryIcons[cat] || budgetCategoryIcons['Autre'];
        const methodeIcon = exp.methode === 'Carte bleue' ? '💳' : (exp.methode === 'Espèces' ? '💴' : '');
        const payeurHtml = payeurs.length
            ? `<span class="expense-payeur-pill">${methodeIcon ? methodeIcon + ' ' : ''}${esc(payeurs.join(' + '))}${exp.methode ? ' · ' + esc(exp.methode) : ''}</span>`
            : '';
        list.innerHTML += `
            <div class="expense-card">
                    <button class="delete-btn" ${actionAttrs('deleteItem', ['budget', exp.id])} aria-label="Supprimer cette dépense" style="top: 16px; right: 15px;"><i class="fa-solid fa-xmark"></i></button>
                <div class="expense-card-top">
                <div class="expense-info">
                    <h4>${esc(exp.nom)}</h4>
                        <p><i class="fa-solid ${icon}" style="margin-right:4px;"></i>${esc(cat)}${converted === null ? ' · conversion indisponible' : ` · ${formatCurrency(converted, baseCurrency)}`}</p>
                    </div>
                    <div class="expense-amounts">
                    <span class="expense-eur">${formatCurrency(amount, currency)}</span>
                    </div>
                </div>
                <div class="expense-card-footer">
                    <button class="expense-paid-pill ${exp.paid ? 'paid' : ''}" ${actionAttrs('toggleBudgetPaid', [exp.id])}>${exp.paid ? '✓ Payé' : 'À payer'}</button>
                    ${payeurHtml}
                    <button ${actionAttrs('openEditBudgetModal', [exp.id])} aria-label="Modifier cette dépense" style="background:none; border:none; color:#bbb; cursor:pointer; font-size:0.95rem;"><i class="fa-solid fa-pen-to-square"></i></button>
                </div>
            </div>
        `;
    });

    if (appData.budget.length === 0) {
        list.innerHTML = `<div class="empty-state"><span class="empty-state-icon"><i class="fa-solid fa-coins"></i></span><h3>Votre budget, à votre rythme</h3><p>Ajoutez une dépense dès qu'un prix se précise. Les montants de plusieurs devises seront réunis dans la devise choisie.</p></div>`;
    }

    document.getElementById('budget-total-paid').innerText = formatCurrency(paid, baseCurrency);
    document.getElementById('budget-total-remaining').innerText = formatCurrency(total - paid, baseCurrency);
    populateCurrencySelectors();
    renderBudgetSplit(paidByPerson);
    renderBudgetPeopleManageList();
    renderBudgetPeoplePicker();
    renderDashboardSummary();
}

// --- GESTION DES PRÉNOMS (pour attribuer/répartir les dépenses) ---
function renderBudgetPeopleManageList() {
    const container = document.getElementById('budget-people-list');
    if (!container) return;
    if (appData.budgetPeople.length === 0) {
        container.innerHTML = `<p style="font-size:0.82rem; color:var(--text-muted); margin:0;">Aucun prénom pour l'instant — ajoute-en un ci-dessous.</p>`;
        return;
    }
    container.innerHTML = appData.budgetPeople.map((name, i) => `
        <span class="people-chip">
            ${esc(name)}
            <button type="button" ${actionAttrs('removeBudgetPersonAt', [i])} aria-label="Retirer ce participant">✕</button>
        </span>
    `).join('');
}

function addBudgetPerson() {
    if (!requireEditor()) return;
    const input = document.getElementById('budget-people-input');
    const name = input.value.trim();
    if (!name || appData.budgetPeople.includes(name)) { input.value = ''; return; }
    appData.budgetPeople.push(name);
    input.value = '';
    saveToLocalStorage();
    updateBudgetUI();
}

function removeBudgetPersonAt(index) {
    if (!requireEditor()) return;
    const name = appData.budgetPeople[index];
    appData.budgetPeople.splice(index, 1);
    appData.budget.forEach(exp => {
        if (exp.payeurs) exp.payeurs = exp.payeurs.filter(n => n !== name);
    });
    selectedPayeurs = selectedPayeurs.filter(n => n !== name);
    saveToLocalStorage();
    updateBudgetUI();
}

// --- SÉLECTEUR MULTIPLE "PAYÉ PAR" DANS LE FORMULAIRE DE DÉPENSE ---
let selectedPayeurs = [];

function renderBudgetPeoplePicker() {
    const picker = document.getElementById('bud-payeurs-picker');
    const hint = document.getElementById('bud-payeurs-hint');
    if (!picker) return;
    hint.style.display = appData.budgetPeople.length === 0 ? 'block' : 'none';
    picker.innerHTML = appData.budgetPeople.map((name, i) => `
            <button type="button" class="payeur-toggle-chip ${selectedPayeurs.includes(name) ? 'selected' : ''}" ${actionAttrs('toggleBudPayeurAt', [i])}>${esc(name)}</button>
    `).join('');
}

function toggleBudPayeurAt(index) {
    const name = appData.budgetPeople[index];
    const i = selectedPayeurs.indexOf(name);
    if (i === -1) selectedPayeurs.push(name); else selectedPayeurs.splice(i, 1);
    renderBudgetPeoplePicker();
}

// Répartition des dépenses déjà payées entre les personnes, pour
// savoir qui doit rembourser quoi à qui (utile pour un couple/groupe).
function renderBudgetSplit(paidByPerson) {
    const card = document.getElementById('budget-split-card');
    const names = Object.keys(paidByPerson);
    const currency = appData.budgetCurrency || 'EUR';
    if (names.length === 0) {
        card.innerHTML = '';
        return;
    }

    const rowsHtml = names.map(name =>
        `<div style="display:flex; justify-content:space-between; font-size:0.88rem; padding:4px 0;">
            <span>${esc(name)}</span>
            <span style="font-weight:700;">${formatCurrency(paidByPerson[name], currency)}</span>
        </div>`
    ).join('');

    let balanceHtml = '';
    if (names.length === 2) {
        const [a, b] = names;
        const diff = paidByPerson[a] - paidByPerson[b];
        if (Math.abs(diff) > 0.009) {
            const debtor = diff > 0 ? b : a;
            const creditor = diff > 0 ? a : b;
            balanceHtml = `<div style="margin-top:8px; padding-top:8px; border-top:1px solid rgba(0,0,0,0.08); font-size:0.85rem; font-weight:700; color: var(--accent-primary);">
                ${esc(debtor)} doit rembourser ${formatCurrency(Math.abs(diff) / 2, currency)} à ${esc(creditor)}
            </div>`;
        } else {
            balanceHtml = `<div style="margin-top:8px; padding-top:8px; border-top:1px solid rgba(0,0,0,0.08); font-size:0.85rem; font-weight:700; color: var(--accent-primary);">Comptes équilibrés 👌</div>`;
        }
    }

    card.innerHTML = `
        <div class="card" style="padding:14px 16px; margin-bottom:16px;">
            <div class="section-title" style="margin-bottom:6px;">Répartition</div>
            ${rowsHtml}
            ${balanceHtml}
        </div>
    `;
}

const budgetCategoryIcons = {
    'Transport': 'fa-train',
    'Hébergement': 'fa-bed',
    'Activités & Billets': 'fa-ticket',
    'Nourriture': 'fa-utensils',
    'Shopping': 'fa-bag-shopping',
    'Autre': 'fa-circle-dot'
};

function openAddBudgetModal() {
    document.getElementById('budget-modal-title').innerText = "Ajouter une dépense";
    document.getElementById('bud-edit-id').value = '';
    document.getElementById('bud-name').value = '';
    document.getElementById('bud-amount').value = '';
    document.getElementById('bud-currency').value = appData.budgetCurrency || 'EUR';
    document.getElementById('bud-cat').value = 'Autre';
    selectedPayeurs = [];
    renderBudgetPeoplePicker();
    document.getElementById('bud-methode').value = '';
    document.getElementById('bud-paid').checked = false;
    openModal('modal-budget');
}

function openEditBudgetModal(id) {
    const exp = appData.budget.find(e => e.id === id);
    if (!exp) return;
    document.getElementById('budget-modal-title').innerText = "Modifier la dépense";
    document.getElementById('bud-edit-id').value = exp.id;
    document.getElementById('bud-name').value = exp.nom || '';
    document.getElementById('bud-amount').value = exp.amount ?? exp.eur;
    document.getElementById('bud-currency').value = exp.currency || 'EUR';
    document.getElementById('bud-cat').value = exp.categorie || 'Autre';
    selectedPayeurs = (exp.payeurs || []).slice();
    renderBudgetPeoplePicker();
    document.getElementById('bud-methode').value = exp.methode || '';
    document.getElementById('bud-paid').checked = !!exp.paid;
    openModal('modal-budget');
}

function toggleBudgetPaid(id) {
    if (!requireEditor()) return;
    const exp = appData.budget.find(e => e.id === id);
    if (!exp) return;
    exp.paid = !exp.paid;
    saveToLocalStorage();
    updateBudgetUI();
}

function saveBudget() {
    if (!requireEditor()) return;
    const editId = document.getElementById('bud-edit-id').value;
    const nom = document.getElementById('bud-name').value.trim();
    const amount = parseFloat(document.getElementById('bud-amount').value);
    const currency = document.getElementById('bud-currency').value || 'EUR';
    const categorie = document.getElementById('bud-cat').value;
    const payeurs = selectedPayeurs.slice();
    const methode = document.getElementById('bud-methode').value;
    const paid = document.getElementById('bud-paid').checked;
    if (!nom || isNaN(amount) || amount < 0) return;

    if (editId) {
        const exp = appData.budget.find(e => e.id === parseInt(editId));
        if (exp) {
            exp.nom = nom;
            exp.amount = amount;
            exp.currency = currency;
            exp.eur = convertCurrency(amount, currency, 'EUR') ?? (currency === 'EUR' ? amount : 0);
            exp.categorie = categorie;
            exp.payeurs = payeurs;
            exp.methode = methode;
            exp.paid = paid;
        }
    } else {
        appData.budget.push({ id: Date.now(), nom, amount, currency, eur: convertCurrency(amount, currency, 'EUR') ?? (currency === 'EUR' ? amount : 0), categorie, payeurs, methode, paid });
    }
    saveToLocalStorage();
    updateBudgetUI();

    document.getElementById('bud-edit-id').value = '';
    document.getElementById('bud-name').value = '';
    document.getElementById('bud-amount').value = '';
    closeModal('modal-budget');
}

// --- INFOS ---
function renderInfos() {
    const list = document.getElementById('infos-list');
    list.innerHTML = '';

    const iconsMap = {
        "urgence": '<i class="fa-solid fa-phone"></i>',
        "hôtel": '<i class="fa-solid fa-bed"></i>',
        "pass": '<i class="fa-solid fa-train"></i>',
        "wifi": '<i class="fa-solid fa-wifi"></i>'
    };

    appData.infos.forEach(info => {
        let currentIcon = '<i class="fa-solid fa-circle-info"></i>';
        const lowerTitle = info.titre.toLowerCase();

        for (const [key, icon] of Object.entries(iconsMap)) {
            if (lowerTitle.includes(key)) {
                currentIcon = icon;
                break;
            }
        }

        list.innerHTML += `
            <div class="card">
                    <button class="delete-btn" ${actionAttrs('deleteItem', ['infos', info.id])} aria-label="Supprimer cette information"><i class="fa-solid fa-xmark"></i></button>
                <div class="card-header-row" style="margin-bottom: 12px;">
                    <div class="card-title-group">
                        <div class="card-icon" style="background-color: #fcebeb; color: var(--accent);">${currentIcon}</div>
                        <div class="card-title" style="font-size: 1.2rem;">${esc(info.titre)}</div>
                    </div>
                </div>
                <div style="font-size: 0.95rem; line-height: 1.5; color: #444; white-space: pre-line; font-weight: 500;">${esc(info.desc)}</div>
                <div style="text-align:right; margin-top: 10px;">
                    <button ${actionAttrs('openEditInfoModal', [info.id])} class="details-link" style="border: 1.5px solid var(--accent-primary); border-radius: 20px; padding: 6px 16px;">
                        <i class="fa-solid fa-pen-to-square"></i> Modifier
                    </button>
                </div>
            </div>
        `;
    });

    populateHotelMapSelect();
    populateItineraryMapSelect();
}

function openAddInfoModal() {
    document.getElementById('info-modal-title').innerText = "Ajouter une info utile";
    document.getElementById('info-edit-id').value = '';
    document.getElementById('info-title').value = '';
    document.getElementById('info-desc').value = '';
    openModal('modal-infos');
}

function openEditInfoModal(id) {
    const info = appData.infos.find(i => i.id === id);
    if (!info) return;
    document.getElementById('info-modal-title').innerText = "Modifier l'info";
    document.getElementById('info-edit-id').value = info.id;
    document.getElementById('info-title').value = info.titre || '';
    document.getElementById('info-desc').value = info.desc || '';
    openModal('modal-infos');
}

// --- CARTE & ADRESSES (sans clé API — iframe Google Maps publique) ---
let mapOrigin = '';
let mapOriginLink = '';
let mapDestination = '';
let mapDestinationLink = '';

function buildMapEmbedUrl(query) {
    return `https://www.google.com/maps?q=${encodeURIComponent(query)}&output=embed`;
}

function buildRouteEmbedUrl(origin, destination) {
    // dirflg=w force l'affichage à pied plutôt qu'en voiture par défaut
    return `https://www.google.com/maps?saddr=${encodeURIComponent(origin)}&daddr=${encodeURIComponent(destination)}&dirflg=w&output=embed`;
}

function buildDirectionsUrl(destination, origin) {
    let url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=walking`;
    if (origin) url += `&origin=${encodeURIComponent(origin)}`;
    return url;
}

// Essaie d'extraire des coordonnées GPS d'un lien Google Maps déjà collé
// (ex: .../@34.6656,135.5006,17z/... ou !3d..!4d.. ou ?q=lat,lng), ou de
// coordonnées collées telles quelles (ex: copiées via "Copier les
// coordonnées" dans l'appli Maps), pour pointer sur le lieu exact plutôt
// que de re-chercher par son nom. Les liens raccourcis (maps.app.goo.gl)
// ne contiennent aucune coordonnée exploitable côté client : impossible
// à éviter sans passer par un serveur qui suit la redirection.
function extractLatLng(mapsUrl) {
    if (!mapsUrl) return null;
    const trimmed = String(mapsUrl).trim();
    const patterns = [
        /@(-?\d+\.\d+),(-?\d+\.\d+)/,
        /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/,
        /[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/,
        /^(-?\d{1,3}\.\d+),\s*(-?\d{1,3}\.\d+)$/
    ];
    for (const pattern of patterns) {
        const m = trimmed.match(pattern);
        const lat = m && parseFloat(m[1]);
        const lng = m && parseFloat(m[2]);
        if (m && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
            return `${m[1]},${m[2]}`;
        }
    }
    return null;
}

// Construit un lien "ouvrir dans Maps" cliquable à partir d'un champ
// lien/coordonnées : un vrai lien collé est utilisé tel quel, des
// coordonnées collées (ex: 34.9671, 135.7727) sont transformées en lien
// d'itinéraire Google Maps valide plutôt que d'être ignorées.
function mapsOpenLink(value) {
    const url = safeUrl(value);
    if (url) return url;
    const coords = extractLatLng(value);
    return coords ? esc(buildDirectionsUrl(coords)) : '';
}

// Recalcule la carte : trajet si hôtel + destination sont choisis,
// sinon un simple point, sinon une carte de recherche neutre. Pour un
// point unique, le bouton "Itinéraire" ouvre le lien Maps exact
// enregistré plutôt qu'une recherche par nom, s'il existe.
function isShortMapsLink(url) {
    return /^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps)\//i.test(String(url || '').trim());
}

// Déplie un lien Google Maps raccourci (maps.app.goo.gl) via un proxy
// public pour en extraire les coordonnées exactes : le site n'a pas de
// serveur pour suivre lui-même la redirection (choix volontaire, pas de
// clé API/facturation Google). Best-effort — si le proxy est indisponible
// ou trop lent, on reste sur la recherche par nom déjà utilisée.
const resolvedLinkCache = {};
async function resolveShortLink(url) {
    const key = String(url || '').trim();
    if (!key) return null;
    if (key in resolvedLinkCache) return resolvedLinkCache[key];
    try {
        const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(key)}`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 6000);
        const res = await fetch(proxyUrl, { signal: controller.signal });
        clearTimeout(timeout);
        if (!res.ok) throw new Error('proxy error');
        const data = await res.json();
        // maps.app.goo.gl est un Firebase Dynamic Link : la redirection finale
        // n'est pas toujours un simple 3xx HTTP (souvent une page intermédiaire
        // qui redirige en JS). On essaie donc d'abord l'URL finale suivie par le
        // proxy, puis en repli on cherche des coordonnées directement dans le
        // HTML de cette page (souvent présentes dans un lien de secours ou une
        // balise meta destinée aux robots/navigateurs sans JS).
        const finalUrl = data && data.status && data.status.url;
        const coords = extractLatLng(finalUrl) || extractLatLng(data && data.contents);
        resolvedLinkCache[key] = coords;
        return coords;
    } catch (e) {
        resolvedLinkCache[key] = null;
        return null;
    }
}

function setMapResolvingHint(visible) {
    const hint = document.getElementById('map-resolving-hint');
    if (hint) hint.style.display = visible ? '' : 'none';
}

function refreshMapEmbed() {
    const iframe = document.getElementById('map-embed-iframe');
    const link = document.getElementById('map-directions-link');
    if (!iframe) return;

    if (mapOrigin && mapDestination) {
        iframe.src = buildRouteEmbedUrl(mapOrigin, mapDestination);
        if (link) link.href = buildDirectionsUrl(mapDestination, mapOrigin);
    } else if (mapDestination) {
        iframe.src = buildMapEmbedUrl(mapDestination);
        if (link) link.href = mapDestinationLink || buildDirectionsUrl(mapDestination);
    } else if (mapOrigin) {
        iframe.src = buildMapEmbedUrl(mapOrigin);
        if (link) link.href = mapOriginLink || buildDirectionsUrl(mapOrigin);
    } else {
        iframe.src = buildMapEmbedUrl('');
        if (link) link.href = '#';
    }
}

function updateMapFromHotelSelect() {
    const select = document.getElementById('map-hotel-select');
    const opt = select && select.selectedIndex >= 0 ? select.options[select.selectedIndex] : null;
    mapOrigin = select ? select.value : '';
    mapOriginLink = opt ? (opt.dataset.link || '') : '';
    refreshMapEmbed();
    resolveSelectedLinkIfNeeded(select, opt, coords => { mapOrigin = coords; refreshMapEmbed(); });
}

function updateMapFromItinerarySelect() {
    const select = document.getElementById('map-itinerary-select');
    const opt = select && select.selectedIndex >= 0 ? select.options[select.selectedIndex] : null;
    mapDestination = select ? select.value : '';
    mapDestinationLink = opt ? (opt.dataset.link || '') : '';
    refreshMapEmbed();
    resolveSelectedLinkIfNeeded(select, opt, coords => { mapDestination = coords; refreshMapEmbed(); });
}

// Si l'option choisie a un lien raccourci non résolu, tente de récupérer
// les coordonnées exactes en arrière-plan et met à jour la carte une fois
// trouvées (sans bloquer l'affichage immédiat par recherche de nom). Ignore
// le résultat si l'utilisateur a changé de sélection entre-temps.
function resolveSelectedLinkIfNeeded(select, opt, applyCoords) {
    if (!opt || !opt.dataset.link || !isShortMapsLink(opt.dataset.link)) return;
    if (extractLatLng(opt.dataset.link)) return;
    const key = opt.dataset.link.trim();
    const stillSelected = () => select && select.options[select.selectedIndex] === opt;
    if (key in resolvedLinkCache) {
        if (resolvedLinkCache[key] && stillSelected()) applyCoords(resolvedLinkCache[key]);
        return;
    }
    setMapResolvingHint(true);
    resolveShortLink(opt.dataset.link).then(coords => {
        setMapResolvingHint(false);
        if (coords && stillSelected()) applyCoords(coords);
    });
}

function populateHotelMapSelect() {
    const select = document.getElementById('map-hotel-select');
    if (!select) return;
    const previousProgId = select.selectedIndex >= 0 ? select.options[select.selectedIndex].dataset.progId : '';

    let html = '<option value="">-- Choisir une destination --</option>';
    (appData.programme || []).forEach(prog => {
        const nameQuery = `${prog.hotel}, ${prog.ville}`;
        const query = extractLatLng(prog.maps) || nameQuery;
        const rawLink = safeUrl(prog.maps);
        html += `<option value="${esc(query)}" data-link="${rawLink}" data-prog-id="${prog.id}">${esc(prog.ville)} — ${esc(prog.hotel)}</option>`;
    });
    select.innerHTML = html;

    const matchIndex = [...select.options].findIndex(o => o.dataset.progId === previousProgId && previousProgId);
    if (matchIndex >= 0) {
        select.selectedIndex = matchIndex;
    } else if (!mapOrigin && appData.programme && appData.programme.length > 0) {
        select.selectedIndex = 1;
    }
    updateMapFromHotelSelect();
}

// Liste toutes les activités déjà renseignées dans Itinéraire (avec heure et
// journée) pour pouvoir choisir directement une destination sans la retaper.
// Utilise le lien Google Maps propre à l'activité quand il existe.
function populateItineraryMapSelect() {
    const select = document.getElementById('map-itinerary-select');
    if (!select) return;
    const previousValue = select.value;

    let html = '<option value="">-- Choisir une activité --</option>';
    (appData.programme || []).forEach(prog => {
        const activites = (prog.activites || [])
            .filter(act => mapsOpenLink(act.lien)) // uniquement les activités avec un lien Maps ou des coordonnées renseignés
            .slice().sort((a, b) => (a.date + ' ' + a.heure).localeCompare(b.date + ' ' + b.heure));
        activites.forEach(act => {
            const query = extractLatLng(act.lien) || `${act.texte}, ${prog.ville}`;
            const rawLink = safeUrl(act.lien);
            html += `<option value="${esc(query)}" data-link="${rawLink}">${esc(prog.ville)} · ${esc(act.date)} ${esc(act.heure)} — ${esc(act.texte)}</option>`;
        });
    });
    select.innerHTML = html;

    if (previousValue && [...select.options].some(o => o.value === previousValue)) {
        select.value = previousValue;
        mapDestinationLink = select.options[select.selectedIndex].dataset.link || '';
    }
}

// --- BILLETS & TICKETS ---
function renderBillets() {
    const list = document.getElementById('billets-list');
    if (!list) return;
    list.innerHTML = '';

    if (!appData.billets || appData.billets.length === 0) {
        list.innerHTML = `<p style="color: var(--text-muted); font-size: 0.9rem; padding: 4px 5px 10px;">Aucun billet enregistré pour l'instant.</p>`;
        return;
    }

    appData.billets.forEach(billet => {
        const lienUrl = safeUrl(billet.lien);
        const lienHtml = lienUrl ? `<a href="${lienUrl}" target="_blank" rel="noopener" style="color: var(--accent-primary); font-weight:600; text-decoration:underline;">Ouvrir le billet</a>` : '';
        list.innerHTML += `
            <div class="card">
                    <button class="delete-btn" ${actionAttrs('deleteItem', ['billets', billet.id])} aria-label="Supprimer cette réservation"><i class="fa-solid fa-xmark"></i></button>
                <div class="card-header-row" style="margin-bottom: 10px;">
                    <div class="card-title-group">
                        <div class="card-icon" style="background-color: #fcebeb; color: var(--accent);"><i class="fa-solid fa-ticket"></i></div>
                        <div>
                            <div class="card-title" style="font-size: 1.1rem;">${esc(billet.nom)}</div>
                            ${billet.reference ? `<div class="card-subtitle">Réf. ${esc(billet.reference)}</div>` : ''}
                        </div>
                    </div>
                    ${billet.date ? `<span class="card-date">${esc(billet.date)}</span>` : ''}
                </div>
                ${billet.notes ? `<div style="font-size: 0.9rem; line-height: 1.5; color: #444; white-space: pre-line; margin-bottom: 8px;">${esc(billet.notes)}</div>` : ''}
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    ${lienHtml || '<span></span>'}
                    <button ${actionAttrs('openEditBilletModal', [billet.id])} aria-label="Modifier cette réservation" style="background:none; border:none; color:#bbb; cursor:pointer; font-size:0.95rem;"><i class="fa-solid fa-pen-to-square"></i></button>
                </div>
            </div>
        `;
    });
}

function openAddBilletModal() {
    document.getElementById('billet-modal-title').innerText = "Ajouter un billet";
    document.getElementById('billet-edit-id').value = '';
    document.getElementById('billet-nom').value = '';
    document.getElementById('billet-date').value = '';
    document.getElementById('billet-reference').value = '';
    document.getElementById('billet-lien').value = '';
    document.getElementById('billet-notes').value = '';
    openModal('modal-billet');
}

function openEditBilletModal(id) {
    const billet = appData.billets.find(b => b.id === id);
    if (!billet) return;
    document.getElementById('billet-modal-title').innerText = "Modifier le billet";
    document.getElementById('billet-edit-id').value = billet.id;
    document.getElementById('billet-nom').value = billet.nom || '';
    document.getElementById('billet-date').value = billet.date || '';
    document.getElementById('billet-reference').value = billet.reference || '';
    document.getElementById('billet-lien').value = billet.lien || '';
    document.getElementById('billet-notes').value = billet.notes || '';
    openModal('modal-billet');
}

function saveBillet() {
    if (!requireEditor()) return;
    const editId = document.getElementById('billet-edit-id').value;
    const nom = document.getElementById('billet-nom').value.trim();
    const date = dateToStoredValue(document.getElementById('billet-date').value);
    const reference = document.getElementById('billet-reference').value.trim();
    const lien = document.getElementById('billet-lien').value.trim();
    const notes = document.getElementById('billet-notes').value.trim();
    if (!nom) return;
    if (!appData.billets) appData.billets = [];

    if (editId) {
        const billet = appData.billets.find(b => b.id === parseInt(editId));
        if (billet) {
            billet.nom = nom;
            billet.date = date;
            billet.reference = reference;
            billet.lien = lien;
            billet.notes = notes;
        }
    } else {
        appData.billets.push({ id: Date.now(), nom: nom, date: date, reference: reference, lien: lien, notes: notes });
    }

    saveToLocalStorage();
    renderBillets();
    closeModal('modal-billet');
}

function saveInfo() {
    if (!requireEditor()) return;
    const editId = document.getElementById('info-edit-id').value;
    const titre = document.getElementById('info-title').value.trim();
    const desc = document.getElementById('info-desc').value.trim();
    if (!titre) return;

    if (editId) {
        const info = appData.infos.find(i => i.id === parseInt(editId));
        if (info) {
            info.titre = titre;
            info.desc = desc;
        }
    } else {
        appData.infos.push({ id: Date.now(), titre: titre, desc: desc });
    }
    saveToLocalStorage();
    renderInfos();

    document.getElementById('info-edit-id').value = '';
    document.getElementById('info-title').value = '';
    document.getElementById('info-desc').value = '';
    closeModal('modal-infos');
}

function deleteItem(category, id) {
    if (!requireEditor()) return;
    if (confirm("Voulez-vous vraiment supprimer cet élément ?")) {
        appData[category] = appData[category].filter(item => item.id !== id);
        saveToLocalStorage();

        if (category === 'programme') {
            // Also delete the day's checklist
            if (appData.checklistsJour && appData.checklistsJour[id]) {
                delete appData.checklistsJour[id];
            }
            // If currently viewing this day, switch back to voyage
            const checklistScopeRemoved = currentChecklistScope === id;
            if (checklistScopeRemoved) {
                currentChecklistScope = 'voyage';
                currentChecklistFilter = 'all';
                currentChecklistSearch = '';
            }
            buildChecklistSelector();
            renderChecklist();
            renderProgramme();
        }
        if (category === 'checklist') {
            renderChecklist();
            updateChecklistAddFloat();
        }
        if (category === 'budget') updateBudgetUI();
        if (category === 'infos') renderInfos();
        if (category === 'billets') renderBillets();
    }
}

// ================= SAVE ACTIONS =================

function itineraryDatesBetween(startValue, endValue) {
    const start = parsePickerDate(startValue);
    const end = parsePickerDate(endValue);
    if (!start || !end) return [];

    const first = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    let last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    if (last < first && last.getMonth() < first.getMonth()) last.setFullYear(last.getFullYear() + 1);
    if (last < first || (last - first) / 86400000 > 60) return [];

    const dates = [];
    for (const day = new Date(first); day <= last; day.setDate(day.getDate() + 1)) {
        dates.push(dateToStoredValue(dateToPickerValue(day)));
    }
    return dates;
}

function saveProgramme() {
    if (!requireEditor()) return;
    const editId = document.getElementById('prog-edit-id').value;
    const ville = document.getElementById('prog-ville').value;
    const hotel = document.getElementById('prog-hotel').value;
    const dateStart = dateToStoredValue(document.getElementById('prog-date-start').value);
    const dateEnd = dateToStoredValue(document.getElementById('prog-date-end').value);
    const maps = document.getElementById('prog-maps').value;

    if (ville && hotel && dateStart && dateEnd) {
        if (editId) {
            const item = appData.programme.find(p => p.id === parseInt(editId));
            if (item) {
                item.ville = ville;
                item.hotel = hotel;
                item.dateStart = dateStart;
                item.dateEnd = dateEnd;
                item.maps = maps;
                if (!(item.jours || []).length) item.jours = itineraryDatesBetween(dateStart, dateEnd);
            }
        } else {
            const jours = itineraryDatesBetween(dateStart, dateEnd);
            appData.programme.push({
                id: Date.now(),
                ville: ville,
                hotel: hotel,
                dateStart: dateStart,
                dateEnd: dateEnd,
                maps: maps,
                jours,
                activites: []
            });
        }

        saveToLocalStorage();
        const savedProgramme = editId ? appData.programme.find(item => item.id === parseInt(editId)) : appData.programme[appData.programme.length - 1];
        if (savedProgramme) {
            selectedItineraryProgrammeId = savedProgramme.id;
            if (!(savedProgramme.id in selectedItineraryDayByProgramme)) {
                selectedItineraryDayByProgramme[savedProgramme.id] = bestItineraryDay(savedProgramme);
            }
        }
        buildChecklistSelector();
        renderProgramme();
        closeModal('modal-programme');
    }
}

function initializeApp() {
    document.body.dataset.page = 'accueil';
    document.body.classList.add('is-editor');
    applyAppearancePreferences();
    if (DEMO_PREVIEW) {
        document.body.classList.add('demo-preview');
        document.getElementById('demo-banner')?.removeAttribute('hidden');
    }
    updateCountdown();
    renderTodayCard();
    renderVols();
    renderTransports();
    renderProgramme();
    buildChecklistSelector();
    renderChecklist();
    updateBudgetUI();
    renderDashboardSummary();
    renderInfos();
    renderBillets();
    fetchExchangeRate();
    // Affiche ou masque le bouton selon la portée de la checklist
    updateChecklistAddFloat();
}

document.addEventListener('DOMContentLoaded', initializeApp, { once: true });

function updateChecklistAddFloat() {
    const btn = document.getElementById('checklist-add-float');
    if (btn) {
        btn.style.display = currentChecklistScope === 'voyage' ? '' : 'none';
    }
}

function actionAttrs(action, args = [], options = {}) {
    const attributes = [
        `data-action="${esc(action)}"`,
        `data-action-args="${esc(JSON.stringify(args))}"`
    ];
    if (options.event) attributes.push(`data-action-event="${esc(options.event)}"`);
    if (options.target) attributes.push('data-action-target');
    if (options.value) attributes.push('data-action-value');
    if (options.eventObject) attributes.push('data-action-event-object');
    if (options.preventDefault) attributes.push('data-action-prevent-default');
    return attributes.join(' ');
}

function datePickerPairHtml(id, value = '', placeholder = 'Ex. : 16 avr.') {
    const pickerId = `${id}-picker`;
    return `<div class="picker-pair date-picker-pair compact">
        <input type="text" id="${esc(id)}" value="${esc(value)}" placeholder="${esc(placeholder)}" aria-label="Saisir une date" data-action="syncDateText" data-action-event="input" data-action-target data-date-picker="${esc(pickerId)}">
        <label class="picker-companion"><span>Choisir</span><input type="date" id="${esc(pickerId)}" data-action="syncDatePicker" data-action-event="change" data-action-target data-date-text="${esc(id)}" aria-label="Choisir une date"></label>
    </div>`;
}

function timePickerPairHtml(id, value = '', placeholder = '09:15') {
    const pickerId = `${id}-picker`;
    return `<div class="picker-pair time-picker-pair compact">
        <input type="text" id="${esc(id)}" value="${esc(value)}" placeholder="${esc(placeholder)}" aria-label="Saisir une heure" data-action="syncTimeText" data-action-event="input" data-action-target data-time-picker="${esc(pickerId)}">
        <label class="picker-companion"><span>Choisir</span><input type="time" id="${esc(pickerId)}" data-action="syncTimePicker" data-action-event="change" data-action-target data-time-text="${esc(id)}" aria-label="Choisir une heure"></label>
    </div>`;
}

function handleBudgetPersonEnter(event) {
    if (event.key === 'Enter') {
        event.preventDefault();
        addBudgetPerson();
    }
}

function handleGlobalKeydown(event) {
    if (event.key !== 'Escape') return;
    const modal = document.querySelector('.modal.active');
    if (modal) closeModal(modal.id);
}

function chooseAddType(type) {
    closeModal('modal-choose-type');
    if (type === 'vol') openAddVolModal();
    else openAddTransportModal();
}

function chooseAddInfoType(type) {
    closeModal('modal-choose-info-type');
    if (type === 'info') openAddInfoModal();
    else openAddBilletModal();
}

// All UI actions are routed through one delegated listener. No HTML expression
// is evaluated; each action is looked up in this explicit allowlist.
const ACTIONS = {
    updateCurrencyConverter,
    swapCurrencies,
    setBudgetBaseCurrency,
    setTravelBackground,
    setVisualTheme,
    setMotionPreference,
    resetAppearance,
    syncDateText,
    syncDatePicker,
    syncTimeText,
    syncTimePicker,
    // Shared navigation and dialogs
    switchDashboardTab,
    switchTab,
    openEditTripModal,
    saveTripDates,
    closeModal,
    saveChecklist,
    updateChecklistScopeVisibility,
    saveProgramme,
    openModal,
    chooseAddType,
    chooseAddInfoType,
    parseVolPasteText,
    searchFlightByNumber,
    selectFlightLookupResult,
    addBudgetPerson,
    handleBudgetPersonEnter,
    updateMapFromHotelSelect,
    updateMapFromItinerarySelect,
    // Flights and other transport
    toggleVolExpand,
    openAddVolModal,
    openEditVolModal,
    saveVol,
    deleteVol,
    toggleTransportExpand,
    openAddTransportModal,
    openEditTransportModal,
    saveTransport,
    deleteTransport,
    // Itinerary and checklists
    openAddProgrammeModal,
    openEditProgrammeModal,
    selectItineraryDestination,
    selectItineraryDay,
    addDayToDestination,
    deleteDay,
    startEditDay,
    cancelEditDay,
    saveEditDay,
    addInlineDayActivite,
    deleteDayActivite,
    startEditActivite,
    cancelEditActivite,
    saveEditActivite,
    addJourCheckItemGlobal,
    switchChecklistScope,
    switchChecklistFilter,
    setChecklistSearch,
    resetChecklistFilters,
    toggleChecklistCategory,
    handleChecklistEnter,
    toggleCheck,
    toggleCheckJour,
    deleteItemJour,
    // Budget, notes and reservations
    updateBudgetUI,
    removeBudgetPersonAt,
    toggleBudPayeurAt,
    openAddBudgetModal,
    openEditBudgetModal,
    toggleBudgetPaid,
    saveBudget,
    openAddInfoModal,
    openEditInfoModal,
    openAddBilletModal,
    openEditBilletModal,
    saveBillet,
    saveInfo,
    exportTripBackup,
    importTripBackup,
    deleteItem,
};

function dispatchAction(event, control) {
    const handler = ACTIONS[control.dataset.action];
    if (typeof handler !== 'function') return;

    let args = [];
    try { args = JSON.parse(control.dataset.actionArgs || '[]'); }
    catch { return; }
    if (control.hasAttribute('data-action-target')) args.push(control);
    if (control.hasAttribute('data-action-value')) args.push(control.value);
    if (control.hasAttribute('data-action-event-object')) args.push(event);
    if (control.hasAttribute('data-action-prevent-default')) event.preventDefault();
    handler(...args);
}

for (const eventType of ['click', 'change', 'input', 'keydown']) {
    document.addEventListener(eventType, event => {
        const origin = event.target instanceof Element ? event.target : event.target?.parentElement;
        const control = origin?.closest('[data-action]');
        if (!control) return;
        if (event.type === 'keydown' && control.hasAttribute('data-action-keyboard')) {
            if (event.key === 'Enter' || event.key === ' ') dispatchAction(event, control);
            return;
        }
        if ((control.dataset.actionEvent || 'click') !== event.type) return;
        if (event.type === 'click') {
            const nestedInteractive = origin.closest('a, button, input, select, textarea, [contenteditable="true"]');
            if (nestedInteractive && nestedInteractive !== control && control.contains(nestedInteractive) && !nestedInteractive.hasAttribute('data-action')) return;
        }
        dispatchAction(event, control);
    });
}

document.addEventListener('keydown', event => {
    handleGlobalKeydown(event);
    if (event.key !== 'Tab') return;
    const modal = document.querySelector('.modal.active');
    if (!modal) return;
    const focusable = [...modal.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
        .filter(element => element.getClientRects().length > 0);
    if (!focusable.length) { event.preventDefault(); modal.focus(); return; }
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});
document.addEventListener('click', event => {
    if (event.target instanceof Element && event.target.classList.contains('modal')) closeModal(event.target.id);
});
