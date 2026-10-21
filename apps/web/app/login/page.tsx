'use client';
import { Suspense } from 'react';
import { AuthForm, AuthPage } from '@/components/AuthForm';

export default function LoginPage() {
  return (
    <AuthPage>
      <Suspense>
        <AuthForm mode="signin" />
      </Suspense>
    </AuthPage>
  );
}
