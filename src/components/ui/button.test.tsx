import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Button } from './button';

describe('Button', () => {
  it('renders the provided label', () => {
    render(<Button>Save</Button>);

    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('applies the default button styling class', () => {
    render(<Button>Primary</Button>);

    expect(screen.getByRole('button', { name: 'Primary' })).toHaveClass('bg-primary');
  });

  it('supports alternate variants', () => {
    render(<Button variant="outline">Outline</Button>);

    expect(screen.getByRole('button', { name: 'Outline' })).toHaveClass('border-border');
  });
});
