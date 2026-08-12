import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Modality, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '50mb' }));

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || "",
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

// track congested models to bypass them for 2 minutes to keep response times near-zero
const congestedModels = new Map<string, number>();

// Helper for retrying with backoff and model fallback
async function callWithRetry(fn: (modelName: string) => Promise<any>, initialModel: string) {
  let fallbacks: string[] = [];

  // Speech/TTS requests should only ever fall back to other speech models,
  // while general text requests fall back through the general model zoo.
  if (initialModel.includes("-tts-")) {
    fallbacks = ["gemini-3.1-flash-tts-preview"];
  } else {
    fallbacks = [
      "gemini-3.1-flash-lite",
      "gemini-3.5-flash",
      "gemini-flash-latest",
      "gemini-2.5-flash",
      "gemini-3.1-pro-preview"
    ];
  }
  
  const baseModels = [initialModel, ...fallbacks].filter((item, pos, self) => self.indexOf(item) === pos);
  
  // Reorder baseModels based on current congestion state
  const now = Date.now();
  const availableModels: string[] = [];
  const delayedModels: string[] = [];
  
  for (const m of baseModels) {
    const expires = congestedModels.get(m);
    if (expires && now < expires) {
      delayedModels.push(m);
    } else {
      availableModels.push(m);
    }
  }
  
  const models = [...availableModels, ...delayedModels];
  
  let lastError: any;

  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    console.log(`[Gemini] Attempting request with model: ${model}`);
    let retries = 2; // Support up to 2 retries per model
    
    while (retries >= 0) {
      try {
        const result = await fn(model);
        console.log(`[Gemini] Success with model: ${model}`);
        return result;
      } catch (error: any) {
        lastError = error;
        
        let errBody = null;
        try {
          if (error.message && error.message.includes("{")) {
            const start = error.message.indexOf("{");
            const end = error.message.lastIndexOf("}") + 1;
            if (start !== -1 && end > start) {
              errBody = JSON.parse(error.message.substring(start, end));
            }
          }
        } catch (e) {
          // Ignore parsing errors
        }

        let status = error.status || (errBody?.error?.code);
        let message = error.message || errBody?.error?.message || "";

        let fullErrStr = "";
        try {
          fullErrStr = (error.toString() + " " + (error.message || "") + " " + (error.stack || "") + " " + JSON.stringify(error) + " " + message).toLowerCase();
        } catch (e) {
          fullErrStr = (error.toString() + " " + (error.message || "") + " " + (error.stack || "") + " " + message).toLowerCase();
        }

        const isTransient = status == 503 || 
                            status === "503" ||
                            status == 500 || 
                            status === "500" ||
                            status == 429 ||
                            status === "429" ||
                            fullErrStr.includes("unavailable") || 
                            fullErrStr.includes("503") || 
                            fullErrStr.includes("high demand") || 
                            fullErrStr.includes("overloaded") || 
                            fullErrStr.includes("temporary") || 
                            fullErrStr.includes("transient") ||
                            fullErrStr.includes("service unavailable");

        if (isTransient) {
          // Mark model as congested for 2 minutes to route requests gracefully to other models
          congestedModels.set(model, Date.now() + 120000);
        }

        const isLastModel = (i === models.length - 1);

        // Print a healthy informational routing message for intermediate candidates instead of warnings
        if (!isLastModel) {
          console.log(`[Gemini] Routing dynamically: Candidate ${model} is busy (Status: ${status || 'Busy'}). Seamlessly selecting alternative candidate...`);
        } else {
          console.error(`[Gemini] Critical: Final model ${model} response exception:`, { status, message });
        }

        // Check for Quota (429)
        if (status === 429 || message.includes("RESOURCE_EXHAUSTED") || message.includes("quota")) {
          console.log(`[Gemini] Quota handled for model ${model}.`);
          
          if (i < models.length - 1) {
            console.log(`[Gemini] Switching to next fallback model immediately.`);
            break; 
          }
          
          const retryAfter = errBody?.error?.details?.find((d: any) => d.retryDelay)?.retryDelay;
          if (retryAfter && retries > 0) {
             const seconds = parseInt(retryAfter);
             if (!isNaN(seconds) && seconds < 20) {
                console.log(`[Gemini] Waiting ${seconds}s for quota to reset...`);
                await new Promise(resolve => setTimeout(resolve, (seconds + 1) * 1000));
                retries--;
                continue;
             }
          }
          break;
        }

        // Handle 404 (Not Found) or 400 (Bad Request on model name)
        if (status === 404 || status === 400 || message.includes("NOT_FOUND") || message.includes("not found") || message.includes("unsupported")) {
          console.log(`[Gemini] Model ${model} is unavailable, not found, or unsupported. Moving to next.`);
          break; 
        }

        if (isTransient) {
          if (i < models.length - 1) {
            console.log(`[Gemini] Model ${model} shifted. Instantly trying the next model.`);
            break; // Immediately break out of the while loop to skip waiting and try the next model
          } else if (retries > 0) {
            const delay = (3 - retries) * 1000; // 1st retry: 1000ms, 2nd retry: 2000ms
            console.log(`[Gemini] Retrying final candidate in ${delay}ms... (Remaining attempts: ${retries})`);
            await new Promise(resolve => setTimeout(resolve, delay));
            retries--;
          } else {
            break;
          }
        } else {
          break;
        }
      }
    }
  }
  throw lastError;
}

