/* /home/obafgk/SoundProject/metriful_web/static/js/main_v2.js */

console.log("🚀 Démarrage de main_v2.js (Version Finale Corrigée)...");

let charts = {};
let currentPeriod = '24h';
let currentData = {};
let wavesurfer = null; // Déclaration globale

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

// --- Gestion Date Robuste ---
function toLocalISOString(date) {
    try {
        const offset = date.getTimezoneOffset() * 60000;
        return (new Date(date - offset)).toISOString().slice(0, 16);
    } catch (e) {
        console.error("Erreur date ISO:", e);
        return "";
    }
}

document.addEventListener('DOMContentLoaded', function () {
    // 1. Init Date Picker
    const datePicker = document.getElementById('date-picker');
    if (datePicker) {
        datePicker.value = toLocalISOString(new Date());
    }

    // 2. Gestion du chargement des données
    // On force le chargement via API pour éviter les erreurs de syntaxe HTML
    console.log("Chargement des données via API...");
    fetchDataAndUpdate('24h', null, true);

    // 3. Listeners Boutons
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
    if (validateBtn) {
        validateBtn.addEventListener('click', function () {
            fetchDataAndUpdate(currentPeriod, datePicker.value);
        });
    }

    // 4. SSE (Temps réel)
    const eventSource = new EventSource("/api/stream_events");
    eventSource.onmessage = function (event) {
        if (event.data === "new_event") {
            // Petit délai pour laisser le temps à la DB d'écrire
            setTimeout(() => fetchDataAndUpdate(currentPeriod, null, false), 2000);
        }
    };
});

