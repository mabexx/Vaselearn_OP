
'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getSettings } from '@/lib/aistudio';
import { QuizQuestion, Mistake, PracticeSession, QuizAnalysis } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { getFirestore, collection, addDoc, doc, writeBatch, Timestamp } from 'firebase/firestore';
import { useUser } from '@/firebase';
import QuestionMultipleChoice from '@/components/quiz/QuestionMultipleChoice';
import QuestionTrueFalse from '@/components/quiz/QuestionTrueFalse';
import QuestionCaseBased from '@/components/quiz/QuestionCaseBased';
import QuizAnalysisDisplay from '@/components/quiz/QuizAnalysis';
import { CheckCircle, XCircle, AlertTriangle } from 'lucide-react';

export default function QuizComponentInner({
  topic = '',
  limit = 10,
  clientType = 'Student',
  questionType = 'multiple-choice',
  difficulty = 'neutral',
  modelId = 'gemini-2.5-flash-lite',
  context = ''
}: {
  topic?: string;
  limit?: number;
  clientType?: string;
  questionType?: string;
  difficulty?: string;
  modelId?: string;
  context?: string;
}) {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState('Initializing...');
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [userAnswers, setUserAnswers] = useState<(string | boolean | undefined)[]>([]);
  const [isComplete, setIsComplete] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [analyses, setAnalyses] = useState<(QuizAnalysis | null)[]>([]);
  const [analysisLoading, setAnalysisLoading] = useState<number | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const router = useRouter();
  const { user, isUserLoading } = useUser();
  const db = getFirestore();

  const generateQuestions = useCallback(async (key: string, model: string, context?: string): Promise<QuizQuestion[]> => {
    const genAI = new GoogleGenerativeAI(key);
    const aiModel = genAI.getGenerativeModel({ model });
    const prompt = `
      Generate exactly ${limit} quiz questions about the topic "${topic}".
      ${context ? `Use the following questions as context to generate similar questions, but do not repeat them verbatim: \n${context}` : ''}
      The target audience is learners associated with a "${clientType}".
      The quiz should contain questions of the type "${questionType}" with a "${difficulty}" difficulty.
      Format your response as a valid JSON array of objects. Each object must have a "type" field ("multiple_choice", "true_false", or "case_based"), a "question" field, and an "answer" field.
      - "multiple_choice" must include an "options" array.
      - "case_based" must include a "prompt" field.
      Return ONLY the JSON array.
    `;
    try {
      const result = await aiModel.generateContent(prompt);
      const { response } = result;
      const text = response.text();
      let jsonString = text.trim();
      if (jsonString.startsWith('```json')) {
        jsonString = jsonString.substring(7, jsonString.length - 3).trim();
      }
      const parsed = JSON.parse(jsonString) as QuizQuestion[];
      return parsed.slice(0, limit);
    } catch (err) {
      console.error('Failed to generate or parse AI response:', err);
      throw new Error('Failed to generate questions. The AI may be experiencing issues.');
    }
  }, [topic, limit, clientType, questionType, difficulty]);

  const generateAnalysis = useCallback(async (key: string, question: QuizQuestion): Promise<QuizAnalysis> => {
    if (question.type !== 'multiple_choice') {
      throw new Error('Analysis is only available for multiple-choice questions.');
    }
    const genAI = new GoogleGenerativeAI(key);
    const aiModel = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });
    const correctAnswer = question.answer;
    const wrongAnswers = question.options.filter(opt => opt !== correctAnswer);
    const prompt = `
      You are an expert tutor for Physics, Chemistry, and Mathematics.
      Analyze the following multiple-choice question and generate a detailed analysis.

      **Question:** ${question.question}
      **Correct Answer:** ${correctAnswer}
      **Wrong Answers:** ${wrongAnswers.join(', ')}

      **Instructions:**
      Generate a response in a valid JSON object format with two main keys: "correctSolution" and "counterfactualAnalyses".

      1.  **"correctSolution"**: An object with:
          *   "answer": The correct answer string.
          *   "steps": An array of objects, each with "step" (number) and "explanation" (string) for the step-by-step solution.

      2.  **"counterfactualAnalyses"**: An array of objects, one for each wrong answer. Each object should have:
          *   "wrongAnswer": The incorrect answer string.
          *   "errorType": A concise classification of the mistake (e.g., "Sign Error", "Formula Misapplication", "Unit Conversion Error", "Conceptual Misunderstanding").
          *   "possiblePathways": An array of 1 to 3 objects, where each object represents a realistic pathway a student might take to arrive at this wrong answer. Each pathway object must have:
              *   "pathwayDescription": A brief summary of the flawed logic in this pathway.
              *   "steps": An array of step objects, similar to the correct solution. One of these steps MUST be marked as the error, with "isError": true, and an "errorDescription" explaining what went wrong at that point.

      Return ONLY the valid JSON object.
    `;
    try {
      const result = await aiModel.generateContent(prompt);
      const { response } = result;
      const text = response.text();
      let jsonString = text.trim();
      if (jsonString.startsWith('```json')) {
        jsonString = jsonString.substring(7, jsonString.length - 3).trim();
      }
      return JSON.parse(jsonString) as QuizAnalysis;
    } catch (err) {
      console.error('Failed to generate or parse AI analysis response:', err);
      throw new Error('Failed to generate analysis. The AI may be experiencing issues.');
    }
  }, []);

  useEffect(() => {
    if (isUserLoading) {
      setLoadingMessage('Verifying user...');
      return;
    }
    if (!user) {
      router.push('/login');
      return;
    }

    const fetchSettingsAndGenerate = async () => {
      setLoadingMessage('Retrieving settings...');
      const { apiKey: key } = getSettings();
      if (!key) {
        const params = new URLSearchParams({ topic, limit: String(limit), clientType, questionType, model: modelId, difficulty });
        router.push(`/practice/connect?${params.toString()}`);
        return;
      }
      setApiKey(key);
      setLoadingMessage('Generating quiz questions...');
      try {
        const generated = await generateQuestions(key, modelId, context);
        if (generated.length > 0) {
          setQuestions(generated);
          setUserAnswers(new Array(generated.length).fill(undefined));
        } else {
          setLoadingMessage('No questions were generated. Try a different topic.');
        }
      } catch (error) {
        setLoadingMessage(error instanceof Error ? error.message : 'An unknown error occurred.');
      } finally {
        setLoading(false);
      }
    };
    fetchSettingsAndGenerate();
  }, [user, isUserLoading, modelId, topic, limit, clientType, questionType, difficulty, router, generateQuestions, context]);

  const calculateScore = () => {
    return userAnswers.reduce((score, userAnswer, index) => {
      if (userAnswer !== undefined && String(userAnswer).toLowerCase() === String(questions[index].answer).toLowerCase()) {
        return score + 1;
      }
      return score;
    }, 0);
  };

  const generateTagsForTopic = async (key: string, topicToTag: string): Promise<string[]> => {
      const genAI = new GoogleGenerativeAI(key);
      const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });
      const prompt = `Based on the quiz topic "${topicToTag}", generate 1 to 3 relevant subject tags (e.g., "Biology", "History"). Return a valid JSON array of strings. Example: ["Biology", "Photosynthesis"]. Return ONLY the JSON array.`;
      try {
          const result = await model.generateContent(prompt);
          const { response } = result;
          const text = response.text();
          let jsonString = text.trim();
          if (jsonString.startsWith('```json')) {
              jsonString = jsonString.substring(7, jsonString.length - 3).trim();
          }
          return JSON.parse(jsonString) as string[];
      } catch (error) {
          console.error("Error generating tags:", error);
          return [topicToTag];
      }
  };

  const savePracticeSessionAndMistakes = async () => {
    if (!user || !apiKey) {
      console.error("Save failed: User or API key is missing.");
      return;
    }
    setIsSaving(true);
    setLoadingMessage('Saving your results...');

    const score = calculateScore();
    const sessionData: Omit<PracticeSession, 'id'> = {
        topic,
        score,
        totalQuestions: questions.length,
        createdAt: Timestamp.now(),
        userId: user.uid,
        questions: questions.map((q, i) => ({
            question: q.question,
            userAnswer: String(userAnswers[i] ?? ''),
            correctAnswer: String(q.answer),
            isCorrect: String(userAnswers[i]).toLowerCase() === String(q.answer).toLowerCase(),
            type: q.type
        }))
    };

    try {
        const sessionRef = await addDoc(collection(db, `users/${user.uid}/practiceSessions`), sessionData);

        const mistakes = questions.reduce<Omit<Mistake, 'id'>[]>((acc, question, index) => {
            if (String(userAnswers[index]).toLowerCase() !== String(question.answer).toLowerCase()) {
                const mistake: Omit<Mistake, 'id'> = {
                    question: question.question,
                    userAnswer: String(userAnswers[index] ?? ''),
                    correctAnswer: String(question.answer),
                    topic,
                    difficulty,
                    createdAt: Timestamp.now(),
                    userId: user.uid,
                    practiceSessionId: sessionRef.id,
                    tags: [],
                    type: question.type,
                };
                if (question.type === 'multiple_choice') {
                    mistake.options = (question as any).options;
                }
                acc.push(mistake);
            }
            return acc;
        }, []);

        if (mistakes.length > 0 && apiKey) {
            const tags = await generateTagsForTopic(apiKey, topic);
            const batch = writeBatch(db);
            mistakes.forEach(mistake => {
                const mistakeRef = doc(collection(db, `users/${user.uid}/mistakes`));
                batch.set(mistakeRef, { ...mistake, tags });
            });
            await batch.commit();
        }
    } catch (error) {
        console.error("Error saving results to Firestore:", error);
        setLoadingMessage('Could not save your results due to a database error.');
    } finally {
        setIsSaving(false);
        setIsComplete(true);
    }
  };

  const handleFinish = () => {
    savePracticeSessionAndMistakes();
  };

  const handleAnalysis = async (index: number) => {
    if (apiKey && questions[index]?.type === 'multiple_choice') {
      setAnalysisLoading(index);
      setAnalysisError(null);
      try {
        const result = await generateAnalysis(apiKey, questions[index]);
        setAnalyses(prev => {
          const newAnalyses = [...prev];
          newAnalyses[index] = result;
          return newAnalyses;
        });
      } catch (error) {
        setAnalysisError(error instanceof Error ? error.message : 'An unknown error occurred.');
      } finally {
        setAnalysisLoading(null);
      }
    }
  };

  if (loading || isUserLoading || questions.length === 0) {
    return (
      <div className="flex flex-col justify-center items-center min-h-screen text-lg font-medium p-4 text-center text-gray-300">
        <p>{loadingMessage}</p>
        {!loading && !isUserLoading && (
          <Button onClick={() => router.push('/practice')} className="mt-4 btn-gradient font-bold">
            Back to Practice
          </Button>
        )}
      </div>
    );
  }

  const score = calculateScore();

  return (
    <div className="max-w-3xl mx-auto">
      {!isComplete ? (
        <Card className="bg-gray-800 border-gray-700 text-white">
          <CardHeader>
            <CardTitle className="text-xl sm:text-2xl">Quiz: {topic}</CardTitle>
            <div className="text-sm text-gray-400 pt-2">
              Question {currentQuestion + 1} of {questions.length}
            </div>
          </CardHeader>
          <CardContent>
             {questions[currentQuestion]?.type === 'multiple_choice' && (
              <QuestionMultipleChoice question={questions[currentQuestion]} onAnswer={answer => setUserAnswers(ua => ua.map((a, i) => i === currentQuestion ? answer : a))} userAnswer={userAnswers[currentQuestion] as string} />
            )}
            {questions[currentQuestion]?.type === 'true_false' && (
              <QuestionTrueFalse question={questions[currentQuestion]} onAnswer={answer => setUserAnswers(ua => ua.map((a, i) => i === currentQuestion ? answer : a))} userAnswer={userAnswers[currentQuestion] as boolean} />
            )}
            {questions[currentQuestion]?.type === 'case_based' && (
              <QuestionCaseBased question={questions[currentQuestion]} onAnswer={answer => setUserAnswers(ua => ua.map((a, i) => i === currentQuestion ? answer : a))} userAnswer={userAnswers[currentQuestion] as string} />
            )}
          </CardContent>
          <CardFooter>
            <Button
              onClick={() => currentQuestion < questions.length - 1 ? setCurrentQuestion(currentQuestion + 1) : handleFinish()}
              disabled={userAnswers[currentQuestion] === undefined || isSaving}
              className="w-full sm:w-auto btn-gradient font-bold"
            >
              {isSaving ? 'Saving...' : (currentQuestion < questions.length - 1 ? 'Next Question' : 'Finish Quiz')}
            </Button>
          </CardFooter>
        </Card>
      ) : (
        <div>
          {showSummary ? (
            <Card className="bg-gray-800 border-gray-700 text-white">
              <CardHeader><CardTitle>Quiz Summary</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                {questions.map((q, index) => {
                  const isCorrect = String(userAnswers[index]).toLowerCase() === String(q.answer).toLowerCase();
                  return (
                    <div key={index} className={`p-4 rounded-lg ${isCorrect ? 'bg-green-900/50' : 'bg-red-900/50'}`}>
                      <p className="font-semibold mb-2">{q.question}</p>
                      <div className={`flex items-center gap-2 ${isCorrect ? 'text-green-400' : 'text-red-400'}`}>
                        {isCorrect ? <CheckCircle className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                        <p>Your answer: {String(userAnswers[index] ?? 'Not answered')}</p>
                      </div>
                      {!isCorrect && (
                         <div className="flex items-center gap-2 text-green-400 mt-1">
                           <CheckCircle className="h-4 w-4" />
                           <p>Correct answer: {String(q.answer)}</p>
                         </div>
                      )}
                      {q.type === 'multiple_choice' && (
                        <div className="mt-4">
                          <Button
                            onClick={() => handleAnalysis(index)}
                            disabled={analysisLoading === index}
                            variant="secondary"
                            className="w-full sm:w-auto"
                          >
                            {analysisLoading === index ? 'Analyzing...' : 'Analyze Question'}
                          </Button>
                        </div>
                      )}
                      {analyses[index] && (
                        <div className="mt-4">
                          <QuizAnalysisDisplay analysis={analyses[index]} />
                        </div>
                      )}
                    </div>
                  )
                })}
              </CardContent>
              <CardFooter><Button onClick={() => setShowSummary(false)} variant="outline" className="border-gray-600 hover:bg-gray-700">Back to Score</Button></CardFooter>
            </Card>
          ) : (
            <Card className="text-center bg-gray-800 border-gray-700 text-white">
              <CardHeader><CardTitle className="text-2xl sm:text-3xl">Quiz Complete!</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                <p className="text-4xl font-bold">{Math.round((score / questions.length) * 100)}%</p>
                <p className="text-lg text-gray-400">Your score: {score} / {questions.length}</p>
              </CardContent>
              <CardFooter className="flex justify-center space-x-4">
                <Button onClick={() => router.push('/practice')} className="btn-gradient font-bold">New Quiz</Button>
                <Button onClick={() => setShowSummary(true)} variant="outline" className="border-gray-600 hover:bg-gray-700">Review Answers</Button>
              </CardFooter>
            </Card>
          )}
          {analysisError && (
            <Alert variant="destructive" className="mt-4">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{analysisError}</AlertDescription>
            </Alert>
          )}
        </div>
      )}
    </div>
  );
}
