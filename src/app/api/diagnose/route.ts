import { NextResponse } from "next/server";
import getFirebaseAdmin from "@/firebase/admin";
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";
import { Firestore } from "firebase-admin/firestore";

// Helper function to get the API key from the user's document
async function getUserApiKey(userId: string): Promise<string | null> {
  try {
    const { adminDb } = getFirebaseAdmin();
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
    const { adminDb } = getFirebaseAdmin();
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

    mistakeId = reqMistakeId;
    userId = user?.uid;

    if (!mistakeId || !userId) {
      return NextResponse.json(
        { error: "Missing mistakeId or user" },
        { status: 400 }
      );
    }

    const apiKey = await getUserApiKey(userId);
    if (!apiKey) {
      throw new Error("User API key not found or failed to fetch.");
    }

    const systemRole = `You are an expert tutoring assistant...`; // Prompt remains the same
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
      Diagnose why the student's answer is incorrect...

      INPUT:
      ${JSON.stringify(userInput, null, 2)}
    `;

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      systemInstruction: systemRole,
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.2,
      },
       safetySettings: [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    ],
    });

    const result = await model.generateContent(prompt);
    const response = result.response;
    const diagnosisJson = JSON.parse(response.text());

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

    if (userId && mistakeId) {
      try {
        const { adminDb } = getFirebaseAdmin();
        await adminDb
          .collection("users")
          .doc(userId)
          .collection("mistakes")
          .doc(mistakeId)
          .update({
            diagnosis: { error: true, message: errorMessage },
            diagnosedAt: new Date().toISOString(),
          });
      } catch (dbError) {
        console.error("Failed to save error state to Firestore:", dbError);
      }
    }

    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
