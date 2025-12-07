/* /home/obafgk/SoundProject/metriful_web/static/js/main_v2.js */

let charts = {}; 
let currentPeriod = '24h';
let currentData = {};
let currentAudioElement = null;
let newEventCount = 0;
let wavesurfer = null;
let refreshInterval = null;

const eventStyles = {
    'Sirène':  { color: '#dd4b39', style: 'triangle', size: 8 },
    'Moteur':  { color: '#95a5a6', style: 'rect', size: 7 },
    'Voix':    { color: '#00c0ef', style: 'circle', size: 6 },
    'Musique': { color: '#605ca8', style: 'star', size: 9 },
    'Autre':   { color: '#ff851b', style: 'rectRot', size: 7 }
};

Chart.defaults.color = '#b8c7ce';
Chart.defaults.scale.grid.color = '#3e3e3e'; 
Chart.defaults.borderColor = '#3e3e3e';

function toLocalISOString(date) {
    const tzoffset = date.getTimezoneOffset() * 60000;
    const localISOTime = (new Date(date - tzoffset)).toISOString().slice(0, -1);
    return localISOTime.substring(0, 16);
}

document.addEventListener('DOMContentLoaded', function() {
    const datePicker = document.getElementById('date-picker');
    datePicker.value = toLocalISOString(new Date());

    // Chargement initial
    if (typeof initialData !== 'undefined') {
        currentData = initialData;
        updateDashboardUI(initialData, currentPeriod);
    }
    
    // Mise à jour automatique toutes les 60s si on est sur "aujourd'hui"
    startRefreshTimer();

    // SSE pour les événements
    const eventSource = new EventSource("/api/stream_events");
    eventSource.onmessage = function(event) {
        if (event.data === "new_event") {
            console.log("🔔 Notification SSE");
            if (isViewingToday()) {
                newEventCount++;
                updateNewEventCounter();
                // Délai de sécurité pour la DB
                setTimeout(() => {
                    console.log("🔄 Mise à jour suite événement");
                    fetchDataAndUpdate(currentPeriod, null, false); // false = pas d'overlay
                }, 2000);
            }
        }
    };
    eventSource.onerror = function(err) { };

    document.querySelectorAll('.period-btn').forEach(button => {
        button.addEventListener('click', function() {
            if (document.body.classList.contains('loading')) return;
            currentPeriod = this.dataset.period;
            document.querySelector('.period-btn.active').classList.remove('active');
            this.classList.add('active');
            // Clic bouton = mise à jour avec la date du picker
            fetchDataAndUpdate(currentPeriod, datePicker.value);
        });
    });

    const validateBtn = document.getElementById('validate-date-btn');
    if(validateBtn) {
        validateBtn.addEventListener('click', function() {
            if (document.body.classList.contains('loading')) return;
            fetchDataAndUpdate(currentPeriod, datePicker.value);
        });
    }
});

function isViewingToday() {
    const datePicker = document.getElementById('date-picker');
    if (!datePicker.value) return true;
    const selectedDate = new Date(datePicker.value);
    const today = new Date();
    return selectedDate.getDate() === today.getDate() &&
           selectedDate.getMonth() === today.getMonth() &&
           selectedDate.getFullYear() === today.getFullYear();
}

function startRefreshTimer() {
    if (refreshInterval) clearInterval(refreshInterval);
    refreshInterval = setInterval(() => {
        // Si on regarde aujourd'hui, on rafraîchit tout silencieusement chaque minute
        if (isViewingToday() && !document.body.classList.contains('loading')) {
            fetchDataAndUpdate(currentPeriod, null, false); // false = pas d'overlay
        }
    }, 60000);
}

function updateNewEventCounter() {
    const counterElement = document.getElementById('new-event-counter');
    if (counterElement) {
        counterElement.textContent = newEventCount;
        counterElement.style.display = newEventCount > 0 ? 'inline-block' : 'none';
    }
}

// showOverlay = true par défaut (chargement manuel), false pour auto-refresh
async function fetchDataAndUpdate(period, refDateStr = null, showOverlay = true) {
    if (showOverlay) {
        const loadingMessage = document.getElementById('loading-message');
        if (loadingMessage) loadingMessage.textContent = "Chargement...";
        document.body.classList.add('loading');
        newEventCount = 0;
        updateNewEventCounter();
    }

    // Cache buster pour forcer la fraîcheur
    let url = `/api/data?period=${period}&_nocache=${Date.now()}`;
    
    // Si on fournit une date explicite (clic bouton valider ou changement période)
    if (refDateStr && refDateStr.length > 10) {
        const isoDate = new Date(refDateStr).toISOString();
        url += `&ref_date=${isoDate}`;
    }

    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error('Réponse NOK');
        
        const newData = await response.json();
        currentData = newData; // On met tout à jour
        updateDashboardUI(newData, period);

    } catch (error) {
        console.error('Erreur Fetch:', error);
        if (showOverlay) alert("Erreur chargement.");
    } finally {
        if (showOverlay) document.body.classList.remove('loading');
    }
}

