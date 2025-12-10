/* /home/obafgk/SoundProject/metriful_web/static/js/main_v2.js */

console.log("🚀 Démarrage main_v2.js (RESTORED)...");

let charts = {};
let currentPeriod = '24h';
let currentData = {};
let wavesurfer = null;
let previousKPIs = {};
let isAutoPlay = false;

const eventStyles = {
    'Sirène': { color: '#dd4b39', style: 'triangle', size: 8, icon: 'fa-truck-medical', isEmergency: true },
    'Moteur': { color: '#95a5a6', style: 'rect', size: 7, icon: 'fa-motorcycle', isEmergency: false },
    'Voix': { color: '#00c0ef', style: 'circle', size: 6, icon: 'fa-person-walking', isEmergency: false },
    'Musique': { color: '#605ca8', style: 'star', size: 9, icon: 'fa-music', isEmergency: false },
    'Autre': { color: '#ff851b', style: 'rectRot', size: 7, icon: 'fa-car-side', isEmergency: false }
};

const randomVehicles = [{ icon: 'fa-truck', color: '#7f8c8d' }, { icon: 'fa-trash-can', color: '#27ae60' }, { icon: 'fa-bus', color: '#f1c40f' }, { icon: 'fa-car-side', color: '#ecf0f1' }];

Chart.defaults.color = '#b8c7ce'; Chart.defaults.scale.grid.color = '#3e3e3e'; Chart.defaults.borderColor = '#3e3e3e';

// --- AJOUT ICI ---
// Augmente la taille de police par défaut de TOUS les graphiques (Axes, Légendes, Tooltips)
Chart.defaults.font.size = 15; // Était 12 par défaut

function toLocalISOString(date) { try { const offset = date.getTimezoneOffset() * 60000; return (new Date(date - offset)).toISOString().slice(0, 16); } catch (e) { return ""; } }

document.addEventListener('DOMContentLoaded', function () {
    const datePicker = document.getElementById('date-picker');
    if (datePicker) datePicker.value = toLocalISOString(new Date());

    console.log("Chargement initial...");
    fetchDataAndUpdate('24h', null, true);

    const autoPlayToggle = document.getElementById('autoplay-toggle');
    if (autoPlayToggle) { autoPlayToggle.addEventListener('change', function () { isAutoPlay = this.checked; }); }

    // 3. Boutons Période
    document.querySelectorAll('.period-btn').forEach(button => {
        button.addEventListener('click', function () {
            // Empêche le double-clic pendant un chargement
            if (document.body.classList.contains('loading')) return;

            // 1. Gestion visuelle des boutons
            const currentActive = document.querySelector('.period-btn.active');
            if (currentActive) {
                currentActive.classList.remove('active');
            }
            this.classList.add('active'); // 'this' est le bouton cliqué

            // 2. Mise à jour de la variable
            currentPeriod = this.dataset.period;

            // 3. Appel des données
            // showOverlay = true par défaut, donc le message d'attente DOIT s'afficher
            fetchDataAndUpdate(currentPeriod, datePicker.value, true);
        });
    });
    const validateBtn = document.getElementById('validate-date-btn'); if (validateBtn) validateBtn.addEventListener('click', () => fetchDataAndUpdate(currentPeriod, datePicker.value));

    const eventSource = new EventSource("/api/stream_events");
    eventSource.onmessage = function (event) {
        if (event.data === "new_event") {
            console.log("🔔 SSE: Event!"); showNotification("🔊 Événement sonore détecté !");
            setTimeout(() => { fetchDataAndUpdate(currentPeriod, null, false).then(() => { handleNewEvent(); }); }, 1500);
        } else if (event.data === "new_sensor") { fetchAndUpdateKPIs(); }
    };
});

function handleNewEvent() {
    if (!currentData || !currentData.events_period || currentData.events_period.length === 0) return;
    const latestEvent = currentData.events_period[0];
    triggerVisualAnimation(latestEvent);
    if (isAutoPlay && latestEvent.audio_filename) { playAudio(latestEvent.audio_filename); }
}

function triggerVisualAnimation(eventData) {
    if (!eventData) return;
    const dba = eventData.peak_spl_dba || 60; const type = eventData.sound_type || 'Autre';
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
    const street = document.getElementById('street-scene'); const noise = document.getElementById('noise-scene'); if (!street || !noise) return;
    street.style.display = 'none'; noise.style.display = 'flex'; setTimeout(() => { street.style.display = 'block'; noise.style.display = 'none'; }, 5000);
}

