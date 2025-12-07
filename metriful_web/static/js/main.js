/* /home/obafgk/SoundProject/metriful_web/static/js/main.js */

let charts = {};
let currentPeriod = '24h';
let currentData = {};
let currentAudioElement = null;
let newEventCount = 0;

const eventStyles = {
    'Sirène': { color: 'rgba(255, 99, 132, 0.9)', style: 'triangle', size: 8 },
    'Moteur': { color: 'rgba(100, 100, 100, 0.9)', style: 'rect', size: 7 },
    'Voix': { color: 'rgba(54, 162, 235, 0.9)', style: 'circle', size: 6 },
    'Musique': { color: 'rgba(153, 102, 255, 0.9)', style: 'star', size: 9 },
    'Autre': { color: 'rgba(255, 159, 64, 0.7)', style: 'cross', size: 7 }
};

function toLocalISOString(date) {
    const tzoffset = date.getTimezoneOffset() * 60000;
    const localISOTime = (new Date(date - tzoffset)).toISOString().slice(0, -1);
    return localISOTime.substring(0, 16);
}

document.addEventListener('DOMContentLoaded', function () {
    const datePicker = document.getElementById('date-picker');
    datePicker.value = toLocalISOString(new Date());

    if (typeof initialData !== 'undefined') {
        currentData = initialData;
        updateDashboardUI(initialData, currentPeriod);
    }

    const eventSource = new EventSource("/api/stream_events");

    eventSource.onmessage = function (event) {
        if (event.data === "new_event") {
            console.log("Notification de nouvel événement reçue !");
            
            newEventCount++;
            updateNewEventCounter();

            const selectedDate = new Date(datePicker.value);
            const today = new Date();
            const isViewingToday = selectedDate.getDate() === today.getDate() &&
                selectedDate.getMonth() === today.getMonth() &&
                selectedDate.getFullYear() === today.getFullYear();

            if (isViewingToday) {
                console.log("Attente synchronisation DB (2s)...");
                setTimeout(() => {
                    console.log("Lancement du rafraîchissement partiel...");
                    fetchPartialDataAndUpdate();
                }, 2000);
            } else {
                console.log("Notification ignorée (visualisation d'une date passée).");
            }
        }
    };

    eventSource.onerror = function (err) {
        console.error("Erreur EventSource:", err);
    };

    document.querySelectorAll('.period-btn').forEach(button => {
        button.addEventListener('click', function () {
            if (document.body.classList.contains('loading')) return;
            currentPeriod = this.dataset.period;
            document.querySelector('.period-btn.active').classList.remove('active');
            this.classList.add('active');
            fetchDataAndUpdate(currentPeriod, datePicker.value);
        });
    });

    datePicker.addEventListener('change', function () {
        if (document.body.classList.contains('loading')) return;
        fetchDataAndUpdate(currentPeriod, this.value);
    });
});

function updateNewEventCounter() {
    const counterElement = document.getElementById('new-event-counter');
    if (counterElement) {
        counterElement.textContent = newEventCount;
        if (newEventCount > 0) {
            counterElement.style.display = 'inline-block';
        } else {
            counterElement.style.display = 'none';
        }
    }
}

