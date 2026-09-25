import { cn } from './utils';

describe('cn utility function', () => {
  it('merges tailwind classes using clsx and twMerge', () => {
    expect(cn('bg-red-500', 'text-white')).toBe('bg-red-500 text-white');
  });

  it('handles conditional classes properly', () => {
    const isTrue = true;
    const isFalse = false;
    expect(cn('bg-red-500', isTrue && 'text-white', isFalse && 'font-bold')).toBe('bg-red-500 text-white');
  });

  it('handles arrays and objects', () => {
    expect(cn(['bg-red-500', 'text-white'], { 'font-bold': true, 'italic': false })).toBe('bg-red-500 text-white font-bold');
  });

  it('resolves conflicting tailwind classes correctly with twMerge', () => {
    expect(cn('p-4 p-8')).toBe('p-8');
    expect(cn('px-2 py-4 p-8')).toBe('p-8');
    expect(cn('bg-red-500 bg-blue-500')).toBe('bg-blue-500');
  });

  it('handles falsy values safely', () => {
    expect(cn('bg-red-500', null, undefined, false, '', 'text-white')).toBe('bg-red-500 text-white');
  });
});
