import React, { useEffect, useRef, useState } from "react";
import "./App.css";
import AuthScreen from "./AuthScreen";
import {
  apiFetch,
  clearSession,
  loadSession,
  saveSession,
} from "./api";


const initialSensor = {
  heart_rate: 78,
  acceleration: 0.8,
  movement: 1.1,
  speed: 3.5,
};

const initialAnalysis = {
  anomaly: false,
  risk: "LOW",
  level: 0,
  probability: 0,
  message: "Everything looks normal.",
};

const DEMO_SCENARIOS = [
  {
    label: "Resting",
    values: { heart_rate: 72, acceleration: 0.9, movement: 1.0, speed: 2 },
  },
  {
    label: "Running",
    values: { heart_rate: 138, acceleration: 2.2, movement: 2.4, speed: 11 },
  },
  {
    label: "Distress",
    values: { heart_rate: 170, acceleration: 4.2, movement: 4.4, speed: 22 },
  },
];

const DEMO_SLIDERS = [
  { key: "heart_rate", label: "Heart rate (BPM)", min: 50, max: 200, step: 1 },
  { key: "acceleration", label: "Acceleration (G)", min: 0, max: 6, step: 0.1 },
  { key: "movement", label: "Movement (G)", min: 0, max: 6, step: 0.1 },
  { key: "speed", label: "Speed (km/h)", min: 0, max: 40, step: 0.5 },
];

// ------------------------------------------------
// DATA HELPERS
// Make sure unexpected backend data can never crash the render
// ------------------------------------------------

function normalizeSensor(s = {}) {
  return {
    heart_rate: Number(s.heart_rate) || 0,
    acceleration: Number(s.acceleration) || 0,
    movement: Number(s.movement) || 0,
    speed: Number(s.speed) || 0,
  };
}

function normalizeAnalysis(a = {}) {
  return {
    anomaly: Boolean(a.anomaly),
    risk: String(a.risk ?? "LOW").toUpperCase(),
    level: Number(a.level) || 0,
    probability: Number(a.probability) || 0,
    message: String(a.message ?? ""),
  };
}

