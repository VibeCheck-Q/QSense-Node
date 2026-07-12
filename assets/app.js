// SPDX-FileCopyrightText: Copyright (C) Arduino s.r.l. and/or its affiliated companies
//
// SPDX-License-Identifier: MPL-2.0

// ── Machine identity (edit these to match your setup) ────────────────────────
const MACHINE_ID        = 'M-01';
const MACHINE_PLACEMENT = 'Zone A — Line 3';

// Populate stats bar
document.getElementById('stat-machine-id').textContent = MACHINE_ID;
document.getElementById('stat-placement').textContent  = MACHINE_PLACEMENT;

// Live run-time counter
const runtimeStart  = Date.now();
const runtimeEl     = document.getElementById('stat-runtime');
function padTwo(n) { return String(n).padStart(2, '0'); }

// Live date & time clock
const datetimeEl = document.getElementById('stat-datetime');
function tickClocks() {
  const now = new Date();
  // Runtime
  const s = Math.floor((now - runtimeStart) / 1000);
  runtimeEl.textContent = `${padTwo(Math.floor(s / 3600))}:${padTwo(Math.floor((s % 3600) / 60))}:${padTwo(s % 60)}`;
  // Date & time
  datetimeEl.textContent = now.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}
tickClocks();
setInterval(tickClocks, 1000);

const canvas = document.getElementById('plot');
const ctx = canvas.getContext('2d');
const maxSamples = 200;
const samples = [];
let errorContainer;

const recentAnomaliesElement = document.getElementById('recentClassifications');
let anomalies = [];
const MAX_RECENT_ANOMALIES = 5;
const DEFAULT_ANOMALY_THRESHOLD = 1.0;
const MIN_ANOMALY_THRESHOLD = 0.0;
const MAX_SLIDER_ANOMALY_THRESHOLD = 20.0;
const ANOMALY_THRESHOLD_STEP = 0.1;

let hasDataFromBackend = false; // New global flag

const accelerometerDataDisplay = document.getElementById('accelerometer-data-display');
const noAccelerometerDataPlaceholder = document.getElementById('no-accelerometer-data');

/*
 * WebUI initialization. We need it to communicate with the server
 */
const ui = new WebUI();
ui.on_connect(onUIConnected);
ui.on_disconnect(onUIDisconnected);
ui.on_message('anomaly_detected', handleAnomalyDetected);
ui.on_message('sample', s => {
  pushSample(s);
});

function onUIConnected() {
  if (errorContainer) {
    errorContainer.style.display = 'none';
    errorContainer.textContent = '';
  }
}

function onUIDisconnected() {
  errorContainer = document.getElementById('error-container');
  if (errorContainer) {
    errorContainer.textContent = 'Connection to the board lost. Please check the connection.';
    errorContainer.style.display = 'block';
  }
}

function handleAnomalyDetected(message) {
  if (!hasDataFromBackend) {
    // Check if this is the first data received
    hasDataFromBackend = true;
    renderAccelerometerData();
  }
  printAnomalies(message);
  renderAnomalies();
  try {
    const parsedAnomaly = JSON.parse(message);
    updateFeedback(parsedAnomaly.score); // Pass the anomaly score
  } catch (e) {
    console.error('Failed to parse anomaly message for feedback:', message, e);
    updateFeedback(null); // Fallback to no anomaly feedback
  }
}

