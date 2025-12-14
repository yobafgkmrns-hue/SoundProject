/* /home/obafgk/SoundProject/metriful_web/static/js/main_v2.js */

console.log("🚀 Démarrage main_v2.js (Version Finale V2.1)...");

// --- VARIABLES GLOBALES ---
let charts = {};
let currentPeriod = '24h';
let currentData = {};
let wavesurfer = null;
let previousKPIs = {};
let isAutoPlay = false;

// Variables pour le clignotement
let flashTargetTime = 0;
let flashState = false;
let flashTimer = null;
let flashTargetDbLabel = "";

// --- PLUGIN CHART.JS : AFFICHER VALEURS SUR BARRES ---
const valueLabelPlugin = {
    id: 'valueLabel',
    afterDatasetsDraw: (chart) => {
        const ctx = chart.ctx;
        chart.data.datasets.forEach((dataset, i) => {
            const meta = chart.getDatasetMeta(i);
            meta.data.forEach((bar, index) => {
                const value = dataset.data[index];
                if (value > 0) {
                    ctx.fillStyle = '#fff';
                    ctx.font = 'bold 12px "Source Sans Pro"';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'bottom';
                    ctx.fillText(value, bar.x, bar.y - 5);
                }
            });
        });
    }
};

const eventStyles = {
    'Sirène': { color: '#dd4b39', style: 'triangle', size: 8, icon: 'fa-truck-medical', isEmergency: true },
    'Moteur': { color: '#95a5a6', style: 'rect', size: 7, icon: 'fa-motorcycle', isEmergency: false },
    'Voix': { color: '#00c0ef', style: 'circle', size: 6, icon: 'fa-person-walking', isEmergency: false },
    'Musique': { color: '#605ca8', style: 'star', size: 9, icon: 'fa-music', isEmergency: false },
    'Autre': { color: '#ff851b', style: 'rectRot', size: 7, icon: 'fa-car-side', isEmergency: false }
};

const randomVehicles = [
    { icon: 'fa-truck', color: '#7f8c8d' },
    { icon: 'fa-trash-can', color: '#27ae60' },
    { icon: 'fa-bus', color: '#f1c40f' },
    { icon: 'fa-car-side', color: '#ecf0f1' }
];

Chart.defaults.color = '#b8c7ce';
Chart.defaults.scale.grid.color = '#3e3e3e';
Chart.defaults.borderColor = '#3e3e3e';
Chart.defaults.font.size = 15;

// --- INITIALISATION ---
document.addEventListener('DOMContentLoaded', function () {
    const datePicker = document.getElementById('date-picker');
    if (datePicker) datePicker.value = toLocalISOString(new Date());

    console.log("Chargement initial...");

    // Initialisation du titre de la section Historique
    updateSectionTitle('24h');

    // Chargement des données
    fetchDataAndUpdate('24h', null, true);

    const autoPlayToggle = document.getElementById('autoplay-toggle');
    if (autoPlayToggle) {
        autoPlayToggle.addEventListener('change', function () { isAutoPlay = this.checked; });
    }

    document.querySelectorAll('.period-btn').forEach(button => {
        button.addEventListener('click', function () {
            if (document.body.classList.contains('loading')) return;
            currentPeriod = this.dataset.period;
            document.querySelector('.period-btn.active').classList.remove('active');
            this.classList.add('active');

            // Mise à jour du titre lors du clic
            updateSectionTitle(currentPeriod);

            fetchDataAndUpdate(currentPeriod, datePicker.value);
        });
    });

    const validateBtn = document.getElementById('validate-date-btn');
    if (validateBtn) {
        validateBtn.addEventListener('click', () => fetchDataAndUpdate(currentPeriod, datePicker.value));
    }

    // Filtres
    const searchPeriod = document.getElementById('search-events');
    if (searchPeriod) searchPeriod.addEventListener('keyup', () => filterTable('events-period-table', searchPeriod.value));
    const searchTop = document.getElementById('search-top');
    if (searchTop) searchTop.addEventListener('keyup', () => filterTable('top-events-table', searchTop.value));

    // SSE
    const eventSource = new EventSource("/api/stream_events");
    eventSource.onmessage = function (event) {
        if (event.data === "new_event") {
            console.log("🔔 SSE: Nouvel événement !");
            showNotification("🔊 Événement sonore détecté !");
            setTimeout(() => {
                fetchDataAndUpdate(currentPeriod, null, false).then(() => {
                    handleNewEvent();
                });
            }, 1500);
        } else if (event.data === "new_sensor") {
            fetchAndUpdateKPIs();
        }
    };
});

function toLocalISOString(date) { try { const offset = date.getTimezoneOffset() * 60000; return (new Date(date - offset)).toISOString().slice(0, 16); } catch (e) { return ""; } }

// --- MISE À JOUR DU TITRE HISTORIQUE ---
function updateSectionTitle(periodCode) {
    const titleEl = document.getElementById('history-title');
    if (!titleEl) return;
    let text = "Historique";
    switch (periodCode) {
        case '1h': text = "Historique (Dernière Heure)"; break;
        case '24h': text = "Historique (24 Heures)"; break;
        case '7d': text = "Historique (7 Jours)"; break;
        case '30d': text = "Historique (30 Jours)"; break;
        default: text = "Historique";
    }
    titleEl.textContent = text;
}

// --- GESTION ÉVÉNEMENT ---
function handleNewEvent() {
    if (!currentData || !currentData.events_period || currentData.events_period.length === 0) return;
    const latestEvent = currentData.events_period[0];
    triggerVisualAnimation(latestEvent);
    if (isAutoPlay && latestEvent.audio_filename) { playAudio(latestEvent.audio_filename); }
    startFlashingEffect(latestEvent);
}

