/* /home/obafgk/SoundProject/metriful_web/static/js/main_v2.js */

console.log("🚀 Démarrage de main_v2.js (Version Finale Complète)...");

let charts = {};
let currentPeriod = '24h';
let currentData = {};
let wavesurfer = null;

let previousKPIs = {};

const eventStyles = {
    'Sirène': { color: '#dd4b39', style: 'triangle', size: 8 },
    'Moteur': { color: '#95a5a6', style: 'rect', size: 7 },
    'Voix': { color: '#00c0ef', style: 'circle', size: 6 },
    'Musique': { color: '#605ca8', style: 'star', size: 9 },
    'Autre': { color: '#ff851b', style: 'rectRot', size: 7 }
};

Chart.defaults.color = '#b8c7ce';
Chart.defaults.scale.grid.color = '#3e3e3e';
Chart.defaults.borderColor = '#3e3e3e';

// --- Gestion Date ---
function toLocalISOString(date) {
    try {
        const offset = date.getTimezoneOffset() * 60000;
        return (new Date(date - offset)).toISOString().slice(0, 16);
    } catch (e) { return ""; }
}

document.addEventListener('DOMContentLoaded', function () {
    const datePicker = document.getElementById('date-picker');
    if (datePicker) datePicker.value = toLocalISOString(new Date());

    console.log("Chargement initial des données via API...");
    fetchDataAndUpdate('24h', null, true);

    document.querySelectorAll('.period-btn').forEach(button => {
        button.addEventListener('click', function () {
            if (document.body.classList.contains('loading')) return;
            currentPeriod = this.dataset.period;
            document.querySelector('.period-btn.active').classList.remove('active');
            this.classList.add('active');
            fetchDataAndUpdate(currentPeriod, datePicker.value);
        });
    });

    const validateBtn = document.getElementById('validate-date-btn');
    if (validateBtn) validateBtn.addEventListener('click', () => fetchDataAndUpdate(currentPeriod, datePicker.value));

    const eventSource = new EventSource("/api/stream_events");
    eventSource.onmessage = function (event) {
        if (event.data === "new_event") {
            console.log("🔔 SSE: Nouvel événement sonore !");
            showNotification("🔊 Nouvel événement sonore détecté !");
            setTimeout(() => fetchDataAndUpdate(currentPeriod, null, false), 2000);
        } else if (event.data === "new_sensor") {
            console.log("🌡️ SSE: Nouvelles données capteurs !");
            fetchAndUpdateKPIs();
        }
    };
});

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
    } catch (error) {
        console.error('Erreur Fetch:', error);
    } finally {
        if (showOverlay) document.body.classList.remove('loading');
    }
}

async function fetchAndUpdateKPIs() {
    try {
        const response = await fetch(`/api/data?period=1h&_nocache=${Date.now()}`);
        if (!response.ok) return;
        const newData = await response.json();

        currentData.kpis = newData.kpis;
        currentData.window_status = newData.window_status;

        updateKPIs(newData.kpis);
        const lastUpdatedEl = document.getElementById('last-updated');
        if (lastUpdatedEl && newData.kpis) lastUpdatedEl.innerHTML = `MàJ : ${formatISODate(newData.kpis.timestamp)}`;
    } catch (error) {
        console.error('Erreur Fetch KPIs:', error);
    }
}

function updateDashboardUI(data, period) {
    if (!data) return;
    const lastUpdatedEl = document.getElementById('last-updated');
    if (lastUpdatedEl && data.kpis) lastUpdatedEl.innerHTML = `MàJ : ${formatISODate(data.kpis.timestamp)}`;

    updateKPIs(data.kpis);
    updateAllCharts(data, period);
    updateEventsTable(data.events_period, 'events-period-table');
    updateEventsTable(data.top_events, 'top-events-table');
}

// --- FONCTION MANQUANTE RÉINTÉGRÉE ICI ---
// Remplacez la fonction updateKPIs par celle-ci
// Variable globale pour la dernière mesure