async function fetchDataAndUpdate(period, refDateStr = null, showOverlay = true) {
    if (showOverlay) document.body.classList.add('loading');

    // Ajout d'un timestamp pour éviter le cache navigateur
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

function updateDashboardUI(data, period) {
    if (!data) return;

    // Mise à jour date de mise à jour
    const lastUpdatedEl = document.getElementById('last-updated');
    if (lastUpdatedEl && data.kpis) {
        lastUpdatedEl.innerHTML = `MàJ : ${formatISODate(data.kpis.timestamp)}`;
    }

    updateKPIs(data.kpis);
    updateAllCharts(data, period);
    updateEventsTable(data.events_period, 'events-period-table');
    updateEventsTable(data.top_events, 'top-events-table');
}

// --- GRAPHIQUES CAPTEURS (AVEC FIX SPANGAPS) ---
function createSensorChart(canvasId, label, dataKey, color, unit, historyData, period, transformFunc = v => v, isLog = false) {
    if (charts[canvasId]) {
        charts[canvasId].destroy();
        charts[canvasId] = null;
    }
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    if (!historyData || historyData.length === 0) return;

    // Préparation données
    const chartData = historyData.map(d => {
        if (!d.timestamp || d[dataKey] == null) return null;
        let val = transformFunc(d[dataKey]);
        if (isLog && val <= 0) val = 0.1;
        return { x: new Date(d.timestamp), y: val };
    }).filter(p => p !== null);

    const datasets = [{
        label: label,
        data: chartData,
        borderColor: color,
        backgroundColor: color + '33',
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.2,
        fill: true,
        spanGaps: true // Permet de relier les points espacés de 1 minute
    }];

    // Tendance
    const rollingMeanKey = dataKey + '_rolling_mean';
    const rollingData = historyData.map(d => {
        if (!d.timestamp || d[rollingMeanKey] == null) return null;
        return { x: new Date(d.timestamp), y: transformFunc(d[rollingMeanKey]) };
    }).filter(p => p !== null);

    if (rollingData.length > 0) {
        datasets.push({
            label: 'Tendance',
            data: rollingData,
            borderColor: '#fff',
            borderWidth: 1,
            pointRadius: 0,
            tension: 0.4,
            borderDash: [5, 5],
            spanGaps: true
        });
    }

    let timeUnit = 'hour';
    let displayFormat = 'HH:mm';
    if (period === '7d' || period === '30d') {
        timeUnit = 'day'; displayFormat = 'dd/MM';
    }

    charts[canvasId] = new Chart(ctx, {
        type: 'line',
        data: { datasets: datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: { legend: { display: false } },
            scales: {
                x: {
                    type: 'time',
                    time: { unit: timeUnit, displayFormats: { hour: 'HH:mm', day: 'dd/MM' } },
                    grid: { color: '#3e3e3e' },
                    ticks: { color: '#b8c7ce' }
                },
                y: {
                    type: isLog ? 'logarithmic' : 'linear',
                    grid: { color: '#3e3e3e' },
                    ticks: { color: '#b8c7ce' }
                }
            },
            animation: false
        }
    });
}

function updateAllCharts(data, period) {
    const h = data ? data.history_data : [];

    // Liste des graphs capteurs
    const configs = [
        { id: 'tempChart', label: 'Température', key: 'temperature_c', color: '#dd4b39', unit: '°C' },
        { id: 'humidChart', label: 'Humidité', key: 'humidity_pct', color: '#00a65a', unit: '%' },
        { id: 'pressureChart', label: 'Pression', key: 'pressure_pa', color: '#00c0ef', unit: 'hPa', transform: v => v / 100 },
        { id: 'lightChart', label: 'Luminosité', key: 'light_lux', color: '#f39c12', unit: 'Lux', isLog: true },
        { id: 'soundChart', label: 'Niveau Sonore', key: 'sound_spl_dba', color: '#605ca8', unit: 'dBA' },
        { id: 'aqiChart', label: 'AQI', key: 'aqi', color: '#00a65a', unit: 'AQI' },
        { id: 'co2Chart', label: 'CO₂', key: 'bsec_co2_ppm', color: '#dd4b39', unit: 'ppm' }
    ];

    configs.forEach(c => {
        createSensorChart(c.id, c.label, c.key, c.color, c.unit, h, period, c.transform, c.isLog);
    });

    // Graphs événements
    if (charts['eventsChart']) { charts['eventsChart'].destroy(); charts['eventsChart'] = null; }
    createEventsChart('eventsChart', data ? data.events_period : []);

    if (charts['eventsTimelineChart']) { charts['eventsTimelineChart'].destroy(); charts['eventsTimelineChart'] = null; }
    createEventsTimelineChart('eventsTimelineChart', data ? data.events_period : [], period);
}

// --- FRISE CHRONOLOGIQUE ---
function createEventsTimelineChart(canvasId, eventsData, period) {
    if (charts[canvasId]) {
        charts[canvasId].destroy();
        charts[canvasId] = null;
    }
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    // Bornes
    const now = new Date();
    const periodHours = { '1h': 1, '24h': 24, '7d': 168, '30d': 720 };
    const hoursBack = periodHours[period] || 24;
    const maxTime = now.getTime();
    const minTime = maxTime - (hoursBack * 60 * 60 * 1000);

    const validEvents = (eventsData || []).filter(e => e.start_time_iso && !isNaN(new Date(e.start_time_iso).getTime()) && new Date(e.start_time_iso).getTime() > 946684800000);

    // Fonction Rayon
    const MIN_DBA = 40; const MAX_DBA = 100;
    function calculateRadius(dba) {
        if (!dba) return 6;
        const c = Math.max(MIN_DBA, Math.min(MAX_DBA, dba));
        return 6 + ((c - MIN_DBA) / (MAX_DBA - MIN_DBA)) * 14;
    }

    const datasets = Object.keys(eventStyles).map(eventType => {
        const style = eventStyles[eventType];
        const data = validEvents.filter(e => e.sound_type === eventType).map(e => ({ x: new Date(e.start_time_iso).getTime(), y: eventType, dba: e.peak_spl_dba || 0 }));
        if (data.length === 0) return null;
        return {
            label: eventType,
            data: data,
            backgroundColor: style.color,
            borderColor: '#fff',
            borderWidth: 1,
            pointStyle: style.style,
            radius: data.map(d => calculateRadius(d.dba))
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
            plugins: { legend: { labels: { color: '#b8c7ce' } } },
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
    const ctx = document.getElementById(canvasId); if (!ctx) return;
    const labels = Array.from({ length: 24 }, (_, i) => `${i}h`);
    const data = new Array(24).fill(0);
    (eventsData || []).forEach(e => { if (e.start_time_iso) data[new Date(e.start_time_iso).getHours()]++; });
    charts[canvasId] = new Chart(ctx, {
        type: 'bar',
        data: { labels, datasets: [{ label: 'Evénements', data, backgroundColor: '#dd4b39' }] },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { grid: { display: false } },
                y: { grid: { color: '#3e3e3e' } }
            }
        }
    });
}

// --- KPI & TABLEAU ---
function updateKPIs(kpis) {
    const container = document.getElementById('kpi-container');
    if (!container || !kpis) return;
    const kpiConfig = [
        { key: 'sound_spl_dba', label: 'Son', icon: 'fa-volume-up', color: 'bg-purple', unit: ' dBA', decimals: 1 },
        { key: 'window', label: 'Fenêtre', icon: 'fa-window-maximize', color: 'bg-aqua', isWindow: true },
        { key: 'temperature_c', label: 'Temp', icon: 'fa-thermometer-half', color: 'bg-red', unit: ' °C', decimals: 1 },
        { key: 'humidity_pct', label: 'Humidité', icon: 'fa-percent', color: 'bg-green', unit: ' %', decimals: 0 },
        { key: 'bsec_co2_ppm', label: 'CO₂', icon: 'fa-cloud', color: 'bg-red', unit: ' ppm', decimals: 0 },
        { key: 'aqi', label: 'AQI', icon: 'fa-leaf', color: 'bg-green', unit: '', decimals: 0 },
        { key: 'light_lux', label: 'Lumière', icon: 'fa-sun', color: 'bg-yellow', unit: ' Lx', decimals: 0 },
        { key: 'humidex', label: 'Humidex', icon: 'fa-tint', color: 'bg-yellow', unit: '', decimals: 1 }
    ];

    let windowStatus = 'Inconnu'; let windowColor = 'bg-aqua';
    if (currentData && currentData.window_status) {
        const s = currentData.window_status.status;
        windowStatus = s.charAt(0).toUpperCase() + s.slice(1);
        windowColor = (s === 'ouverte') ? 'bg-red' : 'bg-green';
    }

    container.innerHTML = kpiConfig.map(conf => {
        let val = '--'; let color = conf.color;
        if (conf.isWindow) { val = windowStatus; color = windowColor; }
        else { val = formatValue(kpis[conf.key], conf.decimals, conf.unit); }
        return `<div class="col-md-3 col-sm-6 col-xs-12"><div class="info-box"><span class="info-box-icon ${color}"><i class="fa ${conf.icon}"></i></span><div class="info-box-content"><span class="info-box-text">${conf.label}</span><span class="info-box-number">${val}</span></div></div></div>`;
    }).join('');
}

function updateEventsTable(events, tableId) {
    const tbody = document.querySelector(`#${tableId} tbody`);
    if (!tbody) return;

    if (!events || events.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center">Aucun événement</td></tr>';
        return;
    }

    tbody.innerHTML = events.map(e => `
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

    // Dessin des mini spectres après insertion HTML
    events.forEach(e => {
        if (e.spectral_bands) drawMiniSpectrum(`mini-spec-${tableId}-${e.id}`, e.spectral_bands);
    });
}

// --- UTILITAIRES ---
function formatISODate(isoString) {
    try {
        return new Intl.DateTimeFormat('fr-FR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(isoString));
    } catch (e) {
        return '--';
    }
}

function formatValue(value, decimals = 0, unit = '') {
    if (value === null || value === undefined || isNaN(parseFloat(value))) {
        return '--';
    }
    return parseFloat(value).toFixed(decimals) + unit;
}

function drawMiniSpectrum(id, d) {
    const c = document.getElementById(id);
    if (!c) return;
    new Chart(c, {
        type: 'bar',
        data: {
            labels: [1, 2, 3, 4, 5, 6],
            datasets: [{ data: d, backgroundColor: '#605ca8' }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: false, tooltip: false },
            scales: { x: { display: false }, y: { display: false } },
            animation: false
        }
    });
}

function playAudio(f) {
    const c = document.getElementById('global-audio-player-container');
    if (!c) return;

    // Nettoyage
    if (wavesurfer) {
        wavesurfer.destroy();
        wavesurfer = null;
    }

    // 1. Élément Audio Natif
    const audioEl = new Audio();
    audioEl.src = '/audio_files/' + f;
    audioEl.crossOrigin = "anonymous";
    audioEl.volume = 0.8;

    // 2. HTML du lecteur (Styles ajustés : Hauteur et Largeur Volume)
    c.innerHTML = `
        <div class="waveform-wrapper" style="display: flex; align-items: center; gap: 20px; background: #2d2d2d; padding: 15px; border-top: 4px solid #00c0ef; box-shadow: 0 -5px 15px rgba(0,0,0,0.5);">
            
            <!-- Bouton Play (Plus gros) -->
            <div class="waveform-controls">
                <button id="pp_btn" class="btn-play-pause" style="width: 60px; height: 60px; font-size: 24px; border-radius: 50%; background: #00c0ef; border: none; color: white; cursor: pointer;">
                    <i class="fa fa-play"></i>
                </button>
            </div>
            
            <!-- Visuel Waveform -->
            <div class="waveform-visual" style="flex-grow: 1;">
                <div id="wf"></div>
            </div>

            <!-- Contrôle Volume (Plus large) -->
            <div style="display: flex; flex-direction: column; align-items: center; gap: 5px;">
                <i id="vol_icon" class="fa fa-volume-up" style="color: #b8c7ce; cursor: pointer; font-size: 18px;"></i>
                <!-- accent-color colorie le slider en bleu -->
                <input type="range" id="vol_slider" min="0" max="1" step="0.05" value="0.8" style="width: 150px; cursor: pointer; accent-color: #00c0ef;">
            </div>

            <!-- Bouton Fermer -->
            <button class="btn-close-player" id="close_btn" style="background: none; border: none; color: #777; font-size: 24px; cursor: pointer; margin-left: 10px;">
                <i class="fa fa-times"></i>
            </button>
        </div>`;

    // 3. Init WaveSurfer (Hauteur augmentée ici)
    wavesurfer = WaveSurfer.create({
        container: '#wf',
        media: audioEl,
        waveColor: '#00c0ef',
        progressColor: '#ffffff',
        height: 100, // <--- Hauteur doublée (était 50)
        normalize: true,
        cursorWidth: 2,
        barWidth: 3, // Barres un peu plus épaisses
        barGap: 2,
        barRadius: 3
    });

    // --- Événements ---

    wavesurfer.on('ready', () => {
        wavesurfer.play();
        document.getElementById('pp_btn').innerHTML = '<i class="fa fa-pause"></i>';
    });
    wavesurfer.on('finish', () => {
        document.getElementById('pp_btn').innerHTML = '<i class="fa fa-play"></i>';
    });

    document.getElementById('pp_btn').onclick = () => {
        wavesurfer.playPause();
        const icon = wavesurfer.isPlaying() ? 'fa-pause' : 'fa-play';
        document.getElementById('pp_btn').innerHTML = `<i class="fa ${icon}"></i>`;
    };

    // --- Volume ---
    const volSlider = document.getElementById('vol_slider');
    const volIcon = document.getElementById('vol_icon');
    let lastVolume = 0.8;

    volSlider.oninput = function () {
        const val = parseFloat(this.value);
        audioEl.volume = val;
        updateVolIcon(val);
        if (val > 0) lastVolume = val;
    };

    volIcon.onclick = function () {
        if (audioEl.volume > 0) {
            audioEl.volume = 0;
            volSlider.value = 0;
            updateVolIcon(0);
        } else {
            audioEl.volume = lastVolume;
            volSlider.value = lastVolume;
            updateVolIcon(lastVolume);
        }
    };

    function updateVolIcon(val) {
        if (val === 0) volIcon.className = 'fa fa-volume-off';
        else if (val < 0.5) volIcon.className = 'fa fa-volume-down';
        else volIcon.className = 'fa fa-volume-up';
    }

    // Fermeture
    document.getElementById('close_btn').onclick = () => {
        if (wavesurfer) {
            wavesurfer.destroy();
            wavesurfer = null;
        }
        c.innerHTML = '';
    };
}