function startFlashingEffect(event) {
    if (!event.start_time_iso) return;
    flashTargetTime = new Date(event.start_time_iso).getTime();

    // Calcul label dB
    const db = event.peak_spl_dba;
    const BIN_SIZE = 2; const MAX_DB_DISPLAY = 90;
    if (db > MAX_DB_DISPLAY) flashTargetDbLabel = `>${MAX_DB_DISPLAY}`;
    else if (db >= 40) {
        const lower = Math.floor(db / BIN_SIZE) * BIN_SIZE;
        flashTargetDbLabel = `${lower}-${lower + BIN_SIZE}`;
    } else { flashTargetDbLabel = ""; }

    if (flashTimer) clearInterval(flashTimer);
    flashTimer = setInterval(() => {
        flashState = !flashState;
        if (charts['eventsTimelineChart']) charts['eventsTimelineChart'].update('none');
        if (charts['eventsChart']) charts['eventsChart'].update('none');
        if (charts['dbDistributionChart']) charts['dbDistributionChart'].update('none');
    }, 300);

    setTimeout(() => {
        if (flashTimer) clearInterval(flashTimer);
        flashTargetTime = 0; flashTargetDbLabel = ""; flashState = false;
        if (charts['eventsTimelineChart']) charts['eventsTimelineChart'].update('none');
        if (charts['dbDistributionChart']) charts['dbDistributionChart'].update('none');
    }, 6000);
}

// --- VISUEL RUE ---
function triggerVisualAnimation(eventData) {
    if (!eventData) return;
    const dba = eventData.peak_spl_dba || 60;
    const type = eventData.sound_type || 'Autre';
    if (Math.random() < 0.1) { showNoiseScene(); } else { spawnVehicle(type, dba); }
}

function spawnVehicle(eventType, dba) {
    const track = document.getElementById('vehicle-track'); if (!track) return;
    let vehicleConfig = eventStyles[eventType];
    if (!vehicleConfig || eventType === 'Autre') { const randV = randomVehicles[Math.floor(Math.random() * randomVehicles.length)]; vehicleConfig = { icon: randV.icon, color: randV.color, isEmergency: false }; }
    const wrapper = document.createElement('div'); wrapper.className = 'vehicle-wrapper';
    const vehicleIcon = document.createElement('i'); vehicleIcon.className = `fa ${vehicleConfig.icon} moving-vehicle fa-flip-horizontal`; vehicleIcon.style.color = vehicleConfig.color;
    if (vehicleConfig.isEmergency || ['fa-ambulance', 'fa-truck-medical', 'fa-car-side'].includes(vehicleConfig.icon)) { if (Math.random() > 0.5) vehicleIcon.classList.add('emergency-light'); }
    const bubble = document.createElement('div'); bubble.className = 'comic-bubble'; bubble.innerText = Math.round(dba) + " dB";
    let scale = 1 + (Math.max(0, dba - 50) / 50); scale = Math.min(scale, 2.5); bubble.style.transform = `scale(${scale})`;
    wrapper.appendChild(bubble); wrapper.appendChild(vehicleIcon); track.appendChild(wrapper);
    setTimeout(() => { if (track.contains(wrapper)) track.removeChild(wrapper); }, 22000);
}

function showNoiseScene() {
    const street = document.getElementById('street-scene'); const noise = document.getElementById('noise-scene');
    if (!street || !noise) return;
    street.style.display = 'none'; noise.style.display = 'flex';
    setTimeout(() => { street.style.display = 'block'; noise.style.display = 'none'; }, 5000);
}

// --- FETCHING ---
async function fetchDataAndUpdate(period, refDateStr = null, showOverlay = true) {
    if (showOverlay) document.body.classList.add('loading');
    let url = `/api/data?period=${period}&_nocache=${Date.now()}`;
    if (refDateStr) url += `&ref_date=${new Date(refDateStr).toISOString()}`;
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error('Erreur réseau');
        const newData = await response.json();
        currentData = newData;
        updateDashboardUI(newData, period);
    } catch (e) { console.error(e); }
    finally { if (showOverlay) document.body.classList.remove('loading'); }
}

async function fetchAndUpdateKPIs() {
    try {
        const r = await fetch(`/api/data?period=1h&_nocache=${Date.now()}`);
        if (!r.ok) return;
        const d = await r.json();
        currentData.kpis = d.kpis;
        updateKPIs(d.kpis);
        updateLastActivityDisplay({ kpis: d.kpis, events_period: currentData.events_period });
        updateEnvironment(d.kpis);
        updateIndicesTable(d.kpis); // Mise à jour du tableau indices
    } catch (e) { }
}

function updateDashboardUI(data, period) {
    if (!data) return;
    updateLastActivityDisplay(data);
    updateEnvironment(data.kpis);
    updateKPIs(data.kpis);
    updateIndicesTable(data.kpis); // Nouveau tableau
    updateAllCharts(data, period);
    updateEventsTable(data.events_period, 'events-period-table');
    updateEventsTable(data.top_events, 'top-events-table');
}

// --- HEADER & KPI ---
function updateLastActivityDisplay(data) {
    const el = document.getElementById('last-updated'); if (!el) return;
    let latestTime = null;
    if (data.kpis && data.kpis.timestamp) {
        let ts = data.kpis.timestamp; if (ts && typeof ts === 'object' && ts.value) ts = ts.value;
        const t = new Date(ts); if (!isNaN(t)) latestTime = t;
    }
    if (data.events_period && data.events_period.length > 0 && data.events_period[0].start_time_iso) {
        const t = new Date(data.events_period[0].start_time_iso);
        if (!isNaN(t) && (!latestTime || t > latestTime)) latestTime = t;
    }
    if (latestTime) {
        const formatted = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(latestTime);
        el.innerHTML = `<span style="color: #fff; font-weight: bold;">${formatted}</span>`;
    } else { el.innerHTML = "En attente..."; }
}