function updateKPIs(kpis) {
    const container = document.getElementById('kpi-container');
    if (!container || !kpis) return;

    // Helper pour générer une ligne de tendance long terme
    function generateLongTermTrendHTML(kpi_data, period, decimals) {
        const delta = kpi_data[`delta_${period}`];
        if (delta === null || delta === undefined) return '';

        const trendClass = delta > 0 ? 'trend-up' : 'trend-down';
        const trendIcon = delta > 0 ? 'fa-arrow-up' : 'fa-arrow-down';
        const diffText = `${delta > 0 ? '+' : ''}${delta.toFixed(decimals)}`;

        // On utilise la classe 'kpi-trend' générale pour le style
        return `<span class="kpi-trend ${trendClass}">
                    <i class="fa ${trendIcon}"></i> ${diffText} (${period})
                </span>`;
    }

    const kpiConfig = [
        { key: 'temperature_c', label: 'Temp', icon: 'fa-thermometer-half', color: 'bg-red', unit: ' °C', decimals: 1 },
        { key: 'humidity_pct', label: 'Humidité', icon: 'fa-percent', color: 'bg-green', unit: ' %', decimals: 0 },
        { key: 'sound_spl_dba', label: 'Son', icon: 'fa-volume-up', color: 'bg-purple', unit: ' dBA', decimals: 1 },
        { key: 'light_lux', label: 'Lumière', icon: 'fa-sun', color: 'bg-yellow', unit: ' Lx', decimals: 0 },
        { key: 'bsec_co2_ppm', label: 'CO₂', icon: 'fa-cloud', color: 'bg-red', unit: ' ppm', decimals: 0 },
        { key: 'aqi', label: 'AQI', icon: 'fa-leaf', color: 'bg-green', unit: '', decimals: 0 },
        { key: 'pressure_pa', label: 'Pression', icon: 'fa-tachometer-alt', color: 'bg-aqua', unit: ' hPa', decimals: 0, transform: v => v / 100 },
        { key: 'humidex', label: 'Humidex', icon: 'fa-tint', color: 'bg-yellow', unit: '', decimals: 1 }
    ];

    container.innerHTML = kpiConfig.map(conf => {
        const kpi_data = kpis[conf.key];
        if (!kpi_data) return '';

        let currentValue = kpi_data.value;
        if (conf.transform) currentValue = conf.transform(currentValue);
        const formattedValue = formatValue(currentValue, conf.decimals, conf.unit);

        // Tendance immédiate
        let immediateTrendHTML = '';
        const previousValue = previousKPIs[conf.key];
        if (previousValue !== undefined && currentValue !== null && previousValue !== null) {
            const diff = currentValue - previousValue;
            if (Math.abs(diff) > 0.05) {
                const trendClass = diff > 0 ? 'trend-up' : 'trend-down';
                const trendIcon = diff > 0 ? 'fa-arrow-up' : 'fa-arrow-down';
                const diffText = `${diff > 0 ? '+' : ''}${diff.toFixed(conf.decimals)}`;
                immediateTrendHTML = `<span class="kpi-trend ${trendClass}">
                                        <i class="fa ${trendIcon}"></i> ${diffText}
                                      </span>`;
            }
        }

        // Tendances long terme
        const trend24h = generateLongTermTrendHTML(kpi_data, '24h', conf.decimals);
        const trend7d = generateLongTermTrendHTML(kpi_data, '7d', conf.decimals);
        const trend30d = generateLongTermTrendHTML(kpi_data, '30d', conf.decimals);

        return `
            <div class="col-md-3 col-sm-6 col-xs-12">
                <div class="info-box">
                    <span class="info-box-icon ${conf.color}"><i class="fa ${conf.icon}"></i></span>
                    <div class="info-box-content">
                        <span class="info-box-text">${conf.label}</span>
                        <!-- ON MET TOUT DANS LE MÊME CONTENEUR -->
                        <div class="kpi-value-container">
                            <span class="info-box-number">${formattedValue}</span>
                            ${immediateTrendHTML}
                            ${trend24h}
                            ${trend7d}
                            ${trend30d}
                        </div>
                    </div>
                </div>
            </div>`;
    }).join('');

    if (kpis.temperature_c) {
        previousKPIs = {
            temperature_c: kpis.temperature_c.value, humidity_pct: kpis.humidity_pct.value,
            pressure_pa: kpis.pressure_pa.value, aqi: kpis.aqi.value,
            bsec_co2_ppm: kpis.bsec_co2_ppm.value, light_lux: kpis.light_lux.value,
            sound_spl_dba: kpis.sound_spl_dba.value
        };
    }
}


