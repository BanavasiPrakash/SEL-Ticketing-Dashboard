const express = require("express");
const axios = require("axios");
const cors = require("cors");
const Bottleneck = require("bottleneck"); // Rate limiter to avoid throttling errors from Zoho APIs
const axiosRetry = require("axios-retry").default; // Retry failed axios requests

const app = express();
const port = process.env.PORT || 5000;

app.use(cors()); // Enable CORS for frontend calls
app.use(express.json()); // Parse JSON request bodies

// Set Content Security Policy for allowed connect sources (API servers)
app.use((req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; connect-src 'self' http://localhost:5000 http://127.0.0.1:5000 http://192.168.3.8:5000"
  );
  next();
});

// OAuth credentials for Zoho
const clientId = "1000.VEPAX9T8TKDWJZZD95XT6NN52PRPQY";
const clientSecret = "acca291b89430180ced19660cd28ad8ce1e4bec6e8";
const refreshToken = "1000.465100d543b8d9471507bdf0b0263414.608f3f3817d11b09f142fd29810cca6f";

// Cache access token & expiry to reuse before re-fetching
let cachedAccessToken = null;
let accessTokenExpiry = null;

// Bottleneck limiter to delay requests to Zoho to avoid rate limits (1 request per 1100ms)
const limiter = new Bottleneck({ minTime: 1100 });

// Configure axios-retry to retry failed requests on 429 or 5xx errors
axiosRetry(axios, {
  retries: 4,
  retryDelay: axiosRetry.exponentialDelay,
  retryCondition: (error) =>
    error.response && (error.response.status === 429 || error.response.status >= 500),
});

// List of departments (hardcoded for this app)
const departmentList = [
  { id: "634846000000006907", name: "IT Support" },
  { id: "634846000000334045", name: "Wescon" },
  { id: "634846000006115409", name: "ERP or SAP Support" },
  { id: "634846000009938029", name: "EDI Support" },
  { id: "634846000018669037", name: "Test Help Desk" },
  { id: "634846000054176855", name: "Digitization" },
  { id: "634846000054190373", name: "PLM or IoT & CAD Support" },
];

// Get OAuth access token, using cache to reduce requests
async function getAccessToken() {
  const now = Date.now();
  if (cachedAccessToken && accessTokenExpiry && now < accessTokenExpiry) {
    return cachedAccessToken;
  }
  const params = new URLSearchParams();
  params.append("refresh_token", refreshToken);
  params.append("client_id", clientId);
  params.append("client_secret", clientSecret);
  params.append("grant_type", "refresh_token");
  const response = await axios.post(
    "https://accounts.zoho.com/oauth/v2/token",
    params.toString(),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );
  cachedAccessToken = response.data.access_token;
  accessTokenExpiry = now + (response.data.expires_in - 60) * 1000; // Subtract 60 seconds buffer
  return cachedAccessToken;
}

// Fetch all tickets, supports pagination and filtering by departmentIds and agentId
async function fetchAllTickets(accessToken, departmentIds = [], agentId = null) {
  let from = 1,
    limit = 100,
    allTickets = [];
  const deptIdsToFetch = departmentIds.length > 0 ? departmentIds : [null];
  for (const deptId of deptIdsToFetch) {
    let continueFetching = true,
      pageFrom = 1;
    while (continueFetching) {
      const params = { from: pageFrom, limit };
      if (deptId) params.departmentId = deptId;
      if (agentId) params.agentId = agentId;
      const response = await limiter.schedule(() =>
        axios.get("https://desk.zoho.com/api/v1/tickets", {
          headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
          params,
        })
      );
      const ticketsBatch = response.data.data || [];
      allTickets = allTickets.concat(ticketsBatch);
      if (ticketsBatch.length < limit) continueFetching = false;
      else pageFrom += limit;
    }
  }
  return allTickets;
}

// Fetch all users (agents), with pagination
async function fetchAllUsers(accessToken) {
  let from = 1,
    limit = 100,
    allUsers = [];
  while (true) {
    const response = await limiter.schedule(() =>
      axios.get("https://desk.zoho.com/api/v1/users", {
        headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
        params: { from, limit },
      })
    );
    allUsers = allUsers.concat(response.data.data || []);
    if (response.data.data.length < limit) break;
    from += limit;
  }
  return allUsers;
}

// Fetch specific users by IDs; used to fetch missing users not in initial fetch
async function fetchUsersByIds(accessToken, ids) {
  const users = [];
  for (const id of ids) {
    try {
      const response = await limiter.schedule(() =>
        axios.get(`https://desk.zoho.com/api/v1/users/${id}`, {
          headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
        })
      );
      users.push(response.data);
    } catch (err) {}
  }
  return users;
}

