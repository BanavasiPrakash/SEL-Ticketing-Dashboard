import React, { useState, useEffect } from "react";
import TicketDashboard from "./TicketDashboard";

function CombinedDashboard() {
  const [activeView, setActiveView] = useState("tickets");
  const ipMonitorBg = "#3fabed";

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveView(view => (view === "tickets" ? "ip-monitor" : "tickets"));
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div
      style={{
        height: "100vh",
        width: "100vw",
        margin: 0,
        padding: 0,
        boxSizing: "border-box",
        background: "#3fabed",
        position: "absolute",
        inset: 0,
        overflow: "hidden",
      }}
    >
      {/* Always mounted, just show/hide */}
      <div
        style={{
          display: activeView === "tickets" ? "block" : "none",
          width: "100vw",
          height: "100vh",
        }}
      >
        <TicketDashboard />
      </div>
      <div
        style={{
          display: activeView === "ip-monitor" ? "block" : "none",
          width: "100vw",
          height: "100vh",
          background: ipMonitorBg,
          position: "absolute",
          inset: 0,
        }}
      >
        <iframe
          src="http://192.168.3.8:90/status.html"
          style={{
            width: "100vw",
            height: "100vh",
            border: "none",
            display: "block",
            background: ipMonitorBg,
            position: "absolute",
            inset: 0,
          }}
          title="IP Monitoring"
        />
      </div>
    </div>
  );
}

export default CombinedDashboard;
