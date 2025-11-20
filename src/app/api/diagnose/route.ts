import { NextResponse } from 'next/server';
import { auth } from 'firebase-admin';
import { firestoreAdmin, authAdmin } from '@/firebase/admin';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Prompts and Schema defined as in the plan
const SYSTEM_PROMPT = `You are an expert educational diagnostician. Given a question, a correct solution, and a student's answer, determine the most likely reasons the student answered incorrectly and provide clear, actionable remediation steps. Always output ONLY valid JSON that matches the schema described below. Do not include any extra commentary or markdown. Be concise and deterministic.`;

const USER_PROMPT_TEMPLATE = `
Schema rules:
- Return an object with keys: subject, question_summary, top_errors (array).
- top_errors: 1–3 items (max 3). Each item: error_id, title, probability (0.00-1.00), why_this_error_matches, fix_steps (array of 1–10 short steps), short_example (1 line).
- Only include errors with probability >= 0.45. Sort by probability desc.
- probability should be rounded to 2 decimals.
- Use plain text (no HTML). Steps must be simple numbered logic or short sentences.
- If the student is correct, return top_errors as an empty array and a "congratulations" message in question_summary.

Now analyze the following:
INPUT: { "subject": "{subject}", "question_text": "{question_text}", "correct_solution": "{correct_solution}", "user_answer": "{user_answer}", "context": "{context}" }
Return the JSON now.

### Example 1
INPUT: { "subject":"math", "question_text":"Solve for x: 2(x+3)=14", "correct_solution":"2(x+3)=14 -> x+3=7 -> x=4", "user_answer":"x=10", "context":"user wrote 2x+3=14 then x=10" }
EXPECTED JSON (condensed):
{
  "subject":"math",
  "question_summary":"Student used wrong distribution and misread parentheses.",
  "top_errors":[
    {
      "error_id":"MATH-DIST-01",
      "title":"Distribution / Parentheses error",
      "probability":0.85,
      "why_this_error_matches":"User expanded 2(x+3) into 2x+3 instead of 2x+6; context shows they wrote 2x+3.",
      "fix_steps":["Remember that 2(x+3) = 2*x + 2*3","Rewrite expression step-by-step before simplifying","Check final arithmetic by plugging x back into original equation"],
      "short_example":"2(x+3)=2x+6 => 2x+6=14 => x=4"
    }
  ]
}
`;

async function getUserIdFromRequest(request: Request): Promise<string | null> {
    const authorization = request.headers.get('Authorization');
    if (authorization?.startsWith('Bearer ')) {
        const idToken = authorization.split('Bearer ')[1];
        try {
            const decodedToken = await authAdmin.verifyIdToken(idToken);
            return decodedToken.uid;
        } catch (error) {
            console.error('Error verifying auth token:', error);
            return null;
        }
    }
    return null;
}

export async function POST(request: Request) {
    const userId = await getUserIdFromRequest(request);
    if (!userId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { mistakeId } = await request.json();
    if (!mistakeId) {
        return NextResponse.json({ error: 'Missing mistakeId' }, { status: 400 });
    }

    try {
        const userDoc = await firestoreAdmin.collection('users').doc(userId).get();
        const userData = userDoc.data();
        const apiKey = userData?.googleAiApiKey;

        if (!apiKey) {
            return NextResponse.json({ error: 'User has not provided an API key.' }, { status: 403 });
        }

        const mistakeDoc = await firestoreAdmin.collection('users').doc(userId).collection('mistakes').doc(mistakeId).get();
        const mistakeData = mistakeDoc.data();

        if (!mistakeData) {
            return NextResponse.json({ error: 'Mistake not found' }, { status: 404 });
        }

        const { topic, question, selectedAnswer, correctAnswer } = mistakeData;

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash"});

        const userPrompt = USER_PROMPT_TEMPLATE
            .replace('{subject}', topic)
            .replace('{question_text}', question)
            .replace('{correct_solution}', correctAnswer)
            .replace('{user_answer}', selectedAnswer)
            .replace('{context}', ''); // No context for now

        const result = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: SYSTEM_PROMPT }, { text: userPrompt }] }],
            generationConfig: {
                temperature: 0.2,
            },
        });
        const responseText = result.response.text();

        // Simple regex to extract JSON object
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error('No valid JSON object found in LLM response.');
        }

        const diagnosisJson = JSON.parse(jsonMatch[0]);

        // Basic validation
        if (!diagnosisJson.subject || !diagnosisJson.question_summary || !Array.isArray(diagnosisJson.top_errors)) {
            throw new Error('Invalid JSON schema from LLM.');
        }

        await firestoreAdmin.collection('users').doc(userId).collection('mistakes').doc(mistakeId).update({
            diagnosis: diagnosisJson,
            diagnosisTimestamp: new Date(),
        });

        return NextResponse.json({ success: true, diagnosis: diagnosisJson });

    } catch (error) {
        console.error('Error generating diagnosis:', error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred.';

        // Update Firestore with error
        await firestoreAdmin.collection('users').doc(userId).collection('mistakes').doc(mistakeId).update({
            diagnosis: { error: 'Failed to generate diagnosis.', details: errorMessage },
            diagnosisTimestamp: new Date(),
        }).catch(console.error);

        return NextResponse.json({ error: 'Failed to generate diagnosis.', details: errorMessage }, { status: 500 });
    }
}
