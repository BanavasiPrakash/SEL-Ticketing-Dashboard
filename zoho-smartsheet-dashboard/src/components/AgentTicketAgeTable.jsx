import React, { useState } from 'react';
import Tippy from '@tippyjs/react';
import 'tippy.js/dist/tippy.css';

export default function AgentTicketAgeTable({
  membersData,
  onClose,
  selectedAges = ["fifteenDays", "sixteenToThirty", "month"],
  selectedStatuses = [],
  showTimeDropdown,
  selectedDepartmentId,
  selectedAgentNames = []
}) {
  const [hoveredRowIndex, setHoveredRowIndex] = useState(null);

  const ageColumns = [
    { key: "fifteenDays", label: "1-15 Days Tickets", ageProp: "BetweenOneAndFifteenDays" },
    { key: "sixteenToThirty", label: "16-30 Days Tickets", ageProp: "BetweenSixteenAndThirtyDays" },
    { key: "month", label: "30+ Days Tickets", ageProp: "OlderThanThirtyDays" }
  ];

  const visibleAgeColumns = ageColumns.filter(col => selectedAges.includes(col.key));
  const columnsToShow = [
    { key: "serial", label: "SI. NO." },
    { key: "name", label: "Agent Name" },
    { key: "total", label: "Total Ticket Count" },
    ...visibleAgeColumns
  ];

  const statusPalette = {
    open: "#bd2331",
    hold: "#ffc107",
    inProgress: "#8fc63d",
    escalated: "#ef6724"
  };

  const statusKeys =
    selectedStatuses && selectedStatuses.length > 0
      ? selectedStatuses.map(st => st.value)
      : [];

  const tableRows = (membersData || [])
    .filter(agent => {
      if (selectedDepartmentId) {
        const agentHasTickets =
          (agent.departmentTicketCounts?.[selectedDepartmentId] || 0) > 0 ||
          Object.values(agent.departmentAgingCounts?.[selectedDepartmentId] || {}).some(v => v > 0);
        const nameMatch =
          !selectedAgentNames.length ||
          selectedAgentNames.includes(agent.name.trim());
        return agentHasTickets && nameMatch;
      } else {
        const t = agent.tickets || {};
        return (t.open || 0) + (t.hold || 0) + (t.escalated || 0) + (t.unassigned || 0) + (t.inProgress || 0) > 0;
      }
    })
    .map(agent => {
      let agingCounts = {};
      if (selectedDepartmentId) {
        agingCounts = agent.departmentAgingCounts?.[selectedDepartmentId] || {};
      } else if (agent.tickets) {
        agingCounts = agent.tickets;
      }
      return {
        name: agent.name,
        agingCounts,
        departmentAgingCounts: agent.departmentAgingCounts,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const cellStyle3D = {
    padding: 14,
    fontWeight: 700,
    borderRadius: 12,
    background: 'linear-gradient(135deg, #23272f 60%, #15171a 100%)',
    color: '#f4f4f4',
    borderTop: '2px solid #1E4489',
    borderLeft: '2px solid #1E4489',
    borderBottom: '2.5px solid #1E4489',
    borderRight: '2.5px solid #1E4489',
    transition: 'background 0.18s',
    cursor: 'pointer'
  };

  const serialHeaderStyle = {
    ...cellStyle3D,
    width: 30,
    minWidth: 30,
    maxWidth: 40,
    textAlign: 'center',
    position: 'sticky',
    top: 0,
    zIndex: 2,
    fontWeight: 900,
    background: 'linear-gradient(135deg, #1E4489 70%, #1E4489 100%)'
  };

  const cellStyle3DHovered = {
    ...cellStyle3D,
    background: 'linear-gradient(135deg, #1E4489 60%, #1E4489 100%)',
    color: '#fff'
  };

  const headerStyle3D = {
    padding: 14,
    textAlign: 'center',
    fontWeight: 900,
    background: 'linear-gradient(135deg, #1E4489 70%, #1E4489 100%)',
    color: '#fff',
    borderTop: '2px solid #5375ce',
    borderLeft: '2px solid #6d90e5',
    borderBottom: '2px solid #1e2950',
    borderRight: '2px solid #182345',
    borderRadius: '12px 12px 0 0',
    position: 'sticky',
    top: 0,
    zIndex: 2,
  };

  const miniBoxStyle = color => ({
    background: "#232c48",
    borderRadius: 18,
    minWidth: 32,
    minHeight: 44,
    fontWeight: 900,
    fontSize: 21,
    color: "white",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    margin: "0 4px",
    position: "relative",
    border: "2px solid #263256",
    borderTop: `5px solid ${color}`
  });

  React.useEffect(() => {
    const handleDoubleClick = () => {
      if (onClose) onClose();
    };
    window.addEventListener('dblclick', handleDoubleClick);
    return () => window.removeEventListener('dblclick', handleDoubleClick);
  }, [onClose]);

  function aggregateTickets(agent, ageProp, status) {
    if (!selectedDepartmentId && agent.departmentAgingCounts) {
      return Object.values(agent.departmentAgingCounts).flatMap(age =>
        age?.[status + ageProp + 'Tickets'] || []
      );
    }
    return selectedDepartmentId && agent.departmentAgingCounts?.[selectedDepartmentId]
      ? agent.departmentAgingCounts[selectedDepartmentId][status + ageProp + 'Tickets'] || []
      : [];
  }

  function countFromArray(agent, ageProp, status) {
    return aggregateTickets(agent, ageProp, status).length;
  }

  return (
    <div
      className="no-scrollbar"
      style={{
        margin: '24px auto',
        maxWidth: 1400,
        position: 'relative',
        maxHeight: 549,
        overflowY: 'auto',
        borderRadius: 16,
        border: '2px solid #32406b',
        background: '#16171a'
      }}
    >
      <table style={{ width: '100%', borderCollapse: 'separate', borderRadius: 16, fontSize: 18 }}>
        <thead>
          <tr>
            {columnsToShow.map(col => (
              <th
                key={col.key}
                style={col.key === "serial" ? serialHeaderStyle : headerStyle3D}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tableRows.length === 0 ? (
            <tr>
              <td colSpan={columnsToShow.length} style={{
                textAlign: 'center',
                padding: 28,
                color: 'WHITE',
                fontSize: 19,
                background: 'linear-gradient(110deg, #181b26 80%, #16171a 100%)',
                borderRadius: 14
              }}>
                No data available
              </td>
            </tr>
          ) : (
            tableRows.map((row, rowIndex) => (
              <tr
                key={row.name}
                style={{
                  background: hoveredRowIndex === rowIndex
                    ? 'linear-gradient(120deg, #2446a3 85%, #293956 100%)'
                    : 'linear-gradient(120deg, #16171a 82%, #232d3d 100%)',
                  color: 'white',
                  fontSize: 17,
                  fontWeight: 700,
                  borderBottom: '2px solid #2b3243'
                }}
              >
                <td
                  style={{
                    ...(hoveredRowIndex === rowIndex ? cellStyle3DHovered : cellStyle3D),
                    width: 30,
                    minWidth: 30,
                    maxWidth: 40,
                    textAlign: 'center'
                  }}
                >
                  {rowIndex + 1}
                </td>
                <td
                  style={hoveredRowIndex === rowIndex ? { ...cellStyle3DHovered, textAlign: 'left' } : { ...cellStyle3D, textAlign: 'left' }}
                  onMouseEnter={() => setHoveredRowIndex(rowIndex)}
                  onMouseLeave={() => setHoveredRowIndex(null)}
                >
                  {row.name}
                </td>
                <td
                  style={hoveredRowIndex === rowIndex ? { ...cellStyle3DHovered, textAlign: 'center' } : { ...cellStyle3D, textAlign: 'center' }}
                >
                  {visibleAgeColumns.reduce((sum, col) => (
                    sum +
                    countFromArray(row, col.ageProp, 'open') +
                    countFromArray(row, col.ageProp, 'hold') +
                    countFromArray(row, col.ageProp, 'inProgress') +
                    countFromArray(row, col.ageProp, 'escalated')
                  ), 0)}
                </td>
                {visibleAgeColumns.map(col => (
                  <td
                    key={col.key}
                    style={hoveredRowIndex === rowIndex ? { ...cellStyle3DHovered, textAlign: 'center' } : { ...cellStyle3D, textAlign: 'center' }}
                  >
                    {(statusKeys.length === 0 || (statusKeys.length === 1 && statusKeys[0] === "total")) ? (
                      <Tippy content={
                        (() => {
                          const open = aggregateTickets(row, col.ageProp, 'open');
                          const hold = aggregateTickets(row, col.ageProp, 'hold');
                          const inProgress = aggregateTickets(row, col.ageProp, 'inProgress');
                          const escalated = aggregateTickets(row, col.ageProp, 'escalated');
                          const arr = [...open, ...hold, ...inProgress, ...escalated];
                          return arr.length ? arr.join(', ') : "No tickets";
                        })()
                      }>
                        <span style={{ cursor: 'pointer', display: 'inline-block', padding: '4px' }}>
                          {
                            countFromArray(row, col.ageProp, 'open') +
                            countFromArray(row, col.ageProp, 'hold') +
                            countFromArray(row, col.ageProp, 'inProgress') +
                            countFromArray(row, col.ageProp, 'escalated')
                          }
                        </span>
                      </Tippy>
                    ) : (
                      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                        {statusKeys.filter(status => status !== "total").map(status => {
                          const arr = aggregateTickets(row, col.ageProp, status);
                          return (
                            <Tippy key={status} content={arr.length ? arr.join(', ') : "No tickets"}>
                              <span style={miniBoxStyle(statusPalette[status])}>
                                {arr.length}
                              </span>
                            </Tippy>
                          );
                        })}
                      </div>
                    )}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
