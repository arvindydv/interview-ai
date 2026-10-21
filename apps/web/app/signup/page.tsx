'use client';
import { Suspense } from 'react';
import { AuthForm, AuthPage } from '@/components/AuthForm';

export default function SignupPage() {
  return (
    <AuthPage>
      <Suspense>
        <AuthForm mode="signup" />
      </Suspense>
    </AuthPage>
  );
}
