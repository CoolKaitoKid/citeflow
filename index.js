const express = require("express");
const path = require("path");

const app = express();
const PORT = 3000;

// Serve ALL frontend files (including admin folder)
app.use(express.static(path.join(__dirname, "components", "frontend")));

// 🔧 Fix Chrome DevTools CSP warning (optional but clean)
app.get('/.well-known/appspecific/com.chrome.devtools.json', (req, res) => {
  res.status(204).end();
});

// Default route → login page
app.get("/", (req, res) => {
  res.sendFile(
    path.join(__dirname, "components", "frontend", "login.html")
  );
});

// Clean dashboard route (no .html in URL)
app.get("/dashboard", (req, res) => {
  res.sendFile(
    path.join(__dirname, "components", "frontend","admin", "dashboard.html")
  );
});

// 🔥 Optional: redirect /admin → dashboard
app.get("/admin", (req, res) => {
  res.redirect("/dashboard");
});

// 🔥 Optional: handle unknown routes (basic 404)
app.use((req, res) => {
  res.status(404).send("404 Not Found");
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT} 🚀`);
});