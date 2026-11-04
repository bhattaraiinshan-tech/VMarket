import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import HomePage from './page';

describe('home page', () => {
  it('introduces the platform foundation and its planned surfaces', () => {
    render(<HomePage />);

    expect(
      screen.getByRole('heading', {
        name: 'One market for customers, shops, and suppliers.',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('Project foundation')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Customer marketplace' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Vendor workspace' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Administrator console' }),
    ).toBeInTheDocument();
  });
});