function updateDashboardUI(data, period) {
    const lastUpdatedEl = document.getElementById('last-updated');
    if (lastUpdatedEl && data && data.kpis && data.kpis.timestamp) {
         lastUpdatedEl.innerHTML = `MàJ : ${formatISODate(data.kpis.timestamp)}`;
    }
    updateKPIs(data ? data.kpis : null);
    updateAllCharts(data, period); 
    updateEventsTable(data ? data.events_period : [], 'events-period-table', true);
    updateEventsTable(data ? data.top_events : [], 'top-events-table', true);
}

// ... (Les fonctions suivantes sont inchangées par rapport à la dernière version qui fonctionnait)

function formatISODate(isoString) {
    if (!isoString || isoString === '--') return '--';
    try {
        const dateObj = new Date(isoString);
        return new Intl.DateTimeFormat('fr-FR', { year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(dateObj);
    } catch (e) { return isoString; }
}

function formatValue(value, decimals = 0, unit = '') {
    if (value === null || value === undefined || isNaN(parseFloat(value))) return '--';
    return `${parseFloat(value).toFixed(decimals)}${unit}`;
}

function updateKPIs(kpis) {
    const container = document.getElementById('kpi-container');
    if (!kpis) { container.innerHTML = '<p>Pas de données KPI.</p>'; return; }
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

    let html = '';
    let windowStatus = 'Inconnu';
    let windowColor = 'bg-aqua';
    if (currentData && currentData.window_status) {
        const s = currentData.window_status.status;
        windowStatus = s.charAt(0).toUpperCase() + s.slice(1);
        windowColor = (s === 'ouverte') ? 'bg-red' : 'bg-green';
    }

    kpiConfig.forEach(conf => {
        html += `<div class="col-md-6 col-sm-6 col-xs-12">`;
        let val = '--'; let colorClass = conf.color;
        if (conf.isWindow) { val = windowStatus; colorClass = windowColor; } else { val = formatValue(kpis[conf.key], conf.decimals, conf.unit); }
        html += `<div class="info-box"><span class="info-box-icon ${colorClass}"><i class="fa ${conf.icon}"></i></span><div class="info-box-content"><span class="info-box-text">${conf.label}</span><span class="info-box-number">${val}</span></div></div></div>`;
    });
    container.innerHTML = html;
}

function updateAllCharts(data, period) {
    const historyData = data ? data.history_data : [];
    const chartConfigs = [ 
        { id: 'tempChart', label: 'Température', key: 'temperature_c', color: '#dd4b39', unit: '°C' }, 
        { id: 'humidChart', label: 'Humidité', key: 'humidity_pct', color: '#00a65a', unit: '%' }, 
        { id: 'pressureChart', label: 'Pression', key: 'pressure_pa', color: '#00c0ef', unit: 'hPa', transform: v => v/100 }, 
        { id: 'lightChart', label: 'Luminosité', key: 'light_lux', color: '#f39c12', unit: 'Lux', isLog: true }, 
        { id: 'soundChart', label: 'Niveau Sonore', key: 'sound_spl_dba', color: '#605ca8', unit: 'dBA' }, 
        { id: 'aqiChart', label: 'AQI', key: 'aqi', color: '#00a65a', unit: 'AQI' }, 
        { id: 'co2Chart', label: 'CO₂', key: 'bsec_co2_ppm', color: '#dd4b39', unit: 'ppm' } 
    ];

    chartConfigs.forEach(config => {
        if (charts[config.id]) charts[config.id].destroy();
        if (historyData && historyData.length > 0 && historyData.some(d => d[config.key] !== null)) {
            createSensorChart(config.id, config.label, config.key, config.color, config.unit, historyData, period, config.transform, config.isLog);
        }
    });
    
    if (charts['eventsChart']) charts['eventsChart'].destroy();
    createEventsChart('eventsChart', data ? data.events_period : []);
    if (charts['eventsTimelineChart']) charts['eventsTimelineChart'].destroy();
    createEventsTimelineChart('eventsTimelineChart', data ? data.events_period : [], period);
}

function createSensorChart(canvasId, label, dataKey, color, unit, historyData, period, transformFunc = v => v, isLog = false) {
    const ctx = document.getElementById(canvasId).getContext('2d');
    const chartData = historyData.map(d => {
        let val = d[dataKey] !== null ? transformFunc(d[dataKey]) : null;
        if (isLog && val !== null && val <= 0) val = 0.1;
        return { x: new Date(d.timestamp), y: val };
    });
    const datasets = [{ label: label, data: chartData, borderColor: color, backgroundColor: color + '33', borderWidth: 2, pointRadius: 0, tension: 0.1, fill: true }];
    const rollingMeanKey = dataKey + '_rolling_mean';
    if (historyData.some(d => d[rollingMeanKey] !== null)) {
        const rollingMeanData = historyData.map(d => {
            let val = d[rollingMeanKey] !== null ? transformFunc(d[rollingMeanKey]) : null;
            if (isLog && val !== null && val <= 0) val = 0.1;
            return { x: new Date(d.timestamp), y: val };
        });
        datasets.push({ label: 'Tendance', data: rollingMeanData, borderColor: '#ffffff', borderWidth: 1, pointRadius: 0, tension: 0.4, borderDash: [5, 5] });
    }
    if (canvasId === 'tempChart' && historyData.some(d => d.humidex !== null)) {
        const humidexData = historyData.map(d => ({ x: new Date(d.timestamp), y: d.humidex }));
        datasets.push({ label: 'Humidex', data: humidexData, borderColor: '#f39c12', borderWidth: 1.5, pointRadius: 0, tension: 0.1 });
    }
    let timeUnit = 'hour'; let timeTooltipFormat = 'dd/MM HH:mm';
    if (period === '7d' || period === '30d') { timeUnit = 'day'; timeTooltipFormat = 'dd/MM/yyyy'; }
    charts[canvasId] = new Chart(ctx, {
        type: 'line', data: { datasets: datasets },
        options: {
            responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
            plugins: { legend: { display: false }, tooltip: { callbacks: { filter: function(tooltipItem) { return tooltipItem.parsed.y !== null; } } } },
            scales: {
                x: { type: 'time', time: { unit: timeUnit, tooltipFormat: timeTooltipFormat, displayFormats: { hour: 'HH:mm', day: 'dd/MM' } }, grid: { color: '#3e3e3e' } },
                y: { type: isLog ? 'logarithmic' : 'linear', title: { display: true, text: unit }, grid: { color: '#3e3e3e' } }
            }, animation: false
        }
    });
}

function createEventsTimelineChart(canvasId, eventsData, period) {
    const ctx = document.getElementById(canvasId); if (!ctx) return;
    if (!eventsData || eventsData.length === 0) { const c = ctx.getContext('2d'); c.clearRect(0,0,ctx.width,ctx.height); c.font="16px sans-serif"; c.fillStyle="#aaa"; c.textAlign="center"; c.fillText("Aucun événement", ctx.width/2, ctx.height/2); return; }
    
    const MIN_DBA = 65; const MAX_DBA = 100; const MIN_RADIUS = 5; const MAX_RADIUS = 15;
    function calculateRadius(dba) { if (dba===null) return MIN_RADIUS; const c=Math.max(MIN_DBA,Math.min(MAX_DBA,dba)); return MIN_RADIUS+((c-MIN_DBA)/(MAX_DBA-MIN_DBA))*(MAX_RADIUS-MIN_RADIUS); }
    
    const datePicker = document.getElementById('date-picker');
    const endDate = (isViewingToday() && !datePicker.value) ? new Date() : (datePicker.value ? new Date(datePicker.value) : new Date());
    const periodMap = { '1h': 3600*1000, '24h': 24*3600*1000, '7d': 7*24*3600*1000, '30d': 30*24*3600*1000 };
    const startDate = new Date(endDate.getTime() - (periodMap[period] || 24*3600*1000));
    let timeUnit = 'hour'; if (period === '7d' || period === '30d') { timeUnit = 'day'; }

    const datasets = Object.keys(eventStyles).map(eventType => {
        const style = eventStyles[eventType];
        const data = eventsData.filter(e => e.sound_type === eventType).map(e => ({ x: new Date(e.start_time_iso).getTime(), y: e.sound_type, dba: e.peak_spl_dba }));
        return { label: eventType, data: data, backgroundColor: style.color, pointStyle: style.style, radius: data.map(d => calculateRadius(d.dba)), hoverRadius: data.map(d => calculateRadius(d.dba)+2) };
    }).filter(ds => ds.data.length > 0);

    charts[canvasId] = new Chart(ctx, {
        type: 'scatter', data: { labels: Object.keys(eventStyles), datasets: datasets },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { labels: { color: '#fff' } }, tooltip: { callbacks: { label: function (c) { const t = new Date(c.parsed.x).toLocaleTimeString('fr-FR'); return `${c.dataset.label} à ${t} (${c.raw.dba.toFixed(1)} dBA)`; } } } },
            scales: { x: { type: 'time', min: startDate.getTime(), max: endDate.getTime(), time: { unit: timeUnit, displayFormats: { hour: 'HH:mm', day: 'dd/MM' } }, grid: { color: '#444' } }, y: { type: 'category', offset: true, grid: { color: '#444' } } },
            animation: false
        }
    });
}

