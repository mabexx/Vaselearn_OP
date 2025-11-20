'use client';

import { useMemo, useState } from 'react';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { useUser, useFirestore } from '@/firebase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from '@/components/ui/skeleton';
import { ShieldAlert, ThumbsDown, ThumbsUp, CalendarIcon, TagIcon, FilterIcon } from 'lucide-react';
import { Mistake } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import DiagnosisAccordion from '@/components/DiagnosisAccordion';
import { useEffect } from 'react';


type SortOption = 'createdAt' | 'subject';

export default function MistakeVaultPage() {
  const { user } = useUser();
  const firestore = useFirestore();
  const [sortBy, setSortBy] = useState<SortOption>('createdAt');
  const [mistakes, setMistakes] = useState<Mistake[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Use a real-time listener to get mistakes and their diagnoses
  useEffect(() => {
    if (!user) {
      setIsLoading(false);
      return;
    };

    const q = query(collection(firestore, 'users', user.uid, 'mistakes'));
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const mistakesData: Mistake[] = [];
      querySnapshot.forEach((doc) => {
        mistakesData.push({ id: doc.id, ...doc.data() } as Mistake);
      });
      setMistakes(mistakesData);
      setIsLoading(false);
    }, (error) => {
        console.error("Error fetching mistakes:", error);
        setIsLoading(false);
    });

    return () => unsubscribe();
  }, [user, firestore]);

  const sortedMistakes = useMemo(() => {
    if (!mistakes) return [];
    const sorted = [...mistakes];
    sorted.sort((a, b) => {
      switch (sortBy) {
        case 'subject':
          const tagA = a.tags?.[0] || '';
          const tagB = b.tags?.[0] || '';
          return tagA.localeCompare(tagB);
        case 'createdAt':
        default:
          return (b.createdAt.seconds - a.createdAt.seconds);
      }
    });
    return sorted;
  }, [mistakes, sortBy]);

  // Handle retrying a diagnosis
  const handleRetryDiagnosis = async (mistakeId: string) => {
     const mistake = mistakes.find(m => m.id === mistakeId);
     if (!mistake || !user) return;

     // Optimistically update the UI to show loading
     setMistakes(prev => prev.map(m => m.id === mistakeId ? { ...m, diagnosis: undefined } : m));

     try {
         await fetch('/api/diagnose', {
             method: 'POST',
             headers: { 'Content-Type': 'application/json' },
             body: JSON.stringify({
                 mistakeId: mistake.id,
                 user,
                 question: mistake.question,
                 user_answer: mistake.userAnswer,
                 correct_answer: mistake.correctAnswer,
                 subject: mistake.topic,
                 topic: mistake.topic,
                 difficulty: mistake.difficulty,
             }),
         });
         // The real-time listener will automatically update the UI with the new diagnosis
     } catch (error) {
         console.error(`Failed to retry diagnosis for mistake ${mistakeId}:`, error);
         // The real-time listener will eventually get the error state from the backend
     }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Mistake Vault</h1>
          <p className="text-gray-400">
            Review questions you've previously answered incorrectly.
          </p>
        </div>
        <div className="flex items-center gap-4 w-full md:w-auto">
          <Button asChild className="w-full md:w-auto btn-gradient font-bold">
            <Link href="/mistake-vault/retake/quiz">Retake a Quiz</Link>
          </Button>
          <Select value={sortBy} onValueChange={(value) => setSortBy(value as SortOption)}>
            <SelectTrigger className="w-full md:w-auto bg-gray-800 border-gray-700">
              <FilterIcon className="h-4 w-4 mr-2" />
              <span>Sort by</span>
            </SelectTrigger>
            <SelectContent className="bg-gray-800 text-white border-gray-700">
              <SelectItem value="createdAt">
                <div className="flex items-center gap-2">
                  <CalendarIcon className="h-4 w-4" />
                  <span>Date</span>
                </div>
              </SelectItem>
              <SelectItem value="subject">
                <div className="flex items-center gap-2">
                  <TagIcon className="h-4 w-4" />
                  <span>Subject</span>
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-16 w-full bg-gray-700" />
            <Skeleton className="h-16 w-full bg-gray-700" />
            <Skeleton className="h-16 w-full bg-gray-700" />
          </div>
        ) : !sortedMistakes || sortedMistakes.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center text-gray-400 p-12">
            <ShieldAlert className="h-16 w-16 mb-4 text-gray-500" />
            <p className="font-semibold text-white">No mistakes found!</p>
            <p className="text-sm">When you get questions wrong in quizzes, they'll appear here for you to review.</p>
          </div>
        ) : (
          <Accordion type="multiple" className="w-full space-y-2">
            {sortedMistakes.map((mistake) => (
              <AccordionItem key={mistake.id} value={mistake.id} className="bg-gray-900 rounded-lg px-4 border-b-0">
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex justify-between items-center w-full">
                    <div className="text-left w-full">
                      <p className="font-semibold">{mistake.question}</p>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pt-4">
                  <div className="space-y-4">
                    <div className="flex items-start gap-2 text-red-400">
                      <ThumbsDown className="h-4 w-4 mt-1 flex-shrink-0" />
                      <div>
                        <span className="font-semibold">Your answer:</span> {mistake.userAnswer}
                      </div>
                    </div>
                    <div className="flex items-start gap-2 text-green-400">
                      <ThumbsUp className="h-4 w-4 mt-1 flex-shrink-0" />
                      <div>
                        <span className="font-semibold">Correct answer:</span> {mistake.correctAnswer}
                      </div>
                    </div>
                     <div className="flex flex-wrap gap-2 pt-2">
                        <Badge className="bg-gray-700 text-gray-300">Topic: {mistake.topic}</Badge>
                        <Badge className="bg-blue-900 text-blue-300">Difficulty: {mistake.difficulty}</Badge>
                        {mistake.tags && mistake.tags.map(tag => <Badge key={tag} className="bg-purple-900 text-purple-300">{tag}</Badge>)}
                      </div>
                      <DiagnosisAccordion mistakeId={mistake.id} diagnosis={mistake.diagnosis} onRetry={handleRetryDiagnosis}/>
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        )}
      </div>
    </div>
  );
}