async function fetchDataAndUpdate(period, refDateStr = null, showOverlay = true) {
    if (showOverlay) document.body.classList.add('loading');
    let url = `/api/data?period=${period}&_nocache=${Date.now()}`; if (refDateStr) url += `&ref_date=${new Date(refDateStr).toISOString()}`;
    try { const response = await fetch(url); if (!response.ok) throw new Error('Erreur'); const newData = await response.json(); currentData = newData; updateDashboardUI(newData, period); } catch (e) { console.error(e); } finally { if (showOverlay) document.body.classList.remove('loading'); }
}

async function fetchAndUpdateKPIs() {
    try { const r = await fetch(`/api/data?period=1h&_nocache=${Date.now()}`); if (!r.ok) return; const d = await r.json(); currentData.kpis = d.kpis; currentData.window_status = d.window_status; updateKPIs(d.kpis); updateLastActivityDisplay({ kpis: d.kpis, events_period: currentData.events_period }); } catch (e) { }
}

function updateDashboardUI(data, period) {
    if (!data) return; updateLastActivityDisplay(data); updateKPIs(data.kpis); updateAllCharts(data, period); updateEventsTable(data.events_period, 'events-period-table'); updateEventsTable(data.top_events, 'top-events-table');
}

function updateLastActivityDisplay(data) {
    const el = document.getElementById('last-updated');
    if (!el) return;

    let latestTime = null;

    // 1. Vérification Date Capteurs (KPIs)
    if (data.kpis && data.kpis.timestamp) {
        let ts = data.kpis.timestamp;

        // CORRECTION : On vérifie si c'est un objet complexe (nouvelle version) ou une string (ancienne version)
        if (ts && typeof ts === 'object' && ts.value) {
            ts = ts.value;
        }

        const kpiTime = new Date(ts);
        if (!isNaN(kpiTime.getTime())) {
            latestTime = kpiTime;
        }
    }

    // 2. Vérification Date Son (Events)
    if (data.events_period && data.events_period.length > 0) {
        const lastEvent = data.events_period[0]; // Le premier est le plus récent
        if (lastEvent && lastEvent.start_time_iso) {
            const soundTime = new Date(lastEvent.start_time_iso);
            // On prend la date la plus récente entre le son et les capteurs
            if (!isNaN(soundTime.getTime())) {
                if (!latestTime || soundTime > latestTime) {
                    latestTime = soundTime;
                }
            }
        }
    }

    // 3. Affichage
    if (latestTime) {
        const formatted = new Intl.DateTimeFormat('fr-FR', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        }).format(latestTime);

        // On force le style ici pour être sûr qu'il soit visible
        el.innerHTML = `Dernière activité : <span style="color: #fff; font-weight: bold;">${formatted}</span>`;
    } else {
        el.innerHTML = "En attente...";
    }
}

