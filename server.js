// Import necessary ES6 modules
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
// Import Google GenAI API
import { GoogleGenAI } from "@google/genai";

// Load environment variables from .env file
dotenv.config();

// Initialize Express app
const app = express();
// Define the port from environment variable or default to 3000
const PORT = process.env.PORT || 3000;

// Middleware setup
app.use(cors());
app.use(express.json());

// Initialize Google GenAI client
const ai = new GoogleGenAI({});

// Basic route for testing
app.get("/", (req, res) => {
  res.send("Hello from the AI Chatbot 🤖 Backend!");
});

// Route to handle chat requests
app.post("/api/v1/chat/", async (req, res) => {
  const userInput = req.body.input;

  // Validate input
  if (!userInput) {
    return res.status(400).json({ error: "Input is required" });
  }

  console.log("Received user input:", userInput.substring(0, 100) + "...");

  // ===== SET UP SERVER-SENT EVENTS (SSE) HEADERS =====
  // These headers are crucial for establishing a streaming connection
  res.writeHead(200, {
    // SSE requires this specific content type
    "Content-Type": "text/event-stream",
    // Prevent any caching of the stream data
    "Cache-Control": "no-cache",
    // Keep the connection open for streaming
    Connection: "keep-alive",
    // CORS headers to allow frontend access
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Cache-Control",
  });

  // Call Google GenAI API for response
  try {
    // ===== USE GEMINI'S STREAMING API =====
    // generateContentStream returns chunks as they're generated
    // instead of waiting for the complete response
    const response = await ai.models.generateContentStream({
      model: "gemini-2.5-flash",
      contents: userInput,
    });

    console.log("📡 Starting to stream GenAI chat response...");

    // ===== PROCESS AND SEND EACH CHUNK =====
    // The 'for await' loop processes each chunk as it arrives from Gemini
    for await (const chunk of response) {
      if (chunk.text) {
        // Create the SSE data packet
        // SSE format requires: "data: {JSON data}\n\n"
        const sseData = {
          chunk: chunk.text, // The text chunk from Gemini
          done: false, // Indicates more chunks are coming
        };

        // Send the chunk to the frontend immediately
        res.write(`data: ${JSON.stringify(sseData)}\n\n`);

        console.log("📤 Sent chunk:", chunk.text.substring(0, 30) + "...");
      }
    }

    // ===== SEND COMPLETION SIGNAL =====
    // Let the frontend know streaming is complete
    res.write(`data: ${JSON.stringify({ chunk: "", done: true })}\n\n`);
    console.log("✅ Streaming completed successfully");

    // Close the SSE connection
    res.end();
  } catch (error) {
    console.error("🚫 Error during Google GenAI API stream:", error);
    // Send error through the stream (not as HTTP error)
    // This allows the frontend to handle errors gracefully
    const errorData = {
      error: "❌ Failed to generate GenAI response",
      details: error.message,
      done: true,
    };
    res.write(`data: ${JSON.stringify(errorData)}\n\n`);
    res.end();
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`🚀 Server started successfully!`);
  console.log(`🌍 Server URL: http://localhost:${PORT}`);
  console.log(`📋 Available endpoints:`);
  console.log(`   • GET  /                           - Health check`);
  console.log(`   • GET  /api/v1/test/               - Test Gemini connection`);
  console.log(`   • POST /api/v1/chat/               - Traditional chat (complete response)`);
  console.log(`   • POST /api/v1/chat/stream/        - Streaming chat (real-time)`);
  console.log(`   • POST /api/v1/interview/stream/   - Streaming interview (for TextBot)`);
  console.log(`\n💡 Make sure GEMINI_API_KEY is set in your .env file`);

  // Check if API key is configured
  if (!process.env.GEMINI_API_KEY) {
    console.warn(`⚠️  WARNING: GEMINI_API_KEY not found in environment variables!`);
    console.log(`   Create a .env file with: GEMINI_API_KEY=your_api_key_here`);
  }
});