function updateEnvironment(kpis) {
    const now = new Date(); const hour = now.getHours(); const month = now.getMonth() + 1; const day = now.getDate();
    let isNight = false;
    if (kpis && kpis.light_lux && kpis.light_lux.value != null) isNight = kpis.light_lux.value < 20;
    else isNight = (hour >= 20 || hour < 7);

    const sky = document.getElementById('sky-layer'); const celestial = document.getElementById('celestial-body'); const stage = document.getElementById('animation-stage');
    if (sky && stage) {
        if (isNight) { sky.classList.add('night'); stage.classList.add('night-mode'); if (celestial) celestial.className = 'moon'; }
        else { sky.classList.remove('night'); stage.classList.remove('night-mode'); if (celestial) celestial.className = ''; }
    }
    const weatherLayer = document.getElementById('weather-layer');
    if (weatherLayer && kpis && kpis.pressure_pa && kpis.pressure_pa.value != null) {
        const pressureHpa = kpis.pressure_pa.value / 100;
        if (pressureHpa < 1005) weatherLayer.className = 'rain'; else weatherLayer.className = '';
    }
    const decorLayer = document.getElementById('seasonal-decor');
    if (decorLayer) {
        decorLayer.className = '';
        const isChristmas = (month === 12 && day >= 15 && day <= 26);
        const isNewYear = (month === 12 && day >= 30) || (month === 1 && day <= 2);
        const isBastilleDay = (month === 7 && (day === 13 || day === 14));
        if (isChristmas) decorLayer.className = 'christmas-garland'; else if (isNewYear || isBastilleDay) decorLayer.className = 'new-year-decor';
    }
}

function updateKPIs(kpis) {
    const container = document.getElementById('kpi-container'); if (!container || !kpis) return;
    function generateTrendHTML(kpi_data, period, decimals, transform) {
        let delta = kpi_data[`delta_${period}`]; if (delta === null || delta === undefined) return '';
        if (transform) delta = transform(delta);
        const trendClass = delta > 0 ? 'trend-up' : 'trend-down'; const trendIcon = delta > 0 ? 'fa-arrow-up' : 'fa-arrow-down'; const diffText = `${delta > 0 ? '+' : ''}${delta.toFixed(decimals)}`;
        return `<span class="kpi-long-term-trend ${trendClass}"><i class="fa ${trendIcon}"></i> ${diffText} (${period})</span>`;
    }
    const kpiConfig = [{ key: 'temperature_c', label: 'Temp', icon: 'fa-thermometer-half', color: 'bg-red', unit: ' °C', decimals: 1 }, { key: 'humidity_pct', label: 'Humidité', icon: 'fa-percent', color: 'bg-green', unit: ' %', decimals: 0 }, { key: 'sound_spl_dba', label: 'Son', icon: 'fa-volume-up', color: 'bg-purple', unit: ' dBA', decimals: 1 }, { key: 'light_lux', label: 'Lumière', icon: 'fa-sun', color: 'bg-yellow', unit: ' Lx', decimals: 0 }, { key: 'bsec_co2_ppm', label: 'CO₂', icon: 'fa-cloud', color: 'bg-red', unit: ' ppm', decimals: 0 }, { key: 'aqi', label: 'AQI', icon: 'fa-leaf', color: 'bg-green', unit: '', decimals: 0 }, { key: 'pressure_pa', label: 'Pression', icon: 'fa-tachometer-alt', color: 'bg-aqua', unit: ' hPa', decimals: 0, transform: v => v / 100 }, { key: 'humidex', label: 'Humidex', icon: 'fa-tint', color: 'bg-yellow', unit: '', decimals: 1 }];
    let windowStatus = 'Inconnu'; let windowColor = 'bg-aqua'; if (currentData && currentData.window_status) { const s = currentData.window_status.status; windowStatus = s.charAt(0).toUpperCase() + s.slice(1); windowColor = (s === 'ouverte') ? 'bg-red' : 'bg-green'; }
    container.innerHTML = kpiConfig.map(conf => {
        const kpi_data = kpis[conf.key]; if (!kpi_data) return '';
        let currentValue = kpi_data.value; let prevValRaw = previousKPIs[conf.key]; let previousValue = prevValRaw;
        if (conf.transform) { currentValue = conf.transform(currentValue); if (prevValRaw != null) previousValue = conf.transform(prevValRaw); }
        const formattedValue = formatValue(currentValue, conf.decimals, conf.unit);
        let immediateTrendHTML = '';
        if (previousValue !== undefined && currentValue !== null && previousValue !== null) { const diff = currentValue - previousValue; const threshold = (conf.key === 'pressure_pa') ? 0.5 : 0.05; if (Math.abs(diff) > threshold) { const trendClass = diff > 0 ? 'trend-up' : 'trend-down'; const trendIcon = diff > 0 ? 'fa-arrow-up' : 'fa-arrow-down'; const diffText = `${diff > 0 ? '+' : ''}${diff.toFixed(conf.decimals)}`; immediateTrendHTML = `<span class="kpi-trend ${trendClass}"><i class="fa ${trendIcon}"></i> ${diffText}</span>`; } }
        let displayVal = formattedValue; let displayColor = conf.color; if (conf.isWindow) { displayVal = windowStatus; displayColor = windowColor; }
        return `<div class="col-md-6 col-sm-6 col-xs-12"><div class="info-box"><span class="info-box-icon ${displayColor}"><i class="fa ${conf.icon}"></i></span><div class="info-box-content"><span class="info-box-text">${conf.label}</span><div class="kpi-value-container"><span class="info-box-number">${displayVal}</span>${immediateTrendHTML} ${generateTrendHTML(kpi_data, '24h', conf.decimals, conf.transform)} ${generateTrendHTML(kpi_data, '7d', conf.decimals, conf.transform)} ${generateTrendHTML(kpi_data, '30d', conf.decimals, conf.transform)}</div></div></div></div>`;
    }).join('');
    if (kpis.temperature_c) { previousKPIs = { temperature_c: kpis.temperature_c.value, humidity_pct: kpis.humidity_pct.value, pressure_pa: kpis.pressure_pa.value, aqi: kpis.aqi.value, bsec_co2_ppm: kpis.bsec_co2_ppm.value, light_lux: kpis.light_lux.value, sound_spl_dba: kpis.sound_spl_dba.value }; }
}

