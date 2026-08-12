export interface StudyResult {
  extractedText: string;
  summary: string;
  stimulus?: string;
  mcqs?: {
    question: string;
    options: string[];
    answer: string;
    explanation?: string;
  }[];
  creativeQuestions?: {
    stimulus: string;
    questions: {
      mark: string; // ক, খ, গ, ঘ
      question: string;
    }[];
  }[];
  creativeAnswer?: string;
  creativeAnswerKa?: string;
  creativeAnswerKha?: string;
  creativeAnswerGa?: string;
  creativeAnswerGha?: string;
  historyId?: string;
  ocrText?: string;
}

// Utility to call Gemini via server proxy
async function callGemini(endpoint: string, payload: any) {
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.json();
      let message = errorData.error || "Failed to communicate with AI server";
      if (message.includes("429") || message.includes("RESOURCE_EXHAUSTED") || message.includes("quota")) {
        message = "বর্তমানে এআই সার্ভারে অনেক চাপ রয়েছে। অনুগ্রহ করে কিছুক্ষণ পর আবার চেষ্টা করুন। (Limit Exceeded)";
      } else if (message.includes("503") || message.includes("UNAVAILABLE")) {
        message = "এআই সার্ভার এই মুহূর্তে ব্যস্ত। অনুগ্রহ করে কয়েক সেকেন্ড পর আবার চেষ্টা করুন।";
      }
      throw new Error(message);
    }

    return await response.json();
  } catch (error: any) {
    if (error.message === 'Failed to fetch') {
      throw new Error("সার্ভারের সাথে যোগাযোগ করা যাচ্ছে না। আপনার ইন্টারনেট সংযোগ চেক করুন অথবা কয়েক সেকেন্ড পর আবার চেষ্টা করুন।");
    }
    throw error;
  }
}

export async function generateSpeech(text: string): Promise<string> {
  try {
    const data = await callGemini("/api/gemini/speech", { text });
    const base64Audio = data.audio;

    // The Gemini TTS model returns raw PCM data (16-bit, mono, 24000Hz).
    // We need to wrap it in a WAV header so it can be played by the browser's Audio element.
    const pcmData = Uint8Array.from(atob(base64Audio), c => c.charCodeAt(0));
    const wavHeader = new ArrayBuffer(44);
    const view = new DataView(wavHeader);

    // RIFF identifier
    view.setUint32(0, 0x52494646, false); // "RIFF"
    // file length
    view.setUint32(4, 36 + pcmData.length, true);
    // RIFF type
    view.setUint32(8, 0x57415645, false); // "WAVE"
    // format chunk identifier
    view.setUint32(12, 0x666d7420, false); // "fmt "
    // format chunk length
    view.setUint32(16, 16, true);
    // sample format (raw)
    view.setUint16(20, 1, true);
    // channel count
    view.setUint16(22, 1, true);
    // sample rate
    view.setUint32(24, 24000, true);
    // byte rate (sample rate * block align)
    view.setUint32(28, 24000 * 2, true);
    // block align (channel count * bytes per sample)
    view.setUint16(32, 2, true);
    // bits per sample
    view.setUint16(34, 16, true);
    // data chunk identifier
    view.setUint32(36, 0x64617461, false); // "data"
    // data chunk length
    view.setUint32(40, pcmData.length, true);

    const wavBlob = new Blob([wavHeader, pcmData], { type: 'audio/wav' });
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(wavBlob);
    });
  } catch (error) {
    console.error("Failed to generate speech:", error);
    throw new Error("অডিও তৈরি করতে সমস্যা হয়েছে।");
  }
}

