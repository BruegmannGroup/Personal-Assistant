import { useState } from "react";

export function KeyGate({ onSubmit }: { onSubmit: (key: string) => void }) {
  const [value, setValue] = useState("");

  return (
    <div className="key-gate">
      <div className="key-gate-card">
        <h2>Momentum Dashboard</h2>
        <p>Enter the dashboard passphrase (set once, kept only on this device).</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (value.trim()) onSubmit(value.trim());
          }}
        >
          <input
            type="password"
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Dashboard passphrase"
          />
          <button type="submit">Continue</button>
        </form>
      </div>
    </div>
  );
}