// Map to normalize Zoho ticket statuses to our keys
const statusMap = {
  open: "open",
  "on hold": "hold",
  hold: "hold",
  closed: "closed",
  "in progress": "inProgress",
  unassigned: "unassigned",
  "": "unassigned",
};

// Fetch all agents for a given department with pagination
async function getAllAgentsForDepartment(departmentId, accessToken) {
  const limit = 200;
  let from = 1;
  let allAgents = [];
  while (true) {
    const response = await limiter.schedule(() =>
      axios.get(`https://desk.zoho.com/api/v1/departments/${departmentId}/agents`, {
        headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
        params: { from, limit },
      })
    );
    const agentsBatch = response.data.data || [];
    allAgents = allAgents.concat(agentsBatch);
    if (agentsBatch.length < limit) break;
    from += limit;
  }
  return allAgents;
}

// API endpoint: Get assignees with their ticket counts and aging divided by department and status
app.get("/api/zoho-assignees-with-ticket-counts", async (req, res) => {
  try {
    // Parse departmentIds query parameter
    let departmentIds = [];
    if (req.query.departmentIds) {
      try {
        departmentIds = JSON.parse(req.query.departmentIds);
      } catch {
        departmentIds = [req.query.departmentIds];
      }
    }
    const agentId = req.query.agentId || null;

    // Get access token
    const accessToken = await getAccessToken();

    // Fetch all users and tickets with filters
    let users = await fetchAllUsers(accessToken);
    const tickets = await fetchAllTickets(accessToken, departmentIds, agentId);
    const departmentsResp = { data: { data: departmentList } };
    const allDepartments = departmentsResp.data.data || [];

    // Map department ID to agent names currently assigned
    const deptAgentNameMap = {};
    for (const dep of allDepartments) {
      let agentNames = [];
      try {
        const agents = await getAllAgentsForDepartment(dep.id, accessToken);
        agentNames = agents.map((a) => a.displayName || a.fullName || a.name || a.email || "Unknown");
      } catch (err) {
        agentNames = [];
      }
      deptAgentNameMap[dep.id] = agentNames;
    }

    // Handle missing users not returned in initial user fetch but found in tickets
    const allAssigneeIds = new Set(tickets.map((t) => t.assigneeId).filter(Boolean));
    const knownUserIds = new Set(users.map((u) => u.id));
    const missingUserIds = Array.from(allAssigneeIds).filter((id) => !knownUserIds.has(id));
    if (missingUserIds.length > 0) {
      const missingUsers = await fetchUsersByIds(accessToken, missingUserIds);
      users = users.concat(missingUsers);
    }

    // Initialize tracking objects for ticket counts and latest unassigned ticket IDs by user
    const ticketStatusCountMap = {},
      latestUnassignedTicketIdMap = {};
    users.forEach((user) => {
      ticketStatusCountMap[user.id] = {
        open: 0,
        closed: 0,
        hold: 0,
        escalated: 0,
        unassigned: 0,
        inProgress: 0,
      };
      latestUnassignedTicketIdMap[user.id] = null;
    });
    ticketStatusCountMap["unassigned"] = {
      open: 0,
      closed: 0,
      hold: 0,
      escalated: 0,
      unassigned: 0,
      inProgress: 0,
    };
    latestUnassignedTicketIdMap["unassigned"] = null;

    const now = Date.now();
    const userDeptAgingCounts = {};

    const allUnassignedTicketNumbers = [];

    // Loop over all tickets and categorize by user, department, status, and age bucket
    tickets.forEach((ticket) => {
      const assigneeRaw = ticket.assigneeId === undefined || ticket.assigneeId === null ? "" : ticket.assigneeId.toString().toLowerCase();
      const isUnassignedAssignee = assigneeRaw === "" || assigneeRaw === "none" || assigneeRaw === "null";
      const assigneeId = isUnassignedAssignee ? "unassigned" : ticket.assigneeId;
      if (!ticketStatusCountMap[assigneeId]) {
        ticketStatusCountMap[assigneeId] = {
          open: 0,
          closed: 0,
          hold: 0,
          escalated: 0,
          unassigned: 0,
          inProgress: 0,
        };
        latestUnassignedTicketIdMap[assigneeId] = null;
      }
      if (!userDeptAgingCounts[assigneeId]) userDeptAgingCounts[assigneeId] = {};
      const deptId = ticket.departmentId || "no_department";
      if (!userDeptAgingCounts[assigneeId][deptId]) {
        userDeptAgingCounts[assigneeId][deptId] = {
          openBetweenOneAndFifteenDaysCount: 0,
          openBetweenOneAndFifteenDaysTickets: [],
          openBetweenSixteenAndThirtyDaysCount: 0,
          openBetweenSixteenAndThirtyDaysTickets: [],
          openOlderThanThirtyDaysCount: 0,
          openOlderThanThirtyDaysTickets: [],
          holdBetweenOneAndFifteenDaysCount: 0,
          holdBetweenOneAndFifteenDaysTickets: [],
          holdBetweenSixteenAndThirtyDaysCount: 0,
          holdBetweenSixteenAndThirtyDaysTickets: [],
          holdOlderThanThirtyDaysCount: 0,
          holdOlderThanThirtyDaysTickets: [],
          inProgressBetweenOneAndFifteenDaysCount: 0,
          inProgressBetweenOneAndFifteenDaysTickets: [],
          inProgressBetweenSixteenAndThirtyDaysCount: 0,
          inProgressBetweenSixteenAndThirtyDaysTickets: [],
          inProgressOlderThanThirtyDaysCount: 0,
          inProgressOlderThanThirtyDaysTickets: [],
          escalatedBetweenOneAndFifteenDaysCount: 0,
          escalatedBetweenOneAndFifteenDaysTickets: [],
          escalatedBetweenSixteenAndThirtyDaysCount: 0,
          escalatedBetweenSixteenAndThirtyDaysTickets: [],
          escalatedOlderThanThirtyDaysCount: 0,
          escalatedOlderThanThirtyDaysTickets: [],
        };
      }
      const rawStatus = (ticket.status || "").toLowerCase();
      const normalizedStatus = statusMap[rawStatus] || "unassigned";
      const isEscalated = ticket.isEscalated === true || String(ticket.escalated).toLowerCase() === "true";
      const ageDays = ticket.createdTime ? (now - new Date(ticket.createdTime)) / (1000 * 60 * 60 * 24) : null;

      // Bucket tickets by status and age ranges, populate counts and arrays
      if (ageDays !== null) {
        const agingCounts = userDeptAgingCounts[assigneeId][deptId];
        const ticketNumber = ticket.ticketNumber || ticket.id;
        if (normalizedStatus === "open") {
          if (ageDays >= 0 && ageDays < 16) {
            agingCounts.openBetweenOneAndFifteenDaysCount++;
            agingCounts.openBetweenOneAndFifteenDaysTickets.push(ticketNumber);
          } else if (ageDays >= 16 && ageDays < 31) {
            agingCounts.openBetweenSixteenAndThirtyDaysCount++;
            agingCounts.openBetweenSixteenAndThirtyDaysTickets.push(ticketNumber);
          } else if (ageDays > 30) {
            agingCounts.openOlderThanThirtyDaysCount++;
            agingCounts.openOlderThanThirtyDaysTickets.push(ticketNumber);
          }
        } else if (normalizedStatus === "hold") {
          if (ageDays >= 0 && ageDays < 16) {
            agingCounts.holdBetweenOneAndFifteenDaysCount++;
            agingCounts.holdBetweenOneAndFifteenDaysTickets.push(ticketNumber);
          } else if (ageDays >= 16 && ageDays < 31) {
            agingCounts.holdBetweenSixteenAndThirtyDaysCount++;
            agingCounts.holdBetweenSixteenAndThirtyDaysTickets.push(ticketNumber);
          } else if (ageDays > 30) {
            agingCounts.holdOlderThanThirtyDaysCount++;
            agingCounts.holdOlderThanThirtyDaysTickets.push(ticketNumber);
          }
        } else if (normalizedStatus === "inProgress") {
          if (ageDays >= 0 && ageDays < 16) {
            agingCounts.inProgressBetweenOneAndFifteenDaysCount++;
            agingCounts.inProgressBetweenOneAndFifteenDaysTickets.push(ticketNumber);
          } else if (ageDays >= 16 && ageDays < 31) {
            agingCounts.inProgressBetweenSixteenAndThirtyDaysCount++;
            agingCounts.inProgressBetweenSixteenAndThirtyDaysTickets.push(ticketNumber);
          } else if (ageDays > 30) {
            agingCounts.inProgressOlderThanThirtyDaysCount++;
            agingCounts.inProgressOlderThanThirtyDaysTickets.push(ticketNumber);
          }
        } else if (normalizedStatus === "escalated") {
          if (ageDays >= 0 && ageDays < 16) {
            agingCounts.escalatedBetweenOneAndFifteenDaysCount++;
            agingCounts.escalatedBetweenOneAndFifteenDaysTickets.push(ticketNumber);
          } else if (ageDays >= 16 && ageDays < 31) {
            agingCounts.escalatedBetweenSixteenAndThirtyDaysCount++;
            agingCounts.escalatedBetweenSixteenAndThirtyDaysTickets.push(ticketNumber);
          } else if (ageDays > 30) {
            agingCounts.escalatedOlderThanThirtyDaysCount++;
            agingCounts.escalatedOlderThanThirtyDaysTickets.push(ticketNumber);
          }
        }
      }

      // Track global unassigned ticket numbers and latest ticketId
      if (isUnassignedAssignee && normalizedStatus !== "closed") {
        const ticketNumber = ticket.ticketNumber || ticket.id;
        if (ticketNumber) allUnassignedTicketNumbers.push(ticketNumber);
        const currentLatest = latestUnassignedTicketIdMap[assigneeId];
        if (
          currentLatest === null ||
          (typeof currentLatest === "number" && ticketNumber > currentLatest) ||
          (typeof currentLatest === "string" && ticketNumber.localeCompare(currentLatest) > 0)
        )
          latestUnassignedTicketIdMap[assigneeId] = ticketNumber;
      }

      // Update ticketStatusCountMap based on assigned or escalated statuses (skip closed for unassigned)
      if (isUnassignedAssignee && normalizedStatus === "closed") return;
      if (isUnassignedAssignee) ticketStatusCountMap["unassigned"].unassigned++;
      else if (normalizedStatus === "unassigned" || isEscalated) ticketStatusCountMap[assigneeId].escalated++;
      else if (normalizedStatus === "open") ticketStatusCountMap[assigneeId].open++;
      else if (normalizedStatus === "hold") ticketStatusCountMap[assigneeId].hold++;
      else if (normalizedStatus === "closed") ticketStatusCountMap[assigneeId].closed++;
      else if (normalizedStatus === "inProgress") ticketStatusCountMap[assigneeId].inProgress++;
    });

    // Add unassigned user entry to user list
    users.push({
      id: "unassigned",
      fullName: "Unassigned",
      displayName: "Unassigned",
    });

    const now2 = Date.now();

    // Process all users into a final members list including all ticket counts and aging counts
    const members = users
      .filter((user) => user.id in ticketStatusCountMap)
      .map((user) => {
        const candidateName = user.displayName || user.fullName || user.name || user.email || "Unknown";
        let departmentIds = [];
        for (const dep of allDepartments) {
          if (
            (user.departmentIds && user.departmentIds.includes(dep.id)) ||
            (deptAgentNameMap[dep.id] && deptAgentNameMap[dep.id].includes(candidateName))
          ) {
            departmentIds.push(dep.id);
          }
        }

        // Filter tickets assigned to user for status and age bucket calculation
        const agentTickets = tickets.filter(
          (t) => String(t.assigneeId) === String(user.id) && t.status && t.status.toLowerCase() !== "closed"
        );
        const statusKeys = ["open", "hold", "inProgress", "escalated"];
        let perStatusAge = {};
        // Count tickets per status per age bucket
        statusKeys.forEach((status) => {
          perStatusAge[`${status}BetweenOneAndFifteenDays`] = agentTickets.filter((t) => {
            const rawStatus = (t.status || "").toLowerCase();
            const normalized = statusMap[rawStatus] || rawStatus;
            const ageDays = t.createdTime ? (now2 - new Date(t.createdTime)) / (1000 * 60 * 60 * 24) : null;
            return normalized === status && ageDays !== null && ageDays < 16 && ageDays >= 0;
          }).length;
          perStatusAge[`${status}BetweenSixteenAndThirtyDays`] = agentTickets.filter((t) => {
            const rawStatus = (t.status || "").toLowerCase();
            const normalized = statusMap[rawStatus] || rawStatus;
            const ageDays = t.createdTime ? (now2 - new Date(t.createdTime)) / (1000 * 60 * 60 * 24) : null;
            return normalized === status && ageDays !== null && ageDays >= 16 && ageDays < 31;
          }).length;
          perStatusAge[`${status}OlderThanThirtyDays`] = agentTickets.filter((t) => {
            const rawStatus = (t.status || "").toLowerCase();
            const normalized = statusMap[rawStatus] || rawStatus;
            const ageDays = t.createdTime ? (now2 - new Date(t.createdTime)) / (1000 * 60 * 60 * 24) : null;
            return normalized === status && ageDays !== null && ageDays > 30;
          }).length;
        });

        // Calculate total ticket count per department for this user
        const departmentTicketCounts = {};
        departmentIds.forEach((depId) => {
          departmentTicketCounts[depId] = tickets.filter(
            (t) =>
              String(t.assigneeId) === String(user.id) &&
              t.departmentId === depId &&
              t.status &&
              t.status.toLowerCase() !== "closed"
          ).length;
        });

        // Return user data with ticket counts & aging summary
        return {
          id: user.id,
          name: candidateName,
          departmentIds,
          tickets: { ...ticketStatusCountMap[user.id], ...perStatusAge },
          latestUnassignedTicketId: latestUnassignedTicketIdMap[user.id] || null,
          departmentTicketCounts,
          departmentAgingCounts: userDeptAgingCounts[user.id] || {},
        };
      });

    // Send JSON response including all members and departments metadata
    res.json({
      members,
      unassignedTicketNumbers: allUnassignedTicketNumbers,
      departments: allDepartments.map((dep) => ({
        id: dep.id,
        name: dep.name,
        description: dep.description,
        agents: deptAgentNameMap[dep.id],
      })),
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch assignee ticket counts" });
  }
});

// Endpoint to fetch all departments and users mapped to each department
app.get("/api/zoho-departments", async (req, res) => {
  try {
    const accessToken = await getAccessToken();
    const allUsers = await fetchAllUsers(accessToken);
    const deptUserMap = {};
    departmentList.forEach((dep) => {
      deptUserMap[dep.id] = [];
    });
    allUsers.forEach((user) => {
      if (user.departmentIds && Array.isArray(user.departmentIds)) {
        user.departmentIds.forEach((depId) => {
          if (deptUserMap[depId]) {
            const displayName = user.displayName || user.fullName || user.name || user.email || "Unknown";
            deptUserMap[depId].push(displayName);
          }
        });
      }
    });
    const departmentsWithUsers = departmentList.map((dep) => ({
      ...dep,
      agents: deptUserMap[dep.id] || [],
    }));
    res.json({ departments: departmentsWithUsers });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch departments with users" });
  }
});

// Endpoint to get ticket counts per status for each department (summary)
app.get("/api/zoho-department-ticket-counts", async (req, res) => {
  try {
    const accessToken = await getAccessToken();
    const tickets = await fetchAllTickets(accessToken);
    const ticketStatusCountMap = {};
    departmentList.forEach((dep) => {
      ticketStatusCountMap[dep.id] = {
        open: 0,
        closed: 0,
        hold: 0,
        escalated: 0,
        unassigned: 0,
        inProgress: 0,
      };
    });
    tickets.forEach((ticket) => {
      const deptId = ticket.departmentId;
      if (deptId && ticketStatusCountMap[deptId]) {
        const rawStatus = (ticket.status || "").toLowerCase();
        const normalizedStatus = statusMap[rawStatus] || "unassigned";
        const isEscalated = ticket.isEscalated === true || String(ticket.escalated).toLowerCase() === "true";
        if ((!ticket.assigneeId || ["null", "none", null].includes(ticket.assigneeId)) && normalizedStatus !== "closed") {
          ticketStatusCountMap[deptId].unassigned++;
        } else if (normalizedStatus === "unassigned" || isEscalated) {
          ticketStatusCountMap[deptId].escalated++;
        } else if (normalizedStatus === "open") {
          ticketStatusCountMap[deptId].open++;
        } else if (normalizedStatus === "hold") {
          ticketStatusCountMap[deptId].hold++;
        } else if (normalizedStatus === "closed") {
          ticketStatusCountMap[deptId].closed++;
        } else if (normalizedStatus === "inProgress") {
          ticketStatusCountMap[depId].inProgress++;
        }
      }
    });
    const departmentTicketCounts = departmentList.map((dep) => ({
      id: dep.id,
      name: dep.name,
      tickets: ticketStatusCountMap[dep.id] || {
        open: 0,
        closed: 0,
        hold: 0,
        escalated: 0,
        unassigned: 0,
        inProgress: 0,
      },
    }));
    res.json({ departmentTicketCounts });
  } catch (error) {
    res.status(500).json({ error: "Failed to get department ticket counts" });
  }
});

// Endpoint to get members (agents) for a department
app.get("/api/department-members/:departmentId", async (req, res) => {
  try {
    const { departmentId } = req.params;
    const accessToken = await getAccessToken();
    const agents = await getAllAgentsForDepartment(departmentId, accessToken);
    res.json({ members: agents });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch department members" });
  }
});

// Basic root endpoint; confirm server running
app.get("/", (req, res) => {
  res.send("Backend server running. Use API endpoints under /api.");
});

// Start the express server
app.listen(port, () => {
  console.log(`Backend server running on port ${port}`);
});