export async function educationalChat(question: string, userClass: string, group?: string): Promise<string> {
  const model = "gemini-3.5-flash";
  const groupContext = group ? `(Group: ${group})` : "";
  
  const prompt = `
    You are "EDUZ AI", a Motivator and Educational Guide for students in Bangladesh. 
    Your personality is encouraging, empathetic, and professional.
    
    Your roles:
    1. Academic Help: Explain concepts for Class ${userClass} ${groupContext} based on NCTB curriculum.
    2. Mental Support: Provide motivation and support for students dealing with study pressure, depression, or lack of focus.
    3. App Guide: Explain features of "EDUZ" (Study tools, Quizzes, Leaderboard, Daily Goals).
    
    Student Context:
    - Class: ${userClass}
    - Group: ${groupContext}
    
    Question/Message: ${question}
    
    Guidelines:
    - Respond in Bengali.
    - Be Adaptive: Give extremely concise answers for simple queries (e.g., greetings, basic facts). Give detailed, structured explanations for complex topics or when asked "explain in detail".
    - Focus on core intent: Understand what the user *really* needs before answering.
    - Be empathetic and professional.
    - Explain academic concepts for Class ${userClass} based on NCTB curriculum.
    - Maintain motivation and mental support.
    - Use Markdown for formatting.
  `;

  try {
    const data = await callGemini("/api/gemini/chat", { prompt });
    return data.text || "দুঃখিত, আমি এই মুহূর্তে উত্তর দিতে পারছি না।";
  } catch (error) {
    console.error("Failed to generate educational chat response:", error);
    throw new Error("এআই চ্যাট বটের সাথে যোগাযোগ করতে সমস্যা হয়েছে।");
  }
}

export async function deepDiveChat(context: string, question: string): Promise<string> {
  const model = "gemini-3.5-flash";
  
  const prompt = `
    You are an expert academic tutor. Based on the following context, answer the student's follow-up question in detail.
    
    Context: ${context}
    Student Question: ${question}
    
    Guidelines:
    1. Provide a deep-dive, detailed explanation in Bengali.
    2. Use examples, analogies, and clear logic.
    3. Maintain an encouraging and educational tone.
    4. If it's a math or science question, ensure absolute accuracy.
    
    Return the answer in Markdown format.
  `;

  try {
    const data = await callGemini("/api/gemini/chat", { prompt });
    return data.text || "দুঃখিত, বিস্তারিত তথ্য পাওয়া যায়নি।";
  } catch (error) {
    console.error("Failed to deep dive chat:", error);
    throw new Error("বিস্তারিত তথ্য পেতে সমস্যা হয়েছে।");
  }
}

export async function processStudyImage(base64Image: string, mimeType: string, userClass: string, type: 'mcq' | 'creative' = 'mcq', group?: string): Promise<StudyResult> {
  const model = "gemini-3.5-flash";
  const groupContext = group ? `(Group: ${group})` : "";

  const mcqPrompt = `
    Analyze the provided image of a study note or textbook page for Class ${userClass} level ${groupContext} (NCTB Curriculum).
    1. Extract all the text from the image accurately.
    2. Provide a concise summary of the content in Bengali.
    3. Generate 20 Multiple Choice Questions (MCQs) based on the content, strictly following the Class ${userClass} standard. 
       - Each MCQ should have 4 options.
       - The questions, options, and the correct answer should all be in Bengali.
       - Ensure accuracy for math, physics, and chemistry problems if present.
    
    Return the result in JSON format.
  `;

  const creativePrompt = `
    Analyze the provided image of a study note or textbook page for Class ${userClass} level (NCTB Curriculum).
    1. Extract all the text from the image accurately.
    2. Provide a concise summary of the content in Bengali.
    3. Generate 3 high-quality Creative Questions (সৃজনশীল প্রশ্ন) based on the content following the official NCTB curriculum standard for Class ${userClass}.
       - Each creative question must have a stimulus (উদ্দীপক) and 4 sub-questions (ক, খ, গ, ঘ).
       - ক: Knowledge based (জ্ঞানমূলক)
       - খ: Understanding based (অনুধাবনমূলক)
       - গ: Application based (প্রয়োগমূলক)
       - ঘ: Higher order thinking (উচ্চতর চিন্তনদক্ষতা)
       - Everything must be in Bengali.
       - For math, physics, or chemistry content, ensure 100% logical and mathematical accuracy.
    
    Return the result in JSON format.
  `;

  const prompt = type === 'mcq' ? mcqPrompt : creativePrompt;

  const payload = {
    model,
    contents: [
      {
        parts: [
          { text: prompt },
          {
            inlineData: {
              data: base64Image.split(",")[1],
              mimeType: mimeType,
            },
          },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          extractedText: { type: "STRING" },
          summary: { type: "STRING" },
          mcqs: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                question: { type: "STRING" },
                options: {
                  type: "ARRAY",
                  items: { type: "STRING" }
                },
                answer: { type: "STRING" }
              },
              required: ["question", "options", "answer"]
            }
          },
          creativeQuestions: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                stimulus: { type: "STRING" },
                questions: {
                  type: "ARRAY",
                  items: {
                    type: "OBJECT",
                    properties: {
                      mark: { type: "STRING" },
                      question: { type: "STRING" }
                    },
                    required: ["mark", "question"]
                  }
                }
              },
              required: ["stimulus", "questions"]
            }
          }
        },
        required: ["extractedText", "summary"]
      }
    },
  };

  try {
    const data = await callGemini("/api/gemini/structured", payload);
    return JSON.parse(data.text || "{}") as StudyResult;
  } catch (error) {
    console.error("Failed to process the image:", error);
    throw new Error("Failed to process the image. Please try again.");
  }
}

