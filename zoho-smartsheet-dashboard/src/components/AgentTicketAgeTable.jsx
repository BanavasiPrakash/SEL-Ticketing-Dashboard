import React, { useState } from 'react';

export default function AgentTicketAgeTable({
  membersData,
  onClose,
  selectedAges = ["sevenDays", "twoWeeks", "month"],
  selectedStatuses = [],
  showTimeDropdown
}) {
  const [hoveredRowIndex, setHoveredRowIndex] = useState(null);

  const ageColumns = [
              { key: "thirteenDays", label: "1-13 Days Tickets", ageProp: "BetweenOneAndThirteenDays" },
              { key: "twoWeeks", label: "14 - 30 Days Tickets", ageProp: "BetweenTwoWeeksAndMonth" },
              { key: "month", label: "30+ Days Tickets", ageProp: "OlderThanMonth" }
            ];

  const visibleAgeColumns = ageColumns.filter(col => selectedAges.includes(col.key));
  const columnsToShow = [
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

  // Which statuses to show? If none picked, don't show mini-boxes
  const statusKeys =
    selectedStatuses && selectedStatuses.length > 0
      ? selectedStatuses.map(st => st.value)
      : [];

  const tableRows = membersData
    .map(agent => {
      const tickets = agent.tickets || {};
      const total =
        (tickets.open || 0) +
        (tickets.hold || 0) +
        (tickets.escalated || 0) +
        (tickets.unassigned || 0) +
        (tickets.inProgress || 0);
      return {
        name: agent.name,
        total,
        tickets
      };
    })
    .filter(row => row.total > 0)
    .sort((a, b) => a.name.localeCompare(b.name));

  // Styles
  const cellStyle3D = {
    padding: 14,
    fontWeight: 700,
    borderRadius: 12,
    background: 'linear-gradient(135deg, #23272f 60%, #15171a 100%)',
    color: '#f4f4f4',
    borderTop: '2px solid #4070d6',
    borderLeft: '2px solid #3a65ca',
    borderBottom: '2.5px solid #1c2a5f',
    borderRight: '2.5px solid #162158',
    transition: 'background 0.18s',
    cursor: 'pointer'
  };

  const cellStyle3DHovered = {
    ...cellStyle3D,
    background: 'linear-gradient(135deg, #2446a3 60%, #293956 100%)',
    color: '#fff'
  };

  const headerStyle3D = {
    padding: 14,
    textAlign: 'center',
    fontWeight: 900,
    background: 'linear-gradient(135deg, #3752a6 70%, #23355a 100%)',
    color: '#fff',
    borderTop: '2px solid #5375ce',
    borderLeft: '2px solid #6d90e5',
    borderBottom: '2px solid #1e2950',
    borderRight: '2px solid #182345',
    borderRadius: '12px 12px 0 0'
  };

  const miniBoxStyle = color => ({
    background: "#232c48",
    borderRadius: 13,
    minWidth: 32,
    minHeight: 44,
    fontWeight: 900,
    fontSize: 21,
    color: "#fff",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    margin: "0 4px",
    position: "relative",
    border: "2px solid #263256",
    boxShadow: "0 2px 8px #1e448949",
    borderTop: `5px solid ${color}`
  });

  React.useEffect(() => {
    const handleDoubleClick = () => {
      if (onClose) onClose();
    };
    window.addEventListener('dblclick', handleDoubleClick);
    return () => window.removeEventListener('dblclick', handleDoubleClick);
  }, [onClose]);

  return (
    <div style={{ margin: '24px auto', maxWidth: 1400, position: 'relative' }}>
      <table style={{
        width: '100%',
        borderCollapse: 'separate',
        borderRadius: 16,
        border: '2px solid #32406b',
        fontSize: 18
      }}>
        <thead>
          <tr>
            {columnsToShow.map(col => (
              <th key={col.key} style={headerStyle3D}>
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
                color: '#dedede',
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
                  style={hoveredRowIndex === rowIndex
                    ? { ...cellStyle3DHovered, textAlign: 'left' }
                    : { ...cellStyle3D, textAlign: 'left' }
                  }
                  onMouseEnter={() => setHoveredRowIndex(rowIndex)}
                  onMouseLeave={() => setHoveredRowIndex(null)}
                >
                  {row.name}
                </td>
                <td
                  style={hoveredRowIndex === rowIndex
                    ? { ...cellStyle3DHovered, textAlign: 'center' } // ticket total centered
                    : { ...cellStyle3D, textAlign: 'center' }
                  }
                >
                  {row.total}
                </td>
                {visibleAgeColumns.map(col => (
                  <td
                    key={col.key}
                    style={hoveredRowIndex === rowIndex
                      ? { ...cellStyle3DHovered, textAlign: 'center' } // age counts centered
                      : { ...cellStyle3D, textAlign: 'center' }
                    }>
                    {statusKeys.length === 0 ? (
                      // No filter: show normal bucket sum
                      <>
                        {/* Sum of all buckets (matching your original logic) */}
                        {(row.tickets['open' + col.ageProp] ?? 0) +
                         (row.tickets['hold' + col.ageProp] ?? 0) +
                         (row.tickets['inProgress' + col.ageProp] ?? 0)}
                      </>
                    ) : (
                      // If one or more status keys, show mini status boxes only for selected
                      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                        {statusKeys.map(status =>
                          <div key={status} style={miniBoxStyle(statusPalette[status])}>
                            {row.tickets[status + col.ageProp] ?? 0}
                          </div>
                        )}
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