// --- CALCULS SCIENTIFIQUES & INDICES ---
function updateIndicesTable(kpis) {
    const tbody = document.querySelector('#indices-table tbody'); if (!tbody || !kpis) return;
    const T = kpis.temperature_c ? kpis.temperature_c.value : null; const RH = kpis.humidity_pct ? kpis.humidity_pct.value : null; const P = kpis.pressure_pa ? kpis.pressure_pa.value : null; const CO2 = kpis.bsec_co2_ppm ? kpis.bsec_co2_ppm.value : null; const Lux = kpis.light_lux ? kpis.light_lux.value : null; const dB = kpis.sound_spl_dba ? kpis.sound_spl_dba.value : 0; const P_delta_24h = kpis.pressure_pa ? kpis.pressure_pa.delta_24h : 0;
    if (T == null || RH == null) { tbody.innerHTML = '<tr><td colspan="7" class="text-center">Données insuffisantes...</td></tr>'; return; }
    const CO2_ext = 420; const es = 6.112 * Math.exp((17.67 * T) / (T + 243.5)); const e = es * (RH / 100.0); const a = 17.27, b = 237.7; const alpha = Math.log(RH / 100) + (a * T) / (b + T); const Td = (b * alpha) / (a - alpha);
    function getHeatIndex(cT, cRH) { if (cT < 27) return cT; const c1 = -8.78469475556, c2 = 1.61139411, c3 = 2.33854883889, c4 = -0.14611605; const c5 = -0.012308094, c6 = -0.0164248277778, c7 = 0.002211732; const c8 = 0.00072546, c9 = -0.000003582; return c1 + c2 * cT + c3 * cRH + c4 * cT * cRH + c5 * cT * cT + c6 * cRH * cRH + c7 * cT * cT * cRH + c8 * cT * cRH * cRH + c9 * cT * cT * cRH * cRH; }
    function getGlobalScore() { let score = 100; score -= Math.abs(T - 21) * 2; score -= Math.abs(RH - 50) * 0.5; if (CO2 > 800) score -= (CO2 - 800) / 20; if (dB > 45) score -= (dB - 45); return Math.max(0, Math.min(100, score)); }
    const rowsData = [
        { category: "Confort Thermique", name: "Humidex", val: T + 0.5555 * (e - 10), unit: "°Indice", formula: "T + 0.55 * (e - 10)", getUi: (v) => { if (v < 30) return ["Confortable", "#00a65a"]; if (v < 40) return ["Inconfort", "#f39c12"]; return ["Danger", "#dd4b39"]; }, range: "<30 OK | >40 Danger" },
        { category: "Confort Thermique", name: "Heat Index (HI)", val: getHeatIndex(T, RH), unit: "°C Ressenti", formula: "NOAA Regression", getUi: (v) => { if (v < 27) return ["Normal", "#00a65a"]; if (v < 32) return ["Prudence", "#f39c12"]; return ["Danger", "#dd4b39"]; }, range: ">32 Danger" },
        { category: "Confort Thermique", name: "Temp. Ressentie", val: T - 0.55 * (1 - RH / 100) * (T - 14.5), unit: "°C", formula: "T - 0.55(1-RH)(T-14.5)", getUi: (v) => { if (Math.abs(v - T) < 1) return ["Proche Réel", "#00a65a"]; return [v > T ? "Plus chaud" : "Plus froid", "#3c8dbc"]; }, range: "Dépend T & RH" },
        { category: "Physique de l'Air", name: "Point de Rosée", val: Td, unit: "°C", formula: "Magnus-Tetens", getUi: (v) => { if ((T - v) < 3) return ["Condensation", "#dd4b39"]; return ["Sec", "#00a65a"]; }, range: "T - Td < 3°C = Risque" },
        { category: "Physique de l'Air", name: "Humidité Absolue", val: (6.112 * Math.exp((17.67 * T) / (T + 243.5)) * RH * 2.1674) / (273.15 + T), unit: "g/m³", formula: "Loi gaz parfaits", getUi: (v) => { if (v < 5) return ["Air sec", "#f39c12"]; if (v > 12) return ["Air humide", "#3c8dbc"]; return ["Confort", "#00a65a"]; }, range: "5-12 g/m³" },
        { category: "Physique de l'Air", name: "Densité Air", val: P / (287.05 * (T + 273.15)), unit: "kg/m³", formula: "P / (R * T)", getUi: (v) => ["Info", "#777"], range: "~1.225 au niveau mer" },
        { category: "Qualité de l'Air", name: "Indice CO₂", val: CO2, unit: "ppm", formula: "Lecture Capteur", getUi: (v) => { if (v < 800) return ["Excellent", "#00a65a"]; if (v < 1200) return ["Moyen", "#f39c12"]; return ["Mauvais", "#dd4b39"]; }, range: "<800 Excellent" },
        { category: "Qualité de l'Air", name: "Confinement", val: (CO2 - CO2_ext) / CO2_ext, unit: "Indice", formula: "(Ci - Ce) / Ce", getUi: (v) => { if (v < 1) return ["Nul", "#00a65a"]; if (v < 2) return ["Faible", "#f39c12"]; return ["Élevé", "#dd4b39"]; }, range: "0-1 OK | >2 Confiné" },
        { category: "Qualité de l'Air", name: "Air Respiré", val: (CO2 > 420) ? (CO2 - 420) / (38000 - 420) * 100 : 0, unit: "%", formula: "Rebreathed Fraction", getUi: (v) => { if (v < 1) return ["Air Frais", "#00a65a"]; if (v < 2.5) return ["Acceptable", "#f39c12"]; return ["Risque Viral", "#dd4b39"]; }, range: ">2% = Aérer" },
        { category: "Végétal / Agri", name: "VPD", val: (es - e) / 10, unit: "kPa", formula: "es - e", getUi: (v) => { if (v < 0.4) return ["Risque Fongique", "#dd4b39"]; if (v >= 0.8 && v <= 1.2) return ["Idéal", "#00a65a"]; return ["Stress Hydrique", "#f39c12"]; }, range: "0.8 - 1.2 kPa" },
        { category: "Végétal / Agri", name: "Photosynthèse", val: (Lux * (CO2 / 400)) / 100, unit: "Score", formula: "Lux * (CO2/Ref)", getUi: (v) => { if (v < 1) return ["Faible", "#777"]; if (v < 10) return ["Moyen", "#f39c12"]; return ["Fort", "#00a65a"]; }, range: ">10 Croissance" },
        { category: "Santé Humaine", name: "Bulbe Humide", val: T * Math.atan(0.151977 * Math.pow(RH + 8.313659, 0.5)) + Math.atan(T + RH) - Math.atan(RH - 1.676331) + 0.00391838 * Math.pow(RH, 1.5) * Math.atan(0.023101 * RH) - 4.686035, unit: "°C Tw", formula: "Stull Formula", getUi: (v) => { if (v < 24) return ["Sûr", "#00a65a"]; if (v < 28) return ["Stress", "#f39c12"]; return ["DANGER MORTEL", "#000"]; }, range: ">31°C = Danger Vie" },
        { category: "Santé Humaine", name: "Perte Cognitive", val: (() => { let l = 0; if (CO2 > 1000) l += (CO2 - 1000) * 0.02; if (T > 24) l += (T - 24) * 1.5; return Math.min(100, l); })(), unit: "%", formula: "CO2 + Chaleur", getUi: (v) => { if (v < 5) return ["Négligeable", "#00a65a"]; return ["Baisse", "#f39c12"]; }, range: "0% Idéal" },
        { category: "Santé Humaine", name: "Intelligibilité", val: dB, unit: "dB Ambiant", formula: "Lecture Micro", getUi: (v) => { if (v < 55) return ["Parole Normale", "#00a65a"]; if (v < 75) return ["Voix Haussée", "#f39c12"]; return ["Crier", "#dd4b39"]; }, range: "<55dB Confort" },
        { category: "Météorologie", name: "Tendance Baro", val: P_delta_24h ? P_delta_24h / 100 : 0, unit: "hPa/24h", formula: "ΔP (24h)", getUi: (v) => { if (v > 1) return ["Amélioration", "#00a65a"]; if (v < -1) return ["Pluie / Vent", "#3c8dbc"]; return ["Stable", "#777"]; }, range: "+/- 1 hPa" },
        { category: "Météorologie", name: "Altitude Est.", val: 44330 * (1 - Math.pow((P / 100) / 1013.25, 0.1903)), unit: "m", formula: "Hypsométrique", getUi: (v) => ["Info", "#777"], range: "Selon P atm" },
        { category: "Météorologie", name: "Luminosité", val: Lux, unit: "Lux", formula: "Capteur", getUi: (v) => v < 20 ? ["NUIT", "#34495e"] : ["JOUR", "#f1c40f"], range: "<20 Lux = Nuit" },
        { category: "Sécurité Bâtiment", name: "Condensation", val: (T - 3) < Td ? 1 : 0, unit: "Booléen", formula: "T_surf < Td", getUi: (v) => v ? ["OUI (Mur froid)", "#dd4b39"] : ["NON", "#00a65a"], range: "Si T_mur < Td" },
        { category: "Sécurité Bâtiment", name: "Conservation", val: RH, unit: "% RH", formula: "Normes Musées", getUi: (v) => { if (v < 40) return ["Dessèchement", "#f39c12"]; if (v > 65) return ["Moisissure", "#dd4b39"]; return ["Stable", "#00a65a"]; }, range: "45-60% Idéal" },
        { category: "SYNTHÈSE", name: "Confort Global", val: getGlobalScore(), unit: "/ 100", formula: "Pondération", getUi: (v) => { if (v > 80) return ["Excellent", "#00a65a"]; if (v > 50) return ["Correct", "#f39c12"]; return ["Médiocre", "#dd4b39"]; }, range: "Objectif 100" }
    ];
    tbody.innerHTML = rowsData.map(row => {
        if (row.val === null) return '';
        const [statusText, statusColor] = row.getUi(row.val);
        const valFormatted = (typeof row.val === 'number') ? parseFloat(row.val).toFixed(1) : row.val;
        return `<tr><td style="color: #bbb; font-weight: bold; font-size: 14px;">${row.category}</td><td style="font-weight: 600;">${row.name}</td><td style="font-weight: bold; color: #fff; background-color: #222; text-align: center; font-size: 16px; border-left: 4px solid ${statusColor};">${valFormatted}</td><td>${row.unit}</td><td><span class="badge" style="background-color: ${statusColor}; font-size: 13px;">${statusText}</span></td><td style="color: #999; font-style: italic;">${row.range}</td><td style="color: #666; font-family: monospace; font-size: 12px;">${row.formula}</td></tr>`;
    }).join('');
}