export async function processStudyMultiInput(
  base64Image: string | null, 
  mimeType: string | null, 
  text: string | null,
  userClass: string, 
  type: 'mcq' | 'creative' = 'mcq', 
  group?: string,
  subject?: string
): Promise<StudyResult> {
  const model = "gemini-3.5-flash";
  const groupContext = group ? `(Group: ${group})` : "";

  const mcqPrompt = `
    You are an expert NCTB MCQ Engine for Class ${userClass} level ${groupContext}.
    
    PRIMARY TASK:
    Analyze the provided ${base64Image ? 'image (accurately extract all text and questions using OCR first)' : ''} ${text ? 'and text context: "' + text + '"' : ''}.
    
    CRITICAL MANDATES & CONSTRAINTS:
    1. EXTRACT OR GENERATE MCQs: If the image/text contains existing MCQs, extract ALL of them accurately with all options. If the image/text contains study notes or topics, generate 10 to 15 high-quality MCQs covering all essential facts.
    2. STRICT 4-OPTION FORMAT: Every MCQ MUST contain exactly 4 distinct options in Bengali (ক, খ, গ, ঘ).
    3. ACCURATE CORRECT ANSWER: "answer" MUST match one of the 4 options exactly.
    4. SHORT EXPLANATION: Provide a short, easy-to-understand explanation in Bengali ("explanation") for why the answer is correct.
    5. NO CREATIVE QUESTIONS: Do NOT output any Creative Question (সৃজনশীল) structures or answers in MCQ mode.
    
    Return the result strictly in JSON format.
  `;

  const combinedContext = `${subject || ''} ${text || ''}`.toLowerCase();
  const isNumerical = /গণিত|পদার্থ|রসায়ন|হিসাববিজ্ঞান|ফিন্যান্স|পদার্থবিজ্ঞান|উচ্চতর গণিত|math|physics|chemistry|accounting|finance|numerical/i.test(combinedContext);

  const creativePrompt = `
    You are an expert NCTB Creative Question (সৃজনশীল) Engine for Class ${userClass} level ${groupContext} ${subject ? `(Subject: ${subject})` : ''}.
    
    PRIMARY TASK:
    Analyze the provided ${base64Image ? 'image (accurately extract all text and stimulus using OCR first)' : ''} ${text ? 'and prompt: "' + text + '"' : ''}.
    
    CRITICAL MANDATES & CONSTRAINTS:
    1. STRICT PROHIBITION ON MCQs: You are in CREATIVE QUESTION (সৃজনশীল) MODE. Do NOT output any Multiple Choice Questions (MCQs), option choices, or quiz questions under any circumstances.
    2. NO TRUNCATION / NO CUTOFFS: You MUST generate/answer ALL 4 PARTS (ক, খ, গ, ঘ) completely in full detail. Do NOT leave any part blank, incomplete, or marked as "সম্পন্ন হচ্ছে" or "[প্রসেসিং]".
    ${isNumerical ? `
    3. DUAL ENGINE STYLE: MATHEMATICAL / NUMERICAL SUBJECT (গণিত, পদার্থবিজ্ঞান, রসায়ন, হিসাববিজ্ঞান, ফিন্যান্স, উচ্চতর গণিত):
       Format 'গ' and 'ঘ' strictly as authentic textbook/guide solution steps:
       - "stimulus": The extracted or parsed scenario/stimulus (উদ্দীপক) from the image/text.
       - "creativeAnswerKa": ক (জ্ঞানমূলক উত্তর) - Direct short definition or standard formula statement (1 mark).
       - "creativeAnswerKha": খ (অনুধাবনমূলক উত্তর) - Core theoretical concept explanation in clear paragraphs (2 marks).
       - "creativeAnswerGa": গ (প্রয়োগমূলক / গাণিতিক সমাধান):
         1. দেওয়া আছে / উদ্দীপক হতে পাই: (List all given numerical values with proper units)
         2. আমরা জানি / প্রয়োজনীয় সূত্র: (Write the explicit formula)
         3. ধাপভিত্তিক হিসাব / গাণিতিক সমাধান: (Step-by-step mathematical substitution & calculation)
         4. নির্ণেয় উত্তর: (Boldly state final calculated answer with unit)
       - "creativeAnswerGha": ঘ (উচ্চতর চিন্তন দক্ষতা / গাণিতিক বিশ্লেষণ):
         1. উদ্দীপকের প্রদত্ত শর্ত ও তথ্য বিশ্লেষণ:
         2. পরিবর্তিত বা দ্বিতীয় ক্ষেত্রের গাণিতিক হিসাব ও তুলনা:
         3. যৌক্তিক সিদ্ধান্ত ও মূল্যায়নী মন্তব্য:
       - "creativeAnswer": Complete combined response with formatted Markdown headers for all 4 sections.
    ` : `
    3. DUAL ENGINE STYLE: THEORETICAL SUBJECT (বাংলা, সমাজ/বাওবি, ধর্ম, ইতিহাস, ইংরেজি, ICT):
       Format strictly in NCTB structured paragraphs with academic fluency:
       - "stimulus": The extracted or parsed scenario/stimulus (উদ্দীপক) from the image/text.
       - "creativeAnswerKa": ক (জ্ঞানমূলক উত্তর) - Direct short answer or standard definition (1 mark).
       - "creativeAnswerKha": খ (অনুধাবনমূলক উত্তর) - Detailed core concept explanation in 2 clear paragraphs (2 marks).
       - "creativeAnswerGa": গ (প্রয়োগমূলক উত্তর) - Contextual application linking the stimulus scenario to textbook theory in 2-3 detailed paragraphs (3 marks).
       - "creativeAnswerGha": ঘ (উচ্চতর দক্ষতামূলক উত্তর) - Deep critical evaluation, logical reasoning, and concluding remarks in 2-3 detailed paragraphs (4 marks).
       - "creativeAnswer": Complete combined response with formatted Markdown headers for all 4 sections.
    `}
    4. FACT CHECK: Guarantee 100% mathematical, logical, and factual accuracy according to NCTB curriculum.
    
    Return the result strictly in JSON format.
  `;

  const prompt = type === 'mcq' ? mcqPrompt : creativePrompt;
  const parts: any[] = [{ text: prompt }];

  if (base64Image && mimeType) {
    parts.push({
      inlineData: {
        data: base64Image.includes(",") ? base64Image.split(",")[1] : base64Image,
        mimeType: mimeType,
      },
    });
  }

  const mcqSchema = {
    type: "OBJECT",
    properties: {
      extractedText: { type: "STRING" },
      summary: { type: "STRING" },
      mcqs: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            question: { type: "STRING" },
            options: {
              type: "ARRAY",
              items: { type: "STRING" }
            },
            answer: { type: "STRING" },
            explanation: { type: "STRING" }
          },
          required: ["question", "options", "answer", "explanation"]
        }
      }
    },
    required: ["extractedText", "summary", "mcqs"]
  };

  const creativeSchema = {
    type: "OBJECT",
    properties: {
      extractedText: { type: "STRING" },
      summary: { type: "STRING" },
      stimulus: { type: "STRING" },
      creativeAnswerKa: { type: "STRING" },
      creativeAnswerKha: { type: "STRING" },
      creativeAnswerGa: { type: "STRING" },
      creativeAnswerGha: { type: "STRING" },
      creativeAnswer: { type: "STRING" }
    },
    required: ["extractedText", "summary", "stimulus", "creativeAnswerKa", "creativeAnswerKha", "creativeAnswerGa", "creativeAnswerGha"]
  };

  const payload = {
    model,
    contents: [{ parts }],
    config: {
      responseMimeType: "application/json",
      responseSchema: type === 'mcq' ? mcqSchema : creativeSchema
    },
  };

  try {
    const data = await callGemini("/api/gemini/structured", payload);
    const rawText = data.text || "{}";
    const cleanedText = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
    const result = JSON.parse(cleanedText) as StudyResult;

    if (type === 'creative') {
      result.mcqs = undefined;
      if (!result.creativeAnswer) {
        result.creativeAnswer = [
          result.stimulus ? `### উদ্দীপক (Stem)\n${result.stimulus}\n` : '',
          result.creativeAnswerKa ? `### ক (জ্ঞানমূলক)\n${result.creativeAnswerKa}\n` : '',
          result.creativeAnswerKha ? `### খ (অনুধাবনমূলক)\n${result.creativeAnswerKha}\n` : '',
          result.creativeAnswerGa ? `### গ (প্রয়োগমূলক)\n${result.creativeAnswerGa}\n` : '',
          result.creativeAnswerGha ? `### ঘ (উচ্চতর দক্ষতা)\n${result.creativeAnswerGha}` : ''
        ].filter(Boolean).join('\n');
      }
    } else {
      result.creativeAnswer = undefined;
      result.creativeQuestions = undefined;
      result.creativeAnswerKa = undefined;
      result.creativeAnswerKha = undefined;
      result.creativeAnswerGa = undefined;
      result.creativeAnswerGha = undefined;
      result.stimulus = undefined;
    }

    return result;
  } catch (error) {
    console.error("Failed to process study multi input:", error);
    throw new Error("ফলাফল প্রস্তুত করতে সমস্যা হয়েছে। অনুগ্রহ করে আবার চেষ্টা করুন।");
  }
}