async function fetchPartialDataAndUpdate() {
    // === MODIFICATION MAJEURE ICI ===
    // On force l'URL en mode "Temps Réel".
    // On NE LIT PAS le date-picker ici, pour laisser le serveur utiliser datetime.now()
    // On garde le _nocache pour éviter que le navigateur ne serve une vieille réponse.
    let url = `/api/data?period=${currentPeriod}&_nocache=${Date.now()}`;
    
    // NOTE : J'ai supprimé le bloc 'if (datePicker.value) { ... }' qui causait le bug.

    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error('Réponse serveur NOK');
        const newData = await response.json();

        console.log(`Données reçues. Nombre d'événements : ${newData.events_period.length}`);
        
        // Vérification simple dans la console pour voir si le dernier événement est récent
        if (newData.events_period.length > 0) {
            console.log("Dernier événement reçu :", newData.events_period[0].start_time_iso);
        }

        currentData.events_period = newData.events_period;
        currentData.kpis = newData.kpis;

        updateKPIs(currentData.kpis);
        updateEventsTable(currentData.events_period, 'events-period-table', true);

        if (charts['eventsTimelineChart']) charts['eventsTimelineChart'].destroy();
        createEventsTimelineChart('eventsTimelineChart', currentData.events_period, currentPeriod);
        if (charts['eventsChart']) charts['eventsChart'].destroy();
        createEventsChart('eventsChart', currentData.events_period);

    } catch (error) {
        console.error('Erreur lors du rafraîchissement partiel:', error);
    }
}