function createSensorChart(canvasId, label, dataKey, color, unit, historyData, period, transformFunc = v => v, isLog = false) {
    if (charts[canvasId]) { charts[canvasId].destroy(); charts[canvasId] = null; }
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    if (!historyData || historyData.length === 0) return;
    const chartData = historyData.map(d => { if (!d.timestamp || d[dataKey] == null) return null; let val = transformFunc(d[dataKey]); if (isLog && val <= 0) val = 0.1; return { x: new Date(d.timestamp), y: val }; }).filter(p => p !== null);
    const datasets = [{ label: label, data: chartData, borderColor: color, backgroundColor: color + '33', borderWidth: 2, pointRadius: 0, tension: 0.2, fill: true, spanGaps: true }];
    const rollingMeanKey = dataKey + '_rolling_mean';
    const rollingData = historyData.map(d => { if (!d.timestamp || d[rollingMeanKey] == null) return null; return { x: new Date(d.timestamp), y: transformFunc(d[rollingMeanKey]) }; }).filter(p => p !== null);
    if (rollingData.length > 0) datasets.push({ label: 'Tendance', data: rollingData, borderColor: '#fff', borderWidth: 1, pointRadius: 0, tension: 0.4, borderDash: [5, 5], spanGaps: true });
    let timeUnit = 'hour'; if (period === '7d' || period === '30d') timeUnit = 'day';
    charts[canvasId] = new Chart(ctx, { type: 'line', data: { datasets: datasets }, options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { display: false } }, scales: { x: { type: 'time', time: { unit: timeUnit, displayFormats: { hour: 'HH:mm', day: 'dd/MM' } }, grid: { color: '#3e3e3e' }, ticks: { color: '#b8c7ce' } }, y: { type: isLog ? 'logarithmic' : 'linear', grid: { color: '#3e3e3e' }, ticks: { color: '#b8c7ce' } } }, animation: false } });
}

function updateAllCharts(data, period) {
    const h = data ? data.history_data : [];
    const configs = [{ id: 'tempChart', key: 'temperature_c', color: '#dd4b39' }, { id: 'humidChart', key: 'humidity_pct', color: '#00a65a' }, { id: 'pressureChart', key: 'pressure_pa', color: '#00c0ef', transform: v => v / 100 }, { id: 'lightChart', key: 'light_lux', color: '#f39c12', isLog: true }, { id: 'soundChart', key: 'sound_spl_dba', color: '#605ca8' }, { id: 'aqiChart', key: 'aqi', color: '#00a65a' }, { id: 'co2Chart', key: 'bsec_co2_ppm', color: '#dd4b39' }];
    configs.forEach(c => createSensorChart(c.id, c.label, c.key, c.color, c.unit, h, period, c.transform, c.isLog));
    if (charts['eventsChart']) { charts['eventsChart'].destroy(); charts['eventsChart'] = null; }
    createEventsChart('eventsChart', data ? data.events_period : []);
    if (charts['eventsTimelineChart']) { charts['eventsTimelineChart'].destroy(); charts['eventsTimelineChart'] = null; }
    createEventsTimelineChart('eventsTimelineChart', data ? data.events_period : [], period);
}