export async function generateCreativeAnswer(question: string, userClass: string, group?: string, subject?: string): Promise<string> {
  const groupContext = group ? `(Group: ${group})` : "";
  const combinedContext = `${subject || ''} ${question || ''}`.toLowerCase();
  const isNumerical = /গণিত|পদার্থ|রসায়ন|হিসাববিজ্ঞান|ফিন্যান্স|পদার্থবিজ্ঞান|উচ্চতর গণিত|math|physics|chemistry|accounting|finance|numerical/i.test(combinedContext);

  const prompt = `
    You are an expert NCTB educator. Provide a high-quality answer for the following Creative Question (সৃজনশীল প্রশ্ন) for Class ${userClass} ${groupContext} ${subject ? `(Subject: ${subject})` : ''}.
    
    Structure strictly (In Bengali):
    ### ক (জ্ঞানমূলক): [সরাসরি উত্তর / সংজ্ঞা]
    ### খ (অনুধাবনমূলক): [মূল ভাব ও স্পষ্ট ব্যাখ্যা]
    ${isNumerical ? `
    ### গ (প্রয়োগমূলক / গাণিতিক সমাধান):
    - **দেওয়া আছে / উদ্দীপক হতে পাই:** [প্রদত্ত মানসমূহ]
    - **আমরা জানি / প্রয়োজনীয় সূত্র:** [সূত্র]
    - **ধাপভিত্তিক হিসাব:** [গাণিতিক সমাধান]
    - **নির্ণেয় উত্তর:** [চূড়ান্ত উত্তর]
    ### ঘ (উচ্চতর চিন্তন দক্ষতা / বিশ্লেষণ):
    - **শর্ত ও তথ্য বিশ্লেষণ:** [বিশ্লেষণ]
    - **গাণিতিক তুলনা / সিদ্ধান্ত:** [তুলনা ও গাণিতিক প্রমাণ]
    - **মূল্যায়নী সিদ্ধান্ত:** [চূড়ান্ত মন্তব্য]
    ` : `
    ### গ (প্রয়োগমূলক): [উদ্দীপক ও পাঠ্যবইয়ের যোগসূত্র ও বিস্তারিত প্রয়োগ]
    ### ঘ (উচ্চতর দক্ষতামূলক): [গভীর বিশ্লেষণ, যুক্তি উপস্থাপন ও মূল্যায়নী সিদ্ধান্ত]
    `}
    
    Guidelines:
    1. Class Level: ${userClass}.
    2. Accuracy: 100% precision.
    3. Return in Markdown.
    
    Question: ${question}
  `;

  try {
    const data = await callGemini("/api/gemini/chat", { prompt });
    return data.text || "দুঃখিত, উত্তর তৈরি করা সম্ভব হয়নি।";
  } catch (error) {
    console.error("Failed to generate creative answer:", error);
    throw new Error("উত্তর তৈরি করতে সমস্যা হয়েছে। আবার চেষ্টা করুন।");
  }
}