function drawPlot() {
  if (!hasDataFromBackend) return; // Only draw if we have data

  const currentWidth = canvas.clientWidth;
  const currentHeight = canvas.clientHeight;

  if (canvas.width !== currentWidth || canvas.height !== currentHeight) {
    canvas.width = currentWidth;
    canvas.height = currentHeight;
  }
  // Clear the canvas before drawing the new frame!
  ctx.clearRect(0, 0, currentWidth, currentHeight);
  // All grid lines (every 0.5) - same size
  ctx.strokeStyle = '#31333F99';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  for (let i = 0; i <= 8; i++) {
    const y = 10 + i * ((currentHeight - 20) / 8);
    ctx.moveTo(40, y);
    ctx.lineTo(currentWidth, y);
  }
  ctx.stroke();

  // Y-axis labels (-2.0 to 2.0 every 0.5)
  ctx.fillStyle = '#666';
  ctx.font = '400 14px Arial';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';

  for (let i = 0; i <= 8; i++) {
    const y = 10 + i * ((currentHeight - 20) / 8);
    const value = (4.0 - i * 1.0).toFixed(1);
    ctx.fillText(value, 35, y);
  }

  // draw each series
  function drawSeries(key, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      const x = 40 + (i / (maxSamples - 1)) * (currentWidth - 40);
      const v = s[key];
      const y = currentHeight / 2 - v * ((currentHeight - 20) / 8);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  drawSeries('x', '#0068C9');
  drawSeries('y', '#FF9900');
  drawSeries('z', '#FF2B2B');
}

function pushSample(s) {
  samples.push(s);
  if (samples.length > maxSamples) samples.shift();
  if (!hasDataFromBackend) {
    // Check if this is the first data received
    hasDataFromBackend = true;
    renderAccelerometerData();
  }
  drawPlot();
}

const feedbackContentWrapper = document.getElementById('feedback-content-wrapper');
let feedbackTimeout;

// Show INITIALIZING only for the first 3.5 s after page load, then go NOMINAL
let isInitializing = true;
setTimeout(() => {
  isInitializing = false;
  updateFeedback(null);
}, 3500);

// When true, the CRITICAL badge is locked — it will NOT auto-reset to NOMINAL.
// Only cleared when machine_resolved is received from Python (MQTT ack resolved=1).
let criticalLocked = false;

ui.on_message('machine_resolved', () => {
  criticalLocked = false;
  updateFeedback(null);
});

// ... (existing code between)

// Start the application
renderAccelerometerData(); // Initial render for accelerometer
renderAnomalies(); // Initial render for anomalies
updateFeedback(null); // Initial feedback state
initializeConfidenceSlider(); // Initialize the confidence slider

// Popover logic
document.querySelectorAll('.info-btn.confidence').forEach(img => {
  const popover = img.nextElementSibling;
  img.addEventListener('mouseenter', () => {
    popover.style.display = 'block';
  });
  img.addEventListener('mouseleave', () => {
    popover.style.display = 'none';
  });
});

document.querySelectorAll('.info-btn.accelerometer-data').forEach(img => {
  const popover = img.nextElementSibling;
  img.addEventListener('mouseenter', () => {
    popover.style.display = 'block';
  });
  img.addEventListener('mouseleave', () => {
    popover.style.display = 'none';
  });
});

function initializeConfidenceSlider() {
  const confidenceSlider = document.getElementById('confidenceSlider');
  const confidenceInput = document.getElementById('confidenceInput');
  const confidenceResetButton = document.getElementById('confidenceResetButton');

  confidenceSlider.min = MIN_ANOMALY_THRESHOLD.toString();
  confidenceSlider.max = MAX_SLIDER_ANOMALY_THRESHOLD.toString();
  confidenceSlider.step = ANOMALY_THRESHOLD_STEP.toString();
  confidenceSlider.value = DEFAULT_ANOMALY_THRESHOLD.toString();
  confidenceInput.min = MIN_ANOMALY_THRESHOLD.toString();
  confidenceInput.step = ANOMALY_THRESHOLD_STEP.toString();
  confidenceInput.value = formatThreshold(DEFAULT_ANOMALY_THRESHOLD);

  confidenceSlider.addEventListener('input', () => updateConfidenceDisplay());
  confidenceInput.addEventListener('input', handleConfidenceInputChange);
  confidenceInput.addEventListener('blur', validateConfidenceInput);
  updateConfidenceDisplay();

  confidenceResetButton.addEventListener('click', e => {
    if (e.target.classList.contains('reset-icon') || e.target.closest('.reset-icon')) {
      resetConfidence();
    }
  });
}

function normalizeThreshold(value) {
  const numericValue = parseFloat(value);

  if (isNaN(numericValue)) {
    return DEFAULT_ANOMALY_THRESHOLD;
  }

  return Math.max(MIN_ANOMALY_THRESHOLD, numericValue);
}

function getSliderValueForThreshold(value) {
  return Math.min(MAX_SLIDER_ANOMALY_THRESHOLD, normalizeThreshold(value));
}

function formatThreshold(value) {
  return normalizeThreshold(value).toFixed(1);
}

function handleConfidenceInputChange() {
  const confidenceInput = document.getElementById('confidenceInput');

  updateConfidenceDisplay(normalizeThreshold(confidenceInput.value));
}

function validateConfidenceInput() {
  const confidenceInput = document.getElementById('confidenceInput');
  const value = normalizeThreshold(confidenceInput.value);

  confidenceInput.value = formatThreshold(value);

  updateConfidenceDisplay(value);
}

function updateConfidenceDisplay(threshold = null) {
  const confidenceSlider = document.getElementById('confidenceSlider');
  const confidenceInput = document.getElementById('confidenceInput');
  const confidenceValueDisplay = document.getElementById('confidenceValueDisplay');
  const sliderProgress = document.getElementById('sliderProgress');

  const value = threshold === null ? normalizeThreshold(confidenceSlider.value) : normalizeThreshold(threshold);
  const sliderValue = getSliderValueForThreshold(value);

  confidenceSlider.value = sliderValue;
  ui.send_message('override_th', value);
  const percentage =
    ((sliderValue - parseFloat(confidenceSlider.min)) /
      (parseFloat(confidenceSlider.max) - parseFloat(confidenceSlider.min))) *
    100;

  const displayValue = formatThreshold(value);
  confidenceValueDisplay.textContent = displayValue;

  if (document.activeElement !== confidenceInput) {
    confidenceInput.value = displayValue;
  }

  confidenceSlider.style.setProperty('--slider-progress', percentage + '%');
  sliderProgress.style.width = percentage + '%';
  confidenceValueDisplay.style.left = percentage + '%';
}

function resetConfidence() {
  const confidenceSlider = document.getElementById('confidenceSlider');
  const confidenceInput = document.getElementById('confidenceInput');

  confidenceSlider.value = DEFAULT_ANOMALY_THRESHOLD.toString();
  confidenceInput.value = formatThreshold(DEFAULT_ANOMALY_THRESHOLD);
  updateConfidenceDisplay();
}

// ... (existing printAnomalies and renderAnomalies functions)

function updateFeedback(anomalyScore = null) {
  clearTimeout(feedbackTimeout);

  if (isInitializing) {
    feedbackContentWrapper.innerHTML = `
      <div class="status-badge status-offline">
        <span class="status-icon">⏳</span>
        <div class="status-details">
          <span class="status-label">INITIALIZING</span>
          <span class="status-sub">Starting up…</span>
        </div>
      </div>`;
    return;
  }

  if (anomalyScore !== null) {
    const isCritical = anomalyScore >= 5;

    if (isCritical) {
      criticalLocked = true; // hold CRITICAL until machine_resolved arrives
    }

    feedbackContentWrapper.innerHTML = `
      <div class="status-badge ${isCritical ? 'status-critical' : 'status-warning'}">
        <span class="status-icon">${isCritical ? '🔴' : '⚠️'}</span>
        <div class="status-details">
          <span class="status-label">${isCritical ? 'CRITICAL' : 'ANOMALY DETECTED'}</span>
          <span class="status-sub">Score: ${anomalyScore.toFixed(2)}${isCritical ? ' — Machine stopped. Awaiting resolve.' : ''}</span>
        </div>
      </div>`;

    // Update last anomaly stat
    const now = new Date();
    document.getElementById('stat-last-anomaly').textContent =
      now.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    // Non-critical anomalies auto-reset after 4 s; critical stays locked
    if (!isCritical) {
      feedbackTimeout = setTimeout(() => updateFeedback(null), 4000);
    }

  } else if (criticalLocked) {
    // Keep showing CRITICAL — machine_resolved hasn't arrived yet
    feedbackContentWrapper.innerHTML = `
      <div class="status-badge status-critical">
        <span class="status-icon">🔴</span>
        <div class="status-details">
          <span class="status-label">CRITICAL</span>
          <span class="status-sub">Machine stopped. Awaiting resolve.</span>
        </div>
      </div>`;
  } else {
    feedbackContentWrapper.innerHTML = `
      <div class="status-badge status-nominal">
        <span class="status-icon">🟢</span>
        <div class="status-details">
          <span class="status-label">NOMINAL</span>
          <span class="status-sub">All systems operating normally</span>
        </div>
      </div>`;
  }
}

function printAnomalies(newAnomaly) {
  anomalies.unshift(newAnomaly);
  if (anomalies.length > MAX_RECENT_ANOMALIES) {
    anomalies.pop();
  }
}

function renderAnomalies() {
  recentAnomaliesElement.innerHTML = ``; // Clear the list

  if (anomalies.length === 0) {
    recentAnomaliesElement.innerHTML = `
            <div class="no-recent-anomalies">
                <img src="./img/no-data.png">
                <p>No recent anomalies</p>
            </div>
        `;
    return;
  }

  anomalies.forEach(anomaly => {
    try {
      const parsedAnomaly = JSON.parse(anomaly);

      if (Object.keys(parsedAnomaly).length === 0) {
        return; // Skip empty anomaly objects
      }

      const listItem = document.createElement('li');
      listItem.className = 'anomaly-list-item';

      const score = parsedAnomaly.score.toFixed(1);
      const date = new Date(parsedAnomaly.timestamp);

      const timeString = date.toLocaleTimeString('it-IT', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      const dateString = date.toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });

      listItem.innerHTML = `
        <span class="anomaly-score">${score}</span>
        <span class="anomaly-text">Anomaly</span>
        <span class="anomaly-time">${timeString} - ${dateString}</span>
      `;

      recentAnomaliesElement.appendChild(listItem);
    } catch (e) {
      console.error('Failed to parse anomaly data:', anomaly, e);
      if (recentAnomaliesElement.getElementsByClassName('anomaly-error').length === 0) {
        const errorRow = document.createElement('div');
        errorRow.className = 'anomaly-error';
        errorRow.textContent = `Error processing anomaly data. Check console for details.`;
        recentAnomaliesElement.appendChild(errorRow);
      }
    }
  });
}

