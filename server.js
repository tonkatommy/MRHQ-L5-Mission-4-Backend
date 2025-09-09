// Import necessary ES6 modules
import express from "express";
import cors from "cors";
import dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();

// Initialize Express app
const app = express();
// Define the port from environment variable or default to 3000
const PORT = process.env.PORT || 3000;

// Middleware setup
app.use(cors());
app.use(express.json());

// Basic route for testing
app.get("/", (req, res) => {
  res.send("Hello from the AI Chatbot 🤖 Backend!");
});

// Start the server
app.listen(PORT, () => {
  console.log(`✅ Server is running at: http://localhost:${PORT}`);
});
