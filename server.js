import express from "express";
import cors from "cors";
import https from "https";
import http from "http";
import { Pool } from "pg";
import nodemailer from "nodemailer";

const app = express();

app.use(
  cors({
    origin: function (origin, callback) {
      const allowedOrigins = [
        "https://navaneethan2110.github.io",
        "http://localhost:5173",
      ];

      // allow requests with no origin (like curl, Postman)
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      } else {
        return callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  })
);

app.options("*", cors());

app.use(express.json());

const PORT = process.env.PORT || 5000;
const CHECK_INTERVAL = 60000; // 60 seconds

// ================= IN-MEMORY STORE =================

let websites = [
  { id: 1, url: "https://www.google.com" },
  { id: 2, url: "https://nodejs.org" },
  { id: 3, url: "https://www.github.com" },
];

let checks = []; // stores history
let lastStatus = {}; // for alert comparison
let nextId = 4;

// ================= CHECK FUNCTION =================

function checkWebsite(url) {
  return new Promise((resolve) => {
    const start = Date.now();
    const lib = url.startsWith("https") ? https : http;

    const req = lib.get(url, (res) => {
      const time = Date.now() - start;
      resolve({
        is_up: res.statusCode >= 200 && res.statusCode < 400,
        status_code: res.statusCode,
        response_time: time,
      });
    });

    req.on("error", () => {
      resolve({
        is_up: false,
        status_code: null,
        response_time: null,
      });
    });

    req.setTimeout(10000, () => {
      req.destroy();
      resolve({
        is_up: false,
        status_code: null,
        response_time: null,
      });
    });
  });
}

// ================= EMAIL ALERT (Optional) =================

async function sendAlert(url, isUp) {
  if (!process.env.ALERT_EMAIL) return;

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.ALERT_EMAIL,
      pass: process.env.ALERT_PASSWORD,
    },
  });

  await transporter.sendMail({
    from: process.env.ALERT_EMAIL,
    to: process.env.ALERT_EMAIL,
    subject: `🚨 ${url} is ${isUp ? "Recovered" : "Down"}`,
    text: `${url} is now ${isUp ? "UP" : "DOWN"}`,
  });
}

// ================= SCHEDULER =================

async function runHealthCheck() {
  for (const site of websites) {
    const result = await checkWebsite(site.url);

    const record = {
      website_id: site.id,
      ...result,
      checked_at: new Date(),
    };

    checks.push(record);

    // keep only last 24h history
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    checks = checks.filter(
      (c) => new Date(c.checked_at).getTime() > cutoff
    );

    // alert logic
    if (
      lastStatus[site.id] !== undefined &&
      lastStatus[site.id] !== result.is_up
    ) {
      await sendAlert(site.url, result.is_up);
    }

    lastStatus[site.id] = result.is_up;
  }
}

setInterval(runHealthCheck, CHECK_INTERVAL);

// ================= ROUTES =================

// Add website
app.post("/api/websites", (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ message: "URL required" });

  websites.push({ id: nextId++, url });
  res.json({ message: "Website added" });
});

// Latest status
app.get("/api/status/latest", (req, res) => {
  const result = websites.map((site) => {
    const siteChecks = checks
      .filter((c) => c.website_id === site.id)
      .sort((a, b) => new Date(b.checked_at) - new Date(a.checked_at));

    const latest = siteChecks[0] || null;

    return {
      id: site.id,
      url: site.url,
      ...latest,
    };
  });

  res.json(result);
});

// 24h history
app.get("/api/status/history/:id", (req, res) => {
  const id = parseInt(req.params.id);

  const history = checks
    .filter((c) => c.website_id === id)
    .sort((a, b) => new Date(a.checked_at) - new Date(b.checked_at));

  res.json(history);
});

// Manual trigger
app.post("/api/run", async (req, res) => {
  await runHealthCheck();
  res.json({ message: "Health check executed" });
});

app.get("/", (req, res) => {
  res.send("Website Status Backend is running 🚀");
});

// Start
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});