function createEventsTimelineChart(canvasId, eventsData, period) {
    if (charts[canvasId]) { charts[canvasId].destroy(); charts[canvasId] = null; }
    const ctx = document.getElementById(canvasId); if (!ctx) return;
    const now = new Date(); const periodHours = { '1h': 1, '24h': 24, '7d': 168, '30d': 720 }; const hoursBack = periodHours[period] || 24; const maxTime = now.getTime() + (hoursBack * 60 * 60 * 1000) * 0.05; const minTime = maxTime - (hoursBack * 60 * 60 * 1000);
    const validEvents = (eventsData || []).filter(e => e.start_time_iso && !isNaN(new Date(e.start_time_iso).getTime()) && new Date(e.start_time_iso).getTime() > 946684800000);
    const MIN_DBA = 40; const MAX_DBA = 100; function calculateRadius(dba) { if (!dba) return 6; const c = Math.max(MIN_DBA, Math.min(MAX_DBA, dba)); return 6 + ((c - MIN_DBA) / (MAX_DBA - MIN_DBA)) * 14; }
    const datasets = Object.keys(eventStyles).map(eventType => {
        const style = eventStyles[eventType]; const data = validEvents.filter(e => e.sound_type === eventType).map(e => ({ x: new Date(e.start_time_iso).getTime(), y: eventType, dba: e.peak_spl_dba || 0 })); if (data.length === 0) return null; return { label: eventType, data: data, backgroundColor: style.color, borderColor: '#fff', borderWidth: 1, pointStyle: style.style, radius: data.map(d => calculateRadius(d.dba)) };
    }).filter(ds => ds !== null);
    let timeUnit = 'hour'; if (period === '7d' || period === '30d') timeUnit = 'day';
    charts[canvasId] = new Chart(ctx, { type: 'scatter', data: { datasets: datasets }, options: { responsive: true, maintainAspectRatio: false, layout: { padding: 10 }, plugins: { legend: { labels: { color: '#b8c7ce' } } }, scales: { x: { type: 'time', min: minTime, max: maxTime, time: { unit: timeUnit, displayFormats: { hour: 'HH:mm', day: 'dd/MM' } }, grid: { color: '#3e3e3e' }, ticks: { color: '#b8c7ce' } }, y: { type: 'category', offset: true, grid: { color: '#3e3e3e' }, ticks: { color: '#b8c7ce' } } }, animation: false } });
}

function createEventsChart(canvasId, eventsData) {
    const ctx = document.getElementById(canvasId); if (!ctx) return; const labels = Array.from({ length: 24 }, (_, i) => `${i}h`); const data = new Array(24).fill(0); (eventsData || []).forEach(e => { if (e.start_time_iso) data[new Date(e.start_time_iso).getHours()]++; });
    charts[canvasId] = new Chart(ctx, { type: 'bar', data: { labels, datasets: [{ label: 'Evénements', data, backgroundColor: '#dd4b39' }] }, options: { responsive: true, maintainAspectRatio: false, scales: { x: { grid: { display: false } }, y: { grid: { color: '#3e3e3e' } } } } });
}

function updateEventsTable(events, tableId) {
    const tbody = document.querySelector(`#${tableId} tbody`);
    if (!tbody) return;

    if (!events || events.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center">Aucun événement</td></tr>';
        return;
    }

    // Génération du HTML des lignes (différent selon le tableau)
    let tableHTML = '';

    if (tableId === 'top-events-table') {
        // --- AFFICHAGE SIMPLIFIÉ POUR LE TOP 20 ---
        tableHTML = events.map(e => `
            <tr>
                <td>${formatISODate(e.start_time_iso)}</td>
                <td><span class="badge" style="background-color: ${eventStyles[e.sound_type]?.color || '#777'}">${e.sound_type}</span></td>
                <td><strong>${formatValue(e.peak_spl_dba, 1, ' dBA')}</strong></td>
                <td>${e.audio_filename ? `<button class="action-btn" onclick="playAudio('${e.audio_filename}')"><i class="fa fa-play"></i></button>` : ''}</td>
            </tr>
        `).join('');

    } else {
        // --- AFFICHAGE COMPLET POUR LES ÉVÉNEMENTS DE LA PÉRIODE ---
        tableHTML = events.map(e => `
            <tr>
                <td>${formatISODate(e.start_time_iso)}</td>
                <td><span class="badge" style="background-color: ${eventStyles[e.sound_type]?.color || '#777'}">${e.sound_type}</span></td>
                <td>${e.duration_s !== undefined ? e.duration_s + 's' : '--'}</td>
                <td>${formatValue(e.peak_spl_dba, 1, ' dBA')}</td>
                <td style="font-style: italic; color: #888;">${e.duration_since_prev || '-'}</td>
                <td>${e.spectral_bands ? `<div style="width: 80px; height: 30px;"><canvas id="mini-spec-${tableId}-${e.id}"></canvas></div>` : '--'}</td>
                <td>${e.audio_filename ? `<button class="action-btn" onclick="playAudio('${e.audio_filename}')"><i class="fa fa-play"></i></button>` : ''}</td>
            </tr>
        `).join('');
    }

    tbody.innerHTML = tableHTML;

    // Dessin des mini spectres (uniquement pour le tableau des événements de la période)
    if (tableId === 'events-period-table') {
        events.forEach(e => {
            if (e.spectral_bands) drawMiniSpectrum(`mini-spec-${tableId}-${e.id}`, e.spectral_bands);
        });
    }
}