function createEventsChart(canvasId, eventsData) { 
    const ctx = document.getElementById(canvasId); if (!ctx) return;
    const hourCounts = Array(24).fill(0); 
    if(eventsData) eventsData.forEach(e => { if (e.start_time_iso) hourCounts[new Date(e.start_time_iso).getHours()]++; });
    const labels = Array.from({ length: 24 }, (_, i) => `${i}h`); 
    charts[canvasId] = new Chart(ctx, { 
        type: 'bar', 
        data: { labels: labels, datasets: [{ label: "Evénements", data: hourCounts, backgroundColor: '#dd4b39' }] }, 
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } } 
    }); 
}

function updateEventsTable(events, tableId, showActions) {
    const tbody = document.querySelector(`#${tableId} tbody`);
    if (!tbody) return;
    if (!events || events.length === 0) { tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;">Aucun événement.</td></tr>`; return; }
    tbody.innerHTML = events.map(event => `<tr><td>${formatISODate(event.start_time_iso)}</td> <td><span class="badge" style="background-color: ${eventStyles[event.sound_type]?.color || '#777'}">${event.sound_type}</span></td> <td>${event.duration_s !== undefined ? event.duration_s + 's' : '--'}</td> <td>${formatValue(event.peak_spl_dba, 1, ' dBA')}</td> <td>${ event.spectral_bands ? `<div class="mini-spectrum-container"><canvas id="mini-spec-${tableId}-${event.id}"></canvas></div>` : '<span class="text-muted">--</span>' }</td><td> ${ event.audio_filename ? `<button class="action-btn" onclick="playAudio('${event.audio_filename}');">▶ Écouter</button>` : '<span class="text-muted" style="font-size:0.8em">Pas d\'audio</span>' }</td></tr>`).join('');
    events.forEach(event => { if (event.spectral_bands) { drawMiniSpectrum(`mini-spec-${tableId}-${event.id}`, event.spectral_bands); } });
}

function drawMiniSpectrum(canvasId, bands) {
    const canvas = document.getElementById(canvasId); if (!canvas) return;
    new Chart(canvas, { type: 'bar', data: { labels: ['63', '160', '400', '1k', '2.5k', '6.25k'], datasets: [{ data: bands, backgroundColor: '#605ca8', borderRadius: 2, barPercentage: 0.9 }] }, options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { display: false }, tooltip: { enabled: false } }, scales: { x: { display: false }, y: { display: false, beginAtZero: true } }, layout: { padding: 0 } } });
}

