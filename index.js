const express = require("express");
const path = require("path");

const app = express();
const PORT = 3000;

// ====================== STATIC FILE SERVING ======================
// Serve everything inside the frontend folder at the root level
app.use(express.static(path.join(__dirname, "components", "frontend")));

// Optional: Also serve the admin folder directly (helps with cleaner URLs)
app.use("/admin", express.static(path.join(__dirname, "components", "frontend", "admin")));

// ====================== CUSTOM ROUTES ======================

// Default route → Login page
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "components", "frontend", "login.html"));
});

// Admin Dashboard (clean URL: http://localhost:3000/dashboard)
app.get("/dashboard", (req, res) => {
  res.sendFile(
    path.join(__dirname, "components", "frontend", "admin", "dashboard.html")
  );
});

// Redirect /admin → dashboard
app.get("/admin", (req, res) => {
  res.redirect("/dashboard");
});

// ====================== ADMIN PAGE ROUTES (Clean URLs) ======================
// These allow you to use nice URLs like /faculty-profiles instead of /admin/faculty-profiles.html

app.get("/faculty-profiles", (req, res) => {
  res.sendFile(
    path.join(__dirname, "components", "frontend", "admin", "faculty-profiles.html")
  );
});

app.get("/workload-tracker", (req, res) => {
  res.sendFile(
    path.join(__dirname, "components", "frontend", "admin", "workload-tracker.html")
  );
});

app.get("/engagement-logs", (req, res) => {
  res.sendFile(
    path.join(__dirname, "components", "frontend", "admin", "engagement-logs.html")
  );
});

app.get("/document-vault", (req, res) => {
  res.sendFile(
    path.join(__dirname, "components", "frontend", "admin", "document-vault.html")
  );
});

app.get("/workflow-approval", (req, res) => {
  res.sendFile(
    path.join(__dirname, "components", "frontend", "admin", "workflow-approval.html")
  );
});

app.get("/calendar", (req, res) => {
  res.sendFile(
    path.join(__dirname, "components", "frontend", "admin", "calendar.html")
  );
});

app.get("/reports-analytics", (req, res) => {
  res.sendFile(
    path.join(__dirname, "components", "frontend", "admin", "reports-analytics.html")
  );
});

app.get("/system-settings", (req, res) => {
  res.sendFile(
    path.join(__dirname, "components", "frontend", "admin", "system-settings.html")
  );
});

app.get("/user-management", (req, res) => {
  res.sendFile(
    path.join(__dirname, "components", "frontend", "admin", "user-management.html")
  );
});

// ====================== 404 HANDLER ======================
app.use((req, res) => {
  res.status(404).send(`
    <h1>404 - Page Not Found</h1>
    <p>The page you're looking for doesn't exist.</p>
    <a href="/dashboard">Go back to Dashboard</a>
  `);
});

// ====================== START SERVER ======================
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
  console.log(`   Dashboard → http://localhost:${PORT}/dashboard`);
});