// --- GRAPHIQUES ---
function createSensorChart(canvasId, label, dataKey, color, unit, historyData, period, transformFunc = v => v, isLog = false) {
    if (charts[canvasId]) { charts[canvasId].destroy(); charts[canvasId] = null; }
    const ctx = document.getElementById(canvasId); if (!ctx) return; if (!historyData || historyData.length === 0) return;
    const GAP_THRESHOLD_MS = 10 * 60 * 1000;
    function processDataWithGaps(dataArray, key) { const result = []; let prevTime = null; dataArray.forEach(d => { if (!d.timestamp || d[key] == null) return; const currentTime = new Date(d.timestamp).getTime(); if (prevTime && (currentTime - prevTime > GAP_THRESHOLD_MS)) { result.push({ x: currentTime - 1, y: null }); } let val = transformFunc(d[key]); if (isLog && val <= 0) val = 0.1; result.push({ x: currentTime, y: val }); prevTime = currentTime; }); return result; }
    const chartData = processDataWithGaps(historyData, dataKey);
    const datasets = [{ label: label, data: chartData, borderColor: color, backgroundColor: color + '33', borderWidth: 2, pointRadius: 0, tension: 0.1, fill: false, spanGaps: false }];
    const rollingMeanKey = dataKey + '_rolling_mean'; if (historyData[0] && rollingMeanKey in historyData[0]) { const rollingData = processDataWithGaps(historyData, rollingMeanKey); if (rollingData.length > 0) { datasets.push({ label: 'Tendance', data: rollingData, borderColor: '#ffffff', borderWidth: 2, pointRadius: 0, tension: 0.4, borderDash: [], fill: false, spanGaps: true }); } }
    let timeUnit = 'hour'; if (period === '7d' || period === '30d') { timeUnit = 'day'; }
    charts[canvasId] = new Chart(ctx, { type: 'line', data: { datasets: datasets }, options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { display: false } }, scales: { x: { type: 'time', time: { unit: timeUnit, displayFormats: { hour: 'HH:mm', day: 'dd/MM' }, tooltipFormat: 'dd/MM/yyyy HH:mm' }, grid: { color: '#3e3e3e' }, ticks: { color: '#b8c7ce' } }, y: { type: isLog ? 'logarithmic' : 'linear', grid: { color: '#3e3e3e' }, ticks: { color: '#b8c7ce' } } }, animation: false } });
}

