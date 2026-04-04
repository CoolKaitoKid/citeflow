const express = require("express");
const path = require("path");

const app = express();
const PORT = 3000;

// Serve static files from components/frontend
app.use(express.static(path.join(__dirname, "components", "frontend")));

// Default route
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "components", "frontend", "login.html"));
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT} 🚀`);
});