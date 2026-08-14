const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// ================= STATIC FILES =================
// Serve all files in frontend folder (for CSS, images, JS files, etc.)
app.use(express.static(path.join(__dirname, "CITE-Flow-Management-System")));

// Serve admin and faculty folders directly under /admin and /faculty
app.use("/admin", express.static(path.join(__dirname, "CITE-Flow-Management-System", "admin")));
app.use("/faculty", express.static(path.join(__dirname, "CITE-Flow-Management-System", "faculty")));

// ================= CUSTOM ROUTES =================

// Home → Login
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "CITE-Flow-Management-System", "login.html"));
});

// Faculty Login
app.get("/faculty-login", (req, res) => {
  res.sendFile(path.join(__dirname, "CITE-Flow-Management-System", "faculty-login.html"));
});

// Admin Dashboard (clean URL)
app.get("/dashboard", (req, res) => {
  res.sendFile(path.join(__dirname, "CITE-Flow-Management-System", "admin", "dashboard.html"));
});

// Redirect /admin → admin dashboard
app.get("/admin", (req, res) => {
  res.redirect("/dashboard");
});

// Redirect /faculty → faculty dashboard
app.get("/faculty", (req, res) => {
  res.redirect("/faculty/dashboard");
});

// ================= CLEAN ADMIN ROUTES =================
const adminPages = [
  "faculty-profiles",
  "workload-tracker",
  "engagement-logs",
  "document-vault",
  "workflow-approval",
  "calendar",
  "reports-analytics",
  "feedback-summary",
  "system-settings",
  "user-management",
  "admin-profile"        
];

adminPages.forEach(page => {
  app.get(`/${page}`, (req, res) => {
    const filePath = path.join(
      __dirname,
      "CITE-Flow-Management-System",
      "admin",
      `${page}.html`
    );
    
    res.sendFile(filePath, (err) => {
      if (err) {
        console.error(`Error serving admin page ${page}.html:`, err.message);
        res.status(404).send(`404 - ${page}.html not found`);
      }
    });
  });
});

// ================= CLEAN FACULTY ROUTES =================
const facultyPages = [
  "dashboard",
  "faculty-profile",
  "calendar",
  "document",
  "status-tracking",
  "submissions",
  "system-settings"
];

facultyPages.forEach(page => {
  app.get(`/faculty/${page}`, (req, res) => {
    const filePath = path.join(
      __dirname,
      "CITE-Flow-Management-System",
      "faculty",
      `${page}.html`
    );
    
    res.sendFile(filePath, (err) => {
      if (err) {
        console.error(`Error serving faculty page ${page}.html:`, err.message);
        res.status(404).send(`404 - ${page}.html not found`);
      }
    });
  });
});

// ================= 404 HANDLER =================
app.use((req, res) => {
  res.status(404).send(`
    <h1>404 - Page Not Found</h1>
    <p>The page you are looking for does not exist.</p>
    <a href="/dashboard" style="color: #621708;">← Go back to Admin Dashboard</a>
  `);
});

// ================= START SERVER =================
app.listen(PORT, () => {
  console.log(`✅ Server is running at http://localhost:${PORT}`);
  console.log(`   Admin Dashboard → http://localhost:${PORT}/dashboard`);
  console.log(`   Faculty Dashboard → http://localhost:${PORT}/faculty/dashboard`);
});