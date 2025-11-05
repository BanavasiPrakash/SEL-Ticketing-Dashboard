
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const Bottleneck = require("bottleneck");
const axiosRetry = require("axios-retry").default;
const http = require("http");
const WebSocket = require("ws");
const rateLimit = require("express-rate-limit");

const app = express();
const port = process.env.PORT || 5000;
const WEBHOOK_SECRET = process.env.ZOHO_WEBHOOK_SECRET || "your-secret-token";

app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; connect-src 'self' http://localhost:5000 http://127.0.0.1:5000 http://192.168.3.8:5000"
  );
  next();
});

const clientId = "1000.VEPAX9T8TKDWJZZD95XT6NN52PRPQY";
const clientSecret = "acca291b89430180ced19660cd28ad8ce1e4bec6e8";
const refreshToken = "1000.465100d543b8d9471507bdf0b0263414.608f3f3817d11b09f142fd29810cca6f";

let cachedAccessToken = null;
let accessTokenExpiry = null;
const limiter = new Bottleneck({ minTime: 1100 });

axiosRetry(axios, {
  retries: 4,
  retryDelay: axiosRetry.exponentialDelay,
  retryCondition: (error) =>
    error.response && (error.response.status === 429 || error.response.status >= 500),
});

const departmentList = [
  { id: "634846000000006907", name: "IT Support" },
  { id: "634846000000334045", name: "Wescon" },
  { id: "634846000006115409", name: "ERP or SAP Support" },
  { id: "634846000009938029", name: "EDI Support" },
  { id: "634846000018669037", name: "Test Help Desk" },
  { id: "634846000054176855", name: "Digitization" },
  { id: "634846000054190373", name: "PLM or IoT & CAD Support" },
];

const removeAccents = (str) => {
  if (!str) return "";
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.,]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
};

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
  accessTokenExpiry = now + (response.data.expires_in - 60) * 1000;
  return cachedAccessToken;
}

async function fetchAllTickets(accessToken, departmentIds = [], agentId = null) {
  let from = 1, limit = 100, allTickets = [];
  const deptIdsToFetch = departmentIds.length > 0 ? departmentIds : [null];
  for (const deptId of deptIdsToFetch) {
    let continueFetching = true, pageFrom = 1;
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

async function fetchAllUsers(accessToken) {
  let from = 1, limit = 100, allUsers = [];
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
    } catch (err) { }
  }
  return users;
}

const statusMap = {
  open: "open",
  "on hold": "hold",
  hold: "hold",
  closed: "closed",
  "in progress": "inProgress",
  unassigned: "unassigned",
  "": "unassigned",
};

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

