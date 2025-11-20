
import { Timestamp } from 'firebase/firestore';

export interface Note {
  id: string;
  title: string;
  content: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  userId: string;
}


// Base question type
export interface BaseQuizQuestion {
  type: 'multiple_choice' | 'true_false' | 'matching_pairs' | 'case_based' | 'decision_tree';
  question: string;
  answer: any;
}

// Specific question types extending the base
export interface MultipleChoiceQuestion extends BaseQuizQuestion {
  type: 'multiple_choice';
  options: string[];
  answer: string;
}

export interface TrueFalseQuestion extends BaseQuizQuestion {
  type: 'true_false';
  answer: boolean;
}

export interface MatchingPairsQuestion extends BaseQuizQuestion {
  type: 'matching_pairs';
  pairs: { prompt: string; match: string }[];
  answer: string[];
}

export interface CaseBasedQuestion extends BaseQuizQuestion {
    type: 'case_based';
    prompt: string;
    answer: string; // The ideal answer for evaluation
}

export interface DecisionTreeQuestion extends BaseQuizQuestion {
    type: 'decision_tree';
    // This is a complex type, placeholder for now
    answer: any;
}

// A union type for any possible quiz question
export type QuizQuestion = MultipleChoiceQuestion | TrueFalseQuestion | MatchingPairsQuestion | CaseBasedQuestion | DecisionTreeQuestion;

export type Answer = string | boolean | string[] | undefined;

export interface PracticeSession {
    id: string;
    topic: string;
    questions: {
        question: string;
        userAnswer: string; // Stored as JSON string
        correctAnswer: string; // Stored as JSON string
        isCorrect: boolean;
        type: QuizQuestion['type'];
    }[];
    score: number;
    totalQuestions: number;
    createdAt: Timestamp | { seconds: number; nanoseconds: number; };
    userId: string;
}

export interface Mistake {
    id: string;
    type: QuizQuestion['type']; // Added type field
    question: string;
    userAnswer: string;
    correctAnswer: string;
    options?: string[]; // Added optional options for multiple choice
    topic: string;
    createdAt: Timestamp;
    userId: string;
    practiceSessionId: string;
    tags: string[];
    difficulty: string;
    diagnosis?: any; // Can be the diagnosis object, an error object, or undefined
}

export interface QuizFeedback {
    id: string;
    userId: string;
    question: string;
    rating: 'good' | 'bad';
    topic: string;
    createdAt: Timestamp | { seconds: number; nanoseconds: number; };
}

export interface CustomGoal {
    id: string;
    userId: string;
    text: string;
    isCompleted: boolean;
    createdAt: Timestamp;
}


// From vls-clients.json
export interface VLSTopic {
    title: string;
    subtopics: string[];
}

export interface VLSClient {
    client_type: string;
    metadata: {
        priority: string;
        sector: string;
        description: string;
    };
    instruction: {
        system_prompt: string;
        context: string;
        tone: string;
        difficulty_levels: string[];
    };
    topics: {
        hardcoded: VLSTopic[];
        custom: {
            title: string;
            description: string;
        }[];
    };
    question_generation: {
        style: string[];
        output_format: string;
        examples: {
            question: string;
            type: string;
            options: string[];
            answer: string;
            explanation: string;
        }[];
    };
}
