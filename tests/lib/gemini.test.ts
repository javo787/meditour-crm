import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockError = vi.fn();

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: mockError,
    child: vi.fn().mockReturnThis(),
  }),
  newRequestId: vi.fn(),
}));

describe('askGemini', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    mockError.mockClear();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should throw an error and log if GEMINI_API_KEY is missing', async () => {
    delete process.env.GEMINI_API_KEY;
    const { askGemini } = await import('../../lib/gemini');

    await expect(askGemini({ history: [], items: [] }))
      .rejects.toThrow("GEMINI_API_KEY не задан — добавьте его в .env.local");

    expect(mockError).toHaveBeenCalledWith("GEMINI_API_KEY не задан");
  });
});