function renderAccelerometerData() {
  if (hasDataFromBackend) {
    accelerometerDataDisplay.style.display = 'block';
    noAccelerometerDataPlaceholder.style.display = 'none';
    drawPlot();
  } else {
    accelerometerDataDisplay.style.display = 'none';
    noAccelerometerDataPlaceholder.style.display = 'flex'; // Use flex for centering content
  }
}

// ── Climate / Environment live charts ────────────────────────────────────────

const MAX_CLIMATE_POINTS = 60; // keep last 60 seconds

function newClimateChartData(borderColor, backgroundColor) {
  return {
    labels: [],
    datasets: [{ data: [], borderColor, backgroundColor, fill: true, pointRadius: 0, borderWidth: 1.5 }],
  };
}

function newClimateChart(ctx, obj) {
  return new Chart(ctx, {
    type: 'line',
    data: obj.data,
    options: {
      responsive: true,
      animation: false,
      scales: {
        y: obj.unit === '%' ? { min: 0, max: 100, grid: { color: '#e8e8e544' } } : { grid: { color: '#e8e8e544' } },
        x: { grid: { display: false }, ticks: { maxTicksLimit: 6, maxRotation: 0 } },
      },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          displayColors: false,
          callbacks: {
            title: () => '',
            label: ctx => `${ctx.label}  –  ${ctx.parsed.y.toFixed(1)} ${obj.unit}`,
          },
        },
      },
    },
  });
}