function SafeGuardApp({ user, onLogout }) {
  const [activeTab, setActiveTab] = useState("home");

  const [sensor, setSensor] = useState(initialSensor);
  const [analysis, setAnalysis] = useState(initialAnalysis);

  const [monitoring, setMonitoring] = useState(true);
  const [locationEnabled, setLocationEnabled] = useState(true);
  const [watchConnected, setWatchConnected] = useState(true);

  const [safetyCheck, setSafetyCheck] = useState(false);
  const [safetyLevel, setSafetyLevel] = useState(0);
  const [countdown, setCountdown] = useState(10);

  const [emergencyMode, setEmergencyMode] = useState(false);

  const [alerts, setAlerts] = useState([]);

  const [activity, setActivity] = useState([]);

  const [toast, setToast] = useState("");

  const [demoMode, setDemoMode] = useState(false);
  const [demoValues, setDemoValues] = useState(DEMO_SCENARIOS[0].values);

  const [contacts, setContacts] = useState([]);
  const [newContact, setNewContact] = useState({
    name: "",
    phone: "",
    relation: "",
  });
  const [modelInfo, setModelInfo] = useState(null);

  const [locationStatus, setLocationStatus] = useState("waiting");
  const locationRef = useRef(null);

  const [liveMode, setLiveMode] = useState(false);
  const [liveInfo, setLiveInfo] = useState({ acceleration: 0, movement: 0 });
  const [manualHr, setManualHr] = useState(75);
  const [bandName, setBandName] = useState("");
  const [bandHr, setBandHr] = useState(null);
  const motionBuffer = useRef([]);
  const bandHrRef = useRef(null);

  // ------------------------------------------------
  // LOAD DATA FROM BACKEND
  // ------------------------------------------------

  useEffect(() => {
    fetchContacts();
    fetchAlerts();
    fetchModelInfo();
  }, []);

  useEffect(() => {
    if (activeTab === "alerts") fetchAlerts();
  }, [activeTab]);

  // ------------------------------------------------
  // REAL GPS (needs HTTPS except on localhost)
  // ------------------------------------------------

  useEffect(() => {
    if (!locationEnabled) {
      locationRef.current = null;
      setLocationStatus("off");
      return;
    }

    if (!navigator.geolocation) {
      setLocationStatus("unsupported");
      return;
    }

    const id = navigator.geolocation.watchPosition(
      (position) => {
        locationRef.current = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          speed: position.coords.speed,
        };
        setLocationStatus("active");
      },
      (error) => {
        setLocationStatus(error.code === 1 ? "denied" : "waiting");
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 }
    );

    return () => navigator.geolocation.clearWatch(id);
  }, [locationEnabled]);

  // ------------------------------------------------
  // REAL PHONE MOTION SENSOR
  // ------------------------------------------------

  useEffect(() => {
    if (!liveMode) return;

    const onMotion = (event) => {
      const a = event.accelerationIncludingGravity;

      if (!a || a.x == null) return;

      // 1.0 G when the phone is resting, higher when it is shaken
      const magnitude =
        Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z) / 9.81;

      const now = Date.now();
      const buffer = motionBuffer.current;

      buffer.push({ t: now, magnitude });

      while (buffer.length && now - buffer[0].t > 2000) buffer.shift();
    };

    window.addEventListener("devicemotion", onMotion);

    return () => window.removeEventListener("devicemotion", onMotion);
  }, [liveMode]);

  useEffect(() => {
    if (!liveMode || safetyCheck || emergencyMode) return;

    const interval = setInterval(() => {
      const samples = motionBuffer.current;

      if (samples.length < 5) return;

      const values = samples.map((sample) => sample.magnitude);
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const variance =
        values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;

      const acceleration = Math.round(Math.max(...values) * 100) / 100;
      const movement =
        Math.round((mean + Math.sqrt(variance)) * 100) / 100;

      const gpsSpeed = locationRef.current && locationRef.current.speed;
      const speed = gpsSpeed ? Math.round(gpsSpeed * 3.6 * 10) / 10 : 0;

      const heart_rate = bandHrRef.current ?? manualHr;

      setLiveInfo({ acceleration, movement });

      runPrediction({ heart_rate, acceleration, movement, speed });
    }, 2000);

    return () => clearInterval(interval);
  }, [liveMode, safetyCheck, emergencyMode, manualHr]);

  // ------------------------------------------------
  // LIVE SENSOR MONITORING
  // Paused while the safety modal or emergency mode is active
  // ------------------------------------------------

  useEffect(() => {
    if (!monitoring || emergencyMode || safetyCheck || demoMode || liveMode)
      return;

    const interval = setInterval(async () => {
      try {
        // Background readings are always normal activity.
        // Anomalies only come from the Live demo panel (or real sensors).
        const response = await apiFetch(`/sensor/normal`);

        if (!response.ok) return;

        const data = await response.json();

        const newSensor = normalizeSensor(data.sensor_data);
        const newAnalysis = normalizeAnalysis(data.analysis);

        setSensor(newSensor);
        setAnalysis(newAnalysis);

        const time = new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });

        setActivity((prev) =>
          [
            {
              time,
              heartRate: newSensor.heart_rate,
              risk: newAnalysis.risk,
              anomaly: newAnalysis.anomaly,
            },
            ...prev,
          ].slice(0, 12)
        );

        if (newAnalysis.anomaly) {
          startSafetyCheck(newAnalysis.level);
        }
      } catch (error) {
        console.log("Backend unavailable", error);
      }
    }, 4000);

    return () => clearInterval(interval);
  }, [monitoring, emergencyMode, safetyCheck, demoMode, liveMode]);

  // ------------------------------------------------
  // SAFETY COUNTDOWN
  // One effect ticks the timer, a second one reacts at zero
  // ------------------------------------------------

  useEffect(() => {
    if (!safetyCheck) return;

    const id = setInterval(() => {
      setCountdown((previous) => previous - 1);
    }, 1000);

    return () => clearInterval(id);
  }, [safetyCheck]);

  useEffect(() => {
    if (safetyCheck && countdown <= 0) {
      handleSafetyResponse("timeout");
    }
  }, [countdown, safetyCheck]);

  // ------------------------------------------------
  // SAFETY CHECK
  // ------------------------------------------------

  function startSafetyCheck(level = 0) {
    setSafetyLevel(level);
    setCountdown(10);
    setSafetyCheck(true);
  }

  async function handleSafetyResponse(response) {
    setSafetyCheck(false);
    setCountdown(10);

    try {
      const result = await apiFetch(
        withLocation(`/safety-response?response=${response}`),
        {
          method: "POST",
        }
      );

      const data = await result.json();

      setTimeout(fetchAlerts, 2500);
      setTimeout(fetchAlerts, 6000);

      if (response === "yes") {
        setSafetyLevel(0);

        setAnalysis((previous) => ({
          ...previous,
          level: 0,
          anomaly: false,
          risk: "LOW",
          message: "Everything looks normal.",
        }));

        showToast("You are marked safe.");
        return;
      }

      const level = Number(data.level) || 0;

      if (level >= 2) {
        activateEmergencyMode();
      } else {
        startSafetyCheck(level || safetyLevel + 1);
      }
    } catch (error) {
      console.log("Safety response failed", error);

      if (response !== "yes") {
        activateEmergencyMode();
      }
    }
  }

  // ------------------------------------------------
  // EMERGENCY MODE
  // ------------------------------------------------

  function withLocation(url) {
    const loc = locationRef.current;

    if (!loc) return url;

    const separator = url.includes("?") ? "&" : "?";

    return `${url}${separator}lat=${loc.lat}&lng=${loc.lng}`;
  }

  async function startLiveSensors() {
    if (typeof window.DeviceMotionEvent === "undefined") {
      showToast("No motion sensor found. Open the app on a phone.");
      return;
    }

    try {
      if (typeof DeviceMotionEvent.requestPermission === "function") {
        const result = await DeviceMotionEvent.requestPermission();

        if (result !== "granted") {
          showToast("Motion permission was denied.");
          return;
        }
      }
    } catch (error) {
      showToast("Motion sensors need HTTPS. Use the https:// link.");
      return;
    }

    motionBuffer.current = [];
    setLiveInfo({ acceleration: 0, movement: 0 });
    setDemoMode(false);
    setLiveMode(true);
  }

  async function connectHeartRateBand() {
    if (!navigator.bluetooth) {
      showToast("Bluetooth needs Chrome over HTTPS (not iPhone Safari).");
      return;
    }

    try {
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ services: ["heart_rate"] }],
      });

      const server = await device.gatt.connect();
      const service = await server.getPrimaryService("heart_rate");
      const characteristic = await service.getCharacteristic(
        "heart_rate_measurement"
      );

      await characteristic.startNotifications();

      characteristic.addEventListener(
        "characteristicvaluechanged",
        (event) => {
          const value = event.target.value;
          const flags = value.getUint8(0);
          const bpm = flags & 0x1 ? value.getUint16(1, true) : value.getUint8(1);

          bandHrRef.current = bpm;
          setBandHr(bpm);
        }
      );

      device.addEventListener("gattserverdisconnected", () => {
        bandHrRef.current = null;
        setBandHr(null);
        setBandName("");
        showToast("Heart-rate band disconnected.");
      });

      setBandName(device.name || "Heart-rate band");
      showToast("Heart-rate band connected.");
    } catch (error) {
      if (error.name !== "NotFoundError") {
        showToast("Could not connect to the band.");
      }
    }
  }

  async function sendTestAlert() {
    try {
      const response = await apiFetch(`/contacts/test`, { method: "POST" });

      if (!response.ok) {
        showToast("Could not send the test alert.");
        return;
      }

      showToast("Test alert sent. Check the Alerts tab.");

      setTimeout(fetchAlerts, 2500);
      setTimeout(fetchAlerts, 6000);
    } catch (error) {
      showToast("Cannot reach the server.");
    }
  }

  async function fetchContacts() {
    try {
      const response = await apiFetch(`/contacts`);
      if (!response.ok) return;
      const list = await response.json();
      setContacts(Array.isArray(list) ? list : []);
    } catch (error) {
      console.log("Could not load contacts", error);
    }
  }

  async function addContact() {
    const name = newContact.name.trim();
    const phone = newContact.phone.trim();

    if (!name || !phone) {
      showToast("Enter a name and phone number.");
      return;
    }

    try {
      const response = await apiFetch(`/contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...newContact, name, phone }),
      });

      if (!response.ok) {
        const error = await response.json();
        showToast(error.detail || "Could not save contact.");
        return;
      }

      setNewContact({ name: "", phone: "", relation: "" });
      await fetchContacts();
      showToast("Contact saved.");
    } catch (error) {
      showToast("Cannot reach the server.");
    }
  }

  async function removeContact(id) {
    try {
      await apiFetch(`/contacts/${id}`, { method: "DELETE" });
      await fetchContacts();
      showToast("Contact removed.");
    } catch (error) {
      showToast("Cannot reach the server.");
    }
  }

  async function fetchAlerts() {
    try {
      const response = await apiFetch(`/alerts`);
      if (!response.ok) return;
      const list = await response.json();
      setAlerts(Array.isArray(list) ? list : []);
    } catch (error) {
      console.log("Could not load alerts", error);
    }
  }

  async function fetchModelInfo() {
    try {
      const response = await apiFetch(`/model-info`);
      if (!response.ok) return;
      setModelInfo(await response.json());
    } catch (error) {
      console.log("Could not load model info", error);
    }
  }

  async function sendSos() {
    try {
      await apiFetch(withLocation(`/sos`), { method: "POST" });
    } catch (error) {
      console.log("SOS request failed", error);
    }

    // alerts are sent in the background, so refresh the history a bit later
    setTimeout(fetchAlerts, 2500);
    setTimeout(fetchAlerts, 6000);
  }

  async function runPrediction(values) {
    try {
      const query = new URLSearchParams(values).toString();
      const response = await apiFetch(`/predict?${query}`);

      if (!response.ok) return;

      const data = await response.json();
      const newSensor = normalizeSensor(data.sensor_data);
      const newAnalysis = normalizeAnalysis(data.analysis);

      setSensor(newSensor);
      setAnalysis(newAnalysis);

      const time = new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });

      setActivity((prev) =>
        [
          {
            time,
            heartRate: newSensor.heart_rate,
            risk: newAnalysis.risk,
            anomaly: newAnalysis.anomaly,
          },
          ...prev,
        ].slice(0, 12)
      );

      if (newAnalysis.anomaly && !safetyCheck && !emergencyMode) {
        startSafetyCheck(newAnalysis.level);
      }
    } catch (error) {
      console.log("Prediction failed", error);
    }
  }

  function applyDemoValues(values) {
    setDemoValues(values);
    runPrediction(values);
  }

  function activateEmergencyMode(triggeredBySos = false) {
    setSafetyCheck(false);
    setEmergencyMode(true);
    setMonitoring(false);

    if (triggeredBySos) sendSos();

    showToast("Emergency mode activated.");
  }

  function cancelEmergency() {
    setEmergencyMode(false);
    setMonitoring(true);
    setSafetyLevel(0);

    setAnalysis(initialAnalysis);

    showToast("Emergency alert cancelled.");
  }

  // ------------------------------------------------
  // TOAST
  // ------------------------------------------------

  function showToast(message) {
    setToast(message);

    setTimeout(() => {
      setToast("");
    }, 3000);
  }

  // ------------------------------------------------
  // RISK HELPERS
  // ------------------------------------------------

  function riskClass() {
    if (analysis.risk === "HIGH") return "risk-high";
    if (analysis.risk === "MEDIUM") return "risk-medium";

    return "risk-low";
  }

  function riskPercentage() {
    if (analysis.risk === "HIGH") return 88;
    if (analysis.risk === "MEDIUM") return 55;

    return 18;
  }

  // ------------------------------------------------
  // HOME
  // ------------------------------------------------

  function HomeScreen() {
    return (
      <div className="screen">

        <div className="topbar">
          <div>
            <div className="hello">Good morning 👋</div>

            <h1>SafeGuard</h1>
          </div>

          <button
            className="icon-button"
            onClick={() => setActiveTab("alerts")}
          >
            🔔
            {alerts.length > 0 && (
              <span className="notification-dot"></span>
            )}
          </button>
        </div>

        {/* SAFETY STATUS */}

        <div className={`safety-status ${riskClass()}`}>

          <div className="status-ring">

            <div className="status-inner">

              <span className="status-icon">
                {analysis.risk === "HIGH"
                  ? "!"
                  : analysis.risk === "MEDIUM"
                  ? "!"
                  : "✓"}
              </span>

            </div>

          </div>

          <div className="status-content">

            <span className="small-label">
              CURRENT STATUS
            </span>

            <h2>
              {analysis.risk === "HIGH"
                ? "Attention Needed"
                : analysis.risk === "MEDIUM"
                ? "Checking Your Safety"
                : "You are protected"}
            </h2>

            <p>
              {analysis.risk === "HIGH"
                ? "Unusual activity detected."
                : analysis.risk === "MEDIUM"
                ? "We detected something unusual."
                : "Your safety monitoring is active."}
            </p>

          </div>

          <div className="live-pill">
            <span></span>
            LIVE
          </div>

        </div>

        {/* MONITORING */}

        <div className="section-heading">

          <div>
            <h2>Live monitoring</h2>
            <p>AI-powered safety analysis</p>
          </div>

          <button
            className={`toggle ${monitoring ? "active" : ""}`}
            onClick={() => setMonitoring(!monitoring)}
          >
            <span></span>
          </button>

        </div>

        {/* SENSOR GRID */}

        <div className="sensor-grid">

          <SensorCard
            icon="❤️"
            title="Heart rate"
            value={sensor.heart_rate}
            unit="BPM"
            active={sensor.heart_rate > 130}
          />

          <SensorCard
            icon="〽️"
            title="Movement"
            value={sensor.movement.toFixed(1)}
            unit="G"
            active={sensor.movement > 2}
          />

          <SensorCard
            icon="📈"
            title="Acceleration"
            value={sensor.acceleration.toFixed(1)}
            unit="G"
            active={sensor.acceleration > 2}
          />

          <SensorCard
            icon="🚶"
            title="Speed"
            value={sensor.speed.toFixed(1)}
            unit="km/h"
            active={sensor.speed > 20}
          />

        </div>

        {/* AI CARD */}

        <div className="ai-card">

          <div className="ai-header">

            <div className="ai-icon">
              ✦
            </div>

            <div>
              <h3>AI Safety Analysis</h3>
              <p>Continuous anomaly detection</p>
            </div>

            <span className="ai-live">
              ACTIVE
            </span>

          </div>

          <div className="risk-meter">

            <div className="risk-meter-header">

              <span>Risk level</span>

              <strong>
                {analysis.risk}
              </strong>

            </div>

            <div className="meter-track">

              <div
                className={`meter-fill ${riskClass()}`}
                style={{
                  width: `${riskPercentage()}%`,
                }}
              ></div>

            </div>

            <div className="meter-labels">
              <span>Safe</span>
              <span>Monitor</span>
              <span>Critical</span>
            </div>

          </div>

          <div className="analysis-message">

            <span>✦</span>

            {analysis.message}

            <small style={{ display: "block", marginTop: 6 }}>
              Anomaly probability: {Math.round(analysis.probability * 100)}%
            </small>

          </div>

        </div>

        {/* REAL SENSORS PANEL */}

        <div className="ai-card">

          <div className="ai-header">

            <div className="ai-icon">
              📡
            </div>

            <div>
              <h3>Real sensors</h3>
              <p>Phone motion, GPS and heart-rate band</p>
            </div>

            <button
              className={`toggle ${liveMode ? "active" : ""}`}
              onClick={() =>
                liveMode ? setLiveMode(false) : startLiveSensors()
              }
            >
              <span></span>
            </button>

          </div>

          {liveMode && (
            <div style={{ marginTop: 12, fontSize: 13 }}>

              <p>
                Phone motion:{" "}
                {liveInfo.acceleration > 0
                  ? `${liveInfo.acceleration} G peak, movement ${liveInfo.movement}`
                  : "waiting for data (needs a phone, over HTTPS)"}
              </p>

              <p>GPS: {locationStatus}</p>

              <p>
                Heart rate:{" "}
                {bandName
                  ? `${bandHr ?? "..."} BPM from ${bandName}`
                  : `${manualHr} BPM (manual)`}
              </p>

              {!bandName && (
                <input
                  type="range"
                  min="50"
                  max="200"
                  value={manualHr}
                  style={{ width: "100%" }}
                  onChange={(event) =>
                    setManualHr(Number(event.target.value))
                  }
                />
              )}

              <button onClick={connectHeartRateBand}>
                Connect heart-rate band
              </button>

              <p style={{ marginTop: 10 }}>
                Heart rate comes from a Bluetooth band if connected,
                otherwise from the slider. Phone motion is mapped to the
                model's inputs with a simple rule, and the model itself
                was trained on synthetic data.
              </p>

            </div>
          )}

        </div>

        {/* LIVE DEMO PANEL */}

        <div className="ai-card">

          <div className="ai-header">

            <div className="ai-icon">
              🎛
            </div>

            <div>
              <h3>Live demo</h3>
              <p>Send readings to the trained model</p>
            </div>

            <button
              className={`toggle ${demoMode ? "active" : ""}`}
              onClick={() => {
                setDemoMode(!demoMode);
                setLiveMode(false);
              }}
            >
              <span></span>
            </button>

          </div>

          {demoMode && (
            <div>

              <div
                style={{
                  display: "flex",
                  gap: 8,
                  flexWrap: "wrap",
                  margin: "12px 0",
                }}
              >
                {DEMO_SCENARIOS.map((scenario) => (
                  <button
                    key={scenario.label}
                    onClick={() => applyDemoValues(scenario.values)}
                  >
                    {scenario.label}
                  </button>
                ))}
              </div>

              {DEMO_SLIDERS.map((slider) => (
                <label
                  key={slider.key}
                  style={{ display: "block", marginBottom: 10 }}
                >
                  <span style={{ display: "block", fontSize: 13 }}>
                    {slider.label}: {demoValues[slider.key]}
                  </span>

                  <input
                    type="range"
                    min={slider.min}
                    max={slider.max}
                    step={slider.step}
                    value={demoValues[slider.key]}
                    style={{ width: "100%" }}
                    onChange={(event) =>
                      applyDemoValues({
                        ...demoValues,
                        [slider.key]: Number(event.target.value),
                      })
                    }
                  />
                </label>
              ))}

            </div>
          )}

        </div>

        {/* CONNECTIONS */}

        <h2 className="section-title">
          Safety connections
        </h2>

        <div className="connection-card">

          <Connection
            icon="⌚"
            title="Wearable"
            status={
              watchConnected
                ? "Connected"
                : "Disconnected"
            }
            connected={watchConnected}
            onClick={() =>
              setWatchConnected(!watchConnected)
            }
          />

          <Connection
            icon="📍"
            title="Location"
            status={
              !locationEnabled
                ? "Disabled"
                : locationStatus === "active"
                ? "GPS active"
                : locationStatus === "denied"
                ? "Blocked - allow location (needs HTTPS)"
                : "Waiting for GPS..."
            }
            connected={locationEnabled}
            onClick={() =>
              setLocationEnabled(!locationEnabled)
            }
          />

          <Connection
            icon="👨‍👩‍👧"
            title="Emergency contacts"
            status={`${contacts.length} saved • tap to manage`}
            connected={contacts.length > 0}
            onClick={() => setActiveTab("contacts")}
          />

        </div>

        {/* QUICK SOS */}

        <button
          className="sos-button"
          onClick={() => activateEmergencyMode(true)}
        >
          <span className="sos-icon">+</span>

          <span>
            <strong>Emergency SOS</strong>
            <small>Press if you need immediate help</small>
          </span>

          <span className="sos-arrow">›</span>

        </button>

      </div>
    );
  }

  // ------------------------------------------------
  // ACTIVITY
  // ------------------------------------------------

  function ActivityScreen() {
    return (
      <div className="screen">

        <PageHeader
          title="Activity"
          subtitle="Your recent safety monitoring"
        />

        <div className="activity-summary">

          <div>
            <span>Monitoring</span>
            <strong>{monitoring ? "Active" : "Paused"}</strong>
          </div>

          <div>
            <span>AI checks</span>
            <strong>{activity.length}</strong>
          </div>

          <div>
            <span>Alerts</span>
            <strong>{alerts.length}</strong>
          </div>

        </div>

        <div className="activity-list">

          {activity.length === 0 ? (

            <div className="empty-state">
              <div>📊</div>
              <h3>Monitoring activity</h3>
              <p>
                Live sensor events will appear here.
              </p>
            </div>

          ) : (

            activity.map((item, index) => (

              <div
                className="activity-item"
                key={index}
              >

                <div className="activity-icon">
                  {item.anomaly ? "⚠️" : "✓"}
                </div>

                <div className="activity-info">

                  <strong>
                    {item.anomaly
                      ? "Unusual activity"
                      : "Normal activity"}
                  </strong>

                  <span>
                    Heart rate {item.heartRate} BPM
                  </span>

                </div>

                <div className="activity-time">
                  {item.time}
                </div>

              </div>

            ))

          )}

        </div>

      </div>
    );
  }

  // ------------------------------------------------
  // ALERTS
  // ------------------------------------------------

  function AlertsScreen() {
    return (
      <div className="screen">

        <PageHeader
          title="Alerts"
          subtitle="Safety and emergency events"
        />

        {alerts.length === 0 ? (

          <div className="empty-state large">

            <div className="empty-shield">
              ✓
            </div>

            <h3>No emergency alerts</h3>

            <p>
              Everything is currently under control.
            </p>

          </div>

        ) : (

          alerts.map((alert) => (

            <div
              className="alert-card"
              key={alert.id}
            >

              <div className="alert-icon">
                🚨
              </div>

              <div>
                <strong>{alert.type}</strong>

                <p>{alert.status}</p>

                <small>{alert.time}</small>

                {alert.message && (
                  <p style={{ fontSize: 12, margin: "6px 0 0" }}>
                    "{alert.message}"
                  </p>
                )}

                {(alert.results || []).map((result, index) => (
                  <p
                    key={index}
                    style={{ fontSize: 12, margin: "4px 0 0" }}
                  >
                    {result.name} ({result.phone}) — SMS: {result.sms} ·
                    WhatsApp: {result.whatsapp}
                  </p>
                ))}
              </div>

            </div>

          ))

        )}

      </div>
    );
  }

  // ------------------------------------------------
  // PROFILE
  // ------------------------------------------------

  function ProfileScreen() {
    return (
      <div className="screen">

        <PageHeader
          title="Profile"
          subtitle="Safety preferences"
        />

        <div className="profile-card">

          <div className="avatar">
            {(user.name || "U").charAt(0).toUpperCase()}
          </div>

          <div>
            <h2>{user.name}</h2>
            <p>{user.email}</p>
          </div>

          <button onClick={onLogout} style={{ marginLeft: "auto" }}>
            Log out
          </button>

        </div>

        <div className="settings-card">

          <Setting
            icon="⌚"
            title="Wearable monitoring"
            description="Use wearable sensor data"
            enabled={watchConnected}
            onClick={() =>
              setWatchConnected(!watchConnected)
            }
          />

          <Setting
            icon="📍"
            title="Location tracking"
            description="Share location during emergencies"
            enabled={locationEnabled}
            onClick={() =>
              setLocationEnabled(!locationEnabled)
            }
          />

          <Setting
            icon="🔔"
            title="Emergency notifications"
            description="Notify emergency contacts"
            enabled
          />

          <Setting
            icon="🤖"
            title="AI anomaly detection"
            description="Detect unusual activity"
            enabled={monitoring}
            onClick={() =>
              setMonitoring(!monitoring)
            }
          />

        </div>

        {modelInfo && modelInfo.available && modelInfo.confusion && (
          <div className="ai-card">

            <div className="ai-header">

              <div className="ai-icon">
                ✦
              </div>

              <div>
                <h3>Detection model</h3>
                <p>{modelInfo.model}</p>
              </div>

            </div>

            <div className="analysis-message">

              <span>✦</span>

              Accuracy {Math.round(modelInfo.accuracy * 1000) / 10}% ·
              Precision {Math.round(modelInfo.precision * 1000) / 10}% ·
              Recall {Math.round(modelInfo.recall * 1000) / 10}%

              <small style={{ display: "block", marginTop: 6 }}>
                Tested on {modelInfo.test_rows} unseen readings
                ({modelInfo.rows} total, {modelInfo.data.toLowerCase()}).
                Missed {modelInfo.confusion.fn}, false alarms{" "}
                {modelInfo.confusion.fp}.
              </small>

            </div>

          </div>
        )}

        <div className="privacy-note">

          <span>🔒</span>

          <div>
            <strong>Your privacy matters</strong>

            <p>
              Sensor information is used only to
              evaluate your safety state in this
              prototype.
            </p>
          </div>

        </div>

      </div>
    );
  }

  // ------------------------------------------------
  // EMERGENCY CONTACTS
  // ------------------------------------------------

  function ContactsScreen() {
    const inputStyle = {
      width: "100%",
      boxSizing: "border-box",
      padding: 10,
      marginBottom: 8,
      borderRadius: 8,
      border: "1px solid #ccc",
      fontSize: 14,
    };

    return (
      <div className="screen">

        <PageHeader
          title="Emergency contacts"
          subtitle="People alerted when you need help"
        />

        <button
          onClick={() => setActiveTab("home")}
          style={{ marginBottom: 12 }}
        >
          ‹ Back
        </button>

        {contacts.length === 0 ? (

          <div className="empty-state">
            <div>👤</div>
            <h3>No contacts yet</h3>
            <p>Add someone below so they receive your alerts.</p>
          </div>

        ) : (

          contacts.map((contact) => (

            <div className="alert-card" key={contact.id}>

              <div className="alert-icon">
                👤
              </div>

              <div style={{ flex: 1 }}>
                <strong>{contact.name}</strong>

                <p>
                  {contact.relation || "Contact"} · {contact.phone}
                </p>
              </div>

              <button onClick={() => removeContact(contact.id)}>
                Remove
              </button>

            </div>

          ))

        )}

        <div className="settings-card" style={{ padding: 14 }}>

          <h3 style={{ marginTop: 0 }}>Add a contact</h3>

          <input
            style={inputStyle}
            placeholder="Name"
            value={newContact.name}
            onChange={(event) =>
              setNewContact({ ...newContact, name: event.target.value })
            }
          />

          <input
            style={inputStyle}
            placeholder="Phone with country code, e.g. +919876543210"
            inputMode="tel"
            value={newContact.phone}
            onChange={(event) =>
              setNewContact({ ...newContact, phone: event.target.value })
            }
          />

          <input
            style={inputStyle}
            placeholder="Relation (optional)"
            value={newContact.relation}
            onChange={(event) =>
              setNewContact({ ...newContact, relation: event.target.value })
            }
          />

          <button onClick={addContact}>Save contact</button>

          {contacts.length > 0 && (
            <button
              onClick={sendTestAlert}
              style={{ marginLeft: 8 }}
            >
              Send test alert
            </button>
          )}

        </div>

        <div className="privacy-note">

          <span>ℹ️</span>

          <div>
            <p>
              With a Twilio trial account, messages only reach phone
              numbers verified in the Twilio console.
            </p>
          </div>

        </div>

      </div>
    );
  }

  // ------------------------------------------------
  // SAFETY MODAL
  // ------------------------------------------------

  function SafetyModal() {
    if (!safetyCheck) return null;

    const shown = Math.max(countdown, 0);

    return (
      <div className="modal-overlay">

        <div className="safety-modal">

          <div className="warning-pulse">
            ⚠️
          </div>

          <span className="modal-label">
            UNUSUAL ACTIVITY DETECTED
          </span>

          <h2>
            Are you safe?
          </h2>

          <p>
            We detected activity that may require
            your attention.
          </p>

          <div className="countdown">

            <svg viewBox="0 0 100 100">

              <circle
                cx="50"
                cy="50"
                r="44"
                className="countdown-bg"
              />

              <circle
                cx="50"
                cy="50"
                r="44"
                className="countdown-progress"
                style={{
                  strokeDashoffset:
                    276 - (276 * shown) / 10,
                }}
              />

            </svg>

            <strong>{shown}</strong>

          </div>

          <p className="countdown-text">
            Please respond before the timer ends.
          </p>

          <button
            className="safe-button"
            onClick={() =>
              handleSafetyResponse("yes")
            }
          >
            ✓ I'M SAFE
          </button>

          <button
            className="help-button"
            onClick={() =>
              handleSafetyResponse("no")
            }
          >
            I NEED HELP
          </button>

        </div>

      </div>
    );
  }

  // ------------------------------------------------
  // EMERGENCY SCREEN
  // ------------------------------------------------

  function EmergencyScreen() {
    if (!emergencyMode) return null;

    return (
      <div className="emergency-screen">

        <div className="emergency-pulse">
          !
        </div>

        <span className="emergency-label">
          EMERGENCY MODE
        </span>

        <h1>
          Help is being notified
        </h1>

        <p>
          Your emergency contacts have been
          notified with your current location.
        </p>

        <div className="emergency-status">

          <EmergencyRow
            icon="📍"
            title="Location shared"
            status="Active"
          />

          <EmergencyRow
            icon="👨‍👩‍👧"
            title="Emergency contacts"
            status="Notified"
          />

          <EmergencyRow
            icon="📱"
            title="Safety monitoring"
            status="Active"
          />

        </div>

        <button
          className="cancel-emergency"
          onClick={cancelEmergency}
        >
          I'M SAFE — CANCEL ALERT
        </button>

        <button
          className="call-button"
          onClick={() =>
            showToast("Calling emergency services...")
          }
        >
          📞 CALL EMERGENCY SERVICES
        </button>

      </div>
    );
  }

  // ------------------------------------------------
  // RENDER
  // Screens are called as functions (not <Component />) so React
  // does not remount them on every state update.
  // ------------------------------------------------

  return (
    <div className="app-wrapper">

      <div className="phone">

        {!emergencyMode && (
          <>
            <main>

              {activeTab === "home" && HomeScreen()}

              {activeTab === "activity" && ActivityScreen()}

              {activeTab === "alerts" && AlertsScreen()}

              {activeTab === "profile" && ProfileScreen()}

              {activeTab === "contacts" && ContactsScreen()}

            </main>

            <nav className="bottom-nav">

              <NavItem
                icon="⌂"
                label="Home"
                active={activeTab === "home"}
                onClick={() => setActiveTab("home")}
              />

              <NavItem
                icon="◌"
                label="Activity"
                active={activeTab === "activity"}
                onClick={() =>
                  setActiveTab("activity")
                }
              />

              <NavItem
                icon="♢"
                label="Alerts"
                active={activeTab === "alerts"}
                onClick={() =>
                  setActiveTab("alerts")
                }
                badge={alerts.length > 0}
              />

              <NavItem
                icon="◯"
                label="Profile"
                active={activeTab === "profile"}
                onClick={() =>
                  setActiveTab("profile")
                }
              />

            </nav>
          </>
        )}

        {SafetyModal()}

        {EmergencyScreen()}

        {toast && (
          <div className="toast">
            ✓ {toast}
          </div>
        )}

      </div>

    </div>
  );
}


// ------------------------------------------------
// COMPONENTS
// ------------------------------------------------

function SensorCard({
  icon,
  title,
  value,
  unit,
  active,
}) {
  return (
    <div
      className={`sensor-card ${
        active ? "sensor-warning" : ""
      }`}
    >

      <div className="sensor-top">

        <span className="sensor-icon">
          {icon}
        </span>

        <span
          className={`sensor-status ${
            active ? "warning" : ""
          }`}
        >
          {active ? "CHECK" : "NORMAL"}
        </span>

      </div>

      <span className="sensor-title">
        {title}
      </span>

      <div className="sensor-value">

        <strong>{value}</strong>

        <span>{unit}</span>

      </div>

    </div>
  );
}


function Connection({
  icon,
  title,
  status,
  connected,
  onClick,
}) {
  return (
    <div
      className="connection"
      onClick={onClick}
    >

      <div className="connection-icon">
        {icon}
      </div>

      <div className="connection-info">

        <strong>{title}</strong>

        <span>{status}</span>

      </div>

      <div
        className={`connection-status ${
          connected ? "connected" : ""
        }`}
      >
        {connected ? "●" : "○"}
      </div>

    </div>
  );
}


function Setting({
  icon,
  title,
  description,
  enabled,
  onClick,
}) {
  return (
    <div className="setting">

      <div className="setting-icon">
        {icon}
      </div>

      <div className="setting-info">

        <strong>{title}</strong>

        <span>{description}</span>

      </div>

      <button
        className={`setting-toggle ${
          enabled ? "active" : ""
        }`}
        onClick={onClick}
      >
        <span></span>
      </button>

    </div>
  );
}


function NavItem({
  icon,
  label,
  active,
  onClick,
  badge,
}) {
  return (
    <button
      className={`nav-item ${
        active ? "active" : ""
      }`}
      onClick={onClick}
    >

      <span className="nav-icon">
        {icon}

        {badge && (
          <span className="nav-badge"></span>
        )}
      </span>

      <span>{label}</span>

    </button>
  );
}


function PageHeader({ title, subtitle }) {
  return (
    <div className="page-header">

      <h1>{title}</h1>

      <p>{subtitle}</p>

    </div>
  );
}


function EmergencyRow({
  icon,
  title,
  status,
}) {
  return (
    <div className="emergency-row">

      <span className="emergency-row-icon">
        {icon}
      </span>

      <div>
        <strong>{title}</strong>
        <span>{status}</span>
      </div>

      <b>✓</b>

    </div>
  );
}


// ------------------------------------------------
// ROOT: login first, then the app
// ------------------------------------------------

function App() {
  const [session, setSession] = useState(() => loadSession());

  useEffect(() => {
    const onUnauthorized = () => {
      clearSession();
      setSession(null);
    };

    window.addEventListener("safeguard-unauthorized", onUnauthorized);

    return () =>
      window.removeEventListener("safeguard-unauthorized", onUnauthorized);
  }, []);

  if (!session || !session.user) {
    return (
      <AuthScreen
        onAuth={(newSession) => {
          saveSession(newSession);
          setSession(newSession);
        }}
      />
    );
  }

  return (
    <SafeGuardApp
      key={session.user.id}
      user={session.user}
      onLogout={() => {
        clearSession();
        setSession(null);
      }}
    />
  );
}

export default App;
