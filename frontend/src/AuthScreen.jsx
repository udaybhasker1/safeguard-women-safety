import React, { useState } from "react";
import { apiFetch } from "./api";


export default function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const inputStyle = {
    width: "100%",
    boxSizing: "border-box",
    padding: 12,
    marginBottom: 10,
    borderRadius: 10,
    border: "1px solid #ccc",
    fontSize: 15,
  };

  async function submit() {
    setError("");

    if (!form.email.trim() || !form.password) {
      setError("Enter your email and password.");
      return;
    }

    if (mode === "register" && !form.name.trim()) {
      setError("Enter your name.");
      return;
    }

    setBusy(true);

    try {
      const body =
        mode === "register"
          ? form
          : { email: form.email, password: form.password };

      const response = await apiFetch(`/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(
          typeof data.detail === "string"
            ? data.detail
            : "Please check your details and try again."
        );
        return;
      }

      onAuth({ token: data.token, user: data.user });
    } catch {
      setError("Cannot reach the server. Is the backend running?");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-wrapper">

      <div className="phone">

        <main>

          <div className="screen">

            <div className="topbar">
              <div>
                <div className="hello">Welcome</div>
                <h1>SafeGuard</h1>
              </div>
            </div>

            <p>
              {mode === "login"
                ? "Log in to manage your emergency contacts and alerts."
                : "Create an account to get started."}
            </p>

            {mode === "register" && (
              <input
                style={inputStyle}
                placeholder="Your name"
                value={form.name}
                onChange={(event) =>
                  setForm({ ...form, name: event.target.value })
                }
              />
            )}

            <input
              style={inputStyle}
              placeholder="Email"
              type="email"
              autoComplete="email"
              value={form.email}
              onChange={(event) =>
                setForm({ ...form, email: event.target.value })
              }
            />

            <input
              style={inputStyle}
              placeholder="Password (8+ characters)"
              type="password"
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
              value={form.password}
              onChange={(event) =>
                setForm({ ...form, password: event.target.value })
              }
              onKeyDown={(event) => {
                if (event.key === "Enter") submit();
              }}
            />

            {error && (
              <p style={{ color: "#c0392b", fontSize: 14 }}>{error}</p>
            )}

            <button
              onClick={submit}
              disabled={busy}
              style={{ width: "100%", padding: 12, marginBottom: 12 }}
            >
              {busy
                ? "Please wait..."
                : mode === "login"
                ? "Log in"
                : "Create account"}
            </button>

            <button
              onClick={() => {
                setError("");
                setMode(mode === "login" ? "register" : "login");
              }}
              style={{ width: "100%", padding: 10 }}
            >
              {mode === "login"
                ? "New here? Create an account"
                : "Already have an account? Log in"}
            </button>

          </div>

        </main>

      </div>

    </div>
  );
}