function playAudio(filename) { 
    const container = document.getElementById('global-audio-player-container'); if (!container) return; 
    if (wavesurfer) { wavesurfer.destroy(); wavesurfer = null; }
    container.innerHTML = `<div class="waveform-wrapper"><div class="waveform-controls"><button id="btn-play-pause" class="btn-play-pause"><i class="fa fa-play"></i></button></div><div class="waveform-visual"><div class="waveform-info">Lecture : ${filename}</div><div id="waveform"></div></div><button class="btn-close-player" onclick="document.getElementById('global-audio-player-container').innerHTML=''; if(wavesurfer) wavesurfer.destroy();"><i class="fa fa-times"></i></button></div>`;
    try {
        wavesurfer = WaveSurfer.create({ container: '#waveform', waveColor: '#00c0ef', progressColor: '#fff', cursorColor: '#fff', barWidth: 2, barRadius: 3, cursorWidth: 1, height: 50, barGap: 2, normalize: true });
        wavesurfer.load('/audio_files/' + filename);
        const playPauseBtn = document.getElementById('btn-play-pause');
        playPauseBtn.addEventListener('click', function() { wavesurfer.playPause(); });
        wavesurfer.on('ready', function() { wavesurfer.play(); });
        wavesurfer.on('play', function() { playPauseBtn.innerHTML = '<i class="fa fa-pause"></i>'; });
        wavesurfer.on('pause', function() { playPauseBtn.innerHTML = '<i class="fa fa-play"></i>'; });
        wavesurfer.on('finish', function() { playPauseBtn.innerHTML = '<i class="fa fa-play"></i>'; });
    } catch (e) { console.error("Erreur création WaveSurfer", e); }
}
