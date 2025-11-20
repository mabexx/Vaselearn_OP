import { NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/firebase/admin";
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";

// Helper function to get the API key from the user's document
async function getUserApiKey(userId: string): Promise<string | null> {
  try {
    const userDoc = await adminDb.collection("users").doc(userId).get();
    if (!userDoc.exists) {
      console.warn(`User document not found for userId: ${userId}`);
      return null;
    }
    const userData = userDoc.data();
    return userData?.googleAiApiKey || null;
  } catch (error) {
    console.error(`Error fetching API key for userId: ${userId}`, error);
    return null;
  }
}

export async function POST(request: Request) {
  let mistakeId: string | null = null;
  let userId: string | null = null;

  try {
    const body = await request.json();
    const {
      mistakeId: reqMistakeId,
      user,
      question,
      user_answer,
      correct_answer,
      subject,
      topic,
      difficulty,
      context,
    } = body;

    // Assign to outer scope for error handling
    mistakeId = reqMistakeId;
    userId = user?.uid;

    if (!mistakeId || !userId) {
      return NextResponse.json(
        { error: "Missing mistakeId or user" },
        { status: 400 }
      );
    }

    // 1. Get User's API Key
    const apiKey = await getUserApiKey(userId);
    if (!apiKey) {
      throw new Error("User API key not found or failed to fetch.");
    }

    // 2. Construct the AI Prompt
    const systemRole = `You are an expert tutoring assistant that diagnoses student mistakes, classifies error types, and returns precise step-by-step remediation. Always output valid JSON only (no extra text). Be concise, factual and avoid speculation.`;

    const userInput = {
      question,
      user_answer,
      correct_answer,
      subject,
      topic,
      difficulty,
      context: context || "",
      allow_web_search: false,
    };

    const prompt = `
      TASK:
      Diagnose why the student's answer is incorrect (or partially incorrect). Return ONE JSON object with up to 10 possible reasons (ranked) plus for each reason:
      - a short title
      - a probability (0.0–1.0)
      - a 1–2 sentence plain-language explanation of the likely mistake
      - up to 10 step-by-step corrective actions that the student can follow to fix the mistake (each step short, actionable)
      - one suggested flashcard (front/back) to remember the concept
      - one small practice prompt (1–2 lines) they can attempt immediately

      Rules:
      1. Return EXACTLY a single JSON object and nothing else.
      2. Include at most 10 reasons; include only reasons with probability >= 0.45.
      3. Rank reasons by probability descending.
      4. All numeric probabilities must be floats between 0 and 1.
      5. For multi-step solutions, ensure the corrective steps are ordered and teachable.
      6. Keep each step <= 120 characters.
      7. Use domain-appropriate terminology but explain in simple language.
      8. If the student's answer is correct, return \`"is_correct": true\` and an empty reasons array with a single congratulatory \`"note"\`.
      9. No hallucinated references. If you need external sources, set \`"sources": []\`.
      10. Output fields must match the JSON schema exactly.

      INPUT:
      ${JSON.stringify(userInput, null, 2)}
    `;

    // 3. Call the AI Model
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash", // Using a powerful model for complex reasoning
      systemInstruction: systemRole,
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.2, // Lower temperature for more deterministic output
      },
       safetySettings: [
        {
            category: HarmCategory.HARM_CATEGORY_HARASSMENT,
            threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
            category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
            threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
            category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
            threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
            category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
            threshold: HarmBlockThreshold.BLOCK_NONE,
        },
    ],
    });

    const result = await model.generateContent(prompt);
    const response = result.response;
    const diagnosisJson = JSON.parse(response.text());

    // 4. Save to Firestore
    await adminDb
      .collection("users")
      .doc(userId)
      .collection("mistakes")
      .doc(mistakeId)
      .update({ diagnosis: diagnosisJson, diagnosedAt: new Date().toISOString() });

    return NextResponse.json({ success: true, diagnosis: diagnosisJson });

  } catch (error) {
    console.error("Error in diagnosis route:", error);
    let errorMessage = "An unknown error occurred during diagnosis.";
    if (error instanceof Error) {
      errorMessage = error.message;
    }

    // If we have the IDs, save the error to the document for the frontend to handle
    if (userId && mistakeId) {
      await adminDb
        .collection("users")
        .doc(userId)
        .collection("mistakes")
        .doc(mistakeId)
        .update({
          diagnosis: { error: true, message: errorMessage },
          diagnosedAt: new Date().toISOString(),
        });
    }

    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
