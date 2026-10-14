import { describe, it, expect, beforeEach, vi } from 'vitest';
import { chooseLanguage } from '../../../test/language';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../test/utils';
import { useSampleSessionStore } from '../../../demo/sampleSessionStore';
import { SampleDataBar } from '../SampleDataBar';

const sample = vi.hoisted(() => ({
  additions: 0,
  leave: vi.fn(async () => {}),
}));

vi.mock('../../../demo/visitorSample', () => ({
  countSessionAdditions: async () => sample.additions,
  leaveVisitorSample: () => sample.leave(),
}));

const navigate = vi.hoisted(() => vi.fn());
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
}));

beforeEach(() => {
  chooseLanguage('en');
  sample.additions = 0;
  sample.leave.mockClear();
  navigate.mockClear();
  useSampleSessionStore.setState({ status: 'active' });
});

describe('SampleDataBar', () => {
  it('says the visitor is looking at sample data', () => {
    renderWithProviders(<SampleDataBar />);
    expect(screen.getByText("You're looking at sample data.")).toBeInTheDocument();
  });

  it('renders nothing outside a sample session', () => {
    useSampleSessionStore.setState({ status: 'none' });
    const { container } = renderWithProviders(<SampleDataBar />);
    expect(container).toBeEmptyDOMElement();
  });

  it('leaves at once when the visitor added nothing', async () => {
    renderWithProviders(<SampleDataBar />);
    fireEvent.click(screen.getByRole('button', { name: /start with your own/i }));

    await waitFor(() => expect(sample.leave).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/', replace: true }));
    expect(useSampleSessionStore.getState().status).toBe('none');
  });

  it('asks first, naming the count, when the visitor added things', async () => {
    sample.additions = 2;
    renderWithProviders(<SampleDataBar />);
    fireEvent.click(screen.getByRole('button', { name: /start with your own/i }));

    expect(await screen.findByText(/2 things you added/i)).toBeInTheDocument();
    expect(sample.leave).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /keep looking/i }));
    expect(screen.getByText("You're looking at sample data.")).toBeInTheDocument();
    expect(sample.leave).not.toHaveBeenCalled();
  });

  it('leaves after the visitor confirms', async () => {
    sample.additions = 1;
    renderWithProviders(<SampleDataBar />);
    fireEvent.click(screen.getByRole('button', { name: /start with your own/i }));
    fireEvent.click(await screen.findByRole('button', { name: /start fresh/i }));

    await waitFor(() => expect(sample.leave).toHaveBeenCalledTimes(1));
  });
});