function updateKPIs(kpis) {
    const container = document.getElementById('kpi-container'); if (!container || !kpis) return;
    function gT(k, p, d) { const v = k[`delta_${p}`]; if (v == null) return ''; const c = v > 0 ? 'trend-up' : 'trend-down'; const i = v > 0 ? 'fa-arrow-up' : 'fa-arrow-down'; return `<span class="kpi-long-term-trend ${c}"><i class="fa ${i}"></i> ${v > 0 ? '+' : ''}${v.toFixed(d)} (${p})</span>`; }
    const cf = [{ key: 'temperature_c', label: 'Temp', icon: 'fa-thermometer-half', color: 'bg-red', unit: ' °C', decimals: 1 }, { key: 'humidity_pct', label: 'Humidité', icon: 'fa-percent', color: 'bg-green', unit: ' %', decimals: 0 }, { key: 'sound_spl_dba', label: 'Son', icon: 'fa-volume-up', color: 'bg-purple', unit: ' dBA', decimals: 1 }, { key: 'light_lux', label: 'Lumière', icon: 'fa-sun', color: 'bg-yellow', unit: ' Lx', decimals: 0 }, { key: 'bsec_co2_ppm', label: 'CO₂', icon: 'fa-cloud', color: 'bg-red', unit: ' ppm', decimals: 0 }, { key: 'aqi', label: 'AQI', icon: 'fa-leaf', color: 'bg-green', unit: '', decimals: 0 }, { key: 'pressure_pa', label: 'Pression', icon: 'fa-tachometer-alt', color: 'bg-aqua', unit: ' hPa', decimals: 0, transform: v => v / 100 }, { key: 'humidex', label: 'Humidex', icon: 'fa-tint', color: 'bg-yellow', unit: '', decimals: 1 }];
    let ws = 'Inconnu'; let wc = 'bg-aqua'; if (currentData && currentData.window_status) { ws = currentData.window_status.status.charAt(0).toUpperCase() + currentData.window_status.status.slice(1); wc = (ws === 'Ouverte') ? 'bg-red' : 'bg-green'; }
    container.innerHTML = cf.map(c => {
        const k = kpis[c.key]; if (!k) return '';
        let v = k.value; let pv = previousKPIs[c.key]; if (c.transform) { v = c.transform(v); if (pv != null) pv = c.transform(pv); }
        let imT = ''; if (pv != null && v != null) { const d = v - pv; const th = (c.key === 'pressure_pa') ? 0.5 : 0.05; if (Math.abs(d) > th) { const cl = d > 0 ? 'trend-up' : 'trend-down'; const ic = d > 0 ? 'fa-arrow-up' : 'fa-arrow-down'; imT = `<span class="kpi-trend ${cl}"><i class="fa ${ic}"></i> ${d > 0 ? '+' : ''}${d.toFixed(c.decimals)}</span>`; } }
        return `<div class="col-md-6 col-sm-6 col-xs-12"><div class="info-box"><span class="info-box-icon ${c.color}"><i class="fa ${c.icon}"></i></span><div class="info-box-content"><span class="info-box-text">${c.label}</span><div class="kpi-value-container"><span class="info-box-number">${formatValue(v, c.decimals, c.unit)}</span>${imT}${gT(k, '24h', c.decimals)}${gT(k, '7d', c.decimals)}${gT(k, '30d', c.decimals)}</div></div></div></div>`;
    }).join('');
    if (kpis.temperature_c) { previousKPIs = { temperature_c: kpis.temperature_c.value, humidity_pct: kpis.humidity_pct.value, pressure_pa: kpis.pressure_pa.value, aqi: kpis.aqi.value, bsec_co2_ppm: kpis.bsec_co2_ppm.value, light_lux: kpis.light_lux.value, sound_spl_dba: kpis.sound_spl_dba.value }; }
}

// ... (Rest of charts/tables/utils functions are standard) ...
function createSensorChart(canvasId, label, dataKey, color, unit, historyData, period, transformFunc = v => v, isLog = false) {
    if (charts[canvasId]) { charts[canvasId].destroy(); charts[canvasId] = null; }
    const ctx = document.getElementById(canvasId); if (!ctx) return; if (!historyData || historyData.length === 0) return;
    const GAP_THRESHOLD_MS = 10 * 60 * 1000;
    function processDataWithGaps(dataArray, key) { const result = []; let prevTime = null; dataArray.forEach(d => { if (!d.timestamp || d[key] == null) return; const currentTime = new Date(d.timestamp).getTime(); if (prevTime && (currentTime - prevTime > GAP_THRESHOLD_MS)) { result.push({ x: currentTime - 1, y: null }); } let val = transformFunc(d[key]); if (isLog && val <= 0) val = 0.1; result.push({ x: currentTime, y: val }); prevTime = currentTime; }); return result; }
    const chartData = processDataWithGaps(historyData, dataKey);
    const datasets = [{ label: label, data: chartData, borderColor: color, backgroundColor: color, borderWidth: 2, pointRadius: 0, tension: 0.1, fill: false, spanGaps: false }];
    const rollingMeanKey = dataKey + '_rolling_mean'; if (historyData[0] && rollingMeanKey in historyData[0]) {
        const rollingData = processDataWithGaps(historyData, rollingMeanKey);
        if (rollingData.length > 0) {
            datasets.push({
                label: 'Tendance',
                data: rollingData,
                borderColor: '#ffffff', // Blanc pur
                borderWidth: 2,         // Assez visible
                pointRadius: 0,
                tension: 0.4,
                borderDash: [],         // <--- TABLEAU VIDE = Ligne continue (pas de pointillés)
                fill: false,
                spanGaps: true
            });
        }
    }
    let timeUnit = 'hour'; if (period === '7d' || period === '30d') { timeUnit = 'day'; }
    charts[canvasId] = new Chart(ctx, { type: 'line', data: { datasets: datasets }, options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { display: false } }, scales: { x: { type: 'time', time: { unit: timeUnit }, grid: { color: '#3e3e3e' }, ticks: { color: '#b8c7ce' } }, y: { type: isLog ? 'logarithmic' : 'linear', grid: { color: '#3e3e3e' }, ticks: { color: '#b8c7ce' } } }, animation: false } });
}

