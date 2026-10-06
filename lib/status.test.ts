import { getWaitingBadge, stageLabel, tagColor } from './status';
import type { Lead, Stage } from './types';

function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: '1',
    name: 'Тест',
    phone: '992000000000',
    diagnosis: 'Уточняется',
    stage: 'first_contact',
    assignee: 'Джавохир',
    nextTouch: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    aiPaused: false,
    ...overrides,
  };
}

describe('getWaitingBadge', () => {
  it('returns "ждёт ответа от нас" when the patient sent the last message', () => {
    expect(getWaitingBadge(makeLead({ lastMessageFrom: 'patient' }))).toEqual({
      label: 'Ждёт ответа от нас',
      tone: 'urgent',
    });
  });

  it('returns "ждём ответа пациента" when we (ai or coordinator) sent the last message', () => {
    expect(getWaitingBadge(makeLead({ lastMessageFrom: 'ai' }))).toEqual({
      label: 'Ждём ответа пациента',
      tone: 'neutral',
    });
    expect(getWaitingBadge(makeLead({ lastMessageFrom: 'coordinator' }))).toEqual({
      label: 'Ждём ответа пациента',
      tone: 'neutral',
    });
  });

  it('returns null when there is no message history yet', () => {
    expect(getWaitingBadge(makeLead())).toBeNull();
  });

  it('returns null for closed leads (won/declined) regardless of lastMessageFrom', () => {
    expect(getWaitingBadge(makeLead({ stage: 'won', lastMessageFrom: 'patient' }))).toBeNull();
    expect(getWaitingBadge(makeLead({ stage: 'declined', lastMessageFrom: 'patient' }))).toBeNull();
  });
});

describe('tagColor', () => {
  it('returns the same color for the same tag every time', () => {
    expect(tagColor('Несерьёзный')).toBe(tagColor('Несерьёзный'));
  });

  it('returns a non-empty class string for any tag', () => {
    expect(tagColor('Wanna go').length).toBeGreaterThan(0);
    expect(tagColor('').length).toBeGreaterThan(0);
  });
});

describe('stageLabel', () => {
  it('returns correct label for valid stages', () => {
    expect(stageLabel('new')).toBe('Новый');
    expect(stageLabel('first_contact')).toBe('Первый контакт');
    expect(stageLabel('consult_scheduled')).toBe('Консультация назначена');
    expect(stageLabel('consult_done')).toBe('Консультация проведена');
    expect(stageLabel('estimate_sent')).toBe('Смета отправлена');
    expect(stageLabel('awaiting_decision')).toBe('Ожидание решения');
    expect(stageLabel('won')).toBe('Выиграно');
    expect(stageLabel('declined')).toBe('Отказ');
  });

  it('returns the input string if the stage is unknown', () => {
    expect(stageLabel('unknown_stage' as Stage)).toBe('unknown_stage');
    expect(stageLabel('invalid' as Stage)).toBe('invalid');
  });
});