function formatISODate(isoString) { try { return new Intl.DateTimeFormat('fr-FR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(isoString)); } catch (e) { return '--'; } }
function formatValue(v, d = 0, u = '') { return (v != null && !isNaN(v)) ? parseFloat(v).toFixed(d) + u : '--'; }
function drawMiniSpectrum(id, d) { const c = document.getElementById(id); if (c) new Chart(c, { type: 'bar', data: { labels: [1, 2, 3, 4, 5, 6], datasets: [{ data: d, backgroundColor: '#605ca8' }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: false, tooltip: false }, scales: { x: { display: false }, y: { display: false } }, animation: false } }); }

function playAudio(f) {
    const c = document.getElementById('global-audio-player-container'); if (!c) return; if (wavesurfer) { wavesurfer.destroy(); wavesurfer = null; }
    const audioEl = new Audio(); audioEl.src = '/audio_files/' + f; audioEl.crossOrigin = "anonymous"; audioEl.volume = 0.8;
    c.innerHTML = `<div class="waveform-wrapper" style="display:flex;align-items:center;gap:20px;background:#2d2d2d;padding:15px;border-top:4px solid #00c0ef;box-shadow:0 -5px 15px rgba(0,0,0,0.5);"><div class="waveform-controls"><button id="pp_btn" class="btn-play-pause" style="width:60px;height:60px;font-size:24px;border-radius:50%;background:#00c0ef;border:none;color:white;cursor:pointer;"><i class="fa fa-play"></i></button></div><div class="waveform-visual" style="flex-grow:1;"><div id="wf"></div></div><div style="display:flex;flex-direction:column;align-items:center;gap:5px;"><i id="vol_icon" class="fa fa-volume-up" style="color:#b8c7ce;cursor:pointer;font-size:18px;"></i><input type="range" id="vol_slider" min="0" max="1" step="0.05" value="0.8" style="width:150px;cursor:pointer;accent-color:#00c0ef;"></div><button class="btn-close-player" id="close_btn" style="background:none;border:none;color:#777;font-size:24px;cursor:pointer;margin-left:10px;"><i class="fa fa-times"></i></button></div>`;
    wavesurfer = WaveSurfer.create({ container: '#wf', media: audioEl, waveColor: '#00c0ef', progressColor: '#ffffff', height: 100, normalize: true, cursorWidth: 2, barWidth: 3, barGap: 2, barRadius: 3 });
    wavesurfer.on('ready', () => { wavesurfer.play(); document.getElementById('pp_btn').innerHTML = '<i class="fa fa-pause"></i>'; });
    wavesurfer.on('finish', () => { document.getElementById('pp_btn').innerHTML = '<i class="fa fa-play"></i>'; });
    document.getElementById('pp_btn').onclick = () => { wavesurfer.playPause(); const icon = wavesurfer.isPlaying() ? 'fa-pause' : 'fa-play'; document.getElementById('pp_btn').innerHTML = `<i class="fa ${icon}"></i>`; };
    const volSlider = document.getElementById('vol_slider'); const volIcon = document.getElementById('vol_icon'); let lastVolume = 0.8;
    volSlider.oninput = function () { const val = parseFloat(this.value); audioEl.volume = val; updateVolIcon(val); if (val > 0) lastVolume = val; };
    volIcon.onclick = function () { if (audioEl.volume > 0) { audioEl.volume = 0; volSlider.value = 0; updateVolIcon(0); } else { audioEl.volume = lastVolume; volSlider.value = lastVolume; updateVolIcon(lastVolume); } };
    function updateVolIcon(val) { if (val === 0) volIcon.className = 'fa fa-volume-off'; else if (val < 0.5) volIcon.className = 'fa fa-volume-down'; else volIcon.className = 'fa fa-volume-up'; }
    document.getElementById('close_btn').onclick = () => { if (wavesurfer) { wavesurfer.destroy(); wavesurfer = null; } c.innerHTML = ''; };
}

let notifTimeout;
function showNotification(message) {
    const banner = document.getElementById('notification-banner'); const textSpan = document.getElementById('notif-text');
    if (!banner || !textSpan) return; textSpan.textContent = message; banner.classList.add('visible'); if (notifTimeout) clearTimeout(notifTimeout);
    notifTimeout = setTimeout(() => { banner.classList.remove('visible'); }, 10000);
}