function updateAllCharts(data, period) {
    const h = data ? data.history_data : [];
    const configs = [{ id: 'tempChart', label: 'Température', key: 'temperature_c', color: '#dd4b39', unit: '°C' }, { id: 'humidChart', label: 'Humidité', key: 'humidity_pct', color: '#00a65a', unit: '%' }, { id: 'pressureChart', label: 'Pression', key: 'pressure_pa', color: '#00c0ef', unit: 'hPa', transform: v => v / 100 }, { id: 'lightChart', label: 'Luminosité', key: 'light_lux', color: '#f39c12', unit: 'Lux', isLog: true }, { id: 'soundChart', label: 'Niveau Sonore', key: 'sound_spl_dba', color: '#605ca8', unit: 'dBA' }, { id: 'aqiChart', label: 'AQI', key: 'aqi', color: '#00a65a', unit: 'AQI' }, { id: 'co2Chart', label: 'CO₂', key: 'bsec_co2_ppm', color: '#dd4b39', unit: 'ppm' }];
    configs.forEach(c => createSensorChart(c.id, c.label, c.key, c.color, c.unit, h, period, c.transform, c.isLog));
    if (charts['eventsChart']) { charts['eventsChart'].destroy(); charts['eventsChart'] = null; }
    createEventsChart('eventsChart', data ? data.events_period : []);
    if (charts['eventsTimelineChart']) { charts['eventsTimelineChart'].destroy(); charts['eventsTimelineChart'] = null; }
    createEventsTimelineChart('eventsTimelineChart', data ? data.events_period : [], period);
}

// --- FRISE CHRONOLOGIQUE ---
function createEventsTimelineChart(canvasId, eventsData, period) {
    if (charts[canvasId]) { charts[canvasId].destroy(); charts[canvasId] = null; }
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    // Bornes
    const now = new Date();
    const periodHours = { '1h': 1, '24h': 24, '7d': 168, '30d': 720 };
    const hoursBack = periodHours[period] || 24;
    const maxTime = now.getTime() + (hoursBack * 60 * 60 * 1000) * 0.05;
    const minTime = maxTime - (hoursBack * 60 * 60 * 1000) * 1.05;

    const validEvents = (eventsData || []).filter(e => e.start_time_iso && !isNaN(new Date(e.start_time_iso).getTime()) && new Date(e.start_time_iso).getTime() > 946684800000);

    // --- NOUVELLE FORMULE DE TAILLE ---
    function getRadius(context) {
        const dba = context.raw ? context.raw.dba : 0;
        if (!dba) return 4;

        // Paramètres
        const minDb = 50;  // En dessous de 50dB, c'est tout petit
        const maxDb = 90;  // Au dessus de 90dB, c'est géant
        const minSize = 4;
        const maxSize = 35; // Augmenté pour bien voir les gros

        // Normalisation entre 0 et 1
        let ratio = (dba - minDb) / (maxDb - minDb);
        ratio = Math.max(0, Math.min(1, ratio)); // Borner entre 0 et 1

        // Formule Exponentielle (C'est ça qui change tout !)
        // ratio^2 permet d'accentuer les différences sur les valeurs hautes
        return minSize + (Math.pow(ratio, 2) * (maxSize - minSize));
    }

    const datasets = Object.keys(eventStyles).map(eventType => {
        const style = eventStyles[eventType];
        const data = validEvents
            .filter(e => e.sound_type === eventType)
            .map(e => ({
                x: new Date(e.start_time_iso).getTime(),
                y: eventType,
                dba: e.peak_spl_dba || 0
            }));

        if (data.length === 0) return null;

        return {
            label: eventType,
            data: data,
            backgroundColor: style.color,
            borderColor: '#fff',
            borderWidth: 1,
            pointStyle: style.style,
            // On utilise la fonction dynamique ici
            pointRadius: getRadius,
            // Au survol, on grossit encore
            pointHoverRadius: (ctx) => getRadius(ctx) + 5
        };
    }).filter(ds => ds !== null);

    let timeUnit = 'hour';
    if (period === '7d' || period === '30d') timeUnit = 'day';

    charts[canvasId] = new Chart(ctx, {
        type: 'scatter',
        data: { datasets: datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: { padding: 10 },
            plugins: {
                legend: { display: false }, // Légende masquée comme demandé
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            // On affiche la valeur précise au survol
                            const db = Math.round(context.raw.dba * 10) / 10;
                            return `${context.dataset.label}: ${db} dBA`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    type: 'time',
                    min: minTime,
                    max: maxTime,
                    time: { unit: timeUnit, displayFormats: { hour: 'HH:mm', day: 'dd/MM' } },
                    grid: { color: '#3e3e3e' },
                    ticks: { color: '#b8c7ce' }
                },
                y: {
                    type: 'category',
                    offset: true,
                    grid: { color: '#3e3e3e' },
                    ticks: { color: '#b8c7ce' }
                }
            },
            animation: false
        }
    });
}