export async function generateQuizQuestions(subject: string, userClass: string, group?: string): Promise<StudyResult> {
  const groupContext = group ? `(Group: ${group})` : "";
  const prompt = `
    Generate 20 high-quality Multiple Choice Questions (MCQs) for the subject "${subject}" based on the NCTB curriculum for Class ${userClass} ${groupContext}.
    
    Guidelines:
    1. The questions must be challenging yet appropriate for Class ${userClass}.
    2. Each question must have 4 options.
    3. Everything must be in Bengali.
    4. Ensure absolute accuracy for science or math related subjects.
    
    Return the result in JSON format.
  `;

  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          extractedText: { type: "STRING" },
          summary: { type: "STRING" },
          mcqs: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                question: { type: "STRING" },
                options: {
                  type: "ARRAY",
                  items: { type: "STRING" }
                },
                answer: { type: "STRING" }
              },
              required: ["question", "options", "answer"]
            }
          }
        },
        required: ["extractedText", "summary", "mcqs"]
      }
    }
  };

  try {
    const data = await callGemini("/api/gemini/structured", payload);
    return JSON.parse(data.text || "{}") as StudyResult;
  } catch (error) {
    console.error("Failed to generate quiz questions:", error);
    throw new Error("কুইজ প্রশ্ন তৈরি করতে সমস্যা হয়েছে।");
  }
}

