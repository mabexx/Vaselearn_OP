
'use client';

import { QuizAnalysis } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { CheckCircle, XCircle, AlertTriangle } from 'lucide-react';

interface QuizAnalysisProps {
  analysis: QuizAnalysis | null;
  error?: string;
}

export default function QuizAnalysisDisplay({ analysis, error }: QuizAnalysisProps) {
  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (!analysis) {
    return (
      <div className="flex justify-center items-center">
        <p>No analysis available for this question.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Section 1: Correct Answer & Solution */}
      <Card className="bg-gray-800 border-gray-700 text-white">
        <CardHeader>
          <CardTitle className="flex items-center text-green-400">
            <CheckCircle className="mr-2 h-6 w-6" />
            Correct Answer & Solution
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-lg font-semibold">Correct Answer: {analysis.correctSolution.answer}</p>
          <div className="space-y-2">
            {analysis.correctSolution.steps.map((step) => (
              <div key={step.step} className="p-3 bg-gray-700/50 rounded-lg">
                <p><strong>Step {step.step}:</strong> {step.explanation}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Section 2: Common Mistakes & Error Analysis */}
      <Card className="bg-gray-800 border-gray-700 text-white">
        <CardHeader>
          <CardTitle className="flex items-center text-yellow-400">
            <AlertTriangle className="mr-2 h-6 w-6" />
            Common Mistakes & Error Analysis
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {analysis.counterfactualAnalyses.map((item, index) => (
            <div key={index} className="p-4 border border-gray-600 rounded-lg">
              <h3 className="flex items-center text-red-400 text-lg font-bold mb-2">
                <XCircle className="mr-2 h-5 w-5" />
                Incorrect Answer: {item.wrongAnswer}
              </h3>
              <p className="font-semibold text-yellow-500 mb-3">
                Error Type: <span className="px-2 py-1 bg-yellow-900/50 rounded-md text-sm">{item.errorType}</span>
              </p>
              {item.possiblePathways.map((pathway, pIndex) => (
                <div key={pIndex} className="mt-4 p-3 bg-gray-700/50 rounded-lg">
                  <p className="italic mb-3">"{pathway.pathwayDescription}"</p>
                  <div className="space-y-2">
                    {pathway.steps.map((step) => (
                      <div
                        key={step.step}
                        className={`p-3 rounded-lg ${
                          step.isError
                            ? 'bg-red-900/30 border border-red-700'
                            : 'bg-gray-600/50'
                        }`}
                      >
                        <p><strong>Step {step.step}:</strong> {step.explanation}</p>
                        {step.isError && (
                          <div className="mt-2 p-2 bg-red-800/50 rounded-md text-red-300">
                            <p className="font-bold">Error:</p>
                            <p>{step.errorDescription}</p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