function createEventsChart(canvasId, eventsData) {
    const ctx = document.getElementById(canvasId); if (!ctx) return; const labels = Array.from({ length: 24 }, (_, i) => `${i}h`); const data = new Array(24).fill(0); (eventsData || []).forEach(e => { if (e.start_time_iso) data[new Date(e.start_time_iso).getHours()]++; });
    charts[canvasId] = new Chart(ctx, { type: 'bar', data: { labels, datasets: [{ label: 'Evénements', data, backgroundColor: '#dd4b39' }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { grid: { color: '#3e3e3e' } } } } });
}

function updateEventsTable(events, tableId) {
    const tbody = document.querySelector(`#${tableId} tbody`);
    if (!tbody) return;

    // Gestion cas vide
    if (!events || events.length === 0) {
        // Ajustement du colspan selon le tableau
        const colSpan = (tableId === 'top-events-table') ? 4 : 7;
        tbody.innerHTML = `<tr><td colspan="${colSpan}" class="text-center">Aucun événement</td></tr>`;
        return;
    }

    let tableHTML = '';

    if (tableId === 'top-events-table') {
        // --- TOP 20 (Colonnes simplifiées : Heure, Type, Pic, Audio) ---
        tableHTML = events.map(e => `
            <tr>
                <td>${formatISODate(e.start_time_iso)}</td>
                <td><span class="badge" style="background-color: ${eventStyles[e.sound_type]?.color || '#777'}">${e.sound_type}</span></td>
                <td><strong>${formatValue(e.peak_spl_dba, 1, ' dBA')}</strong></td>
                <td>${e.audio_filename ? `<button class="action-btn" onclick="playAudio('${e.audio_filename}')"><i class="fa fa-play"></i></button>` : ''}</td>
            </tr>
        `).join('');

    } else {
        // --- DERNIERS ÉVÉNEMENTS (Colonnes complètes : Heure, Type, Durée, Pic, Délai, Spectre, Audio) ---
        tableHTML = events.map(e => `
            <tr>
                <td>${formatISODate(e.start_time_iso)}</td>
                <td><span class="badge" style="background-color: ${eventStyles[e.sound_type]?.color || '#777'}">${e.sound_type}</span></td>
                <td>${e.duration_s !== undefined ? e.duration_s + 's' : '--'}</td>
                <td>${formatValue(e.peak_spl_dba, 1, ' dBA')}</td>
                <td style="font-style: italic; color: #888;">${e.duration_since_prev || '-'}</td>
                <td>
                    ${e.spectral_bands ? `<div style="width: 80px; height: 30px;"><canvas id="mini-spec-${tableId}-${e.id}"></canvas></div>` : '--'}
                </td>
                <td>
                     ${e.audio_filename ? `<button class="action-btn" onclick="playAudio('${e.audio_filename}')"><i class="fa fa-play"></i></button>` : ''}
                </td>
            </tr>
        `).join('');
    }

    tbody.innerHTML = tableHTML;

    // Dessin des mini spectres (uniquement pour le tableau complet)
    if (tableId === 'events-period-table') {
        events.forEach(e => {
            if (e.spectral_bands) {
                drawMiniSpectrum(`mini-spec-${tableId}-${e.id}`, e.spectral_bands);
            }
        });
    }

    // --- RÉAPPLICATION DU FILTRE ---
    // Si l'utilisateur a tapé une recherche, on filtre les nouvelles lignes immédiatement
    const searchInputId = (tableId === 'top-events-table') ? 'search-top' : 'search-events';
    const searchInput = document.getElementById(searchInputId);
    if (searchInput && searchInput.value) {
        filterTable(tableId, searchInput.value);
    }
}

