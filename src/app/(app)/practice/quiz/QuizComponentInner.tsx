"use client";
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useUser, useFirestore } from '@/firebase';
import {
  collection,
  addDoc,
  Timestamp,
  writeBatch,
  doc,
  onSnapshot,
  query,
  where
} from 'firebase/firestore';
import { getSettings } from '@/lib/aistudio';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import { QuizQuestion, PracticeSession, Mistake } from '@/lib/types';

import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle, XCircle } from 'lucide-react';
import QuestionMultipleChoice from '@/components/quiz/QuestionMultipleChoice';
import QuestionTrueFalse from '@/components/quiz/QuestionTrueFalse';
import QuestionCaseBased from '@/components/quiz/QuestionCaseBased';
import DiagnosisAccordion from '@/components/DiagnosisAccordion';

interface ResultItem {
  question: string;
  userAnswer: string;
  correctAnswer: string;
  isCorrect: boolean;
  mistake?: Mistake;
}

interface QuizComponentInnerProps {
  topic: string;
  limit: number;
  clientType: string;
  questionType: string;
  modelId: string;
  difficulty: string;
  context: string;
}

const MAX_GENERATION_ATTEMPTS = 4;

export default function QuizComponentInner({
  topic,
  limit,
  clientType,
  questionType,
  modelId,
  difficulty,
  context: retakeContext
}: QuizComponentInnerProps) {
  const router = useRouter();
  const { user, isUserLoading } = useUser();
  const db = useFirestore();

  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [userAnswers, setUserAnswers] = useState<(string | boolean | undefined)[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [isComplete, setIsComplete] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState('Loading...');
  const [isSaving, setIsSaving] = useState(false);
  const [apiKey, setApiKey] = useState<string | null>(null);

  const [results, setResults] = useState<ResultItem[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const generateSingleBatchOfQuestions = useCallback(async (key: string, modelName: string, generationContext: string): Promise<QuizQuestion[]> => {
    const genAI = new GoogleGenerativeAI(key);
    const model = genAI.getGenerativeModel({ model: modelName,
       safetySettings: [
            { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        ],
     });
    const prompt = `${generationContext}. Your output MUST be a single, valid JSON array of question objects and nothing else. Each object must have "type", "question", and "answer" fields. For "multiple_choice", also include an "options" array of strings. Do not include any markdown formatting, introductory text, or explanations.`;

    const result = await model.generateContent(prompt);
    const { response } = result;
    const text = response.text();
    let jsonString = text.trim();
    if (jsonString.startsWith('```json')) {
      jsonString = jsonString.substring(7, jsonString.length - 3).trim();
    }
    return JSON.parse(jsonString) as QuizQuestion[];
  }, []);

  useEffect(() => {
    if (isUserLoading) return;
    if (!user) {
      router.push('/login');
      return;
    }

    const fetchSettingsAndGenerateWithRetries = async () => {
      setLoadingMessage('Initializing quiz generation...');
      const { apiKey: key } = getSettings();
      if (!key) {
        const params = new URLSearchParams({ topic, limit: String(limit), clientType, questionType, model: modelId, difficulty });
        router.push(`/practice/connect?${params.toString()}`);
        return;
      }
      setApiKey(key);

      let allGeneratedQuestions: QuizQuestion[] = [];
      let attempts = 0;
      let generationFailed = false;

      while (allGeneratedQuestions.length < limit && attempts < MAX_GENERATION_ATTEMPTS) {
        attempts++;
        const remainingQuestions = limit - allGeneratedQuestions.length;
        setLoadingMessage(`Generating ${remainingQuestions} question(s)... (Attempt ${attempts} of ${MAX_GENERATION_ATTEMPTS})`);

        let context = retakeContext;
         try {
            const basePrompt = `Generate a quiz on the topic of "${topic}" with a ${difficulty} difficulty level.`;
            if (context) {
                const parsedContext = JSON.parse(context);
                const questionText = parsedContext.map((q: any) => `- ${q.question}`).join('\n');
                context = `Based on the user's previous mistakes on these questions:\n${questionText}\n\nGenerate ${remainingQuestions} new, thematically similar questions.`;
            } else {
                context = basePrompt;
            }

            if (allGeneratedQuestions.length > 0) {
                const existingQuestions = allGeneratedQuestions.map(q => q.question).join('", "');
                context += `\n\nCRITICAL: Do not generate any of the following questions again: ["${existingQuestions}"]. You must generate exactly ${remainingQuestions} new questions.`;
            } else {
                 context += ` CRITICAL: You must generate exactly ${remainingQuestions} questions.`;
            }

            const newBatch = await generateSingleBatchOfQuestions(key, modelId, context);

            if (Array.isArray(newBatch) && newBatch.length > 0) {
                 allGeneratedQuestions.push(...newBatch);
                 allGeneratedQuestions = allGeneratedQuestions.filter((q, i, self) => i === self.findIndex(t => t.question === q.question));
            }

         } catch (error) {
             console.error(`Attempt ${attempts} failed:`, error);
             if (attempts >= MAX_GENERATION_ATTEMPTS) {
                 generationFailed = true;
                 break;
             }
         }
      }

      if (generationFailed || allGeneratedQuestions.length < limit) {
        setLoadingMessage(`Sorry, the AI failed to generate a complete quiz for this topic after ${attempts} attempts. Please try a different topic, or adjust the question count.`);
      } else {
        setQuestions(allGeneratedQuestions.slice(0, limit));
        setUserAnswers(new Array(limit).fill(undefined));
        setLoading(false);
      }
    };

    fetchSettingsAndGenerateWithRetries();
  }, [user, isUserLoading, modelId, topic, limit, clientType, questionType, difficulty, router, generateSingleBatchOfQuestions, retakeContext]);

  useEffect(() => {
    if (!sessionId || !user) return;
    const q = query(collection(db, `users/${user.uid}/mistakes`), where("practiceSessionId", "==", sessionId));
    const unsubscribe = onSnapshot(q, (snapshot) => {
        const mistakesMap = new Map<string, Mistake>();
        snapshot.forEach(doc => {
            const mistakeData = { id: doc.id, ...doc.data() } as Mistake;
            mistakesMap.set(mistakeData.question, mistakeData);
        });
        setResults(prevResults => prevResults.map(result => {
            const correspondingMistake = mistakesMap.get(result.question);
            return correspondingMistake ? { ...result, mistake: correspondingMistake } : result;
        }));
    });
    return () => unsubscribe();
  }, [sessionId, user, db]);

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
      const prompt = `Based on the quiz topic "${topicToTag}", generate 1 to 3 relevant subject tags. Return a valid JSON array of strings. Example: ["Biology"].`;
      try {
          const result = await model.generateContent(prompt);
          const { response } = result;
          return JSON.parse(response.text()) as string[];
      } catch (error) {
          console.error("Error generating tags:", error);
          return [topicToTag];
      }
  };

  const handleRetryDiagnosis = async (mistakeId: string) => {
     const mistake = results.find(r => r.mistake?.id === mistakeId)?.mistake;
     if (!mistake || !user) return;
     setResults(prev => prev.map(r => {
         if (r.mistake?.id === mistakeId) {
             const newMistake = { ...r.mistake, diagnosis: undefined };
             return { ...r, mistake: newMistake };
         }
         return r;
     }));
     fetch('/api/diagnose', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({
             mistakeId: mistake.id, user, question: mistake.question,
             user_answer: mistake.userAnswer, correct_answer: mistake.correctAnswer,
             subject: mistake.topic, topic: mistake.topic, difficulty: mistake.difficulty,
         }),
     }).catch(error => console.error(`Failed to retry diagnosis for mistake ${mistakeId}:`, error));
  };

  const savePracticeSessionAndMistakes = async () => {
    if (!user || !apiKey) return;
    setIsSaving(true);
    setLoadingMessage('Saving your results...');

    const score = calculateScore();
    const finalResults: ResultItem[] = questions.map((q, i) => ({
        question: q.question, userAnswer: String(userAnswers[i] ?? ''),
        correctAnswer: String(q.answer), isCorrect: String(userAnswers[i]).toLowerCase() === String(q.answer).toLowerCase(),
    }));
    setResults(finalResults);

    const sessionData: Omit<PracticeSession, 'id'> = {
        topic, score, totalQuestions: questions.length, createdAt: Timestamp.now(), userId: user.uid,
        questions: finalResults.map(r => ({
           question: r.question, userAnswer: r.userAnswer, correctAnswer: r.correctAnswer,
           isCorrect: r.isCorrect, type: questions.find(q => q.question === r.question)!.type
        }))
    };

    try {
        const sessionRef = await addDoc(collection(db, `users/${user.uid}/practiceSessions`), sessionData);
        setSessionId(sessionRef.id);

        const mistakesData = finalResults.filter(r => !r.isCorrect).map(r => {
            const originalQuestion = questions.find(q => q.question === r.question)!;
            const mistake: Omit<Mistake, 'id'> = {
                question: originalQuestion.question, userAnswer: r.userAnswer, correctAnswer: r.correctAnswer,
                topic, difficulty, createdAt: Timestamp.now(), userId: user.uid,
                practiceSessionId: sessionRef.id, tags: [], type: originalQuestion.type,
            };
            if (originalQuestion.type === 'multiple_choice') mistake.options = (originalQuestion as any).options;
            return mistake;
        });

        if (mistakesData.length > 0) {
            const tags = await generateTagsForTopic(apiKey, topic);
            const batch = writeBatch(db);
            mistakesData.forEach(mistake => {
                const mistakeRef = doc(collection(db, `users/${user.uid}/mistakes`));
                batch.set(mistakeRef, { ...mistake, tags });
                fetch('/api/diagnose', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        mistakeId: mistakeRef.id, user, question: mistake.question,
                        user_answer: mistake.userAnswer, correct_answer: mistake.correctAnswer,
                        subject: topic, topic: topic, difficulty: mistake.difficulty,
                        context: retakeContext || '',
                    }),
                }).catch(error => console.error(`Failed to trigger diagnosis for mistake ${mistakeRef.id}:`, error));
            });
            await batch.commit();
        }
    } catch (error) {
        console.error("Error saving results:", error);
        setLoadingMessage('Could not save your results.');
    } finally {
        setIsSaving(false);
        setIsComplete(true);
    }
  };

  const handleFinish = () => {
    savePracticeSessionAndMistakes();
  };

  if (loading || isUserLoading || questions.length === 0) {
    return (
      <div className="flex flex-col justify-center items-center min-h-screen text-lg font-medium p-4 text-center text-gray-300">
        <p className="mb-4">{loadingMessage}</p>
        <Button onClick={() => router.push('/practice')} className="btn-gradient font-bold">
          Back to Practice
        </Button>
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
              <QuestionMultipleChoice question={questions[currentQuestion]} onAnswer={(answer: string) => setUserAnswers(ua => ua.map((a, i) => i === currentQuestion ? answer : a))} userAnswer={userAnswers[currentQuestion] as string} />
            )}
            {questions[currentQuestion]?.type === 'true_false' && (
              <QuestionTrueFalse question={questions[currentQuestion]} onAnswer={(answer: boolean) => setUserAnswers(ua => ua.map((a, i) => i === currentQuestion ? answer : a))} userAnswer={userAnswers[currentQuestion] as boolean} />
            )}
            {questions[currentQuestion]?.type === 'case_based' && (
              <QuestionCaseBased question={questions[currentQuestion]} onAnswer={(answer: string) => setUserAnswers(ua => ua.map((a, i) => i === currentQuestion ? answer : a))} userAnswer={userAnswers[currentQuestion] as string} />
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
                {results.map((result, index) => (
                    <div key={index} className={`p-4 rounded-lg ${result.isCorrect ? 'bg-green-900/50' : 'bg-red-900/50'}`}>
                      <p className="font-semibold mb-2">{result.question}</p>
                      <div className={`flex items-center gap-2 ${result.isCorrect ? 'text-green-400' : 'text-red-400'}`}>
                        {result.isCorrect ? <CheckCircle className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                        <p>Your answer: {result.userAnswer ?? 'Not answered'}</p>
                      </div>
                      {!result.isCorrect && (
                         <>
                           <div className="flex items-center gap-2 text-green-400 mt-1">
                             <CheckCircle className="h-4 w-4" />
                             <p>Correct answer: {result.correctAnswer}</p>
                           </div>
                           <DiagnosisAccordion
                             mistakeId={result.mistake?.id || ''}
                             diagnosis={result.mistake?.diagnosis}
                             onRetry={handleRetryDiagnosis}
                           />
                         </>
                      )}
                    </div>
                ))}
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
        </div>
      )}
    </div>
  );
}
