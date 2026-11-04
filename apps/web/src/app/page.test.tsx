import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import HomePage from './page';

describe('home page', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new Error('API unavailable'),
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it('introduces the identity portal and sign-in form', () => {
    render(<HomePage />);

    expect(
      screen.getByRole('heading', {
        name: 'One account for shopping and business.',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('Identity & access')).toBeInTheDocument();
    expect(
      screen.getAllByRole('button', { name: 'Sign in' }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByRole('button', { name: 'Create account' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
  });

  it('shows the email verification requirement during registration', () => {
    render(<HomePage />);

    fireEvent.click(
      screen.getAllByRole('button', { name: 'Create account' })[0],
    );

    expect(
      screen.getByRole('heading', { name: 'Create your account' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Full name')).toBeInTheDocument();
    expect(
      screen.getByText('We will email you a verification link.'),
    ).toBeInTheDocument();
  });
});