function pushClimatePoint(obj, message) {
  const canvasEl = obj.canvas;
  const noDataEl = document.getElementById(canvasEl.id + '-nodata');

  // Update the big live-value display
  if (obj.valueEl) obj.valueEl.textContent = message.value.toFixed(1);

  const date = new Date(message.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  obj.data.labels.push(date);
  obj.data.datasets[0].data.push(message.value);

  if (obj.data.labels.length > MAX_CLIMATE_POINTS) {
    obj.data.labels.shift();
    obj.data.datasets[0].data.shift();
  }

  if (noDataEl) noDataEl.style.display = 'none';
  canvasEl.style.display = 'block';

  if (!obj.chart) {
    obj.chart = newClimateChart(canvasEl.getContext('2d'), obj);
  } else {
    obj.chart.update();
  }
}

const temperatureLive = {
  canvas:  document.getElementById('temperature-live-chart'),
  valueEl: document.getElementById('temp-value'),
  chart: null,
  data:  newClimateChartData('#f0b94d', 'rgba(240,185,77,0.10)'),
  unit:  '°C',
};

const humidityLive = {
  canvas:  document.getElementById('humidity-live-chart'),
  valueEl: document.getElementById('hum-value'),
  chart: null,
  data:  newClimateChartData('#1f6f68', 'rgba(31,111,104,0.08)'),
  unit:  '%',
};

// Hide canvases until first data arrives
[temperatureLive, humidityLive].forEach(obj => {
  if (obj.canvas) obj.canvas.style.display = 'none';
});

ui.on_message('temperature', msg => pushClimatePoint(temperatureLive, msg));
ui.on_message('humidity',    msg => pushClimatePoint(humidityLive,    msg));