function updateAllCharts(data, period) {
    const h = data ? data.history_data : [];
    const configs = [{ id: 'tempChart', label: 'Température', key: 'temperature_c', color: '#dd4b39', unit: '°C' }, { id: 'humidChart', label: 'Humidité', key: 'humidity_pct', color: '#00a65a', unit: '%' }, { id: 'pressureChart', label: 'Pression', key: 'pressure_pa', color: '#00c0ef', unit: 'hPa', transform: v => v / 100 }, { id: 'lightChart', label: 'Luminosité', key: 'light_lux', color: '#f39c12', unit: 'Lux', isLog: true }, { id: 'soundChart', label: 'Niveau Sonore', key: 'sound_spl_dba', color: '#605ca8', unit: 'dBA' }, { id: 'aqiChart', label: 'AQI', key: 'aqi', color: '#00a65a', unit: 'AQI' }, { id: 'co2Chart', label: 'CO₂', key: 'bsec_co2_ppm', color: '#dd4b39', unit: 'ppm' }];
    configs.forEach(c => createSensorChart(c.id, c.label, c.key, c.color, c.unit, h, period, c.transform, c.isLog));
    if (charts['eventsChart']) { charts['eventsChart'].destroy(); charts['eventsChart'] = null; }
    createEventsChart('eventsChart', data ? data.events_period : []);
    if (charts['dbDistributionChart']) { charts['dbDistributionChart'].destroy(); charts['dbDistributionChart'] = null; }
    createDbDistributionChart('dbDistributionChart', data ? data.events_period : []);
    if (charts['eventsTimelineChart']) { charts['eventsTimelineChart'].destroy(); charts['eventsTimelineChart'] = null; }
    createEventsTimelineChart('eventsTimelineChart', data ? data.events_period : [], period);
}

