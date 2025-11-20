"use client";

import { useState } from "react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Loader2, AlertTriangle, Lightbulb } from "lucide-react";

// Define the types for the diagnosis data based on the AI's JSON schema
interface DiagnosisReason {
  title: string;
  probability: number;
  explanation: string;
  corrective_actions: string[];
  suggested_flashcard: { front: string; back: string };
  practice_prompt: string;
}

interface Diagnosis {
  is_correct?: boolean;
  confidence?: number;
  reasons?: DiagnosisReason[];
  summary?: string;
  error?: boolean;
  message?: string;
}

interface DiagnosisAccordionProps {
  mistakeId: string;
  diagnosis: Diagnosis | undefined;
  onRetry: (mistakeId: string) => void;
}

export default function DiagnosisAccordion({ mistakeId, diagnosis, onRetry }: DiagnosisAccordionProps) {
  const [showAllReasons, setShowAllReasons] = useState(false);

  // 1. Loading State
  if (diagnosis === undefined) {
    return (
      <div className="flex items-center gap-2 text-gray-400 mt-4">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span>Generating analysis...</span>
      </div>
    );
  }

  // 2. Error State
  if (diagnosis.error) {
    return (
      <div className="mt-4 text-red-400">
        <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" />
            <p>Diagnosis not available.</p>
        </div>
        <Button onClick={() => onRetry(mistakeId)} variant="outline" size="sm" className="mt-2 border-gray-600 hover:bg-gray-700">
          Try Again
        </Button>
      </div>
    );
  }

  // Handle case where diagnosis ran but generated no reasons
  if (!diagnosis.reasons || diagnosis.reasons.length === 0) {
    return (
       <div className="flex items-center gap-2 text-gray-400 mt-4">
         <Lightbulb className="h-5 w-5" />
         <span>No specific reasons for this mistake could be determined.</span>
       </div>
    )
  }

  // 3. Success State
  const reasonsToShow = showAllReasons ? diagnosis.reasons : diagnosis.reasons.slice(0, 3);

  return (
    <div className="mt-4">
        <h4 className="font-semibold text-md mb-2 text-gray-200">AI Diagnosis:</h4>
        <Accordion type="single" collapsible className="w-full">
            {reasonsToShow.map((reason, index) => (
                <AccordionItem key={index} value={`item-${index}`} className="border-gray-700">
                    <AccordionTrigger className="text-sm hover:no-underline text-left">
                       <span className="font-semibold text-pink-400 mr-2">Reason #{index + 1}:</span> {reason.title}
                    </AccordionTrigger>
                    <AccordionContent className="space-y-4 text-gray-300">
                        <p><span className="font-semibold">Likely Mistake:</span> {reason.explanation}</p>
                        <div>
                            <h5 className="font-semibold mb-2">Corrective Steps:</h5>
                            <ul className="list-decimal list-inside space-y-1">
                                {reason.corrective_actions.map((step, i) => <li key={i}>{step}</li>)}
                            </ul>
                        </div>
                         <div>
                            <h5 className="font-semibold mb-1">Suggested Flashcard:</h5>
                            <div className="p-2 border border-dashed border-gray-600 rounded-md">
                               <p><strong>Front:</strong> {reason.suggested_flashcard.front}</p>
                               <p><strong>Back:</strong> {reason.suggested_flashcard.back}</p>
                            </div>
                        </div>
                         <div>
                            <h5 className="font-semibold mb-1">Practice Prompt:</h5>
                            <p className="italic bg-gray-900/50 p-2 rounded-md">{reason.practice_prompt}</p>
                        </div>
                    </AccordionContent>
                </AccordionItem>
            ))}
        </Accordion>
        {diagnosis.reasons.length > 3 && !showAllReasons && (
            <Button onClick={() => setShowAllReasons(true)} variant="link" className="text-pink-400 p-0 mt-2">
                Show More Reasons
            </Button>
        )}
    </div>
  );
}