async function fetchDataAndUpdate(period, refDateStr = null) {
    newEventCount = 0;
    updateNewEventCounter();

    const loadingMessage = document.getElementById('loading-message');
    const messages = {
        '1h': "Chargement des données...",
        '24h': "Chargement des données sur 24 heures...",
        '7d': "Calcul des données sur 7 jours, veuillez patienter...",
        '30d': "Calcul des données sur 30 jours, cela peut prendre un moment..."
    };
    if (loadingMessage) {
        loadingMessage.textContent = messages[period] || "Chargement en cours...";
    }
    document.body.classList.add('loading');
    let url = `/api/data?period=${period}&_nocache=${Date.now()}`;
    if (refDateStr) {
        const isoDate = new Date(refDateStr).toISOString();
        url += `&ref_date=${isoDate}`;
    }
    try {
        const response = await fetch(url);
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Réponse serveur NOK: ${response.status}. ${errorText}`);
        }
        currentData = await response.json();
        updateDashboardUI(currentData, period);
    } catch (error) {
        console.error('Erreur dans fetchDataAndUpdate:', error);
        alert("Une erreur est survenue lors du chargement des données. Vérifiez la console pour plus de détails.");
    } finally {
        document.body.classList.remove('loading');
    }
}

function formatISODate(isoString) {
    if (!isoString || isoString === '--') return '--';
    try {
        const dateObj = new Date(isoString);
        if (isNaN(dateObj)) return isoString;
        return new Intl.DateTimeFormat('fr-FR', { year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(dateObj);
    } catch (e) {
        return isoString;
    }
}

function updateDashboardUI(data, period) {
    const periodTextMap = { '1h': '1 Heure', '24h': '24 Heures', '7d': '7 Jours', '30d': '30 Jours' };
    const periodText = periodTextMap[period] || 'Période';
    const updateText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    updateText('stats-title', `Statistiques (${periodText})`);
    updateText('charts-title', `Graphiques (${periodText})`);
    updateText('events-period-title', `Événements Sonores (${periodText})`);
    const lastUpdatedEl = document.getElementById('last-updated');
    if (lastUpdatedEl && data && data.kpis && data.kpis.timestamp) {
        lastUpdatedEl.innerHTML = `Dernière mesure : ${formatISODate(data.kpis.timestamp)}`;
    }
    updateKPIs(data ? data.kpis : null);
    updateStats(data ? data.stats : null);
    updateAllCharts(data, period);
    updateEventsTable(data ? data.events_period : [], 'events-period-table', true);
    updateEventsTable(data ? data.top_events : [], 'top-events-table', true);
}

function formatValue(value, decimals = 0, unit = '') {
    if (value === null || value === undefined || isNaN(parseFloat(value))) return '--';
    return `${parseFloat(value).toFixed(decimals)}${unit}`;
}

function updateKPIs(kpis) {
    const container = document.getElementById('kpi-container');
    if (!kpis) { container.innerHTML = '<p>Pas de données KPI.</p>'; return; }
    let humidexHTML = '';
    if (kpis.humidex !== null && kpis.humidex !== undefined) {
        humidexHTML = `<div class="kpi"><h3>Humidex</h3><p>${formatValue(kpis.humidex, 1, '')}</p></div>`;
    }
    let windowHTML = '<div class="kpi"><h3>Fenêtre</h3><p>--</p></div>';
    if (currentData && currentData.window_status) {
        const status = currentData.window_status.status;
        const icon = status === 'ouverte' ? '🪟' : '🖼️';
        const text = status.charAt(0).toUpperCase() + status.slice(1);
        windowHTML = `<div class="kpi"><h3>Fenêtre</h3><p style="font-size: 1.8em; line-height: 1.2;">${icon} ${text}</p></div>`;
    }
    container.innerHTML = `<div class="kpi"><h3>Température</h3><p>${formatValue(kpis.temperature_c, 1, '°C')}</p></div> ${humidexHTML} <div class="kpi"><h3>Humidité</h3><p>${formatValue(kpis.humidity_pct, 0, '%')}</p></div> ${windowHTML} <div class="kpi"><h3>Pression</h3><p>${formatValue(kpis.pressure_pa / 100, 0, ' hPa')}</p></div> <div class="kpi"><h3>Luminosité</h3><p>${formatValue(kpis.light_lux, 0, ' Lux')}</p></div> <div class="kpi"><h3>Son</h3><p>${formatValue(kpis.sound_spl_dba, 0, ' dBA')}</p></div> <div class="kpi"><h3>AQI</h3><p>${formatValue(kpis.aqi, 0, '')}</p></div> <div class="kpi"><h3>eCO₂</h3><p>${formatValue(kpis.bsec_co2_ppm, 0, ' ppm')}</p></div>`;
}

function updateStats(stats) {
    const container = document.getElementById('stats-container');
    if (!stats || !stats.temperature_c) { container.innerHTML = '<p>Pas de statistiques.</p>'; return; }
    container.innerHTML = `<div class="stat-item"><h3>Temp. Moy.</h3><p>${formatValue(stats.temperature_c.mean, 1, '°C')}</p></div> <div class="stat-item"><h3>Temp. Max</h3><p>${formatValue(stats.temperature_c.max, 1, '°C')}</p></div> <div class="stat-item"><h3>Humid. Moy.</h3><p>${formatValue(stats.humidity_pct.mean, 0, '%')}</p></div> <div class="stat-item"><h3>Bruit Moy.</h3><p>${formatValue(stats.sound_spl_dba.mean, 0, ' dBA')}</p></div> <div class="stat-item"><h3>Écart Bruit</h3><p>${formatValue(stats.sound_spl_dba.std_dev, 1, ' dBA')}</p></div> <div class="stat-item"><h3>AQI Moy.</h3><p>${formatValue(stats.aqi.mean, 0, '')}</p></div>`;
}

function updateEventsTable(events, tableId, showActions) {
    const tbody = document.querySelector(`#${tableId} tbody`);
    if (!tbody) return;
    if (!events || events.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${showActions ? 5 : 4}" style="text-align:center;">Aucun événement.</td></tr>`; return;
    }
    tbody.innerHTML = events.map(event => `<tr><td>${formatISODate(event.start_time_iso)}</td> <td>${event.sound_type ? event.sound_type.charAt(0).toUpperCase() + event.sound_type.slice(1) : 'N/A'}</td> <td>${event.duration_s !== undefined ? event.duration_s + 's' : '--'}</td> <td>${formatValue(event.peak_spl_dba, 1, ' dBA')}</td> ${showActions ? `<td> ${event.spectral_bands ? `<button class="action-btn" onclick="toggleDetails(this, ${event.id}, '${tableId}');">Spectre</button>` : ''} ${event.audio_filename ? `<button class="action-btn" onclick="playAudio('${event.audio_filename}');">Écouter</button>` : ''}</td>` : ''} </tr> ${showActions && event.spectral_bands ? `<tr id="details-${tableId}-${event.id}" class="spectral-row"><td colspan="5" class="spectral-cell"><canvas id="spectralChart-${tableId}-${event.id}" height="80"></canvas></td></tr>` : ''}`).join('');
}

function updateAllCharts(data, period) {
    const historyData = data ? data.history_data : [];
    const chartConfigs = [{ id: 'tempChart', label: 'Température', key: 'temperature_c', color: 'rgba(255, 99, 132, 0.5)', unit: '°C' }, { id: 'humidChart', label: 'Humidité', key: 'humidity_pct', color: 'rgba(54, 162, 235, 0.5)', unit: '%' }, { id: 'pressureChart', label: 'Pression', key: 'pressure_pa', color: 'rgba(75, 192, 192, 0.5)', unit: 'hPa', transform: v => v / 100 }, { id: 'lightChart', label: 'Luminosité', key: 'light_lux', color: 'rgba(255, 205, 86, 0.5)', unit: 'Lux' }, { id: 'soundChart', label: 'Niveau Sonore', key: 'sound_spl_dba', color: 'rgba(255, 159, 64, 0.5)', unit: 'dBA' }, { id: 'aqiChart', label: 'Indice Qualité Air', key: 'aqi', color: 'rgba(153, 102, 255, 0.5)', unit: 'AQI' }, { id: 'co2Chart', label: 'CO₂ Équivalent', key: 'bsec_co2_ppm', color: 'rgba(100, 100, 100, 0.5)', unit: 'ppm' }];
    chartConfigs.forEach(config => {
        if (charts[config.id]) charts[config.id].destroy();
        if (historyData && historyData.length > 0 && historyData.some(d => d[config.key] !== null && d[config.key] !== undefined)) {
            createSensorChart(config.id, config.label, config.key, config.color, config.unit, historyData, period, config.transform);
        } else {
            const canvas = document.getElementById(config.id);
            if (canvas) {
                const ctx = canvas.getContext('2d');
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.font = "16px sans-serif"; ctx.fillStyle = "#aaa"; ctx.textAlign = "center";
                ctx.fillText("Données non disponibles", canvas.width / 2, canvas.height / 2);
            }
        }
    });
    if (charts['eventsChart']) charts['eventsChart'].destroy();
    createEventsChart('eventsChart', data ? data.events_period : []);

    if (charts['eventsTimelineChart']) charts['eventsTimelineChart'].destroy();
    createEventsTimelineChart('eventsTimelineChart', data ? data.events_period : [], period);
}

function createSensorChart(canvasId, label, dataKey, color, unit, historyData, period, transformFunc = v => v) {
    const ctx = document.getElementById(canvasId).getContext('2d');
    const chartData = historyData.map(d => ({ x: new Date(d.timestamp), y: d[dataKey] !== null ? transformFunc(d[dataKey]) : null }));
    const datasets = [{ label: label, data: chartData, borderColor: color, borderWidth: 1.5, pointRadius: 0, tension: 0.1 }];
    const rollingMeanKey = dataKey + '_rolling_mean';
    if (historyData.some(d => d[rollingMeanKey] !== null && d[rollingMeanKey] !== undefined)) {
        const rollingMeanData = historyData.map(d => ({ x: new Date(d.timestamp), y: d[rollingMeanKey] !== null ? transformFunc(d[rollingMeanKey]) : null }));
        datasets.push({ label: 'Tendance', data: rollingMeanData, borderColor: color.replace('rgba', 'rgb').replace(/, ?\d\.\d\)/, ')'), borderWidth: 2, pointRadius: 0, tension: 0.1 });
    }
    if (canvasId === 'tempChart' && historyData.some(d => d.humidex !== null && d.humidex !== undefined)) {
        const humidexData = historyData.map(d => ({ x: new Date(d.timestamp), y: d.humidex }));
        datasets.push({ label: 'Humidex', data: humidexData, borderColor: 'rgba(255, 159, 64, 0.5)', borderWidth: 1.5, pointRadius: 0, tension: 0.1, spanGaps: false });
        if (historyData.some(d => d.humidex_rolling_mean !== null && d.humidex_rolling_mean !== undefined)) {
            const humidexRollingMeanData = historyData.map(d => ({ x: new Date(d.timestamp), y: d.humidex_rolling_mean }));
            datasets.push({ label: 'Tendance Humidex', data: humidexRollingMeanData, borderColor: 'rgb(255, 159, 64)', borderWidth: 2, pointRadius: 0, tension: 0.1, borderDash: [5, 5], spanGaps: false });
        }
    }
    let timeUnit = 'hour'; let timeTooltipFormat = 'dd/MM HH:mm';
    if (period === '7d' || period === '30d') { timeUnit = 'day'; timeTooltipFormat = 'dd/MM/yyyy'; }
    const yAxisOptions = { title: { display: true, text: unit } };
    if (canvasId === 'lightChart') { yAxisOptions.type = 'logarithmic'; yAxisOptions.min = 0.1; }
    charts[canvasId] = new Chart(ctx, {
        type: 'line',
        data: { datasets: datasets },
        options: {
            plugins: {
                tooltip: { callbacks: { filter: function (tooltipItem) { return tooltipItem.parsed.y !== null; } } }
            },
            scales: {
                x: { type: 'time', time: { unit: timeUnit, tooltipFormat: timeTooltipFormat, displayFormats: { hour: 'HH:mm', day: 'dd/MM' } }, title: { display: true, text: 'Heure Locale' } },
                y: yAxisOptions
            },
            animation: false
        }
    });
}

