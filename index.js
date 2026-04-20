const express = require("express");
const path = require("path");

const app = express();
const PORT = 3000;

// ================= STATIC FILES =================
// Serve all files in frontend folder (for CSS, images, JS files, etc.)
app.use(express.static(path.join(__dirname, "CITE-Flow-Management-System")));

// Optional: Also serve admin folder directly under /admin (useful for future)
app.use("/admin", express.static(path.join(__dirname, "CITE-Flow-Management-System", "admin")));

// ================= CUSTOM ROUTES =================

// Home → Login
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "CITE-Flow-Management-System", "login.html"));
});

// Dashboard (clean URL)
app.get("/dashboard", (req, res) => {
  res.sendFile(path.join(__dirname, "CITE-Flow-Management-System", "admin", "dashboard.html"));
});

// Redirect /admin → dashboard
app.get("/admin", (req, res) => {
  res.redirect("/dashboard");
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
    
    console.log("Serving:", filePath);
    
    res.sendFile(filePath, (err) => {
      if (err) {
        console.error(`Error serving ${page}.html:`, err.message);
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
    <a href="/dashboard" style="color: #621708;">← Go back to Dashboard</a>
  `);
});

// ================= START SERVER =================
app.listen(PORT, () => {
  console.log(`✅ Server is running at http://localhost:${PORT}`);
  console.log(`   Dashboard → http://localhost:${PORT}/dashboard`);
});