export async function generateMcqFromText(text: string, userClass: string, group?: string): Promise<StudyResult> {
  const groupContext = group ? `(Group: ${group})` : "";
  const prompt = `
    Analyze the provided text and generate Multiple Choice Questions (MCQs) in Bengali for Class ${userClass} level ${groupContext} (NCTB Curriculum).
    
    Text: ${text}
    
    Guidelines:
    1. Generate 10-15 high-quality MCQs based on the text, tailored for Class ${userClass}.
    2. Each MCQ must have 4 options.
    3. The questions, options, and the correct answer must all be in Bengali.
    4. Ensure accuracy for any math or logic present in the text.
    5. Provide a concise summary of the text in Bengali.
    
    Return the result in JSON format.
  `;

  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          extractedText: { type: "STRING" },
          summary: { type: "STRING" },
          mcqs: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                question: { type: "STRING" },
                options: {
                  type: "ARRAY",
                  items: { type: "STRING" }
                },
                answer: { type: "STRING" }
              },
              required: ["question", "options", "answer"]
            }
          }
        },
        required: ["extractedText", "summary", "mcqs"]
      }
    }
  };

  try {
    const data = await callGemini("/api/gemini/structured", payload);
    return JSON.parse(data.text || "{}") as StudyResult;
  } catch (error) {
    console.error("Failed to generate MCQs from text:", error);
    throw new Error("টেক্সট থেকে এমসিকিউ তৈরি করতে সমস্যা হয়েছে। আবার চেষ্টা করুন।");
  }
}

