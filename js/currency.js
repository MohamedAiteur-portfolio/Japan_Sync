const CACHE_KEY = 'voyage_currency_rates';
const FALLBACK_CURRENCIES = ['EUR', 'USD', 'JPY', 'GBP', 'CHF', 'CAD', 'AUD', 'CNY', 'INR', 'MXN', 'BRL', 'SGD', 'THB', 'KRW', 'MAD', 'XOF'];
const RATES_URL = 'https://open.er-api.com/v6/latest/EUR';
const CACHE_MAX_AGE = 24 * 60 * 60 * 1000;

let rates = { EUR: 1 };
let updatedAt = null;
let fetchedAt = null;
let getAppData = () => ({ budgetCurrency: 'EUR' });
let requireEditor = () => false;
let saveAppData = () => {};
let refreshBudget = () => {};
let refreshDashboard = () => {};

try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (cached?.rates) {
        rates = cached.rates;
        updatedAt = cached.updatedAt || null;
        fetchedAt = cached.fetchedAt || cached.updatedAt || null;
    }
} catch {
    // Storage can be unavailable in private or restricted browser contexts.
}

export function configureCurrency(dependencies) {
    getAppData = dependencies.getAppData;
    requireEditor = dependencies.requireEditor;
    saveAppData = dependencies.saveAppData;
    refreshBudget = dependencies.refreshBudget;
    refreshDashboard = dependencies.refreshDashboard;
}

function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
}

function currencyLabel(code) {
    try {
        return `${code} · ${new Intl.DisplayNames(['fr'], { type: 'currency' }).of(code)}`;
    } catch {
        return code;
    }
}

function currencyOptionsHTML() {
    const codes = Object.keys(rates).filter(code => /^[A-Z]{3}$/.test(code));
    for (const code of FALLBACK_CURRENCIES) {
        if (!codes.includes(code)) codes.push(code);
    }
    const priority = ['EUR', 'USD', 'GBP', 'JPY'];
    codes.sort((a, b) => {
        const indexA = priority.indexOf(a);
        const indexB = priority.indexOf(b);
        return (indexA < 0 ? 99 : indexA) - (indexB < 0 ? 99 : indexB) || a.localeCompare(b);
    });
    return codes.map(code => `<option value="${code}">${escapeHTML(currencyLabel(code))}</option>`).join('');
}

export function populateCurrencySelectors() {
    const appData = getAppData();
    const baseCurrency = appData.budgetCurrency || 'EUR';
    const defaults = {
        'currency-from': 'EUR',
        'currency-to': 'USD',
        'budget-base-currency': baseCurrency,
        'bud-currency': baseCurrency
    };

    for (const [id, defaultValue] of Object.entries(defaults)) {
        const select = document.getElementById(id);
        if (!select) continue;
        const previousValue = select.dataset.ready === 'true' ? select.value : defaultValue;
        select.innerHTML = currencyOptionsHTML();
        if (select.querySelector(`option[value="${previousValue}"]`)) select.value = previousValue;
        select.dataset.ready = 'true';
    }

    const baseSelect = document.getElementById('budget-base-currency');
    if (baseSelect) baseSelect.value = baseCurrency;
    const expenseSelect = document.getElementById('bud-currency');
    if (expenseSelect && !expenseSelect.value) expenseSelect.value = baseCurrency;
    updateCurrencyConverter();
}

export function convertCurrency(amount, from, to) {
    if (from === to) return amount;
    const sourceRate = Number(rates[from]);
    const targetRate = Number(rates[to]);
    if (!sourceRate || !targetRate) return null;
    return (amount / sourceRate) * targetRate;
}

export function formatCurrency(amount, currency) {
    if (amount === null || !Number.isFinite(amount)) return '—';
    try {
        return new Intl.NumberFormat('fr-FR', {
            style: 'currency', currency, maximumFractionDigits: 2
        }).format(amount);
    } catch {
        return `${amount.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} ${currency}`;
    }
}

export function updateCurrencyConverter() {
    const amount = Number.parseFloat(document.getElementById('currency-amount')?.value) || 0;
    const from = document.getElementById('currency-from')?.value || 'EUR';
    const to = document.getElementById('currency-to')?.value || 'USD';
    const converted = convertCurrency(amount, from, to);
    const result = document.getElementById('currency-result');
    if (result) {
        result.textContent = `${formatCurrency(converted, to)}${converted === null ? ' · taux indisponible hors ligne' : ''}`;
    }
}

export function swapCurrencies() {
    const from = document.getElementById('currency-from');
    const to = document.getElementById('currency-to');
    if (!from || !to) return;
    [from.value, to.value] = [to.value, from.value];
    updateCurrencyConverter();
}

export function setBudgetBaseCurrency(currency) {
    if (!requireEditor()) {
        const select = document.getElementById('budget-base-currency');
        if (select) select.value = getAppData().budgetCurrency || 'EUR';
        return;
    }
    getAppData().budgetCurrency = currency;
    saveAppData();
    refreshBudget();
    refreshDashboard();
}

function displayUpdatedTime(value, includeTime = true) {
    if (!value) return '';
    const options = includeTime ? { dateStyle: 'short', timeStyle: 'short' } : { dateStyle: 'short' };
    return new Date(value).toLocaleString('fr-FR', options);
}

export async function fetchExchangeRate() {
    const dot = document.getElementById('rate-dot');
    const text = document.getElementById('rate-text');
    populateCurrencySelectors();

    const cacheAge = fetchedAt ? Date.now() - new Date(fetchedAt).getTime() : Infinity;
    if (updatedAt && cacheAge < CACHE_MAX_AGE) {
        if (text) text.textContent = `Taux indicatifs · ${displayUpdatedTime(updatedAt)}`;
        if (dot) { dot.classList.remove('updating'); dot.style.backgroundColor = '#72aa51'; }
        refreshBudget();
        refreshDashboard();
        return;
    }

    if (dot) dot.classList.add('updating');
    if (updatedAt && text) text.textContent = `Taux en cache · ${displayUpdatedTime(updatedAt, false)}`;

    try {
        const response = await fetch(RATES_URL, { headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error(`Exchange rate request failed: ${response.status}`);
        const payload = await response.json();
        if (payload?.result !== 'success' || !payload.rates) throw new Error('Exchange rates unavailable');

        rates = { ...payload.rates, EUR: 1 };
        updatedAt = payload.time_last_update_utc || new Date().toISOString();
        fetchedAt = new Date().toISOString();
        try { localStorage.setItem(CACHE_KEY, JSON.stringify({ rates, updatedAt, fetchedAt })); }
        catch { /* Keep the current session usable when storage is full or blocked. */ }

        if (text) text.textContent = `Taux indicatifs · ${displayUpdatedTime(updatedAt)}`;
        if (dot) { dot.classList.remove('updating'); dot.style.backgroundColor = '#72aa51'; }
        populateCurrencySelectors();
        refreshBudget();
        refreshDashboard();
    } catch {
        if (text) text.textContent = updatedAt
            ? `Taux en cache · ${displayUpdatedTime(updatedAt, false)}`
            : 'Taux indisponibles · connexion requise';
        if (dot) {
            dot.classList.remove('updating');
            dot.style.backgroundColor = updatedAt ? '#d6a13b' : '#e60012';
        }
    }
}