function createEventsTimelineChart(canvasId, eventsData, period) {
    if (charts[canvasId]) { charts[canvasId].destroy(); charts[canvasId] = null; }
    const ctx = document.getElementById(canvasId); if (!ctx) return;
    const now = new Date(); const periodHours = { '1h': 1, '24h': 24, '7d': 168, '30d': 720 }; const hoursBack = periodHours[period] || 24;
    const maxTime = now.getTime() + (hoursBack * 60 * 60 * 1000) * 0.05;
    const minTime = now.getTime() - (hoursBack * 60 * 60 * 1000);
    const validEvents = (eventsData || []).filter(e => e.start_time_iso && !isNaN(new Date(e.start_time_iso).getTime()));

    // TAILLE ACCENTUÉE
    const MIN_DBA = 40; const MAX_DBA = 90; const MIN_RADIUS = 2; const MAX_RADIUS = 35;
    function getRadius(context) { const dba = context.raw ? context.raw.dba : 0; if (!dba) return 4; let ratio = (dba - MIN_DBA) / (MAX_DBA - MIN_DBA); ratio = Math.max(0, Math.min(1, ratio)); return MIN_RADIUS + (Math.pow(ratio, 3) * (MAX_RADIUS - MIN_RADIUS)); }
    function isTarget(context) { if (!flashState || !context.raw || !flashTargetTime) return false; return Math.abs(context.raw.x - flashTargetTime) < 1000; }
    const styleKeys = Object.keys(eventStyles);
    const datasets = styleKeys.map(eventType => {
        const style = eventStyles[eventType];
        const data = validEvents.filter(e => { let typeDB = (e.sound_type || 'Autre').trim(); if (eventType === 'Autre') return typeDB === 'Autre' || !styleKeys.includes(typeDB); return typeDB === eventType; }).map(e => ({ x: new Date(e.start_time_iso).getTime(), y: eventType, dba: e.peak_spl_dba || 0, audio: e.audio_filename }));
        if (data.length === 0) return null;
        return {
            label: eventType, data: data, backgroundColor: function (c) { return isTarget(c) ? '#FFFFFF' : style.color; },
            borderColor: function (c) { return isTarget(c) ? '#FF0000' : 'rgba(255, 255, 255, 0.8)'; },
            borderWidth: function (c) { return isTarget(c) ? 4 : 1; },
            pointStyle: style.style, pointRadius: function (c) { const b = getRadius(c); return isTarget(c) ? b + 15 : b; },
            pointHoverRadius: (c) => getRadius(c) + 8
        };
    }).filter(ds => ds !== null);
    let timeUnit = 'hour'; if (period === '7d' || period === '30d') timeUnit = 'day';

    charts[canvasId] = new Chart(ctx, {
        type: 'scatter', data: { datasets: datasets },
        options: {
            responsive: true, maintainAspectRatio: false, layout: { padding: 10 },
            onClick: (e, elements, chart) => { if (elements && elements.length > 0) { const firstPoint = elements[0]; const audioFile = chart.data.datasets[firstPoint.datasetIndex].data[firstPoint.index].audio; if (audioFile) playAudio(audioFile); else showNotification("Pas de fichier audio"); } },
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${Math.round(c.raw.dba * 10) / 10} dB` } }, zoom: { pan: { enabled: true, mode: 'x', modifierKey: null }, zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' }, limits: { x: { min: minTime, max: maxTime } } } },
            scales: { x: { type: 'time', min: minTime, max: maxTime, time: { unit: timeUnit, displayFormats: { hour: 'HH:mm', day: 'dd/MM' } }, grid: { color: '#999', lineWidth: 2, tickLength: 10 }, ticks: { color: '#fff', font: { size: 14, weight: 'bold' }, maxRotation: 0, autoSkip: true } }, y: { type: 'category', offset: true, grid: { color: '#3e3e3e' }, ticks: { color: '#b8c7ce' } } }, animation: false
        }
    });
}

function createEventsChart(canvasId, eventsData) {
    const ctx = document.getElementById(canvasId); if (!ctx) return; const labels = Array.from({ length: 24 }, (_, i) => `${i}h`); const data = new Array(24).fill(0); (eventsData || []).forEach(e => { if (e.start_time_iso) data[new Date(e.start_time_iso).getHours()]++; });
    charts[canvasId] = new Chart(ctx, { type: 'bar', data: { labels, datasets: [{ label: 'Nombre', data, borderRadius: 2, backgroundColor: (ctx) => { if (flashState && ctx.dataIndex === flashTargetHour) return '#FFFF00'; return '#dd4b39'; } }] }, plugins: [valueLabelPlugin], options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false }, ticks: { color: '#b8c7ce' } }, y: { grid: { color: '#3e3e3e' }, ticks: { color: '#b8c7ce', precision: 0 } } }, layout: { padding: { top: 20 } } } });
}

function createDbDistributionChart(canvasId, eventsData) {
    const ctx = document.getElementById(canvasId); if (!ctx) return;
    if (charts[canvasId]) { charts[canvasId].destroy(); charts[canvasId] = null; }
    let threshold = (typeof SOUND_THRESHOLD_CONFIG !== 'undefined') ? SOUND_THRESHOLD_CONFIG : 40;
    const BIN_SIZE = 2; const MAX_DB_DISPLAY = 90;
    const startBin = Math.floor(threshold / BIN_SIZE) * BIN_SIZE;
    const bins = {};
    for (let i = startBin; i < MAX_DB_DISPLAY; i += BIN_SIZE) { bins[`${i}-${i + BIN_SIZE}`] = 0; }
    bins[`>${MAX_DB_DISPLAY}`] = 0;
    (eventsData || []).forEach(e => {
        const db = e.peak_spl_dba;
        if (db && db >= threshold) {
            if (db >= MAX_DB_DISPLAY) bins[`>${MAX_DB_DISPLAY}`]++;
            else { const lower = Math.floor(db / BIN_SIZE) * BIN_SIZE; const key = `${lower}-${lower + BIN_SIZE}`; if (bins[key] !== undefined) bins[key]++; }
        }
    });
    const labels = Object.keys(bins); const data = Object.values(bins);
    const backgroundColors = data.map((_, i) => (i < 4) ? '#00a65a' : (i < 7) ? '#f39c12' : '#dd4b39');
    charts[canvasId] = new Chart(ctx, {
        type: 'bar', data: {
            labels, datasets: [{
                label: 'Événements', data, borderRadius: 3, barPercentage: 0.8,
                backgroundColor: (ctx) => {
                    const label = ctx.chart.data.labels[ctx.dataIndex];
                    if (flashState && label === flashTargetDbLabel) return '#FFFF00';
                    return backgroundColors[ctx.dataIndex];
                }
            }]
        },
        plugins: [valueLabelPlugin],
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { title: (c) => `${c[0].label} dB` } } }, scales: { x: { grid: { display: false }, ticks: { color: '#b8c7ce', font: { size: 10 }, maxRotation: 45, minRotation: 45 }, title: { display: true, text: 'Niveau Sonore (dBA)', color: '#777' } }, y: { grid: { color: '#3e3e3e' }, ticks: { color: '#b8c7ce', precision: 0 } } }, layout: { padding: { top: 20 } } }
    });
}

function updateEventsTable(events, tableId) {
    const tbody = document.querySelector(`#${tableId} tbody`); if (!tbody) return;
    if (!events || events.length === 0) { const colSpan = (tableId === 'top-events-table') ? 4 : 7; tbody.innerHTML = `<tr><td colspan="${colSpan}" class="text-center">Aucun événement</td></tr>`; return; }
    let tableHTML = '';
    if (tableId === 'top-events-table') {
        tableHTML = events.map(e => `<tr><td>${formatISODate(e.start_time_iso)}</td><td><span class="badge" style="background-color: ${eventStyles[e.sound_type]?.color || '#777'}">${e.sound_type}</span></td><td><strong>${formatValue(e.peak_spl_dba, 1, ' dBA')}</strong></td><td>${e.audio_filename ? `<button class="action-btn" onclick="playAudio('${e.audio_filename}')"><i class="fa fa-play"></i></button>` : ''}</td></tr>`).join('');
    } else {
        tableHTML = events.map(e => `<tr><td>${formatISODate(e.start_time_iso)}</td><td><span class="badge" style="background-color: ${eventStyles[e.sound_type]?.color || '#777'}">${e.sound_type}</span></td><td>${e.duration_s !== undefined ? e.duration_s + 's' : '--'}</td><td>${formatValue(e.peak_spl_dba, 1, ' dBA')}</td><td style="font-style: italic; color: #888;">${e.duration_since_prev || '-'}</td><td>${e.spectral_bands ? `<div style="width: 80px; height: 30px;"><canvas id="mini-spec-${tableId}-${e.id}"></canvas></div>` : '--'}</td><td>${e.audio_filename ? `<button class="action-btn" onclick="playAudio('${e.audio_filename}')"><i class="fa fa-play"></i></button>` : ''}</td></tr>`).join('');
    }
    tbody.innerHTML = tableHTML;
    if (tableId === 'events-period-table') { events.forEach(e => { if (e.spectral_bands) drawMiniSpectrum(`mini-spec-${tableId}-${e.id}`, e.spectral_bands); }); }
    const searchInputId = (tableId === 'top-events-table') ? 'search-top' : 'search-events';
    const searchInput = document.getElementById(searchInputId);
    if (searchInput && searchInput.value) { filterTable(tableId, searchInput.value); }
}

function sortTable(tableId, colIndex) {
    const table = document.getElementById(tableId); const tbody = table.querySelector('tbody'); const rows = Array.from(tbody.querySelectorAll('tr')); const th = table.querySelectorAll('th')[colIndex]; const type = th.getAttribute('data-type');
    if (!table.sortDirection) table.sortDirection = {}; const dirKey = colIndex; const asc = table.sortDirection[dirKey] === 'asc'; table.sortDirection[dirKey] = asc ? 'desc' : 'asc';
    table.querySelectorAll('th').forEach(h => h.classList.remove('asc', 'desc')); th.classList.add(table.sortDirection[dirKey]);
    const getVal = (row) => { const cell = row.children[colIndex].innerText.trim(); if (type === 'number') return parseFloat(cell.replace(/[^0-9.-]/g, '')) || 0; if (type === 'duration') return parseFloat(cell.replace('s', '')) || 0; if (type === 'date') { const parts = cell.split(/[\s/:]/); if (parts.length >= 4) return new Date(new Date().getFullYear(), parts[1] - 1, parts[0], parts[2], parts[3]).getTime(); return 0; } return cell.toLowerCase(); };
    rows.sort((a, b) => { const valA = getVal(a); const valB = getVal(b); if (valA < valB) return asc ? -1 : 1; if (valA > valB) return asc ? 1 : -1; return 0; });
    rows.forEach(row => tbody.appendChild(row));
}

function filterTable(tableId, query) {
    const table = document.getElementById(tableId); const rows = table.querySelectorAll('tbody tr'); const lowerQuery = query.toLowerCase().trim();
    let operator = null; let numVal = null; let numVal2 = null;
    if (lowerQuery.startsWith('>')) { operator = '>'; numVal = parseFloat(lowerQuery.substring(1)); } else if (lowerQuery.startsWith('<')) { operator = '<'; numVal = parseFloat(lowerQuery.substring(1)); } else if (lowerQuery.includes('-') && !isNaN(parseFloat(lowerQuery))) { const parts = lowerQuery.split('-'); if (parts.length === 2) { operator = 'range'; numVal = parseFloat(parts[0]); numVal2 = parseFloat(parts[1]); } }
    rows.forEach(row => { let match = false; if (operator && !isNaN(numVal)) { const numbersInRow = row.innerText.match(/(\d+(\.\d+)?)/g); if (numbersInRow) { for (let nStr of numbersInRow) { const n = parseFloat(nStr); if (operator === '>' && n >= numVal) match = true; if (operator === '<' && n <= numVal) match = true; if (operator === 'range' && n >= numVal && n <= numVal2) match = true; } } } else { if (row.innerText.toLowerCase().includes(lowerQuery)) match = true; } row.style.display = match ? '' : 'none'; });
}

function formatISODate(isoString) { try { return new Intl.DateTimeFormat('fr-FR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(isoString)); } catch (e) { return '--'; } }
function formatValue(v, d = 0, u = '') { return (v != null && !isNaN(v)) ? parseFloat(v).toFixed(d) + u : '--'; }
function drawMiniSpectrum(id, d) { const c = document.getElementById(id); if (c) new Chart(c, { type: 'bar', data: { labels: [1, 2, 3, 4, 5, 6], datasets: [{ data: d, backgroundColor: '#605ca8' }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: false, tooltip: false }, scales: { x: { display: false }, y: { display: false } }, animation: false } }); }
function playAudio(f) { const c = document.getElementById('global-audio-player-container'); if (!c) return; if (wavesurfer) { wavesurfer.destroy(); wavesurfer = null; } const a = new Audio(); a.src = '/audio_files/' + f; a.crossOrigin = "anonymous"; a.volume = 0.8; c.innerHTML = `<div class="waveform-wrapper" style="display:flex;align-items:center;gap:20px;background:#2d2d2d;padding:15px;border-top:4px solid #00c0ef;box-shadow:0 -5px 15px rgba(0,0,0,0.5);"><div class="waveform-controls"><button id="pp_btn" class="btn-play-pause" style="width:60px;height:60px;font-size:24px;border-radius:50%;background:#00c0ef;border:none;color:white;cursor:pointer;"><i class="fa fa-play"></i></button></div><div class="waveform-visual" style="flex-grow:1;"><div id="wf"></div></div><div style="display:flex;flex-direction:column;align-items:center;gap:5px;"><i id="vol_icon" class="fa fa-volume-up" style="color:#b8c7ce;cursor:pointer;font-size:18px;"></i><input type="range" id="vol_slider" min="0" max="1" step="0.05" value="0.8" style="width:150px;cursor:pointer;accent-color:#00c0ef;"></div><button class="btn-close-player" id="close_btn" style="background:none;border:none;color:#777;font-size:24px;cursor:pointer;margin-left:10px;"><i class="fa fa-times"></i></button></div>`; wavesurfer = WaveSurfer.create({ container: '#wf', media: a, waveColor: '#00c0ef', progressColor: '#fff', height: 100, normalize: true, cursorWidth: 2, barWidth: 3, barGap: 2, barRadius: 3 }); wavesurfer.on('ready', () => { wavesurfer.play(); document.getElementById('pp_btn').innerHTML = '<i class="fa fa-pause"></i>'; }); wavesurfer.on('finish', () => { document.getElementById('pp_btn').innerHTML = '<i class="fa fa-play"></i>'; }); document.getElementById('pp_btn').onclick = () => { wavesurfer.playPause(); document.getElementById('pp_btn').innerHTML = `<i class="fa ${wavesurfer.isPlaying() ? 'fa-pause' : 'fa-play'}"></i>`; }; const s = document.getElementById('vol_slider'); const v = document.getElementById('vol_icon'); let lv = 0.8; s.oninput = function () { const val = parseFloat(this.value); a.volume = val; uV(val); if (val > 0) lv = val; }; v.onclick = function () { if (a.volume > 0) { a.volume = 0; s.value = 0; uV(0); } else { a.volume = lv; s.value = lv; uV(lv); } }; function uV(val) { v.className = val === 0 ? 'fa fa-volume-off' : (val < 0.5 ? 'fa fa-volume-down' : 'fa fa-volume-up'); } document.getElementById('close_btn').onclick = () => { if (wavesurfer) { wavesurfer.destroy(); wavesurfer = null; } c.innerHTML = ''; }; }
let notifTimeout; function showNotification(message) { const b = document.getElementById('notification-banner'); const t = document.getElementById('notif-text'); if (!b || !t) return; t.textContent = message; b.classList.add('visible'); if (notifTimeout) clearTimeout(notifTimeout); notifTimeout = setTimeout(() => { b.classList.remove('visible'); }, 10000); }