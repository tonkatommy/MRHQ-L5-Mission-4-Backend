// Import necessary ES6 modules
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
// Import Google Generative AI API
import { GoogleGenerativeAI } from "@google/generative-ai";

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
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// In-memory storage for conversation contexts (in production, use Redis or database)
const conversationContexts = new Map();

// Generate unique session ID for each conversation
const generateSessionId = () => {
  return `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
};

// Basic route for testing
app.get("/", (req, res) => {
  res.status(200).json({
    message: "🎉 Welcome to the Express backend server!",
    status: "Server is running",
    endpoints: {
      test: "GET /api/v1/test/",
      chat: "POST /api/v1/chat/",
      reset: "POST /api/v1/chat/reset/",
    },
  });
});

// Route to handle chat requests
app.post("/api/v1/chat/", async (req, res) => {
  const {
    input: userInput,
    isSystemPrompt = false,
    sessionId,
    requestIntroduction = false,
  } = req.body;

  // Validate input
  if (!userInput) {
    return res.status(400).json({ error: "Input is required" });
  }

  // Get or create session ID
  const currentSessionId = sessionId || generateSessionId();

  console.log(
    `Received ${isSystemPrompt ? "system prompt" : "user input"}:`,
    userInput.substring(0, 100) + "..."
  );

  // ===== HANDLE SYSTEM PROMPT WITH INTRODUCTION =====
  if (isSystemPrompt && requestIntroduction) {
    // Store the system prompt as context for this session
    conversationContexts.set(currentSessionId, {
      systemPrompt: userInput,
      messages: [],
      createdAt: new Date(),
    });

    console.log("📝 System prompt with introduction stored for session:", currentSessionId);

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
      // Send the session ID first
      res.write(
        `data: ${JSON.stringify({ sessionId: currentSessionId, chunk: "", done: false })}\n\n`
      );

      // Use Gemini to generate the introduction based on the system prompt
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
      const response = await model.generateContentStream(userInput);

      console.log("📡 Starting to stream introduction response...");

      let fullResponse = "";

      // Stream the introduction
      for await (const chunk of response.stream) {
        const chunkText = chunk.text();
        if (chunkText) {
          fullResponse += chunkText;

          const sseData = {
            chunk: chunkText,
            done: false,
            sessionId: currentSessionId,
          };

          res.write(`data: ${JSON.stringify(sseData)}\n\n`);
          console.log("📤 Sent intro chunk:", chunkText.substring(0, 30) + "...");
        }
      }

      // Store the introduction as the first assistant message
      const context = conversationContexts.get(currentSessionId);
      context.messages.push({
        role: "assistant",
        content: fullResponse,
        timestamp: new Date(),
        isIntroduction: true,
      });

      // Send completion signal
      res.write(
        `data: ${JSON.stringify({
          chunk: "",
          done: true,
          sessionId: currentSessionId,
        })}\n\n`
      );

      console.log("✅ Introduction streaming completed successfully");
      res.end();
    } catch (error) {
      console.error("🚫 Error during introduction generation:", error);

      const errorData = {
        error: "⚠️ Failed to generate introduction",
        details: error.message,
        done: true,
        sessionId: currentSessionId,
      };
      res.write(`data: ${JSON.stringify(errorData)}\n\n`);
      res.end();
    }

    return;
  }

  // ===== HANDLE REGULAR SYSTEM PROMPT (WITHOUT INTRODUCTION) =====
  if (isSystemPrompt) {
    // Store the system prompt as context for this session
    conversationContexts.set(currentSessionId, {
      systemPrompt: userInput,
      messages: [],
      createdAt: new Date(),
    });

    console.log("📝 System prompt stored for session:", currentSessionId);

    // Return simple acknowledgment for system prompts (no streaming needed)
    return res.status(200).json({
      message: "System prompt configured successfully",
      sessionId: currentSessionId,
    });
  }

  // ===== SET UP SERVER-SENT EVENTS (SSE) HEADERS =====
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Cache-Control",
  });

  // Get conversation context
  let context = conversationContexts.get(currentSessionId);
  if (!context) {
    // Create new context if none exists
    context = {
      systemPrompt: "You are a helpful AI assistant. Be concise but thorough in your responses.",
      messages: [],
      createdAt: new Date(),
    };
    conversationContexts.set(currentSessionId, context);
  }

  // Add user message to conversation history
  context.messages.push({
    role: "user",
    content: userInput,
    timestamp: new Date(),
  });

  try {
    // ===== PREPARE CONVERSATION HISTORY FOR GEMINI =====
    // Build the complete conversation with system context
    const conversationHistory = [];

    // Add system prompt as the first message
    if (context.systemPrompt) {
      conversationHistory.push({
        role: "user",
        parts: [{ text: context.systemPrompt }],
      });
      conversationHistory.push({
        role: "model",
        parts: [{ text: "I understand. I'll follow these guidelines in our conversation." }],
      });
    }

    // Add conversation history (last 10 exchanges to keep context manageable)
    const recentMessages = context.messages.slice(-20); // Keep last 20 messages
    for (let i = 0; i < recentMessages.length; i++) {
      const msg = recentMessages[i];
      conversationHistory.push({
        role: msg.role === "user" ? "user" : "model",
        parts: [{ text: msg.content }],
      });
    }

    console.log("🧠 Using conversation context with", conversationHistory.length, "messages");

    // ===== USE GEMINI'S STREAMING API WITH CONTEXT =====
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    // Start a chat session with history
    const chat = model.startChat({
      history: conversationHistory.slice(0, -1), // All except the last message
    });

    // Send the latest message and get streaming response
    const response = await chat.sendMessageStream(userInput);

    console.log("📡 Starting to stream GenAI chat response...");

    let fullResponse = "";

    // ===== PROCESS AND SEND EACH CHUNK =====
    for await (const chunk of response.stream) {
      const chunkText = chunk.text();
      if (chunkText) {
        fullResponse += chunkText;

        // Create the SSE data packet
        const sseData = {
          chunk: chunkText,
          done: false,
          sessionId: currentSessionId,
        };

        // Send the chunk to the frontend immediately
        res.write(`data: ${JSON.stringify(sseData)}\n\n`);
        console.log("📤 Sent chunk:", chunkText.substring(0, 30) + "...");
      }
    }

    // Add assistant response to conversation history
    context.messages.push({
      role: "assistant",
      content: fullResponse,
      timestamp: new Date(),
    });

    // ===== SEND COMPLETION SIGNAL =====
    res.write(
      `data: ${JSON.stringify({
        chunk: "",
        done: true,
        sessionId: currentSessionId,
      })}\n\n`
    );

    console.log("✅ Streaming completed successfully");
    res.end();
  } catch (error) {
    console.error("🚫 Error during Google GenAI API stream:", error);

    // Send error through the stream
    const errorData = {
      error: "⚠️ Failed to generate GenAI response",
      details: error.message,
      done: true,
      sessionId: currentSessionId,
    };
    res.write(`data: ${JSON.stringify(errorData)}\n\n`);
    res.end();
  }
});

// Route to reset conversation
app.post("/api/v1/chat/reset/", (req, res) => {
  const { sessionId } = req.body;

  if (sessionId && conversationContexts.has(sessionId)) {
    conversationContexts.delete(sessionId);
    console.log("🗑️ Reset conversation for session:", sessionId);
  }

  res.status(200).json({
    message: "Conversation reset successfully",
    sessionId: generateSessionId(),
  });
});

// Route to test Gemini connection
app.get("/api/v1/test/", async (req, res) => {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const result = await model.generateContent(
      "Hello, respond with just one 'Here I am..' line if you're working"
    );

    res.status(200).json({
      message: "✅ Gemini API connection successful",
      response: result.response.text(),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      error: "❌ Gemini API connection failed",
      details: error.message,
    });
  }
});

// Cleanup old conversations (run every hour)
setInterval(() => {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  let deletedCount = 0;

  for (const [sessionId, context] of conversationContexts.entries()) {
    if (context.createdAt < oneHourAgo) {
      conversationContexts.delete(sessionId);
      deletedCount++;
    }
  }

  if (deletedCount > 0) {
    console.log(`🧹 Cleaned up ${deletedCount} old conversation contexts`);
  }
}, 60 * 60 * 1000); // Every hour

// Start the server
app.listen(PORT, () => {
  console.log(`🚀 Server has started successfully! ✅`);
  console.log(`🌍 Server running at: http://localhost:${PORT} ⬅️`);
  console.log(`📋 Available endpoints:⬇️`);
  console.log(`   • GET  /                           - Health check`);
  console.log(`   • GET  /api/v1/test/               - Test Gemini connection`);
  console.log(`   • POST /api/v1/chat/               - Chat with context support`);
  console.log(`   • POST /api/v1/chat/reset/         - Reset conversation`);

  console.log(`\n💡 Make sure GEMINI_API_KEY is set in your .env file\n`);

  // Check if API key is configured
  if (!process.env.GEMINI_API_KEY) {
    console.warn(`⚠️  WARNING: GEMINI_API_KEY not found in environment variables!`);
    console.log(`   Create a .env file with: GEMINI_API_KEY=your_api_key_here`);
  }
});