function createEventsTimelineChart(canvasId, eventsData, period) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    if (!eventsData || eventsData.length === 0) {
        const context = ctx.getContext('2d');
        context.clearRect(0, 0, ctx.width, ctx.height);
        context.font = "16px sans-serif"; context.fillStyle = "#aaa"; context.textAlign = "center";
        context.fillText("Aucun événement sonore sur cette période.", ctx.width / 2, ctx.height / 2);
        return;
    }

    const MIN_DBA = 65;  
    const MAX_DBA = 100; 
    const MIN_RADIUS = 5;
    const MAX_RADIUS = 15;
    
    function calculateRadius(dba) {
        if (dba === null || dba === undefined) return MIN_RADIUS;
        const clampedDba = Math.max(MIN_DBA, Math.min(MAX_DBA, dba));
        const ratio = (clampedDba - MIN_DBA) / (MAX_DBA - MIN_DBA);
        return MIN_RADIUS + (ratio * (MAX_RADIUS - MIN_RADIUS));
    }

    const datePicker = document.getElementById('date-picker');
    const endDate = datePicker.value ? new Date(datePicker.value) : new Date();
    const periodMap = { '1h': 3600 * 1000, '24h': 24 * 3600 * 1000, '7d': 7 * 24 * 3600 * 1000, '30d': 30 * 24 * 3600 * 1000 };
    const startDate = new Date(endDate.getTime() - (periodMap[period] || 24 * 3600 * 1000));
    let timeUnit = 'hour';
    if (period === '7d' || period === '30d') { timeUnit = 'day'; }
    
    const datasets = Object.keys(eventStyles).map(eventType => {
        const style = eventStyles[eventType];
        const filteredEvents = eventsData.filter(e => e.sound_type === eventType);
        
        return {
            label: eventType,
            data: filteredEvents.map(e => ({ 
                x: new Date(e.start_time_iso).getTime(), 
                y: e.sound_type,
                dba: e.peak_spl_dba 
            })),
            backgroundColor: style.color,
            pointStyle: style.style,
            radius: filteredEvents.map(e => calculateRadius(e.peak_spl_dba)),
            hoverRadius: filteredEvents.map(e => calculateRadius(e.peak_spl_dba) + 2)
        };
    }).filter(ds => ds.data.length > 0);

    charts[canvasId] = new Chart(ctx, {
        type: 'scatter',
        data: {
            labels: Object.keys(eventStyles),
            datasets: datasets
        },
        options: {
            plugins: {
                title: { display: false },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            const eventTime = new Date(context.parsed.x).toLocaleTimeString('fr-FR');
                            const dba = context.raw.dba;
                            return `${context.dataset.label} à ${eventTime} (${dba.toFixed(1)} dBA)`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    type: 'time',
                    min: startDate.getTime(),
                    max: endDate.getTime(),
                    time: {
                        unit: timeUnit,
                        tooltipFormat: 'dd/MM HH:mm:ss',
                        displayFormats: { hour: 'HH:mm', day: 'dd/MM' }
                    },
                    title: { display: true, text: 'Heure' }
                },
                y: { type: 'category', offset: true }
            },
            animation: false
        }
    });
}