export async function performOCR(base64Image: string, mimeType: string): Promise<string> {
  const prompt = `
    Extract all the text from the provided image accurately. 
    The text is likely in Bengali or English, or a mix of both. 
    Preserve the formatting and structure as much as possible.
    Return only the extracted text.
  `;

  const payload = {
    contents: [
      {
        parts: [
          { text: prompt },
          {
            inlineData: {
              data: base64Image.split(",")[1],
              mimeType: mimeType,
            },
          },
        ],
      },
    ],
  };

  try {
    const data = await callGemini("/api/gemini/generate", payload);
    return data.text || "দুঃখিত, ছবি থেকে কোনো লেখা পাওয়া যায়নি।";
  } catch (error) {
    console.error("Failed to perform OCR:", error);
    throw new Error("ছবি থেকে লেখা বের করতে সমস্যা হয়েছে।");
  }
}

export async function generateStudyPlan(examDate: string, weakSubjects: string, userClass: string, userFeedback?: string): Promise<string> {
  const prompt = `
    Generate a smart daily study schedule in Bengali for a Class ${userClass} student.
    Exam Date: ${examDate}
    Weak Subjects: ${weakSubjects}
    User Feedback/Weakness: ${userFeedback || "None provided"}
    
    Guidelines:
    1. Be concise and motivational.
    2. Provide a structured daily routine in a Large HTML Table format (using <table>, <tr>, <th>, <td> tags).
    3. The table MUST have columns: "সময়" (Time), "বিষয়" (Subject), and "লক্ষ্য/কার্যক্রম" (Goal/Activity).
    4. Focus more on the weak subjects and address the user's specific feedback.
    5. Language: Bengali.
  `;

  try {
    const data = await callGemini("/api/gemini/chat", { prompt });
    return data.text || "দুঃখিত, স্টাডি প্ল্যান তৈরি করা সম্ভব হয়নি।";
  } catch (error) {
    console.error("Failed to generate study plan:", error);
    throw new Error("স্টাডি প্ল্যান তৈরি করতে সমস্যা হয়েছে।");
  }
}