function formatISODate(isoString) { try { return new Intl.DateTimeFormat('fr-FR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(isoString)); } catch (e) { return '--'; } }
function formatValue(v, d = 0, u = '') { return (v != null && !isNaN(v)) ? parseFloat(v).toFixed(d) + u : '--'; }
function drawMiniSpectrum(id, d) { const c = document.getElementById(id); if (c) new Chart(c, { type: 'bar', data: { labels: [1, 2, 3, 4, 5, 6], datasets: [{ data: d, backgroundColor: '#605ca8' }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: false, tooltip: false }, scales: { x: { display: false }, y: { display: false } }, animation: false } }); }
function playAudio(f) { const c = document.getElementById('global-audio-player-container'); if (!c) return; if (wavesurfer) { wavesurfer.destroy(); wavesurfer = null; } const a = new Audio(); a.src = '/audio_files/' + f; a.crossOrigin = "anonymous"; a.volume = 0.8; c.innerHTML = `<div class="waveform-wrapper" style="display:flex;align-items:center;gap:20px;background:#2d2d2d;padding:15px;border-top:4px solid #00c0ef;box-shadow:0 -5px 15px rgba(0,0,0,0.5);"><div class="waveform-controls"><button id="pp_btn" class="btn-play-pause" style="width:60px;height:60px;font-size:24px;border-radius:50%;background:#00c0ef;border:none;color:white;cursor:pointer;"><i class="fa fa-play"></i></button></div><div class="waveform-visual" style="flex-grow:1;"><div id="wf"></div></div><div style="display:flex;flex-direction:column;align-items:center;gap:5px;"><i id="vol_icon" class="fa fa-volume-up" style="color:#b8c7ce;cursor:pointer;font-size:18px;"></i><input type="range" id="vol_slider" min="0" max="1" step="0.05" value="0.8" style="width:150px;cursor:pointer;accent-color:#00c0ef;"></div><button class="btn-close-player" id="close_btn" style="background:none;border:none;color:#777;font-size:24px;cursor:pointer;margin-left:10px;"><i class="fa fa-times"></i></button></div>`; wavesurfer = WaveSurfer.create({ container: '#wf', media: a, waveColor: '#00c0ef', progressColor: '#fff', height: 100, normalize: true, cursorWidth: 2, barWidth: 3, barGap: 2, barRadius: 3 }); wavesurfer.on('ready', () => { wavesurfer.play(); document.getElementById('pp_btn').innerHTML = '<i class="fa fa-pause"></i>'; }); wavesurfer.on('finish', () => { document.getElementById('pp_btn').innerHTML = '<i class="fa fa-play"></i>'; }); document.getElementById('pp_btn').onclick = () => { wavesurfer.playPause(); document.getElementById('pp_btn').innerHTML = `<i class="fa ${wavesurfer.isPlaying() ? 'fa-pause' : 'fa-play'}"></i>`; }; const s = document.getElementById('vol_slider'); const v = document.getElementById('vol_icon'); let lv = 0.8; s.oninput = function () { const val = parseFloat(this.value); a.volume = val; uV(val); if (val > 0) lv = val; }; v.onclick = function () { if (a.volume > 0) { a.volume = 0; s.value = 0; uV(0); } else { a.volume = lv; s.value = lv; uV(lv); } }; function uV(val) { v.className = val === 0 ? 'fa fa-volume-off' : (val < 0.5 ? 'fa fa-volume-down' : 'fa fa-volume-up'); } document.getElementById('close_btn').onclick = () => { if (wavesurfer) { wavesurfer.destroy(); wavesurfer = null; } c.innerHTML = ''; }; }
let notifTimeout; function showNotification(message) { const b = document.getElementById('notification-banner'); const t = document.getElementById('notif-text'); if (!b || !t) return; t.textContent = message; b.classList.add('visible'); if (notifTimeout) clearTimeout(notifTimeout); notifTimeout = setTimeout(() => { b.classList.remove('visible'); }, 10000); }

/* --- FONCTIONS INTERACTIVES TABLEAUX (Tri & Recherche) --- */

// 1. Initialisation des écouteurs de recherche
document.addEventListener('DOMContentLoaded', () => {
    // Connexion champ recherche -> Tableau Période
    const searchPeriod = document.getElementById('search-events');
    if (searchPeriod) {
        searchPeriod.addEventListener('keyup', () => filterTable('events-period-table', searchPeriod.value));
    }

    // Connexion champ recherche -> Tableau Top 20
    const searchTop = document.getElementById('search-top');
    if (searchTop) {
        searchTop.addEventListener('keyup', () => filterTable('top-events-table', searchTop.value));
    }
});

// 2. Fonction de TRI
let sortDirection = {}; // Mémorise l'état de tri par colonne

function sortTable(tableId, colIndex) {
    const table = document.getElementById(tableId);
    const tbody = table.querySelector('tbody');
    const rows = Array.from(tbody.querySelectorAll('tr'));
    const th = table.querySelectorAll('th')[colIndex];
    const type = th.getAttribute('data-type');

    // Gestion Ascendant / Descendant
    const dirKey = `${tableId}-${colIndex}`;
    const asc = sortDirection[dirKey] === 'asc';
    sortDirection[dirKey] = asc ? 'desc' : 'asc';

    // Mise à jour visuelle des flèches
    table.querySelectorAll('th').forEach(h => h.classList.remove('asc', 'desc'));
    th.classList.add(sortDirection[dirKey]);

    // Fonction de parsing selon le type de donnée
    const getVal = (row) => {
        const cell = row.children[colIndex].innerText.trim();
        if (type === 'number') return parseFloat(cell.replace(/[^0-9.-]/g, '')) || 0; // "85.4 dBA" -> 85.4
        if (type === 'duration') return parseFloat(cell.replace('s', '')) || 0;       // "12s" -> 12
        if (type === 'date') {
            // "10/12 14:30" -> Timestamp. On triche un peu en ajoutant l'année courante si besoin
            const parts = cell.split(/[\s/:]/); // Séparateurs
            if (parts.length >= 4) {
                // Format approximatif pour le tri
                return new Date(new Date().getFullYear(), parts[1] - 1, parts[0], parts[2], parts[3]).getTime();
            }
            return 0;
        }
        return cell.toLowerCase();
    };

    rows.sort((a, b) => {
        const valA = getVal(a);
        const valB = getVal(b);

        if (valA < valB) return asc ? -1 : 1;
        if (valA > valB) return asc ? 1 : -1;
        return 0;
    });

    // Réinjection des lignes triées
    rows.forEach(row => tbody.appendChild(row));
};

// 3. Fonction de FILTRE (Recherche Intelligente)
function filterTable(tableId, query) {
    const table = document.getElementById(tableId);
    const rows = table.querySelectorAll('tbody tr');
    const lowerQuery = query.toLowerCase().trim();

    // Détection d'opérateur numérique (ex: >80, <50, 80-90)
    let operator = null;
    let numVal = null;
    let numVal2 = null; // Pour les plages

    if (lowerQuery.startsWith('>')) {
        operator = '>'; numVal = parseFloat(lowerQuery.substring(1));
    } else if (lowerQuery.startsWith('<')) {
        operator = '<'; numVal = parseFloat(lowerQuery.substring(1));
    } else if (lowerQuery.includes('-') && !isNaN(parseFloat(lowerQuery))) {
        // Plage (ex: 70-80)
        const parts = lowerQuery.split('-');
        if (parts.length === 2) {
            operator = 'range';
            numVal = parseFloat(parts[0]);
            numVal2 = parseFloat(parts[1]);
        }
    }

    rows.forEach(row => {
        let match = false;

        // Si c'est une recherche numérique (ex: >80), on cherche dans la colonne Pic (et Durée)
        if (operator && !isNaN(numVal)) {
            // On cherche tous les nombres dans la ligne
            const numbersInRow = row.innerText.match(/(\d+(\.\d+)?)/g);
            if (numbersInRow) {
                for (let nStr of numbersInRow) {
                    const n = parseFloat(nStr);
                    if (operator === '>' && n >= numVal) match = true;
                    if (operator === '<' && n <= numVal) match = true;
                    if (operator === 'range' && n >= numVal && n <= numVal2) match = true;
                }
            }
        }
        // Sinon, recherche texte classique
        else {
            if (row.innerText.toLowerCase().includes(lowerQuery)) match = true;
        }

        // Afficher ou masquer
        row.style.display = match ? '' : 'none';
    });
}