function createEventsChart(canvasId, eventsData) { const ctx = document.getElementById(canvasId); if (!ctx) return; if (!eventsData || eventsData.length === 0) { const context = ctx.getContext('2d'); context.clearRect(0, 0, ctx.width, ctx.height); context.font = "16px sans-serif"; context.fillStyle = "#aaa"; context.textAlign = "center"; context.fillText("Aucun événement sonore.", ctx.width / 2, ctx.height / 2); return; } const hourCounts = Array(24).fill(0); for (const event of eventsData) { if (event.start_time_iso) { hourCounts[new Date(event.start_time_iso).getHours()]++; } } const labels = Array.from({ length: 24 }, (_, i) => `${i.toString().padStart(2, '0')}h`); charts[canvasId] = new Chart(ctx, { type: 'bar', data: { labels: labels, datasets: [{ label: "Nombre d'événements sonores", data: hourCounts, backgroundColor: 'rgba(255, 159, 64, 0.7)' }] }, options: { plugins: { title: { display: true, text: 'Distribution Horaire des Événements Sonores' }, legend: { display: false } }, scales: { x: { title: { display: true, text: 'Heure de la journée' } }, y: { beginAtZero: true, title: { display: true, text: "Nombre d'événements" }, ticks: { precision: 0 } } }, animation: false } }); }
const spectralCharts = {}; function toggleDetails(button, eventId, tableId) { const detailsRow = document.getElementById(`details-${tableId}-${eventId}`); if (!detailsRow) return; const isVisible = detailsRow.classList.toggle('visible'); button.textContent = isVisible ? 'Cacher' : 'Spectre'; if (isVisible && !spectralCharts[`${tableId}-${eventId}`]) { const canvasId = `spectralChart-${tableId}-${eventId}`; const eventDataSource = (tableId === 'events-period-table') ? currentData.events_period : currentData.top_events; const eventData = eventDataSource.find(e => e.id == eventId); if (eventData && eventData.spectral_bands) { new Chart(document.getElementById(canvasId), { type: 'bar', data: { labels: ['63Hz', '160Hz', '400Hz', '1kHz', '2.5kHz', '6.25kHz'], datasets: [{ label: 'Niveau (dB)', data: eventData.spectral_bands, backgroundColor: 'rgba(54, 162, 235, 0.5)' }] }, options: { scales: { y: { beginAtZero: true } }, plugins: { legend: { display: false } } } }); } } }
function playAudio(filename) { const playerContainer = document.getElementById('global-audio-player-container'); if (!playerContainer) return; playerContainer.innerHTML = ''; if (currentAudioElement) { currentAudioElement.pause(); } const audio = new Audio(`/audio_files/${filename}`); audio.controls = true; audio.autoplay = true; audio.addEventListener('ended', () => { playerContainer.innerHTML = ''; currentAudioElement = null; }); audio.addEventListener('error', () => { playerContainer.innerHTML = '<p style="color:red;">Erreur lecture audio.</p>'; currentAudioElement = null; }); playerContainer.appendChild(audio); currentAudioElement = audio; }