// API Routes
app.post("/api/gemini/speech", async (req, res) => {
  console.log("[API] /api/gemini/speech");
  const { text } = req.body;
  const initialModel = "gemini-3.1-flash-tts-preview";
  
  try {
    const response = await callWithRetry((model) => ai.models.generateContent({
      model,
      contents: [{ parts: [{ text: `Say clearly in a natural Bengali voice: ${text}` }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Kore' },
          },
        },
      },
    }), initialModel);

    const parts = response.candidates?.[0]?.content?.parts;
    const audioPart = parts?.find(p => p.inlineData?.data);
    const base64Audio = audioPart?.inlineData?.data;

    if (!base64Audio) {
      console.error("[API] No audio data in response");
      return res.status(500).json({ error: "No audio data received" });
    }

    res.json({ audio: base64Audio });
  } catch (error: any) {
    console.error("[API] Gemini TTS Error:", error.message);
    res.status(500).json({ error: error.message || "Failed to generate speech" });
  }
});

app.post("/api/gemini/chat", async (req, res) => {
  console.log("[API] /api/gemini/chat");
  const { prompt } = req.body;
  const initialModel = "gemini-3.5-flash";
  
  try {
    const response = await callWithRetry((model) => ai.models.generateContent({
      model,
      contents: [{ parts: [{ text: prompt }] }],
    }), initialModel);

    res.json({ text: response.text });
  } catch (error: any) {
    console.error("[API] Gemini Chat Error:", error.message);
    res.status(500).json({ error: error.message || "Failed to generate chat response" });
  }
});

app.post("/api/gemini/generate", async (req, res) => {
  console.log("[API] /api/gemini/generate");
  const { model, contents, config } = req.body;
  const initialModel = model || "gemini-3.5-flash";
  
  try {
    const response = await callWithRetry((m) => ai.models.generateContent({
      model: m,
      contents,
      config,
    }), initialModel);

    res.json({ text: response.text });
  } catch (error: any) {
    console.error("[API] Gemini Generate Error:", error.message);
    res.status(500).json({ error: error.message || "Failed to generate content" });
  }
});

// Generic endpoint for structured responses
app.post("/api/gemini/structured", async (req, res) => {
  console.log("[API] /api/gemini/structured");
  const { model, contents, config } = req.body;
  const initialModel = model || "gemini-3.5-flash";
  
  try {
    const response = await callWithRetry((m) => ai.models.generateContent({
      model: m,
      contents,
      config: {
        ...config,
        responseMimeType: "application/json",
      },
    }), initialModel);

    res.json({ text: response.text });
  } catch (error: any) {
    console.error("[API] Gemini Structured Error:", error.message);
    res.status(500).json({ error: error.message || "Failed to generate structured content" });
  }
});

async function startServer() {
  // Vite Middleware
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch(err => {
  console.error("Failed to start server:", err);
});