app.get("/api/zoho-assignees-with-ticket-counts", async (req, res) => {
  try {
    let departmentIds = [];
    if (req.query.departmentIds) {
      try {
        departmentIds = JSON.parse(req.query.departmentIds);
      } catch {
        departmentIds = [req.query.departmentIds];
      }
    }
    const agentId = req.query.agentId || null;
    const accessToken = await getAccessToken();
    let users = await fetchAllUsers(accessToken);
    const tickets = await fetchAllTickets(accessToken, departmentIds, agentId);
    const departmentsResp = { data: { data: departmentList } };
    const allDepartments = departmentsResp.data.data || [];

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

    const allAssigneeIds = new Set(tickets.map((t) => t.assigneeId).filter(Boolean));
    const knownUserIds = new Set(users.map((u) => u.id));
    const missingUserIds = Array.from(allAssigneeIds).filter((id) => !knownUserIds.has(id));
    if (missingUserIds.length > 0) {
      const missingUsers = await fetchUsersByIds(accessToken, missingUserIds);
      users = users.concat(missingUsers);
    }

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

    const allUnassignedTicketNumbers = [];
    tickets.forEach((ticket) => {
      const assigneeRaw =
        ticket.assigneeId === undefined || ticket.assigneeId === null
          ? ""
          : ticket.assigneeId.toString().toLowerCase();
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
      const rawStatus = (ticket.status || "").toLowerCase();
      const normalizedStatus = statusMap[rawStatus] || "unassigned";
      const isEscalated = ticket.isEscalated === true || String(ticket.escalated).toLowerCase() === "true";
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
      if (isUnassignedAssignee && normalizedStatus === "closed") return;
      if (isUnassignedAssignee) ticketStatusCountMap["unassigned"].unassigned++;
      else if (normalizedStatus === "unassigned" || isEscalated) ticketStatusCountMap[assigneeId].escalated++;
      else if (normalizedStatus === "open") ticketStatusCountMap[assigneeId].open++;
      else if (normalizedStatus === "hold") ticketStatusCountMap[assigneeId].hold++;
      else if (normalizedStatus === "closed") ticketStatusCountMap[assigneeId].closed++;
      else if (normalizedStatus === "inProgress") ticketStatusCountMap[assigneeId].inProgress++;
    });

    users.push({
      id: "unassigned",
      fullName: "Unassigned",
      displayName: "Unassigned",
    });

   const now = Date.now();
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

    const agentTickets = tickets.filter(
      (t) =>
        String(t.assigneeId) === String(user.id) &&
        t.status &&
        t.status.toLowerCase() !== "closed"
    );

    const totalTicketCount = agentTickets.length;
    const ticketsOlderThanWeek = agentTickets.filter((t) => {
      if (!t.createdTime) return false;
      const ageDays = (now - new Date(t.createdTime)) / (1000 * 60 * 60 * 24);
      return ageDays > 7;
    }).length;
    const ticketsOlderThanMonth = agentTickets.filter((t) => {
      if (!t.createdTime) return false;
      const ageDays = (now - new Date(t.createdTime)) / (1000 * 60 * 60 * 24);
      return ageDays > 30;
    }).length;
    const ticketsBetweenTwoWeeksAndMonth = agentTickets.filter((t) => {
      if (!t.createdTime) return false;
      const ageDays = (now - new Date(t.createdTime)) / (1000 * 60 * 60 * 24);
      return ageDays >= 14 && ageDays < 30;
    }).length;

    // ---- BEGIN PER-STATUS PER-AGE FIELDS ----
    const statusKeys = ["open", "hold", "inProgress", "escalated"];
    let perStatusAge = {};
    statusKeys.forEach(status => {
      // 1-13 days
      perStatusAge[`${status}BetweenOneAndThirteenDays`] = agentTickets.filter(t => {
        const rawStatus = (t.status || "").toLowerCase();
        const normalized = statusMap[rawStatus] || rawStatus;
        const ageDays = t.createdTime ? (now - new Date(t.createdTime)) / (1000 * 60 * 60 * 24) : null;
        return normalized === status && ageDays !== null && ageDays < 14 && ageDays >= 0;
      }).length;

      // 14-30 days
      perStatusAge[`${status}BetweenTwoWeeksAndMonth`] = agentTickets.filter(t => {
        const rawStatus = (t.status || "").toLowerCase();
        const normalized = statusMap[rawStatus] || rawStatus;
        const ageDays = t.createdTime ? (now - new Date(t.createdTime)) / (1000 * 60 * 60 * 24) : null;
        return normalized === status && ageDays !== null && ageDays >= 14 && ageDays < 30;
      }).length;
      // 30+ days
      perStatusAge[`${status}OlderThanMonth`] = agentTickets.filter(t => {
        const rawStatus = (t.status || "").toLowerCase();
        const normalized = statusMap[rawStatus] || rawStatus;
        const ageDays = t.createdTime ? (now - new Date(t.createdTime)) / (1000 * 60 * 60 * 24) : null;
        return normalized === status && ageDays !== null && ageDays > 30;
      }).length;
    });
    // ---- END PER-STATUS PER-AGE FIELDS ----

  return {
  id: user.id,
  name: candidateName,
  departmentIds,
  tickets: {         // Put all counts, base and age-stats, in tickets
    ...ticketStatusCountMap[user.id],
    ...perStatusAge
  },
  latestUnassignedTicketId: latestUnassignedTicketIdMap[user.id] || null,
  ticketsOlderThanWeek,
  ticketsOlderThanMonth,
  ticketsBetweenTwoWeeksAndMonth,
  totalTicketCount,
};

  });


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
          ticketStatusCountMap[deptId].inProgress++;
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

app.get("/", (req, res) => {
  res.send("Backend server running. Use API endpoints under /api.");
});

const webhookLimiter = rateLimit({ windowMs: 1000, max: 10, message: "Too many webhook requests, please try again later." });
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

function noop() { }
function heartbeat() { this.isAlive = true; }
wss.on("connection", (ws) => {
  ws.isAlive = true;
  ws.on("pong", heartbeat);
  ws.on("error", (_) => { });
  ws.on("close", (_, __) => { });
});
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping(noop);
  });
}, 30000);

app.post("/webhook/zoho", webhookLimiter, (req, res) => {
  try {
    const token = req.headers["x-zoho-webhook-token"];
    if (token !== WEBHOOK_SECRET) return res.status(401).send("Unauthorized");
    const eventData = req.body;
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(eventData));
    });
    res.status(200).send("Received");
  } catch (err) {
    res.status(500).send("Internal Server Error");
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Backend server running on port ${port}`);
});