export async function generateCreativeAnswerFromImage(base64Image: string, mimeType: string, userClass: string, group?: string, subject?: string): Promise<string> {
  const groupContext = group ? `(Group: ${group})` : "";
  const isNumerical = /গণিত|পদার্থ|রসায়ন|হিসাববিজ্ঞান|ফিন্যান্স|পদার্থবিজ্ঞান|উচ্চতর গণিত|math|physics|chemistry|accounting|finance/i.test((subject || '').toLowerCase());

  const prompt = `
    Analyze the image containing a Creative Question for Class ${userClass} ${groupContext} ${subject ? `(Subject: ${subject})` : ''}.
    
    Structure strictly (In Bengali):
    ### ক (জ্ঞানমূলক): [সরাসরি উত্তর / সংজ্ঞা]
    ### খ (অনুধাবনমূলক): [মূল ভাব ও স্পষ্ট ব্যাখ্যা]
    ${isNumerical ? `
    ### গ (প্রয়োগমূলক / গাণিতিক সমাধান):
    - **দেওয়া আছে / উদ্দীপক হতে পাই:** [প্রদত্ত মানসমূহ]
    - **আমরা জানি / প্রয়োজনীয় সূত্র:** [সূত্র]
    - **ধাপভিত্তিক হিসাব:** [গাণিতিক সমাধান]
    - **নির্ণেয় উত্তর:** [চূড়ান্ত উত্তর]
    ### ঘ (উচ্চতর চিন্তন দক্ষতা / বিশ্লেষণ):
    - **শর্ত ও তথ্য বিশ্লেষণ:** [বিশ্লেষণ]
    - **গাণিতিক তুলনা / সিদ্ধান্ত:** [তুলনা ও গাণিতিক প্রমাণ]
    - **মূল্যায়নী সিদ্ধান্ত:** [চূড়ান্ত মন্তব্য]
    ` : `
    ### গ (প্রয়োগমূলক): [উদ্দীপক ও পাঠ্যবইয়ের যোগসূত্র ও বিস্তারিত প্রয়োগ]
    ### ঘ (উচ্চতর দক্ষতামূলক): [গভীর বিশ্লেষণ, যুক্তি উপস্থাপন ও মূল্যায়নী সিদ্ধান্ত]
    `}

    Guidelines:
    1. Level: Class ${userClass}.
    2. Accuracy: 100% precision.
    3. Return in Markdown.
  `;

  const payload = {
    contents: [
      {
        parts: [
          { text: prompt },
          {
            inlineData: {
              data: base64Image.split(",")[1],
              mimeType: mimeType,
            },
          },
        ],
      },
    ],
  };

  try {
    const data = await callGemini("/api/gemini/generate", payload);
    return data.text || "দুঃখিত, ছবি থেকে উত্তর তৈরি করা সম্ভব হয়নি।";
  } catch (error) {
    console.error("Failed to generate creative answer from image:", error);
    throw new Error("ছবি থেকে উত্তর তৈরি করতে সমস্যা হয়েছে। আবার চেষ্টা করুন।");
  }
}

export async function generateSelfPracticeQuestions(subject: string, chapter: string, userClass: string, limit: number, group?: string): Promise<StudyResult> {
  const groupContext = group ? `(Group: ${group})` : "";
  const prompt = `
    Generate exactly ${limit} high-quality Multiple Choice Questions (MCQs) in Bengali for the subject "${subject}" under the chapter "${chapter}" based on the official NCTB curriculum for Class ${userClass} ${groupContext}.
    
    Guidelines:
    1. The questions must be strictly tailored to the specific chapter "${chapter}" and subject "${subject}".
    2. Each question must have exactly 4 options.
    3. The absolute correct answer must be provided and MUST exactly match one of the 4 options.
    4. Everything (question text, options, answer) must be in natural, flawless Bengali.
    
    Return the result in JSON format matching StudyResult structure schema.
  `;

  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          extractedText: { type: "STRING" },
          summary: { type: "STRING" },
          mcqs: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                question: { type: "STRING" },
                options: {
                  type: "ARRAY",
                  items: { type: "STRING" }
                },
                answer: { type: "STRING" }
              },
              required: ["question", "options", "answer"]
            }
          }
        },
        required: ["summary", "mcqs"]
      }
    }
  };

  try {
    const data = await callGemini("/api/gemini/structured", payload);
    return JSON.parse(data.text || "{}") as StudyResult;
  } catch (error) {
    console.error("Failed to generate self practice questions:", error);
    throw new Error("সেলফ-প্র্যাকটিস প্রশ্ন তৈরি করতে সমস্যা হয়েছে। অনুগ্রহ করে আবার চেষ্টা করুন।");
  }
}

