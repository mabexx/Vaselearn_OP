'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { validateApiKey, saveSettings } from '@/lib/aistudio';
import { useUser, useFirestore } from '@/firebase';
import { doc, updateDoc } from 'firebase/firestore';

function ConnectPageInner() {
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useUser();
  const firestore = useFirestore();

  const handleConnect = async () => {
    setLoading(true);
    setError('');

    if (!apiKey) {
        setError('API key cannot be empty.');
        setLoading(false);
        return;
    }

    if (!user || !firestore) {
        setError('User not authenticated. Please sign in again.');
        setLoading(false);
        return;
    }

    try {
        const isValid = await validateApiKey(apiKey);

        if (isValid) {
            const userDocRef = doc(firestore, 'users', user.uid);
            await updateDoc(userDocRef, {
                googleAiApiKey: apiKey,
            });

            saveSettings(apiKey);
            const params = new URLSearchParams(searchParams.toString());
            router.push(`/practice/quiz?${params.toString()}`);
        } else {
            setError('Invalid API key. Please check your key and try again.');
        }
    } catch (e) {
        const errorMessage = e instanceof Error ? e.message : 'An unexpected error occurred.';
        setError(`Failed to connect: ${errorMessage}`);
        console.error(e);
    } finally {
        setLoading(false);
    }
  };

  return (
    <div className="flex justify-center items-center min-h-screen">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>Connect to Google AI Studio</CardTitle>
          <CardDescription>
            Enter your Google AI Studio API key to generate quiz questions.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="p-3 border border-red-500 bg-red-50 rounded-md">
              <p className="text-red-600 text-sm font-medium">{error}</p>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="apiKey">API Key</Label>
            <Input
              id="apiKey"
              type="password"
              placeholder="Paste your API key here"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
            />
          </div>
          <Accordion type="single" collapsible className="w-full">
            <AccordionItem value="item-1">
              <AccordionTrigger>How to Get Your Google AI Studio API Key</AccordionTrigger>
              <AccordionContent>
                <div className="prose prose-sm dark:prose-invert">
                  <ol>
                    <li>Go to 👉 <a href="https://aistudio.google.com" target="_blank" rel="noopener noreferrer">https://aistudio.google.com</a></li>
                    <li>Sign in with your Google (Gmail) account.</li>
                    <li>Click on <strong>&quot;Get API Key&quot;</strong> in the menu.</li>
                    <li>Click <strong>&quot;Create API Key&quot;</strong>.</li>
                    <li>Copy your key and paste it here.</li>
                  </ol>
                  <p><strong>⚠️ Important:</strong> Do not share your key with anyone you don’t trust.</p>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </CardContent>
        <CardFooter>
          <Button onClick={handleConnect} disabled={loading || !apiKey} className="w-full">
            {loading ? 'Connecting...' : 'Connect and Start Quiz'}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

export default function ConnectPage() {
    return (
        <Suspense fallback={<div>Loading...</div>}>
            <ConnectPageInner />
        </Suspense>
    );
}
